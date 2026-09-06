// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { createSession } from '../../../src/game/session.js';
import { createTestHooks } from '../../../src/game/testHooks.js';

/**
 * KS-03-06: test hooks (`window.__kobi`).
 *
 * `createTestHooks` is a plain function of its options (it never touches `window`, `location` or
 * `import.meta`), so every scenario here builds it with fakes: a fake `session` (the same shape
 * `session.js`'s KS-03-06 additions give it), a fake `renderer` and a real Node `EventTarget` +
 * `Event`-based `KeyboardEvent` stand-in, mirroring `input.test.js`'s own pattern for the same reason —
 * `KeyboardEvent` does not exist in plain Node.
 *
 * `main.js`'s DEV/`?test=1` gate and its `window.__kobi = ...` assignment are deliberately outside this
 * module (KS-03-06 tech-lead notes: "gate ... what must not happen is `window.__kobi` being defined"), so
 * AC1 and AC2 are proved by the e2e spec (`tests/e2e/test-hooks.spec.js`), not here; this file covers the
 * pure logic `createTestHooks` builds.
 */

const NodeEvent = globalThis.Event;
const NodeEventTarget = globalThis.EventTarget;

/** A minimal stand-in for a browser `KeyboardEvent` (KS-03-02's own pattern in `input.test.js`). */
class FakeKeyboardEvent extends NodeEvent {
  /** @param {string} type @param {{code?: string, bubbles?: boolean, cancelable?: boolean}} [init] */
  constructor(type, init = {}) {
    super(type, { bubbles: init.bubbles, cancelable: init.cancelable });
    this.code = init.code;
  }
}

/** @returns {{ getSim: import('vitest').Mock, advanceSimulation: import('vitest').Mock, renderFrame: import('vitest').Mock, setSeed: import('vitest').Mock }} */
function createFakeSession() {
  return {
    getSim: vi.fn(() => null),
    advanceSimulation: vi.fn(),
    renderFrame: vi.fn(),
    setSeed: vi.fn(),
  };
}

/** @param {{x?: number, y?: number, z?: number}} [position] */
function createFakeRenderer(position = { x: 1, y: 2, z: 3 }) {
  return {
    getHeadWorldPosition: vi.fn(() => ({ x: 0, y: 0, z: 0, ...position })),
  };
}

/** @param {object} [overrides] */
function buildHooks(overrides = {}) {
  const session = createFakeSession();
  const renderer = createFakeRenderer();
  const eventTarget = new NodeEventTarget();
  const hooks = createTestHooks({
    session,
    renderer,
    eventTarget,
    KeyboardEventCtor: FakeKeyboardEvent,
    ...overrides,
  });
  return { hooks, session, renderer, eventTarget };
}

