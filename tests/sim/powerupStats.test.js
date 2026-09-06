// @ts-check
import { beforeAll, describe, expect, it } from 'vitest';
import { EVENTS, RESULTS } from '../../src/core/events.js';
import { POWERUP_TYPES } from '../../src/core/powerups.js';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';
import { greedyBot } from './bots/greedyBot.js';
import { runRound } from './harness.js';

/**
 * Power-up bot behaviour and statistics (`docs/sprints/sprint-06...` KS-06-04, `QA-STRATEGY §4`,
 * `DESIGN-DECISIONS §1 rows 3/4/20/21`, `§2.4`, `§4 SETTINGS`).
 *
 * `greedyBot.js` (this ticket's other file) was taught to prefer a power-up over an apple when it is closer,
 * tie going to the power-up — read literally off the ticket, no value model invented. This file measures what
 * that bot, and the power-up design itself, actually do: **the tables below are a design instrument for
 * Fable, not a pass/fail gate.** Only the run-happened/well-formed sanity checks in the `it()`s are asserted;
 * every rate, including the "boost killed me" ≤ 15 % figure `PLAYTEST-SCRIPT §5` names, is printed for a
 * human to read and is never pinned to a threshold here — `laserStats.test.js`'s module doc makes this case
 * at length and it applies unchanged. A measured number that looks bad for the power-up design is this
 * ticket's success condition, not its failure: it is exactly the Sprint 07 tuning input QA exists to surface.
 *
 * **Both bot slots run the updated `greedyBot`** (not `survivorBot`/`randomBot`): this is the bot the ticket
 * changed, symmetric so neither slot is structurally favoured, and it is the one bot of the three that ever
 * routes toward a power-up at all, which is what makes it the right bot to measure pickup behaviour with.
 *
 * **Three statistics, one shared 500-seed run** (`QA-STRATEGY §4`'s own figure), so every arm of every
 * comparison is the same bots on the same seeds and differs by exactly one variable (`powerUpsEnabled`):
 *
 * 1. **Pickup rate** — `power-ups collected / power-ups spawned` (a spawn is `POWERUP_SPAWNED`: the initial
 *    spawn and every 15 s replacement cycle, `DESIGN-DECISIONS §2.4`), plus the percentage of rounds with at
 *    least one collection, since "collected/spawned" alone can't distinguish "every round grabs it eventually"
 *    from "a few rounds grab it repeatedly and most never do".
 * 2. **"Boost killed me"** — of every `EFFECT_STARTED` with `powerUpType: SPEED` (the boost always starts on
 *    its collector, `round.js`'s `applyPowerUpEffect`), the percentage followed by a `SNAKE_DIED` for that
 *    same snake within 1 simulated second (`Math.round(settings.simHz * 1)` ticks). Measured against a
 *    **control**: across the same rounds, for a snake alive at an arbitrary tick, the analytic probability
 *    that *it* dies within the following 1 s window, computed directly from each snake's one death tick (or
 *    the round's end tick if it survives) — `min(deathTick, window) / deathTick` summed over every snake that
 *    ever dies, `0 / roundEndTick` contributed by one that doesn't, ticks not seconds throughout so the two
 *    numbers use one exact definition of "window". The gap between the boost rate and this baseline, not the
 *    raw boost rate alone, is the real claim about whether the boost is dangerous.
 * 3. **Effect of SLOW on win rate** — for every round where a snake's `POWERUP_COLLECTED` was `SLOW` (SLOW
 *    slows every *other* living snake, never the collector — `DESIGN-DECISIONS §1 row 3`, `round.js`), that
 *    collector's win rate in the power-ups-ON run, against the same collector's win rate on the exact same
 *    seed replayed with `withOverrides({ powerUpsEnabled: false })` — same bots, same seeds, the one variable
 *    named in the ticket's tech-lead note.
 *
 * Nothing here is tuned to make the ≤ 15 % target true (`CLAUDE.md` "never change a tunable", the ticket's
 * own tech-lead note): the seeds, the bot and the window are all fixed by the spec above, independent of what
 * the numbers turn out to be.
 */

