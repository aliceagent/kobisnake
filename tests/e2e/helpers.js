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
 * Wall seconds the countdown lasts: four beats at `SETTINGS.countdownStepSeconds` (0.8 s).
 *
 * **Not what a spec should fast-forward by, since KS-06-00.** `__kobi.fastForward` advances in frame-sized
 * chunks now (#84), so one fixed call cannot land exactly on the countdown's last boundary: 3.2 s sums to a
 * hair under it in binary float and leaves the countdown unfinished, and the 3.21 s that used to be right
 * spills its last hundredth of a second into the round, starting it at tick 1 instead of tick 0. Every
 * helper below therefore *steps until the state changes* rather than fast-forwarding a fixed duration, and
 * so does every spec that plays a countdown out inline. This constant is kept because it is still the honest
 * answer to "how long is the countdown", which a spec occasionally needs to reason about.
 *
 * Deliberately a plain number here rather than an import from `src/core/settings.js`: these helpers are
 * serialised into the page, and a serialised function cannot reach a module-level constant.
 */
export const COUNTDOWN_SECONDS = 3.2;

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
  // Stepped rather than fast-forwarded a fixed 3.21 s (KS-06-00, see COUNTDOWN_SECONDS above). The chunk
  // that ends the countdown gives the round nothing — `session.js`'s `advanceCountdown` dispatches
  // COUNTDOWN_DONE and returns — so the loop leaves the round at tick 0 exactly, as it always did. The bound
  // is nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
  return kobi.getState();
}

/**
 * Plays a countdown already in progress out, leaving the round at tick 0 in PLAYING. For a spec that reached
 * COUNTDOWN some other way than {@link startMatchInPage} — `__kobi.startMatch()` on its own, say, when the
 * countdown itself is what the spec wants to look at first.
 *
 * @returns {string} the state afterwards — `'PLAYING'`.
 */
export function playCountdownInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
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
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
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

/**
 * Steers player 1 into the top wall and runs past the crash and the slow-mo beat that follows it, leaving
 * the game on the scoreboard with player 2 the round's winner.
 *
 * P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); UP is a legal turn and, left uncorrected,
 * kills it twelve grid steps later — exactly 2.0 simulated seconds at 6 cells/s. P2 gets no input and does
 * not reach the opposite wall until ≈ 3.167 s, so P1 dies alone and P2 takes the round. Three seconds covers
 * the crash and the 0.6 s crash slow-mo beat (`§2.5`) with room to spare.
 *
 * Moved here from `match-flow.spec.js` (KS-05-05, tech-lead note B: shared page-side helpers belong in this
 * file) once a second spec file needed the identical script; `match-flow.spec.js`'s own four KS-05-03 tests
 * are unchanged by the move, only where the function they call lives.
 */
export function crashPlayerOneInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.pressKey(1, 'UP');
  kobi.fastForward(3);
  return { state: kobi.getState(), match: kobi.getMatch() };
}

/**
 * Leaves the scoreboard and plays the next round's countdown out, landing back in PLAYING. Moved here for
 * the same reason as {@link crashPlayerOneInPage}.
 */
export function nextRoundInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  // Both beats stepped rather than fast-forwarded a fixed duration (KS-06-00). The old pair of coarse calls
  // used to consume each beat whole; chunked, the leftover of the scoreboard's 3 s ran on into the countdown
  // and the countdown's leftover ran on into the round, so the second round of a match started roughly half
  // a second in — enough to change which snake reached a wall first, and how `match-flow.spec.js`'s Bo3 came
  // out. Stepping to each state boundary is both faithful to real time and exact.
  for (let i = 0; i < 60 && kobi.getState() === 'ROUND_OVER'; i += 1) kobi.advance(0.1);
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
  return kobi.getState();
}
