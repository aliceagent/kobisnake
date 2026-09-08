// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { RESULTS } from '../../../src/core/events.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { REPLAY_ERROR_CODES } from '../../../src/core/replay.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { GAME_EVENTS, STATES } from '../../../src/game/gameStateMachine.js';
import {
  MATCH_SETUP_APPLE_CELL,
  createSession,
  formatTime,
  roundSeedFor,
} from '../../../src/game/session.js';
import { runRound } from '../../sim/harness.js';

/** KI-05-03: a real, committed fixture — the same shape a paste box or a chosen file hands `onLoad`. */
const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../sim/replays');
const NO_INPUT_ROUND = JSON.parse(readFileSync(join(REPLAYS_DIR, 'no-input-round.json'), 'utf8'));

/** KI-12-04: the pre-ticket golden fixture for AC1's byte-identical proof. */
const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '__golden__');

/**
 * KS-05-03: the session rewritten around the state machine.
 *
 * The ticket's `QA:` line names `tests/e2e/match-flow.spec.js`, and that spec exists and drives the same four
 * acceptance criteria through a real browser. This file proves them in Node as well, and it is the more
 * searching of the two: a browser spec can watch a match play out, but only here can a test hold a frame at
 * 0.05 s and check what the timer read either side of a pause, or run the crash slow-mo beat one frame at a
 * time and watch `loop.timeScale` go 1 → 0.25 → 1 while the scoreboard stays away. Timing is most of what
 * this ticket is made of, so timing is tested where timing can be pinned down exactly.
 *
 * Everything around the session is a fake: a fake renderer and a fake `ui` (`session.js` never imports
 * three.js and never touches the DOM), a real `EventTarget` for the keyboard, and a no-op frame scheduler so
 * every frame is driven by hand. The one thing deliberately *not* faked is the simulation — the rounds below
 * are real `RoundSimulation`s crashing into real walls, because a session tested against a fake simulation
 * would prove nothing about the flow it exists to drive.
 */

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

/**
 * The screen router `session.js` talks to (`SessionUi`). `show` records every call, so a test can ask what
 * the player would be looking at and with which props.
 */
function createFakeUi() {
  return {
    hud: {
      setTime: vi.fn(),
      setLengths: vi.fn(),
      showLaserWarning: vi.fn(),
      tick: vi.fn(),
      resetWarning: vi.fn(),
    },
    show: vi.fn(),
    handleMenuAction: vi.fn(),
    // KI-05-03: the REPLAY screen's cheap per-frame update (`runUpdate`'s new `REPLAY` case; `ui.js`'s own
    // `updateReplayProgress`).
    updateReplayProgress: vi.fn(),
  };
}

/** A stand-in for a window, for the `blur` that triggers AUTO_PAUSE (`DESIGN-DECISIONS §2.8`). */
function createFakeBlurSource() {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    /** @param {string} type @param {() => void} listener */
    addEventListener(type, listener) {
      if (type === 'blur') listeners.add(listener);
    },
    /** @param {string} type @param {() => void} listener */
    removeEventListener(type, listener) {
      if (type === 'blur') listeners.delete(listener);
    },
    blur() {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

/** A stand-in for `document`'s visibility half (the same fake `loop.test.js` uses). */
function createFakeVisibility() {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    hidden: false,
    /** @param {string} type @param {() => void} listener */
    addEventListener(type, listener) {
      if (type === 'visibilitychange') listeners.add(listener);
    },
    /** @param {string} type @param {() => void} listener */
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

/** @param {object} [overrides] - forwarded to `createSession`, on top of the fakes below. */
function buildSession(overrides = {}) {
  const renderer = createFakeRenderer();
  const ui = createFakeUi();
  const target = new NodeEventTarget();
  const blurSource = createFakeBlurSource();

  const session = createSession({
    renderer,
    ui,
    seed: 1,
    inputTarget: target,
    requestFrame: () => 0,
    cancelFrame: () => {},
    visibilitySource: null,
    blurSource,
    ...overrides,
  });

  return { session, renderer, ui, target, blurSource };
}

/**
 * The props of the most recent `ui.show(state, props)` call for `state`.
 * @param {any} ui @param {string} state
 */
function lastShow(ui, state) {
  const calls = ui.show.mock.calls.filter((/** @type {any[]} */ call) => call[0] === state);
  return calls.length === 0 ? undefined : calls[calls.length - 1][1];
}

/** Every label the countdown screen has been given, in order. @param {any} ui */
function countdownLabels(ui) {
  return ui.show.mock.calls
    .filter((/** @type {any[]} */ call) => call[0] === STATES.COUNTDOWN)
    .map((/** @type {any[]} */ call) => call[1].label);
}

/**
 * Runs `seconds` of wall time as `steps` equal frames, through the session's real update path. Several
 * small frames rather than one big one, because the transitions this file is about happen *between* frames
 * and a single 3-second frame would step over most of them.
 *
 * @param {any} session @param {number} seconds @param {number} [steps]
 */
function runFrames(session, seconds, steps = 1) {
  for (let i = 0; i < steps; i += 1) session.advanceSimulation(seconds / steps);
}

/** Gets a session from the main menu into PLAYING, countdown and all. @param {any} session */
function playTo(session, overrides) {
  session.startMatch(overrides);
  runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.01, 8);
}

/**
 * Steers player 1 into the top wall and runs on until the round is over, slow-mo beat included.
 *
 * P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); turning UP is legal and, left uncorrected,
 * kills it twelve grid steps later — exactly 2.0 simulated seconds at 6 cells/s. P2 gets no input and does
 * not reach the opposite wall until ≈ 3.167 s (the golden no-input log's own timing), so P1 dies alone and
 * P2 wins the round. The same trick Sprint 03's e2e used, for the same reason: it is the shortest scripted,
 * deterministic, non-draw round in the game.
 *
 * @param {any} session @param {EventTarget} target
 */
function crashPlayerOne(session, target) {
  fireKeydown(target, 'KeyW');
  runFrames(session, 2.1, 42);
  // The crash slow-mo beat is 0.6 s of *wall* time (`crashSlowMo.duration`), during which the machine is
  // still PLAYING; these frames carry it through to the scoreboard.
  runFrames(session, SETTINGS.crashSlowMo.duration + 0.05, 14);
}

describe('formatTime', () => {
  it('KS-03-05 AC2: 90 seconds formats as 1:30 and 0 seconds formats as 0:00', () => {
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(0)).toBe('0:00');
  });

  it('pads single-digit seconds and floors fractional ones', () => {
    expect(formatTime(65.9)).toBe('1:05');
    expect(formatTime(-3)).toBe('0:00');
  });
});

describe('KS-05-03 round seeds', () => {
  it('KS-05-03 AC4: a round seed is a pure function of the match seed and the round index', () => {
    // Pure: asked for out of order, twice, from nothing but the two numbers.
    expect(roundSeedFor(1234, 2)).toBe(roundSeedFor(1234, 2));
    expect(roundSeedFor(1234, 0)).not.toBe(roundSeedFor(1234, 1));
    expect(roundSeedFor(1234, 1)).not.toBe(roundSeedFor(1234, 2));
    expect(roundSeedFor(1234, 0)).not.toBe(roundSeedFor(5678, 0));
  });

  it('KS-05-03 AC4: the rounds a match plays use exactly those seeds, in order', () => {
    const { session, target } = buildSession({ seed: 4242 });
    playTo(session, { bestOf: 3 });
    expect(session.getSeeds().matchSeed).toBe(4242);
    expect(session.getSim()?.seed).toBe(roundSeedFor(4242, 0));

    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getSim()?.seed).toBe(roundSeedFor(4242, 1));
    expect(session.getSeeds().roundSeeds).toEqual([roundSeedFor(4242, 0), roundSeedFor(4242, 1)]);
    // Different boards from round to round, which is the point of deriving rather than reusing.
    expect(session.getSeeds().roundSeeds[0]).not.toBe(session.getSeeds().roundSeeds[1]);
  });

  it('KS-05-03: without a fixed seed the match seed is drawn once per match, not once per round', () => {
    let next = 100;
    const { session, target } = buildSession({
      seed: null,
      randomSeed: () => {
        next += 1;
        return next;
      },
    });
    playTo(session, { bestOf: 3 });
    const first = session.getSeeds().matchSeed;

    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    expect(session.getSeeds().matchSeed).toBe(first);
    expect(session.getSim()?.seed).toBe(roundSeedFor(first, 1));
  });
});

