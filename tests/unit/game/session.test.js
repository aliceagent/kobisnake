// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { withOverrides } from '../../../src/core/settings.js';
import { createSession, formatTime } from '../../../src/game/session.js';

/**
 * KS-03-05: session wiring, minimal HUD and round flow.
 *
 * AC1 ("two humans can play a full round with WASD and Arrows on the Vercel preview") is a human step by
 * construction — it is answered by the sprint's QA-plan playtest, not a test here. AC2 and AC3 are covered
 * below, plus the 10 Hz HUD throttle and the `1`/`2` → `'p1'`/`'p2'` player-id mapping the tech-lead notes
 * asked for explicitly.
 *
 * A fake renderer and a fake `ui` stand in for the browser (`session.js` never imports three.js or reaches
 * for `document`), a real `EventTarget` stands in for the keyboard (same pattern as `input.test.js`), and a
 * no-op `requestFrame`/`cancelFrame` pair means every frame in these tests is driven by hand through
 * `session.loop.step(dt)` — the same "fake rAF" `loop.test.js` uses `step()` for.
 */

/** A minimal stand-in for a browser `KeyboardEvent`, built on Node's real `Event` (KS-03-02's own pattern). */
const NodeEvent = globalThis.Event;
const NodeEventTarget = globalThis.EventTarget;

class FakeKeyboardEvent extends NodeEvent {
  /** @param {string} code */
  constructor(code) {
    super('keydown', { cancelable: true });
    this.code = code;
    this.repeat = false;
  }
}

/** @param {EventTarget} target @param {string} code */
function fireKeydown(target, code) {
  target.dispatchEvent(new FakeKeyboardEvent(code));
}

/** @param {EventTarget} target */
function pressEnter(target) {
  fireKeydown(target, 'Enter');
}

function createFakeRenderer() {
  return { render: vi.fn(), resize: vi.fn() };
}

function createFakeUi() {
  return {
    hud: { setTime: vi.fn(), setLengths: vi.fn() },
    showOverlay: vi.fn(),
    hideOverlay: vi.fn(),
  };
}

/** A stand-in for `document`'s visibility half (the same fake `loop.test.js` uses). */
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
    /** @param {boolean} nextHidden */
    setHidden(nextHidden) {
      this.hidden = nextHidden;
      for (const listener of [...listeners]) listener();
    },
  };
}

/**
 * Builds a session wired entirely to fakes, with a no-op frame scheduler so every frame in a test is driven
 * by hand through `session.loop.step(dt)` rather than a real `requestAnimationFrame`.
 *
 * @param {object} [overrides] - forwarded to `createSession`, on top of the fakes below.
 */
function buildSession(overrides = {}) {
  const renderer = createFakeRenderer();
  const ui = createFakeUi();
  const target = new NodeEventTarget();

  const session = createSession({
    renderer,
    ui,
    seed: 1,
    inputTarget: target,
    requestFrame: () => 0,
    cancelFrame: () => {},
    visibilitySource: null,
    ...overrides,
  });

  return { session, renderer, ui, target };
}

describe('formatTime', () => {
  it('KS-03-05 AC2: 90 seconds formats as 1:30 and 0 seconds formats as 0:00', () => {
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(0)).toBe('0:00');
  });

  it('pads single-digit seconds and floors fractional ones', () => {
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(5)).toBe('0:05');
  });
});

