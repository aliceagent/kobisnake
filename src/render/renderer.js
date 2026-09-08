// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { createArenaView } from './arenaView.js';
import { createGameplayCamera } from './camera.js';
import { createLaserView } from './laserView.js';
import { COLORS } from './materials.js';
import { createPickupView } from './pickupView.js';
import { createSnakeView } from './snakeView.js';

/**
 * The WebGL renderer and the gameplay scene it draws (`ARCHITECTURE §7`).
 *
 * `createGameplayRenderer` is the whole of the render layer's public surface: hand it a `<canvas>`, then call
 * `render(snapshot, dt)` once a frame with whatever `RoundSimulation.getState()` last returned. It owns the
 * scene, the camera and the three views, and it is the only file here that needs a GPU — the views build
 * meshes and matrices and nothing else, which is what lets them be unit-tested in Node.
 *
 * Pixel ratio is capped because a 3× retina display costs nine times the pixels of a 1× one for a picture
 * made of big flat bricks that gains almost nothing from it (`ARCHITECTURE §7`, §12).
 *
 * **Sizing (KI-16-02).** The drawing buffer is measured from the **canvas's own CSS box**, never from
 * `window.innerWidth`/`innerHeight`, and it is sized in whole device pixels. See {@link measureCanvas} and
 * {@link resizeRendererToCanvas} for why both halves of that matter.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */

const MAX_PIXEL_RATIO = 2;

/**
 * The canvas's CSS box and the whole-device-pixel drawing buffer that exactly covers it.
 *
 * **Measured from the canvas, not from the window** (KI-16-02). `window.innerWidth`/`innerHeight` are the
 * *window's* content box; what has to be filled without stretching is the *canvas element's* box. The two
 * agree today only because `styles.css` gives `#game` `width: 100%; height: 100%` inside a `body` with
 * `overflow: hidden` — a scrollbar, a border, or any future chrome around the canvas breaks that equality
 * silently, and the symptom is a picture stretched by a few pixels that no test would catch.
 *
 * **Whole device pixels, rounded rather than truncated.** three's own `setSize` computes the buffer as
 * `floor(cssSize × pixelRatio)`, which is exact while the ratio is an integer — the 1280×720 CSS box at DPR 2
 * that `docs/qa/playtests/viewports.md` measures really does get a 2560×1440 buffer — but is short by up to a
 * device pixel once the ratio is fractional, which is precisely what browser zoom produces (125 % and 150 %
 * are DPR 1.25 and 1.5). A buffer one device pixel narrower than its box is then scaled up to fit it, and the
 * result is a softly blurred picture with nothing to point at. Sizing the buffer here and leaving three's own
 * ratio at 1 keeps `setSize` from re-deriving — and re-truncating — a number this function has already
 * computed exactly.
 *
 * A canvas that is not laid out yet, or one in a minimised window, measures `0 × 0`; that is reported
 * faithfully rather than clamped, and {@link resizeRendererToCanvas} is what decides not to act on it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {number} [devicePixelRatio] - defaults to `window.devicePixelRatio`; injectable for tests
 * @returns {{cssWidth: number, cssHeight: number, bufferWidth: number, bufferHeight: number, pixelRatio: number}}
 */
export function measureCanvas(canvas, devicePixelRatio = window.devicePixelRatio) {
  // `clientWidth`/`clientHeight` are the CSS box in CSS pixels, already excluding any border, and they are
  // integers — `getBoundingClientRect()` would give sub-pixel widths that cannot be honoured by a buffer
  // measured in whole pixels anyway.
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const pixelRatio = Math.min(
    Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1,
    MAX_PIXEL_RATIO,
  );
  return {
    cssWidth,
    cssHeight,
    bufferWidth: Math.round(cssWidth * pixelRatio),
    bufferHeight: Math.round(cssHeight * pixelRatio),
    pixelRatio,
  };
}

/** Shadow map size for the single shadow-casting key light (`ARCHITECTURE §7`). */
const SHADOW_MAP_SIZE = 2048;

export { SHADOW_MAP_SIZE };

/** The catalogue colour each player gets by default (`DESIGN-DECISIONS §2.7`: red and blue are owned from the start). */
const DEFAULT_PLAYER_COLORS = ['red', 'blue'];