describe('KS-05-03 the main menu and match setup', () => {
  it('KS-05-03: the game boots into MAIN_MENU with no match and no round', () => {
    const { session, ui } = buildSession();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
    expect(session.getSim()).toBeNull();
    expect(session.getMatch()).toBeNull();
    expect(ui.show).toHaveBeenCalledWith(STATES.MAIN_MENU, expect.any(Object));
  });

  it('KS-05-03: the menu screen can only fire events the machine accepts', () => {
    const { session, ui } = buildSession();
    lastShow(ui, STATES.MAIN_MENU).onSelect('SELECT_2P');
    expect(session.getState()).toBe(STATES.MATCH_SETUP);

    // An event with no row from the current state is refused rather than thrown at the machine, so a screen
    // wired to a future state cannot crash the game in development.
    lastShow(ui, STATES.MATCH_SETUP).onBack();
    expect(() => lastShow(ui, STATES.MAIN_MENU).onSelect('COUNTDOWN_DONE')).not.toThrow();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
  });

  it('KS-05-03: the setup screen edits the session’s copy of the match settings and re-renders', () => {
    const { session, ui } = buildSession();
    lastShow(ui, STATES.MAIN_MENU).onSelect('SELECT_2P');

    const props = lastShow(ui, STATES.MATCH_SETUP);
    expect(props.ownedColors).toEqual(['red', 'blue']);
    props.onChange({ ...props.matchSettings, bestOf: 5, colors: { 1: 'blue', 2: 'red' } });

    expect(session.getMatchSettings().bestOf).toBe(5);
    expect(lastShow(ui, STATES.MATCH_SETUP).matchSettings.bestOf).toBe(5);
  });

  it('KS-05-03: a match is played on the settings the setup screen left behind', () => {
    const { session, ui } = buildSession();
    lastShow(ui, STATES.MAIN_MENU).onSelect('SELECT_2P');
    const props = lastShow(ui, STATES.MATCH_SETUP);
    props.onChange({ ...props.matchSettings, bestOf: 5, colors: { 1: 'blue', 2: 'red' } });
    props.onStart();

    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getMatch()?.bestOf).toBe(5);
    // The chosen colours reach the simulation snapshot, which is where the renderer reads them from.
    const snapshot = /** @type {any} */ (/** @type {any} */ (session.getSim()).getState());
    expect(snapshot.snakes.map((/** @type {any} */ snake) => snake.color)).toEqual(['blue', 'red']);
  });

  it('KS-05-03: getMatchSettings hands back a copy, not the session’s own object', () => {
    const { session } = buildSession();
    const copy = session.getMatchSettings();
    copy.bestOf = 999;
    copy.colors[1] = 'gold';
    expect(session.getMatchSettings().bestOf).not.toBe(999);
    expect(session.getMatchSettings().colors[1]).toBe('red');
  });

  it('KS-05-03: menu keys are handed to the active screen, not interpreted here', () => {
    const { ui, target } = buildSession();
    fireKeydown(target, 'ArrowDown');
    fireKeydown(target, 'Enter');
    expect(ui.handleMenuAction.mock.calls.map((/** @type {any[]} */ c) => c[0])).toEqual([
      'DOWN',
      'CONFIRM',
    ]);
  });

  it('KS-05-03: startMatch() is only legal from the main menu', () => {
    const { session } = buildSession();
    session.startMatch();
    expect(() => session.startMatch()).toThrow(/only from MAIN_MENU/);
  });
});

describe('KS-05-03 the countdown', () => {
  it('KS-05-03: shows 3, 2, 1, GO at countdownStepSeconds each, then plays', () => {
    const { session, ui } = buildSession();
    session.startMatch();
    expect(countdownLabels(ui)).toEqual(['3']);

    // A hair past each boundary rather than exactly on it: `countdownElapsed` is a running sum of frame
    // durations, so landing on 0.8 exactly is a coin toss between 0.7999999999999999 and 0.8000000000000003.
    // What the design fixes is that each label lasts `countdownStepSeconds`, not what happens on the tick
    // that is neither side of it.
    const step = SETTINGS.countdownStepSeconds;
    const justPast = step + 0.001;

    runFrames(session, justPast, 4);
    expect(countdownLabels(ui)).toEqual(['3', '2']);
    runFrames(session, justPast, 4);
    expect(countdownLabels(ui)).toEqual(['3', '2', '1']);
    runFrames(session, justPast, 4);
    expect(countdownLabels(ui)).toEqual(['3', '2', '1', 'GO']);
    expect(session.getState()).toBe(STATES.COUNTDOWN);

    runFrames(session, justPast, 4);
    expect(session.getState()).toBe(STATES.PLAYING);
  });

  it('KS-05-03: the snakes are frozen through the countdown, and the HUD already reads 1:30', () => {
    const { session, ui } = buildSession();
    session.startMatch();
    runFrames(session, SETTINGS.countdownStepSeconds * 3, 12);
    expect(session.getSim()?.tick).toBe(0);
    expect(ui.hud.setTime).toHaveBeenCalledWith('1:30');
  });

  it('KS-05-03: inputs are queued during GO and ignored before it (`DESIGN-DECISIONS §2.4`)', () => {
    const { session, target } = buildSession();
    session.startMatch();

    // During "3": too early.
    fireKeydown(target, 'KeyW');
    expect(session.getSim()?.snakes[0].queue).toEqual([]);

    // During "GO": queued, ready for the first tick of PLAYING.
    runFrames(session, SETTINGS.countdownStepSeconds * 3 + 0.01, 12);
    fireKeydown(target, 'KeyW');
    expect(session.getSim()?.snakes[0].queue).toEqual([DIRECTIONS.UP]);
  });

  it('KS-05-03: mashing Enter through the countdown changes nothing (sprint QA plan)', () => {
    const { session, ui, target } = buildSession();
    session.startMatch();
    ui.handleMenuAction.mockClear();

    for (let i = 0; i < 20; i += 1) {
      fireKeydown(target, 'Enter');
      session.advanceSimulation(0.02);
    }

    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getSeeds().roundIndex).toBe(0);
    expect(session.getSeeds().roundSeeds).toHaveLength(1);
    expect(ui.handleMenuAction).not.toHaveBeenCalled();
  });
});

describe('KS-05-03 a round ending', () => {
  it('KS-05-03: a crash runs the slow-mo beat before the scoreboard, on wall time', () => {
    const { session, target } = buildSession();
    playTo(session);

    fireKeydown(target, 'KeyW');
    runFrames(session, 2.1, 42);

    // Still PLAYING, and time is running at `crashSlowMo.scale` (`DESIGN-DECISIONS §2.5`).
    expect(session.getState()).toBe(STATES.PLAYING);
    expect(session.loop.timeScale).toBe(SETTINGS.crashSlowMo.scale);

    // Not over a moment before the beat is. The crash lands at exactly 2.0 s, so 0.1 s of the 0.6 s has
    // already gone by above; 0.4 s more leaves 0.1 s of beat still to play.
    runFrames(session, 0.4, 8);
    expect(session.getState()).toBe(STATES.PLAYING);

    runFrames(session, 0.2, 4);
    expect(session.getState()).toBe(STATES.ROUND_OVER);
    expect(session.loop.timeScale).toBe(1);
  });

  it('KS-05-03: a round that ends on the clock goes straight to the scoreboard, with no beat', () => {
    const settings = withOverrides({ roundDuration: 2 });
    const { session } = buildSession({ settings });
    playTo(session);

    runFrames(session, 2.2, 22);
    expect(session.getState()).toBe(STATES.ROUND_OVER);
    expect(session.loop.timeScale).toBe(1);
  });

  it('KS-05-03: the scoreboard carries the wins, the needs and the format', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 5 });
    crashPlayerOne(session, target);

    const props = lastShow(ui, STATES.ROUND_OVER);
    expect(props.bestOf).toBe(5);
    expect(props.result).toBe(RESULTS.P2_WIN);
    expect(props.wins).toEqual({ 1: 0, 2: 1 });
    expect(props.winsNeeded).toEqual({ 1: 3, 2: 2 });
    expect(props.colorNames).toEqual({ 1: 'red', 2: 'blue' });
  });

  it('KS-05-03: the scoreboard lasts scoreboardSeconds and then the next round counts in', () => {
    const { session, target } = buildSession();
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);

    runFrames(session, SETTINGS.scoreboardSeconds - 0.2, 10);
    expect(session.getState()).toBe(STATES.ROUND_OVER);
    runFrames(session, 0.3, 3);
    expect(session.getState()).toBe(STATES.COUNTDOWN);
  });

  it('KS-05-03: Enter skips the scoreboard, but not in its first second (`§2.6`)', () => {
    const { session, target } = buildSession();
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);

    runFrames(session, 0.5, 5);
    fireKeydown(target, 'Enter');
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    runFrames(session, 0.6, 6);
    fireKeydown(target, 'Enter');
    expect(session.getState()).toBe(STATES.COUNTDOWN);
  });
});

describe('KS-05-03 AC1: a whole best-of match', () => {
  it('KS-05-03 AC1: a Bo3 with two scripted crashes ends in MATCH_OVER, with a winner and one key', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 3 });

    crashPlayerOne(session, target);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 1 });

    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.02, 20);
    expect(session.getState()).toBe(STATES.PLAYING);

    crashPlayerOne(session, target);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 2 });
    expect(session.getMatch()?.isOver()).toBe(true);

    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.MATCH_OVER);

    const props = lastShow(ui, STATES.MATCH_OVER);
    expect(props.winner).toBe(2);
    // Bo3 rewards one key (`DESIGN-DECISIONS §2.6`), read from `SETTINGS.rewards`; display only this sprint.
    expect(props.keys).toBe(SETTINGS.rewards[3]);
    expect(props.wins).toEqual({ 1: 0, 2: 2 });
  });

  it('KS-05-03: a Bo1 is over after one round and rewards nothing', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    expect(session.getState()).toBe(STATES.MATCH_OVER);
    expect(lastShow(ui, STATES.MATCH_OVER).keys).toBe(SETTINGS.rewards[1]);
  });

  it('KS-05-03: REMATCH starts a fresh match on the same settings', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    lastShow(ui, STATES.MATCH_OVER).onRematch();
    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 0 });
    expect(session.getMatch()?.bestOf).toBe(1);
    expect(session.getSeeds().roundIndex).toBe(0);
  });

  it('KS-05-03: MAIN MENU from the match-over screen tears the match down', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    lastShow(ui, STATES.MATCH_OVER).onMenu();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
    expect(session.getSim()).toBeNull();
    expect(session.getMatch()).toBeNull();
  });
});

