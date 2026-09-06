// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { CAUSES } from '../../src/core/collisions.js';
import { END_REASONS, EVENTS, PHASES, RESULTS } from '../../src/core/events.js';
import { DIRECTIONS } from '../../src/core/grid.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';
import { greedyBot } from './bots/greedyBot.js';
import { survivorBot } from './bots/survivorBot.js';
import { runRound } from './harness.js';

/**
 * Closing-phase statistics and fairness (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-04,
 * `QA-STRATEGY §4`, `docs/qa/PLAYTEST-SCRIPT.md §5`'s "Bot stat" row).
 *
 * `tests/sim/stats.test.js` is Sprint 02's control: its bots are deliberately **not** laser-aware, so its
 * "survivor vs survivor" row is what two snakes that ignore the beams do (currently 0 % before 0:30, 100 %
 * during lasers, 100 % draws — both snakes are killed by the same step every time). This file's `survivorBot`
 * import is the laser-aware one from this same ticket (`tests/sim/bots/survivorBot.js`), so the numbers below
 * are the *measurement*, not the control, and are read against
 * `docs/qa/reports/2026-09-05-pre-sprint-validation.md §1`'s pre-sprint Python model.
 *
 * Two rules this file is not allowed to break (`CLAUDE.md` "the never list", restated in the ticket's tech
 * lead note):
 *
 * 1. **Only AC1's 85 % is an assertable target.** It is quoted verbatim from `PLAYTEST-SCRIPT §5`'s "Bot stat"
 *    row, not invented here. Everything else in the table (draw rate, timing split, deaths by cause) is a
 *    design measurement, printed for Fable to read at a Playtest Gate, and is never asserted against a
 *    threshold — `stats.test.js`'s module doc makes the case for this at length and it applies here unchanged.
 *    If the measured numbers do not move the way the design doc predicts, that is a finding for the sprint QA
 *    report, not a reason to tune `survivorBot` until they match.
 * 2. **AC2 is an engine invariant, not a measurement**, and is checked against the full 1 500-round event
 *    stream this file already produces for the table (`checkLaserCauseInsetInvariant` below), not only against
 *    a hand-built fixture: a `LASER` death recorded while `inset` is still 0 would mean `round.js`'s
 *    `deadlyCause` mislabelled a wall death, which is a bug the fixtures alone would not be guaranteed to hit.
 */

/** @typedef {import('../../src/core/round.js').SimEvent} SimEvent */

const ROUNDS_PER_PAIRING = 500;
// Distinct from tests/sim/stats.test.js's own SEED_OFFSET (10 000/20 000/30 000/40 000) so the two files never
// happen to run the exact same seeds through differently-behaved bots.
const SEED_OFFSET = {
  survivorVsSurvivor: 110_000,
  greedyVsSurvivor: 120_000,
  greedyVsGreedy: 130_000,
};

/**
 * Walks one round's event log maintaining the `inset` the lasers had at each point in the log, and records
 * every `SNAKE_DIED` with cause `LASER` seen while `inset` was still 0 (KS-04-04 AC2). `LASER_STEP` always
 * precedes the `SNAKE_DIED` events it causes in the same tick (`round.js`'s `updateLasers`/`killHeadsInDeadZone`
 * order, and the ordinary movement-into-the-dead-zone path resolves against the *already-updated* inset for
 * that tick too — `KS-04-01 AC3`), so a single forward pass over the log in order is enough to know the inset
 * in effect at every `SNAKE_DIED`.
 *
 * @param {SimEvent[]} events
 * @param {SimEvent[]} violations - appended to in place
 */
function checkLaserCauseInsetInvariant(events, violations) {
  let inset = 0;
  for (const event of events) {
    if (event.type === EVENTS.LASER_STEP) {
      inset = /** @type {number} */ (/** @type {any} */ (event).inset);
    } else if (
      event.type === EVENTS.SNAKE_DIED &&
      /** @type {any} */ (event).cause === CAUSES.LASER &&
      inset === 0
    ) {
      violations.push(event);
    }
  }
}

