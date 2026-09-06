// @ts-check
import { describe, expect, it } from 'vitest';
import { END_REASONS, RESULTS } from '../../src/core/events.js';
import { SETTINGS } from '../../src/core/settings.js';
import { greedyBot } from './bots/greedyBot.js';
import { createRandomBot } from './bots/randomBot.js';
import { survivorBot } from './bots/survivorBot.js';
import { runRound } from './harness.js';

/**
 * Bot-driven statistics (`docs/sprints/sprint-02-core-simulation.md` KS-02-06 AC1/AC2, `QA-STRATEGY §4`).
 *
 * This is QA infrastructure, not a correctness suite: it asserts only sanity — no exception, every round
 * actually ends — and prints the design-health table Fable reads at Playtest Gates. It must never assert a
 * particular win rate or draw rate (those are design measurements, not engine contracts): a test that failed
 * whenever the game's character changed would be a test someone deletes the day it becomes inconvenient.
 *
 * **Sprint 02 has no lasers yet** (`src/core/lasers.js` is an inactive stub) — every round here either ends by
 * death or runs the full clock to `TIMEOUT`. The pre-sprint validation numbers this table is compared against
 * (`docs/qa/reports/2026-09-05-pre-sprint-validation.md §1`) were measured with a working laser phase, so the
 * "ends during lasers" percentage cannot be reproduced yet — the table says so plainly instead of omitting the
 * column or inventing a number for it. The other columns (draw rate, mean longest snake, rounds decided before
 * the clock runs out) can be compared, and a large deviation there is a finding for the sprint QA report, not
 * something to tune the bots against until it matches.
 */

const ROUNDS_PER_PAIRING = 200;
const SEED_OFFSET = {
  survivorVsSurvivor: 10_000,
  greedyVsSurvivor: 20_000,
  greedyVsGreedy: 30_000,
};

/**
 * Runs `n` seeded rounds of one bot pairing and reduces them to the `QA-STRATEGY §4` statistics.
 *
 * @param {import('./harness.js').Bot} bot1
 * @param {import('./harness.js').Bot} bot2
 * @param {number} seedStart
 * @param {number} n
 * @returns {{
 *   n: number,
 *   beforeThirtyPct: number,
 *   thirtyToZeroPct: number,
 *   timeoutPct: number,
 *   drawPct: number,
 *   meanLongestSnake: number,
 *   elapsedMs: number,
 * }}
 */
function runPairing(bot1, bot2, seedStart, n) {
  // "0:30 seconds remaining" (DESIGN-DECISIONS §2.4) as elapsed simulated time.
  const thirtySecondsRemainingElapsed = SETTINGS.roundDuration - 30;

  let beforeThirty = 0;
  let thirtyToZero = 0;
  let timeout = 0;
  let draws = 0;
  let longestSum = 0;

  const start = performance.now();
  for (let i = 0; i < n; i += 1) {
    const seed = seedStart + i;
    const round = runRound({ seed, bots: [bot1, bot2] });

    // Sanity only (CLAUDE.md "Never skip... a test", QA-STRATEGY §4/KS-02-06 point 10): every round produced a
    // recorded reason and a result in the known vocabulary. No win-rate or draw-rate assertion belongs here.
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
  }
  const elapsedMs = performance.now() - start;

  return {
    n,
    beforeThirtyPct: (100 * beforeThirty) / n,
    thirtyToZeroPct: (100 * thirtyToZero) / n,
    timeoutPct: (100 * timeout) / n,
    drawPct: (100 * draws) / n,
    meanLongestSnake: longestSum / n,
    elapsedMs,
  };
}

describe('KS-02-06 bot statistics', () => {
  // Vitest's default 5s per-test timeout is a test-runner ceiling, not the budget AC1 is about — it has to
  // sit above 10s or a passing run could never report itself. The assertion below is the real budget.
  it('KS-02-06 AC1: greedyBot vs survivorBot, 200 rounds, completes in under 10s', () => {
    const stats = runPairing(
      greedyBot,
      survivorBot,
      SEED_OFFSET.greedyVsSurvivor,
      ROUNDS_PER_PAIRING,
    );
    expect(stats.elapsedMs).toBeLessThan(10_000);
  }, 20_000);

  it('KS-02-06 AC2: the statistics table has every QA-STRATEGY §4 column and every round ends', () => {
    const pairings = [
      {
        name: 'survivor vs survivor',
        bot1: survivorBot,
        bot2: survivorBot,
        seedStart: SEED_OFFSET.survivorVsSurvivor,
      },
      {
        name: 'greedy vs survivor',
        bot1: greedyBot,
        bot2: survivorBot,
        seedStart: SEED_OFFSET.greedyVsSurvivor,
      },
      {
        name: 'greedy vs greedy',
        bot1: greedyBot,
        bot2: greedyBot,
        seedStart: SEED_OFFSET.greedyVsGreedy,
      },
      { name: 'random vs greedy', bot1: createRandomBot(), bot2: greedyBot, seedStart: 40_000 },
    ];

    /** @type {Record<string, string | number>[]} */
    const rows = [];
    for (const pairing of pairings) {
      const stats = runPairing(pairing.bot1, pairing.bot2, pairing.seedStart, ROUNDS_PER_PAIRING);
      rows.push({
        pairing: pairing.name,
        rounds: stats.n,
        'ends before 0:30': `${stats.beforeThirtyPct.toFixed(1)}%`,
        'ends 0:30-0:00': `${stats.thirtyToZeroPct.toFixed(1)}%`,
        'ends by timeout': `${stats.timeoutPct.toFixed(1)}%`,
        'avg survivor length': stats.meanLongestSnake.toFixed(1),
        'draw rate': `${stats.drawPct.toFixed(1)}%`,
        'power-up pickup rate': 'N/A (no power-ups in Sprint 02)',
      });
    }

    // AC2 requires the table to be printed, not just computed.
    console.log(
      '\nKS-02-06 bot statistics (QA-STRATEGY §4 columns; 200 seeded rounds per pairing):',
    );
    console.table(rows);
    console.log(
      'Note: Sprint 02 has no lasers yet (src/core/lasers.js is an inactive stub), so no round ends "during ' +
        'lasers" - every round here ends by death or by the 90s timeout. "power-up pickup rate" is N/A for the ' +
        'same reason (src/core/powerups.js is an inactive stub). Compare the other columns against ' +
        'docs/qa/reports/2026-09-05-pre-sprint-validation.md §1; a large deviation is a finding to report, not ' +
        'something to tune the bots to match.',
    );

    // Sanity only, per this test's own name and CLAUDE.md/KS-02-06 point 10 — never a win-rate or draw-rate
    // threshold. Every row's percentages must add to 100% of the rounds actually run.
    for (const row of rows) {
      const pct =
        parseFloat(/** @type {string} */ (row['ends before 0:30'])) +
        parseFloat(/** @type {string} */ (row['ends 0:30-0:00'])) +
        parseFloat(/** @type {string} */ (row['ends by timeout']));
      expect(pct).toBeCloseTo(100, 0);
    }
  }, 45_000);
});