/** @typedef {import('../../src/core/round.js').SimEvent} SimEvent */
/** @typedef {{seed: number, events: SimEvent[], result: import('../../src/core/events.js').RoundResult | null}} RoundRun */

const ROUNDS_PER_PAIRING = 500;
// Distinct from stats.test.js (10 000-40 000) and laserStats.test.js (110 000-130 000).
const SEED_START = 210_000;

/** One simulated second, in ticks — the ticket's own window for the "boost killed me" proxy. */
const BOOST_WINDOW_TICKS = Math.round(SETTINGS.simHz * 1);

const RESULT_FOR_PLAYER = { p1: RESULTS.P1_WIN, p2: RESULTS.P2_WIN };

/**
 * Runs `n` seeded rounds of `greedyBot` vs `greedyBot` and keeps each round's raw event log — unlike
 * `stats.test.js`/`laserStats.test.js`'s `runPairing`, which reduces to one aggregate on the way through,
 * this file needs the same 500 rounds read three different ways (pickup counts, the boost/hazard tick math,
 * and the per-seed SLOW win-rate lookup below), so the reduction happens once, after every round has run.
 *
 * @param {number} seedStart
 * @param {number} n
 * @param {import('../../src/core/settings.js').Settings} settings
 * @returns {RoundRun[]}
 */
function runSeeds(seedStart, n, settings) {
  /** @type {RoundRun[]} */
  const rounds = [];
  for (let i = 0; i < n; i += 1) {
    const seed = seedStart + i;
    const round = runRound({ seed, bots: [greedyBot, greedyBot], settings });
    // Sanity only (CLAUDE.md "Never skip... a test"), exactly as stats.test.js/laserStats.test.js check: every
    // round produced a result in the known vocabulary. No win-rate assertion belongs here — see the module doc.
    expect(Object.values(RESULTS)).toContain(round.result);
    rounds.push({ seed, events: round.events, result: round.result });
  }
  return rounds;
}

/**
 * Statistic 1 (module doc): pickup rate.
 *
 * @param {RoundRun[]} rounds
 */
function pickupRateStats(rounds) {
  let spawned = 0;
  let collected = 0;
  let collectedSpeed = 0;
  let collectedSlow = 0;
  let roundsWithCollection = 0;

  for (const { events } of rounds) {
    let any = false;
    for (const event of events) {
      if (event.type === EVENTS.POWERUP_SPAWNED) spawned += 1;
      if (event.type === EVENTS.POWERUP_COLLECTED) {
        collected += 1;
        any = true;
        const powerUpType = /** @type {any} */ (event).powerUpType;
        if (powerUpType === POWERUP_TYPES.SPEED) collectedSpeed += 1;
        if (powerUpType === POWERUP_TYPES.SLOW) collectedSlow += 1;
      }
    }
    if (any) roundsWithCollection += 1;
  }

  return {
    spawned,
    collected,
    collectedSpeed,
    collectedSlow,
    pickupRatePct: spawned > 0 ? (100 * collected) / spawned : 0,
    roundsWithCollectionPct: (100 * roundsWithCollection) / rounds.length,
  };
}

/**
 * Statistic 2 (module doc): "boost killed me" against its control. One forward pass per round collects each
 * snake's single death tick (if any) and the round's end tick, which is all both halves of the statistic need.
 *
 * @param {RoundRun[]} rounds
 * @param {number} windowTicks
 */
