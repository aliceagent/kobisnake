// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { RESULTS } from '../../src/core/events.js';
import { LEVELS, LEVEL_POLICIES } from '../../src/game/bots/levels.js';
import { MOVE_VECTORS } from '../../src/game/bots/policy.js';
import { runRound } from './harness.js';

/**
 * KI-12-03 — measuring the three CPU levels (`src/game/bots/levels.js`) against each other and against a
 * no-input human, 500 seeded rounds per side of each matchup (`docs/sprints/improvement-12-cpu-opponent.md`).
 * The committed counterpart is `docs/qa/playtests/cpu-levels.md`.
 *
 * **Status: BLOCKED on #217.** AC1 requires the three levels to order themselves — HARD beats NORMAL beats
 * EASY, each by a clear margin — asserted, not just observed. Two of the three orderings hold by a wide
 * margin (NORMAL over EASY, and HARD over EASY). **HARD does not beat NORMAL**: the measured gap is
 * *negative* (NORMAL wins more often), confirmed below with the same margin every other comparison in this
 * file uses. `docs/qa/playtests/cpu-levels.md`'s "Why HARD does not beat NORMAL" section has the investigation
 * (seat-swap control, an ablation of the steering term, and the death-cause breakdown); this is a real,
 * seat-controlled finding, not noise or a bug in the harness, and per this ticket's own instruction ("do not
 * tune the bots to hit the numbers... post BLOCKED and tell me the numbers") the assertion below is left
 * exactly as it is required to read, and is expected to fail until the design lead decides what changes.
 *
 * ## Why every matchup is measured in *both* seats
 *
 * The two player spawns are not symmetric (`DESIGN-DECISIONS §2.3`: different corners, different starting
 * headings). A control run of two copies of the *same* policy facing each other on this file's own seeds
 * showed an 11-20 percentage-point gap between "goes first" (`p1`) and "goes second" (`p2`) that has nothing
 * to do with which bot is smarter — it is which spawn cell it got. Measuring a level pair in only one seat
 * would silently fold that spawn advantage into the "which level is stronger" number. Every matchup below is
 * therefore run once with each side as `p1`, 500 rounds each (1 000 rounds total per matchup), and the two
 * halves are combined before anything is compared — the same discipline `tuningMatrix.test.js` applies to its
 * own cells, extended one axis further because this ticket's own board has one.
 *
 * ## Seeds
 *
 * A pure function of which two participants are matched and which seat ordering is being run
 * ({@link seedStartFor}), never of how many matchups this run happens to compute — the same contract
 * `tuningMatrix.test.js`'s `seedStartFor` keeps for its own axes. `700 000+` is a fresh range, distinct from
 * every other `tests/sim` file's own (`stats.test.js` 10 000-40 000, `laserStats.test.js` 110 000-130 000,
 * `powerupStats.test.js` 210 000+, `tuningMatrix.test.js` 300 000+).
 *
 * ## Runtime (tuningMatrix.test.js's idiom, adapted)
 *
 * All six matchups (6 000 rounds) take ~60 s under this repository's always-on coverage instrumentation —
 * heavier than every other file in `tests/sim`, `tuningMatrix.test.js`'s own 41 s default run included. Two
 * of the six matchups (`normalVsIdle`, `hardVsIdle`) are informative-only rows: nothing in this file asserts
 * against them, they exist for the document's completeness (the ticket asks to "measure each level... against
 * a no-input human", not only EASY). Unlike `tuningMatrix.test.js`'s own variants, though, dropping them saves
 * little wall-clock time — a round against the idle bot ends almost immediately (it walks straight into the
 * nearest wall), so the three level-vs-level matchups AC1 needs are already almost the entire cost. The split
 * below is kept anyway, both because it is still an honest ~4 s saved on every default run and because it
 * correctly marks which two rows are load-bearing:
 *
 * - The **default** run (CI, every `npm run test:unit`) computes the four matchups every assertion below
 *   actually needs — `normalVsEasy`, `hardVsNormal`, `hardVsEasy`, `easyVsIdle` — ~56 s.
 * - Setting `KI_12_03_LEVELS_FULL=1` also computes `normalVsIdle` and `hardVsIdle`, the full six matchups,
 *   ~60 s — this is what generated the committed document; see that file's own header for the exact command
 *   and date.
 *
 * Every matchup, in either mode, is still the full 1 000 rounds (500 per seat) — nothing is ever shrunk to
 * fewer rounds, only the *number of matchups* computed by default is reduced.
 *
 * ## "Loses", defined once and used everywhere in this file
 *
 * A round can end `P1_WIN`, `P2_WIN` or `DRAW` (`DESIGN-DECISIONS §2.5`). "X loses to Y" means the round
 * result names Y's player id — a draw is not a loss for either side, the same way it is not a win for either
 * side. The ticket's "EASY must lose to an idle player less than a quarter of the time" is measured this way:
 * of the 1 000 EASY-vs-idle rounds (both seats), the percentage that resolve as idle's win.
 *
 * ## The idle bot
 *
 * `tests/agent/policies/idle.js` is the browser no-input policy; this file may not import from `tests/agent/`
 * (`CLAUDE.md`, `no-restricted-imports`), so {@link idleBot} below is the same one-line behaviour — "press
 * nothing, ever" — built directly against this harness's own `Bot` shape, exactly the way `tests/sim/bots/
 * randomBot.js` and this file's own `botForLevel` are local to `tests/sim` rather than shared with the browser
 * harness.
 */

