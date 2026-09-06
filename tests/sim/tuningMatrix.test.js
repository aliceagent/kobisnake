// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { END_REASONS, EVENTS, RESULTS } from '../../src/core/events.js';
import { POWERUP_TYPES } from '../../src/core/powerups.js';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';
import { greedyBot } from './bots/greedyBot.js';
import { survivorBot } from './bots/survivorBot.js';
import { runRound } from './harness.js';

/**
 * The Gate 1 bot-statistics matrix (`docs/sprints/sprint-07-playtest-gate-1-and-tuning.md` KS-07-03,
 * `docs/qa/PLAYTEST-SCRIPT.md §5`/`§6`, `QA-STRATEGY §4`). Runs the same tuning variants KS-07-02's human
 * session 2 played (laser start 25/30/35 s, laser step interval 2/2.5/3 s, Speed Boost 1.5×/5 s vs 1.35×/4 s)
 * across the three bot pairings `stats.test.js`/`laserStats.test.js` already use, and writes the resulting
 * numbers into `docs/qa/playtests/gate1-bot-matrix.md`. Every variant is built with {@link withOverrides} —
 * `src/core/settings.js` itself is never touched (CLAUDE.md "the never list"; tech-lead note 1).
 *
 * **The three SLOW target-mode variants are not built here.** KS-07-01 (parallel branch, not yet merged as
 * of this ticket — confirmed by grepping `src/` for `targetMode`/`slowTarget` and finding nothing) is what
 * adds the experimental switch; implementing it a second time here would duplicate that ticket's work and
 * risk disagreeing with it. {@link PENDING_SLOW_VARIANTS} below exists purely so both this file and the
 * document say, in one place, which three rows are missing and why — "pending KS-07-01" — rather than the
 * matrix silently having fewer rows than the ticket asked for.
 *
 * **Runtime (tech-lead note 5).** A full run — every buildable variant × every pairing, 500 rounds each — is
 * ~9 000 rounds and takes about a minute; that is a deliberately-driven measurement run, not something every
 * `npm run test:unit` should pay for on every push (`laserFuzz.test.js` ~29 s and `powerupStats.test.js`
 * ~37 s are the yardstick this ticket was told to respect). So:
 *
 * - The **default** run (what CI and every contributor's `npm run test:unit` executes) computes a smaller
 *   but still fully-honest subset: two variants — `baseline` and `speedBoostAlt` — for the `greedy vs
 *   survivor` pairing (the exact pairing `PLAYTEST-SCRIPT §5`'s "Bot stat" row names) plus the same two
 *   variants for `greedy vs greedy` (needed anyway for the Speed Boost deep-dive). That is 2 000 rounds,
 *   ~15 s on a quiet machine — kept deliberately small because this repository's `tests/sim` suite already
 *   runs many other 500-2000-round files in the same `npm run test:unit` invocation, and on a 4-core sandbox
 *   every additional concurrently-scheduled heavy file measurably slows every other file down, not just its
 *   own wall clock. The other four laser-timing variants (`laserStart25/35`, `stepInterval2/3`) are still
 *   real 500-round cells and still in the document — they are simply not recomputed by default, only by a
 *   deliberately-driven full run.
 * - Setting `KS_TUNING_MATRIX_FULL=1` runs every cell (18 main-matrix cells, 9 000 rounds) — this is what
 *   generated the committed document; see that file's own header for the exact command and date.
 *
 * Every cell, in either mode, is still a real 500-round run — nothing is ever shrunk to fewer rounds, only
 * the *number of cells* run by default is reduced, which is what "smaller but honest" means here.
 *
 * **Consistency, not re-measurement, is what CI checks against the document.** Re-running the full matrix on
 * every PR would fail its own runtime budget; instead the tests below recompute the CI-subset cells fresh,
 * every run, from the same seeds the full run used (seeds are a pure function of `(pairingId, variantId)`,
 * not of which cells happen to run this time — see {@link seedStartFor}), and diff them against the machine
 * -readable JSON block at the bottom of the committed document. A hand-edited document that drifts from what
 * the code actually produces fails this test; a code change that moves the numbers without the document being
 * regenerated also fails it. Like every other file in `tests/sim`, no rate here is ever asserted against a
 * threshold (`stats.test.js`'s module doc) — "meets §5" is a column the matrix reports, not a gate this test
 * enforces; AC1 is "matrix committed and linked", checked structurally.
 */

