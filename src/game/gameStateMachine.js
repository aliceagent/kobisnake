// @ts-check

/**
 * The game's state machine (`ARCHITECTURE §6`, GDD §7 "Suggested game states"), ticket KS-05-02.
 *
 * Every screen and every phase of a match is a state, and every way of getting from one to another is a row
 * in {@link TRANSITIONS}. That table is the whole of the machine's behaviour: `dispatch` does nothing but
 * look a row up, run the exit/enter hooks and move. Writing it as data rather than as a `switch` is what the
 * architecture asks for and what makes this sprint's headline acceptance criterion possible — QA generates
 * one test per row straight from the table, so a transition added without a test fails the table-coverage
 * assertion instead of shipping untested (`AC1`).
 *
 * Three things deserve their own note, because they are the parts a reader is most likely to get wrong:
 *
 * 1. **`PAUSE` is the one state whose exit is not in the table.** `RESUME` goes back to *the state pause was
 *    entered from*, which is PLAYING or LASER_WARNING depending on when the player hit Esc. The row is still
 *    a row — its target is the {@link PREVIOUS} sentinel, resolved at dispatch time — so it is still counted
 *    and still covered.
 * 2. **`LASER_WARNING` is a sub-state of PLAYING, not a replacement for it.** The simulation keeps running
 *    through it (`ARCHITECTURE §6`); the state exists so the UI and, from Sprint 12, the audio can react to
 *    the beams igniting. That is why it carries the same `ROUND_OVER` / `PAUSE` / `AUTO_PAUSE` rows PLAYING
 *    does: a round can end, and a player can pause, while the warning banner is up.
 * 3. **The countdown is a state, not a simulation phase.** `DESIGN-DECISIONS §2.5` puts 3·2·1·GO here rather
 *    than in `core/round.js`, and the simulation's clock only starts on the first PLAYING tick. This file
 *    owns *that the countdown exists*; `session.js` owns how long each step lasts.
 *
 * Nothing here touches the DOM, three.js, `window` or a clock. The machine is a pure function of the events
 * it is sent, which is what lets `tests/unit/game/gameStateMachine.test.js` drive every row in Node.
 */

/**
 * Every state, exactly as `ARCHITECTURE §6` and the ticket list them. The values are their own names so a
 * state read out of a snapshot or a log is self-describing.
 *
 * @type {{
 *   MAIN_MENU: 'MAIN_MENU',
 *   MATCH_SETUP: 'MATCH_SETUP',
 *   TUTORIAL: 'TUTORIAL',
 *   PRACTICE: 'PRACTICE',
 *   SHOP: 'SHOP',
 *   SETTINGS: 'SETTINGS',
 *   COUNTDOWN: 'COUNTDOWN',
 *   PLAYING: 'PLAYING',
 *   LASER_WARNING: 'LASER_WARNING',
 *   ROUND_OVER: 'ROUND_OVER',
 *   MATCH_OVER: 'MATCH_OVER',
 *   PAUSE: 'PAUSE',
 * }}
 */
export const STATES = Object.freeze({
  MAIN_MENU: 'MAIN_MENU',
  MATCH_SETUP: 'MATCH_SETUP',
  TUTORIAL: 'TUTORIAL',
  PRACTICE: 'PRACTICE',
  SHOP: 'SHOP',
  SETTINGS: 'SETTINGS',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  LASER_WARNING: 'LASER_WARNING',
  ROUND_OVER: 'ROUND_OVER',
  MATCH_OVER: 'MATCH_OVER',
  PAUSE: 'PAUSE',
});

/** @typedef {'MAIN_MENU' | 'MATCH_SETUP' | 'TUTORIAL' | 'PRACTICE' | 'SHOP' | 'SETTINGS' | 'COUNTDOWN' | 'PLAYING' | 'LASER_WARNING' | 'ROUND_OVER' | 'MATCH_OVER' | 'PAUSE'} GameState */

