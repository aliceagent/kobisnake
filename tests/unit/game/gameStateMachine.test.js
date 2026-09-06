// @ts-check
import { describe, expect, test } from 'vitest';
import {
  createGameStateMachine,
  GAME_EVENTS,
  PAUSABLE_STATES,
  PREVIOUS,
  STATES,
  TRANSITIONS,
} from '../../../src/game/gameStateMachine.js';

/**
 * KS-05-02: the game state machine.
 *
 * The headline acceptance criterion (AC1) is not "there are tests for the transitions" but "there cannot be
 * an untested transition". So the per-row tests below are **generated from `TRANSITIONS` itself** and each
 * one records the row it exercised; the last test in the file then asserts that the recorded set is exactly
 * the table. Adding a row to `gameStateMachine.js` therefore does one of two things: it produces a generated
 * test that passes (and the coverage assertion stays green), or it produces one that fails because the row
 * does not do what it claims. Deleting the generated block would leave the coverage assertion failing on
 * every row at once. There is no way to add a transition and have this file stay silent about it.
 *
 * `EXERCISED` is module-level state shared between tests, which is normally a smell. Here it is the point:
 * the coverage assertion is a statement about the whole file's behaviour, and Vitest runs the tests in one
 * file in declaration order, so the final test sees everything the generated ones did.
 */

/** Rows actually exercised by the generated tests, as `"STATE:EVENT"`. @type {Set<string>} */
const EXERCISED = new Set();

/** Every row in the table, as `"STATE:EVENT"`. @type {string[]} */
const ALL_ROWS = Object.entries(TRANSITIONS).flatMap(([state, row]) =>
  Object.keys(row).map((event) => `${state}:${event}`),
);

/**
 * A shortest event path from `MAIN_MENU` (where the machine boots) to each state, so a generated test can
 * put the machine in the state whose row it is about to exercise. Written by hand rather than searched for,
 * because a hand-written path is itself an assertion about how the game is meant to be reached — and
 * {@link driveTo} checks each one actually lands where it claims, so a path that rots fails loudly.
 *
 * @type {Record<string, string[]>}
 */
const PATHS = {
  [STATES.MAIN_MENU]: [],
  [STATES.MATCH_SETUP]: [GAME_EVENTS.SELECT_2P],
  [STATES.TUTORIAL]: [GAME_EVENTS.SELECT_TUTORIAL],
  [STATES.PRACTICE]: [GAME_EVENTS.SELECT_PRACTICE],
  [STATES.SHOP]: [GAME_EVENTS.SELECT_SHOP],
  [STATES.SETTINGS]: [GAME_EVENTS.SELECT_SETTINGS],
  [STATES.COUNTDOWN]: [GAME_EVENTS.SELECT_2P, GAME_EVENTS.START_MATCH],
  [STATES.PLAYING]: [GAME_EVENTS.SELECT_2P, GAME_EVENTS.START_MATCH, GAME_EVENTS.COUNTDOWN_DONE],
  [STATES.LASER_WARNING]: [
    GAME_EVENTS.SELECT_2P,
    GAME_EVENTS.START_MATCH,
    GAME_EVENTS.COUNTDOWN_DONE,
    GAME_EVENTS.LASER_WARNING,
  ],
  [STATES.ROUND_OVER]: [
    GAME_EVENTS.SELECT_2P,
    GAME_EVENTS.START_MATCH,
    GAME_EVENTS.COUNTDOWN_DONE,
    GAME_EVENTS.ROUND_OVER,
  ],
  [STATES.MATCH_OVER]: [
    GAME_EVENTS.SELECT_2P,
    GAME_EVENTS.START_MATCH,
    GAME_EVENTS.COUNTDOWN_DONE,
    GAME_EVENTS.ROUND_OVER,
    GAME_EVENTS.MATCH_OVER,
  ],
  [STATES.PAUSE]: [
    GAME_EVENTS.SELECT_2P,
    GAME_EVENTS.START_MATCH,
    GAME_EVENTS.COUNTDOWN_DONE,
    GAME_EVENTS.PAUSE,
  ],
};

/**
 * A machine parked in `state`, reached through real events from the boot state — never by constructing it
 * with `initial: state`, because a machine dropped into PAUSE that way would have no memory of where it came
 * from and would not be the thing the game actually produces.
 *
 * @param {string} state
 * @param {object} [options] - forwarded to `createGameStateMachine`
 */
