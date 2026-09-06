// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { createArenaView } from './arenaView.js';
import { createGameplayCamera } from './camera.js';
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
 */

/** @typedef {import('../core/settings.js').Settings} Settings */

const MAX_PIXEL_RATIO = 2;

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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  // `false` keeps three from writing an inline width/height style onto the canvas; the CSS in index.html
  // owns the element's size and the renderer only owns the drawing buffer.
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  // ARCHITECTURE §7 asks for PCFSoft; three deprecated PCFSoftShadowMap and now silently falls back to
  // PCFShadowMap, printing a console warning. QA-STRATEGY §8 wants a console with zero warnings, so ask for
  // the filter three actually uses. Tracked for a doc update in the issue linked from the KS-01-01 PR.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

/**
 * Match the drawing buffer and the camera to the current window size. Safe to call on every resize event.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.PerspectiveCamera} camera
 * @returns {number} the new aspect ratio, so the caller can re-frame the camera
 */
export function resizeRendererToWindow(renderer, camera) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const aspect = width / Math.max(height, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(width, height, false);
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  return aspect;
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

  return {
    scene,
    camera,
    arena,
    snakes,
    pickups,
    /**
     * Push a simulation snapshot into every view.
     *
     * @param {object} snapshot - `RoundSimulation.getState()`
     * @param {number} [dt] - seconds since the previous frame, for the camera's shake and zoom decay
     */
    update(snapshot, dt = 0) {
      const state = /** @type {{snakes?: any[], apples?: any[]}} */ (snapshot);
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
        view.update(snakeState);
      });
      pickups.update(/** @type {{apples: any[]}} */ ({ apples: state.apples ?? [] }));
      camera.update(dt);
    },
    dispose() {
      snakes.forEach((view) => view.dispose());
      pickups.dispose();
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
 * @property {() => void} resize
 * @property {(player: number) => THREE.Vector3} getHeadWorldPosition
 * @property {() => number} getDrawCalls
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
  const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
  const composition = createGameplayScene({ ...options, aspect });
  const { scene, camera, snakes } = composition;

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
      composition.update(snapshot, dt);
      renderer.render(scene, camera);
    },
    resize() {
      const nextAspect = resizeRendererToWindow(renderer, camera);
      camera.setAspect(nextAspect);
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
    dispose() {
      composition.dispose();
      renderer.dispose();
    },
  };
}
