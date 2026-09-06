// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-07-06 AC1: "Median keydown-to-render latency <= 1 frame + the remaining step time."
 *
 * **This is deliberately the one e2e spec in this repository that does not fast-forward its own subject.**
 * `window.__kobi.fastForward`/`advance` (`ARCHITECTURE §11`) drive the update path in bulk chunks with a
 * single render at the end (`testHooks.js`'s own comment on `fastForward`) — exactly right for a spec that
 * wants a *state*, and exactly wrong for one measuring the wall-clock gap between a keydown and the frame
 * that shows its effect, since a bulk-advanced round never has "the next real animation frame" for that gap
 * to be measured against. `session.js`'s real `requestAnimationFrame` loop starts once, in `main.js`, and
 * keeps running for the whole page lifetime regardless of what a test hook also does — see `interpolation.
 * spec.js`'s own module comment ("the background frame loop... would make [a fixed offset] unreliable"),
 * which is the same fact this spec relies on rather than works around. `startMatchInPage` below only skips
 * the *countdown* this way (nobody is measuring how fast 3-2-1-GO happens); every sample this spec reads
 * comes from a real `pressKey` dispatched into that already-running loop, with nothing between the press and
 * the read but actual elapsed wall time.
 *
 * **The whole press-and-wait sequence runs inside the page, in one `page.evaluate`, not as a loop of
 * round-trips from this Node script.** A shared, loaded CI box (this repository runs several agents' suites
 * at once — see this project's own worktree/lock convention) can make a `page.evaluate` round-trip itself
 * take real seconds under contention, while the *browser tab's own* `requestAnimationFrame` clock keeps
 * ticking at real wall-clock speed regardless — P1's opponent is not being steered here and walks itself into
 * the west wall in about 3 simulated seconds, so a slow round-trip loop risks the round ending from under the
 * test before it finishes gathering samples. Polling with the page's own `requestAnimationFrame` instead
 * keeps every wait exactly as short as the game itself needs and immune to how slowly Node happens to be
 * issuing commands.
 *
 * P1 (WASD, spawns heading RIGHT, `DESIGN-DECISIONS §2.3`) is steered through a UP/RIGHT staircase: each
 * press is a legal 90° turn from the one before it (never a repeat, never the reverse `queueDirection` would
 * drop), it never revisits a cell it has already occupied, and it stays nowhere near a wall in the handful of
 * steps this spec takes.
 */

/** A safe, never-reversing, never-self-colliding turn sequence from P1's spawn heading (RIGHT). */
const TURN_SEQUENCE = ['UP', 'RIGHT', 'UP', 'RIGHT', 'UP', 'RIGHT'];

/**
 * Floor for "1 frame" (AC1's own wording), used only if the live measurement below somehow comes back at or
 * near zero — never the number the assertion actually runs on.
 */
const FRAME_BUDGET_FLOOR_MS = 20;

/** How many consecutive real frames {@link collectInputStats} times, to measure "1 frame" empirically. */
const FRAME_SAMPLE_COUNT = 20;

/** DESIGN-DECISIONS §2.1: base speed 6 cells/s at 120 Hz makes a grid step this many milliseconds. */
const STEP_MS = 1000 / SETTINGS.snakeSpeed;

/**
 * `loop.js`'s own `MAX_FRAME_SECONDS` (`ARCHITECTURE §5`), mirrored here in milliseconds — not imported,
 * since `loop.js` does not export it (the same reason `testHooks.js`'s own `FAST_FORWARD_CHUNK_SECONDS`
 * mirrors it rather than importing it, and a unit test there asserts the two agree). It matters to this
 * spec's own bound because it caps how much *simulated* time one real frame can ever credit: on a box slow
 * enough that a real frame regularly exceeds 100 ms (a real, observed condition on this repository's own
 * shared containers — see this file's module comment), reaching one whole grid step can cost more than one
 * such frame even though each frame is itself the same fixed 100 ms — "the remaining step time" (AC1's own
 * wording) is bounded by how many *clamped* frames it takes, not by the step's nominal 166.67 ms alone.
 */
const MAX_FRAME_MS = 100;

/**
 * Runs entirely in the page (see this file's own module comment for why): first times
 * {@link FRAME_SAMPLE_COUNT} consecutive real frames to learn what "1 frame" actually costs on whatever
 * machine is running this (a shared, loaded CI box included — see this file's own module comment on why a
 * hard-coded frame budget would make AC1's bound a claim about the hardware rather than about the pipeline),
 * then presses each direction in `sequence` for player 1 and waits — via the page's own
 * `requestAnimationFrame`, never a fixed sleep — for `getInputStats().sampleCount` to grow by one before
 * pressing the next.
 *
 * @param {{sequence: string[], perStepTimeoutMs: number, frameSampleCount: number}} options - a single
 *   object, since `page.evaluate(fn, arg)` passes exactly one serialisable argument through to `fn`.
 */
async function collectInputStats({ sequence, perStepTimeoutMs, frameSampleCount }) {
  const kobi = /** @type {any} */ (globalThis).__kobi;

  // P2 (arrow keys, spawns heading LEFT, `DESIGN-DECISIONS §2.3`) is otherwise never touched by this spec,
  // and this function cannot know in advance how long a real elapsed-time gap this contended environment
  // might insert between two presses — DOWN/LEFT alternation is a legal 90° turn every time (never a repeat,
  // never `queueDirection`'s reverse) and, like P1's own UP/RIGHT staircase, stays nowhere near a wall for
  // far more steps than this spec ever takes. This function cannot import `helpers.js`'s constants (it runs
  // inside the page, stripped of this module's closure — same reason `helpers.js` itself is self-contained).
  const defensiveP2Sequence = ['DOWN', 'LEFT'];

  /** @returns {Promise<number>} the median real frame duration, in ms, over `frameSampleCount` frames. */
  function measureFrameMs() {
    return new Promise((resolve) => {
      const deltas = /** @type {number[]} */ ([]);
      let last = performance.now();
      function tick() {
        const now = performance.now();
        deltas.push(now - last);
        last = now;
        if (deltas.length >= frameSampleCount) {
          const sorted = [...deltas].sort((a, b) => a - b);
          resolve(sorted[Math.floor(sorted.length / 2)]);
          return;
        }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
  }

  /**
   * Waits for player 1 specifically to reach `targetCount` completed samples — not `stats.sampleCount`,
   * which the shared tracker also grows on P2's own (defensive, see this function's own module comment)
   * turns, and counting those in would let this loop race ahead of P1's *own* turn actually committing
   * before pressing the next one, which the safe staircase's legality depends on.
   *
   * @param {number} targetCount
   */
  function waitForSampleCount(targetCount) {
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      function check() {
        const stats = kobi.getInputStats();
        const p1Count = stats.samples.filter((/** @type {any} */ s) => s.playerId === 'p1').length;
        if (p1Count >= targetCount) {
          resolve(stats);
          return;
        }
        if (performance.now() - startedAt > perStepTimeoutMs) {
          reject(
            new Error(
              `timed out waiting for p1 sampleCount >= ${targetCount}; last stats: ${JSON.stringify(stats)}`,
            ),
          );
          return;
        }
        requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    });
  }

  const frameMs = await measureFrameMs();

  let stats = kobi.getInputStats();
  for (let i = 0; i < sequence.length; i += 1) {
    // P2 is steered too (see this file's own module comment): a real elapsed-time gap this test cannot
    // control the length of must never let P2's un-steered spawn heading walk it into a wall mid-measurement.
    kobi.pressKey(2, defensiveP2Sequence[i % defensiveP2Sequence.length]);
    kobi.pressKey(1, sequence[i]);
    stats = await waitForSampleCount(i + 1);
  }
  return { stats, frameMs };
}

test.describe('KS-07-06 input-feel instrumentation', () => {
  test('KS-07-06 AC1: median keydown-to-render latency is at most one frame plus the remaining step time', async ({
    page,
  }) => {
    // This is the one spec in the suite that must watch several real seconds of live, un-fast-forwarded
    // play, on whatever shared box this repository's worktree convention already warns can be busy with
    // other agents' suites — Playwright's normal per-test budget is tuned for specs that fast-forward.
    test.setTimeout(90_000);

    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    // `enableInputStats` follows the same `?test=1`/DEV gate as `__kobi` itself (`session.js`'s "KS-07-06
    // deviation" note) — proving it is on here is proving the number this test is about to read was ever
    // actually being collected.
    const initial = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.getInputStats(),
    );
    expect(initial.enabled).toBe(true);
    expect(initial.sampleCount).toBe(0);

    const result = /** @type {any} */ (
      await page.evaluate(collectInputStats, {
        sequence: TURN_SEQUENCE,
        perStepTimeoutMs: 10_000,
        frameSampleCount: FRAME_SAMPLE_COUNT,
      })
    );
    const { stats, frameMs } = result;

    // "1 frame" (AC1's own wording), measured live rather than assumed: a fixed guess is a claim about the
    // hardware this happens to run on, and this repository's own containers run several agents' suites at
    // once (this file's own module comment) — a number generous enough for a quiet box and tight enough for
    // a busy one has to come from asking the box, not from picking a constant that hopes to fit both.
    const frameBudgetMs = Math.max(FRAME_BUDGET_FLOOR_MS, frameMs);

    // "The remaining step time" (AC1's own wording) is not simply `STEP_MS`: `loop.js` clamps every frame's
    // simulated-time credit to `MAX_FRAME_MS`, so on a box slow enough that a real frame regularly exceeds
    // that clamp, one whole grid step can cost several such frames even though the step's own nominal length
    // never changes (see `MAX_FRAME_MS`'s own doc comment). This is the honest worst case — how many
    // clamped-credit frames a step can need, each one costing this run's own observed frame time — rather
    // than a number that only holds on hardware fast enough to render well under 100 ms a frame.
    const framesPerStep = Math.ceil(STEP_MS / Math.min(frameBudgetMs, MAX_FRAME_MS));
    const stepBudgetMs = framesPerStep * frameBudgetMs;

    expect(stats.enabled).toBe(true);
    expect(stats.sampleCount).toBeGreaterThanOrEqual(TURN_SEQUENCE.length);
    // The tracker is shared by both players (`ARCHITECTURE §4`'s `snakes` array has one entry each) — P2's
    // own defensive turns (this file's own module comment: steered so it never dies mid-measurement) commit
    // and get sampled too, so this only checks that P1 actually contributed its share, not that it was alone.
    const p1Samples = stats.samples.filter((/** @type {any} */ s) => s.playerId === 'p1');
    expect(p1Samples.length).toBeGreaterThanOrEqual(TURN_SEQUENCE.length);
    expect(
      stats.samples.every((/** @type {any} */ s) => s.playerId === 'p1' || s.playerId === 'p2'),
    ).toBe(true);

    // The context block a reader needs to tell "our own overhead" apart from "the grid's own step interval"
    // (tech-lead note 2) — asserted here so a future change to `SETTINGS.simHz`/`snakeSpeed` cannot make this
    // spec's own bound quietly stale without also failing this line.
    expect(stats.context).toEqual({
      simHz: SETTINGS.simHz,
      snakeSpeed: SETTINGS.snakeSpeed,
      ticksPerStepAtBaseSpeed: Math.round(SETTINGS.simHz / SETTINGS.snakeSpeed),
      stepMsAtBaseSpeed: STEP_MS,
    });

    // AC1 itself. The median keydown-to-render pipeline must fit inside one frame of overhead plus the
    // longest a player can ever wait for the grid's own next step.
    expect(stats.totalMs.median).not.toBeNull();
    expect(stats.totalMs.median).toBeLessThanOrEqual(frameBudgetMs + stepBudgetMs);

    // The breakdown that makes the number above trustworthy rather than a coincidence: almost none of it is
    // this game's own code (`overheadMs`/`renderMs`, each one call-stack's width, bounded by the same live
    // frame budget), and the wait (`stepWaitMs`) never exceeds `stepBudgetMs`. `stepWaitTicks` is the one
    // bound that needs no frame budget at all: it is a count of `RoundSimulation`'s own fixed-size ticks
    // (`ARCHITECTURE §4`), which `sim.advance()` processes exactly regardless of how large or small the real
    // frame that fed it was — so unlike every millisecond figure above, it stays meaningful even on the most
    // heavily loaded shared box this suite ever runs on.
    expect(stats.overheadMs.median).toBeLessThanOrEqual(frameBudgetMs);
    expect(stats.renderMs.median).toBeLessThanOrEqual(frameBudgetMs);
    expect(stats.stepWaitMs.median).toBeLessThanOrEqual(stepBudgetMs);
    expect(stats.stepWaitTicks.median).toBeLessThanOrEqual(
      Math.round(SETTINGS.simHz / SETTINGS.snakeSpeed) + 1,
    );

    // A histogram the tuning overlay (KS-07-01) can read directly — proved shaped correctly here since that
    // ticket's own overlay wiring is out of this one's `Files:` list (declared in the PR description).
    expect(stats.histogram.bucketWidthMs).toBeGreaterThan(0);
    expect(
      stats.histogram.buckets.reduce(
        (/** @type {number} */ a, /** @type {number} */ b) => a + b,
        0,
      ) + stats.histogram.overflowCount,
    ).toBe(stats.sampleCount);
  });
});
