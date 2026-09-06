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

/**
 * The shape `session.js` gives `createTestHooks` (`TestHooksSession`). It grew in KS-05-03 with the state
 * machine and the flow controls `__kobi` now exposes (`ARCHITECTURE §11`).
 */
function createFakeSession() {
  return {
    getSim: vi.fn(() => null),
    machine: { getState: vi.fn(() => 'MAIN_MENU') },
    getState: vi.fn(() => 'MAIN_MENU'),
    advanceSimulation: vi.fn(),
    renderFrame: vi.fn(),
    setSeed: vi.fn(),
    startMatch: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getSeeds: vi.fn(() => ({ matchSeed: 0, roundIndex: 0, roundSeeds: [] })),
    getMatch: vi.fn(() => null),
    getMatchSettings: vi.fn(() => ({ bestOf: 3 })),
    getTimeScale: vi.fn(() => 1),
  };
}

/** @param {{x?: number, y?: number, z?: number}} [position] */
function createFakeRenderer(position = { x: 1, y: 2, z: 3 }) {
  return {
    getHeadWorldPosition: vi.fn(() => ({ x: 0, y: 0, z: 0, ...position })),
    getDrawCalls: vi.fn(() => 0),
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
    it('KS-05-03: stateMachine is the session’s real machine, not a copy of its state', () => {
      const { hooks, session } = buildHooks();
      expect(hooks.stateMachine).toBe(session.machine);
    });

    it('KS-05-03: getState() reports the current state as a plain string', () => {
      // A Playwright spec reads this through `page.evaluate`, where the machine object itself would not
      // survive the structured clone but a string does.
      const { hooks, session } = buildHooks();
      session.getState.mockReturnValue('PLAYING');
      expect(hooks.getState()).toBe('PLAYING');
    });
  });

  describe('KS-05-03: the flow controls', () => {
    it('KS-05-03: startMatch/pause/resume forward straight to the session', () => {
      const { hooks, session } = buildHooks();
      hooks.startMatch({ bestOf: 5 });
      hooks.pause();
      hooks.resume();
      expect(session.startMatch).toHaveBeenCalledWith({ bestOf: 5 });
      expect(session.pause).toHaveBeenCalled();
      expect(session.resume).toHaveBeenCalled();
    });

    it('KS-05-03: getSeeds exposes the match seed and its derived round seeds, for replays', () => {
      const { hooks, session } = buildHooks();
      session.getSeeds.mockReturnValue({ matchSeed: 7, roundIndex: 1, roundSeeds: [11, 22] });
      expect(hooks.getSeeds()).toEqual({ matchSeed: 7, roundIndex: 1, roundSeeds: [11, 22] });
    });

    it('KS-05-03: getMatch is null outside a match', () => {
      const { hooks } = buildHooks();
      expect(hooks.getMatch()).toBeNull();
    });

    it('KS-05-03: getMatch flattens MatchState into something a page.evaluate can carry back', () => {
      const { hooks, session } = buildHooks();
      session.getMatch.mockReturnValue({
        bestOf: 3,
        target: 2,
        rewardKeys: 1,
        wins: { 1: 1, 2: 0 },
        roundsPlayed: 1,
        winner: null,
        isOver: () => false,
        winsNeeded: (/** @type {number} */ player) => (player === 1 ? 1 : 2),
      });

      const match = /** @type {any} */ (hooks.getMatch());
      // Methods, which a structured clone drops silently, are evaluated into plain values here instead.
      expect(match.isOver).toBe(false);
      expect(match.winsNeeded).toEqual({ 1: 1, 2: 2 });
      expect(match.wins).toEqual({ 1: 1, 2: 0 });
      expect(JSON.parse(JSON.stringify(match))).toEqual(match);
    });

    it('KS-05-03: getMatchSettings forwards the session’s copy', () => {
      const { hooks } = buildHooks();
      expect(hooks.getMatchSettings()).toEqual({ bestOf: 3 });
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
    /**
     * The seconds every `advanceSimulation` call was given, in order, and where the single render fell.
     *
     * @param {ReturnType<typeof buildHooks>} built
     */
    function recordCalls({ session }) {
      const chunks = /** @type {number[]} */ ([]);
      const order = /** @type {string[]} */ ([]);
      session.advanceSimulation.mockImplementation((/** @type {number} */ seconds) => {
        chunks.push(seconds);
        order.push('advance');
      });
      session.renderFrame.mockImplementation(() => order.push('render'));
      return { chunks, order };
    }

    it('KS-03-06: fastForward(seconds) drives session.advanceSimulation then session.renderFrame() once, in order', () => {
      const built = buildHooks();
      const { chunks, order } = recordCalls(built);

      built.hooks.fastForward(90);

      expect(chunks.reduce((sum, chunk) => sum + chunk, 0)).toBeCloseTo(90, 9);
      expect(built.session.renderFrame).toHaveBeenCalledTimes(1);
      expect(new Set(order.slice(0, -1))).toEqual(new Set(['advance']));
      expect(order[order.length - 1]).toBe('render');
    });

    it('KS-06-00: fastForward advances in frame-sized chunks, never one enormous frame (#84)', () => {
      const built = buildHooks();
      const { chunks } = recordCalls(built);

      built.hooks.fastForward(90);

      // 0.1 s is `loop.js`'s own `maxFrameSeconds`: the longest frame a real browser can ever produce
      // (`ARCHITECTURE §5`). No chunk may exceed it, or this tool is testing a path the browser never takes.
      expect(Math.max(...chunks)).toBeLessThanOrEqual(0.1 + 1e-9);
      expect(chunks.length).toBe(900);
    });

    it('KS-06-00: a fast-forward shorter than one chunk is still a single advance', () => {
      const built = buildHooks();
      const { chunks, order } = recordCalls(built);

      built.hooks.fastForward(0.05);

      expect(chunks).toEqual([0.05]);
      expect(order).toEqual(['advance', 'render']);
    });

    it('KS-06-00: fastForward(0) advances nothing and still renders one frame', () => {
      const built = buildHooks();
      const { chunks, order } = recordCalls(built);

      // `tests/e2e/helpers.js` uses exactly this to photograph a paused round.
      built.hooks.fastForward(0);

      expect(chunks).toEqual([]);
      expect(order).toEqual(['render']);
    });
  });

  describe('KS-06-00 AC3: getTimeScale', () => {
    it('KS-06-00: getTimeScale reads the session’s live loop scale, so a spec can see the slow-mo beat', () => {
      const { hooks, session } = buildHooks();
      session.getTimeScale.mockReturnValueOnce(0.25).mockReturnValueOnce(1);

      expect(hooks.getTimeScale()).toBe(0.25);
      expect(hooks.getTimeScale()).toBe(1);
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
        // KS-04-03: `session.js` also calls `showLaserWarning`/`tick`/`resetWarning` on the real HUD
        // interface; this fake needs the same three no-ops or the real session it drives would throw.
        hud: {
          setTime: vi.fn(),
          setLengths: vi.fn(),
          showLaserWarning: vi.fn(),
          tick: vi.fn(),
          resetWarning: vi.fn(),
        },
        // KS-05-03: and the screen router.
        show: vi.fn(),
        handleMenuAction: vi.fn(),
      };
      const session = createSession({
        renderer,
        ui,
        seed: 1,
        inputTarget: eventTarget,
        requestFrame: () => 0,
        cancelFrame: () => {},
        visibilitySource: null,
        blurSource: null,
      });
      const hooks = createTestHooks({
        session,
        renderer,
        eventTarget,
        KeyboardEventCtor: FakeKeyboardEvent,
      });

      // KS-05-03: a round is reached through the real flow now — the main menu and the setup screen, in one
      // call — and then the 3 · 2 · 1 · GO countdown, which `fastForward` drives like any other wall time.
      hooks.startMatch();
      hooks.fastForward(4);

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

  describe('getDrawCalls', () => {
    it("KS-04-02: getDrawCalls forwards three's own render-call counter", () => {
      const renderer = createFakeRenderer();
      renderer.getDrawCalls = vi.fn(() => 42);
      const { hooks } = buildHooks({ renderer });

      expect(hooks.getDrawCalls()).toBe(42);
      expect(renderer.getDrawCalls).toHaveBeenCalled();
    });
  });
});
