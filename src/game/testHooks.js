// @ts-check
import { DIRECTIONS } from '../core/grid.js';

/**
 * `window.__kobi` (KS-03-06, `ARCHITECTURE §11`): a small, deterministic remote control for Playwright,
 * wired to the same modules a human touches rather than reaching around them — `pressKey` dispatches a real
 * `keydown` at the same target `createInput` listens on, and `fastForward` drives the session's own update
 * path (round-over handling and the HUD write included), not `RoundSimulation` directly.
 *
 * This module never reads `window`, `location` or `import.meta` itself — `main.js` owns the DEV/`?test=1`
 * gate and the `window.__kobi = ...` assignment, so `createTestHooks` stays a plain function of its options,
 * provable in Node without a browser.
 */

/** @typedef {{dx: number, dy: number}} Direction */
/** @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT'} DirectionName */

/**
 * The pieces of `session.js` `__kobi` drives. `createSession`'s real return value satisfies this; a unit
 * test passes a smaller fake with just these members.
 *
 * @typedef {object} TestHooksSession
 * @property {() => import('../core/round.js').RoundSimulation | null} getSim - live: called on every
 *   `sim`/`getSnapshot` access, so it never goes stale across a round restart.
 * @property {(dt: number) => void} advanceSimulation - runs the round update path once, with no render
 *   (`session.js`'s deviation for this ticket — see its own doc comment on why it exists).
 * @property {() => void} renderFrame - draws exactly one frame of whatever the sim currently looks like.
 * @property {(seed: number | null) => void} setSeed - fixes the seed the *next* round starts with.
 */

/**
 * The piece of the renderer `__kobi` drives.
 *
 * @typedef {object} TestHooksRenderer
 * @property {(player: number) => {x: number, y: number, z: number}} getHeadWorldPosition
 */

/**
 * @typedef {object} CreateTestHooksOptions
 * @property {TestHooksSession} session
 * @property {TestHooksRenderer} renderer
 * @property {EventTarget} [eventTarget] - where `pressKey` dispatches its `keydown`. Defaults to `window`,
 *   the same target `createInput` listens on by default (`main.js` never overrides it). Injectable so this
 *   module's logic is provable in Node, which has no `window`.
 * @property {new (type: string, init?: object) => Event} [KeyboardEventCtor] - defaults to the platform's
 *   `KeyboardEvent`. Injectable for the same reason — Node has no `KeyboardEvent` either.
 */

/**
 * The shape assigned to `window.__kobi` (`ARCHITECTURE §11` plus this ticket's `getHeadWorldPosition`).
 *
 * @typedef {object} KobiTestHooks
 * @property {import('../core/round.js').RoundSimulation | null} sim - a live getter: reads
 *   `session.getSim()` on every access rather than capturing one round's reference, because `session.js`
 *   replaces the `RoundSimulation` on every round restart (KS-03-06 tech-lead notes).
 * @property {null} stateMachine - `gameStateMachine.js` does not exist until Sprint 05
 *   (`ARCHITECTURE §6`); documented and present as `null` rather than silently missing, so a Sprint 05
 *   ticket does not have to guess whether it was forgotten.
 * @property {(seed: number | null) => void} setSeed - fixes the seed the *next* round uses.
 * @property {(seconds: number) => void} fastForward - advances the sim `seconds` simulated seconds with no
 *   render in between, then draws exactly one frame.
 * @property {() => object | null} getSnapshot - `session.getSim()?.getState() ?? null`.
 * @property {(player: 1 | 2, dir: Direction | DirectionName) => void} pressKey
 * @property {(player: number) => {x: number, y: number, z: number}} getHeadWorldPosition
 */

/** The four direction names `pressKey` accepts as a string, in the order `core/grid.js`'s `DIRECTIONS` lists them. */
const DIRECTION_NAMES = /** @type {readonly DirectionName[]} */ (['UP', 'DOWN', 'LEFT', 'RIGHT']);

/**
 * Key codes `input.js` maps to each direction, one table per player — mirrored here (not imported; `input.js`
 * does not export them) so `pressKey` fires the identical `code` a real key press would (KS-03-06 tech-lead
 * notes: player 1 is WASD, player 2 is the arrow keys).
 * @type {Record<1 | 2, Record<DirectionName, string>>}
 */
