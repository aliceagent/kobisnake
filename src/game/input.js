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
 *   - `onMenu(action)` — one of `'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CONFIRM' | 'BACK'`, for menu screens.
 *
 * WASD always means player 1, the arrow keys always mean player 2 — except in `soloSteering` mode, where
 * both key sets steer player 1 (DESIGN-DECISIONS §2.2: single-player, practice and tutorial). `setMode`
 * controls which callback(s) a key fires: `'game'` only steers, `'menu'` only navigates, `'both'` does both
 * from the same keypress (a key that means a direction fires `onDirection` *and* the matching menu action).
 * The default mode is `'game'`, since most of a KOBI Snake session is spent playing rather than in a menu.
 */

/** @typedef {{dx: number, dy: number}} Direction */
/** @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'CONFIRM' | 'BACK'} MenuAction */
/** @typedef {'game' | 'menu' | 'both'} InputMode */

/**
 * @typedef {object} CreateInputOptions
 * @property {(playerId: 1 | 2, dir: Direction) => void} [onDirection] Fired for a gameplay steering key.
 * @property {(action: MenuAction) => void} [onMenu] Fired for a menu-navigation key.
 * @property {InputMode} [mode] Initial mode. Defaults to `'game'`.
 * @property {boolean} [soloSteering] When true, both WASD and the arrow keys steer player 1. Defaults to false.
 * @property {EventTarget} [target] Where to listen for `keydown`. Defaults to `window` when it exists, so the
 *   module can be imported (though not constructed without an explicit target) in a plain Node environment.
 */

/**
 * @typedef {object} InputHandle
 * @property {(mode: InputMode) => void} setMode Switch which callback(s) keys fire.
 * @property {(enabled: boolean) => void} setSoloSteering Toggle solo steering on or off.
 * @property {() => void} destroy Remove the `keydown` listener. Safe to call once; further calls are no-ops.
 */

/**
 * WASD → player 1's four directions.
 * @type {Readonly<Record<string, Direction>>}
 */
const PLAYER_ONE_KEYS = Object.freeze({
  KeyW: DIRECTIONS.UP,
  KeyS: DIRECTIONS.DOWN,
  KeyA: DIRECTIONS.LEFT,
  KeyD: DIRECTIONS.RIGHT,
});

/**
 * Arrow keys → player 2's four directions (also player 1's, when solo steering is on).
 * @type {Readonly<Record<string, Direction>>}
 */
const PLAYER_TWO_KEYS = Object.freeze({
  ArrowUp: DIRECTIONS.UP,
  ArrowDown: DIRECTIONS.DOWN,
  ArrowLeft: DIRECTIONS.LEFT,
  ArrowRight: DIRECTIONS.RIGHT,
});

/**
 * Every directional key code maps to the same `MenuAction` name regardless of which player it steers.
 * @type {Readonly<Record<string, MenuAction>>}
 */
const DIRECTION_MENU_ACTIONS = Object.freeze({
  KeyW: 'UP',
  KeyS: 'DOWN',
  KeyA: 'LEFT',
  KeyD: 'RIGHT',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
});

/** Key codes that must never scroll or otherwise act on the page (the ticket's spec, verbatim). */
const PREVENT_DEFAULT_CODES = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

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
    mode: initialMode = 'game',
    soloSteering: initialSoloSteering = false,
    target = typeof window !== 'undefined' ? window : undefined,
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

    // Key repeat (holding a key down) must not resend the same input every frame the browser re-fires
    // keydown (AC2) — a single physical press is a single logical input.
    if (repeat) return;

    if (PREVENT_DEFAULT_CODES.has(code)) {
      keyboardEvent.preventDefault();
    }

    if (mode !== 'menu') {
      const dir = PLAYER_ONE_KEYS[code];
      if (dir !== undefined) {
        onDirection(1, dir);
      } else {
        const p2Dir = PLAYER_TWO_KEYS[code];
        if (p2Dir !== undefined) {
          onDirection(soloSteering ? 1 : 2, p2Dir);
        }
      }
    }

    if (mode !== 'game') {
      const menuDir = DIRECTION_MENU_ACTIONS[code];
      if (menuDir !== undefined) {
        onMenu(menuDir);
      } else if (code === 'Enter') {
        onMenu('CONFIRM');
      } else if (code === 'Escape') {
        onMenu('BACK');
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