/**
 * Create the one WebGL renderer the game uses, sized to the window.
 *
 * @param {HTMLCanvasElement} canvas the `<canvas id="game">` element from index.html
 * @returns {THREE.WebGLRenderer}
 */
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  resizeRendererToCanvas(renderer, canvas);
  renderer.shadowMap.enabled = true;
  // ARCHITECTURE §7 asks for PCFSoft; three deprecated PCFSoftShadowMap and now silently falls back to
  // PCFShadowMap, printing a console warning. QA-STRATEGY §8 wants a console with zero warnings, so ask for
  // the filter three actually uses. Tracked for a doc update in the issue linked from the KS-01-01 PR.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

/**
 * Match the drawing buffer to the canvas's current CSS box, in whole device pixels. Safe to call on every
 * resize event, and cheap to call when nothing has changed: three's `setSize` is a no-op-ish assignment, but
 * the zero-size guard below means a hidden or unlaid-out canvas cannot destroy the buffer either.
 *
 * Returns the aspect ratio the canvas now has, so the caller can re-frame the camera — or `null` when the
 * canvas has no area to measure and nothing should be re-framed at all. A minimised window reports `0 × 0`,
 * and resizing the drawing buffer to zero there would mean the *restore* is what has to repair it, with a
 * blank frame in between; leaving the buffer exactly as it was costs nothing and has nothing to repair.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {HTMLCanvasElement} canvas
 * @param {number} [devicePixelRatio] - defaults to `window.devicePixelRatio`; injectable for tests
 * @returns {number | null} the canvas's new aspect ratio, or `null` when it has no area
 */
export function resizeRendererToCanvas(renderer, canvas, devicePixelRatio) {
  const { cssWidth, cssHeight, bufferWidth, bufferHeight } = measureCanvas(
    canvas,
    devicePixelRatio,
  );
  if (bufferWidth <= 0 || bufferHeight <= 0) return null;

  // The buffer size is already in whole device pixels (see `measureCanvas`), so three is told the ratio is 1
  // and handed that size directly rather than being asked to multiply and truncate it a second time.
  renderer.setPixelRatio(1);
  // `false` keeps three from writing an inline width/height style onto the canvas; `styles.css` owns the
  // element's size and the renderer only owns the drawing buffer.
  renderer.setSize(bufferWidth, bufferHeight, false);
  return cssWidth / cssHeight;
}

/**
 * Anything that fires the two WebGL context events — a `<canvas>` in the browser, a plain `EventTarget` in a
 * unit test. Typed structurally, and deliberately narrower than `HTMLCanvasElement`, for the same reason
 * `session.js` types its collaborators structurally: {@link createContextLossWatcher} needs exactly two
 * methods, and a test that has to build a whole canvas to prove a listener is a test nobody writes.
 *
 * @typedef {object} ContextEventTarget
 * @property {(type: string, listener: (event: any) => void) => void} addEventListener
 * @property {(type: string, listener: (event: any) => void) => void} removeEventListener
 */

/**
 * What {@link createContextLossWatcher} hands back.
 *
 * @typedef {object} ContextLossWatcher
 * @property {() => boolean} isLost - true between a `webglcontextlost` and the `webglcontextrestored` that
 *   answers it.
 * @property {(listener: () => void) => () => void} onLost - subscribe; the return value unsubscribes.
 * @property {(listener: () => void) => () => void} onRestored - subscribe; the return value unsubscribes.
 * @property {() => void} dispose - remove both DOM listeners and drop every subscriber.
 */

/**
 * Watch a canvas for the GPU going away and coming back (KI-06-01).
 *
 * A laptop waking from sleep, a driver reset, or a browser reclaiming GPU memory from a background tab all
 * end the same way: the canvas fires `webglcontextlost`, every GPU resource behind it is gone, and nothing
 * is ever drawn again unless the page asks for the context back. Until this ticket nothing in the codebase
 * listened, so the symptom was a dead picture over a match that was still running underneath it — and the
 * only way out was a reload, which loses the match.
 *
 * **`preventDefault()` on the loss event is the whole ticket** (AC3). The default action of
 * `webglcontextlost` is "this context is finished": the browser fires `webglcontextrestored` **only** if a
 * listener cancelled the loss event first. Without that one call there is no restore to listen for, and
 * every line of recovery code below would be unreachable. three.js's own `WebGLRenderer` happens to call it
 * too, in a listener it registers on the same canvas — but the game may not depend on a library internal for
 * the one call without which none of this works, and a `preventDefault` on an already-prevented event is
 * free.
 *
 * Subscription rather than a single callback because two layers need the same two events and neither owns
 * the other: `session.js` pauses and resumes the match on them (this ticket), and `main.js` will hang
 * KI-06-02's "it never came back" grace timer off them.
 *
 * @param {ContextEventTarget} canvas
 * @returns {ContextLossWatcher}
 */
