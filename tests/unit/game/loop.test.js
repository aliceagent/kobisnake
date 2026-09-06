import { describe, expect, it, vi } from 'vitest';
import { createLoop } from '../../../src/game/loop.js';

/**
 * A stand-in for `requestAnimationFrame` and the clock behind it. `advanceBy(ms)` moves the fake clock and
 * runs exactly one pending frame, which is what a real browser does once per display refresh — so a test that
 * says "three frames of 250 ms" gets three frames of 250 ms and not one frame of 750 ms.
 */
function createFakeFrames(startMs = 0) {
  let nowMs = startMs;
  /** @type {Map<number, (timestampMs: number) => void>} */
  const pending = new Map();
  let nextHandle = 1;

  return {
    now: () => nowMs,
    requestFrame: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle) => {
      pending.delete(handle);
    },
    pendingCount: () => pending.size,
    /** Move the clock on and run the one frame that was waiting, if any. */
    advanceBy(ms) {
      nowMs += ms;
      const entries = [...pending.entries()];
      pending.clear();
      for (const [, callback] of entries) callback(nowMs);
    },
  };
}

/** A stand-in for `document`'s visibility half: settable, and it notifies like the real thing. */
function createFakeVisibility() {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    hidden: false,
    addEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.delete(listener);
    },
    listenerCount: () => listeners.size,
    /** @param {boolean} nextHidden */
    setHidden(nextHidden) {
      this.hidden = nextHidden;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * A started loop plus everything a test needs to drive it. Visibility is opted out of by default so a test
 * that is not about visibility cannot be affected by it; pass one in when it is the subject.
 *
 * @param {object} [options]
 */
function startLoop(options = {}) {
  const frames = createFakeFrames();
  const update = vi.fn();
  const render = vi.fn();
  const onAutoPause = vi.fn();
  const loop = createLoop({
    update,
    render,
    onAutoPause,
    now: frames.now,
    requestFrame: frames.requestFrame,
    cancelFrame: frames.cancelFrame,
    visibilitySource: null,
    ...options,
  });
  loop.start();
  return { loop, frames, update, render, onAutoPause };
}

/** The dt values `update` was called with, in order. */
function dtsPassedTo(update) {
  return update.mock.calls.map(([dt]) => dt);
}

describe('createLoop', () => {
  it('KS-03-01 AC1: feeding frames of 250 ms results in update receiving at most 100 ms per frame', () => {
    const { frames, update } = startLoop();

    // The very first frame has no previous frame to measure against, so it is a zero-length frame by
    // construction; the three that follow are the 250 ms ones the criterion is about.
    frames.advanceBy(0);
    frames.advanceBy(250);
    frames.advanceBy(250);
    frames.advanceBy(250);

    const dts = dtsPassedTo(update);
    expect(dts).toHaveLength(4);
    for (const dt of dts) {
      expect(dt).toBeLessThanOrEqual(0.1);
    }
    // And the clamp really fired rather than the frames arriving short: each 250 ms frame gave exactly the
    // 100 ms cap, so three quarters of a second of real time became three tenths of simulated time.
    expect(dts.slice(1)).toEqual([0.1, 0.1, 0.1]);
  });

  it('KS-03-01 AC1: the clamp is a stall, not a jump — a two-minute background gap still advances 100 ms', () => {
    const { frames, update } = startLoop();

    frames.advanceBy(0);
    frames.advanceBy(120_000);

    expect(dtsPassedTo(update)).toEqual([0, 0.1]);
  });

  it('KS-03-01 AC2: timeScale = 0.25 quarters the dt passed to update', () => {
    const { loop, frames, update } = startLoop();

    frames.advanceBy(0);
    frames.advanceBy(40);
    loop.timeScale = 0.25;
    frames.advanceBy(40);

    const dts = dtsPassedTo(update);
    expect(dts[1]).toBeCloseTo(0.04, 10);
    expect(dts[2]).toBeCloseTo(0.01, 10);
    expect(dts[2]).toBeCloseTo(dts[1] / 4, 10);
  });

  it('KS-03-01 AC2: timeScale = 0 freezes the simulation while frames keep coming', () => {
    const { loop, frames, update, render } = startLoop();

    loop.timeScale = 0;
    frames.advanceBy(0);
    frames.advanceBy(40);
    frames.advanceBy(40);

    expect(dtsPassedTo(update)).toEqual([0, 0, 0]);
    // A pause screen over a frozen arena still has to be drawn, so rendering must not stop with time.
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('KS-03-01 AC2: the clamp is applied before the scale, so slow-mo is a quarter of the cap', () => {
    const { loop, frames, update } = startLoop();

    loop.timeScale = 0.25;
    frames.advanceBy(0);
    frames.advanceBy(250);

    // 0.25 x the 0.1 s cap, not 0.25 x the 0.25 s frame.
    expect(dtsPassedTo(update)[1]).toBeCloseTo(0.025, 10);
  });

  it('KS-03-01 AC3: a hidden tab stops updates', () => {
    const visibility = createFakeVisibility();
    const { frames, update } = startLoop({ visibilitySource: visibility });

    frames.advanceBy(0);
    frames.advanceBy(16);
    const callsBeforeHiding = update.mock.calls.length;

    visibility.setHidden(true);
    frames.advanceBy(16);
    frames.advanceBy(16);

    expect(update).toHaveBeenCalledTimes(callsBeforeHiding);
    // Nothing is queued either: the loop cancelled the frame it was waiting on rather than relying on the
    // browser to throttle a background tab for it.
    expect(frames.pendingCount()).toBe(0);
  });

  it('KS-03-01 AC3: becoming visible again resumes updates and calls onAutoPause first', () => {
    const visibility = createFakeVisibility();
    const { frames, update, onAutoPause } = startLoop({ visibilitySource: visibility });
    /** @type {string[]} */
    const order = [];
    update.mockImplementation(() => order.push('update'));
    onAutoPause.mockImplementation(() => order.push('onAutoPause'));

    frames.advanceBy(0);
    order.length = 0;
    visibility.setHidden(true);
    frames.advanceBy(5000);
    expect(order).toEqual([]);

    visibility.setHidden(false);
    frames.advanceBy(16);
    frames.advanceBy(16);

    expect(onAutoPause).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe('onAutoPause');
    expect(order.slice(1)).toEqual(['update', 'update']);
  });

  it('KS-03-01 AC3: the time a hidden tab spent away is not handed to update on resume', () => {
    const visibility = createFakeVisibility();
    const { frames, update } = startLoop({ visibilitySource: visibility });

    frames.advanceBy(0);
    visibility.setHidden(true);
    frames.advanceBy(60_000);
    visibility.setHidden(false);
    frames.advanceBy(16);

    // Not 0.1 (the clamp) and certainly not 60: the first frame after a resume is measured from itself.
    expect(dtsPassedTo(update)).toEqual([0, 0]);
  });

  it('ignores a visibilitychange that does not change anything', () => {
    const visibility = createFakeVisibility();
    const { loop, frames } = startLoop({ visibilitySource: visibility });

    frames.advanceBy(0);
    visibility.setHidden(false);

    expect(loop.isHidden()).toBe(false);
    expect(frames.pendingCount()).toBe(1);
  });

  it('starts hidden when the tab is already hidden at construction', () => {
    const visibility = createFakeVisibility();
    visibility.hidden = true;
    const { loop, frames, update } = startLoop({ visibilitySource: visibility });

    frames.advanceBy(16);

    expect(loop.isHidden()).toBe(true);
    expect(update).not.toHaveBeenCalled();
  });

  it('step(dt) goes through the same clamp and scale path as a real frame', () => {
    const { loop, update, render } = startLoop({ requestFrame: () => 0, cancelFrame: () => {} });

    loop.step(0.25);
    loop.timeScale = 0.25;
    loop.step(0.02);

    expect(dtsPassedTo(update)).toEqual([0.1, 0.005]);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('step(dt) does nothing while the tab is hidden', () => {
    const visibility = createFakeVisibility();
    const { loop, update } = startLoop({ visibilitySource: visibility });

    visibility.setHidden(true);
    loop.step(0.016);

    expect(update).not.toHaveBeenCalled();
  });

  it('a negative frame length never runs time backwards', () => {
    const { loop, update } = startLoop();

    loop.step(-5);

    expect(dtsPassedTo(update)).toEqual([0]);
  });

  it('renders the fixed-step interpolation alpha, wrapping at one whole step', () => {
    const { loop, render } = startLoop({ stepSeconds: 0.01 });

    loop.step(0.004);
    loop.step(0.004);
    loop.step(0.004);

    const alphas = render.mock.calls.map(([alpha]) => alpha);
    expect(alphas[0]).toBeCloseTo(0.4, 10);
    expect(alphas[1]).toBeCloseTo(0.8, 10);
    // 1.2 steps' worth of accumulation is 0.2 of the way into the *next* step, not 1.2 of this one.
    expect(alphas[2]).toBeCloseTo(0.2, 10);
    for (const alpha of alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
  });

  it('works without a render callback', () => {
    const frames = createFakeFrames();
    const update = vi.fn();
    const loop = createLoop({
      update,
      now: frames.now,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
      visibilitySource: null,
    });
    loop.start();

    frames.advanceBy(0);
    frames.advanceBy(16);

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('start() is idempotent and does not double-schedule frames', () => {
    const { loop, frames, update } = startLoop();

    loop.start();
    loop.start();
    expect(frames.pendingCount()).toBe(1);

    frames.advanceBy(16);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('stop() halts frames and is idempotent; start() picks up again', () => {
    const { loop, frames, update } = startLoop();

    frames.advanceBy(0);
    loop.stop();
    loop.stop();
    expect(loop.isRunning()).toBe(false);
    expect(frames.pendingCount()).toBe(0);

    frames.advanceBy(16);
    expect(update).toHaveBeenCalledTimes(1);

    loop.start();
    frames.advanceBy(16);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('a frame that arrives after stop() does nothing', () => {
    /** @type {((timestampMs: number) => void)[]} */
    const callbacks = [];
    const { loop, update } = startLoop({
      requestFrame: (callback) => {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelFrame: () => {},
    });

    const inFlight = callbacks[0];
    loop.stop();
    inFlight(16);

    expect(update).not.toHaveBeenCalled();
  });

  it('dispose() stops the loop and removes the visibility listener', () => {
    const visibility = createFakeVisibility();
    const { loop, frames, update } = startLoop({ visibilitySource: visibility });

    expect(visibility.listenerCount()).toBe(1);
    loop.dispose();

    expect(loop.isRunning()).toBe(false);
    expect(visibility.listenerCount()).toBe(0);

    visibility.setHidden(true);
    visibility.setHidden(false);
    frames.advanceBy(16);
    expect(update).not.toHaveBeenCalled();
  });

  it('falls back to the injected clock when the scheduler passes no timestamp', () => {
    const frames = createFakeFrames(1000);
    const update = vi.fn();
    /** @type {(() => void)[]} */
    const callbacks = [];
    const loop = createLoop({
      update,
      now: frames.now,
      // A scheduler that calls back with nothing, which `requestAnimationFrame` never does but a shim might.
      requestFrame: (callback) => {
        callbacks.push(() => callback(/** @type {any} */ (undefined)));
        return callbacks.length;
      },
      cancelFrame: () => {},
      visibilitySource: null,
    });
    loop.start();

    callbacks.shift()?.();
    frames.advanceBy(40);
    callbacks.shift()?.();

    expect(dtsPassedTo(update)).toEqual([0, 0.04]);
  });

  it('defaults timeScale to 1 and exposes it as a writable property', () => {
    const { loop } = startLoop({ timeScale: undefined });

    expect(loop.timeScale).toBe(1);
    loop.timeScale = 0.25;
    expect(loop.timeScale).toBe(0.25);
  });

  it('falls back to the platform requestAnimationFrame, document and clock when nothing is injected', () => {
    const visibility = createFakeVisibility();
    /** @type {((timestampMs: number) => void)[]} */
    const scheduled = [];
    const cancelled = vi.fn();
    const globals = /** @type {any} */ (globalThis);
    const saved = {
      requestAnimationFrame: globals.requestAnimationFrame,
      cancelAnimationFrame: globals.cancelAnimationFrame,
      document: globals.document,
    };
    globals.requestAnimationFrame = (callback) => scheduled.push(callback);
    globals.cancelAnimationFrame = cancelled;
    globals.document = visibility;

    try {
      const update = vi.fn();
      const loop = createLoop({ update });
      loop.start();

      // One frame was requested through the platform hook, and it drives the loop when it fires. No
      // timestamp is passed, so the module's own `performance.now()` clock supplies the time.
      expect(scheduled).toHaveLength(1);
      scheduled.shift()?.(/** @type {any} */ (undefined));
      expect(update).toHaveBeenCalledTimes(1);

      // And `document` was picked up as the visibility source without being named.
      expect(loop.isHidden()).toBe(false);
      visibility.setHidden(true);
      expect(loop.isHidden()).toBe(true);
      expect(cancelled).toHaveBeenCalledTimes(1);

      loop.dispose();
      expect(visibility.listenerCount()).toBe(0);
    } finally {
      globals.requestAnimationFrame = saved.requestAnimationFrame;
      globals.cancelAnimationFrame = saved.cancelAnimationFrame;
      globals.document = saved.document;
    }
  });

  it('survives a platform with no requestAnimationFrame and no document', () => {
    const update = vi.fn();
    const loop = createLoop({ update, visibilitySource: null, requestFrame: () => 0 });

    // `start()` must not throw even though nothing will ever call back, and `step` still drives the loop.
    loop.start();
    loop.step(0.016);
    loop.dispose();

    expect(dtsPassedTo(update)).toEqual([0.016]);
  });

  it('falls back to Date.now() on a platform without performance.now()', () => {
    const globals = /** @type {any} */ (globalThis);
    const savedPerformance = globals.performance;
    /** @type {((timestampMs: number) => void)[]} */
    const scheduled = [];
    delete globals.performance;

    try {
      const update = vi.fn();
      const loop = createLoop({
        update,
        visibilitySource: null,
        requestFrame: (callback) => scheduled.push(callback),
        cancelFrame: () => {},
      });
      loop.start();
      scheduled.shift()?.(/** @type {any} */ (undefined));

      expect(update).toHaveBeenCalledTimes(1);
    } finally {
      globals.performance = savedPerformance;
    }
  });
});
