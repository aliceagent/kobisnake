import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '../../../src/core/grid.js';
import {
  createInputLatencyTracker,
  disabledInputLatencyStats,
} from '../../../src/game/inputLatency.js';

/**
 * KS-07-06: the pure timing/matching logic behind `__kobi.getInputStats()`.
 *
 * Declared outside this ticket's own `Files:` list (`src/game/input.js`, `src/game/testHooks.js`,
 * `tests/e2e/inputLatency.spec.js`) — see the PR description. `inputLatency.js` itself is the small,
 * independently-testable module `session.js`'s wiring hands facts to (that wiring, and the e2e proof that it
 * is honestly wired to real frames, is what the ticket's own AC1 test covers); this file is the "prove the
 * matching and the arithmetic are right in isolation, with a clock this test controls" half.
 */

/** A `now()` this test can move by hand, so every millisecond in an assertion is exact. */
function createFakeClock(startMs = 1000) {
  let ms = startMs;
  return {
    now: () => ms,
    advance(deltaMs) {
      ms += deltaMs;
    },
  };
}

/** `state.snakes` shorthand: one snake, `id` "p1", heading `dir`. */
function stateAt(tick, dir) {
  return { tick, snakes: [{ id: 'p1', direction: dir }] };
}

describe('KS-07-06 createInputLatencyTracker', () => {
  it('produces no sample for a rejected input (recordApplied(..., false))', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now });

    tracker.recordKeydown('p1', DIRECTIONS.RIGHT, clock.now());
    tracker.recordApplied('p1', -1, false);

    // No commit to look for: the snake's direction "changing" to what it already was is not a change.
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();

    expect(tracker.getStats().sampleCount).toBe(0);
  });

  it('matches keydown -> queued -> committed -> rendered into one sample with the right arithmetic', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now, simHz: 120, snakeSpeed: 6 });

    // Frame 0: the snake is already known to be heading RIGHT (spawn heading) — the tracker's first
    // `observeState` call establishes the baseline it diffs against, exactly like a real first frame.
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();

    // A keydown for UP arrives at t=1000 (the clock's start).
    const keydownAt = clock.now();
    tracker.recordKeydown('p1', DIRECTIONS.UP, keydownAt);

    // 2 ms of call-stack overhead pass before `session.js` learns `applyInput` accepted it, at tick 5.
    clock.advance(2);
    tracker.recordApplied('p1', 5, true);

    // 150 ms later (the wait for the grid step), tick 23, the snake's committed direction actually changes.
    clock.advance(150);
    tracker.observeState(stateAt(23, DIRECTIONS.UP));

    // The draw call that follows costs 3 ms.
    clock.advance(3);
    tracker.markRendered();

    const stats = tracker.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.sampleCount).toBe(1);

    const [sample] = stats.samples;
    expect(sample.playerId).toBe('p1');
    expect(sample.dirName).toBe('UP');
    expect(sample.queuedTick).toBe(5);
    expect(sample.committedTick).toBe(23);
    expect(sample.stepWaitTicks).toBe(18);
    expect(sample.overheadMs).toBe(2);
    expect(sample.stepWaitMs).toBe(150);
    expect(sample.renderMs).toBe(3);
    expect(sample.totalMs).toBe(155); // 2 + 150 + 3

    expect(stats.totalMs.median).toBe(155);
    expect(stats.overheadMs.median).toBe(2);
    expect(stats.stepWaitMs.median).toBe(150);
    expect(stats.renderMs.median).toBe(3);
    expect(stats.stepWaitTicks.median).toBe(18);
    expect(stats.context).toEqual({
      simHz: 120,
      snakeSpeed: 6,
      ticksPerStepAtBaseSpeed: 20,
      stepMsAtBaseSpeed: 1000 / 6,
    });
  });

  it('matches two queued turns to their two commits in FIFO order, not by guessing which is which', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now });
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();

    // Buffer size 2 (DESIGN-DECISIONS §2.2): both turns queue before either commits, exactly a real
    // rapid double-tap U-turn.
    tracker.recordKeydown('p1', DIRECTIONS.UP, clock.now());
    tracker.recordApplied('p1', 1, true);
    clock.advance(5);
    tracker.recordKeydown('p1', DIRECTIONS.LEFT, clock.now());
    tracker.recordApplied('p1', 1, true);

    // First commit: UP.
    clock.advance(10);
    tracker.observeState(stateAt(20, DIRECTIONS.UP));
    tracker.markRendered();

    // Second commit, one grid step later: LEFT.
    clock.advance(167);
    tracker.observeState(stateAt(40, DIRECTIONS.LEFT));
    tracker.markRendered();

    const stats = tracker.getStats();
    expect(stats.sampleCount).toBe(2);
    expect(stats.samples[0].dirName).toBe('UP');
    expect(stats.samples[0].committedTick).toBe(20);
    expect(stats.samples[1].dirName).toBe('LEFT');
    expect(stats.samples[1].committedTick).toBe(40);
  });

  it('resetForRound drops in-flight state but keeps completed samples', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now });
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();
    tracker.recordKeydown('p1', DIRECTIONS.UP, clock.now());
    tracker.recordApplied('p1', 1, true);
    clock.advance(50);
    tracker.observeState(stateAt(6, DIRECTIONS.UP));
    tracker.markRendered();
    expect(tracker.getStats().sampleCount).toBe(1);

    // A fresh round respawns the snake heading RIGHT again — without `resetForRound`, this would misread as
    // a UP -> RIGHT commit matching some stale pending entry from the round that just ended.
    tracker.recordKeydown('p1', DIRECTIONS.DOWN, clock.now());
    tracker.resetForRound();
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();

    // No spurious second sample, and the completed one from before the reset is untouched.
    expect(tracker.getStats().sampleCount).toBe(1);
  });

  it('clear() drops completed samples too', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now });
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();
    tracker.recordKeydown('p1', DIRECTIONS.UP, clock.now());
    tracker.recordApplied('p1', 1, true);
    tracker.observeState(stateAt(6, DIRECTIONS.UP));
    tracker.markRendered();
    expect(tracker.getStats().sampleCount).toBe(1);

    tracker.clear();
    expect(tracker.getStats().sampleCount).toBe(0);
  });

  it('a queued turn that never commits (the snake died first) ages out rather than mismatching a later one', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now, maxPendingAgeMs: 100 });
    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();

    // Queued, but the round ends before it ever commits.
    tracker.recordKeydown('p1', DIRECTIONS.UP, clock.now());
    tracker.recordApplied('p1', 1, true);

    // A new round starts; direction resets, but this test deliberately skips `resetForRound()` to prove the
    // age-based sweep also protects a caller that forgets it (defence in depth, not a reason to skip it).
    clock.advance(200); // past maxPendingAgeMs
    tracker.recordKeydown('p1', DIRECTIONS.LEFT, clock.now());
    tracker.recordApplied('p1', 500, true);
    tracker.observeState(stateAt(520, DIRECTIONS.LEFT));
    tracker.markRendered();

    const stats = tracker.getStats();
    expect(stats.sampleCount).toBe(1);
    expect(stats.samples[0].dirName).toBe('LEFT');
    expect(stats.samples[0].queuedTick).toBe(500);
  });

  it('getStats() on an empty tracker returns null summaries, not NaN or a throw', () => {
    const tracker = createInputLatencyTracker();
    const stats = tracker.getStats();
    expect(stats.enabled).toBe(true);
    expect(stats.sampleCount).toBe(0);
    expect(stats.totalMs).toEqual({ median: null, p10: null, p90: null, min: null, max: null });
    expect(stats.stepWaitTicks).toEqual({ median: null, min: null, max: null });
    expect(stats.histogram.buckets.every((count) => count === 0)).toBe(true);
    expect(stats.histogram.overflowCount).toBe(0);
    expect(stats.samples).toEqual([]);
  });

  it('buckets totalMs into the histogram and overflows a sample past the last bucket', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now, historySize: 10 });
    let tick = 0;

    /** One full turn-and-turn-back, producing two samples; `stepWaitMs` sets the first one's `totalMs`. */
    function sample(stepWaitMs) {
      tracker.observeState(stateAt((tick += 1), DIRECTIONS.RIGHT));
      tracker.markRendered();
      tracker.recordKeydown('p1', DIRECTIONS.UP, clock.now());
      tracker.recordApplied('p1', (tick += 1), true);
      clock.advance(stepWaitMs);
      tracker.observeState(stateAt((tick += 1), DIRECTIONS.UP));
      tracker.markRendered();
      // Turn back to RIGHT so the next sample's own commit is a real change again.
      tracker.recordKeydown('p1', DIRECTIONS.RIGHT, clock.now());
      tracker.recordApplied('p1', (tick += 1), true);
      tracker.observeState(stateAt((tick += 1), DIRECTIONS.RIGHT));
      tracker.markRendered();
    }

    sample(5); // bucket 0 ([0, 20))
    sample(25); // bucket 1 ([20, 40))
    sample(600); // past the histogram's 500 ms range, but well under the default 4 s stale-pending cutoff

    const stats = tracker.getStats();
    expect(stats.sampleCount).toBe(6); // two commits recorded per `sample()` call
    expect(stats.histogram.bucketWidthMs).toBe(20);
    expect(stats.histogram.buckets[0]).toBeGreaterThanOrEqual(1);
    expect(stats.histogram.buckets[1]).toBeGreaterThanOrEqual(1);
    expect(stats.histogram.overflowCount).toBeGreaterThanOrEqual(1);
  });

  it('names a direction that is not one of the four DIRECTIONS values by its own dx,dy (defensive fallback)', () => {
    const clock = createFakeClock();
    const tracker = createInputLatencyTracker({ now: clock.now });
    const oddDirection = { dx: 2, dy: 0 };

    tracker.observeState(stateAt(0, DIRECTIONS.RIGHT));
    tracker.markRendered();
    tracker.recordKeydown('p1', oddDirection, clock.now());
    tracker.recordApplied('p1', 1, true);
    tracker.observeState(stateAt(1, oddDirection));
    tracker.markRendered();

    expect(tracker.getStats().samples[0].dirName).toBe('2,0');
  });

  it('disabledInputLatencyStats() matches the shape getStats() returns, with enabled: false', () => {
    const disabled = disabledInputLatencyStats();
    expect(disabled.enabled).toBe(false);
    expect(disabled.sampleCount).toBe(0);
    expect(disabled.samples).toEqual([]);
    expect(disabled.totalMs.median).toBeNull();
    expect(disabled.context.snakeSpeed).toBe(6);
    expect(disabled.histogram.metric).toBe('totalMs');
  });
});
