// @ts-check

/**
 * Shared page-side helpers for the Playwright suites (added by KS-05-03).
 *
 * Before Sprint 05 every spec started a round by pressing Enter on a placeholder idle overlay. That overlay
 * is gone: the game now boots into the main menu and reaches a round through the real flow — 2 PLAYERS,
 * START MATCH, then the 3 · 2 · 1 · GO countdown (`DESIGN-DECISIONS §2.4`). {@link startMatchInPage} is that
 * flow in one call, so a spec that only wants "a round, running" says so in one line instead of scripting
 * two screens.
 *
 * **These functions run inside the browser**, shipped there by `page.evaluate` as source text. They cannot
 * capture anything from this module's scope — no imports, no outer constants — which is why the countdown
 * duration below is repeated inside each of them rather than referenced. Keep them self-contained.
 */

/**
 * Wall seconds needed to play the countdown out: four beats at `SETTINGS.countdownStepSeconds` (0.8 s), plus
 * a hundredth of a second so a frame lands *past* the final boundary rather than exactly on it.
 *
 * Deliberately a plain number here rather than an import from `src/core/settings.js`: these helpers are
 * serialised into the page, and a serialised function cannot reach a module-level constant. A spec that
 * needs the value outside `page.evaluate` imports this one.
 */
export const COUNTDOWN_SECONDS = 3.21;

/**
 * Starts a two-player match and plays the countdown out, all inside one synchronous script.
 *
 * The single script matters as much as the calls do. JavaScript is single-threaded, so no
 * `requestAnimationFrame` callback can run in the middle of this function — the round it leaves behind is at
 * tick 0 exactly, on every machine, every run. Splitting the same work across two `page.evaluate` round-trips
 * would let the live frame loop advance the round in the gap, which is what made an early version of the
 * Sprint 03 visual baselines flaky (see `tests/visual/gameplay.visual.spec.js`'s own module comment).
 *
 * @returns {string} the state the game is in afterwards — `'PLAYING'`.
 */
export function startMatchInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.startMatch();
  kobi.fastForward(3.21);
  return kobi.getState();
}

/**
 * Starts a match, plays the countdown, then pauses on the real PAUSE state and draws one frame.
 *
 * This is how a screenshot gets a still picture. `loop.js` keeps advancing the round in real time for as long
 * as the tab is visible, and `toHaveScreenshot` does its own wall-clock stability wait before it captures
 * anything — long enough for a live round to run right past whatever the spec set up. Pausing freezes
 * simulated time at exactly the frame the last `fastForward` drew (`loop.timeScale` goes to 0), for however
 * long the capture then takes to settle.
 *
 * Until Sprint 05 the specs did this by faking a `visibilitychange` with `document.hidden` overridden to
 * `true`, which relied on `loop.js`'s hidden-tab behaviour rather than on any game state. `__kobi.pause()` is
 * the supported way to say the same thing, and it is a state the game genuinely has.
 *
 * The caller is expected to hide the PAUSE panel before capturing (`[data-screen="PAUSE"]`), the same way
 * `tests/visual/laser.visual.spec.js` hides `.hud` for its own baselines: these are baselines of the arena,
 * not of the pause screen, which gets its own baseline in `tests/visual/screens.visual.spec.js`.
 *
 * @returns {number} the simulation tick the frozen frame shows, which is 0.
 */
export function startMatchAndPauseInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.startMatch();
  kobi.fastForward(3.21);
  kobi.pause();
  kobi.fastForward(0);
  return kobi.sim.tick;
}

/**
 * Hides the PAUSE panel so a paused frame photographs as the arena alone.
 *
 * Pass to `page.evaluate` after {@link startMatchAndPauseInPage}. Uses the `data-screen` attribute rather
 * than a CSS class: classes are Sprint 11's to restyle, the attribute is the screens' stable contract with
 * the test suites.
 */
export function hidePauseScreenInPage() {
  const doc = /** @type {any} */ (globalThis).document;
  const panel = doc.querySelector('[data-screen="PAUSE"]');
  if (panel !== null) panel.hidden = true;
}
