// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS } from '../../../src/core/settings.js';
import { createCpuPlayer } from '../../../src/game/cpuPlayer.js';
import { greedy } from '../../../src/game/bots/greedy.js';
import { MOVE_VECTORS } from '../../../src/game/bots/policy.js';
import { survivor } from '../../../src/game/bots/survivor.js';
import { STATES } from '../../../src/game/gameStateMachine.js';
import { createSession } from '../../../src/game/session.js';
import { runRound } from '../../sim/harness.js';

/**
 * KI-12-02 — driving a CPU player through the input queue.
 *
 * Two layers, matching `cpuPlayer.js`'s own two responsibilities:
 *
 * - `describe('createCpuPlayer', ...)` proves the module in isolation, with hand-built snapshots: once per
 *   grid step (not once per frame), `decisionIndex` from 0 per round, no `rules` field on the view a policy
 *   is handed (so it falls back to `PLAY_RULES` — no randomness, ever), a dead/absent snake never reaching
 *   the policy, and the named-move-to-`{dx,dy}` conversion `handleDirection` needs.
 * - The three `describe` blocks below it drive the real thing through `session.js`, the same way
 *   `tests/unit/game/session.test.js` does — a fake renderer and `ui`, a real Node `EventTarget` for the
 *   keyboard, and a real `RoundSimulation` underneath, because a session tested against a fake simulation
 *   would prove nothing about the queue it is meant to share.
 */

// --- createCpuPlayer, in isolation ---------------------------------------------------------------------

const GRID = { width: 24, height: 24 };

/**
 * A single-snake `PolicySnapshot` with its head at `head`, for exercising `createCpuPlayer` without a real
 * simulation underneath.
 *
 * @param {{x: number, y: number}} head
 * @param {{alive?: boolean, direction?: {dx: number, dy: number}, pendingGrowth?: number}} [options]
 */
function oneSnakeSnapshot(head, options = {}) {
  const { alive = true, direction = DIRECTIONS.RIGHT, pendingGrowth = 0 } = options;
  return {
    snakes: [
      {
        alive,
        segments: [head, { x: head.x - direction.dx, y: head.y - direction.dy }],
        direction,
        pendingGrowth,
      },
    ],
    apples: [],
    powerUps: { pickups: [] },
    lasers: { phase: 'PARKED', inset: 0 },
  };
}

