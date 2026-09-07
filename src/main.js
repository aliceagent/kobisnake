// @ts-check
import { createSession } from './game/session.js';
import { createTestHooks } from './game/testHooks.js';
import { createGameplayRenderer } from './render/renderer.js';
import { createTuningScreen } from './ui/screens/tuning.js';
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

// KS-07-06 (declared outside its own `Files:` list; see `session.js`'s "KS-07-06 deviation" note): the same
// dev/test flag that gates `strict` and `__kobi` itself also gates the input-latency tracker, so a normal
// production load builds no tracker at all — `session.js`'s handful of extra call sites all short-circuit on
// a `null` tracker rather than doing any work.
const session = createSession({
  renderer,
  ui,
  seed,
  strict: isDevOrTest,
  enableInputStats: isDevOrTest,
});

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

// KS-07-01: the tuning overlay, gated the same way as `__kobi` above but on its own flag — `?tuning=1` (a
// human on a real production deploy can add it) or a dev server, never a plain production load. AC3 needs
// the overlay's DOM node genuinely absent otherwise, not merely hidden, so — like `__kobi` — the gate has to
// guard the `createTuningScreen` call itself; `tuning.js`/`ui/screens/tuning.js` never read `window` or
// `import.meta` themselves.
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const isTuningEnabled = import.meta.env.DEV || window.location.search.includes('tuning=1');
if (isTuningEnabled) {
  const tuningScreen = createTuningScreen(uiRoot, {
    onChange: (overrides) => session.setSettingsOverrides(overrides),
    getReplay: () => session.getReplay(),
  });
  // PR #115 review: without this, the panel sat on top of the arena's right flank and P2's own HUD pill for
  // the whole round. `ui.js`'s `show()` now folds it on every state that puts the round's HUD up — see that
  // file's `setTuningScreen`/`HUD_STATES` — so this registration has to happen before `session.start()`
  // below fires the first `ui.show()`.
  ui.setTuningScreen(tuningScreen);
  tuningScreen.show();
}

session.start();

// The sprint's QA plan resizes the window (down to 300×300 and back) and expects the camera to re-fit.
window.addEventListener('resize', () => {
  renderer.resize();
});