/**
 * Every event the machine understands, exactly as the ticket lists them.
 *
 * These are *intentions*, not simulation events: `core/events.js`'s `LASER_WARNING` and `ROUND_OVER` are
 * things the simulation announces, and `session.js` is what turns one into the other. The names are shared
 * deliberately — one vocabulary for "the beams lit" across the whole codebase — but the two enums are not
 * interchangeable and neither module imports the other.
 *
 * @type {{
 *   SELECT_2P: 'SELECT_2P',
 *   SELECT_PRACTICE: 'SELECT_PRACTICE',
 *   SELECT_TUTORIAL: 'SELECT_TUTORIAL',
 *   SELECT_SHOP: 'SELECT_SHOP',
 *   SELECT_SETTINGS: 'SELECT_SETTINGS',
 *   BACK: 'BACK',
 *   START_MATCH: 'START_MATCH',
 *   COUNTDOWN_DONE: 'COUNTDOWN_DONE',
 *   LASER_WARNING: 'LASER_WARNING',
 *   LASER_WARNING_DONE: 'LASER_WARNING_DONE',
 *   ROUND_OVER: 'ROUND_OVER',
 *   NEXT_ROUND: 'NEXT_ROUND',
 *   MATCH_OVER: 'MATCH_OVER',
 *   REMATCH: 'REMATCH',
 *   PAUSE: 'PAUSE',
 *   RESUME: 'RESUME',
 *   QUIT_TO_MENU: 'QUIT_TO_MENU',
 *   AUTO_PAUSE: 'AUTO_PAUSE',
 * }}
 */
export const GAME_EVENTS = Object.freeze({
  SELECT_2P: 'SELECT_2P',
  SELECT_PRACTICE: 'SELECT_PRACTICE',
  SELECT_TUTORIAL: 'SELECT_TUTORIAL',
  SELECT_SHOP: 'SELECT_SHOP',
  SELECT_SETTINGS: 'SELECT_SETTINGS',
  BACK: 'BACK',
  START_MATCH: 'START_MATCH',
  COUNTDOWN_DONE: 'COUNTDOWN_DONE',
  LASER_WARNING: 'LASER_WARNING',
  LASER_WARNING_DONE: 'LASER_WARNING_DONE',
  ROUND_OVER: 'ROUND_OVER',
  NEXT_ROUND: 'NEXT_ROUND',
  MATCH_OVER: 'MATCH_OVER',
  REMATCH: 'REMATCH',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  QUIT_TO_MENU: 'QUIT_TO_MENU',
  AUTO_PAUSE: 'AUTO_PAUSE',
});

/** @typedef {'SELECT_2P' | 'SELECT_PRACTICE' | 'SELECT_TUTORIAL' | 'SELECT_SHOP' | 'SELECT_SETTINGS' | 'BACK' | 'START_MATCH' | 'COUNTDOWN_DONE' | 'LASER_WARNING' | 'LASER_WARNING_DONE' | 'ROUND_OVER' | 'NEXT_ROUND' | 'MATCH_OVER' | 'REMATCH' | 'PAUSE' | 'RESUME' | 'QUIT_TO_MENU' | 'AUTO_PAUSE'} GameEvent */

/**
 * The target of `PAUSE`'s `RESUME` row: "whichever state pause was entered from" (`AC2`). It is a distinct
 * string rather than a `null` or a missing target so the row reads as a real row in the table, is counted by
 * the coverage assertion like every other row, and cannot be mistaken for "no transition".
 *
 * @type {'PREVIOUS'}
 */
export const PREVIOUS = 'PREVIOUS';