describe('KS-05-03 AC2: a draw', () => {
  /**
   * The golden no-input round: neither snake is ever steered, both reach opposite walls on the same tick at
   * t ≈ 3.167 s, and the round is a DRAW (`tests/unit/core/round.test.js`'s own golden log). It is the one
   * scripted draw this repository already trusts, so it is the one this test uses.
   */
  it('KS-05-03 AC2: a draw changes no wins and the round is replayed', () => {
    const { session, ui } = buildSession();
    playTo(session, { bestOf: 3 });

    runFrames(session, 3.3, 66);
    runFrames(session, SETTINGS.crashSlowMo.duration + 0.05, 14);

    expect(session.getState()).toBe(STATES.ROUND_OVER);
    const props = lastShow(ui, STATES.ROUND_OVER);
    expect(props.result).toBe(RESULTS.DRAW);
    expect(props.wins).toEqual({ 1: 0, 2: 0 });
    expect(session.getMatch()?.roundsPlayed).toBe(1);
    expect(session.getMatch()?.isOver()).toBe(false);

    // "Draws never count; the match simply replays the round" (`§2.5`).
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 0 });
  });
});

describe('KS-05-03 AC3: pause', () => {
  it('KS-05-03 AC3: Esc freezes the timer; RESUME shows READY? for a second; the timer carries on', () => {
    // `snakeSpeed: 0` + `godMode` is this repository's standing recipe for "a round nobody can lose"
    // (`tests/unit/core/lasers.test.js`): the clock runs, nothing crashes, so there is a round left to pause
    // five seconds in. A real no-input round is over at 3.167 s.
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    const { session, ui, target } = buildSession({ settings });
    playTo(session);
    runFrames(session, 5, 50);

    const frozenTick = /** @type {any} */ (session.getSim()).tick;
    fireKeydown(target, 'Escape');
    expect(session.getState()).toBe(STATES.PAUSE);
    expect(session.loop.timeScale).toBe(0);

    // Nothing at all moves while paused, however many frames go by.
    runFrames(session, 2, 20);
    expect(session.getSim()?.tick).toBe(frozenTick);

    lastShow(ui, STATES.PAUSE).onResume();
    expect(session.getState()).toBe(STATES.PLAYING);
    expect(lastShow(ui, STATES.COUNTDOWN).label).toBe('READY?');

    // The READY? beat is a second of wall time, and the round is still frozen through it (`§2.8`).
    runFrames(session, 0.9, 9);
    expect(session.getSim()?.tick).toBe(frozenTick);
    expect(session.loop.timeScale).toBe(0);

    runFrames(session, 0.2, 2);
    expect(session.loop.timeScale).toBe(1);
    expect(ui.show).toHaveBeenLastCalledWith(STATES.PLAYING);

    runFrames(session, 0.5, 5);
    expect(session.getSim()?.tick).toBeGreaterThan(frozenTick);
  });

  it('KS-06-00 AC1: Esc on the pause screen resumes, through the same READY? beat (#82)', () => {
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    const { session, ui, target } = buildSession({ settings });
    playTo(session);
    runFrames(session, 5, 50);

    const frozenTick = /** @type {any} */ (session.getSim()).tick;
    fireKeydown(target, 'Escape');
    expect(session.getState()).toBe(STATES.PAUSE);

    // The second Esc reaches the pause *screen* rather than being swallowed by the session: PAUSE is not one
    // of the three states `handleMenuAction` intercepts, so it falls through to the active screen's focus
    // model, whose `onBack` is the prop below (`src/ui/screens/pause.js`).
    fireKeydown(target, 'Escape');
    expect(ui.handleMenuAction).toHaveBeenLastCalledWith('BACK');

    // The real screen calls it; this test drives it directly because `ui` here is a fake. That the fake's
    // Esc arrives at all is what the assertion above proves; `tests/unit/ui/pause.test.js` proves the real
    // screen turns it into `onBack`.
    lastShow(ui, STATES.PAUSE).onBack();

    expect(session.getState()).toBe(STATES.PLAYING);
    expect(lastShow(ui, STATES.COUNTDOWN).label).toBe('READY?');

    // Exactly the RESUME item's behaviour: a second of wall time with the round still frozen (`§2.8`).
    runFrames(session, 0.9, 9);
    expect(session.getSim()?.tick).toBe(frozenTick);
    expect(session.loop.timeScale).toBe(0);

    runFrames(session, 0.2, 2);
    expect(session.loop.timeScale).toBe(1);
    expect(ui.show).toHaveBeenLastCalledWith(STATES.PLAYING);
  });

  it('KS-07-00 AC3: Space opens PAUSE and reaches the pause screen as BACK, exactly like Esc (#103)', () => {
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    const { session, ui, target } = buildSession({ settings });
    playTo(session);
    runFrames(session, 5, 50);

    fireKeydown(target, 'Space');
    expect(session.getState()).toBe(STATES.PAUSE);

    // On PAUSE, Space is translated to the `BACK` Esc produces and falls through to the active screen's
    // focus model — the identical assertion the Esc test above makes, which is what "exactly like Esc"
    // has to mean (`DESIGN-DECISIONS §2.8`).
    fireKeydown(target, 'Space');
    expect(ui.handleMenuAction).toHaveBeenLastCalledWith('BACK');
  });

  it('KS-07-00 AC3: Space on a menu screen reaches nothing at all (#103)', () => {
    // `§2.8`: "Space on a menu does nothing". The session drops it before any screen sees it, so the fake
    // `ui` must not be called — not with `BACK` (which would leave the setup screen) and not with
    // `CONFIRM` (which on the main menu would start a match).
    const { session, ui, target } = buildSession({});
    expect(session.getState()).toBe(STATES.MAIN_MENU);

    ui.handleMenuAction.mockClear();
    fireKeydown(target, 'Space');
    fireKeydown(target, 'Space');

    expect(ui.handleMenuAction).not.toHaveBeenCalled();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
  });

  it('KS-07-00 AC3: Space is ignored through the READY? beat, exactly as Esc is (#103)', () => {
    // `handleMenuAction`'s `readyRemaining === 0` guard is shared by both keys; a Space that skipped it
    // would re-open the pause screen during the beat the player just resumed through.
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    const { session, ui, target } = buildSession({ settings });
    playTo(session);
    runFrames(session, 5, 50);

    fireKeydown(target, 'Space');
    expect(session.getState()).toBe(STATES.PAUSE);
    lastShow(ui, STATES.PAUSE).onBack();
    expect(session.getState()).toBe(STATES.PLAYING);

    // Mid-beat: still frozen, still showing READY?.
    runFrames(session, 0.5, 5);
    fireKeydown(target, 'Space');
    expect(session.getState()).toBe(STATES.PLAYING);

    // Once the beat is over it works again.
    runFrames(session, 0.6, 6);
    fireKeydown(target, 'Space');
    expect(session.getState()).toBe(STATES.PAUSE);
  });

  it('KS-06-00 AC1: Esc during the crash slow-mo beat resumes back into the same beat', () => {
    const { session, ui } = buildSession({});
    playTo(session);
    // P1 into the top wall: twelve grid steps at 6 cells/s, so the crash lands two seconds in.
    session.getSim()?.applyInput('p1', DIRECTIONS.UP);
    runFrames(session, 2.1, 42);
    expect(session.loop.timeScale).toBe(0.25);

    session.pause();
    expect(session.loop.timeScale).toBe(0);
    lastShow(ui, STATES.PAUSE).onBack();
    runFrames(session, 1.1, 11);

    // Back into the quarter-speed beat it interrupted, not to full speed — the RESUME item's own behaviour,
    // which is the whole reason Esc is routed through the same handler.
    expect(session.loop.timeScale).toBe(0.25);
  });

  it('KS-05-03 AC3: steering is ignored through the READY? beat', () => {
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    const { session, ui, target } = buildSession({ settings });
    playTo(session);
    runFrames(session, 1, 10);
    session.pause();
    lastShow(ui, STATES.PAUSE).onResume();

    fireKeydown(target, 'KeyW');
    expect(session.getSim()?.snakes[0].queue).toEqual([]);

    runFrames(session, 1.1, 11);
    fireKeydown(target, 'KeyW');
    expect(session.getSim()?.snakes[0].queue).toEqual([DIRECTIONS.UP]);
  });

  it('KS-05-03: Esc through the READY? beat does not re-open the pause screen', () => {
    const { session, ui, target } = buildSession();
    playTo(session);
    session.pause();
    lastShow(ui, STATES.PAUSE).onResume();

    fireKeydown(target, 'Escape');
    expect(session.getState()).toBe(STATES.PLAYING);
  });

  it('KS-05-03: Esc during the slow-mo beat resumes into the same slow-mo (sprint QA plan)', () => {
    const { session, ui, target } = buildSession();
    playTo(session);
    fireKeydown(target, 'KeyW');
    runFrames(session, 2.1, 42);
    expect(session.loop.timeScale).toBe(SETTINGS.crashSlowMo.scale);

    fireKeydown(target, 'Escape');
    expect(session.getState()).toBe(STATES.PAUSE);
    expect(session.loop.timeScale).toBe(0);

    lastShow(ui, STATES.PAUSE).onResume();
    runFrames(session, 1.1, 11);
    // Back into the quarter-speed beat it interrupted, not snapped to full speed.
    expect(session.loop.timeScale).toBe(SETTINGS.crashSlowMo.scale);

    runFrames(session, SETTINGS.crashSlowMo.duration + 0.05, 14);
    expect(session.getState()).toBe(STATES.ROUND_OVER);
  });

  it('KS-05-03: losing window focus pauses automatically (`DESIGN-DECISIONS §2.8`)', () => {
    const { session, blurSource } = buildSession();
    playTo(session);
    blurSource.blur();
    expect(session.getState()).toBe(STATES.PAUSE);
  });

  it('KS-05-03: a blur outside a round is ignored rather than thrown at the machine', () => {
    const { session, blurSource } = buildSession();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
    expect(() => blurSource.blur()).not.toThrow();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
  });

  it('KS-05-03: a tab coming back auto-pauses through loop.onAutoPause', () => {
    const visibility = createFakeVisibility();
    const { session } = buildSession({ visibilitySource: visibility, blurSource: null });
    playTo(session);

    visibility.setHidden(true);
    visibility.setHidden(false);
    // `onAutoPause` fires on the first frame after the tab comes back, before anything advances.
    session.loop.step(0.016);
    expect(session.getState()).toBe(STATES.PAUSE);
  });

  it('KS-05-03: QUIT TO MENU from pause leaves nothing running', () => {
    const { session, ui } = buildSession();
    playTo(session);
    session.pause();
    lastShow(ui, STATES.PAUSE).onMenu();

    expect(session.getState()).toBe(STATES.MAIN_MENU);
    expect(session.getSim()).toBeNull();
    expect(session.loop.timeScale).toBe(1);
  });

  it('KS-05-03: RESTART MATCH from pause builds a fresh match (`DESIGN-DECISIONS §2.8`)', () => {
    const { session, ui, target } = buildSession();
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.02, 20);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 1 });

    session.pause();
    lastShow(ui, STATES.PAUSE).onRestart();

    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getMatch()?.wins).toEqual({ 1: 0, 2: 0 });
    expect(session.getSeeds().roundIndex).toBe(0);
  });

  it('KS-05-03: pause() and resume() outside a round do nothing at all', () => {
    const { session } = buildSession();
    expect(() => session.pause()).not.toThrow();
    expect(() => session.resume()).not.toThrow();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
  });
});

