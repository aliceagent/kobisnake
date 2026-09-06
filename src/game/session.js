// @ts-check
import { EVENTS, RESULTS } from '../core/events.js';
import { RoundSimulation } from '../core/round.js';
import { SETTINGS } from '../core/settings.js';
import { createInput } from './input.js';
import { createLoop } from './loop.js';

/**
 * Session wiring: loop + input + renderer + sim (KS-03-05).
 *
 * `createSession` is the one place every Sprint 03 piece gets plugged together: the fixed-step loop
 * (`loop.js`), keyboard input (`input.js`), the headless simulation (`core/round.js`) and a renderer/ui the
 * caller builds and hands in. `src/game/` must never import three.js (`ARCHITECTURE §3`), so the renderer
 * arrives here as a plain `{ render(snapshot, dt), resize() }` object — `main.js` is the only file that
 * constructs the real one. The same trick makes this whole file driveable from a unit test: a fake renderer,
 * a fake `ui`, a fake `requestAnimationFrame` and a plain `EventTarget` stand-in for the keyboard are enough;
 * nothing here reaches for a real browser.
 *
 * -----------------------------------------------------------------------------------------------------------
 * PLACEHOLDER ROUND FLOW. Everything between this banner and the matching one below is the whole of what the
 * ticket calls "a placeholder for Sprint 05's state machine" (`ARCHITECTURE §6`, `gameStateMachine.js`): one
 * `phase` variable, one function that starts a round, and one event check for `ROUND_OVER`. When Sprint 05
 * lands, deleting this block and handing `phase`/`startRound` to `gameStateMachine.js` should be the entire
 * migration — nothing outside the banners may depend on what happens inside them.
 * -----------------------------------------------------------------------------------------------------------
 */

/** @typedef {import('./input.js').Direction} Direction */
/** @typedef {import('./loop.js').RequestFrame} RequestFrame */
/** @typedef {import('./loop.js').VisibilitySource} VisibilitySource */
/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/round.js').SimEvent} SimEvent */

/**
 * @typedef {object} SessionRenderer
 * @property {(snapshot: object, dt?: number) => void} render
 * @property {() => void} resize
 */

/**
 * @typedef {object} SessionHud
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 */

/**
 * @typedef {object} SessionUi
 * @property {SessionHud} hud
 * @property {(text: string) => void} showOverlay
 * @property {() => void} hideOverlay
 */

/** @typedef {{id: string, color?: string}} SessionPlayer */

/**
 * The pieces of `RoundSimulation.getState()` this file reads. `round.js` itself only promises `object`
 * (`ARCHITECTURE §4`: the snapshot is "plain, JSON-serialisable"), so every reader casts to the shape it
 * actually needs rather than trusting an untyped value — the same pattern `render/renderer.js` uses.
 *
 * @typedef {object} RoundSnapshot
 * @property {number | null} timeRemaining
 * @property {{length: number}[]} snakes
 */

/**
 * @typedef {object} CreateSessionOptions
 * @property {SessionRenderer} renderer - anything shaped `{ render(snapshot, dt), resize() }`; `main.js`
 *   passes the real `createGameplayRenderer` result.
 * @property {SessionUi} ui - the overlay + HUD, e.g. `createUi(document.getElementById('ui'))`.
 * @property {number | null} seed - a fixed `?seed`, reused for every round this session plays so a visual
 *   baseline stays reproducible across a round replay; `null` when the caller found no `?seed` in the URL, in
 *   which case every round draws its own fresh seed from `randomSeed()` — "new round" means a new board too,
 *   not just new objects (the ticket's own wording: "Enter → new RoundSimulation(seed from `?seed` or
 *   `Date.now()`)" is read per round, not once for the whole session).
 * @property {Settings} [settings] - defaults to the shipping `SETTINGS`.
 * @property {SessionPlayer[]} [players] - defaults to the two-player match `[{id:'p1'}, {id:'p2'}]`.
 * @property {EventTarget} [inputTarget] - where `createInput` listens; defaults to `window`.
 * @property {RequestFrame} [requestFrame] - forwarded to the loop; a fake lets tests drive frames by hand.
 * @property {(handle: number) => void} [cancelFrame] - forwarded to the loop.
 * @property {() => number} [now] - forwarded to the loop.
 * @property {VisibilitySource | null} [visibilitySource] - forwarded to the loop.
 * @property {() => number} [randomSeed] - draws a fresh seed for a round when `seed` is `null`; defaults to
 *   `Date.now`. Tests inject a fake (an incrementing counter) rather than depending on `Date.now()`'s
 *   millisecond resolution to prove two rounds actually differ.
 */

/** HUD timer text is throttled to 10 Hz (`ARCHITECTURE §8`). */
const HUD_INTERVAL_SECONDS = 1 / 10;

/**
 * `RoundSimulation` player ids, in player-number order. `input.js` hands `onDirection` the plain numbers `1`
 * and `2`; `RoundSimulation.applyInput` wants the string ids the round was constructed with. Mapping one to
 * the other is this ticket's job (the tech-lead notes on `input.js` say so explicitly) — done once, here.
 *
 * @type {string[]}
 */
const PLAYER_IDS = ['p1', 'p2'];

/** The two-player match this session plays by default. */
const DEFAULT_PLAYERS = [{ id: 'p1' }, { id: 'p2' }];

/** What the renderer draws before any round exists: an empty arena, no snakes, no apples. */
const EMPTY_SNAPSHOT = { snakes: [], apples: [] };

/**
 * Overlay text for each possible `ROUND_OVER` result, exactly as the ticket spells it out.
 * @type {Record<string, string>}
 */
