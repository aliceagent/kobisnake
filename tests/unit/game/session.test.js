// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { RESULTS } from '../../../src/core/events.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { STATES } from '../../../src/game/gameStateMachine.js';
import { createSession, formatTime, roundSeedFor } from '../../../src/game/session.js';

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
