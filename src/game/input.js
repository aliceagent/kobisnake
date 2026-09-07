// @ts-check

import { DIRECTIONS } from '../core/grid.js';

/**
 * Keyboard input for both players and for menu navigation (ARCHITECTURE §3, §8; DESIGN-DECISIONS §2.2).
 *
 * `createInput` owns a single `keydown` listener on a shared event target (`window` by default) and turns
 * key codes into two kinds of callback:
 *   - `onDirection(playerId, dir)` — a gameplay steering input. `playerId` is the plain number `1` or `2`
 *     (not the `'p1'`/`'p2'` string ids `RoundSimulation` uses — mapping those together is left to whatever
 *     wires this module to a round, per the ticket's contract).
 *   - `onMenu(action)` — one of `'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CONFIRM' | 'BACK' | 'PAUSE_TOGGLE'`,
 *     for menu screens and the pause key.
 *
 * WASD always means player 1, the arrow keys always mean player 2 — except in `soloSteering` mode, where
 * both key sets steer player 1 (DESIGN-DECISIONS §2.2: single-player, practice and tutorial). `setMode`
 * controls which callback(s) a key fires: `'game'` only steers, `'menu'` only navigates, `'both'` does both
 * from the same keypress (a key that means a direction fires `onDirection` *and* the matching menu action).
 * The default mode is `'game'`, since most of a KOBI Snake session is spent playing rather than in a menu.
 *
 * A third, optional callback exists purely for KS-07-06's instrumentation: `onDirectionTimed(playerId, dir,
 * atMs)` fires immediately before `onDirection`, for the same key, carrying the clock reading taken at the
 * moment this module decoded the keydown — the earliest instant of the ticket's "keydown -> queued ->
 * committed step -> first rendered frame" pipeline. It changes nothing about `onDirection`'s own contract
 * (still called with exactly `(playerId, dir)`, so every existing caller and test is untouched) and defaults
 * to a no-op, so a caller that does not pass it pays nothing beyond one extra no-op call per steering key.
 */

/** @typedef {{dx: number, dy: number}} Direction */
/**
 * `PAUSE_TOGGLE` is `Space`, and only `Space` (`DESIGN-DECISIONS §2.8`, issue #103). It is deliberately not
 * `BACK`: `§2.8` gives Space exactly one meaning — open the pause screen during a round, and resume from it
 * — while Esc's `BACK` means "back" on *every* screen. Emitting `BACK` here would make Space back out of the
 * main menu and the setup screen too, which `§2.8` says it must not do. Which states it acts in is knowledge
 * `session.js` already has and this module does not, so this module reports the key and `session.js` decides:
 * in PLAYING, LASER_WARNING and PAUSE it is treated as the `BACK` Esc would have produced, and everywhere
 * else it is dropped. Space is never `CONFIRM` anywhere — Enter remains select on menus.
 *
 * @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CONFIRM' | 'BACK' | 'PAUSE_TOGGLE'} MenuAction
 */
/** @typedef {'game' | 'menu' | 'both'} InputMode */

/**
 * @typedef {object} CreateInputOptions
 * @property {(playerId: 1 | 2, dir: Direction) => void} [onDirection] Fired for a gameplay steering key.
 * @property {(action: MenuAction) => void} [onMenu] Fired for a menu-navigation key.
 * @property {(playerId: 1 | 2, dir: Direction, atMs: number) => void} [onDirectionTimed] KS-07-06: fired
 *   immediately before `onDirection`, for the same steering key, with a clock reading taken right here (see
 *   `now` below). Defaults to a no-op.
 * @property {InputMode} [mode] Initial mode. Defaults to `'game'`.
 * @property {boolean} [soloSteering] When true, both WASD and the arrow keys steer player 1. Defaults to false.
 * @property {EventTarget} [target] Where to listen for `keydown`. Defaults to `window` when it exists, so the
 *   module can be imported (though not constructed without an explicit target) in a plain Node environment.
 * @property {() => number} [now] KS-07-06: the clock `onDirectionTimed` reads. Defaults to `performance.now`
 *   where there is one, else `Date.now` — injectable so a test can supply a controlled clock without this
 *   module ever having its own opinion about which one is "real".
 */

/**
 * @typedef {object} InputHandle
 * @property {(mode: InputMode) => void} setMode Switch which callback(s) keys fire.
 * @property {(enabled: boolean) => void} setSoloSteering Toggle solo steering on or off.
 * @property {() => void} destroy Remove the `keydown` listener. Safe to call once; further calls are no-ops.
 */

/**
 * WASD → player 1's four directions. A `Map`, not a plain object, so an unusual `code` (e.g. a future
 * `'constructor'` or `'toString'`) can never resolve to an inherited `Object.prototype` value instead of
 * `undefined`.
 * @type {ReadonlyMap<string, Direction>}
 */