/**
 * Runs `n` seeded rounds of one bot pairing and reduces them to the `QA-STRATEGY §4` statistics plus deaths
 * by cause (KS-04-04 spec: "report... deaths by cause").
 *
 * @param {import('./harness.js').Bot} bot1
 * @param {import('./harness.js').Bot} bot2
 * @param {number} seedStart
 * @param {number} n
 * @param {SimEvent[]} violations - shared accumulator for {@link checkLaserCauseInsetInvariant}
 * @returns {{
 *   n: number,
 *   beforeThirtyPct: number,
 *   thirtyToZeroPct: number,
 *   timeoutPct: number,
 *   endsByDeathPct: number,
 *   drawPct: number,
 *   meanLongestSnake: number,
 *   deathsByCause: Record<string, number>,
 *   elapsedMs: number,
 * }}
 */
function runPairing(bot1, bot2, seedStart, n, violations) {
  // "0:30 seconds remaining" (DESIGN-DECISIONS §2.4) as elapsed simulated time.
  const thirtySecondsRemainingElapsed = SETTINGS.roundDuration - 30;

  let beforeThirty = 0;
  let thirtyToZero = 0;
  let timeout = 0;
  let draws = 0;
  let longestSum = 0;
  /** @type {Record<string, number>} */
  const deathsByCause = { WALL: 0, LASER: 0, SELF: 0, BODY: 0, HEAD_ON: 0 };

  const start = performance.now();
  for (let i = 0; i < n; i += 1) {
    const seed = seedStart + i;
    const round = runRound({ seed, bots: [bot1, bot2] });

    // Sanity only (CLAUDE.md "Never skip... a test"): every round produced a recorded reason and a result in
    // the known vocabulary. No win-rate or draw-rate assertion belongs here — see the module doc.
    expect(Object.values(END_REASONS)).toContain(round.reason);
    expect(Object.values(RESULTS)).toContain(round.result);

    if (round.reason === END_REASONS.TIMEOUT) {
      timeout += 1;
    } else if (round.endedAt < thirtySecondsRemainingElapsed) {
      beforeThirty += 1;
    } else {
      thirtyToZero += 1;
    }
    if (round.result === RESULTS.DRAW) draws += 1;
    longestSum += Math.max(...round.lengths);
    for (const death of round.cause) {
      deathsByCause[death.cause] = (deathsByCause[death.cause] ?? 0) + 1;
    }

    checkLaserCauseInsetInvariant(round.events, violations);
  }
  const elapsedMs = performance.now() - start;

  return {
    n,
    beforeThirtyPct: (100 * beforeThirty) / n,
    thirtyToZeroPct: (100 * thirtyToZero) / n,
    timeoutPct: (100 * timeout) / n,
    endsByDeathPct: (100 * (n - timeout)) / n,
    drawPct: (100 * draws) / n,
    meanLongestSnake: longestSum / n,
    deathsByCause,
    elapsedMs,
  };
}