describe('KS-03-06 createTestHooks', () => {
  describe('sim', () => {
    it('KS-03-06: sim is a live getter that reads session.getSim() on every access', () => {
      const { hooks, session } = buildHooks();
      const roundOne = { id: 'round-1' };
      const roundTwo = { id: 'round-2' };
      session.getSim.mockReturnValueOnce(roundOne).mockReturnValueOnce(roundTwo);

      expect(hooks.sim).toBe(roundOne);
      expect(hooks.sim).toBe(roundTwo);
      expect(session.getSim).toHaveBeenCalledTimes(2);
    });
  });

  describe('stateMachine', () => {
    it('KS-03-06: stateMachine is documented and present as null (Sprint 05 has not landed it yet)', () => {
      const { hooks } = buildHooks();
      expect(hooks.stateMachine).toBeNull();
    });
  });

  describe('setSeed', () => {
    it('KS-03-06: setSeed forwards to session.setSeed', () => {
      const { hooks, session } = buildHooks();
      hooks.setSeed(42);
      expect(session.setSeed).toHaveBeenCalledWith(42);
    });

    it('KS-03-06: setSeed(null) forwards null (restores a fresh seed every round)', () => {
      const { hooks, session } = buildHooks();
      hooks.setSeed(null);
      expect(session.setSeed).toHaveBeenCalledWith(null);
    });
  });

  describe('getSnapshot', () => {
    it('KS-03-06: getSnapshot returns sim.getState() when a round exists', () => {
      const { hooks, session } = buildHooks();
      const state = { tick: 7 };
      session.getSim.mockReturnValue({ getState: () => state });

      expect(hooks.getSnapshot()).toBe(state);
    });

    it('KS-03-06: getSnapshot returns null before any round has started', () => {
      const { hooks, session } = buildHooks();
      session.getSim.mockReturnValue(null);

      expect(hooks.getSnapshot()).toBeNull();
    });
  });

  describe('KS-03-06 AC2: fastForward drives the session, not the renderer, in between', () => {
    it('KS-03-06: fastForward(seconds) calls session.advanceSimulation(seconds) then session.renderFrame() once, in order', () => {
      const { hooks, session } = buildHooks();
      const order = /** @type {string[]} */ ([]);
      session.advanceSimulation.mockImplementation(() => order.push('advance'));
      session.renderFrame.mockImplementation(() => order.push('render'));

      hooks.fastForward(90);

      expect(session.advanceSimulation).toHaveBeenCalledWith(90);
      expect(session.renderFrame).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['advance', 'render']);
    });
  });

  describe('pressKey', () => {
    /** @param {EventTarget} target @param {(event: Event) => void} listener */
    function listenOnce(target, listener) {
      target.addEventListener('keydown', listener, { once: true });
    }

    it('KS-03-06: pressKey(1, "UP") dispatches a KeyW keydown at the event target', () => {
      const { hooks, eventTarget } = buildHooks();
      /** @type {FakeKeyboardEvent | null} */
      let received = null;
      listenOnce(eventTarget, (event) => {
        received = /** @type {FakeKeyboardEvent} */ (event);
      });

      hooks.pressKey(1, 'UP');

      expect(received?.code).toBe('KeyW');
      expect(received?.type).toBe('keydown');
      expect(received?.bubbles).toBe(true);
      expect(received?.cancelable).toBe(true);
    });

    it('KS-03-06: pressKey accepts every player/direction combination input.js maps', () => {
      const { hooks, eventTarget } = buildHooks();
      const cases = /** @type {const} */ ([
        [1, 'UP', 'KeyW'],
        [1, 'DOWN', 'KeyS'],
        [1, 'LEFT', 'KeyA'],
        [1, 'RIGHT', 'KeyD'],
        [2, 'UP', 'ArrowUp'],
        [2, 'DOWN', 'ArrowDown'],
        [2, 'LEFT', 'ArrowLeft'],
        [2, 'RIGHT', 'ArrowRight'],
      ]);
      const codes = /** @type {string[]} */ ([]);
      eventTarget.addEventListener('keydown', (event) =>
        codes.push(/** @type {FakeKeyboardEvent} */ (event).code ?? ''),
      );

      for (const [player, dir] of cases) hooks.pressKey(player, dir);

      expect(codes).toEqual(cases.map(([, , code]) => code));
    });

    it('KS-03-06: pressKey also accepts a DIRECTIONS value (not just its string name)', () => {
      const { hooks, eventTarget } = buildHooks();
      /** @type {FakeKeyboardEvent | null} */
      let received = null;
      listenOnce(eventTarget, (event) => {
        received = /** @type {FakeKeyboardEvent} */ (event);
      });

      hooks.pressKey(2, DIRECTIONS.LEFT);

      expect(received?.code).toBe('ArrowLeft');
    });

    it('KS-03-06: pressKey throws for a player that is neither 1 nor 2', () => {
      const { hooks } = buildHooks();
      expect(() => hooks.pressKey(/** @type {any} */ (3), 'UP')).toThrow(/player must be 1 or 2/);
    });

    it('KS-03-06: pressKey throws for an unrecognised dir string', () => {
      const { hooks } = buildHooks();
      expect(() => hooks.pressKey(1, /** @type {any} */ ('SIDEWAYS'))).toThrow(/dir must be/);
    });

    it('KS-03-06: pressKey throws for a dir object matching no DIRECTIONS value', () => {
      const { hooks } = buildHooks();
      expect(() => hooks.pressKey(1, /** @type {any} */ ({ dx: 2, dy: 2 }))).toThrow(/dir must be/);
    });

    it('KS-03-06: pressKey throws when neither an eventTarget nor a window is available', () => {
      const session = createFakeSession();
      const renderer = createFakeRenderer();
      const hooks = createTestHooks({ session, renderer, KeyboardEventCtor: FakeKeyboardEvent });

      expect(() => hooks.pressKey(1, 'UP')).toThrow(/no event target/);
    });

    it('KS-03-06: falls back to the global window and KeyboardEvent when neither is injected', () => {
      // Node's test environment has neither; stub both just long enough to prove the fallback resolves to
      // them (mirrors KS-03-02's own "falls back to the global window" test in input.test.js).
      const fakeWindow = new NodeEventTarget();
      /** @type {typeof globalThis & { window?: EventTarget, KeyboardEvent?: unknown }} */ (
        globalThis
      ).window = fakeWindow;
      /** @type {typeof globalThis & { window?: EventTarget, KeyboardEvent?: unknown }} */ (
        globalThis
      ).KeyboardEvent = FakeKeyboardEvent;
      try {
        const session = createFakeSession();
        const renderer = createFakeRenderer();
        const hooks = createTestHooks({ session, renderer });
        /** @type {FakeKeyboardEvent | null} */
        let received = null;
        fakeWindow.addEventListener('keydown', (event) => {
          received = /** @type {FakeKeyboardEvent} */ (event);
        });

        hooks.pressKey(1, 'UP');

        expect(received?.code).toBe('KeyW');
      } finally {
        delete (/** @type {typeof globalThis & { window?: EventTarget } } */ (globalThis).window);
        delete (
          /** @type {typeof globalThis & { KeyboardEvent?: unknown } } */ (globalThis).KeyboardEvent
        );
      }
    });
  });

  describe('KS-03-06: pressKey against a real session (not just a fake one)', () => {
    it('KS-03-06: pressKey steers the player it names, through the real input module', () => {
      // `PLAYER_KEY_CODES` above mirrors `input.js`'s own key tables rather than importing them (`input.js`
      // does not export them). Every other `pressKey` test in this file only proves that mirror is
      // self-consistent — this one proves it actually agrees with `input.js`, by driving a *real*
      // `createSession` (not a fake) through the same event target and reading back a real
      // `RoundSimulation` snapshot. If a later sprint ever edits `input.js`'s tables without this file
      // following, this is the test that catches it — the others would keep passing while every
      // hook-driven e2e quietly tested a lie.
      const eventTarget = new NodeEventTarget();
      const renderer = {
        render: vi.fn(),
        resize: vi.fn(),
        getHeadWorldPosition: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
      };
      const ui = {
        // KS-04-03: `session.js` now also calls `showLaserWarning`/`tick`/`resetWarning` on the real HUD
        // interface; this fake needs the same three no-ops or the real session it drives would throw.
        hud: {
          setTime: vi.fn(),
          setLengths: vi.fn(),
          showLaserWarning: vi.fn(),
          tick: vi.fn(),
          resetWarning: vi.fn(),
        },
        showOverlay: vi.fn(),
        hideOverlay: vi.fn(),
      };
      const session = createSession({
        renderer,
        ui,
        seed: 1,
        inputTarget: eventTarget,
        requestFrame: () => 0,
        cancelFrame: () => {},
        visibilitySource: null,
      });
      const hooks = createTestHooks({
        session,
        renderer,
        eventTarget,
        KeyboardEventCtor: FakeKeyboardEvent,
      });

      // Enter starts a round (session's input mode is 'both', so a menu action fires alongside any
      // direction match — Enter has none, so this is CONFIRM only).
      eventTarget.dispatchEvent(new FakeKeyboardEvent('keydown', { code: 'Enter' }));

      // P1 spawns heading RIGHT, P2 heading LEFT (DESIGN-DECISIONS §2.3): UP and DOWN are legal turns for
      // both, so both queue cleanly.
      hooks.pressKey(1, 'UP');
      hooks.pressKey(2, 'DOWN');

      // 1 simulated second is 120 ticks at the default 120 Hz sim rate — several steps at the base 6
      // cells/s speed (a step every 20 ticks), comfortably enough for the queued turn to commit.
      hooks.fastForward(1);

      const snapshot = /** @type {{ snakes: { direction: { dx: number, dy: number } }[] }} */ (
        hooks.getSnapshot()
      );
      expect(snapshot.snakes[0].direction).toEqual(DIRECTIONS.UP);
      expect(snapshot.snakes[1].direction).toEqual(DIRECTIONS.DOWN);
    });
  });

  describe('getHeadWorldPosition', () => {
    it('KS-03-06: getHeadWorldPosition returns a plain {x, y, z}, structured-cloneable and nothing more', () => {
      const { hooks } = buildHooks({
        renderer: createFakeRenderer({ x: 4.5, y: 0, z: -1.25 }),
      });

      const position = hooks.getHeadWorldPosition(1);

      expect(position).toEqual({ x: 4.5, y: 0, z: -1.25 });
      expect(Object.keys(position).sort()).toEqual(['x', 'y', 'z']);
      expect(Object.getPrototypeOf(position)).toBe(Object.prototype);
    });

    it('KS-03-06: getHeadWorldPosition forwards the player number to the renderer', () => {
      const { hooks, renderer } = buildHooks();
      hooks.getHeadWorldPosition(2);
      expect(renderer.getHeadWorldPosition).toHaveBeenCalledWith(2);
    });
  });
});
