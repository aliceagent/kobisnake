import { expect, test } from '@playwright/test';
import { failureReasons, playMatch } from './driver.js';
import {
  checkInvariants,
  HUD_LENGTH_TOLERANCE,
  HUD_TIMER_TOLERANCE_SECONDS,
} from './invariants.js';
import { greedy } from './policies/greedy.js';
import { survivor } from './policies/survivor.js';
import { buildChaosSchedule, chaosFailureReasons, chaosScheduleToEvents } from './resilience.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * KI-06-04 — the chaos pass: ten played matches, each interrupted by a real `WEBGL_lose_context` loss and
 * restore at least three times, all finishing with their invariants intact (AC1).
 *
 * This is the "does the real path actually run" half of the ticket — `resilience.js` holds the pure schedule,
 * `resilience.test.js` proves it in Node. This file is what turns that schedule into a real interruption:
 * `driver.playMatch`'s `chaosEvents` option fires `WEBGL_lose_context.loseContext()`/`restoreContext()` on the
 * live canvas the renderer already holds, never a fabricated `dispatchEvent` (`tests/e2e/resilience.spec.js`
 * (KI-06-01) is the spec that established that path; this ticket drives it from inside a whole played match
 * instead of a scripted one-off).
 *
 * **Ten seeds, greedy vs survivor.** The same pairing `playtest.spec.js` gates `npm run test:agent` on, and
 * the same ten seeds `docs/qa/playtests/agent-run.md` already measured — copied as a literal rather than
 * imported, for the reason `tests/agent/pacing.js`'s own module doc gives for the identical copy: importing a
 * `.spec.js` file would re-register that file's own tests against this run. Reusing them is also what makes
 * `resilience.js`'s chaos window provably safe: `agent-run.md`'s machine-readable block reports this exact
 * pairing's shortest observed round, over these exact ten seeds, at 15.5 s — see `WINDOW_START_FRAME`'s own
 * doc comment in `resilience.js` for the frame arithmetic that window is built from.
 */

/** See this file's own module doc for why this is a literal copy rather than an import. */
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** AC1's own budget for the ten matches — the same one `playtest.spec.js`'s own AC1 test holds itself to. */
const TEN_MATCH_BUDGET_MS = 60_000;

/**
 * `playtest.spec.js` measured this same pairing over 83.4 s at the driver's own default render cadence and
 * brought it back under budget at one render every 40 simulated seconds (see that file's own module doc for
 * the full measurement); matched here for the same reason — rendering is not what this layer tests, and
 * skipping `renderer.render()` cannot affect simulation state (`driver.js`'s header).
 */
const RESILIENCE_RENDER_EVERY_N_FRAMES = 2400;

/**
 * The HUD tolerance derived from `session.js`'s real `HUD_INTERVAL_SECONDS` (KI-03-03 AC2), and the real grid
 * size from `src/core/settings.js` — the values `checkInvariants`'s serialised body may not import for itself
 * (`invariants.js`'s own ruling 3), forwarded here exactly as `invariants.spec.js` does.
 */
const INVARIANT_CONFIG = {
  grid: { width: SETTINGS.grid.width, height: SETTINGS.grid.height },
  hudTimerToleranceSeconds: HUD_TIMER_TOLERANCE_SECONDS,
  hudLengthTolerance: HUD_LENGTH_TOLERANCE,
};

/**
 * Plays one Best-of-3 on `seed`, greedy vs survivor, interrupted by a seeded chaos schedule built from the
 * same seed — so a failing match names one number that reproduces both the play and the chaos that broke it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} seed
 * @returns {Promise<{result: import('./driver.js').MatchResult, plannedInterruptions: number}>}
 */
async function playChaosMatch(page, seed) {
  const schedule = buildChaosSchedule(seed);
  const result = await playMatch(page, {
    seed,
    bestOf: 3,
    policy1: greedy,
    policy2: survivor,
    renderEveryNFrames: RESILIENCE_RENDER_EVERY_N_FRAMES,
    invariants: checkInvariants,
    invariantConfig: INVARIANT_CONFIG,
    chaosEvents: chaosScheduleToEvents(schedule),
  });
  return { result, plannedInterruptions: schedule.length };
}

test.describe('KI-06-04 · the agent harness proves it', () => {
  test('KI-06-04 AC1: ten matches, each interrupted at least three times, all finish with zero invariant failures', async ({
    page,
  }) => {
    test.setTimeout(TEN_MATCH_BUDGET_MS * 3);
    const startedAt = Date.now();

    /** @type {import('./driver.js').MatchResult[]} */
    const results = [];
    let plannedInterruptions = 0;
    for (const seed of SEEDS) {
      const played = await playChaosMatch(page, seed);
      results.push(played.result);
      plannedInterruptions += played.plannedInterruptions;
    }
    const totalMs = Date.now() - startedAt;

    // `driver.js`'s own three clauses (finished / clean console / zero invariant problems, KI-03-01 AC3),
    // exactly as `playtest.spec.js` and `invariants.spec.js` both assert them.
    expect(failureReasons(results).join('\n')).toBe('');
    // The chaos-specific check: the **reported** interruption count, not just the planned one (tech-lead
    // ruling on #285) — a schedule that planned interruptions the page never delivered must fail here, not
    // read as ten clean matches.
    expect(chaosFailureReasons(results).join('\n')).toBe('');
    expect(results.every((result) => result.finished)).toBe(true);

    const lostCount = results.reduce((sum, result) => sum + (result.chaos?.lostCount ?? 0), 0);
    const restoredCount = results.reduce(
      (sum, result) => sum + (result.chaos?.restoredCount ?? 0),
      0,
    );
    console.log(
      `KI-06-04 AC1: ${SEEDS.length} matches (seeds ${SEEDS.join(', ')}) in ${totalMs} ms — ` +
        `${plannedInterruptions} interruptions planned, ${lostCount} real webglcontextlost / ` +
        `${restoredCount} real webglcontextrestored delivered, ` +
        `${results.reduce((sum, r) => sum + r.rounds.length, 0)} rounds, ` +
        `${results.reduce((sum, r) => sum + r.frames, 0)} frames, 0 invariant problems.`,
    );

    expect(totalMs).toBeLessThan(TEN_MATCH_BUDGET_MS);
  });
});
