// @ts-check
import { describe, expect, it } from 'vitest';
import {
  MIN_INTERRUPTIONS,
  WINDOW_START_FRAME,
  WINDOW_END_FRAME,
  buildChaosSchedule,
  chaosScheduleToEvents,
  chaosFailureReasons,
} from './resilience.js';

/**
 * KI-06-04 — the pure half of the chaos pass, proved in Node without a browser: the seeded schedule
 * (`buildChaosSchedule`), the flattening `driver.js` consumes (`chaosScheduleToEvents`), and the reported-count
 * check (`chaosFailureReasons`). `resilience.spec.js` is the half that actually drives a match; this file is
 * what `tests/agent/README.md`'s split promises — "the test proves the pure parts in Node".
 */

describe('KI-06-04 · buildChaosSchedule', () => {
  it('KI-06-04 AC1: plans at least three interruptions by default', () => {
    const schedule = buildChaosSchedule(1);
    expect(schedule.length).toBeGreaterThanOrEqual(MIN_INTERRUPTIONS);
    expect(schedule.length).toBe(MIN_INTERRUPTIONS);
  });

  it('KI-06-04 AC1: every interruption is inside the played window, and restores after its own loss', () => {
    for (const seed of [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
      const schedule = buildChaosSchedule(seed);
      expect(schedule.length).toBeGreaterThanOrEqual(MIN_INTERRUPTIONS);
      for (const { lossFrame, restoreFrame } of schedule) {
        expect(lossFrame).toBeGreaterThanOrEqual(WINDOW_START_FRAME);
        expect(lossFrame).toBeLessThan(WINDOW_END_FRAME);
        expect(restoreFrame).toBeGreaterThan(lossFrame);
        // The reserved margin at the end of every slot (`maxRestoreDelayFrames + minGapFrames`) means a
        // restore can never reach the window's own end, let alone cross it — checked here as a fact about
        // the schedule, not assumed.
        expect(restoreFrame).toBeLessThan(WINDOW_END_FRAME);
      }
    }
  });

  it('KI-06-04: interruptions never overlap — one restores before the next one loses', () => {
    const schedule = buildChaosSchedule(42);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i].lossFrame).toBeGreaterThan(schedule[i - 1].restoreFrame);
    }
  });

  it('KI-06-04: the same seed reproduces the same schedule (CLAUDE.md determinism)', () => {
    expect(buildChaosSchedule(7)).toEqual(buildChaosSchedule(7));
  });

  it('KI-06-04: different seeds produce different schedules', () => {
    expect(buildChaosSchedule(1)).not.toEqual(buildChaosSchedule(2));
  });

  it('KI-06-04: a caller can ask for more interruptions and still gets a valid, non-overlapping schedule', () => {
    const schedule = buildChaosSchedule(3, { interruptionCount: 5 });
    expect(schedule).toHaveLength(5);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i].lossFrame).toBeGreaterThan(schedule[i - 1].restoreFrame);
    }
  });

  it('KI-06-04: refuses a window too small for the requested interruption count, rather than silently overlapping', () => {
    expect(() =>
      buildChaosSchedule(1, { interruptionCount: 20, windowStartFrame: 0, windowEndFrame: 100 }),
    ).toThrow(/too small/);
  });

  it('KI-06-04: refuses a non-positive interruption count', () => {
    expect(() => buildChaosSchedule(1, { interruptionCount: 0 })).toThrow(RangeError);
  });
});

describe('KI-06-04 · chaosScheduleToEvents', () => {
  it('KI-06-04: turns each pair into a lose/restore event, sorted by frame', () => {
    const schedule = [
      { lossFrame: 500, restoreFrame: 540 },
      { lossFrame: 300, restoreFrame: 330 },
    ];
    expect(chaosScheduleToEvents(schedule)).toEqual([
      { frame: 300, type: 'lose' },
      { frame: 330, type: 'restore' },
      { frame: 500, type: 'lose' },
      { frame: 540, type: 'restore' },
    ]);
  });

  it('KI-06-04: a real schedule flattens to twice as many events, still sorted', () => {
    const events = chaosScheduleToEvents(buildChaosSchedule(13));
    expect(events).toHaveLength(MIN_INTERRUPTIONS * 2);
    for (let i = 1; i < events.length; i += 1) {
      expect(events[i].frame).toBeGreaterThan(events[i - 1].frame);
    }
  });
});

describe('KI-06-04 · chaosFailureReasons', () => {
  /** @returns {any} */
  function healthyResult(overrides = {}) {
    return {
      seed: 1,
      chaos: { lostCount: MIN_INTERRUPTIONS, restoredCount: MIN_INTERRUPTIONS },
      ...overrides,
    };
  }

  it('KI-06-04 AC1: a match that delivered every planned interruption has no failure reasons', () => {
    expect(chaosFailureReasons([healthyResult()])).toEqual([]);
  });

  it('KI-06-04 AC1: a match that never wired chaosEvents fails, naming its seed', () => {
    const reasons = chaosFailureReasons([healthyResult({ seed: 9, chaos: null })]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('seed 9');
    expect(reasons[0]).toContain('never wired');
  });

  it('KI-06-04 AC1: a schedule that planned interruptions the page never delivered fails, not silently passes', () => {
    // The tech-lead ruling on #285: assert the *reported* count, not just the planned one — a schedule that
    // plans four interruptions and a page that delivers none must fail.
    const reasons = chaosFailureReasons([
      healthyResult({ seed: 4, chaos: { lostCount: 0, restoredCount: 0 } }),
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('seed 4');
    expect(reasons[0]).toContain('only 0 real webglcontextlost');
    expect(reasons[0]).toContain(`wanted >= ${MIN_INTERRUPTIONS}`);
  });

  it('KI-06-04: a loss owed a restore it never got fails, even with enough losses', () => {
    const reasons = chaosFailureReasons([
      healthyResult({ seed: 2, chaos: { lostCount: MIN_INTERRUPTIONS, restoredCount: 2 } }),
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('seed 2');
    expect(reasons[0]).toContain('owed a restore');
  });

  it('KI-06-04: a custom minInterruptions is honoured', () => {
    const reasons = chaosFailureReasons(
      [healthyResult({ chaos: { lostCount: 3, restoredCount: 3 } })],
      5,
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('wanted >= 5');
  });
});