describe('KS-04-04 closing-phase statistics and fairness', () => {
  /** @type {ReturnType<typeof runPairing>} */
  let survivorVsSurvivor;
  /** @type {ReturnType<typeof runPairing>} */
  let greedyVsSurvivor;
  /** @type {ReturnType<typeof runPairing>} */
  let greedyVsGreedy;
  /** @type {SimEvent[]} */
  let violations;
  let totalElapsedMs;

  beforeAll(() => {
    violations = [];
    const start = performance.now();
    // All three pairings the sprint file's QA plan and PLAYTEST-SCRIPT §5 care about, 500 seeded rounds each
    // (KS-04-04 spec: "Run 500 seeded rounds for each bot pairing"), computed once and shared by every it()
    // below so the table is printed exactly once and AC1/AC2 read the same 1 500-round run they are named
    // after, rather than each re-running it.
    survivorVsSurvivor = runPairing(
      survivorBot,
      survivorBot,
      SEED_OFFSET.survivorVsSurvivor,
      ROUNDS_PER_PAIRING,
      violations,
    );
    greedyVsSurvivor = runPairing(
      greedyBot,
      survivorBot,
      SEED_OFFSET.greedyVsSurvivor,
      ROUNDS_PER_PAIRING,
      violations,
    );
    greedyVsGreedy = runPairing(
      greedyBot,
      greedyBot,
      SEED_OFFSET.greedyVsGreedy,
      ROUNDS_PER_PAIRING,
      violations,
    );
    totalElapsedMs = performance.now() - start;

    /** @type {Record<string, string | number>[]} */
    const rows = [
      { name: 'survivor vs survivor', stats: survivorVsSurvivor },
      { name: 'greedy vs survivor', stats: greedyVsSurvivor },
      { name: 'greedy vs greedy', stats: greedyVsGreedy },
    ].map(({ name, stats }) => ({
      pairing: name,
      rounds: stats.n,
      'ends before 0:30': `${stats.beforeThirtyPct.toFixed(1)}%`,
      'ends 0:30-0:00': `${stats.thirtyToZeroPct.toFixed(1)}%`,
      'ends by timeout': `${stats.timeoutPct.toFixed(1)}%`,
      'ends by death': `${stats.endsByDeathPct.toFixed(1)}%`,
      'draw rate': `${stats.drawPct.toFixed(1)}%`,
      'avg survivor length': stats.meanLongestSnake.toFixed(1),
      'deaths WALL': stats.deathsByCause.WALL,
      'deaths LASER': stats.deathsByCause.LASER,
      'deaths SELF': stats.deathsByCause.SELF,
      'deaths BODY': stats.deathsByCause.BODY,
      'deaths HEAD_ON': stats.deathsByCause.HEAD_ON,
    }));

    console.log(
      `\nKS-04-04 closing-phase statistics (laser-aware survivorBot; ${ROUNDS_PER_PAIRING} seeded rounds per ` +
        `pairing, ${totalElapsedMs.toFixed(0)}ms total):`,
    );
    console.table(rows);
    console.log(
      'Target (PLAYTEST-SCRIPT §5): greedy vs survivor ends by death >= 85%, draw rate <= 3% (not asserted ' +
        'here as an engine contract per QA-STRATEGY/stats.test.js). Pre-sprint model ' +
        '(docs/qa/reports/2026-09-05-pre-sprint-validation.md §1, 300 rounds each): survivor vs survivor 0% ' +
        'before 0:30 / 98% during lasers / 2% timeout / 10.3% draws; greedy vs survivor 61% / 39% / 0% / 1.0%; ' +
        'greedy vs greedy 91% / 9% / 0% / 1.7%. A large deviation is a finding for the sprint QA report, not ' +
        'something to tune survivorBot to match.',
    );
  }, 120_000);

  describe('AC1 greedy vs survivor ends by death', () => {
    it('KS-04-04 AC1: greedy vs survivor, 500 rounds, >= 85% end by death (not timeout)', () => {
      expect(greedyVsSurvivor.endsByDeathPct).toBeGreaterThanOrEqual(85);
    });

    it('KS-04-04 AC1: every row of the table adds to 100% of the rounds actually run', () => {
      for (const stats of [survivorVsSurvivor, greedyVsSurvivor, greedyVsGreedy]) {
        expect(stats.beforeThirtyPct + stats.thirtyToZeroPct + stats.timeoutPct).toBeCloseTo(100, 0);
        expect(stats.endsByDeathPct + stats.timeoutPct).toBeCloseTo(100, 0);
      }
    });
  });

  describe('AC2 a LASER cause never comes with inset 0', () => {
    it('KS-04-04 AC2: zero SNAKE_DIED(LASER) events occur while inset === 0, across all 1500 rounds', () => {
      expect(violations).toEqual([]);
    });

    it('KS-04-04 AC2: at least one LASER death actually happened, so the invariant was exercised', () => {
      // A vacuously-true AC2 (no LASER deaths at all, in any pairing) would mean the check above never had
      // anything to say no to. This is the ticket's own sanity backstop on that.
      const totalLaserDeaths =
        survivorVsSurvivor.deathsByCause.LASER +
        greedyVsSurvivor.deathsByCause.LASER +
        greedyVsGreedy.deathsByCause.LASER;
      expect(totalLaserDeaths).toBeGreaterThan(0);
    });
  });
});