describe('createSession', () => {
  it('shows the "PRESS ENTER" overlay before any round starts', () => {
    const { ui } = buildSession();
    expect(ui.showOverlay).toHaveBeenCalledWith('PRESS ENTER');
  });

  it('does nothing before Enter is pressed: no sim exists yet', () => {
    const { session } = buildSession();
    expect(session.getPhase()).toBe('idle');
    expect(session.getSim()).toBeNull();
  });

  it('the HUD throttle firing before any round exists writes nothing (there is no sim to read)', () => {
    const { session, ui } = buildSession();

    for (let i = 0; i < 5; i += 1) session.loop.step(0.03); // 150 ms idle, well past the 100 ms throttle

    expect(ui.hud.setTime).not.toHaveBeenCalled();
    expect(ui.hud.setLengths).not.toHaveBeenCalled();
  });

  describe('KS-03-05 AC2: the round timer', () => {
    it('KS-03-05 AC2: the timer reads 1:30 at the start of a round', () => {
      const { session, ui, target } = buildSession();

      pressEnter(target);

      expect(session.getPhase()).toBe('playing');
      expect(ui.hud.setTime).toHaveBeenLastCalledWith('1:30');
      expect(ui.hideOverlay).toHaveBeenCalled();
    });

    it('KS-03-05 AC2: the timer reads 0:00 at timeout', () => {
      // Both snakes travel in a straight line at the default speed with no apples to eat: a 1-second round
      // gives them nowhere near a wall (6 cells at most, well inside the 24x24 grid) before the round clock
      // itself runs out — `roundDuration` is the one number this scenario needs to shrink, and `withOverrides`
      // (settings.js's own sanctioned way to build a test variant) is how a test does that without touching
      // the shipping `SETTINGS`.
      const settings = withOverrides({ roundDuration: 1, foodCount: 0 });
      const { session, ui, target } = buildSession({ settings });

      pressEnter(target);
      // 10 frames of 0.1 s is exactly 1 simulated second (dt * simHz = 12 ticks/frame, 120 ticks total),
      // run by hand rather than waiting on a real clock.
      for (let i = 0; i < 10; i += 1) {
        session.loop.step(0.1);
      }

      expect(session.getSim()?.getState().timeRemaining).toBe(0);
      expect(ui.hud.setTime).toHaveBeenLastCalledWith('0:00');
      expect(session.getPhase()).toBe('roundOver');
    });

    it('KS-03-05 AC2: the timer does not advance while the tab is hidden', () => {
      const visibility = createFakeVisibility();
      const { session, target } = buildSession({ visibilitySource: visibility });

      pressEnter(target);
      for (let i = 0; i < 5; i += 1) session.loop.step(0.1);
      const before = session.getSim()?.getState().timeRemaining;

      visibility.setHidden(true);
      session.loop.step(0.1);
      session.loop.step(0.1);

      expect(session.getSim()?.getState().timeRemaining).toBe(before);
    });
  });

  describe('KS-03-05 AC3: round over, then a fresh round', () => {
    it('KS-03-05 AC3: Enter after ROUND_OVER starts a new round with fresh apples and snakes', () => {
      const settings = withOverrides({ roundDuration: 1, foodCount: 0 });
      const { session, ui, target } = buildSession({ settings });

      pressEnter(target);
      const round1 = session.getSim();
      const round1StartState = round1?.getState();

      for (let i = 0; i < 10; i += 1) session.loop.step(0.1);
      expect(session.getPhase()).toBe('roundOver');
      // Both snakes travelled the same straight line for the same 1 second with nothing to eat, so a
      // timeout here is always a draw — the one deterministic result this scenario can produce.
      expect(ui.showOverlay).toHaveBeenLastCalledWith('DRAW — PRESS ENTER');

      pressEnter(target);

      expect(session.getPhase()).toBe('playing');
      const round2 = session.getSim();
      expect(round2).not.toBe(round1);

      const round2State = round2?.getState();
      expect(round2State?.tick).toBe(0);
      expect(round2State?.phase).toBe('PLAYING');
      // Fresh snakes: back to the starting length, not the (possibly grown) length round 1 ended at.
      expect(round2State?.snakes.map((s) => s.length)).toEqual(
        round1StartState?.snakes.map((s) => s.length),
      );
      // Fresh apples, reproducibly: `buildSession`'s default `seed: 1` is a fixed seed, reused for round 2,
      // which reseeds the RNG from scratch — so the opening board matches round 1's opening board exactly.
      // See the two tests below for the seed contract itself (fixed replays, absent draws fresh each round).
      expect(round2State?.apples).toEqual(round1StartState?.apples);
    });

    it('KS-03-05 AC3: a fixed ?seed replays the same board every round', () => {
      // `foodCount` stays at its default here (unlike the test above) because this test's whole point is
      // comparing the apples, which a `foodCount: 0` override would make trivially and meaninglessly equal.
      const settings = withOverrides({ roundDuration: 1 });
      const { session, target } = buildSession({ seed: 1, settings });

      pressEnter(target);
      const round1Apples = session.getSim()?.getState().apples;
      for (let i = 0; i < 10; i += 1) session.loop.step(0.1);
      expect(session.getPhase()).toBe('roundOver');

      pressEnter(target);
      const round2Apples = session.getSim()?.getState().apples;

      expect(round2Apples).toEqual(round1Apples);
    });

    it('KS-03-05 AC3: without ?seed, a new round gets a new board', () => {
      // A fake `randomSeed` in place of `Date.now` — real wall-clock time called twice in the same test could
      // land in the same millisecond and produce two identical seeds, which would make this test flaky for a
      // reason that has nothing to do with the behaviour it is proving.
      let nextSeed = 0;
      const settings = withOverrides({ roundDuration: 1 });
      const { session, target } = buildSession({
        seed: null,
        settings,
        randomSeed: () => (nextSeed += 1),
      });

      pressEnter(target);
      const round1Apples = session.getSim()?.getState().apples;
      for (let i = 0; i < 10; i += 1) session.loop.step(0.1);
      expect(session.getPhase()).toBe('roundOver');

      pressEnter(target);
      const round2Apples = session.getSim()?.getState().apples;

      expect(round2Apples).not.toEqual(round1Apples);
    });

    it('Enter mid-round has no effect', () => {
      const { session, target } = buildSession();

      pressEnter(target);
      const round1 = session.getSim();

      pressEnter(target);

      expect(session.getSim()).toBe(round1);
      expect(session.getPhase()).toBe('playing');
    });
  });

  describe('the 10 Hz HUD throttle', () => {
    it('writes the HUD at most once per 100 ms of simulated time', () => {
      const { session, ui, target } = buildSession();

      pressEnter(target);
      ui.hud.setTime.mockClear();

      // Five 30 ms frames: 150 ms of simulated time should cross the 100 ms threshold exactly once.
      for (let i = 0; i < 5; i += 1) session.loop.step(0.03);

      expect(ui.hud.setTime).toHaveBeenCalledTimes(1);
    });
  });

  describe("the input mapping: input.js's 1/2 -> RoundSimulation's 'p1'/'p2'", () => {
    it('KS-03-05: WASD steers p1 and the arrow keys steer p2 in the RoundSimulation', () => {
      const { session, target } = buildSession();
      pressEnter(target);

      // P1 spawns heading RIGHT, P2 heading LEFT (DESIGN-DECISIONS §2.3) — UP and DOWN are legal turns for
      // both, so both queue cleanly.
      fireKeydown(target, 'KeyW'); // player 1, up
      fireKeydown(target, 'ArrowDown'); // player 2, down

      // Two 0.1 s frames are 24 ticks at simHz 120 — enough for one grid step (a step is due every 20 ticks
      // at the base 6 cells/s speed), so the queued turn has actually been committed. A single frame cannot
      // do this in one call: `loop.step` clamps to `maxFrameSeconds` (0.1 s) just like a real frame would.
      session.loop.step(0.1);
      session.loop.step(0.1);

      const state = session.getSim()?.getState();
      expect(state?.snakes[0].direction).toEqual(DIRECTIONS.UP);
      expect(state?.snakes[1].direction).toEqual(DIRECTIONS.DOWN);
    });

    it('ignores direction input before any round has started', () => {
      const { session, target } = buildSession();

      // No round yet: dispatching a direction key must not throw for want of a sim to steer.
      expect(() => fireKeydown(target, 'KeyW')).not.toThrow();
      expect(session.getSim()).toBeNull();
    });
  });

  describe('rendering', () => {
    it('renders an empty snapshot before any round starts, and the sim state once one exists', () => {
      const { session, renderer, target } = buildSession({
        requestFrame: () => 0,
        cancelFrame: () => {},
      });

      session.loop.step(0.016);
      expect(renderer.render).toHaveBeenLastCalledWith({ snakes: [], apples: [] }, 0.016);

      pressEnter(target);
      renderer.render.mockClear();
      session.loop.step(0.016);

      const [snapshot, dt] = renderer.render.mock.calls[0];
      expect(snapshot.snakes).toHaveLength(2);
      expect(dt).toBe(0.016);
    });
  });

  describe('KS-03-06: advanceSimulation/renderFrame/setSeed (testHooks.js support)', () => {
    it('advanceSimulation(dt) advances the sim and runs ROUND_OVER handling, without rendering', () => {
      const settings = withOverrides({ roundDuration: 1, foodCount: 0 });
      const { session, ui, renderer, target } = buildSession({ settings });

      pressEnter(target);
      renderer.render.mockClear();

      // One big call, same as `RoundSimulation.advance`'s own contract (core/round.js): 1 s is enough to
      // time the round out and trip the placeholder round flow's ROUND_OVER handling.
      session.advanceSimulation(1);

      expect(session.getSim()?.getState().timeRemaining).toBe(0);
      expect(session.getPhase()).toBe('roundOver');
      expect(ui.showOverlay).toHaveBeenLastCalledWith('DRAW — PRESS ENTER');
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it('advanceSimulation(dt) is a no-op-safe call before any round has started', () => {
      const { session, renderer } = buildSession();
      expect(() => session.advanceSimulation(1)).not.toThrow();
      expect(session.getSim()).toBeNull();
      expect(renderer.render).not.toHaveBeenCalled();
    });

    it("renderFrame() draws exactly one frame of the sim's current state", () => {
      const { session, renderer, target } = buildSession();

      pressEnter(target);
      renderer.render.mockClear();
      session.renderFrame();

      expect(renderer.render).toHaveBeenCalledTimes(1);
      const [snapshot] = renderer.render.mock.calls[0];
      expect(snapshot.snakes).toHaveLength(2);
    });

    it('renderFrame() before any round renders the empty snapshot', () => {
      const { session, renderer } = buildSession();
      session.renderFrame();
      expect(renderer.render).toHaveBeenLastCalledWith({ snakes: [], apples: [] }, 0);
    });

    it('setSeed fixes the seed the NEXT round starts with, leaving the round in progress alone', () => {
      const settings = withOverrides({ roundDuration: 1 });
      const { session, target } = buildSession({ seed: 1, settings });

      pressEnter(target);
      const round1Apples = session.getSim()?.getState().apples;

      session.setSeed(2);
      // The round already in progress must not be affected by a seed set mid-round.
      expect(session.getSim()?.getState().apples).toEqual(round1Apples);

      for (let i = 0; i < 10; i += 1) session.loop.step(0.1);
      expect(session.getPhase()).toBe('roundOver');
      pressEnter(target);
      const round2Apples = session.getSim()?.getState().apples;

      expect(round2Apples).not.toEqual(round1Apples);
    });

    it('setSeed(null) restores a fresh board every round', () => {
      // Starts well away from the fixed seed (1) round 1 plays with, so `randomSeed()`'s first draw for
      // round 2 cannot coincidentally collide with it and produce a false failure.
      let nextSeed = 100;
      const settings = withOverrides({ roundDuration: 1 });
      const { session, target } = buildSession({
        seed: 1,
        settings,
        randomSeed: () => (nextSeed += 1),
      });

      pressEnter(target);
      session.setSeed(null);
      for (let i = 0; i < 10; i += 1) session.loop.step(0.1);
      expect(session.getPhase()).toBe('roundOver');
      const round1Apples = session.getSim()?.getState().apples;

      pressEnter(target);
      const round2Apples = session.getSim()?.getState().apples;

      expect(round2Apples).not.toEqual(round1Apples);
    });
  });

  describe('start/stop/dispose', () => {
    it('start() begins scheduling frames and dispose() tears the input listener down', () => {
      const requested = vi.fn();
      const { session, target } = buildSession({
        requestFrame: (cb) => {
          requested(cb);
          return 1;
        },
        cancelFrame: vi.fn(),
      });

      session.start();
      expect(requested).toHaveBeenCalledTimes(1);

      session.dispose();
      // The input listener is gone: a keydown after dispose does not throw and cannot reach a round either.
      expect(() => pressEnter(target)).not.toThrow();
      expect(session.getSim()).toBeNull();
    });

    it('stop() halts the loop without touching input or the sim', () => {
      const { session, target } = buildSession();

      pressEnter(target);
      session.stop();

      expect(session.loop.isRunning()).toBe(false);
      expect(session.getSim()).not.toBeNull();
    });
  });
});
