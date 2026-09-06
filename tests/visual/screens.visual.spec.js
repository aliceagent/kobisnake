// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchAndPauseInPage } from '../e2e/helpers.js';

/**
 * KS-05-05: one visual baseline per screen (`ARCHITECTURE §8`'s six `data-screen` states), `?seed=1&reducedFx=1`
 * at 1280×720, 0.2 % pixel-diff budget (`QA-STRATEGY §1`, all set once in `playwright.config.js`'s
 * `DEFAULT_QUERY`/`expect.toHaveScreenshot`).
 *
 * `tests/visual/smoke.visual.spec.js` already has a MAIN_MENU baseline (`first-playable-idle.png`, kept under
 * that name for its own history — see that file's module comment) and `tests/visual/gameplay.visual.spec.js` /
 * `laser.visual.spec.js` already cover PLAYING/LASER_WARNING, which have no grey-box screen of their own to
 * baseline anyway (`ui.js`: `screens[state]` has no entry for either). This file gives every *screen* — the
 * six states `ui.js` actually routes to one — a baseline under one consistent naming scheme
 * (`screen-<state>.png`), MAIN_MENU included: a second baseline of the same static screen costs one extra PNG
 * and buys a single self-contained file a reviewer can hold next to `docs/reference/images` state by state,
 * rather than four fifths of one plus a differently-named fifth living in a Sprint 03 file.
 *
 * **Freezing each screen before its screenshot**, per state, and why:
 *
 * - **MAIN_MENU, MATCH_SETUP, MATCH_OVER need no freeze at all.** `session.js`'s `runUpdate` switch has no
 *   case for any of the three — its `default` branch ("Menus and PAUSE: nothing ticks") is what actually
 *   runs every frame while one of them is up, so nothing on screen can change between this script finishing
 *   and the screenshot settling.
 * - **PAUSE is reached with `__kobi.pause()`** (via `startMatchAndPauseInPage`, the same helper the gameplay
 *   baselines use, minus their final step of hiding the PAUSE panel — this baseline's whole subject is the
 *   panel). `loop.timeScale` goes to 0 and PAUSE is one of the "nothing ticks" default states too, so this is
 *   both the natural way to reach it and a real freeze.
 * - **COUNTDOWN and ROUND_OVER cannot use `__kobi.pause()`.** Neither carries a `PAUSE` row in
 *   `gameStateMachine.js`'s `TRANSITIONS` table, so `session.pause()`'s `machine.can()` guard would make the
 *   call silently do nothing — and both states *do* tick every frame on real wall time
 *   (`advanceCountdown`/`advanceScoreboard`), unlike the three above. What actually freezes them is the frame
 *   loop's own hidden-tab behaviour (`loop.js`): faking `document.hidden = true` and a `visibilitychange`
 *   stops it from ever scheduling another real frame, with no state-machine transition involved at all.
 *   `__kobi.fastForward` still works afterwards — it drives the update path directly and does not consult
 *   `document.hidden` — so every scripted step below runs exactly once, deterministically, with the tab
 *   already frozen throughout.
 *
 * Every scripted moment is one `page.evaluate()` call, for the reason `first-playable.spec.js`'s module
 * comment gives at length: a real frame landing between two halves of a script is exactly the flake this
 * whole file exists to avoid, and it matters more here than almost anywhere else in the suite, since
 * COUNTDOWN's and ROUND_OVER's on-screen text is the one thing under test.
 *
 * Every PNG this file adds was opened and checked by hand against the screen it claims to picture before
 * being committed (tech-lead note F) — see the PR description for that confirmation.
 */

test.describe('KS-05-05 screen baselines', () => {
  test('KS-05-05 AC: MAIN_MENU screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    await expect(page).toHaveScreenshot('screen-main-menu.png');
  });

  test('KS-05-05 AC: MATCH_SETUP screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // Dispatched directly on the live state machine `__kobi` exposes (`ARCHITECTURE §11`) rather than through
    // a real keypress: MATCH_SETUP does not tick either way, but this keeps the whole scripted step — such as
    // it is — inside one `evaluate()` regardless.
    const state = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.stateMachine.dispatch('SELECT_2P');
      return kobi.getState();
    });
    expect(state).toBe('MATCH_SETUP');

    await expect(page).toHaveScreenshot('screen-match-setup.png');
  });

  test('KS-05-05 AC: COUNTDOWN screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      // Freeze first (module doc comment): COUNTDOWN has no PAUSE row, so this is the only freeze available,
      // and it must be in place before anything else runs so no real frame can land in between.
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));

      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch();
      // countdownStepSeconds is 0.8 s (`DESIGN-DECISIONS §2.4`); 2.0 s lands inside the third beat's window
      // ([1.6 s, 2.4 s)) with margin on both sides. `fastForward` ignores `document.hidden` entirely (it is
      // not the real frame loop), so this is exact regardless of the freeze above.
      kobi.fastForward(2.0);
      return { state: kobi.getState(), label: doc.querySelector('.countdown-label')?.textContent };
    });

    expect(result.state).toBe('COUNTDOWN');
    expect(result.label).toBe('1');

    await expect(page).toHaveScreenshot('screen-countdown.png');
  });

  test('KS-05-05 AC: ROUND_OVER screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      // Same freeze and the same reason as COUNTDOWN above: ROUND_OVER has no PAUSE row either, and its
      // scoreboard is shown for `scoreboardSeconds` (2.5 s) of real wall time before `NEXT_ROUND`/`MATCH_OVER`
      // fires and the screen changes out from under a slow screenshot.
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));

      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch();
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      // P1 spawns at (5, 12) heading RIGHT and turning UP kills it on the top wall at 2.0 s
      // (`DESIGN-DECISIONS §2.3`); P2 is unsteered and does not reach its own wall until ≈ 3.167 s, so P1
      // dies alone and P2 takes the round. Three seconds covers the crash and the 0.6 s slow-mo beat.
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(result.state).toBe('ROUND_OVER');
    expect(result.match.wins).toEqual({ 1: 0, 2: 1 });

    await expect(page).toHaveScreenshot('screen-round-over.png');
  });

  test('KS-05-05 AC: MATCH_OVER screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      // The freeze is only load-bearing through ROUND_OVER's own 2.5 s window; MATCH_OVER itself does not
      // tick (module doc comment). Applied for the whole script anyway, for the same "one script, no gaps"
      // discipline every other step in this file follows.
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));

      const kobi = /** @type {any} */ (globalThis).__kobi;
      // Bo1: the single scripted crash below both ends the round and decides the match.
      kobi.startMatch({ bestOf: 1 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3); // crash + slow-mo -> ROUND_OVER
      kobi.fastForward(3); // scoreboardSeconds (2.5 s) -> MATCH_OVER, decided
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(result.state).toBe('MATCH_OVER');
    expect(result.match.isOver).toBe(true);
    expect(result.match.winner).toBe(2);

    await expect(page).toHaveScreenshot('screen-match-over.png');
  });

  test('KS-05-05 AC: PAUSE screen matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // Unlike `gameplay.visual.spec.js`'s use of this same helper, the PAUSE panel is left visible — it is
    // this baseline's whole subject, not something to hide.
    const tick = await page.evaluate(startMatchAndPauseInPage);
    expect(tick).toBe(0);
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    await expect(page).toHaveScreenshot('screen-pause.png');
  });
});