describe('KS-05-03 the laser-warning sub-state', () => {
  /**
   * A round short enough that the laser warning is a couple of seconds away, and one nobody can lose while
   * it plays out: `snakeSpeed: 0` + `godMode` is the same "round nobody can lose" recipe
   * `tests/unit/core/lasers.test.js` uses, and without it a no-input round is over at 3.167 s — long before
   * the five-second warning it is here to watch could finish.
   */
  const shortRound = withOverrides({ roundDuration: 32, snakeSpeed: 0, godMode: true });

  it('KS-05-03: the sim’s LASER_WARNING moves the machine, raises the banner and pulses the camera', () => {
    const { session, renderer, ui } = buildSession({ settings: shortRound });
    playTo(session);
    runFrames(session, 2.2, 44);

    expect(session.getState()).toBe(STATES.LASER_WARNING);
    expect(ui.hud.showLaserWarning).toHaveBeenCalledWith(SETTINGS.laserWarningDuration);
    expect(renderer.camera.pulseLaserWarning).toHaveBeenCalledTimes(1);
  });

  it('KS-05-03: the sub-state ends after laserWarningDuration of simulated time, back into PLAYING', () => {
    const { session } = buildSession({ settings: shortRound });
    playTo(session);
    runFrames(session, 2.2, 44);
    expect(session.getState()).toBe(STATES.LASER_WARNING);

    runFrames(session, SETTINGS.laserWarningDuration - 0.3, 20);
    expect(session.getState()).toBe(STATES.LASER_WARNING);
    runFrames(session, 0.4, 4);
    expect(session.getState()).toBe(STATES.PLAYING);
  });

  it('KS-05-03: Esc during the warning pauses and resumes back into the warning, not out of it', () => {
    const { session, ui, target } = buildSession({ settings: shortRound });
    playTo(session);
    runFrames(session, 2.2, 44);

    fireKeydown(target, 'Escape');
    expect(session.getState()).toBe(STATES.PAUSE);
    lastShow(ui, STATES.PAUSE).onResume();
    expect(session.getState()).toBe(STATES.LASER_WARNING);
  });

  it('KS-05-03: a renderer with no camera is fine (`SessionRenderer.camera` is optional)', () => {
    const renderer = { render: vi.fn(), resize: vi.fn() };
    const { session } = buildSession({ settings: shortRound, renderer });
    playTo(session);
    expect(() => runFrames(session, 2.2, 44)).not.toThrow();
    expect(session.getState()).toBe(STATES.LASER_WARNING);
  });

  it('KS-05-03: every round starts with the previous round’s warning cleared (KS-04-03 AC2)', () => {
    const { session, ui } = buildSession();
    ui.hud.resetWarning.mockClear();
    session.startMatch();
    expect(ui.hud.resetWarning).toHaveBeenCalledTimes(1);
  });
});