const RESULT_OVERLAY_TEXT = {
  [RESULTS.P1_WIN]: 'P1 WINS — PRESS ENTER',
  [RESULTS.P2_WIN]: 'P2 WINS — PRESS ENTER',
  [RESULTS.DRAW]: 'DRAW — PRESS ENTER',
};

/** What the overlay shows before the first round and as a fallback for an unrecognised result. */
const IDLE_OVERLAY_TEXT = 'PRESS ENTER';

/**
 * Format simulated seconds remaining as `m:ss` (`ARCHITECTURE §8`): 90 → `"1:30"`, 0 → `"0:00"`. Floors
 * rather than rounds, so the timer never reads a round number a moment before the clock actually reaches it.
 *
 * @param {number} secondsRemaining
 * @returns {string}
 */
export function formatTime(secondsRemaining) {
  const wholeSeconds = Math.floor(Math.max(0, secondsRemaining));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Wire a session together and hand back its lifecycle controls.
 *
 * @param {CreateSessionOptions} options
 */
export function createSession({
  renderer,
  ui,
  seed,
  settings = SETTINGS,
  players = DEFAULT_PLAYERS,
  inputTarget,
  requestFrame,
  cancelFrame,
  now,
  visibilitySource,
  randomSeed = Date.now,
}) {
  // --- placeholder round flow (see banner above) ------------------------------------------------------
  /** @type {'idle' | 'playing' | 'roundOver'} */
  let phase = 'idle';
  /** @type {RoundSimulation | null} */
  let sim = null;

  /**
   * Starts a fresh round: a clean sim, fresh apples, fresh snakes — and, unless `?seed` fixed one, a fresh
   * board too. A fixed `seed` is reused every round (that is what makes a `?seed` visual baseline
   * reproducible across a replay); without one, `randomSeed()` is drawn again each time, so five rounds in a
   * row do not hand a human playtester the same four apples five times running.
   */
  function startRound() {
    const roundSeed = seed ?? randomSeed();
    sim = new RoundSimulation({ settings, seed: roundSeed, players, mode: 'match' });
    phase = 'playing';
    ui.hideOverlay();
    hudAccumulator = 0;
    writeHud();
  }

  /** Enter's effect: start a round from idle or from round-over; ignored mid-round. */
  function handleConfirm() {
    if (phase === 'playing') return;
    startRound();
  }

  /** @param {SimEvent[]} events */
  function handleRoundEvents(events) {
    for (const event of events) {
      if (event.type === EVENTS.ROUND_OVER) {
        phase = 'roundOver';
        const result = /** @type {string} */ (event.result);
        ui.showOverlay(RESULT_OVERLAY_TEXT[result] ?? IDLE_OVERLAY_TEXT);
      }
    }
  }
  // --- end placeholder round flow ------------------------------------------------------------------------

  /** Seconds accumulated since the HUD text was last written; flushed at `HUD_INTERVAL_SECONDS`. */
  let hudAccumulator = 0;

  /** Writes the timer and both lengths to the HUD right now, bypassing the 10 Hz throttle. */
  function writeHud() {
    if (sim === null) return;
    const state = /** @type {RoundSnapshot} */ (sim.getState());
    ui.hud.setTime(formatTime(state.timeRemaining ?? 0));
    const [p1, p2] = state.snakes;
    ui.hud.setLengths(p1?.length ?? 0, p2?.length ?? 0);
  }

  /**
   * @param {number} playerNumber - the `1` or `2` `input.js` reports
   * @param {Direction} dir
   */
  function handleDirection(playerNumber, dir) {
    if (sim === null) return;
    const playerId = PLAYER_IDS[playerNumber - 1];
    if (playerId === undefined) return;
    sim.applyInput(playerId, dir);
  }

  const input = createInput({
    onDirection: handleDirection,
    // Enter has to work whether a round is running or the overlay is up (the ticket's own note on
    // `input.js`), so the mode stays 'both' for the session's whole life rather than switching between
    // 'game' and 'menu' — this session never has a menu screen for 'menu' mode to make sense of.
    onMenu(action) {
      if (action === 'CONFIRM') handleConfirm();
    },
    mode: 'both',
    target: inputTarget,
  });

  // The renderer wants the frame's real dt (for the camera's shake/zoom decay), not the fixed-step alpha
  // `loop.js` hands its own `render` callback — so `update` remembers the dt it was just given, and `render`
  // reads it back. Both fire once per frame, `update` immediately before `render` (`loop.js`'s own contract),
  // so the value is always the one from the frame that just happened.
  let lastDt = 0;

  const loop = createLoop({
    update(dt) {
      lastDt = dt;
      if (sim !== null) {
        handleRoundEvents(sim.advance(dt));
      }
      hudAccumulator += dt;
      if (hudAccumulator >= HUD_INTERVAL_SECONDS) {
        hudAccumulator = 0;
        writeHud();
      }
    },
    render() {
      renderer.render(sim === null ? EMPTY_SNAPSHOT : sim.getState(), lastDt);
    },
    requestFrame,
    cancelFrame,
    now,
    visibilitySource,
  });

  ui.showOverlay(IDLE_OVERLAY_TEXT);

  return {
    /** The underlying `loop.js` handle — `.start()`/`.stop()`/`.step(dt)` for real use and for tests. */
    loop,
    /** Starts the frame loop. `main.js` calls this once at boot. */
    start() {
      loop.start();
    },
    /** Stops the frame loop without tearing anything else down. */
    stop() {
      loop.stop();
    },
    /** Tears the whole session down: stops the loop and removes the keyboard listener. */
    dispose() {
      loop.dispose();
      input.destroy();
    },
    /** @returns {'idle' | 'playing' | 'roundOver'} */
    getPhase() {
      return phase;
    },
    /** The live `RoundSimulation`, or `null` before the first round starts. Tests read it directly. */
    getSim() {
      return sim;
    },
  };
}