/**
 * Which laser-death path each fixture pins (Opus's PR #69 review): `round.js` has *two* ways a `SNAKE_DIED`
 * can carry cause `LASER`. `killHeadsInDeadZone` kills a head already **standing** in a cell the beam has
 * just swept, before that snake's own step (if any) is even resolved this tick; `deadlyCause`, inside the
 * ordinary per-tick step resolution, kills a head that **moves into** a cell the same `LASER_STEP` just made
 * deadly. KS-04-05's fuzz invariants (`tests/sim/laserFuzz.test.js`) pass even with `killHeadsInDeadZone`
 * deleted, and 462 of 532 laser deaths in a full run take that path, so a replay suite that only ever pins
 * the "moving into" case would leave the common path completely unpinned. Each fixture below is named for,
 * and asserted against, exactly one of the two:
 *
 * - `laser-inside-survives.json` — neither path: the head is one cell inside the new safe square and the
 *   step passes it by.
 * - `laser-boundary-dies.json` — **standing**: the head is already on the cell the beam sweeps.
 * - `laser-turns-into-beam.json` — **moving**: the head steps into a cell the same tick's `LASER_STEP` just
 *   made deadly (KS-04-01 AC3's "head moving into x = inset−1 dies with LASER", as a whole-round replay).
 * - `laser-both-heads-draw.json` — **standing**, both snakes: preferred over the moving variant per the
 *   review, since "both heads killed by the same step" reads most naturally as the beam closing over both.
 */

