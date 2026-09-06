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
 * @property {import('./gameStateMachine.js').GameStateMachine} machine - the real state machine
 *   (`ARCHITECTURE §11`'s `stateMachine`), not a copy of its current state.
 * @property {() => import('./gameStateMachine.js').GameState} getState
 * @property {(dt: number) => void} advanceSimulation - runs the update path once for that many *wall*
 *   seconds, with no render.
 * @property {() => void} renderFrame - draws exactly one frame of whatever the sim currently looks like.
 * @property {() => number} getTimeScale - the loop's current `timeScale`, so a spec can observe the crash
 *   slow-mo beat from the inside (KS-06-00 AC3).
 * @property {(seed: number | null) => void} setSeed - fixes the seed the *next* match is built from.
 * @property {(overrides?: object) => void} startMatch - main menu to countdown in one call.
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => {matchSeed: number, roundIndex: number, roundSeeds: number[]}} getSeeds
 * @property {() => import('../core/match.js').MatchState | null} getMatch
 * @property {() => object} getMatchSettings
 */

/**
 * The piece of the renderer `__kobi` drives.
 *
 * @typedef {object} TestHooksRenderer
 * @property {(player: number) => {x: number, y: number, z: number}} getHeadWorldPosition
 * @property {() => number} getDrawCalls - KS-04-02: lets an e2e spec measure the laser phase's draw-call
 *   cost (AC3) against three's own counter, the same one `ARCHITECTURE §12`'s budget is measured from.
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
 * @property {import('./gameStateMachine.js').GameStateMachine} stateMachine - the real machine
 *   (`ARCHITECTURE §11`). It was `null` through Sprints 03 and 04, documented as "Sprint 05 replaces this".
 * @property {() => import('./gameStateMachine.js').GameState} getState - the current state's name, which is
 *   what a Playwright spec actually wants: the machine itself does not survive `page.evaluate`'s structured
 *   clone, but a string does.
 * @property {(seed: number | null) => void} setSeed - fixes the seed the *next* match is built from.
 * @property {(overrides?: object) => void} startMatch - drives the main menu and the setup screen in one
 *   call, leaving the game in COUNTDOWN. Every e2e and visual spec starts a round through this, because the
 *   placeholder "press Enter from an idle overlay" flow it replaces no longer exists (KS-05-03).
 * @property {() => void} pause - opens the real PAUSE state, exactly as Esc does.
 * @property {() => void} resume - leaves it, READY? beat included.
 * @property {() => {matchSeed: number, roundIndex: number, roundSeeds: number[]}} getSeeds - the match seed
 *   and the per-round seeds derived from it, for replays (the ticket's own "round seeds are exposed via
 *   `__kobi`").
 * @property {() => object | null} getMatch - the live best-of tally, as a plain object a spec can read.
 * @property {() => object} getMatchSettings
 * @property {(seconds: number) => void} fastForward - advances `seconds` of wall time through the session's
 *   own update path in frame-sized chunks with no render in between, then draws exactly one frame.
 * @property {(seconds: number) => void} advance - the same advance with **no render at all**. For a spec that
 *   steps to a state boundary in a loop and only wants a frame at the end (KS-06-06).
 * @property {() => number} getTimeScale - the loop's `timeScale` right now: 1 in ordinary play, 0.25 inside
 *   the crash slow-mo beat, 0 while paused.
 * @property {() => object | null} getSnapshot - `session.getSim()?.getState() ?? null`.
 * @property {(player: 1 | 2, dir: Direction | DirectionName) => void} pressKey
 * @property {(player: number) => {x: number, y: number, z: number}} getHeadWorldPosition
 * @property {() => number} getDrawCalls - see {@link TestHooksRenderer.getDrawCalls}.
 */

/**
 * The chunk {@link createTestHooks}'s `fastForward` advances in — `loop.js`'s own `maxFrameSeconds`, which is
 * the longest frame a real browser can ever hand the session (`ARCHITECTURE §5`). Mirrored here rather than
 * imported because `loop.js` does not export it, the same way `PLAYER_KEY_CODES` below mirrors `input.js`'s
 * key tables; `tests/unit/game/testHooks.test.js` asserts the two agree.
 */
const FAST_FORWARD_CHUNK_SECONDS = 0.1;