describe('KS-05-03 the HUD and the renderer', () => {
  it('KS-05-03: the HUD timer is written at most once per 100 ms of wall time', () => {
    const { session, ui } = buildSession();
    playTo(session);
    ui.hud.setTime.mockClear();

    for (let i = 0; i < 10; i += 1) session.advanceSimulation(0.016);
    expect(ui.hud.setTime.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('KS-05-03: the HUD is ticked with simulated dt, so a paused banner does not expire', () => {
    const { session, ui } = buildSession();
    playTo(session);
    session.pause();
    ui.hud.tick.mockClear();

    session.advanceSimulation(1);
    expect(ui.hud.tick).toHaveBeenCalledWith(0);
  });

  it('KS-05-03: renders an empty arena in the menus and the sim’s state inside a round', () => {
    const { session, renderer } = buildSession();
    session.renderFrame();
    expect(renderer.render.mock.calls[0][0]).toEqual({ snakes: [], apples: [] });

    playTo(session);
    session.renderFrame();
    const drawn = /** @type {any} */ (renderer.render.mock.calls.at(-1))[0];
    expect(drawn.snakes).toHaveLength(2);
  });

  it('KI-15-02 AC2: MATCH_SETUP alone gets the one-apple preview at its fixed cell — MAIN_MENU stays empty', () => {
    const { session, ui, renderer } = buildSession();

    // MAIN_MENU: unchanged from KS-05-03's own assertion above — no apple leaks onto the screen #157's
    // ruling was never about.
    session.renderFrame();
    expect(renderer.render.mock.calls.at(-1)[0]).toEqual({ snakes: [], apples: [] });
    expect(session.getRenderedSnapshot()).toEqual({ snakes: [], apples: [] });

    lastShow(ui, STATES.MAIN_MENU).onSelect('SELECT_2P');
    expect(session.getState()).toBe(STATES.MATCH_SETUP);
    session.renderFrame();

    const drawn = /** @type {any} */ (renderer.render.mock.calls.at(-1))[0];
    expect(drawn.snakes).toEqual([]);
    expect(drawn.apples).toEqual([MATCH_SETUP_APPLE_CELL]);
    expect(session.getRenderedSnapshot()).toBe(drawn);

    // Inside the 24×24 grid (`DESIGN-DECISIONS §2.1`) and nowhere near either spawn (`§2.3`), so a reviewer
    // reading only the test does not have to open session.js to see the cell is sane.
    expect(MATCH_SETUP_APPLE_CELL.x).toBeGreaterThanOrEqual(0);
    expect(MATCH_SETUP_APPLE_CELL.x).toBeLessThan(SETTINGS.grid.width);
    expect(MATCH_SETUP_APPLE_CELL.y).toBeGreaterThanOrEqual(0);
    expect(MATCH_SETUP_APPLE_CELL.y).toBeLessThan(SETTINGS.grid.height);

    // Leaving MATCH_SETUP back to MAIN_MENU drops the apple again — it is not sticky state.
    lastShow(ui, STATES.MATCH_SETUP).onBack();
    expect(session.getState()).toBe(STATES.MAIN_MENU);
    session.renderFrame();
    expect(renderer.render.mock.calls.at(-1)[0]).toEqual({ snakes: [], apples: [] });
  });

  it('KS-05-03: steering is ignored outside a round', () => {
    const { session, target } = buildSession();
    expect(() => fireKeydown(target, 'KeyW')).not.toThrow();
    expect(session.getSim()).toBeNull();
  });

  it('KS-05-03: WASD steers p1 and the arrow keys steer p2', () => {
    const { session, target } = buildSession();
    playTo(session);
    fireKeydown(target, 'KeyW');
    fireKeydown(target, 'ArrowUp');
    expect(session.getSim()?.snakes[0].queue).toEqual([DIRECTIONS.UP]);
    expect(session.getSim()?.snakes[1].queue).toEqual([DIRECTIONS.UP]);
  });
});

describe('KS-05-03 lifecycle', () => {
  it('KS-05-03: start() schedules frames, stop() halts them, dispose() unhooks everything', () => {
    const requestFrame = vi.fn(() => 7);
    const cancelFrame = vi.fn();
    const { session, ui, target, blurSource } = buildSession({ requestFrame, cancelFrame });

    session.start();
    expect(requestFrame).toHaveBeenCalledTimes(1);
    session.stop();
    expect(cancelFrame).toHaveBeenCalledWith(7);

    expect(blurSource.listenerCount()).toBe(1);
    session.dispose();
    expect(blurSource.listenerCount()).toBe(0);

    // The keyboard listener is gone too: this would otherwise reach the menu's focus model.
    ui.handleMenuAction.mockClear();
    fireKeydown(target, 'Enter');
    expect(ui.handleMenuAction).not.toHaveBeenCalled();
  });

  it('KS-05-03: setSeed fixes the seed the NEXT match uses, leaving one in progress alone', () => {
    const { session, ui, target } = buildSession({ seed: 11 });
    playTo(session, { bestOf: 1 });
    session.setSeed(99);
    expect(session.getSeeds().matchSeed).toBe(11);

    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    lastShow(ui, STATES.MATCH_OVER).onRematch();
    expect(session.getSeeds().matchSeed).toBe(99);
  });

  it('KS-05-03: a session with no blur source at all still works', () => {
    const { session } = buildSession({ blurSource: null });
    expect(() => playTo(session)).not.toThrow();
    expect(session.getState()).toBe(STATES.PLAYING);
    expect(() => session.dispose()).not.toThrow();
  });
});

/**
 * KS-06-02: `writeHud` grows the power-up tag (`ui.hud.setPowerUpTags`) alongside the timer and lengths it
 * already wrote. Every other function in `session.js` is untouched by this ticket (tech-lead note); these
 * tests are only about the one function that changed.
 *
 * Reaching a real pickup needs a live snake on it, which needs *some* survival story — `godMode` (`core/
 * settings.js`, honoured only under Vitest's own `import.meta.env.TEST`) buys the simplest one: an immortal
 * snake just refuses a fatal step and parks instead of dying, so a blunt "walk toward the target cell,
 * correcting every couple of frames" is always safe here. `tests/e2e/powerups.spec.js` is the one proving
 * this against a real production build, where `godMode` does not exist at all.
 */
describe('KS-06-02 writeHud power-up tag', () => {
  /** @param {'UP' | 'DOWN' | 'LEFT' | 'RIGHT'} dir */
  function p1KeyFor(dir) {
    return { UP: 'KeyW', DOWN: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD' }[dir];
  }

  /**
   * Steers P1 onto `cell`, one small step at a time, correcting direction every 0.02 s. Safe regardless of
   * the exact path because the session under test always runs with `godMode: true`.
   *
   * @param {any} session @param {EventTarget} keyboardTarget @param {{x: number, y: number}} cell
   */
  function walkP1Onto(session, keyboardTarget, cell) {
    for (let guard = 0; guard < 3000; guard += 1) {
      const snake = session.getSim().getState().snakes[0];
      const head = snake.segments[0];
      if (head.x === cell.x && head.y === cell.y) return;
      const dir = snake.direction;
      const dx = cell.x - head.x;
      const dy = cell.y - head.y;
      let want =
        Math.abs(dx) >= Math.abs(dy) && dx !== 0
          ? dx > 0
            ? 'RIGHT'
            : 'LEFT'
          : dy > 0
            ? 'UP'
            : 'DOWN';
      const reverses =
        (want === 'RIGHT' && dir.dx === -1) ||
        (want === 'LEFT' && dir.dx === 1) ||
        (want === 'UP' && dir.dy === -1) ||
        (want === 'DOWN' && dir.dy === 1);
      if (reverses) want = dy !== 0 ? (dy > 0 ? 'UP' : 'DOWN') : dx > 0 ? 'RIGHT' : 'LEFT';
      fireKeydown(keyboardTarget, p1KeyFor(/** @type {any} */ (want)));
      session.advanceSimulation(0.02);
    }
    throw new Error('walkP1Onto: did not reach the target cell in time');
  }

  /** A renderer whose projection is fixed and known, so the expected fraction is exact arithmetic. */
  function createProjectingRenderer() {
    return {
      render: vi.fn(),
      resize: vi.fn(),
      camera: { pulseLaserWarning: vi.fn(), updateMatrixWorld: vi.fn() },
      // Always "projects" to normalized device coordinates (0.5, -0.5) regardless of the head handed in —
      // this test is about what `writeHud` does with a projection, not about the projection maths itself
      // (`render/camera.js`'s own tests own that).
      getHeadWorldPosition: vi.fn(() => ({
        x: 0,
        y: 0,
        z: 0,
        project: () => ({ x: 0.5, y: -0.5, z: 0 }),
      })),
    };
  }

  /** @param {object} [overrides] */
  function buildGodModeSession(overrides = {}) {
    const renderer = createProjectingRenderer();
    const ui = createFakeUi();
    ui.hud.setPowerUpTags = vi.fn();
    const target = new NodeEventTarget();
    const session = createSession({
      renderer,
      ui,
      seed: 1,
      settings: withOverrides({ godMode: true }),
      inputTarget: target,
      requestFrame: () => 0,
      cancelFrame: () => {},
      visibilitySource: null,
      blurSource: createFakeBlurSource(),
      ...overrides,
    });
    return { session, renderer, ui, target };
  }

  it('KS-06-02 AC1/AC2: one active SPEED effect becomes one tag, ceil()d seconds, at the projected fraction', () => {
    const { session, ui, target } = buildGodModeSession();
    playTo(session, { powerUpsEnabled: true });

    // `powerUpFirstSpawnAt` seconds remaining is `roundDuration - powerUpFirstSpawnAt` seconds elapsed.
    const elapsedAtFirstSpawn = SETTINGS.roundDuration - SETTINGS.powerUpFirstSpawnAt;
    runFrames(session, elapsedAtFirstSpawn, elapsedAtFirstSpawn * 10);

    const pickup = session.getSim().getState().powerUps.pickups[0];
    expect(pickup).toBeDefined();
    ui.hud.setPowerUpTags.mockClear();
    walkP1Onto(session, target, pickup.cell);

    // `godMode` still runs `resolvePowerUpPickup` and `tickPowerUpEffects` for a surviving step (only the
    // *fatal* step is refused), so the pickup lands exactly as it would in a real round.
    const afterPickup = session.getSim().getState();
    // SPEED benefits the collector; SLOW benefits every *other* snake (`DESIGN-DECISIONS §1 row 3`) — either
    // way, exactly one snake now carries the effect, and this test does not care which pickup the seed drew.
    const victimIndex = pickup.type === 'SPEED' ? 0 : 1;
    const victim = afterPickup.snakes[victimIndex];
    const effect = victim.effects.find((/** @type {any} */ e) => e.type === pickup.type);
    expect(effect).toBeDefined();

    // `writeHud` is throttled to 10 Hz (`ARCHITECTURE §8`), so more than 0.1 s of wall time has to pass
    // since the last write before a fresh one — reflecting the effect that just started — is guaranteed.
    session.advanceSimulation(0.15);
    const tags = ui.hud.setPowerUpTags.mock.calls.at(-1)[0];
    expect(tags).toHaveLength(1);
    expect(tags[0].key).toBe(`${victim.id}:${pickup.type}`);
    expect(tags[0].seconds).toBe(Math.ceil(effect.remaining));
    // NDC (0.5, -0.5) → fraction ((0.5+1)/2, (1-(-0.5))/2) = (0.75, 0.75).
    expect(tags[0].xFraction).toBeCloseTo(0.75, 10);
    expect(tags[0].yFraction).toBeCloseTo(0.75, 10);
    expect(tags[0].stackIndex).toBe(0);
  });

  it('KS-06-02 AC2: no active effects means no tags at all', () => {
    const { session, ui } = buildGodModeSession();
    playTo(session, { powerUpsEnabled: false });
    ui.hud.setPowerUpTags.mockClear();

    session.advanceSimulation(0.2);
    expect(ui.hud.setPowerUpTags).toHaveBeenCalledWith([]);
  });

  it('KS-06-02: a renderer with no camera or projection sends no tags, and nothing throws', () => {
    const ui = createFakeUi();
    ui.hud.setPowerUpTags = vi.fn();
    const target = new NodeEventTarget();
    const session = createSession({
      renderer: { render: vi.fn(), resize: vi.fn() }, // KS-05-03's own "no camera" fake, unchanged
      ui,
      seed: 1,
      inputTarget: target,
      requestFrame: () => 0,
      cancelFrame: () => {},
      visibilitySource: null,
      blurSource: createFakeBlurSource(),
    });

    expect(() => playTo(session)).not.toThrow();
    expect(ui.hud.setPowerUpTags).toHaveBeenCalledWith([]);
  });

  it('KS-06-02: writeHud does not throw when the HUD has no setPowerUpTags at all', () => {
    // The shared `createFakeUi()` fixture predates this ticket and still lacks the method — proof that a
    // minimal test double never has to grow one just to keep passing (`SessionHud.setPowerUpTags` is
    // optional for exactly this reason).
    const { session } = buildSession();
    expect(() => playTo(session)).not.toThrow();
  });
});

describe('KS-07-01 tuning overrides and the replay recorder', () => {
  it('AC1: setSettingsOverrides has no effect on the round in progress, only the next one', () => {
    const { session, target } = buildSession({ seed: 55 });
    playTo(session, { bestOf: 3 });
    expect(session.getSim().settings.foodCount).toBe(SETTINGS.foodCount);

    session.setSettingsOverrides({ foodCount: 7 });
    // Still the same running round, built before the override was set.
    expect(session.getSim().settings.foodCount).toBe(SETTINGS.foodCount);

    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    expect(session.getState()).toBe(STATES.COUNTDOWN);
    expect(session.getSim().settings.foodCount).toBe(7);
  });

  it("AC1: setSettingsOverrides(null) reverts the next round to this session's original settings", () => {
    const { session, target } = buildSession({ seed: 9 });
    session.setSettingsOverrides({ foodCount: 7 });
    playTo(session, { bestOf: 3 });
    expect(session.getSim().settings.foodCount).toBe(7);

    session.setSettingsOverrides(null);
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);

    expect(session.getSim().settings.foodCount).toBe(SETTINGS.foodCount);
    expect(session.getSettingsOverrides()).toBeNull();
  });

  it('getSettingsOverrides() returns exactly what setSettingsOverrides was last called with', () => {
    const { session } = buildSession();
    expect(session.getSettingsOverrides()).toBeNull();
    session.setSettingsOverrides({ foodCount: 2 });
    expect(session.getSettingsOverrides()).toEqual({ foodCount: 2 });
    session.setSettingsOverrides(null);
    expect(session.getSettingsOverrides()).toBeNull();
  });

  it('AC2: getReplay() before any round has started returns a seedless, empty replay', () => {
    const { session } = buildSession();
    expect(session.getReplay()).toEqual({
      seed: null,
      settingsOverrides: {},
      inputs: [],
      expectedEvents: [],
    });
  });

  it("AC2: getReplay() reproduces the round exactly through tests/sim/harness.js's runRound", () => {
    const { session, target } = buildSession({ seed: 777 });
    session.setSettingsOverrides({ snakeSpeed: 9, laserStartTime: 25 });
    playTo(session, { bestOf: 1 });
    // One recorded input, same key `input.js` maps P1's UP to (`testHooks.js`'s own `PLAYER_KEY_CODES`).
    // At the overridden `snakeSpeed: 9`, twelve grid steps to the wall take 12/9 ≈ 1.333 s, not the usual
    // 2.0 s `crashPlayerOne` assumes at the shipping speed — run this one out by hand instead, all the way
    // past the crash slow-mo beat, so `getReplay()`'s `expectedEvents` is the *whole* round (a human copies
    // the replay once a round is actually over, same as `crashPlayerOne` does for every other test here).
    fireKeydown(target, 'KeyW');
    runFrames(session, 1.4, 28);
    runFrames(session, SETTINGS.crashSlowMo.duration + 0.05, 14);
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    const replay = session.getReplay();
    expect(replay.seed).toBe(session.getSim().seed);
    expect(replay.settingsOverrides).toEqual({ snakeSpeed: 9, laserStartTime: 25 });
    expect(replay.inputs).toEqual([{ t: expect.any(Number), player: 'p1', dir: 'UP' }]);
    expect(replay.expectedEvents.at(-1)).toMatchObject({ type: 'ROUND_OVER', winnerId: 'p2' });

    // The exact fixture shape `tests/sim/replays/*.json` uses (`replay.schema.json`) — a human would paste
    // `JSON.stringify(replay)` straight into one of those files.
    const settings = withOverrides(replay.settingsOverrides);
    const noopBot = () => null;
    const { events } = runRound({
      seed: /** @type {number} */ (replay.seed),
      bots: [noopBot, noopBot],
      settings,
      inputLog: replay.inputs,
    });

    expect(events).toEqual(replay.expectedEvents);
  });

  it('AC2: getReplay() carries the round forward correctly across a NEXT_ROUND transition', () => {
    // Regression for the obvious bug: forgetting to reset the recorder in `startRound()` would leak round
    // 1's events/inputs into round 2's replay.
    const { session, target } = buildSession({ seed: 321 });
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.COUNTDOWN);

    const replay = session.getReplay();
    expect(replay.seed).toBe(session.getSim().seed);
    expect(replay.seed).not.toBe(roundSeedFor(321, 0));
    expect(replay.inputs).toEqual([]);
    // Only round 2's own opening FOOD_SPAWNED batch, none of round 1's events.
    expect(replay.expectedEvents.every((/** @type {any} */ e) => e.tick === 0)).toBe(true);
  });
});

/**
 * A fake `SessionPlaytestPrompt` (`session.js`'s own structural typedef) — enough to prove the three call
 * sites in isolation from the real, DOM-building `src/ui/screens/playtestPrompt.js`, whose own selection/
 * re-queue/attribution logic is tested directly in `tests/unit/ui/playtestPrompt.test.js`. `.open` starts
 * `false`; `offer()` sets it to `opensTo` and returns that; a test can also flip `.open` by hand to simulate
 * the gap closing partway through, from whichever route.
 *
 * @param {{opensTo?: boolean}} [options]
 */
function createFakePrompt({ opensTo = true } = {}) {
  const prompt = {
    open: false,
    /** @type {any} */
    lastFacts: null,
    offer: vi.fn((/** @type {any} */ facts, /** @type {number} */ roundIndex) => {
      prompt.lastFacts = facts;
      prompt.lastRoundIndex = roundIndex;
      prompt.open = opensTo;
      return opensTo;
    }),
    handleAction: vi.fn(),
    isOpen: () => prompt.open,
  };
  return prompt;
}

describe('KI-11-02 the playtest prompt seam', () => {
  /** The same short, nobody-can-lose round `KS-05-03 the laser-warning sub-state` uses, so the laser phase is
   * seen well within a small number of frames. */
  const shortRound = withOverrides({ roundDuration: 32, snakeSpeed: 0, godMode: true });

  it('a normal session (setPlaytestPrompt never called) is byte-for-byte unaffected: the scoreboard auto-advances', () => {
    const { session, target } = buildSession({ seed: 1 });
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    expect(session.getState()).toBe(STATES.ROUND_OVER);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.COUNTDOWN);
  });

  it('enterRoundOver offers RoundFacts built from match.roundsPlayed, the laser latch and match.isOver(), keyed by roundIndex', () => {
    const prompt = createFakePrompt({ opensTo: false });
    const { session } = buildSession({ settings: shortRound });
    session.setPlaytestPrompt(prompt);
    playTo(session);
    runFrames(session, 2.2, 44); // into LASER_WARNING (matches the laser-warning suite above)
    expect(session.getState()).toBe(STATES.LASER_WARNING);
    runFrames(session, 30, 60); // through to the round timing out (godMode: nobody can crash first)
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    expect(prompt.offer).toHaveBeenCalledTimes(1);
    expect(prompt.offer).toHaveBeenCalledWith(
      {
        roundsPlayed: 1,
        laserPhaseSeen: true,
        sessionOver: false,
        practiceExists: false,
      },
      0,
    );
  });

  it('laserPhaseSeen stays false when a round ends before the lasers ever arm', () => {
    const prompt = createFakePrompt({ opensTo: false });
    const { session, target } = buildSession({ seed: 5 });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target); // dies at 2.0s; the default laserStartTime never comes due that early
    expect(prompt.offer).toHaveBeenCalledWith(
      {
        roundsPlayed: 1,
        laserPhaseSeen: false,
        sessionOver: false,
        practiceExists: false,
      },
      0,
    );
  });

  it('laserPhaseSeen is sticky: once true, a later round that never sees the lasers again still reports true', () => {
    const prompt = createFakePrompt({ opensTo: false });
    const { session, target } = buildSession({ settings: shortRound });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 3 });
    runFrames(session, 2.2, 44); // into LASER_WARNING
    runFrames(session, 30, 60); // round 1 times out, having armed the lasers
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    // Revert round 2 to the shipping defaults (`setSettingsOverrides({})` merges onto `SETTINGS` itself, not
    // onto this session's own `shortRound` base — `core/settings.js`'s `withOverrides` doc) so it can end in
    // an ordinary crash, nowhere near its own laser phase, and still report the latch from round 1.
    session.setSettingsOverrides({});
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6); // through the scoreboard into round 2's countdown
    expect(session.getState()).toBe(STATES.COUNTDOWN);
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.01, 8); // into round 2's PLAYING
    expect(session.getState()).toBe(STATES.PLAYING);

    crashPlayerOne(session, target); // round 2: a short crash, nowhere near this round's own laser phase
    expect(prompt.offer).toHaveBeenLastCalledWith(
      {
        roundsPlayed: 2,
        laserPhaseSeen: true,
        sessionOver: false,
        practiceExists: false,
      },
      1,
    );
  });

  it('sessionOver is true on the round that ends the match, false on every round before it', () => {
    const prompt = createFakePrompt({ opensTo: false });
    const { session, target } = buildSession({ seed: 5 });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    expect(prompt.offer).toHaveBeenCalledWith(
      {
        roundsPlayed: 1,
        laserPhaseSeen: false,
        sessionOver: true,
        practiceExists: false,
      },
      0,
    );
  });

  it('PR #176 review: roundsPlayed is counted for the whole session, not reset at a match boundary', () => {
    const prompt = createFakePrompt({ opensTo: false });
    const { session, ui, target } = buildSession({ seed: 5 });
    session.setPlaytestPrompt(prompt);

    // Match 1: Best of 1 — one round is the whole match.
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    expect(prompt.offer).toHaveBeenLastCalledWith(
      {
        roundsPlayed: 1,
        laserPhaseSeen: false,
        sessionOver: true,
        practiceExists: false,
      },
      0,
    );
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.MATCH_OVER);

    // REMATCH: a fresh match, same settings (`session.js`'s own KS-05-03 test, reused here). `roundIndex`
    // resets to 0 for the new match — this is deliberately still about `roundsPlayed`, not that key — but
    // `match.roundsPlayed` (the wrong source this fix removed) would also reset to 0 here, which is exactly
    // the bug: a per-match counter can never tell match 2's first round from match 1's.
    lastShow(ui, STATES.MATCH_OVER).onRematch();
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.01, 8);
    expect(session.getState()).toBe(STATES.PLAYING);

    crashPlayerOne(session, target); // match 2's round 1 — the session's *second* round overall
    expect(prompt.offer).toHaveBeenLastCalledWith(
      {
        roundsPlayed: 2,
        laserPhaseSeen: false,
        sessionOver: true,
        practiceExists: false,
      },
      0,
    );
  });

  it('tech-lead note 3: advanceScoreboard never auto-advances while the prompt is open, and resumes the moment it closes', () => {
    const prompt = createFakePrompt({ opensTo: true });
    const { session, target } = buildSession({ seed: 1 });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    // Far longer than scoreboardSeconds — the hold must not budge while the gap is open.
    runFrames(session, SETTINGS.scoreboardSeconds * 4, 20);
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    // The gap closes, by whichever route (here: the answered route) — the hold releases immediately.
    prompt.open = false;
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.COUNTDOWN);
  });

  it("tech-lead note 3: handleMenuAction's ROUND_OVER case forwards keys to an open prompt instead of skipping the scoreboard", () => {
    const prompt = createFakePrompt({ opensTo: true });
    const { session, target } = buildSession({ seed: 1 });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    // Long past the ordinary "Enter after 1s" skip threshold — proving the prompt intercepts Enter rather
    // than merely delaying past it.
    runFrames(session, 3, 6);

    fireKeydown(target, 'Enter');
    expect(prompt.handleAction).toHaveBeenCalledWith('CONFIRM');
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    fireKeydown(target, 'ArrowLeft');
    expect(prompt.handleAction).toHaveBeenCalledWith('LEFT');

    fireKeydown(target, 'Escape');
    expect(prompt.handleAction).toHaveBeenCalledWith('BACK');
    expect(session.getState()).toBe(STATES.ROUND_OVER);
  });

  it('AC3: opening the prompt and forwarding keys to it dispatches no GAME_EVENTS — the state stays ROUND_OVER throughout', () => {
    const prompt = createFakePrompt({ opensTo: true });
    const { session, target } = buildSession({ seed: 1 });
    session.setPlaytestPrompt(prompt);
    playTo(session, { bestOf: 3 });
    crashPlayerOne(session, target);
    expect(session.getState()).toBe(STATES.ROUND_OVER);

    const dispatchSpy = vi.spyOn(session.machine, 'dispatch');
    runFrames(session, SETTINGS.scoreboardSeconds * 4, 20);
    fireKeydown(target, 'Enter');
    fireKeydown(target, 'ArrowRight');
    fireKeydown(target, 'Escape');

    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(session.getState()).toBe(STATES.ROUND_OVER);
    dispatchSpy.mockRestore();
  });
});