const PLAYER_KEY_CODES = {
  1: { UP: 'KeyW', DOWN: 'KeyS', LEFT: 'KeyA', RIGHT: 'KeyD' },
  2: { UP: 'ArrowUp', DOWN: 'ArrowDown', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight' },
};

/**
 * Resolves `pressKey`'s `dir` argument to one of the four direction names. Accepts either a `DIRECTIONS`
 * value (`{dx, dy}`, from `core/grid.js`) or its name as a string (`'UP'|'DOWN'|'LEFT'|'RIGHT'`) — a
 * Playwright spec drives `pressKey` through `page.evaluate`, where a frozen `DIRECTIONS` object does not
 * survive serialisation, so the string form has to work (KS-03-06 tech-lead notes).
 *
 * @param {Direction | DirectionName} dir
 * @returns {DirectionName}
 */
function resolveDirectionName(dir) {
  if (typeof dir === 'string') {
    if (DIRECTION_NAMES.includes(/** @type {DirectionName} */ (dir))) {
      return /** @type {DirectionName} */ (dir);
    }
  } else if (dir && typeof dir === 'object') {
    for (const name of DIRECTION_NAMES) {
      const candidate = DIRECTIONS[name];
      if (candidate.dx === dir.dx && candidate.dy === dir.dy) return name;
    }
  }
  throw new RangeError(
    `__kobi.pressKey: dir must be a DIRECTIONS value or one of ${DIRECTION_NAMES.join('|')}, got ${JSON.stringify(dir)}`,
  );
}

/**
 * Builds the object `main.js` assigns to `window.__kobi` once it has decided the gate
 * (`import.meta.env.DEV || location.search.includes('test=1')`) is open. Kept as a pure function of its
 * options — nothing here reaches for a global — so its logic is provable in Node.
 *
 * @param {CreateTestHooksOptions} options
 * @returns {KobiTestHooks}
 */
export function createTestHooks({ session, renderer, eventTarget, KeyboardEventCtor }) {
  const target =
    eventTarget ?? /** @type {EventTarget | undefined} */ (/** @type {any} */ (globalThis).window);
  const EventCtor =
    KeyboardEventCtor ??
    /** @type {(new (type: string, init?: object) => Event) | undefined} */ (
      /** @type {any} */ (globalThis).KeyboardEvent
    );

  /**
   * @param {1 | 2} player
   * @param {Direction | DirectionName} dir
   */
  function pressKey(player, dir) {
    const codesForPlayer = PLAYER_KEY_CODES[player];
    if (codesForPlayer === undefined) {
      throw new RangeError(`__kobi.pressKey: player must be 1 or 2, got ${player}`);
    }
    if (target === undefined || EventCtor === undefined) {
      throw new Error(
        '__kobi.pressKey: no event target / KeyboardEvent available; pass eventTarget/KeyboardEventCtor explicitly',
      );
    }
    const code = codesForPlayer[resolveDirectionName(dir)];
    target.dispatchEvent(new EventCtor('keydown', { code, bubbles: true, cancelable: true }));
  }

  /**
   * Advances the round `seconds` simulated seconds through the session's own update path (the same
   * `ROUND_OVER` handling and HUD write a real frame gets), then draws exactly one frame — the ticket's own
   * wording: "advances the sim without rendering frames in between (one render at the end)".
   *
   * @param {number} seconds
   */
  function fastForward(seconds) {
    session.advanceSimulation(seconds);
    session.renderFrame();
  }

  return {
    get sim() {
      return session.getSim();
    },
    // Sprint 05 (`gameStateMachine.js`, `ARCHITECTURE §6`) replaces this with the real state machine.
    stateMachine: null,
    setSeed(seed) {
      session.setSeed(seed);
    },
    fastForward,
    getSnapshot() {
      return session.getSim()?.getState() ?? null;
    },
    pressKey,
    /**
     * `renderer.getHeadWorldPosition` returns a live `THREE.Vector3`, which `page.evaluate`'s structured
     * clone cannot carry back intact — so this hands back a plain `{x, y, z}` instead (KS-03-06 tech-lead
     * notes).
     * @param {number} player
     */
    getHeadWorldPosition(player) {
      const { x, y, z } = renderer.getHeadWorldPosition(player);
      return { x, y, z };
    },
  };
}
