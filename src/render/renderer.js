// @ts-check
import * as THREE from 'three';

/**
 * Pixel ratio is capped because a 3× retina display costs nine times the pixels of a 1× one for a picture
 * made of big flat bricks that gains almost nothing from it (ARCHITECTURE §7, §12).
 */
const MAX_PIXEL_RATIO = 2;

/** Shadow map size for the single shadow-casting key light (ARCHITECTURE §7). */
const SHADOW_MAP_SIZE = 2048;

export { SHADOW_MAP_SIZE };

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