describe('KI-05-03 the REPLAY screen entry point', () => {
  it('KI-05-03: SELECT_REPLAY from MAIN_MENU shows REPLAY with nothing loaded and no error', () => {
    const { session, ui } = buildSession({ seed: 1 });

    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);

    expect(session.getState()).toBe(STATES.REPLAY);
    const props = lastShow(ui, STATES.REPLAY);
    expect(props.loaded).toBe(false);
    expect(props.error).toBeNull();
  });

  it('KI-05-03 AC1: pasting a valid replay plays it', () => {
    const { session, ui } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);

    lastShow(ui, STATES.REPLAY).onLoad(JSON.stringify(NO_INPUT_ROUND));

    // The screen was re-rendered with the successful result — `render()` is called again per `onLoad`'s own
    // doc comment — and the session's own replay-mode accessors agree that something is now loaded.
    const props = lastShow(ui, STATES.REPLAY);
    expect(props.loaded).toBe(true);
    expect(props.error).toBeNull();
    expect(session.hasReplay()).toBe(true);
    expect(session.getReplayTick()).toBe(0);
    expect(session.getReplayPhase()).toBe('PLAYING');
  });

  it('KI-05-03 AC1: pasting rubbish shows a readable error and stays on the screen', () => {
    const { session, ui } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);

    lastShow(ui, STATES.REPLAY).onLoad('{not valid json');

    // Still on REPLAY (AC1's "stays on the screen") — no state-machine transition happened over a bad paste.
    expect(session.getState()).toBe(STATES.REPLAY);
    const props = lastShow(ui, STATES.REPLAY);
    expect(props.loaded).toBe(false);
    expect(props.error).not.toBeNull();
    expect(props.error.code).toBe(REPLAY_ERROR_CODES.INVALID_JSON);
    expect(session.hasReplay()).toBe(false);
  });

  it('KI-05-03 AC1: a failed paste does not disturb a replay already loaded', () => {
    // `replayPlayer.js`'s own documented contract ("failure leaves the previous replay in place") — this
    // ticket's `loadReplayInternal` must not narrow that, since the public `loadReplay()` still promises it.
    const { session, ui } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);
    lastShow(ui, STATES.REPLAY).onLoad(JSON.stringify(NO_INPUT_ROUND));
    expect(session.hasReplay()).toBe(true);

    lastShow(ui, STATES.REPLAY).onLoad('{not valid json');

    expect(session.hasReplay()).toBe(true);
    expect(session.getReplayTick()).toBe(0);
  });

  it('KI-05-03 AC4: Esc (BACK) leaves REPLAY and returns to MAIN_MENU', () => {
    const { session, ui } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);
    expect(session.getState()).toBe(STATES.REPLAY);

    lastShow(ui, STATES.REPLAY).onBack();

    expect(session.getState()).toBe(STATES.MAIN_MENU);
  });

  it('KI-05-03: the REPLAY case in runUpdate drives a loaded, playing replay forward every frame', () => {
    const { session, renderer, ui } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);
    lastShow(ui, STATES.REPLAY).onLoad(JSON.stringify(NO_INPUT_ROUND));
    lastShow(ui, STATES.REPLAY).onPlayToggle();
    expect(session.isReplayPlaying()).toBe(true);

    const dt = 1 / SETTINGS.simHz;
    renderer.render.mockClear();
    session.advanceSimulation(dt);

    // One simulated tick advanced, drawn through the ordinary renderer (module doc: "renders it with the
    // existing renderer and HUD"), and the screen's own per-frame progress hook saw it.
    expect(session.getReplayTick()).toBe(1);
    expect(renderer.render).toHaveBeenCalled();
    expect(ui.updateReplayProgress).toHaveBeenCalledWith(
      expect.objectContaining({ tick: 1, phase: 'PLAYING', isPlaying: true }),
    );
  });

  it('KI-05-03: driving the replay automatically through runUpdate still accepts no player input', () => {
    // The property KI-05-02's own AC3 proved for the hand-driven `advanceReplayFrame` — a keydown has no code
    // path to `replayPlayer` regardless of the state machine — re-checked here for the new *automatic*
    // per-frame call site this ticket adds (`runUpdate`'s `REPLAY` case). `NO_INPUT_ROUND` has an empty
    // `inputs` log, so a leaked key that reached the replay's own simulation would steer a snake its golden
    // log never told it to move, which would show up as a diverging event log at the end — not merely as a
    // boolean staying false.
    const { session, target } = buildSession({ seed: 1 });
    session.machine.dispatch(GAME_EVENTS.SELECT_REPLAY);
    session.loadReplay(JSON.stringify(NO_INPUT_ROUND));
    session.playReplay();

    const dt = 1 / SETTINGS.simHz;
    let guard = 0;
    while (session.getReplayPhase() === 'PLAYING' && guard < 20_000) {
      session.advanceSimulation(dt);
      // Real keydowns, at the same target `createInput` listens on, every single frame this replay is
      // being driven — including directions this fixture's own log never records.
      fireKeydown(target, 'ArrowLeft');
      fireKeydown(target, 'ArrowUp');
      guard += 1;
    }

    expect(guard).toBeLessThan(20_000);
    expect(session.getReplayPhase()).toBe('ROUND_OVER');
    expect(session.getReplayEvents()).toEqual(NO_INPUT_ROUND.expectedEvents);
  });
});

