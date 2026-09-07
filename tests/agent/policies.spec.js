import { expect, test } from '@playwright/test';
import { failureReasons, playMatch } from './driver.js';
import { greedy } from './policies/greedy.js';
import { survivor } from './policies/survivor.js';
import { idle } from './policies/idle.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * KI-03-02 — the agent-level measurements the ticket's acceptance criteria ask for, plus the idle
 * characterisation scenario. `playtest.spec.js` is KI-03-01's own suite (the ten-match run `npm run
 * test:agent` gates on, now greedy vs survivor per ruling 2/5); this file is KI-03-02's.
 *
 * **AC1 and AC2 both use *mirrored* matches** — greedy vs greedy, survivor vs survivor — rather than greedy
 * vs survivor. A mixed match's "did the laser phase get reached" outcome is a property of the *interaction*
 * between two different policies; measuring each policy's own tendency means playing it against itself, the
 * same way `tests/sim/stats.test.js` isolates a bot's behaviour before the project ever mixes bots together.
 *
 * **Seed count.** The committed `tests/sim` statistics run 500 rounds headlessly (`stats.test.js`); this
 * layer plays whole matches through a real browser and is far slower (KI-03-01's own measurements: ~3.3 s a
 * match at the default render cadence). {@link SEEDS} below is 20 seeds, stated here so a result is
 * replayable: at 3 rounds a match that is up to 180 (greedy) or fewer, longer, rounds (survivor) — enough to
 * see a real percentage rather than noise, inside a runtime this file's own console output reports.
 *
 * **Render cadence.** `driver.js`'s header is explicit that skipping `renderer.render()` cannot affect
 * simulation state — only real time it costs. These statistics only read `RoundRecord` fields (never
 * `maxDrawCalls`), so {@link STATS_RENDER_EVERY_N_FRAMES} renders far more sparsely than the driver's own
 * default, trading a render sample this file does not use for wall time it does. `RENDER_EVERY_N_FRAMES` in
 * `driver.js` itself is untouched.
 */

/** Fibonacci-continued from `playtest.spec.js`'s own `SEEDS`, extended to 20 for a steadier percentage. */
const SEEDS = [
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
];

/** One render every 20 simulated seconds — sparse on purpose; see this file's module doc. */
const STATS_RENDER_EVERY_N_FRAMES = 1200;

/**
 * Plays one Best-of-3 per seed with both players driven by the same policy, mirrored.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(view: import('./driver.js').PolicyView) => import('./driver.js').PolicyMove} policy
 * @returns {Promise<import('./driver.js').MatchResult[]>}
 */
async function playMirroredSet(page, policy) {
  const results = [];
  for (const seed of SEEDS) {
    results.push(
      await playMatch(page, {
        seed,
        bestOf: 3,
        policy1: policy,
        policy2: policy,
        renderEveryNFrames: STATS_RENDER_EVERY_N_FRAMES,
      }),
    );
  }
  return results;
}

/** @param {import('./driver.js').MatchResult[]} results */
function allRounds(results) {
  return results.flatMap((result) => result.rounds);
}

test.describe('KI-03-02 · play policies', () => {
  test('KI-03-02 AC1: greedy reaches the laser phase in a minority of rounds, survivor in a majority', async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    const startedAt = Date.now();

    const greedyResults = await playMirroredSet(page, greedy);
    const survivorResults = await playMirroredSet(page, survivor);
    const totalMs = Date.now() - startedAt;

    // Both mirrored sets are real matches too: the driver's own health gate applies here just as it does to
    // `playtest.spec.js`'s ten-match run.
    expect(failureReasons([...greedyResults, ...survivorResults]).join('\n')).toBe('');
    expect(greedyResults.every((result) => result.finished)).toBe(true);
    expect(survivorResults.every((result) => result.finished)).toBe(true);

    const greedyRounds = allRounds(greedyResults);
    const survivorRounds = allRounds(survivorResults);
    const greedyReached = greedyRounds.filter((round) => round.reachedLaserPhase).length;
    const survivorReached = survivorRounds.filter((round) => round.reachedLaserPhase).length;
    const greedyRate = greedyReached / greedyRounds.length;
    const survivorRate = survivorReached / survivorRounds.length;

    console.log(
      `KI-03-02 AC1: ${SEEDS.length} mirrored Bo3 seeds (${SEEDS.join(', ')}) in ${totalMs} ms — ` +
        `greedy reached the laser phase in ${greedyReached}/${greedyRounds.length} rounds ` +
        `(${(greedyRate * 100).toFixed(1)}%); survivor in ${survivorReached}/${survivorRounds.length} rounds ` +
        `(${(survivorRate * 100).toFixed(1)}%).`,
    );

    // The acceptance criterion, read literally: greedy a minority, survivor a majority, and the two must
    // differ measurably — a real gap, not two numbers that both happen to round to "around half".
    expect(greedyRate).toBeLessThan(0.5);
    expect(survivorRate).toBeGreaterThan(0.5);
    expect(survivorRate - greedyRate).toBeGreaterThan(0.2);
  });

  test('KI-03-02 AC2: survivor keeps both snakes alive past 0:30 in at least 80% of rounds', async ({
    page,
  }) => {
    test.setTimeout(10 * 60_000);
    const startedAt = Date.now();

    const survivorResults = await playMirroredSet(page, survivor);
    const totalMs = Date.now() - startedAt;

    expect(failureReasons(survivorResults).join('\n')).toBe('');
    expect(survivorResults.every((result) => result.finished)).toBe(true);

    // Derived from SETTINGS, never a literal: "0:30" is `laserStartTime`, the seconds-remaining mark
    // `DESIGN-DECISIONS §2.4` labels the laser warning by. Death ends a round the instant it happens
    // (`§2.5`), so a round that lasted at least this many simulated seconds is exactly a round in which both
    // snakes were still alive at that mark — there is no other way to still be playing.
    const thirtySeconds = SETTINGS.laserStartTime;

    const rounds = allRounds(survivorResults);
    const survivedPast30 = rounds.filter((round) => round.seconds >= thirtySeconds).length;
    const rate = survivedPast30 / rounds.length;

    console.log(
      `KI-03-02 AC2: ${SEEDS.length} mirrored survivor Bo3 seeds (${SEEDS.join(', ')}) in ${totalMs} ms — ` +
        `both snakes alive past 0:${thirtySeconds} in ${survivedPast30}/${rounds.length} rounds ` +
        `(${(rate * 100).toFixed(1)}%).`,
    );
    expect(rate).toBeGreaterThanOrEqual(0.8);
  });

  test(
    'KI-03-02: idle policy — an all-draw match ends on the third consecutive draw ' +
      '(DESIGN-DECISIONS §1 row 26; #119 F1, I01/#120)',
    async ({ page }) => {
      test.setTimeout(120_000);

      // The idle policy is the state that found **F1**: two players who put the keyboard down draw every
      // round (the golden no-input round fixes a DRAW at tick 380), and on the build the 2026-09-07 QA pass
      // examined, a match made only of draws could never end — 12 rounds, 0-0, forever.
      //
      // This test was written as a *characterisation* test of that open defect, asserting what the build then
      // did, and documented as the tripwire that would go red the moment I01 implemented
      // `DESIGN-DECISIONS §1 row 26`. **It went red exactly as designed**: I01 (#120) merged to `main`
      // while this ticket was in review, and this assertion is the flip it called for. What it asserts now is
      // row 26 itself — the third consecutive draw ends the match, nobody has more wins, so nobody wins it.
      //
      // It is still the test that catches F1 coming back: if the cap were ever removed or miscounted, an
      // idle match would run past three rounds and every assertion below would fail.
      const maxFrames = 6000; // 100 simulated seconds — far more than row 26 should ever need.
      const result = await playMatch(page, {
        seed: 1,
        bestOf: 3,
        policy1: idle,
        policy2: idle,
        maxFrames,
      });

      expect(result.pageErrors).toEqual([]);
      // The match ends, which is the whole of row 26 ("every match must terminate").
      expect(result.finished).toBe(true);
      expect(result.frames).toBeLessThan(maxFrames);
      // Exactly three rounds, every one a draw: the cap is `SETTINGS.maxConsecutiveDraws`, read rather than
      // retyped, so this follows the design value if it is ever tuned.
      expect(result.rounds).toHaveLength(SETTINGS.maxConsecutiveDraws);
      expect(result.rounds.every((round) => round.result === 'DRAW')).toBe(true);
      // Level wins, so the match is a tie won by nobody — row 26's own words.
      expect(result.match).toMatchObject({
        winner: null,
        wins: { 1: 0, 2: 0 },
        roundsPlayed: SETTINGS.maxConsecutiveDraws,
        isOver: true,
      });

      console.log(
        `KI-03-02: idle vs idle (seed 1) ended after ${result.rounds.length} rounds, every one a DRAW, ` +
          `with no winner — DESIGN-DECISIONS §1 row 26, the rule #119 F1 asked for.`,
      );
    },
  );
});