describe('KS-04-04 AC3 laser replay fixtures', () => {
  const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'replays');

  /** A bot that never decides anything; the fixtures are driven entirely by their recorded `inputs`. */
  function noopBot() {
    return null;
  }

  /**
   * Loads one `tests/sim/replays/laser-*.json` fixture and replays it exactly as `replay.test.js` does
   * (`tests/sim/replays/README.md`), returning both the fixture and the live result so a test here can assert
   * the scenario the fixture is *named* for, not only that it replays byte-for-byte — `replay.test.js` already
   * covers the latter generically for every file in the directory, this file's own AC3 tests are about the
   * specific scenarios the ticket (and the review above) asks for.
   *
   * @param {string} file
   */
  function replayLaserFixture(file) {
    const replay = JSON.parse(readFileSync(join(REPLAYS_DIR, file), 'utf8'));
    const settings = replay.settingsOverrides ? withOverrides(replay.settingsOverrides) : SETTINGS;
    const outcome = runRound({
      seed: replay.seed,
      bots: [noopBot, noopBot],
      settings,
      inputLog: replay.inputs,
    });
    return { replay, outcome, settings };
  }

  /**
   * Steps a *fresh* `RoundSimulation` — driven by the same seed, settings and input log as a fixture, but not
   * through `runRound` — up to (not through) `targetTick`, and returns the head cell of every player at that
   * point. This is the pin for the standing/moving distinction above: it answers "where was the head, one
   * tick before the beam swept" independently of the fixture's own recorded `expectedEvents`, so a test that
   * compares this against a `SNAKE_DIED` cell is checking the *mechanism*, not just replaying a number back at
   * itself.
   *
   * @param {import('../../src/core/settings.js').Settings} settings
   * @param {number} seed
   * @param {{t: number, player: string, dir: 'UP'|'DOWN'|'LEFT'|'RIGHT'}[]} inputs
   * @param {number} targetTick
   * @returns {Record<string, import('../../src/core/grid.js').Cell>}
   */
  function headsBeforeTick(settings, seed, inputs, targetTick) {
    const sim = new RoundSimulation({ settings, seed, players: [{ id: 'p1' }, { id: 'p2' }] });
    const pending = inputs
      .map((entry) => ({ ...entry, tick: Math.round(entry.t * settings.simHz) }))
      .sort((a, b) => a.tick - b.tick);
    const dt = 1 / settings.simHz;
    while (sim.tick < targetTick && sim.phase === PHASES.PLAYING) {
      while (pending.length > 0 && pending[0].tick <= sim.tick) {
        const input = /** @type {any} */ (pending.shift());
        sim.applyInput(input.player, DIRECTIONS[input.dir]);
      }
      sim.advance(dt);
    }
    return Object.fromEntries(sim.snakes.map((snake) => [snake.id, { ...snake.head }]));
  }

  it('KS-04-04 AC3: laser-inside-survives.json — a head one cell inside the safe square survives the step', () => {
    const { replay, outcome } = replayLaserFixture('laser-inside-survives.json');
    expect(outcome.events.some((e) => e.type === EVENTS.LASER_STEP)).toBe(true);
    expect(outcome.events.some((e) => e.type === EVENTS.SNAKE_DIED)).toBe(false);
    expect(outcome.reason).toBe(END_REASONS.TIMEOUT);
    expect(outcome.events).toEqual(replay.expectedEvents);
  });

  it('KS-04-04 AC3: laser-boundary-dies.json — a head already standing on the boundary dies when the beam sweeps it (killHeadsInDeadZone)', () => {
    const { replay, outcome, settings } = replayLaserFixture('laser-boundary-dies.json');
    expect(outcome.cause).toEqual([{ snakeId: 'p1', cause: CAUSES.LASER }]);
    expect(outcome.reason).toBe(END_REASONS.DEATH);
    expect(outcome.result).toBe(RESULTS.P2_WIN);

    const step = /** @type {any} */ (outcome.events.find((e) => e.type === EVENTS.LASER_STEP));
    const died = /** @type {any} */ (outcome.events.find((e) => e.type === EVENTS.SNAKE_DIED));
    // The pin: p1's head, one tick before the beam stepped, already equals the death cell — it was standing
    // there, not moving into it this tick (contrast laser-turns-into-beam.json below).
    const before = headsBeforeTick(settings, replay.seed, replay.inputs, step.tick - 1);
    expect(before.p1).toEqual(died.cell);
    expect(died.tick).toBe(step.tick);

    expect(outcome.events).toEqual(replay.expectedEvents);
  });

  it('KS-04-04 AC3: laser-turns-into-beam.json — a head moving into the new dead zone dies the same tick the beam steps', () => {
    const { replay, outcome, settings } = replayLaserFixture('laser-turns-into-beam.json');
    expect(outcome.cause).toEqual([{ snakeId: 'p1', cause: CAUSES.LASER }]);
    expect(outcome.reason).toBe(END_REASONS.DEATH);
    expect(outcome.result).toBe(RESULTS.P2_WIN);

    const step = /** @type {any} */ (outcome.events.find((e) => e.type === EVENTS.LASER_STEP));
    const died = /** @type {any} */ (outcome.events.find((e) => e.type === EVENTS.SNAKE_DIED));
    // The pin, the mirror of the previous test: p1's head, one tick before the beam stepped, is NOT yet the
    // death cell — it moves into it as part of this very tick's step, one cell away from where it died.
    const before = headsBeforeTick(settings, replay.seed, replay.inputs, step.tick - 1);
    expect(before.p1).not.toEqual(died.cell);
    expect(died.tick).toBe(step.tick);

    expect(outcome.events).toEqual(replay.expectedEvents);
  });

  it('KS-04-04 AC3: laser-both-heads-draw.json — both heads already standing when the same step sweeps both is a DRAW', () => {
    const { replay, outcome, settings } = replayLaserFixture('laser-both-heads-draw.json');
    expect(outcome.cause).toEqual([
      { snakeId: 'p1', cause: CAUSES.LASER },
      { snakeId: 'p2', cause: CAUSES.LASER },
    ]);
    expect(outcome.result).toBe(RESULTS.DRAW);
    expect(outcome.reason).toBe(END_REASONS.DEATH);

    const step = /** @type {any} */ (outcome.events.find((e) => e.type === EVENTS.LASER_STEP));
    const before = headsBeforeTick(settings, replay.seed, replay.inputs, step.tick - 1);
    for (const died of /** @type {any[]} */ (
      outcome.events.filter((e) => e.type === EVENTS.SNAKE_DIED)
    )) {
      expect(before[died.snakeId]).toEqual(died.cell);
    }

    expect(outcome.events).toEqual(replay.expectedEvents);
  });
});