/** Below this many seconds left there is nothing worth advancing; see {@link createTestHooks}'s `fastForward`. */
const FAST_FORWARD_EPSILON = 1e-9;

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
   * Advances `seconds` of **wall** time through the session's own update path — the same state transitions,
   * countdown steps, scoreboard timing and HUD writes a real frame gets — then draws exactly one frame, which
   * is KS-03-06's "advances the sim without rendering frames in between (one render at the end)".
   *
   * Wall seconds rather than simulated ones, because from Sprint 05 the two differ and a spec needs the one
   * that drives everything: `session.advanceSimulation` scales it by the live `loop.timeScale` for the
   * simulation's half. In ordinary play the scale is 1 and this is exactly what it always was; through a
   * pause it advances nothing, and through the crash slow-mo beat it advances the round at a quarter speed —
   * in every case what a real run of the same duration would have done.
   *
   * **Chunked, since KS-06-00** (issue #84, the design lead's ruling: option 2). Until then this ran the
   * update path *once* for the whole duration, which the simulation is fine with — `RoundSimulation.advance`
   * accumulates in tick units, so one big call and many small ones agree exactly — but the session's
   * *wall-time* beats are not: the crash slow-mo, the READY? beat and the individual countdown steps are
   * `remaining -= unscaledDt` counters, and a single call longer than a beat consumed the whole beat without
   * any frame ever observing the game inside it. A real browser cannot do that, because `loop.js` clamps
   * every frame to `maxFrameSeconds`. So this now advances in chunks of exactly that size and still renders
   * once at the end: compressed real time rather than one enormous frame. The cost is ~900 update calls for a
   * 90 s fast-forward, comfortably inside KS-03-06 AC2's 500 ms budget.
   *
   * `seconds` of 0 (or less) advances nothing and still renders, which is what
   * `tests/e2e/helpers.js` uses to draw a still frame of a paused round.
   *
   * @param {number} seconds
   */
  function fastForward(seconds) {
    advance(seconds);
    session.renderFrame();
  }

  /**
   * {@link fastForward}'s advance without its render.
   *
   * A spec that steps to a state boundary — "keep going while the game is still counting down" — calls this
   * in a loop and then draws one frame at the end, instead of paying for a full three.js draw on every step.
   * That matters more than it sounds: `fastForward` renders once *per call*, so a loop of 60 calls is 60
   * renders, and `tests/e2e/helpers.js`'s `nextRoundInPage` went from 2 renders to as many as 120 when
   * KS-06-00 made those loops necessary. It roughly doubled the e2e suite's wall time (1m40s to 3.5 min on
   * CI) and pushed the two heaviest specs past Playwright's 30 s per-test budget. Splitting the render off
   * gives a stepping loop the cost it always should have had, and changes nothing about what it observes:
   * the session's update path is identical either way, and rendering has no effect on simulation state.
   *
   * @param {number} seconds
   */
  function advance(seconds) {
    let remaining = seconds;
    // Guarded against a float residue rather than `> 0`: subtracting 0.1 from a float nine hundred times
    // does not land on exactly zero, and a final chunk of 1e-14 seconds is a frame no browser would ever
    // produce. The epsilon is far below one simulation tick (1/120 s), so no real time is ever dropped.
    while (remaining > FAST_FORWARD_EPSILON) {
      const chunk = Math.min(remaining, FAST_FORWARD_CHUNK_SECONDS);
      session.advanceSimulation(chunk);
      remaining -= chunk;
    }
  }

  return {
    get sim() {
      return session.getSim();
    },
    stateMachine: session.machine,
    getState() {
      return session.getState();
    },
    setSeed(seed) {
      session.setSeed(seed);
    },
    startMatch(overrides) {
      session.startMatch(overrides);
    },
    pause() {
      session.pause();
    },
    resume() {
      session.resume();
    },
    getSeeds() {
      return session.getSeeds();
    },
    /**
     * The match tally as a plain object. `MatchState` carries methods, which `page.evaluate`'s structured
     * clone drops silently, so the two a spec actually asks for are evaluated here into plain values.
     */
    getMatch() {
      const match = session.getMatch();
      if (match === null) return null;
      return {
        bestOf: match.bestOf,
        target: match.target,
        rewardKeys: match.rewardKeys,
        wins: { 1: match.wins[1], 2: match.wins[2] },
        roundsPlayed: match.roundsPlayed,
        winner: match.winner,
        isOver: match.isOver(),
        winsNeeded: { 1: match.winsNeeded(1), 2: match.winsNeeded(2) },
      };
    },
    getMatchSettings() {
      return session.getMatchSettings();
    },
    fastForward,
    advance,
    getTimeScale() {
      return session.getTimeScale();
    },
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
    getDrawCalls() {
      return renderer.getDrawCalls();
    },
  };
}