/** @typedef {import('../../src/core/round.js').SimEvent} SimEvent */
/** @typedef {import('../../src/core/settings.js').Settings} Settings */
/** @typedef {import('../../src/core/settings.js').SettingsOverride} SettingsOverride */
/** @typedef {{seed: number, events: SimEvent[], result: import('../../src/core/events.js').RoundResult | null, lengths: number[], endedAt: number, reason: import('../../src/core/events.js').EndReason | null}} RoundRun */

const ROUNDS_PER_CELL = 500;
// `globalThis.process`, not a bare `process` reference: `tests/**/*.js` is not in `eslint.config.js`'s list of
// files that get the Node `process` global (only `*.config.js` and `scripts/**/*.mjs` do, per that config's
// own module doc on why each directory gets only the globals it needs) and this file's own `Files:` list does
// not include `eslint.config.js`. `globalThis` is a plain ECMAScript builtin, so no eslint global is needed.
const FULL_RUN = /** @type {any} */ (globalThis).process?.env?.KS_TUNING_MATRIX_FULL === '1';

/** One simulated second in ticks, the same window `powerupStats.test.js` uses for "boost killed me". */
const BOOST_WINDOW_TICKS = Math.round(SETTINGS.simHz * 1);

const RESULT_FOR_PLAYER = { p1: RESULTS.P1_WIN, p2: RESULTS.P2_WIN };

/**
 * The three bot pairings `laserStats.test.js` reports (`QA-STRATEGY §4`). Index order fixes each pairing's
 * seed offset ({@link seedStartFor}) — do not reorder without re-deriving the document's seeds.
 */
const PAIRINGS = [
  { id: 'survivorVsSurvivor', name: 'survivor vs survivor', bot1: survivorBot, bot2: survivorBot },
  { id: 'greedyVsSurvivor', name: 'greedy vs survivor', bot1: greedyBot, bot2: survivorBot },
  { id: 'greedyVsGreedy', name: 'greedy vs greedy', bot1: greedyBot, bot2: greedyBot },
];

/**
 * The six variants that can actually be built today, one axis away from the shipping defaults at a time —
 * "baseline" *is* the all-defaults row (laserStartTime 30, laserStepInterval 2.5, speedBoost 1.5×/5s), so it
 * is listed once rather than once per axis, per KS-07-02's own variant list (tech-lead note 1). Index order
 * fixes each variant's seed offset ({@link seedStartFor}) — do not reorder without re-deriving the document.
 *
 * @type {{id: string, label: string, overrides: SettingsOverride}[]}
 */
const BUILDABLE_VARIANTS = [
  {
    id: 'baseline',
    label: 'baseline (defaults: laser start 30s, step 2.5s, boost 1.5×/5s)',
    overrides: {},
  },
  { id: 'laserStart25', label: 'laser start 25s', overrides: { laserStartTime: 25 } },
  { id: 'laserStart35', label: 'laser start 35s', overrides: { laserStartTime: 35 } },
  { id: 'stepInterval2', label: 'laser step interval 2s', overrides: { laserStepInterval: 2 } },
  { id: 'stepInterval3', label: 'laser step interval 3s', overrides: { laserStepInterval: 3 } },
  {
    id: 'speedBoostAlt',
    label: 'Speed Boost 1.35×/4s (vs baseline 1.5×/5s)',
    overrides: { speedBoost: { multiplier: 1.35, duration: 4 } },
  },
];

/**
 * The three SLOW target-mode rows the ticket names but that cannot be built until KS-07-01 lands (module
 * doc). Kept as data, not a comment, so both this file's own table and the document can list them by name
 * without either place inventing the mechanic itself (CLAUDE.md "never invent a mechanic").
 */
const PENDING_SLOW_VARIANTS = [
  { id: 'slowTargetOpponent', label: 'SLOW target = opponent' },
  { id: 'slowTargetCollector', label: 'SLOW target = collector' },
  { id: 'slowTargetEveryoneButCollector', label: 'SLOW target = everyone-but-collector' },
];

/** Cells the Speed Boost deep-dive needs, run regardless of {@link FULL_RUN} (module doc). */
const SPEED_BOOST_VARIANT_IDS = ['baseline', 'speedBoostAlt'];