describe('createCpuPlayer', () => {
  it('KI-12-02: asks the policy once per grid step, not once per frame', () => {
    const policy = vi.fn(() => 'UP');
    const cpu = createCpuPlayer({ playerNumber: 1, policy });

    const atFive = oneSnakeSnapshot({ x: 5, y: 5 });
    expect(cpu.decide(atFive, GRID)).toEqual(DIRECTIONS.UP);
    expect(policy).toHaveBeenCalledTimes(1);

    // The head has not moved since the last decision — a repeated frame, not a new grid step.
    expect(cpu.decide(atFive, GRID)).toBeNull();
    expect(policy).toHaveBeenCalledTimes(1);
    expect(cpu.decide(atFive, GRID)).toBeNull();
    expect(policy).toHaveBeenCalledTimes(1);

    // A new head cell is a new grid step: a fresh decision.
    const atSix = oneSnakeSnapshot({ x: 5, y: 6 });
    expect(cpu.decide(atSix, GRID)).toEqual(DIRECTIONS.UP);
    expect(policy).toHaveBeenCalledTimes(2);
  });

  it('KI-12-02: decisionIndex counts from 0 each round and reset() restarts it', () => {
    /** @type {number[]} */
    const seenIndexes = [];
    const policy = vi.fn((view) => {
      seenIndexes.push(view.decisionIndex);
      return null;
    });
    const cpu = createCpuPlayer({ playerNumber: 1, policy });

    cpu.decide(oneSnakeSnapshot({ x: 1, y: 1 }), GRID);
    cpu.decide(oneSnakeSnapshot({ x: 1, y: 2 }), GRID);
    cpu.decide(oneSnakeSnapshot({ x: 1, y: 3 }), GRID);
    expect(seenIndexes).toEqual([0, 1, 2]);

    cpu.reset();
    cpu.decide(oneSnakeSnapshot({ x: 1, y: 1 }), GRID);
    expect(seenIndexes).toEqual([0, 1, 2, 0]);
  });

  it('KI-12-02: builds a view with no `rules` field, so a policy falls back to PLAY_RULES (no randomness, ever)', () => {
    let sawRulesKey = true;
    const policy = vi.fn((view) => {
      sawRulesKey = 'rules' in view;
      return null;
    });
    const cpu = createCpuPlayer({ playerNumber: 1, policy });
    cpu.decide(oneSnakeSnapshot({ x: 2, y: 2 }), GRID);
    expect(policy).toHaveBeenCalledTimes(1);
    expect(sawRulesKey).toBe(false);
  });

  it('KI-12-02: a dead or missing snake never reaches the policy', () => {
    const policy = vi.fn(() => 'UP');

    const deadCpu = createCpuPlayer({ playerNumber: 1, policy });
    expect(deadCpu.decide(oneSnakeSnapshot({ x: 1, y: 1 }, { alive: false }), GRID)).toBeNull();
    expect(policy).not.toHaveBeenCalled();

    // playerNumber 2 indexes a snake this one-snake snapshot does not have.
    const missingCpu = createCpuPlayer({ playerNumber: 2, policy });
    expect(missingCpu.decide(oneSnakeSnapshot({ x: 1, y: 1 }), GRID)).toBeNull();
    expect(policy).not.toHaveBeenCalled();
  });

  it("KI-12-02: converts the policy's named move into the {dx,dy} handleDirection takes", () => {
    for (const [name, vector] of Object.entries(MOVE_VECTORS)) {
      const cpu = createCpuPlayer({ playerNumber: 1, policy: () => name });
      expect(cpu.decide(oneSnakeSnapshot({ x: 3, y: 3 }), GRID)).toBe(vector);
    }
  });

  it('KI-12-02: null (and undefined) both mean "press nothing"', () => {
    const cpuNull = createCpuPlayer({ playerNumber: 1, policy: () => null });
    expect(cpuNull.decide(oneSnakeSnapshot({ x: 4, y: 4 }), GRID)).toBeNull();

    const cpuUndefined = createCpuPlayer({ playerNumber: 1, policy: () => undefined });
    expect(cpuUndefined.decide(oneSnakeSnapshot({ x: 4, y: 4 }), GRID)).toBeNull();
  });
});

// --- driving a real session -----------------------------------------------------------------------------

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

function createFakeRenderer() {
  return { render: vi.fn(), resize: vi.fn(), camera: { pulseLaserWarning: vi.fn() } };
}

/** @param {(state: string, props?: object) => void} [onShow] */
function createFakeUi(onShow) {
  return {
    hud: {
      setTime: vi.fn(),
      setLengths: vi.fn(),
      showLaserWarning: vi.fn(),
      tick: vi.fn(),
      resetWarning: vi.fn(),
    },
    show: vi.fn((state, props) => onShow?.(state, props)),
    handleMenuAction: vi.fn(),
  };
}

/**
 * A session over the same fakes `tests/unit/game/session.test.js` uses — everything but the simulation
 * itself, which is real.
 *
 * @param {object} [overrides] - forwarded to `createSession`
 * @param {(state: string, props?: object) => void} [onShow] - called on every `ui.show`, before this file's
 *   own tests read anything from it
 */
function buildSession(overrides = {}, onShow) {
  const renderer = createFakeRenderer();
  const ui = createFakeUi(onShow);
  const target = new NodeEventTarget();
  const session = createSession({
    renderer,
    ui,
    seed: 1,
    inputTarget: target,
    requestFrame: () => 0,
    cancelFrame: () => {},
    visibilitySource: null,
    blurSource: null,
    ...overrides,
  });
  return { session, ui, target };
}

