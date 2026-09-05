// @ts-check
import * as THREE from 'three';
import { createRenderer, resizeRendererToWindow, SHADOW_MAP_SIZE } from './render/renderer.js';
import { COLORS, createPlasticMaterial } from './render/materials.js';
import { SETTINGS } from './core/settings.js';

/**
 * Sprint 01 scaffold scene. It exists to prove one thing: three.js is bundled from npm, WebGL renders, and
 * the gameplay camera sits at the angle the design locked. There is no game here yet — Sprint 02 writes the
 * simulation and Sprint 03 replaces this scene with the real arena.
 *
 * The arena size and camera numbers live in `SETTINGS` (`src/core/settings.js`, `grid` and `camera`) —
 * DESIGN-DECISIONS §2.1 and §1 row 24 respectively — which is the only place they may be edited.
 */

/** Size of the proof-of-life cube, in cells. */
const CUBE_SIZE = 2;

/** Turns per second of the proof-of-life cube. */
const CUBE_SPIN_SPEED = 0.4;

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const renderer = createRenderer(canvas);

const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.skyFill);

const camera = new THREE.PerspectiveCamera(
  SETTINGS.camera.fov,
  window.innerWidth / Math.max(window.innerHeight, 1),
  0.1,
  500,
);
frameArena(camera);

// Floor: one flat 24×24 plane for now. Sprint 09 replaces it with real studded tiles.
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(SETTINGS.grid.width, SETTINGS.grid.height),
  createPlasticMaterial(COLORS.floorGreen),
);
floor.rotation.x = -Math.PI / 2;
floor.position.set(SETTINGS.grid.width / 2, 0, SETTINGS.grid.height / 2);
floor.receiveShadow = true;
scene.add(floor);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE),
  createPlasticMaterial(COLORS.red),
);
cube.position.set(SETTINGS.grid.width / 2, CUBE_SIZE / 2, SETTINGS.grid.height / 2);
cube.castShadow = true;
scene.add(cube);

// Lighting rig from the materials bible (DESIGN-DECISIONS §3): one warm key light casts every shadow in the
// game, a hemisphere light fills the rest so nothing is ever pitch black.
const keyLight = new THREE.DirectionalLight(COLORS.keyLight, 2.2);
keyLight.position.set(SETTINGS.grid.width * 0.25, 30, SETTINGS.grid.height * 0.9);
keyLight.target.position.set(SETTINGS.grid.width / 2, 0, SETTINGS.grid.height / 2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
keyLight.shadow.camera.left = -SETTINGS.grid.width;
keyLight.shadow.camera.right = SETTINGS.grid.width;
keyLight.shadow.camera.top = SETTINGS.grid.height;
keyLight.shadow.camera.bottom = -SETTINGS.grid.height;
keyLight.shadow.camera.far = 100;
scene.add(keyLight);
scene.add(keyLight.target);
scene.add(new THREE.HemisphereLight(COLORS.skyFill, COLORS.groundFill, 0.8));

/**
 * Place the camera so the whole arena plus one wall thickness of margin is on screen, at the locked pitch.
 *
 * @param {THREE.PerspectiveCamera} target
 */
function frameArena(target) {
  const halfExtent =
    Math.max(SETTINGS.grid.width, SETTINGS.grid.height) / 2 + SETTINGS.camera.margin;
  const halfFov = THREE.MathUtils.degToRad(SETTINGS.camera.fov) / 2;
  // Fit the arena in the vertical field of view, then in the horizontal one (which is the vertical field
  // widened by the aspect ratio), and stand back far enough for whichever is tighter.
  const distanceForHeight = halfExtent / Math.tan(halfFov);
  const distanceForWidth = halfExtent / (Math.tan(halfFov) * Math.max(target.aspect, 0.0001));
  const distance = Math.max(distanceForHeight, distanceForWidth);

  const pitch = THREE.MathUtils.degToRad(SETTINGS.camera.pitchDegrees);
  const centerX = SETTINGS.grid.width / 2;
  const centerZ = SETTINGS.grid.height / 2;
  // Yaw 0 means the camera hangs on the +z side of the arena and tips down towards its centre.
  target.position.set(centerX, distance * Math.sin(pitch), centerZ + distance * Math.cos(pitch));
  target.lookAt(centerX, 0, centerZ);
  target.updateProjectionMatrix();
}

// `?reducedFx=1` freezes anything that moves so screenshot tests compare identical frames (ARCHITECTURE §11).
const reducedFx = new URLSearchParams(window.location.search).get('reducedFx') === '1';

const startedAt = performance.now();

function renderFrame() {
  if (!reducedFx) {
    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    cube.rotation.y = elapsedSeconds * CUBE_SPIN_SPEED * Math.PI * 2;
    cube.rotation.x = cube.rotation.y * 0.5;
  }
  renderer.render(scene, camera);
  requestAnimationFrame(renderFrame);
}

window.addEventListener('resize', () => {
  resizeRendererToWindow(renderer, camera);
  frameArena(camera);
});

renderFrame();