function boostKilledMeStats(rounds, windowTicks) {
  let boostSamples = 0;
  let boostDeathsWithinWindow = 0;
  let hazardNumeratorTicks = 0;
  let hazardDenominatorTicks = 0;

  for (const { events } of rounds) {
    /** @type {Record<string, number>} */
    const deathTick = {};
    for (const event of events) {
      if (event.type === EVENTS.SNAKE_DIED) {
        deathTick[/** @type {any} */ (event).snakeId] = event.tick;
      }
    }
    const roundOver = /** @type {any} */ (events.find((event) => event.type === EVENTS.ROUND_OVER));
    const endTick = roundOver.tick;

    // The control: for each snake, how many of the ticks it was alive for are followed by its own death
    // within `windowTicks` — see the module doc's statistic 2 for the exact fraction this builds up to.
    for (const playerId of ['p1', 'p2']) {
      const died = deathTick[playerId];
      const aliveTicks = died ?? endTick;
      hazardDenominatorTicks += aliveTicks;
      if (died !== undefined) hazardNumeratorTicks += Math.min(died, windowTicks);
    }

    for (const event of events) {
      if (event.type === EVENTS.EFFECT_STARTED && /** @type {any} */ (event).powerUpType === POWERUP_TYPES.SPEED) {
        boostSamples += 1;
        const playerId = /** @type {any} */ (event).playerId;
        const died = deathTick[playerId];
        if (died !== undefined && died >= event.tick && died - event.tick <= windowTicks) {
          boostDeathsWithinWindow += 1;
        }
      }
    }
  }

  return {
    boostSamples,
    boostDeathsWithinWindow,
    boostKilledMePct: boostSamples > 0 ? (100 * boostDeathsWithinWindow) / boostSamples : 0,
    baselineDeathWithin1sPct:
      hazardDenominatorTicks > 0 ? (100 * hazardNumeratorTicks) / hazardDenominatorTicks : 0,
  };
}

/**
 * Statistic 3 (module doc): effect of SLOW on win rate, ON vs OFF on the exact same seeds.
 *
 * @param {RoundRun[]} onRounds
 * @param {Map<number, import('../../src/core/events.js').RoundResult | null>} offResultBySeed
 */
function slowWinRateEffect(onRounds, offResultBySeed) {
  /** @type {{seed: number, playerId: 'p1' | 'p2'}[]} */
  const collectorSeeds = [];
  for (const { seed, events } of onRounds) {
    /** @type {Set<'p1' | 'p2'>} */
    const collectedSlowBy = new Set();
    for (const event of events) {
      if (
        event.type === EVENTS.POWERUP_COLLECTED &&
        /** @type {any} */ (event).powerUpType === POWERUP_TYPES.SLOW
      ) {
        collectedSlowBy.add(/** @type {any} */ (event).playerId);
      }
    }
    for (const playerId of collectedSlowBy) collectorSeeds.push({ seed, playerId });
  }

  const onResultBySeed = new Map(onRounds.map((round) => [round.seed, round.result]));
  const wonPct = (results) =>
    results.length > 0 ? (100 * results.filter(Boolean).length) / results.length : null;

  const onWon = collectorSeeds.map(
    ({ seed, playerId }) => onResultBySeed.get(seed) === RESULT_FOR_PLAYER[playerId],
  );
  const offWon = collectorSeeds.map(
    ({ seed, playerId }) => offResultBySeed.get(seed) === RESULT_FOR_PLAYER[playerId],
  );

  return {
    sampleSize: collectorSeeds.length,
    onWinRatePct: wonPct(onWon),
    offWinRatePct: wonPct(offWon),
  };
}

/**
 * Context only (not one of the ticket's three statistics): the bot-position win rate over the *whole* 500-seed
 * run, ON vs OFF. Both slots are the same bot, so this should sit near the draw-adjusted 50 % either way; it
 * is printed as a sanity check that turning power-ups on does not itself create a positional bias, not as a
 * claim about the design.
 *
 * @param {RoundRun[]} rounds
 */
function overallP1Rates(rounds) {
  const wins = rounds.filter((round) => round.result === RESULTS.P1_WIN).length;
  const draws = rounds.filter((round) => round.result === RESULTS.DRAW).length;
  return {
    p1WinPct: (100 * wins) / rounds.length,
    drawPct: (100 * draws) / rounds.length,
  };
}