/**
 * Builds a session and registers a `CpuPlayer` for player 1 (and player 2, when given). Captures every
 * round's replay the instant its scoreboard opens — `sim` still holds the round that just ended at that
 * point (`session.js`'s own `enterRoundOver` comment), so `getReplay()` there is that round's complete,
 * final log.
 *
 * @param {object} options
 * @param {number} options.seed
 * @param {import('../../../src/game/bots/policy.js').Policy} options.policy1
 * @param {import('../../../src/game/bots/policy.js').Policy | null} [options.policy2]
 */
function buildCpuMatch({ seed, policy1, policy2 = null }) {
  /** @type {object[]} */
  const roundLogs = [];
  /** @type {ReturnType<typeof createSession>} */
  let session;
  const built = buildSession({ seed }, (state) => {
    if (state === STATES.ROUND_OVER) roundLogs.push(session.getReplay());
  });
  session = built.session;
  session.setCpuPlayer(1, policy1);
  if (policy2 !== null) session.setCpuPlayer(2, policy2);
  return { session, target: built.target, roundLogs };
}

/**
 * Runs `seconds` of wall time as `steps` equal frames — `tests/unit/game/session.test.js`'s own helper,
 * duplicated here rather than imported (neither module exports it, and this file stays self-contained).
 *
 * @param {ReturnType<typeof createSession>} session @param {number} seconds @param {number} [steps]
 */
function runFrames(session, seconds, steps = 1) {
  for (let i = 0; i < steps; i += 1) session.advanceSimulation(seconds / steps);
}

/** Gets a session from the main menu into PLAYING, countdown and all. */
function playTo(/** @type {ReturnType<typeof createSession>} */ session, overrides) {
  session.startMatch(overrides);
  runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.01, 8);
}

/**
 * Advances `session` in frames small enough that a grid step (`stepTicksFor` in `tests/sim/harness.js`, at
 * the shipping `snakeSpeed` ≈ 0.167 s a step) is never skipped over — the same reasoning `tests/agent/driver.js`
 * documents for its own `FRAME_SECONDS` — until `MATCH_OVER` or `maxFrames` runs out.
 *
 * @param {ReturnType<typeof createSession>} session
 * @param {{frameSeconds?: number, maxFrames?: number}} [options]
 * @returns {boolean} whether the match actually reached `MATCH_OVER`
 */
function driveToMatchOver(session, { frameSeconds = 1 / 30, maxFrames = 12000 } = {}) {
  for (let i = 0; i < maxFrames; i += 1) {
    if (session.getState() === STATES.MATCH_OVER) return true;
    session.advanceSimulation(frameSeconds);
  }
  return session.getState() === STATES.MATCH_OVER;
}

/** A bot that never decides anything — fixes the player count for a replay driven by its own `inputLog`. */
function noopBot() {
  return null;
}

describe('KI-12-02 AC1', () => {
  const seed = 20260907;

  function playOneCpuMatch() {
    const { session, roundLogs } = buildCpuMatch({ seed, policy1: greedy, policy2: survivor });
    session.startMatch({ bestOf: 1 });
    const finished = driveToMatchOver(session);
    return { finished, roundLogs, wins: session.getMatch()?.wins ?? null };
  }

  it('KI-12-02 AC1: a CPU-vs-CPU match on a fixed seed produces an identical event log on two runs', () => {
    const runA = playOneCpuMatch();
    const runB = playOneCpuMatch();

    expect(runA.finished).toBe(true);
    expect(runA.roundLogs.length).toBeGreaterThan(0);
    // The whole point: two independently-built sessions, same seed, same CPU policies, produce byte-identical
    // per-round replays (inputs and the full event log both) and the same match result.
    expect(runA.roundLogs).toEqual(runB.roundLogs);
    expect(runA.wins).toEqual(runB.wins);
  });

  it(
    "KI-12-02 AC1: the CPU's recorded inputs replay identically through tests/sim/harness.js's runRound " +
      "(this repository's own replay mechanism today — I05's player does not exist yet)",
    () => {
      const { roundLogs } = playOneCpuMatch();
      expect(roundLogs.length).toBeGreaterThan(0);

      const firstRound = /** @type {any} */ (roundLogs[0]);
      const replayed = runRound({
        seed: firstRound.seed,
        bots: [noopBot, noopBot],
        inputLog: firstRound.inputs,
      });

      expect(replayed.events).toEqual(firstRound.expectedEvents);
    },
  );
});

