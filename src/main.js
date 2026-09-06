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

// `?seed=N` fixes the match seed for a reproducible visual baseline (every round derives its own seed from
// it plus the round index, `session.js`); without it, `createSession` draws a
// fresh seed per round from `Date.now()` (its own default), so a human playing several rounds in a row does
// not see the same board every time (`ARCHITECTURE §11`, ticket spec).
const seedParam = new URLSearchParams(window.location.search).get('seed');
const seed = seedParam === null ? null : Number(seedParam);

const renderer = createGameplayRenderer(canvas);
const ui = createUi(uiRoot);

// One flag, read once, for two jobs: the state machine throws on an illegal transition instead of ignoring
// it (KS-05-02's `strict`), and `window.__kobi` exists at all. Both want the same answer to "is a developer or
// a test driving this?", and `import.meta.env` is Vite's own build-time addition, so `main.js` is the one
// place allowed to ask (`session.js` and `testHooks.js` stay provable in plain Node by never reaching for it).
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const isDevOrTest = import.meta.env.DEV || window.location.search.includes('test=1');

const session = createSession({ renderer, ui, seed, strict: isDevOrTest });

// `window.__kobi` (KS-03-06, `ARCHITECTURE §11`): present only in dev or when the page is explicitly asked
// for it with `?test=1`. KS-03-06 AC1 needs the hooks *absent*, not merely unused, from a plain production
// load, so the gate has to guard this assignment itself — `testHooks.js` never touches `window` or
// `import.meta`, so nothing there can leak `__kobi` into a build that does not pass this check.
//
// The condition is computed once above rather than repeated here, because the `import.meta.env.DEV`
// substring must survive into the built bundle exactly as written for Vite to replace it (a cast that wraps
// `import.meta` in parentheses breaks that replacement and leaves an undefined property access at runtime),
// and one such expression is easier to keep right than two.
if (isDevOrTest) {
  /** @type {any} */ (window).__kobi = createTestHooks({ session, renderer });
}

session.start();

// The sprint's QA plan resizes the window (down to 300×300 and back) and expects the camera to re-fit.
window.addEventListener('resize', () => {
  renderer.resize();
});