/**
 * The transition table: `TRANSITIONS[state][event]` is the state that event moves to, or {@link PREVIOUS}.
 * A missing entry is an illegal transition. This is the machine's entire specification — the ticket's AC1
 * generates one test per row from exactly this object, so a row added here without thought is a row a test
 * will immediately demand an answer for.
 *
 * Notes on rows a reader might expect and not find:
 *
 * - **`BACK` on `MAIN_MENU` is a real row that lands on `MAIN_MENU`** (`AC3`: "a no-op"). Written as a row
 *   rather than left out, because "Esc at the top level does nothing" is a decision, and an omitted row would
 *   make it throw in DEV instead.
 * - **`COUNTDOWN` has no `PAUSE` / `AUTO_PAUSE` row**, and no way out but `COUNTDOWN_DONE`. The ticket fixes
 *   pause's memory as "PLAYING or LASER_WARNING", so those two states are the only ones that can be paused.
 *   Nothing is lost: the countdown is driven by frames, and `loop.js` stops giving out frames the moment the
 *   tab is hidden, so a countdown in a backgrounded tab already stands still without a state change.
 * - **`ROUND_OVER` carries both `NEXT_ROUND` and `MATCH_OVER`** (`AC4`), and nothing else. Which one fires is
 *   `match.js`'s answer to `isOver()`, asked by `session.js`; the machine does not know the score and must
 *   not. The scoreboard has no quit affordance in `DESIGN-DECISIONS §2.6`, so there is no row for one.
 * - **`PAUSE` carries `REMATCH`.** `DESIGN-DECISIONS §2.8` gives the pause screen three items — Resume,
 *   Restart match, Quit to menu — and the ticket's event list has no `RESTART_MATCH`. "Restart match" is
 *   `REMATCH`: same settings, score back to nothing, straight into a countdown. Mapping it onto the existing
 *   event is deliberate; inventing an eighteenth event for it would be inventing a mechanic.
 * - **`PRACTICE`, `TUTORIAL`, `SHOP` and `SETTINGS` only carry `BACK`.** They are grey placeholders until
 *   Sprints 12–15; their real inner flows arrive with them, as new rows here.
 *
 * @type {Readonly<Record<GameState, Readonly<Partial<Record<GameEvent, GameState | 'PREVIOUS'>>>>>}
 */