function driveTo(state, options = {}) {
  const machine = createGameStateMachine(options);
  for (const event of PATHS[state]) {
    machine.dispatch(/** @type {any} */ (event));
  }
  expect(machine.getState()).toBe(state);
  return machine;
}

describe('KS-05-02 the state machine vocabulary', () => {
  test('KS-05-02: the states are exactly the twelve the ticket lists', () => {
    // Spelled out rather than derived from `STATES`, so a state renamed or dropped in the source fails here
    // instead of quietly redefining what "every state" means for the coverage assertion below.
    expect(Object.keys(STATES).sort()).toEqual(
      [
        'COUNTDOWN',
        'LASER_WARNING',
        'MAIN_MENU',
        'MATCH_OVER',
        'MATCH_SETUP',
        'PAUSE',
        'PLAYING',
        'PRACTICE',
        'ROUND_OVER',
        'SETTINGS',
        'SHOP',
        'TUTORIAL',
      ].sort(),
    );
  });

  test('KS-05-02: the events are exactly the eighteen the ticket lists', () => {
    expect(Object.keys(GAME_EVENTS).sort()).toEqual(
      [
        'AUTO_PAUSE',
        'BACK',
        'COUNTDOWN_DONE',
        'LASER_WARNING',
        'LASER_WARNING_DONE',
        'MATCH_OVER',
        'NEXT_ROUND',
        'PAUSE',
        'QUIT_TO_MENU',
        'REMATCH',
        'RESUME',
        'ROUND_OVER',
        'SELECT_2P',
        'SELECT_PRACTICE',
        'SELECT_SETTINGS',
        'SELECT_SHOP',
        'SELECT_TUTORIAL',
        'START_MATCH',
      ].sort(),
    );
  });

  test('KS-05-02: every state has a row in the table, and every path reaches its state', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(Object.values(STATES).sort());
    for (const state of Object.values(STATES)) {
      expect(PATHS[state], `no path defined to ${state}`).toBeDefined();
      driveTo(state);
    }
  });

  test('KS-05-02: PAUSE is reachable from exactly PLAYING and LASER_WARNING', () => {
    // The ticket's own wording for what `RESUME` has to remember. Derived from the table in the source, so
    // a third state gaining a PAUSE row has to be a deliberate change to this expectation too.
    expect([...PAUSABLE_STATES].sort()).toEqual([STATES.LASER_WARNING, STATES.PLAYING].sort());
  });
});

describe('KS-05-02 AC1: every row of the transition table is exercised', () => {
  for (const [state, row] of Object.entries(TRANSITIONS)) {
    for (const [event, target] of Object.entries(row)) {
      test(`KS-05-02 AC1: ${state} --${event}--> ${target}`, () => {
        const machine = driveTo(state);

        // `can()` and `dispatch()` must agree about every row, in both directions.
        expect(machine.can(/** @type {any} */ (event))).toBe(true);
        expect(machine.legalEvents()).toContain(event);

        const expected =
          target === PREVIOUS ? /** @type {string} */ (machine.getPreviousState()) : target;
        expect(machine.dispatch(/** @type {any} */ (event))).toBe(expected);
        expect(machine.getState()).toBe(expected);

        EXERCISED.add(`${state}:${event}`);
      });
    }
  }
});