export function createContextLossWatcher(canvas) {
  /** @type {Set<() => void>} */
  const lostListeners = new Set();
  /** @type {Set<() => void>} */
  const restoredListeners = new Set();
  let lost = false;

  /**
   * Notify a set of subscribers, over a copy of it. A listener that unsubscribes itself (or a neighbour)
   * while it runs must not change what this loop iterates — the game pauses from inside one of these calls.
   *
   * @param {Set<() => void>} listeners
   */
  function notify(listeners) {
    for (const listener of [...listeners]) listener();
  }

  /** @param {{preventDefault?: () => void}} event */
  function handleLost(event) {
    // See this function's own doc comment: without this the browser never fires `webglcontextrestored`, and
    // a lost context is lost for the life of the page.
    event.preventDefault?.();
    // A second loss without an intervening restore is not a thing a browser does, but a fabricated event in
    // a test is, and pausing an already-paused match twice would be a second READY? beat owed on the way
    // back. The flag is the state; the events only change it.
    if (lost) return;
    lost = true;
    notify(lostListeners);
  }

  function handleRestored() {
    if (!lost) return;
    lost = false;
    notify(restoredListeners);
  }

  canvas.addEventListener('webglcontextlost', handleLost);
  canvas.addEventListener('webglcontextrestored', handleRestored);

  return {
    isLost: () => lost,
    onLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    onRestored(listener) {
      restoredListeners.add(listener);
      return () => restoredListeners.delete(listener);
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
      lostListeners.clear();
      restoredListeners.clear();
    },
  };
}

/**
 * Build the scene, the camera and the views, with no WebGL involved. Split out from
 * {@link createGameplayRenderer} so the whole composition can be built and asserted on in a unit test.
 *
 * @param {object} [options]
 * @param {Settings} [options.settings]
 * @param {number} [options.aspect]
 * @param {boolean} [options.reducedFx]
 * @param {string[]} [options.playerColors] - catalogue colour names, in player order
 * @returns {{
 *   scene: THREE.Scene,
 *   camera: import('./camera.js').GameplayCamera,
 *   arena: ReturnType<typeof createArenaView>,
 *   snakes: import('./snakeView.js').SnakeView[],
 *   pickups: import('./pickupView.js').PickupView,
 *   lasers: import('./laserView.js').LaserView,
 *   update: (snapshot: object, dt?: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createGameplayScene({
  settings = SETTINGS,
  aspect = 16 / 9,
  reducedFx,
  playerColors = DEFAULT_PLAYER_COLORS,
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.skyFill);

  const camera = createGameplayCamera({ settings, aspect, reducedFx });
  const arena = createArenaView({ settings, shadowMapSize: SHADOW_MAP_SIZE });
  scene.add(arena.group);

  const snakes = playerColors.map((colorName) => {
    const view = createSnakeView({ colorName, settings });
    scene.add(view.group);
    return view;
  });

  const pickups = createPickupView({ settings });
  scene.add(pickups.group);

  // KS-04-02: laser beams, emitters and warning arrows. Deviation from KS-04-02's own `Files:` list
  // (`src/render/laserView.js`, `src/render/arenaView.js`) — wiring the new view into the scene composition
  // touches `renderer.js` too, declared in the PR description.
  const lasers = createLaserView({ settings, reducedFx });
  scene.add(lasers.group);

  return {
    scene,
    camera,
    arena,
    snakes,
    pickups,
    lasers,
    /**
     * Push a simulation snapshot into every view.
     *
     * @param {object} snapshot - `RoundSimulation.getState()`
     * @param {number} [dt] - seconds since the previous frame, for the camera's shake and zoom decay
     */
    update(snapshot, dt = 0) {
      const state = /** @type {{snakes?: any[], apples?: any[], powerUps?: any, lasers?: any}} */ (
        snapshot
      );
      const snakeStates = state.snakes ?? [];
      snakes.forEach((view, index) => {
        const snakeState = snakeStates[index];
        // A view with no snake behind it draws nothing rather than the last snake it saw.
        if (snakeState === undefined) {
          view.segments.count = 0;
          view.eyes.count = 0;
          view.pupils.count = 0;
          return;
        }
        // KS-06-02 declared deviation: `view.update` used to take only the snapshot; now also passed this
        // frame's `dt`, which the snake's own effect tint needs for its SPEED pulse (`snakeView.js`'s own
        // doc comment) — the same widening the pickups call two lines below already had authorisation for.
        view.update(snakeState, dt);
      });
      // KS-06-02 declared deviation: this line used to hand pickups only `{ apples }`, so the power-up
      // pedestals could never see the snapshot at all. Widened to also pass `powerUps` and this frame's `dt`
      // (the pedestal's idle bob and spin are time-driven — `DESIGN-DECISIONS §3` "Power-up sheet") — still
      // the one call site the tech lead pre-authorised, nothing else in this file changed.
      pickups.update(
        /** @type {{apples: any[], powerUps: any}} */ ({
          apples: state.apples ?? [],
          powerUps: state.powerUps ?? { pickups: [] },
        }),
        dt,
      );
      lasers.update(state, dt);
      // The floor darkens in step with the beams' own glide, not with the sim's integer inset directly —
      // `lasers.visualInset` is the eased value both are reading, which is what keeps the two in sync.
      arena.setDeadZoneInset(lasers.visualInset);
      camera.update(dt);
    },
    dispose() {
      snakes.forEach((view) => view.dispose());
      pickups.dispose();
      lasers.dispose();
      arena.dispose();
      scene.clear();
    },
  };
}