/**
 * A per-`(pairing, variant)` seed base, distinct from every other `tests/sim` file's own seed ranges
 * (`stats.test.js` 10 000-40 000, `laserStats.test.js` 110 000-130 000, `powerupStats.test.js` 210 000+).
 * Deliberately a pure function of the pairing's and variant's *index* in the arrays above, not of how many
 * cells this run happens to compute — the module doc's "seeds are a pure function of (pairingId, variantId)"
 * claim, which is what lets the CI subset reproduce exactly the numbers a full run already put in the
 * document. 1000-wide spacing comfortably holds `ROUNDS_PER_CELL` (500) with room to spare.
 *
 * @param {number} pairingIndex
 * @param {number} variantIndex
 * @returns {number}
 */
function seedStartFor(pairingIndex, variantIndex) {
  const SEED_ROOT = 300_000;
  const PAIRING_SPACING = 100_000;
  const VARIANT_SPACING = 1_000;
  return SEED_ROOT + pairingIndex * PAIRING_SPACING + variantIndex * VARIANT_SPACING;
}

/**
 * Runs `n` seeded rounds of one pairing under one settings variant, keeping each round's raw event log
 * (needed by the Speed Boost deep-dive, which reads `EFFECT_STARTED`/`SNAKE_DIED` timing, not just the
 * aggregate counts `aggregateCell` reduces to).
 *
 * @param {(typeof PAIRINGS)[number]} pairing
 * @param {Settings} settings
 * @param {number} seedStart
 * @param {number} n
 * @returns {RoundRun[]}
 */
function runCell(pairing, settings, seedStart, n) {
  /** @type {RoundRun[]} */
  const rounds = [];
  for (let i = 0; i < n; i += 1) {
    const seed = seedStart + i;
    const round = runRound({ seed, bots: [pairing.bot1, pairing.bot2], settings });
    rounds.push({
      seed,
      events: round.events,
      result: round.result,
      lengths: round.lengths,
      endedAt: round.endedAt,
      reason: round.reason,
    });
  }
  return rounds;
}

/**
 * Reduces one cell's raw rounds to the matrix's five named statistics (ticket spec) plus the derived
 * `endsByDeathPct` and the `PLAYTEST-SCRIPT §5` verdict. The before/during-laser boundary uses **this
 * variant's own** `laserStartTime`, not a hardcoded 30 — three of the six variants change exactly that
 * number, so a fixed boundary would silently mislabel deaths for them.
 *
 * @param {RoundRun[]} rounds
 * @param {Settings} settings
 */
function aggregateCell(rounds, settings) {
  const beforeLaserElapsed = settings.roundDuration - settings.laserStartTime;
  let beforeLaser = 0;
  let duringLaser = 0;
  let timeout = 0;
  let draws = 0;
  let longestSum = 0;

  for (const round of rounds) {
    if (round.reason === END_REASONS.TIMEOUT) {
      timeout += 1;
    } else if (round.endedAt < beforeLaserElapsed) {
      beforeLaser += 1;
    } else {
      duringLaser += 1;
    }
    if (round.result === RESULTS.DRAW) draws += 1;
    longestSum += Math.max(...round.lengths);
  }

  const n = rounds.length;
  const beforeLaserPct = (100 * beforeLaser) / n;
  const duringLaserPct = (100 * duringLaser) / n;
  const timeoutPct = (100 * timeout) / n;
  const drawPct = (100 * draws) / n;
  const endsByDeathPct = 100 - timeoutPct;

  return {
    rounds: n,
    beforeLaserPct,
    duringLaserPct,
    timeoutPct,
    drawPct,
    meanSurvivorLength: longestSum / n,
    endsByDeathPct,
    // PLAYTEST-SCRIPT §5: >= 85% end by death (not timeout), draw rate <= 3%.
    meetsTarget: endsByDeathPct >= 85 && drawPct <= 3,
  };
}

/**
 * The Speed Boost deep-dive (tech-lead note 2): for one variant's `greedy vs greedy` rounds, the SPEED
 * collector's win rate and the "died within 1s of the boost starting" rate against its own control, computed
 * the same way `powerupStats.test.js`'s `boostKilledMeStats`/`collectorWinRateForType` do (duplicated here
 * rather than imported — this ticket's `Files:` list does not include that file, matching how the bot files
 * duplicate their own small helpers rather than share a module, per those files' own module docs).
 *
 * @param {RoundRun[]} rounds
 */