const PLAYER_ONE_KEYS = new Map([
  ['KeyW', DIRECTIONS.UP],
  ['KeyS', DIRECTIONS.DOWN],
  ['KeyA', DIRECTIONS.LEFT],
  ['KeyD', DIRECTIONS.RIGHT],
]);

/**
 * Arrow keys → player 2's four directions (also player 1's, when solo steering is on).
 * @type {ReadonlyMap<string, Direction>}
 */
const PLAYER_TWO_KEYS = new Map([
  ['ArrowUp', DIRECTIONS.UP],
  ['ArrowDown', DIRECTIONS.DOWN],
  ['ArrowLeft', DIRECTIONS.LEFT],
  ['ArrowRight', DIRECTIONS.RIGHT],
]);

/**
 * Every directional key code maps to the same `MenuAction` name regardless of which player it steers.
 * @type {ReadonlyMap<string, MenuAction>}
 */
const DIRECTION_MENU_ACTIONS = new Map([
  ['KeyW', 'UP'],
  ['KeyS', 'DOWN'],
  ['KeyA', 'LEFT'],
  ['KeyD', 'RIGHT'],
  ['ArrowUp', 'UP'],
  ['ArrowDown', 'DOWN'],
  ['ArrowLeft', 'LEFT'],
  ['ArrowRight', 'RIGHT'],
]);

/** Key codes that must never scroll or otherwise act on the page (the ticket's spec, verbatim). */
const PREVENT_DEFAULT_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/**
 * KS-07-06's default clock for `onDirectionTimed`: `performance.now()` where there is one, `Date.now()`
 * where there is not. Mirrors `loop.js`'s own `defaultNow` (and `inputLatency.js`'s copy of it) — duplicated
 * rather than imported so this module keeps its existing zero-dependency shape.
 *
 * @returns {number}
 */
function defaultNow() {
  const performanceRef = /** @type {{now?: () => number} | undefined} */ (
    /** @type {any} */ (globalThis).performance
  );
  return performanceRef?.now ? performanceRef.now() : Date.now();
}

/**
 * Wires up keyboard listening. Call `destroy()` on the returned handle when the input is no longer needed
 * (leaving a global listener behind leaks across rounds/menus and across tests).
 *
 * @param {CreateInputOptions} [options]
 * @returns {InputHandle}
 */
export function createInput(options = {}) {
  const {
    onDirection = () => {},
    onMenu = () => {},
    onDirectionTimed = () => {},
    mode: initialMode = 'game',
    soloSteering: initialSoloSteering = false,
    target = typeof window !== 'undefined' ? window : undefined,
    now = defaultNow,
  } = options;

  if (target === undefined) {
    throw new Error('createInput: no event target available; pass `target` explicitly');
  }

  /** @type {InputMode} */
  let mode = initialMode;
  let soloSteering = initialSoloSteering;
  let destroyed = false;

  /** @param {Event} event */
  const handleKeydown = (event) => {
    const keyboardEvent =
      /** @type {{ code: string, repeat: boolean, preventDefault: () => void }} */ (
        /** @type {unknown} */ (event)
      );
    const { code, repeat } = keyboardEvent;

    // "The page must never scroll" (the browser's concern) and "a held key is one logical input" (the
    // game's concern) are independent rules, so this must run before the repeat guard below: auto-repeat
    // keydowns are exactly when a browser would otherwise scroll on a held arrow key, so preventDefault has
    // to fire on every one of them, not just the first (AC3).
    if (PREVENT_DEFAULT_CODES.has(code)) {
      keyboardEvent.preventDefault();
    }

    // Key repeat (holding a key down) must not resend the same input every frame the browser re-fires
    // keydown (AC2) — a single physical press is a single logical input.
    if (repeat) return;

    if (mode !== 'menu') {
      const dir = PLAYER_ONE_KEYS.get(code);
      if (dir !== undefined) {
        // KS-07-06: the timed callback fires first, on the same key, so its timestamp is the earliest
        // reading this module ever takes for this input — see the module comment on `onDirectionTimed`.
        onDirectionTimed(1, dir, now());
        onDirection(1, dir);
      } else {
        const p2Dir = PLAYER_TWO_KEYS.get(code);
        if (p2Dir !== undefined) {
          const playerId = soloSteering ? 1 : 2;
          onDirectionTimed(playerId, p2Dir, now());
          onDirection(playerId, p2Dir);
        }
      }
    }

    if (mode !== 'game') {
      const menuDir = DIRECTION_MENU_ACTIONS.get(code);
      if (menuDir !== undefined) {
        onMenu(menuDir);
      } else if (code === 'Enter') {
        onMenu('CONFIRM');
      } else if (code === 'Escape') {
        onMenu('BACK');
      } else if (code === 'Space') {
        onMenu('PAUSE_TOGGLE');
      }
    }
  };

  target.addEventListener('keydown', handleKeydown);

  return {
    setMode(nextMode) {
      mode = nextMode;
    },
    setSoloSteering(enabled) {
      soloSteering = enabled;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      target.removeEventListener('keydown', handleKeydown);
    },
  };
}