/** @typedef {import('./harness.js').Bot} Bot */
/** @typedef {'EASY' | 'NORMAL' | 'HARD' | 'IDLE'} Participant */

const ROUNDS_PER_SEAT = 500;

// `globalThis.process`, not a bare `process` reference — see `tuningMatrix.test.js`'s own note on why
// `tests/**/*.js` needs this instead of an eslint `process` global.
const FULL_RUN = /** @type {any} */ (globalThis).process?.env?.KI_12_03_LEVELS_FULL === '1';

/** Matchup ids AC1 and AC2 actually assert against — computed on every run, default or full (module doc). */
const REQUIRED_MATCHUP_IDS = ['normalVsEasy', 'hardVsNormal', 'hardVsEasy', 'easyVsIdle'];

/** A bot that never decides anything — the sim equivalent of `tests/agent/policies/idle.js` (module doc). */
function idleBot() {
  return null;
}

/**
 * Wraps a `src/game/bots` {@link import('../../src/game/bots/policy.js').Policy} as a harness {@link Bot},
 * the same conversion `tests/sim/bots/greedyBot.js` and `survivorBot.js` each do for their own policy. No
 * `rules` are passed at all — direction 3 of the ticket's design brief: "Build the view with no `rules` field
 * so it gets `PLAY_RULES` (no randomness)" — so every level plays exactly the CPU's own rules and the whole
 * measurement is a pure function of the round seed.
 *
 * @param {import('../../src/game/bots/policy.js').Policy} policy
 * @returns {Bot}
 */
function botForLevel(policy) {
  return function bot({ self, others, apples, powerups, grid, lasers }) {
    const move = policy({
      snapshot: {
        snakes: [self, ...others],
        apples,
        powerUps: { pickups: powerups ?? [] },
        lasers,
      },
      playerIndex: 0,
      grid,
    });
    return move === null ? null : MOVE_VECTORS[move];
  };
}

/** @type {Record<Participant, Bot>} */
const BOTS = {
  EASY: botForLevel(LEVEL_POLICIES[LEVELS.EASY]),
  NORMAL: botForLevel(LEVEL_POLICIES[LEVELS.NORMAL]),
  HARD: botForLevel(LEVEL_POLICIES[LEVELS.HARD]),
  IDLE: idleBot,
};

/**
 * Index of each participant for {@link seedStartFor} — `IDLE` is a local bookkeeping label for this test
 * file's own seed derivation, never one of the three approved level words (`DESIGN-DECISIONS §1 row 27`) and
 * never exported by `levels.js`.
 *
 * @type {Record<Participant, number>}
 */
const PARTICIPANT_INDEX = Object.freeze({ EASY: 0, NORMAL: 1, HARD: 2, IDLE: 3 });

/**
 * A pure function of which two participants are matched (by their fixed {@link PARTICIPANT_INDEX}, lower
 * first so a matchup and its mirror image share one derivation) and which of the two seatings is being run —
 * see the module doc's "Seeds" section. Each `(lowIndex, highIndex)` cell reserves 15 000 seeds (2 seats ×
 * up to `SEAT_SPACING` each), comfortably more than `ROUNDS_PER_SEAT` (500) needs.
 *
 * @param {number} lowIndex
 * @param {number} highIndex
 * @param {0 | 1} seatIndex
 * @returns {number}
 */
function seedStartFor(lowIndex, highIndex, seatIndex) {
  const SEED_ROOT = 700_000;
  const LOW_SPACING = 50_000;
  const HIGH_SPACING = 5_000;
  const SEAT_SPACING = 1_000;
  return SEED_ROOT + lowIndex * LOW_SPACING + highIndex * HIGH_SPACING + seatIndex * SEAT_SPACING;
}