function speedBoostDeepDive(rounds) {
  // "Died within 1s of boost start" and its control (mirrors powerupStats.test.js's boostKilledMeStats).
  let boostSamples = 0;
  let boostDeathsWithinWindow = 0;
  let hazardNumeratorTicks = 0;
  let hazardDenominatorTicks = 0;

  // Collector win rate for SPEED (mirrors powerupStats.test.js's collectorWinRateForType, ON arm only — no
  // powerUpsEnabled:false comparison is needed here, the deep-dive's question is baseline-vs-alt, not on/off).
  /** @type {{seed: number, playerId: 'p1' | 'p2'}[]} */
  const speedCollectorSeeds = [];

  for (const { seed, events } of rounds) {
    /** @type {Record<string, number>} */
    const deathTick = {};
    for (const event of events) {
      if (event.type === EVENTS.SNAKE_DIED) {
        deathTick[/** @type {any} */ (event).snakeId] = event.tick;
      }
    }
    const roundOver = /** @type {any} */ (events.find((e) => e.type === EVENTS.ROUND_OVER));
    const endTick = roundOver.tick;

    for (const playerId of ['p1', 'p2']) {
      const died = deathTick[playerId];
      const aliveTicks = died ?? endTick;
      hazardDenominatorTicks += aliveTicks;
      if (died !== undefined) hazardNumeratorTicks += Math.min(died, BOOST_WINDOW_TICKS);
    }

    /** @type {Set<'p1' | 'p2'>} */
    const speedCollectedBy = new Set();
    for (const event of events) {
      if (
        event.type === EVENTS.EFFECT_STARTED &&
        /** @type {any} */ (event).powerUpType === POWERUP_TYPES.SPEED
      ) {
        boostSamples += 1;
        const playerId = /** @type {any} */ (event).playerId;
        const died = deathTick[playerId];
        if (died !== undefined && died >= event.tick && died - event.tick <= BOOST_WINDOW_TICKS) {
          boostDeathsWithinWindow += 1;
        }
      }
      if (
        event.type === EVENTS.POWERUP_COLLECTED &&
        /** @type {any} */ (event).powerUpType === POWERUP_TYPES.SPEED
      ) {
        speedCollectedBy.add(/** @type {any} */ (event).playerId);
      }
    }
    for (const playerId of speedCollectedBy) speedCollectorSeeds.push({ seed, playerId });
  }

  const resultBySeed = new Map(rounds.map((round) => [round.seed, round.result]));
  const collectorWon = speedCollectorSeeds.map(
    ({ seed, playerId }) => resultBySeed.get(seed) === RESULT_FOR_PLAYER[playerId],
  );

  return {
    boostSamples,
    diedWithin1sPct: boostSamples > 0 ? (100 * boostDeathsWithinWindow) / boostSamples : 0,
    controlWithin1sPct:
      hazardDenominatorTicks > 0 ? (100 * hazardNumeratorTicks) / hazardDenominatorTicks : 0,
    collectorSample: speedCollectorSeeds.length,
    collectorWinRatePct:
      collectorWon.length > 0
        ? (100 * collectorWon.filter(Boolean).length) / collectorWon.length
        : 0,
  };
}

/**
 * The set of `(pairing, variant)` cells to actually compute for the main matrix this run — module doc's
 * "smaller but honest subset" for the default (non-`FULL_RUN`) case: `greedy vs survivor` only (the pairing
 * `PLAYTEST-SCRIPT §5`'s "Bot stat" row names), and only the two variants the Speed Boost deep-dive also
 * needs to run anyway (`baseline`, `speedBoostAlt`) — this machine's 4 cores mean every extra 500-round cell
 * this file adds to `npm run test:unit` competes with the ~30 other files vitest schedules alongside it, so
 * the default footprint is kept to the two cells that are load-bearing (they cover the doc's own consistency
 * check *and* the Speed Boost cells) rather than all six buildable variants. The other four laser-timing
 * variants (`laserStart25/35`, `stepInterval2/3`) are still real, still 500-round, still in the document —
 * they are only ever (re)computed by a deliberately-driven `KS_TUNING_MATRIX_FULL=1` run, never by default.
 */
function cellsToRun() {
  /** @type {{pairing: (typeof PAIRINGS)[number]; pairingIndex: number; variant: (typeof BUILDABLE_VARIANTS)[number]; variantIndex: number}[]} */
  const cells = [];
  PAIRINGS.forEach((pairing, pairingIndex) => {
    BUILDABLE_VARIANTS.forEach((variant, variantIndex) => {
      const inDefaultSubset =
        pairing.id === 'greedyVsSurvivor' && SPEED_BOOST_VARIANT_IDS.includes(variant.id);
      if (FULL_RUN || inDefaultSubset) {
        cells.push({ pairing, pairingIndex, variant, variantIndex });
      }
    });
  });
  return cells;
}