describe('KS-05-02 the machine', () => {
  test('KS-05-02 AC2: RESUME from PAUSE returns to the exact prior state', () => {
    for (const pausable of PAUSABLE_STATES) {
      for (const pauseEvent of [GAME_EVENTS.PAUSE, GAME_EVENTS.AUTO_PAUSE]) {
        const machine = driveTo(pausable);
        machine.dispatch(pauseEvent);
        expect(machine.getState()).toBe(STATES.PAUSE);
        expect(machine.getPreviousState()).toBe(pausable);
        expect(machine.dispatch(GAME_EVENTS.RESUME)).toBe(pausable);
        // Nothing left to resume into once we are back: a second RESUME is not a legal move.
        expect(machine.getPreviousState()).toBeNull();
        expect(machine.can(GAME_EVENTS.RESUME)).toBe(false);
      }
    }
  });

  test('KS-05-02 AC2: leaving PAUSE any other way forgets where it came from', () => {
    const machine = driveTo(STATES.PAUSE);
    expect(machine.getPreviousState()).toBe(STATES.PLAYING);
    machine.dispatch(GAME_EVENTS.QUIT_TO_MENU);
    expect(machine.getState()).toBe(STATES.MAIN_MENU);
    expect(machine.getPreviousState()).toBeNull();
  });

  test('KS-05-02 AC3: BACK from MAIN_MENU is a no-op', () => {
    const machine = createGameStateMachine();
    expect(machine.getState()).toBe(STATES.MAIN_MENU);
    expect(machine.can(GAME_EVENTS.BACK)).toBe(true);
    expect(machine.dispatch(GAME_EVENTS.BACK)).toBe(STATES.MAIN_MENU);
  });

  test('KS-05-02 AC3: BACK from MATCH_SETUP returns to MAIN_MENU', () => {
    const machine = driveTo(STATES.MATCH_SETUP);
    expect(machine.dispatch(GAME_EVENTS.BACK)).toBe(STATES.MAIN_MENU);
  });

  test('KS-05-02 AC3: BACK returns to MAIN_MENU from every placeholder screen too', () => {
    for (const screen of [STATES.TUTORIAL, STATES.PRACTICE, STATES.SHOP, STATES.SETTINGS]) {
      const machine = driveTo(screen);
      expect(machine.dispatch(GAME_EVENTS.BACK)).toBe(STATES.MAIN_MENU);
    }
  });

  test('KS-05-02 AC4: ROUND_OVER -> NEXT_ROUND -> COUNTDOWN when the match is not over', () => {
    const machine = driveTo(STATES.ROUND_OVER);
    expect(machine.dispatch(GAME_EVENTS.NEXT_ROUND)).toBe(STATES.COUNTDOWN);
    // …and the countdown leads back into a round, which is what makes it a loop rather than a dead end.
    expect(machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE)).toBe(STATES.PLAYING);
  });

  test('KS-05-02 AC4: ROUND_OVER -> MATCH_OVER when it is', () => {
    const machine = driveTo(STATES.ROUND_OVER);
    expect(machine.dispatch(GAME_EVENTS.MATCH_OVER)).toBe(STATES.MATCH_OVER);
    // REMATCH goes straight to a countdown (`DESIGN-DECISIONS §2.6`: same settings, swap nothing).
    expect(machine.dispatch(GAME_EVENTS.REMATCH)).toBe(STATES.COUNTDOWN);
  });

  test('KS-05-02: LASER_WARNING is a sub-state of PLAYING, not a way out of it', () => {
    const machine = driveTo(STATES.PLAYING);
    expect(machine.dispatch(GAME_EVENTS.LASER_WARNING)).toBe(STATES.LASER_WARNING);
    expect(machine.dispatch(GAME_EVENTS.LASER_WARNING_DONE)).toBe(STATES.PLAYING);
  });

  test('KS-05-02: a round can end while the laser warning is up', () => {
    const machine = driveTo(STATES.LASER_WARNING);
    expect(machine.dispatch(GAME_EVENTS.ROUND_OVER)).toBe(STATES.ROUND_OVER);
  });

  test('KS-05-02: onExit runs before the move and onEnter after it', () => {
    /** @type {string[]} */
    const log = [];
    const machine = createGameStateMachine({
      onExit: {
        [STATES.MAIN_MENU]: (context) => {
          log.push(`exit ${context.from}->${context.to} on ${context.event}`);
        },
      },
      onEnter: {
        [STATES.MATCH_SETUP]: (context) => {
          log.push(`enter ${context.from}->${context.to} on ${context.event}`);
          // The move is already done by the time an entry hook runs — a screen's `onEnter` can ask the
          // machine what state it is in and get the answer it expects.
          expect(machine.getState()).toBe(STATES.MATCH_SETUP);
        },
      },
    });

    machine.dispatch(GAME_EVENTS.SELECT_2P);
    expect(log).toEqual([
      'exit MAIN_MENU->MATCH_SETUP on SELECT_2P',
      'enter MAIN_MENU->MATCH_SETUP on SELECT_2P',
    ]);
  });

  test('KS-05-02: a self-transition still runs both hooks', () => {
    /** @type {string[]} */
    const log = [];
    const machine = createGameStateMachine({
      onExit: { [STATES.MAIN_MENU]: () => log.push('exit') },
      onEnter: { [STATES.MAIN_MENU]: () => log.push('enter') },
    });
    machine.dispatch(GAME_EVENTS.BACK);
    expect(log).toEqual(['exit', 'enter']);
  });

  test('KS-05-02: states without hooks transition perfectly happily', () => {
    const machine = createGameStateMachine({ onEnter: {}, onExit: {} });
    expect(machine.dispatch(GAME_EVENTS.SELECT_SHOP)).toBe(STATES.SHOP);
  });

  test('KS-05-02: is() and legalEvents() describe the current state', () => {
    const machine = driveTo(STATES.PLAYING);
    expect(machine.is(STATES.PLAYING)).toBe(true);
    expect(machine.is(STATES.PAUSE)).toBe(false);
    expect(machine.legalEvents().sort()).toEqual(
      [
        GAME_EVENTS.LASER_WARNING,
        GAME_EVENTS.ROUND_OVER,
        GAME_EVENTS.PAUSE,
        GAME_EVENTS.AUTO_PAUSE,
      ].sort(),
    );
  });

  test('KS-05-02: legalEvents() drops RESUME when there is nothing to resume into', () => {
    // Only reachable by constructing a machine *in* PAUSE, which the game itself never does — the point is
    // that `RESUME` reports itself illegal rather than resolving to `undefined`.
    const machine = createGameStateMachine({ initial: STATES.PAUSE });
    expect(machine.getPreviousState()).toBeNull();
    expect(machine.can(GAME_EVENTS.RESUME)).toBe(false);
    expect(machine.legalEvents().sort()).toEqual(
      [GAME_EVENTS.REMATCH, GAME_EVENTS.QUIT_TO_MENU].sort(),
    );
  });

  test('KS-05-02: an unknown initial state throws', () => {
    expect(() => createGameStateMachine({ initial: /** @type {any} */ ('NOWHERE') })).toThrow(
      RangeError,
    );
  });
});