/**
 * The six matchups the ticket asks for: each level against every other level, and each level against the
 * no-input human. `higher`/`lower` name which side the design *intends* to be stronger — used only for
 * labelling and for which gap sign counts as "beats" below, never assumed true.
 *
 * @type {{id: string, higher: Participant, lower: Participant}[]}
 */
const MATCHUPS = [
  { id: 'normalVsEasy', higher: 'NORMAL', lower: 'EASY' },
  { id: 'hardVsNormal', higher: 'HARD', lower: 'NORMAL' },
  { id: 'hardVsEasy', higher: 'HARD', lower: 'EASY' },
  { id: 'easyVsIdle', higher: 'EASY', lower: 'IDLE' },
  { id: 'normalVsIdle', higher: 'NORMAL', lower: 'IDLE' },
  { id: 'hardVsIdle', higher: 'HARD', lower: 'IDLE' },
];

/**
 * Runs one matchup in both seatings and combines them (module doc's "why every matchup is measured in both
 * seats"). `n` is always `2 * ROUNDS_PER_SEAT` (1 000): draws are excluded from neither win count nor `n` —
 * `n` is every round actually played, matching the "loses"/"beats" definitions in the module doc, which are
 * both stated as a percentage of rounds played, not of decisive rounds only.
 *
 * @param {Participant} higher
 * @param {Participant} lower
 * @returns {{
 *   higher: Participant, lower: Participant, n: number,
 *   higherWinPct: number, lowerWinPct: number, drawPct: number, gapPct: number,
 * }}
 */
function runMatchup(higher, lower) {
  const higherIndex = PARTICIPANT_INDEX[higher];
  const lowerIndex = PARTICIPANT_INDEX[lower];
  const lowIndex = Math.min(higherIndex, lowerIndex);
  const highIndex = Math.max(higherIndex, lowerIndex);

  let higherWins = 0;
  let lowerWins = 0;
  let draws = 0;

  for (const seat of /** @type {const} */ ([0, 1])) {
    const seedStart = seedStartFor(lowIndex, highIndex, seat);
    const p1 = seat === 0 ? higher : lower;
    const p2 = seat === 0 ? lower : higher;
    for (let i = 0; i < ROUNDS_PER_SEAT; i += 1) {
      const seed = seedStart + i;
      const round = runRound({ seed, bots: [BOTS[p1], BOTS[p2]] });
      if (round.result === RESULTS.DRAW) {
        draws += 1;
        continue;
      }
      const winner = round.result === RESULTS.P1_WIN ? p1 : p2;
      if (winner === higher) higherWins += 1;
      else lowerWins += 1;
    }
  }

  const n = ROUNDS_PER_SEAT * 2;
  return {
    higher,
    lower,
    n,
    higherWinPct: (100 * higherWins) / n,
    lowerWinPct: (100 * lowerWins) / n,
    drawPct: (100 * draws) / n,
    gapPct: (100 * (higherWins - lowerWins)) / n,
  };
}

/**
 * The margin AC1 asserts ordering with, in percentage points of the `gapPct` {@link runMatchup} returns.
 *
 * Chosen from what was actually measured (ticket direction, not picked to make anything pass): the two
 * orderings that do hold (NORMAL over EASY, HARD over EASY) each clear roughly 80 points, so 20 leaves wide
 * headroom against seed-to-seed noise while still being a real, decisive bar — nowhere near a coin flip. HARD
 * vs NORMAL does not clear *any* positive margin at all (the measured gap is negative), which is this
 * ticket's finding; 20 was not lowered to try to catch it, nor raised to make the passing pairs look better.
 */
const ORDERING_MARGIN_PP = 20;