export const TRANSITIONS = Object.freeze({
  [STATES.MAIN_MENU]: Object.freeze({
    [GAME_EVENTS.SELECT_2P]: STATES.MATCH_SETUP,
    [GAME_EVENTS.SELECT_PRACTICE]: STATES.PRACTICE,
    [GAME_EVENTS.SELECT_TUTORIAL]: STATES.TUTORIAL,
    [GAME_EVENTS.SELECT_SHOP]: STATES.SHOP,
    [GAME_EVENTS.SELECT_SETTINGS]: STATES.SETTINGS,
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.MATCH_SETUP]: Object.freeze({
    [GAME_EVENTS.START_MATCH]: STATES.COUNTDOWN,
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.TUTORIAL]: Object.freeze({
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.PRACTICE]: Object.freeze({
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.SHOP]: Object.freeze({
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.SETTINGS]: Object.freeze({
    [GAME_EVENTS.BACK]: STATES.MAIN_MENU,
  }),
  [STATES.COUNTDOWN]: Object.freeze({
    [GAME_EVENTS.COUNTDOWN_DONE]: STATES.PLAYING,
  }),
  [STATES.PLAYING]: Object.freeze({
    [GAME_EVENTS.LASER_WARNING]: STATES.LASER_WARNING,
    [GAME_EVENTS.ROUND_OVER]: STATES.ROUND_OVER,
    [GAME_EVENTS.PAUSE]: STATES.PAUSE,
    [GAME_EVENTS.AUTO_PAUSE]: STATES.PAUSE,
  }),
  [STATES.LASER_WARNING]: Object.freeze({
    [GAME_EVENTS.LASER_WARNING_DONE]: STATES.PLAYING,
    [GAME_EVENTS.ROUND_OVER]: STATES.ROUND_OVER,
    [GAME_EVENTS.PAUSE]: STATES.PAUSE,
    [GAME_EVENTS.AUTO_PAUSE]: STATES.PAUSE,
  }),
  [STATES.ROUND_OVER]: Object.freeze({
    [GAME_EVENTS.NEXT_ROUND]: STATES.COUNTDOWN,
    [GAME_EVENTS.MATCH_OVER]: STATES.MATCH_OVER,
  }),
  [STATES.MATCH_OVER]: Object.freeze({
    [GAME_EVENTS.REMATCH]: STATES.COUNTDOWN,
    [GAME_EVENTS.QUIT_TO_MENU]: STATES.MAIN_MENU,
  }),
  [STATES.PAUSE]: Object.freeze({
    [GAME_EVENTS.RESUME]: PREVIOUS,
    [GAME_EVENTS.REMATCH]: STATES.COUNTDOWN,
    [GAME_EVENTS.QUIT_TO_MENU]: STATES.MAIN_MENU,
  }),
});

/**
 * The states `PAUSE` can be entered from, and therefore the only states `RESUME` can return to. Derived from
 * {@link TRANSITIONS} rather than written out again, so it cannot fall out of step with the table: it is
 * every state that has a row landing on `PAUSE`.
 *
 * @type {readonly GameState[]}
 */
export const PAUSABLE_STATES = Object.freeze(
  /** @type {GameState[]} */ (Object.keys(TRANSITIONS)).filter((state) =>
    Object.values(TRANSITIONS[state]).includes(STATES.PAUSE),
  ),
);

/**
 * What a state's `onEnter` / `onExit` hook is told: which event moved the machine, and which state it came
 * from or is going to. Hooks receive a context object rather than positional arguments so a later sprint can
 * add a field without rewriting every hook in `session.js`.
 *
 * @typedef {object} TransitionContext
 * @property {GameState} from - the state being left
 * @property {GameState} to - the state being entered
 * @property {GameEvent} event - the event that caused the move
 */

/** @typedef {(context: TransitionContext) => void} StateHook */

/**
 * @typedef {object} GameStateMachine
 * @property {() => GameState} getState - the state right now
 * @property {() => GameState | null} getPreviousState - the state `PAUSE` will `RESUME` to, or `null` when
 *   the machine is not paused
 * @property {(event: GameEvent) => boolean} can - is this event legal from the current state?
 * @property {(event: GameEvent) => GameState} dispatch - apply an event; returns the resulting state, which
 *   is the unchanged current state when the event was illegal and the machine is not strict
 * @property {(state: GameState) => boolean} is - convenience for `getState() === state`
 * @property {() => GameEvent[]} legalEvents - every event legal from the current state, for a UI that wants
 *   to grey out what it cannot do
 */

/**
 * @typedef {object} CreateGameStateMachineOptions
 * @property {GameState} [initial] - starting state; defaults to `MAIN_MENU`, where the game boots
 * @property {Partial<Record<GameState, StateHook>>} [onEnter] - per-state entry hooks
 * @property {Partial<Record<GameState, StateHook>>} [onExit] - per-state exit hooks
 * @property {boolean} [strict] - `true` (the default) throws on an illegal transition, which is what a
 *   developer and a unit test want; `false` ignores it and logs it once. `main.js` passes
 *   `import.meta.env.DEV || ?test=1` — this module never reads `import.meta` itself, for the same reason
 *   `testHooks.js` does not: a module that reaches for a build-time global cannot be proven in plain Node.
 * @property {(message: string) => void} [warn] - where the production log goes; defaults to `console.warn`
 *   where there is one and to a no-op where there is not
 */

/**
 * `console.warn` if the platform has a console, and a no-op if it does not. Resolved lazily inside the
 * factory rather than at module load so a test can replace the global before constructing a machine.
 *
 * @param {string} message
 */
function defaultWarn(message) {
  const consoleRef = /** @type {{warn?: (msg: string) => void} | undefined} */ (
    /** @type {any} */ (globalThis).console
  );
  consoleRef?.warn?.(message);
}

/**
 * Build a state machine.
 *
 * @param {CreateGameStateMachineOptions} [options]
 * @returns {GameStateMachine}
 */
export function createGameStateMachine({
  initial = STATES.MAIN_MENU,
  onEnter = {},
  onExit = {},
  strict = true,
  warn = defaultWarn,
} = {}) {
  if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, initial)) {
    throw new RangeError(
      `createGameStateMachine: unknown initial state ${JSON.stringify(initial)}`,
    );
  }

  /** @type {GameState} */
  let state = initial;
  /**
   * The state `PAUSE` was entered from — `RESUME`'s destination (`AC2`). Cleared on the way out of PAUSE so
   * that a stale value can never be resumed into: after `QUIT_TO_MENU` from a pause there is no "prior
   * state" any more, and `getPreviousState()` says so by answering `null`.
   * @type {GameState | null}
   */
  let previousState = null;
  /**
   * Illegal transitions already logged, as `"STATE:EVENT"`. The ticket says an ignored transition is "logged
   * once"; keyed per state+event rather than once for the machine's whole life because the thing worth not
   * repeating is *this* mistake — a held-down Esc would otherwise write the same line every frame — while a
   * second, different illegal transition is new information a developer should still see.
   * @type {Set<string>}
   */
  const loggedIllegal = new Set();

  /**
   * The state `event` leads to from the state we are in, with {@link PREVIOUS} already resolved, or `null`
   * when there is no such row.
   *
   * @param {GameEvent} event
   * @returns {GameState | null}
   */
  function resolveTarget(event) {
    const row = TRANSITIONS[state];
    const target = row[event];
    if (target === undefined) return null;
    if (target !== PREVIOUS) return target;
    // `RESUME` from a PAUSE the machine somehow reached without remembering where from. Unreachable through
    // the table (every row into PAUSE records it), but resolving to `null` here means such a bug surfaces as
    // an illegal transition rather than as an `undefined` state leaking into `session.js` and the UI.
    return previousState;
  }

  /** @param {GameEvent} event */
  function can(event) {
    return resolveTarget(event) !== null;
  }

  /**
   * Apply an event. Legal transitions run `onExit[from]`, move, then run `onEnter[to]` — in that order, so a
   * hook that inspects `getState()` always sees the move as already done by the time the entry hook runs and
   * as not yet done in the exit hook.
   *
   * A self-transition (`BACK` on MAIN_MENU, `AC3`) still runs both hooks. That is deliberate: the row exists
   * because "go back to the main menu" is a real intention, and a screen that wants to reset itself on it
   * should get the chance.
   *
   * @param {GameEvent} event
   * @returns {GameState}
   */
  function dispatch(event) {
    const target = resolveTarget(event);
    if (target === null) {
      const message = `gameStateMachine: illegal transition ${state} --${event}-->`;
      if (strict) throw new Error(message);
      const key = `${state}:${event}`;
      if (!loggedIllegal.has(key)) {
        loggedIllegal.add(key);
        warn(message);
      }
      return state;
    }

    const from = state;
    /** @type {TransitionContext} */
    const context = { from, to: target, event };

    onExit[from]?.(context);
    // Pause's memory is written on the way in and cleared on every other move, so `getPreviousState()` is
    // only ever non-null while the machine is actually paused.
    previousState = target === STATES.PAUSE ? from : null;
    state = target;
    onEnter[target]?.(context);

    return state;
  }

  return {
    getState: () => state,
    getPreviousState: () => previousState,
    can,
    dispatch,
    is: (candidate) => state === candidate,
    legalEvents: () =>
      /** @type {GameEvent[]} */ (Object.keys(TRANSITIONS[state])).filter((event) => can(event)),
  };
}