/**
 * @typedef {object} GameplayRenderer
 * @property {THREE.WebGLRenderer} renderer
 * @property {THREE.Scene} scene
 * @property {import('./camera.js').GameplayCamera} camera
 * @property {import('./snakeView.js').SnakeView[]} snakes
 * @property {(snapshot: object, dt?: number) => void} render
 * @property {() => boolean} resize
 * @property {(player: number) => THREE.Vector3} getHeadWorldPosition
 * @property {() => number} getDrawCalls
 * @property {(listener: () => void) => () => void} onContextLost - KI-06-01: subscribe to the canvas losing
 *   its WebGL context; the return value unsubscribes. See {@link createContextLossWatcher}.
 * @property {(listener: () => void) => () => void} onContextRestored - KI-06-01: subscribe to the context
 *   coming back, *after* this renderer has repaired itself; the return value unsubscribes.
 * @property {() => boolean} isContextLost - KI-06-01: true while there is no GPU to draw into.
 * @property {(x: number, y: number, z: number) => {x: number, y: number, z: number}} projectToNdc - KI-16-01:
 *   the smallest real seam onto `THREE.Vector3.prototype.project`, so a measurement layer can ask "where does
 *   this world point land on screen" without re-deriving the camera's own maths. Plain object, not a
 *   `THREE.Vector3` — the same reason {@link GameplayRenderer.getHeadWorldPosition} clones into `{x, y, z}`:
 *   it has to survive `page.evaluate`'s structured clone.
 * @property {() => void} dispose
 */

/**
 * The render layer, ready to draw.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} [options]
 * @param {Settings} [options.settings]
 * @param {boolean} [options.reducedFx]
 * @param {string[]} [options.playerColors]
 * @returns {GameplayRenderer}
 */
