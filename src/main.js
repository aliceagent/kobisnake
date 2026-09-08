// @ts-check
import { createSession } from './game/session.js';
import { createTestHooks } from './game/testHooks.js';
import { createGameplayRenderer } from './render/renderer.js';
import { setBuildStamp } from './ui/screens/mainMenu.js';
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

// KI-19-03: the commit short-hash and build date `vite.config.js`'s `define` bakes into `import.meta.env` at
// build time (`docs/sprints/improvement-19-supply-chain-and-release-engineering.md`). Read once here, next
// to `isDevOrTest` below, for the same reason that flag is read here and nowhere else: `import.meta.env` is
// Vite's own build-time addition, and `main.js` is the one place allowed to ask. Two separate
// `@ts-expect-error` lines, not one covering both accesses, matching every other `import.meta.env` read in
// this file.
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const buildCommit = import.meta.env.KOBI_BUILD_COMMIT;
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const buildDate = import.meta.env.KOBI_BUILD_DATE;
const buildStamp = { commit: buildCommit, date: buildDate };

// `mainMenu.js`'s own seam (see that module's doc comment on `setBuildStamp`): called before `createUi`
// below builds the one `MAIN_MENU` screen that will ever exist for the life of this page, so its first
// render already carries the real stamp rather than the module's `'unknown'` default. Visible on every
// normal production load — this is the whole point (a bug report has to be able to name which build with no
// extra step, never gated behind `?test=1`) — unlike `window.__kobi.buildStamp` below, which stays behind
// the existing dev/test gate like the rest of `__kobi`.
setBuildStamp(buildStamp);

const ui = createUi(uiRoot);

// One flag, read once, for two jobs: the state machine throws on an illegal transition instead of ignoring
// it (KS-05-02's `strict`), and `window.__kobi` exists at all. Both want the same answer to "is a developer or
// a test driving this?", and `import.meta.env` is Vite's own build-time addition, so `main.js` is the one
// place allowed to ask (`session.js` and `testHooks.js` stay provable in plain Node by never reaching for it).
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const isDevOrTest = import.meta.env.DEV || window.location.search.includes('test=1');

// KI-15-02 test-only seam (declared in the PR description, outside this ticket's `Files:` list): `?ownedColors=`
// widens the match-setup colour pool past the shipping `red,blue` (`DEFAULT_OWNED_COLORS`, `session.js`), so
// an e2e spec can reach a pair KI-15-01's colour-vision check fails without a shop unlock existing yet
// (Sprint 14). Gated behind the same dev/test flag as `__kobi` itself — a real production load can never use
// it to skip the shop economy. Comma-separated catalogue keys, e.g. `?ownedColors=red,blue,green`.
const ownedColorsParam = new URLSearchParams(window.location.search).get('ownedColors');
const ownedColors =
  isDevOrTest && ownedColorsParam !== null
    ? ownedColorsParam.split(',').filter((name) => name.length > 0)
    : undefined;

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
  ...(ownedColors !== undefined ? { ownedColors } : {}),
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
  // KI-19-03: additional to the menu's own always-visible stamp above — never a substitute for it, and gated
  // by the same `isDevOrTest` this whole block already guards, not a looser check of its own (extending the
  // already-gated hooks object here, rather than touching `testHooks.js` outside this ticket's `Files:` list,
  // matches how `getPlaytestAnswers` is added to `__kobi` below).
  /** @type {any} */ (window).__kobi.buildStamp = buildStamp;
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

// KI-11-02: the between-round playtest prompt, gated the same way as `__kobi` and the tuning overlay above —
// `?playtest=1` (a human running a Gate session on a real deploy can add it) or a dev server, never a plain
// production load. AC1 needs the prompt's DOM node genuinely absent otherwise, not merely hidden, so — like
// the other two — the gate has to guard the construction itself; `playtestPrompt.js` never reads
// `window.location` or `import.meta`. `session.setPlaytestPrompt` is KI-11-02's own nullable seam
// (`session.js`'s header note): a normal load never calls it, so `session.js` never has a prompt to ask.
//
// **KI-11-05: the import is dynamic, and that is the point of the ticket.** A static `import` put
// `playtestPrompt.js` and the two `src/qa/` modules it pulls in — about 55 kB of source — into the entry
// chunk, so every normal player downloaded the whole capture mode and then never ran a line of it. "A normal
// load is unaffected" has to be true of the download as well as of the DOM. `import()` moves all three into
// their own chunk that only this branch ever asks for, which is why the offline check still passes with the
// flag on (the chunk is same-origin, served by the same static host as everything else) and why a plain load
// makes no request for it at all. Both halves are asserted in `tests/e2e/playtest-bundle.spec.js`.
//
// Top-level `await` rather than `.then()`: `session.start()` below fires the first `ui.show()`, and the
// prompt must be registered before any round can end. `build.target` is `es2022`, so this compiles to a real
// top-level await rather than being downlevelled.
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const isPlaytestEnabled = import.meta.env.DEV || window.location.search.includes('playtest=1');
if (isPlaytestEnabled) {
  const { createPlaytestPrompt } = await import('./ui/screens/playtestPrompt.js');
  // KI-11-03: `getReplay` is what lets `offer()` snapshot the round that just ended at the exact moment
  // `session.js` calls it, before the next `startRound()` can reset the logs `getReplay()` reads (tech-lead
  // note 1 on issue #162) — the same `session.getReplay()` the tuning overlay above is already wired to.
  // `getMatchSettings` is read fresh on every EXPORT click rather than captured once here.
  const playtestPrompt = createPlaytestPrompt(uiRoot, {
    getReplay: () => session.getReplay(),
    getMatchSettings: () => session.getMatchSettings(),
  });
  session.setPlaytestPrompt(playtestPrompt);
  // Test-only: `getAnswers()` is plain data (KI-11-02's own contract), so it survives `page.evaluate`'s
  // structured clone with nothing to adapt — extending the already-gated `__kobi` here, rather than touching
  // `testHooks.js`, is what lets `tests/e2e/playtest-prompt.spec.js` read collected answers without this
  // file reaching into the prompt's DOM.
  if (isDevOrTest) {
    /** @type {any} */ (window).__kobi.getPlaytestAnswers = () => playtestPrompt.getAnswers();
  }
}

session.start();

// The sprint's QA plan resizes the window (down to 300×300 and back) and expects the camera to re-fit.
//
// KI-16-02, a declared deviation from that ticket's own `Files:` list (this file is not on it): the listener
// now calls `session.resize()` rather than `renderer.resize()` directly. Re-framing the camera is only half
// of handling a resize — the new drawing buffer also has to be drawn into before the browser can show a
// stretched one, and the HUD's projected power-up tags have to be repositioned — and the session is the only
// thing that holds a snapshot, the HUD and the renderer together. It advances no simulated time; see its own
// doc comment. `renderer.resize()` is still the function that does the re-framing, one call further in.
window.addEventListener('resize', () => {
  session.resize();
});
