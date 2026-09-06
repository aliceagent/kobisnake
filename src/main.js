// @ts-check
import { createSession } from './game/session.js';
import { createGameplayRenderer } from './render/renderer.js';
import { createUi } from './ui/ui.js';

/**
 * Boot: build the renderer and the HUD/overlay, then wire them to input and the simulation through
 * `createSession` (KS-03-05). This file owns everything `src/game/` is forbidden to touch — three.js and the
 * DOM element lookups — and hands `createSession` plain objects, which is what lets `session.js` be driven
 * from a unit test without a browser (`ARCHITECTURE §3`).
 *
 * Replaces the Sprint 01 scaffold (a spinning cube and its own hand-rolled camera solve) wholesale:
 * `createGameplayRenderer` (KS-03-04) already builds the real arena/snake/apple scene and camera
 * (KS-03-03), so there is nothing left here for `frameArena()` to do.
 */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('game'));
const uiRoot = /** @type {HTMLElement} */ (document.getElementById('ui'));

// `?seed=N` fixes every round's RNG for a reproducible visual baseline; without it, `createSession` draws a
// fresh seed per round from `Date.now()` (its own default), so a human playing several rounds in a row does
// not see the same board every time (`ARCHITECTURE §11`, ticket spec).
const seedParam = new URLSearchParams(window.location.search).get('seed');
const seed = seedParam === null ? null : Number(seedParam);

const renderer = createGameplayRenderer(canvas);
const ui = createUi(uiRoot);

const session = createSession({ renderer, ui, seed });
session.start();

// The sprint's QA plan resizes the window (down to 300×300 and back) and expects the camera to re-fit.
window.addEventListener('resize', () => {
  renderer.resize();
});