export function createGameplayRenderer(canvas, options = {}) {
  const renderer = createRenderer(canvas);
  // The canvas's own box, for the same reason `measureCanvas` uses it. `?? undefined` lets the camera's own
  // 16:9 default stand when the canvas has no area yet, rather than framing for an aspect of zero.
  const measured = measureCanvas(canvas);
  const aspect = measured.cssHeight > 0 ? measured.cssWidth / measured.cssHeight : undefined;
  const composition = createGameplayScene({ ...options, aspect });
  const { scene, camera, snakes } = composition;

  /**
   * Match the drawing buffer and the camera to the canvas's current box. Shared by the public `resize()` and
   * by the context-restore repair below, because "make the renderer agree with the canvas again" is the same
   * job whether the canvas changed size or the GPU went away and came back.
   *
   * @returns {boolean} whether the canvas had an area to re-frame for
   */
  function applyResize() {
    const nextAspect = resizeRendererToCanvas(renderer, canvas);
    if (nextAspect === null) return false;
    camera.setAspect(nextAspect);
    return true;
  }

  const contextLoss = createContextLossWatcher(canvas);

  // KI-06-01. Registered here, before `createGameplayRenderer` returns, so it runs **before** any subscriber
  // the game adds afterwards (a `Set` notifies in insertion order): by the time `session.js` resumes the
  // match, this renderer is already fit to draw the frame that resume will ask for.
  //
  // three.js does the bulk of the rebuilding itself — its own `webglcontextrestored` listener re-initialises
  // the GL state and every texture, geometry and program is re-uploaded lazily on the next draw. What it
  // does not do is re-apply the drawing-buffer size, which lives on the renderer rather than in the context
  // three just replaced, so the restored context starts at its own default viewport. One `applyResize()` is
  // the whole repair, and it is the same call a window resize already makes.
  contextLoss.onRestored(() => {
    applyResize();
  });

  return {
    renderer,
    scene,
    camera,
    snakes,
    /**
     * @param {object} snapshot
     * @param {number} [dt]
     */
    render(snapshot, dt = 0) {
      // KI-06-01: there is nothing to draw into while the context is gone, and nothing to show it on. three's
      // own `render()` already returns early in that state, so this is not about avoiding a GL error — it is
      // about not advancing the camera's shake and zoom envelopes (`composition.update`'s `dt`) through
      // frames the player never sees. The match is paused by then anyway; this keeps the *picture* paused too,
      // so what comes back after the restore is the frame that went away.
      if (contextLoss.isLost()) return;
      composition.update(snapshot, dt);
      renderer.render(scene, camera);
    },
    /**
     * Match the drawing buffer and the camera to the canvas's current box (KI-16-02).
     *
     * Deliberately does **not** draw. Whether a resize should produce a frame, and which frame, is the
     * session's business — it is the only thing that knows what the game currently looks like — so
     * `session.js`'s own `resize()` calls this and then draws exactly one frame with no simulated time
     * attached (KI-16-02 AC3). A renderer that drew here would draw the *previous* snapshot, and would do it
     * on the menu screens too.
     *
     * @returns {boolean} whether the canvas had an area to re-frame for; `false` means nothing changed
     */
    resize() {
      return applyResize();
    },
    /**
     * Where a player's head was last drawn, in world units. This is what `__kobi.getHeadWorldPosition`
     * reports and what KS-03-04 AC1 measures interpolation against.
     *
     * @param {number} player - 1 or 2
     * @returns {THREE.Vector3}
     */
    getHeadWorldPosition(player) {
      const view = snakes[player - 1];
      if (view === undefined) {
        throw new RangeError(`renderer: no snake view for player ${player}`);
      }
      return view.headPosition.clone();
    },
    /** Draw calls the last frame cost, from three's own counter (`ARCHITECTURE §12` budget: ≤ 120). */
    getDrawCalls() {
      return renderer.info.render.calls;
    },
    /**
     * Projects a world point through the gameplay camera into normalized device coordinates — `x`/`y` each in
     * `[-1, 1]` when the point falls inside the view frustum, `y` up. KI-16-01's seam for measuring what is
     * actually on screen at a given viewport, without reconstructing the camera's own projection maths in a
     * test: `x, y, z` in, `THREE.Vector3.prototype.project` does the work, and the result comes back as a
     * plain object rather than a `THREE.Vector3` for the same reason {@link getHeadWorldPosition} does.
     *
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{x: number, y: number, z: number}}
     */
    projectToNdc(x, y, z) {
      // KI-16-02: bring the camera's world matrix up to date first. `project()` reads
      // `camera.matrixWorldInverse`, which only `updateMatrixWorld()` refreshes — and neither
      // `GameplayCamera.frame()` (which moves the camera on every resize) nor `update()` (which moves it for
      // shake and the laser-warning zoom pulse) calls it. Ordinarily `renderer.render()` does, so a caller
      // that projects straight after a rendered frame is fine; a caller that projects *between* a resize and
      // the next frame would silently get the pre-resize pose, which is exactly the window this ticket's AC3
      // measures across. `session.js`'s `powerUpTagsFor` already guards its own projection the same way and
      // for the same reason.
      camera.updateMatrixWorld();
      const projected = new THREE.Vector3(x, y, z).project(camera);
      return { x: projected.x, y: projected.y, z: projected.z };
    },
    /**
     * KI-06-01: the two events the game recovers from, as subscriptions rather than as one callback each,
     * because two layers need them and neither owns the other — `session.js` pauses and resumes the match on
     * them, and `main.js` hangs the "it never came back" grace timer off the same pair.
     *
     * @param {() => void} listener
     * @returns {() => void} unsubscribe
     */
    onContextLost(listener) {
      return contextLoss.onLost(listener);
    },
    /**
     * @param {() => void} listener
     * @returns {() => void} unsubscribe
     */
    onContextRestored(listener) {
      return contextLoss.onRestored(listener);
    },
    isContextLost() {
      return contextLoss.isLost();
    },
    dispose() {
      contextLoss.dispose();
      composition.dispose();
      renderer.dispose();
    },
  };
}