/** Plays a loaded replay to the end, guarding against an infinite loop the same way the KI-05-03 tests do. */
function driveReplayToEnd(session) {
  session.playReplay();
  const dt = 1 / SETTINGS.simHz;
  let guard = 0;
  while (session.getReplayPhase() === 'PLAYING' && guard < 20_000) {
    session.advanceSimulation(dt);
    guard += 1;
  }
  expect(guard).toBeLessThan(20_000);
  expect(session.getReplayPhase()).toBe('ROUND_OVER');
}

/**
 * KI-05-04: WATCH LAST ROUND on the match-over screen (the design lead's ruling on issue #211/#222 moving it
 * off `scoreboard.js`, `DESIGN-DECISIONS §3`). `crashPlayerOne` gives every round here a real, non-empty
 * `roundInputLog` (P1's own `KeyW`) as well as a real `roundEventLog`, so a replay reconstructed from just the
 * round's seed — with nobody's input applied — would diverge from what actually happened the moment P1 should
 * have turned. Comparing against `session.getReplay()`'s own snapshot, taken while `sim` still holds the round
 * that just ended (MATCH_OVER never resets it), is what proves AC1 means "exactly that round" and not "a round
 * with the same seed" (tech-lead note on issue #222).
 */
describe('KI-05-04 WATCH LAST ROUND from the match-over screen', () => {
  it('KI-05-04 AC1: WATCH LAST ROUND replays exactly the round that just ended, tick for tick', () => {
    const { session, ui, target } = buildSession({ seed: 41 });
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.MATCH_OVER);

    // `sim`/`roundIndex` are untouched between the round ending and MATCH_OVER, so `getReplay()` here is
    // still exactly the snapshot `enterRoundOver` captured — the oracle this test replays against.
    const recorded = session.getReplay();
    expect(recorded.seed).not.toBeNull();
    expect(recorded.inputs).toEqual([{ t: expect.any(Number), player: 'p1', dir: 'UP' }]);
    expect(recorded.expectedEvents.length).toBeGreaterThan(0);

    lastShow(ui, STATES.MATCH_OVER).onWatchLastRound();

    expect(session.getState()).toBe(STATES.REPLAY);
    expect(session.hasReplay()).toBe(true);
    const props = lastShow(ui, STATES.REPLAY);
    expect(props.loaded).toBe(true);
    expect(props.error).toBeNull();

    driveReplayToEnd(session);

    // Tick for tick: the replayed log is not merely "a round with this seed", it is this exact recording.
    expect(session.getReplayEvents()).toEqual(recorded.expectedEvents);
  });

  it('KI-05-04 AC1: after a second round, WATCH LAST ROUND replays that round, not the first', () => {
    const { session, ui, target } = buildSession({ seed: 41 });
    playTo(session, { bestOf: 3 });

    crashPlayerOne(session, target); // round 0: P2 wins
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.02, 20);
    expect(session.getState()).toBe(STATES.PLAYING);
    const round2Seed = session.getSim().seed;

    crashPlayerOne(session, target); // round 1: P2 wins again -> Bo3 decided
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.MATCH_OVER);
    expect(session.getMatch()?.isOver()).toBe(true);

    const recorded = session.getReplay();
    expect(recorded.seed).toBe(round2Seed);

    lastShow(ui, STATES.MATCH_OVER).onWatchLastRound();
    driveReplayToEnd(session);

    expect(session.getReplayEvents()).toEqual(recorded.expectedEvents);
    // Not round 0's log: round 0 also ends in a P1-crash `ROUND_OVER` with a different `snakeId`/`winnerId`
    // pairing is the same shape, so the real discriminator is the seed each round's events were produced
    // under, already asserted above via `recorded.seed`.
  });

  it('KI-05-04: Esc from a replay entered via WATCH LAST ROUND returns to MATCH_OVER, not MAIN_MENU', () => {
    const { session, ui, target } = buildSession({ seed: 41 });
    playTo(session, { bestOf: 1 });
    crashPlayerOne(session, target);
    runFrames(session, SETTINGS.scoreboardSeconds + 0.05, 6);
    expect(session.getState()).toBe(STATES.MATCH_OVER);
    const matchOverProps = lastShow(ui, STATES.MATCH_OVER);

    matchOverProps.onWatchLastRound();
    expect(session.getState()).toBe(STATES.REPLAY);

    lastShow(ui, STATES.REPLAY).onBack();

    expect(session.getState()).toBe(STATES.MATCH_OVER);
    // The screen was re-rendered with the same match still standing, not torn down (this file's own KI-05-04
    // header note: MATCH_OVER re-enters exactly as it left).
    expect(lastShow(ui, STATES.MATCH_OVER).winner).toBe(matchOverProps.winner);
  });
});