describe('KS-05-02 illegal transitions', () => {
  test('KS-05-02: strict (DEV) throws, naming the state and the event', () => {
    const machine = createGameStateMachine();
    expect(machine.can(GAME_EVENTS.COUNTDOWN_DONE)).toBe(false);
    expect(() => machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE)).toThrow(
      /illegal transition MAIN_MENU --COUNTDOWN_DONE-->/,
    );
    expect(machine.getState()).toBe(STATES.MAIN_MENU);
  });

  test('KS-05-02: production ignores the event and logs it once', () => {
    /** @type {string[]} */
    const warnings = [];
    const machine = createGameStateMachine({ strict: false, warn: (m) => warnings.push(m) });

    machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE);
    machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE);
    machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE);

    expect(machine.getState()).toBe(STATES.MAIN_MENU);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/MAIN_MENU --COUNTDOWN_DONE-->/);

    // A *different* illegal transition is different information and is logged on its own.
    machine.dispatch(GAME_EVENTS.RESUME);
    expect(warnings).toHaveLength(2);
  });

  test('KS-05-02: the default warn channel is the console, and survives not having one', () => {
    /** @type {string[]} */
    const seen = [];
    const globalRef = /** @type {any} */ (globalThis);
    const realConsole = globalRef.console;
    try {
      globalRef.console = { warn: (/** @type {string} */ m) => seen.push(m) };
      createGameStateMachine({ strict: false }).dispatch(GAME_EVENTS.RESUME);
      expect(seen).toHaveLength(1);

      globalRef.console = undefined;
      expect(() =>
        createGameStateMachine({ strict: false }).dispatch(GAME_EVENTS.RESUME),
      ).not.toThrow();
    } finally {
      globalRef.console = realConsole;
    }
  });
});

describe('KS-05-02 AC1: table coverage', () => {
  test('KS-05-02 AC1: every row of the table was exercised by a test in this file', () => {
    const missing = ALL_ROWS.filter((row) => !EXERCISED.has(row));
    expect(
      missing,
      `transition rows added to gameStateMachine.js without a test: ${missing.join(', ')}`,
    ).toEqual([]);
    // …and nothing was recorded that is not in the table, which would mean this file and the source have
    // drifted apart in the other direction.
    expect([...EXERCISED].sort()).toEqual([...ALL_ROWS].sort());
  });
});