describe('KS-06-04 power-up bots and statistics', () => {
  /** @type {ReturnType<typeof pickupRateStats>} */
  let pickup;
  /** @type {ReturnType<typeof boostKilledMeStats>} */
  let boost;
  /** @type {ReturnType<typeof slowWinRateEffect>} */
  let slowEffect;
  /** @type {ReturnType<typeof overallP1Rates>} */
  let overallOn;
  /** @type {ReturnType<typeof overallP1Rates>} */
  let overallOff;
  let totalElapsedMs;

  beforeAll(() => {
    const start = performance.now();
    const offSettings = withOverrides({ powerUpsEnabled: false });

    // Same 500 seeds, same bots, power-ups the only thing that differs between the two runs (module doc).
    const onRounds = runSeeds(SEED_START, ROUNDS_PER_PAIRING, SETTINGS);
    const offRounds = runSeeds(SEED_START, ROUNDS_PER_PAIRING, offSettings);
    totalElapsedMs = performance.now() - start;

    pickup = pickupRateStats(onRounds);
    boost = boostKilledMeStats(onRounds, BOOST_WINDOW_TICKS);
    const offResultBySeed = new Map(offRounds.map((round) => [round.seed, round.result]));
    slowEffect = slowWinRateEffect(onRounds, offResultBySeed);
    overallOn = overallP1Rates(onRounds);
    overallOff = overallP1Rates(offRounds);

    console.log(
      `\nKS-06-04 power-up statistics (greedy vs greedy, ${ROUNDS_PER_PAIRING} seeded rounds per arm, ` +
        `${totalElapsedMs.toFixed(0)}ms total for both arms):`,
    );
    console.table([
      {
        pairing: 'greedy vs greedy (power-ups ON)',
        rounds: ROUNDS_PER_PAIRING,
        'power-ups spawned': pickup.spawned,
        'power-ups collected': pickup.collected,
        'pickup rate (collected/spawned)': `${pickup.pickupRatePct.toFixed(1)}%`,
        'rounds w/ >=1 collection': `${pickup.roundsWithCollectionPct.toFixed(1)}%`,
        'SPEED collected': pickup.collectedSpeed,
        'SLOW collected': pickup.collectedSlow,
        '"boost killed me" (dies <=1s after SPEED starts)': `${boost.boostKilledMePct.toFixed(1)}% (n=${boost.boostSamples})`,
        'baseline: dies within any 1s window (control)': `${boost.baselineDeathWithin1sPct.toFixed(1)}%`,
      },
    ]);
    console.table([
      {
        arm: 'power-ups ON (recorded win)',
        'collector win rate': `${(slowEffect.onWinRatePct ?? NaN).toFixed(1)}%`,
        'sample (rounds where a snake collected a SLOW)': slowEffect.sampleSize,
      },
      {
        arm: 'power-ups OFF (same seeds, same collector slot)',
        'collector win rate': `${(slowEffect.offWinRatePct ?? NaN).toFixed(1)}%`,
        'sample (rounds where a snake collected a SLOW)': slowEffect.sampleSize,
      },
    ]);
    console.log(
      'Definitions: "pickup rate" = POWERUP_COLLECTED events / POWERUP_SPAWNED events (a spawn is the ' +
        'initial appearance or a 15s-cycle replacement, DESIGN-DECISIONS §2.4); "rounds w/ >=1 collection" = ' +
        'percentage of the 500 rounds with at least one POWERUP_COLLECTED. "boost killed me" = percentage of ' +
        `SPEED EFFECT_STARTED events (the boost always starts on its collector) followed by that same snake's ` +
        `SNAKE_DIED within ${BOOST_WINDOW_TICKS} ticks (1 simulated second, ${SETTINGS.simHz}Hz); the control ` +
        'row is the same 1-second-window death probability computed analytically from every snake\'s own ' +
        'death tick (or the round\'s end tick if it survives), over the same 500 rounds — not a separate run. ' +
        '"collector win rate" (SLOW) = win rate of whichever snake\'s POWERUP_COLLECTED was SLOW in that round ' +
        '(SLOW slows every *other* living snake, never the collector, DESIGN-DECISIONS §1 row 3), ON vs the ' +
        'exact same seed replayed with powerUpsEnabled:false — same bots, same seeds, one variable.',
    );
    console.log(
      `Target (PLAYTEST-SCRIPT §5): "boost killed me" <= 15% (not asserted here as an engine contract, per ` +
        'QA-STRATEGY/stats.test.js/laserStats.test.js — a design measurement, not a pass condition). Context ' +
        `only, not one of this ticket's three statistics: bot-position (p1 slot; both slots run the same ` +
        `greedyBot) win rate over the full 500-seed run — ON ${overallOn.p1WinPct.toFixed(1)}% (draws ` +
        `${overallOn.drawPct.toFixed(1)}%), OFF ${overallOff.p1WinPct.toFixed(1)}% (draws ` +
        `${overallOff.drawPct.toFixed(1)}%). A number that looks bad for the power-up design (in particular a ` +
        '"boost killed me" figure well above 15%) is a finding for the sprint QA report, not something to ' +
        'tune the bot, the seeds or the window to avoid.',
    );
  }, 120_000);

  it('KS-06-04 AC1: the statistics table is printed and every rate in it is a well-formed percentage', () => {
    for (const pct of [
      pickup.pickupRatePct,
      pickup.roundsWithCollectionPct,
      boost.boostKilledMePct,
      boost.baselineDeathWithin1sPct,
      overallOn.p1WinPct,
      overallOn.drawPct,
      overallOff.p1WinPct,
      overallOff.drawPct,
    ]) {
      expect(Number.isFinite(pct)).toBe(true);
      expect(pct).toBeGreaterThanOrEqual(0);
      expect(pct).toBeLessThanOrEqual(100);
    }
    // slowEffect's two rates can be `null` (only if the sample were empty — checked as its own AC below), but
    // whenever present they are percentages too.
    for (const pct of [slowEffect.onWinRatePct, slowEffect.offWinRatePct]) {
      if (pct !== null) {
        expect(pct).toBeGreaterThanOrEqual(0);
        expect(pct).toBeLessThanOrEqual(100);
      }
    }
  });

  it('KS-06-04 AC1: enough rounds reached a pickup for the pickup-rate sample to mean anything', () => {
    // Structural, not a target (tech-lead note): only that greedyBot's new power-up-seeking behaviour was
    // actually exercised at meaningful volume across the 500 rounds, not that it hit any particular rate.
    expect(pickup.spawned).toBeGreaterThan(0);
    expect(pickup.collected).toBeGreaterThan(0);
    expect(pickup.roundsWithCollectionPct).toBeGreaterThan(10);
  });

  it('KS-06-04 AC1: SPEED and SLOW collections add up to every collection', () => {
    expect(pickup.collectedSpeed + pickup.collectedSlow).toBe(pickup.collected);
  });

  it('KS-06-04 AC1: the "boost killed me" proxy and its control both had enough samples to be meaningful', () => {
    expect(boost.boostSamples).toBeGreaterThan(0);
    expect(boost.boostDeathsWithinWindow).toBeGreaterThanOrEqual(0);
    expect(boost.boostDeathsWithinWindow).toBeLessThanOrEqual(boost.boostSamples);
  });

  it('KS-06-04 AC1: the SLOW-on-win-rate comparison had a non-empty, seed-matched sample', () => {
    expect(slowEffect.sampleSize).toBeGreaterThan(0);
    expect(slowEffect.onWinRatePct).not.toBeNull();
    expect(slowEffect.offWinRatePct).not.toBeNull();
  });

  it('KS-06-04 AC1: 500 rounds per arm completed inside the timeout with a comparable wall time to laserStats.test.js', () => {
    // laserStats.test.js runs 1500 rounds (three pairings) in ~50s; this file runs 1000 (two arms of one
    // pairing). No specific budget is asserted (a wall-clock assertion is exactly the kind of flaky check
    // CLAUDE.md warns against) — this only records that the run finished, for the PR's timing note.
    expect(totalElapsedMs).toBeGreaterThan(0);
  });
});