/**
 * KI-12-04 — the switch, and the key rule (`docs/sprints/improvement-12-cpu-opponent.md`).
 *
 * `ki-12-04-human-human-baseline.json` was captured by running the scenario below — `buildSession({seed:
 * 4242})`, `playTo(session, {bestOf: 3})`, `crashPlayerOne` — against the code on `main` *before this
 * ticket's own commit touched a single file* (tech-lead direction 4: "compare the full event log (and the
 * replay) against a run on the pre-change code path"). AC1 below re-runs the identical scenario against this
 * ticket's own code and asserts the two agree byte for byte: same replay (seed, inputs, the full event log)
 * both before and after the crash, same `MatchState` fields. Nothing in `matchSettings`'s own shape is
 * compared (this ticket adds `playerKinds`, so the *object* necessarily grows) — only the two places a
 * player-visible difference could actually hide: what the simulation did, and what the match paid out.
 */
describe('KI-12-04 AC1: a match started without touching the row is byte-identical to today’s', () => {
  /** @type {any} */
  const golden = JSON.parse(
    readFileSync(join(GOLDEN_DIR, 'ki-12-04-human-human-baseline.json'), 'utf8'),
  );

  it('KI-12-04 AC1: HUMAN/HUMAN Bo3, P1 crashes — replay, event log and match state all match the pre-ticket fixture', () => {
    const { session, target } = buildSession({ seed: 4242 });

    playTo(session, { bestOf: 3 });
    expect(session.getReplay()).toEqual(golden.replayBeforeCrash);

    crashPlayerOne(session, target);

    expect(session.getState()).toBe(golden.stateAfterCrash);
    expect(session.getReplay()).toEqual(golden.replayAfterCrash);
    expect(session.getSeeds()).toEqual(golden.seeds);

    const match = session.getMatch();
    expect(match).not.toBeNull();
    expect({
      bestOf: match?.bestOf,
      target: match?.target,
      rewardKeys: match?.rewardKeys,
      wins: match?.wins,
      roundsPlayed: match?.roundsPlayed,
      consecutiveDraws: match?.consecutiveDraws,
      winner: match?.winner,
      endReason: match?.endReason,
    }).toEqual(golden.match);
  });

  it('KI-12-04 AC1: the default matchSettings carries HUMAN/HUMAN — the untouched row', () => {
    const { session } = buildSession({ seed: 4242 });
    expect(session.getMatchSettings().playerKinds).toEqual({ 1: 'HUMAN', 2: 'HUMAN' });
  });
});

/**
 * KI-12-04 AC2 — the key rule, wired end-to-end: `matchSettings.playerKinds` (set the same way the row's own
 * `onChange` or a `startMatch` override would) flows through `playersForMatch`'s new `isCpu` field into
 * `core/match.js`'s `createMatch`, which is where `tests/unit/core/match.test.js`'s own `KI-12-04 the key
 * rule` block already proves the arithmetic in isolation. This block proves the session actually wires it —
 * a regression here (say, `playersForMatch` forgetting `isCpu`) would pass every `core/match.js` test and
 * still ship a CPU-vs-CPU match that pays out.
 */
describe('KI-12-04 AC2: a CPU-vs-CPU match awards zero keys; a human-vs-CPU match awards the normal amount', () => {
  it('KI-12-04 AC2: a CPU-vs-CPU match awards zero keys', () => {
    const { session } = buildSession({ seed: 1 });
    playTo(session, { bestOf: 3, playerKinds: { 1: 'EASY', 2: 'NORMAL' } });
    expect(session.getMatch()?.rewardKeys).toBe(0);
  });

  it('KI-12-04 AC2: a human-vs-CPU match awards the normal amount to the human', () => {
    const { session } = buildSession({ seed: 1 });
    playTo(session, { bestOf: 3, playerKinds: { 1: 'HUMAN', 2: 'HARD' } });
    expect(session.getMatch()?.rewardKeys).toBe(SETTINGS.rewards[3]);
  });

  it('KI-12-04 AC2: a CPU-vs-human match (the other seat human) also awards the normal amount', () => {
    const { session } = buildSession({ seed: 1 });
    playTo(session, { bestOf: 3, playerKinds: { 1: 'EASY', 2: 'HUMAN' } });
    expect(session.getMatch()?.rewardKeys).toBe(SETTINGS.rewards[3]);
  });

  it('KI-12-04: prove it can go red — a session that ignored playerKinds entirely would still pay a CPU-vs-CPU match', () => {
    // The red-proof: compute what an unpatched `playersForMatch` (no `isCpu` at all) would have produced,
    // and show it disagrees with what this session actually pays.
    const { session } = buildSession({ seed: 1 });
    playTo(session, { bestOf: 3, playerKinds: { 1: 'EASY', 2: 'EASY' } });
    const unpatchedWouldPay = SETTINGS.rewards[3];
    expect(session.getMatch()?.rewardKeys).not.toBe(unpatchedWouldPay);
    expect(session.getMatch()?.rewardKeys).toBe(0);
  });
});

/**
 * KI-12-04: the row's own change actually configures a working `CpuPlayer` — not merely a label the reward
 * rule reads. `syncCpuPlayersFromKinds` is exercised here through `startMatch`'s own `playerKinds` override,
 * the same shortcut `tests/e2e`/`tests/visual` use to reach a CPU match without a real keypress.
 */
describe('KI-12-04: the switch actually drives a CpuPlayer', () => {
  it('KI-12-04: an EASY player 1 steers away from the wall an unsteered human would eventually hit', () => {
    const { session } = buildSession({ seed: 4242 });
    playTo(session, { bestOf: 1, playerKinds: { 1: 'EASY', 2: 'HUMAN' } });
    // P1 spawns heading RIGHT (`DESIGN-DECISIONS §2.3`); `crashPlayerOne`'s own comment records that an
    // unsteered snake on this seed reaches its wall by ≈ 3.167 s. 3.3 s is safely past that mark, so a
    // still-alive player 1 here can only mean its EASY policy is actually being asked and actually steering,
    // not merely toggling a reward number in `core/match.js`.
    runFrames(session, 3.3, 40);
    expect(session.getSim()?.snakes[0].alive).toBe(true);
  });

  it('KI-12-04: a manually configured CpuPlayer (KI-12-02’s own seam) survives a bare startMatch() with no playerKinds override', () => {
    // Regression guard for `syncCpuPlayersFromKinds`: `tests/e2e/cpu.spec.js` calls `setCpuPlayer` directly
    // and then `startMatch()` with no overrides at all — this must never be silently reset back to HUMAN by
    // the default `playerKinds` (`{1: 'HUMAN', 2: 'HUMAN'}`) `defaultMatchSettings` still carries.
    const { session } = buildSession({ seed: 4242 });
    session.setCpuPlayer(1, () => 'UP');
    session.startMatch({ bestOf: 1 });
    runFrames(session, SETTINGS.countdownStepSeconds * 4 + 0.01, 8);
    runFrames(session, 0.3, 3);
    // The manual policy always answers UP; P1 spawns heading RIGHT, so a queued UP proves the CPU is still
    // the one driving player 1, not a human's (silent, absent) keyboard.
    expect(session.getSim()?.snakes[0].direction).toEqual(DIRECTIONS.UP);
  });

  it('KI-12-04: HARD keeps working when handed to the session programmatically — it is off the menu, not rejected', () => {
    // `PLAYER_KIND_VALUES` (matchSetup.js) is the row's own offered list, and it deliberately excludes
    // `HARD` (#217, ruled on #210) — but `session.js`'s own `syncCpuPlayersFromKinds`/`policyForLevel` stay
    // generic and must never grow a guard that rejects a `'HARD'` `PlayerKind` reaching them some other way
    // (a test, `levels.js`'s own consumers, a future debug seam). `startMatch`'s `playerKinds` override is
    // exactly such a path: it never goes through the row's `changePlayerKind` at all.
    const { session } = buildSession({ seed: 4242 });
    expect(() => playTo(session, { bestOf: 1, playerKinds: { 1: 'HARD', 2: 'HUMAN' } })).not.toThrow();
    expect(session.getMatchSettings().playerKinds[1]).toBe('HARD');
    // And it actually drives the snake, exactly as EASY does above — not merely accepted and then ignored.
    runFrames(session, 3.3, 40);
    expect(session.getSim()?.snakes[0].alive).toBe(true);
  });
});
