// @ts-check
import { createSession } from './game/session.js';
import { createTestHooks } from './game/testHooks.js';
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

// `window.__kobi` (KS-03-06, `ARCHITECTURE §11`): present only in dev or when the page is explicitly asked
// for it with `?test=1`. AC1 needs the hooks *absent*, not merely unused, from a plain production load, so
// the gate has to guard this assignment itself — `testHooks.js` never touches `window` or `import.meta`, so
// nothing there can leak `__kobi` into a build that does not pass this check.
//
// `import.meta.env` is a Vite build-time addition with no ambient type here (`jsconfig.json`'s `types` is
// deliberately `[]`), so `checkJs` needs an explicit suppression rather than an `any` cast — a cast that
// wraps `import.meta` in parentheses breaks Vite's own replacement of `import.meta.env.DEV`, which matches
// that exact, unbroken substring in the source and leaves it as a literal (and therefore undefined at
// runtime) property access otherwise.
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
if (import.meta.env.DEV || window.location.search.includes('test=1')) {
  /** @type {any} */ (window).__kobi = createTestHooks({ session, renderer });
}

session.start();

// The sprint's QA plan resizes the window (down to 300×300 and back) and expects the camera to re-fit.
window.addEventListener('resize', () => {
  renderer.resize();
});