describe('KS-07-03 Gate 1 bot statistics matrix', () => {
  /** @type {{variantId: string, pairingId: string, stats: ReturnType<typeof aggregateCell>}[]} */
  let matrixCells;
  /** @type {Record<string, ReturnType<typeof speedBoostDeepDive>>} */
  let speedBoost;
  let totalElapsedMs;

  beforeAll(() => {
    const start = performance.now();
    matrixCells = [];
    speedBoost = {};

    for (const { pairing, pairingIndex, variant, variantIndex } of cellsToRun()) {
      const settings = withOverrides(variant.overrides);
      const seedStart = seedStartFor(pairingIndex, variantIndex);
      const rounds = runCell(pairing, settings, seedStart, ROUNDS_PER_CELL);
      matrixCells.push({
        variantId: variant.id,
        pairingId: pairing.id,
        stats: aggregateCell(rounds, settings),
      });

      if (pairing.id === 'greedyVsGreedy' && SPEED_BOOST_VARIANT_IDS.includes(variant.id)) {
        speedBoost[variant.id] = speedBoostDeepDive(rounds);
      }
    }

    // The Speed Boost deep-dive's two `greedy vs greedy` cells still run in the default (non-FULL_RUN)
    // subset even though `cellsToRun()` above only yields `greedy vs survivor` cells by default (module doc)
    // — they feed `speedBoost`, not `matrixCells`, so they do not enlarge the main-matrix table CI prints.
    if (!FULL_RUN) {
      PAIRINGS.forEach((pairing, pairingIndex) => {
        if (pairing.id !== 'greedyVsGreedy') return;
        BUILDABLE_VARIANTS.forEach((variant, variantIndex) => {
          if (!SPEED_BOOST_VARIANT_IDS.includes(variant.id) || speedBoost[variant.id]) return;
          const settings = withOverrides(variant.overrides);
          const seedStart = seedStartFor(pairingIndex, variantIndex);
          const rounds = runCell(pairing, settings, seedStart, ROUNDS_PER_CELL);
          speedBoost[variant.id] = speedBoostDeepDive(rounds);
        });
      });
    }

    totalElapsedMs = performance.now() - start;

    console.log(
      `\nKS-07-03 Gate 1 bot matrix (${FULL_RUN ? 'FULL run' : 'CI default subset'}, ` +
        `${ROUNDS_PER_CELL} seeded rounds per cell, ${matrixCells.length} cells, ` +
        `${totalElapsedMs.toFixed(0)}ms total):`,
    );
    console.table(
      matrixCells.map(({ variantId, pairingId, stats }) => ({
        variant: variantId,
        pairing: pairingId,
        rounds: stats.rounds,
        'death before laser': `${stats.beforeLaserPct.toFixed(1)}%`,
        'death during laser': `${stats.duringLaserPct.toFixed(1)}%`,
        timeout: `${stats.timeoutPct.toFixed(1)}%`,
        'draw rate': `${stats.drawPct.toFixed(1)}%`,
        'mean survivor length': stats.meanSurvivorLength.toFixed(1),
        'meets §5?': stats.meetsTarget ? 'yes' : 'no',
      })),
    );
    console.table(
      Object.entries(speedBoost).map(([variantId, s]) => ({
        variant: variantId,
        'SPEED collector win rate': `${s.collectorWinRatePct.toFixed(1)}% (n=${s.collectorSample})`,
        'died <=1s after boost starts': `${s.diedWithin1sPct.toFixed(1)}% (n=${s.boostSamples})`,
        'control: dies within any 1s window': `${s.controlWithin1sPct.toFixed(1)}%`,
      })),
    );
    console.log(
      'PENDING (KS-07-01, SLOW target mode not yet built): ' +
        PENDING_SLOW_VARIANTS.map((v) => v.label).join(', '),
    );
    // JSON dump for transcribing a FULL run into docs/qa/playtests/gate1-bot-matrix.md's machine-readable
    // block (module doc) — gated on FULL_RUN so the ~120-line dump only ever appears on a deliberately-driven
    // `KS_TUNING_MATRIX_FULL=1` run, not on every contributor's/CI's default `npm run test:unit`: the default
    // subset's own consistency check (below) already reads the document back and compares against it, so
    // nothing in CI needs this dump printed to be useful — only a human regenerating the document does.
    if (FULL_RUN) {
      console.log(
        "\nKS-07-03 JSON (for the document's machine-readable block):",
        JSON.stringify(
          {
            roundsPerCell: ROUNDS_PER_CELL,
            cells: matrixCells.map(({ variantId, pairingId, stats }) => ({
              variant: variantId,
              pairing: pairingId,
              ...stats,
            })),
            speedBoost,
          },
          null,
          2,
        ),
      );
    }
  }, 180_000);

  it('KS-07-03 AC1: the matrix document exists and lists every buildable variant and the three pending SLOW rows', () => {
    const docPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../docs/qa/playtests/gate1-bot-matrix.md',
    );
    const doc = readFileSync(docPath, 'utf8');

    for (const variant of BUILDABLE_VARIANTS) {
      expect(doc).toContain(variant.label);
    }
    for (const variant of PENDING_SLOW_VARIANTS) {
      expect(doc).toContain(variant.label);
      // Each pending row must say why it has no numbers, per the tech lead's instruction not to quietly
      // drop them (KS-07-03 tech-lead note 3).
      expect(doc).toMatch(
        new RegExp(
          `${variant.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,200}KS-07-01`,
        ),
      );
    }
    expect(doc).toContain('PLAYTEST-SCRIPT');
  });

  it('KS-07-03 AC1: every computed cell is well-formed (percentages in range, buckets sum to 100%)', () => {
    for (const { stats } of matrixCells) {
      expect(stats.beforeLaserPct + stats.duringLaserPct + stats.timeoutPct).toBeCloseTo(100, 0);
      expect(stats.endsByDeathPct + stats.timeoutPct).toBeCloseTo(100, 0);
      for (const pct of [
        stats.beforeLaserPct,
        stats.duringLaserPct,
        stats.timeoutPct,
        stats.drawPct,
      ]) {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("KS-07-03: the freshly-computed cells match the committed document's machine-readable block", () => {
    const docPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../docs/qa/playtests/gate1-bot-matrix.md',
    );
    const doc = readFileSync(docPath, 'utf8');
    const match = doc.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(match).not.toBeNull();
    const recorded = JSON.parse(/** @type {RegExpMatchArray} */ (match)[1]);

    expect(recorded.roundsPerCell).toBe(ROUNDS_PER_CELL);

    /** @type {Map<string, any>} */
    const recordedByKey = new Map(
      recorded.cells.map((cell) => [`${cell.pairing}:${cell.variant}`, cell]),
    );
    for (const { variantId, pairingId, stats } of matrixCells) {
      const key = `${pairingId}:${variantId}`;
      const recordedCell = recordedByKey.get(key);
      expect(recordedCell, `document is missing cell ${key}`).toBeDefined();
      expect(recordedCell.beforeLaserPct).toBeCloseTo(stats.beforeLaserPct, 1);
      expect(recordedCell.duringLaserPct).toBeCloseTo(stats.duringLaserPct, 1);
      expect(recordedCell.timeoutPct).toBeCloseTo(stats.timeoutPct, 1);
      expect(recordedCell.drawPct).toBeCloseTo(stats.drawPct, 1);
      expect(recordedCell.meanSurvivorLength).toBeCloseTo(stats.meanSurvivorLength, 1);
      expect(recordedCell.meetsTarget).toBe(stats.meetsTarget);
    }

    for (const variantId of SPEED_BOOST_VARIANT_IDS) {
      const recordedEntry = recorded.speedBoost[variantId];
      const freshEntry = speedBoost[variantId];
      expect(recordedEntry, `document is missing speedBoost.${variantId}`).toBeDefined();
      expect(recordedEntry.collectorWinRatePct).toBeCloseTo(freshEntry.collectorWinRatePct, 1);
      expect(recordedEntry.diedWithin1sPct).toBeCloseTo(freshEntry.diedWithin1sPct, 1);
      expect(recordedEntry.controlWithin1sPct).toBeCloseTo(freshEntry.controlWithin1sPct, 1);
    }
  });

  it('KS-07-03: at least one Speed Boost sample exists for both the baseline and the alternative arm', () => {
    // Structural only (CLAUDE.md/stats.test.js convention: never a rate threshold) — the deep-dive's two
    // arms actually got exercised, not that their numbers hit any particular value.
    for (const variantId of SPEED_BOOST_VARIANT_IDS) {
      expect(speedBoost[variantId].boostSamples).toBeGreaterThan(0);
    }
  });
});