describe('KI-12-02 AC2', () => {
  it('KI-12-02 AC2: a reversal is rejected for a CPU exactly as it is for a human', () => {
    // P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); LEFT is its exact reverse and must never
    // reach the queue, from a policy any more than from a keyboard.
    const alwaysReverse = () => /** @type {const} */ ('LEFT');

    const { session: cpuSession } = buildCpuMatch({ seed: 5, policy1: alwaysReverse });
    playTo(cpuSession);
    const cpuQueue = cpuSession.getSim()?.snakes[0].queue;

    const { session: humanSession, target } = buildSession({ seed: 5 });
    playTo(humanSession);
    fireKeydown(target, 'KeyA'); // player 1's LEFT key: the identical reversal, from `input.js` itself.
    const humanQueue = humanSession.getSim()?.snakes[0].queue;

    expect(cpuQueue).toEqual([]);
    expect(humanQueue).toEqual([]);
    expect(cpuQueue).toEqual(humanQueue);
  });

  it('KI-12-02 AC2: an accepted CPU turn is queued and recorded exactly like a keyboard turn', () => {
    const turnUp = () => /** @type {const} */ ('UP');
    const { session } = buildCpuMatch({ seed: 11, policy1: turnUp });
    playTo(session);

    // `inputBufferSize` (2) and the replay recorder both live in `handleDirection`; a CPU reaching either
    // proves it went through the same function a keydown does, not a second path into `sim.applyInput`.
    const replay = session.getReplay();
    expect(replay.inputs.length).toBeGreaterThan(0);
    expect(replay.inputs[0]).toEqual({ t: expect.any(Number), player: 'p1', dir: 'UP' });
    // Accepted into the real queue `Snake.commitStep` will consume on the next grid step — not yet the
    // snake's committed `direction`, which only changes once that step actually happens.
    expect(session.getSim()?.snakes[0].queue).toEqual([DIRECTIONS.UP]);
  });
});

describe('KI-12-02 AC3', () => {
  it('KI-12-02 AC3: PAUSE stops the CPU — its policy is never even consulted, and nothing is enqueued', () => {
    const policy = vi.fn(() => null);
    const { session } = buildCpuMatch({ seed: 3, policy1: policy });
    playTo(session);
    // A few grid steps so the policy has already answered at least once before pausing.
    runFrames(session, 1, 10);

    const callsBeforePause = policy.mock.calls.length;
    const inputsBeforePause = session.getReplay().inputs.length;
    expect(callsBeforePause).toBeGreaterThan(0);

    session.pause();
    expect(session.getState()).toBe(STATES.PAUSE);

    // Plenty of wall time, all of it frozen: if the policy were merely being ignored rather than never asked,
    // this many frames would still grow `policy.mock.calls.length`.
    runFrames(session, 5, 25);

    expect(policy.mock.calls.length).toBe(callsBeforePause);
    expect(session.getReplay().inputs.length).toBe(inputsBeforePause);
    expect(session.getState()).toBe(STATES.PAUSE);
  });

  it('KI-12-02 AC3: resuming lets the CPU decide again, through the same READY? beat a human waits out', () => {
    const policy = vi.fn(() => null);
    const { session } = buildCpuMatch({ seed: 3, policy1: policy });
    playTo(session);
    runFrames(session, 1, 10);
    session.pause();
    session.resume();

    const callsDuringReady = policy.mock.calls.length;
    // Still frozen through the one-second READY? beat (`DESIGN-DECISIONS §2.8`).
    runFrames(session, 0.5, 5);
    expect(policy.mock.calls.length).toBe(callsDuringReady);

    // Past it, the CPU is asked again like anyone else.
    runFrames(session, 1, 10);
    expect(policy.mock.calls.length).toBeGreaterThan(callsDuringReady);
  });
});
