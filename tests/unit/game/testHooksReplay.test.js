// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { createTestHooks } from '../../../src/game/testHooks.js';

/**
 * #233 — the thirteen `__kobi` methods no unit test called: the eleven replay hooks KI-05-02/KI-05-03 added,
 * plus `getInputStats` (KS-07-06) and `getRenderedSnapshot`. They are what took `testHooks.js` to 61.76 %
 * function coverage on `main` against CI's 75 % per-file gate.
 *
 * **These are delegation contracts, and that is the whole of what they should assert.** Every method under
 * test is a one-line forward to `session.js` with no logic of its own (`testHooks.js`'s own comment says so),
 * and the behaviour behind them is tested where it lives — `replayPlayer.test.js`,
 * `replayPlayerPlayback.test.js` and `session.test.js`. Re-testing that behaviour through the facade would
 * duplicate those suites without adding a guarantee. What is *not* covered anywhere else, and is asserted
 * here, is the wiring: that each hook reaches the right session method, passes its arguments through
 * unchanged, and returns what the session returned. That is exactly the class of mistake a facade invites —
 * a hook wired to its neighbour, an argument dropped, a return value swallowed — and each test below fails
 * on it.
 *
 * The fake session is `testHooks.test.js`'s own `createFakeSession` pattern, extended with the replay
 * methods; `createTestHooks` never touches `window`, so no DOM is needed.
 */

const NodeEvent = globalThis.Event;
const NodeEventTarget = globalThis.EventTarget;

/** A minimal stand-in for a browser `KeyboardEvent` (the pattern `testHooks.test.js` and `input.test.js` use). */
class FakeKeyboardEvent extends NodeEvent {
  /** @param {string} type @param {{code?: string}} [init] */
  constructor(type, init = {}) {
    super(type, {});
    this.code = init.code;
  }
}

function createFakeSession() {
  return {
    getSim: vi.fn(() => null),
    machine: { getState: vi.fn(() => 'MAIN_MENU') },
    getState: vi.fn(() => 'MAIN_MENU'),
    advanceSimulation: vi.fn(),
    renderFrame: vi.fn(),
    setSeed: vi.fn(),
    startMatch: vi.fn(),
    setCpuPlayer: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    getSeeds: vi.fn(() => ({ matchSeed: 0, roundIndex: 0, roundSeeds: [] })),
    getMatch: vi.fn(() => null),
    getMatchSettings: vi.fn(() => ({ bestOf: 3 })),
    getTimeScale: vi.fn(() => 1),
    getInputStats: vi.fn(() => ({ samples: 7 })),
    getRenderedSnapshot: vi.fn(() => ({ tick: 11 })),
    loadReplay: vi.fn(() => ({ ok: true })),
    playReplay: vi.fn(),
    pauseReplay: vi.fn(),
    isReplayPlaying: vi.fn(() => true),
    stepReplay: vi.fn(() => true),
    seekReplay: vi.fn(),
    advanceReplayFrame: vi.fn(),
    getReplayTick: vi.fn(() => 42),
    getReplayPhase: vi.fn(() => 'PLAYING'),
    getReplayEvents: vi.fn(() => [{ type: 'FOOD_SPAWNED' }]),
    getReplaySnapshot: vi.fn(() => ({ tick: 42 })),
  };
}

function build() {
  const session = createFakeSession();
  const hooks = createTestHooks({
    session,
    renderer: { getDrawCalls: () => 0 },
    eventTarget: new NodeEventTarget(),
    KeyboardEventCtor: FakeKeyboardEvent,
  });
  return { session, hooks };
}

/**
 * Each row is one forward: the hook, the session method it must reach, the arguments it must pass through
 * unchanged, and the value it must hand back. Driving them from a table means a hook added to `testHooks.js`
 * without a row here is visible as an omission rather than silently uncovered.
 *
 * @type {{hook: string, method: string, args: unknown[], returns?: unknown}[]}
 */
const FORWARDS = [
  { hook: 'getInputStats', method: 'getInputStats', args: [], returns: { samples: 7 } },
  { hook: 'getRenderedSnapshot', method: 'getRenderedSnapshot', args: [], returns: { tick: 11 } },
  { hook: 'loadReplay', method: 'loadReplay', args: ['{"seed":1}'], returns: { ok: true } },
  { hook: 'playReplay', method: 'playReplay', args: [] },
  { hook: 'pauseReplay', method: 'pauseReplay', args: [] },
  { hook: 'isReplayPlaying', method: 'isReplayPlaying', args: [], returns: true },
  { hook: 'stepReplay', method: 'stepReplay', args: [], returns: true },
  { hook: 'seekReplay', method: 'seekReplay', args: [120] },
  { hook: 'advanceReplayFrame', method: 'advanceReplayFrame', args: [1 / 60] },
  { hook: 'getReplayTick', method: 'getReplayTick', args: [], returns: 42 },
  { hook: 'getReplayPhase', method: 'getReplayPhase', args: [], returns: 'PLAYING' },
  {
    hook: 'getReplayEvents',
    method: 'getReplayEvents',
    args: [],
    returns: [{ type: 'FOOD_SPAWNED' }],
  },
  { hook: 'getReplaySnapshot', method: 'getReplaySnapshot', args: [], returns: { tick: 42 } },
];

describe('#233 · __kobi forwards every replay hook to the session', () => {
  for (const { hook, method, args, returns } of FORWARDS) {
    it(`#233: ${hook} calls session.${method} with its arguments and returns its result`, () => {
      const { session, hooks } = build();
      const result = /** @type {any} */ (hooks)[hook](...args);

      expect(/** @type {any} */ (session)[method]).toHaveBeenCalledTimes(1);
      expect(/** @type {any} */ (session)[method]).toHaveBeenCalledWith(...args);
      if (returns !== undefined) expect(result).toEqual(returns);
    });
  }

  it('#233: a hook reaches only its own session method, never a neighbour', () => {
    // The failure mode a table of one-line forwards actually has: two adjacent hooks wired to the same
    // method. Calling each in turn and counting every method once catches a swap that the per-hook
    // assertions above, taken one at a time, would not.
    const { session, hooks } = build();
    for (const { hook, args } of FORWARDS) /** @type {any} */ (hooks)[hook](...args);

    for (const { method } of FORWARDS) {
      expect(
        /** @type {any} */ (session)[method],
        `${method} was not called exactly once`,
      ).toHaveBeenCalledTimes(1);
    }
  });

  it('#233: the forward table covers every replay hook the facade exposes', () => {
    // Guards the table itself: a hook added to `testHooks.js` without a row here would otherwise be
    // uncovered again, which is the exact regression #233 is about.
    const { hooks } = build();
    const replayHooks = Object.keys(hooks).filter((name) => /Replay/.test(name));
    const covered = FORWARDS.map((f) => f.hook);
    expect(replayHooks.filter((name) => !covered.includes(name))).toEqual([]);
  });
});