describe('KI-12-03 CPU levels', () => {
  /** @type {Record<string, ReturnType<typeof runMatchup>>} */
  let matchups;
  let totalElapsedMs;

  beforeAll(() => {
    const start = performance.now();
    matchups = {};
    const toRun = MATCHUPS.filter(({ id }) => FULL_RUN || REQUIRED_MATCHUP_IDS.includes(id));
    for (const { id, higher, lower } of toRun) {
      matchups[id] = runMatchup(higher, lower);
    }
    totalElapsedMs = performance.now() - start;

    console.log(
      `\nKI-12-03 CPU level matchups (${FULL_RUN ? 'FULL run' : 'CI default subset'}, ` +
        `${ROUNDS_PER_SEAT * 2} seeded rounds per matchup, both seatings, ${toRun.length} matchups, ` +
        `${totalElapsedMs.toFixed(0)}ms total):`,
    );
    console.table(
      toRun.map(({ id, higher, lower }) => {
        const stats = matchups[id];
        return {
          matchup: `${higher} vs ${lower}`,
          rounds: stats.n,
          [`${higher} win%`]: `${stats.higherWinPct.toFixed(1)}%`,
          [`${lower} win%`]: `${stats.lowerWinPct.toFixed(1)}%`,
          'draw%': `${stats.drawPct.toFixed(1)}%`,
          [`gap (${higher}-${lower})`]: `${stats.gapPct.toFixed(1)}pp`,
          [`>= ${ORDERING_MARGIN_PP}pp?`]: stats.gapPct >= ORDERING_MARGIN_PP ? 'yes' : 'NO',
        };
      }),
    );
    if (!FULL_RUN) {
      console.log(
        'INFORMATIVE ONLY (not computed by default; run with KI_12_03_LEVELS_FULL=1 for the full matrix): ' +
          'NORMAL vs idle, HARD vs idle — see docs/qa/playtests/cpu-levels.md.',
      );
    }
    console.log(
      'KI-12-03 is BLOCKED on #217: HARD does not beat NORMAL by any positive margin (see ' +
        'docs/qa/playtests/cpu-levels.md). Do not tune levels.js to change this number — report it.',
    );
    if (FULL_RUN) {
      console.log(
        "\nKI-12-03 JSON (for the document's machine-readable block):",
        JSON.stringify(
          {
            roundsPerMatchup: ROUNDS_PER_SEAT * 2,
            matchups: toRun.map(({ id }) => ({ id, ...matchups[id] })),
          },
          null,
          2,
        ),
      );
    }
  }, 90_000);

  describe('AC1 the levels order themselves, with a margin', () => {
    it('KI-12-03 AC1: NORMAL beats EASY by at least the ordering margin', () => {
      expect(matchups.normalVsEasy.gapPct).toBeGreaterThanOrEqual(ORDERING_MARGIN_PP);
    });

    it('KI-12-03 AC1: HARD beats EASY by at least the ordering margin (transitivity)', () => {
      expect(matchups.hardVsEasy.gapPct).toBeGreaterThanOrEqual(ORDERING_MARGIN_PP);
    });

    // BLOCKED on #217 (module doc): this is expected to fail. It is left exactly as every other assertion in
    // this describe block reads — the ticket's own instruction is not to tune levels.js until this passes.
    it('KI-12-03 AC1: HARD beats NORMAL by at least the ordering margin', () => {
      expect(matchups.hardVsNormal.gapPct).toBeGreaterThanOrEqual(ORDERING_MARGIN_PP);
    });

    it('KI-12-03 AC1: EASY loses to an idle player less than a quarter of the time', () => {
      // "Loses" per the module doc: the percentage of EASY-vs-idle rounds (both seats) that resolve as
      // idle's win. A draw is not a loss.
      expect(matchups.easyVsIdle.lowerWinPct).toBeLessThan(25);
    });
  });

  describe('AC2 a committed document exists with seeds and the command', () => {
    const docPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../docs/qa/playtests/cpu-levels.md',
    );

    it('KI-12-03 AC2: docs/qa/playtests/cpu-levels.md exists and names its command and seed derivation', () => {
      const doc = readFileSync(docPath, 'utf8');
      expect(doc).toContain('npx vitest run tests/sim/cpuLevels.test.js');
      expect(doc).toContain('seedStartFor');
      expect(doc).toContain('700');
      expect(doc).toContain('#217');
    });

    it("KI-12-03: the freshly-computed matchups match the committed document's machine-readable block", () => {
      const doc = readFileSync(docPath, 'utf8');
      const match = doc.match(/```json\r?\n([\s\S]*?)\r?\n```/);
      expect(match).not.toBeNull();
      const recorded = JSON.parse(/** @type {RegExpMatchArray} */ (match)[1]);

      expect(recorded.roundsPerMatchup).toBe(ROUNDS_PER_SEAT * 2);

      /** @type {Map<string, any>} */
      const recordedById = new Map(recorded.matchups.map((m) => [m.id, m]));
      // Only the matchups this run actually computed (module doc's "Runtime"): the CI default subset never
      // recomputes the two informative-only idle rows, so it cannot diff them either.
      for (const id of Object.keys(matchups)) {
        const recordedMatchup = recordedById.get(id);
        const fresh = matchups[id];
        expect(recordedMatchup, `document is missing matchup ${id}`).toBeDefined();
        expect(recordedMatchup.higherWinPct).toBeCloseTo(fresh.higherWinPct, 1);
        expect(recordedMatchup.lowerWinPct).toBeCloseTo(fresh.lowerWinPct, 1);
        expect(recordedMatchup.drawPct).toBeCloseTo(fresh.drawPct, 1);
        expect(recordedMatchup.gapPct).toBeCloseTo(fresh.gapPct, 1);
      }
    });
  });
});
