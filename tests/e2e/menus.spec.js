// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { crashPlayerOneInPage } from './helpers.js';

/**
 * KS-05-05: back navigation from every screen (`ARCHITECTURE §8`, `gameStateMachine.js`'s `TRANSITIONS`
 * table).
 *
 * This is smaller than it sounds (tech-lead note E), so this file tests exactly what the game has, not what
 * "back navigation from every screen" might suggest an unread ticket implies:
 *
 * - **MAIN_MENU**'s own `BACK` row is a real, tested no-op (`gameStateMachine.js` AC3) — there is nowhere
 *   further back to go, and the row exists so that is a decision rather than a silent omission.
 * - **MATCH_SETUP** has a real `BACK` row to `MAIN_MENU`, wired to Esc.
 * - **MATCH_OVER** has no `BACK` row in the transition table at all (only `REMATCH` and `QUIT_TO_MENU`), so
 *   Esc there is provably inert — asserted below alongside the QUIT TO MENU item that is this screen's actual
 *   way back.
 * - **PAUSE** is the same story — no `BACK` row, only `RESUME`/`REMATCH`/`QUIT_TO_MENU` — and its own Esc-does-
 *   nothing plus its QUIT TO MENU route are covered by `pause.spec.js` instead of being duplicated here,
 *   since that file already owns pause/resume/quit end to end.
 * - **COUNTDOWN** and **ROUND_OVER** carry no `BACK` row and no quit affordance of any kind — `session.js`'s
 *   `handleMenuAction` explicitly ignores every menu action during COUNTDOWN, and ROUND_OVER's scoreboard
 *   screen's `handleMenuAction` is a deliberate no-op (`scoreboard.js`). Esc doing nothing in either is
 *   asserted below too, mostly to prove it does not throw: the state machine is `strict` under `?test=1`
 *   (`main.js`), so an accidental illegal-transition attempt here would surface as a thrown error rather than
 *   a silent no-op.
 *
 * Every scripted moment that must land at an exact simulated tick (reaching MATCH_OVER via a scripted crash)
 * stays inside one `page.evaluate()`, for the reason `first-playable.spec.js`'s module comment explains at
 * length. Plain screen-navigation steps (Esc, Enter, arrow keys) use real Playwright key presses instead: none
 * of MAIN_MENU, MATCH_SETUP, MATCH_OVER, or COUNTDOWN/ROUND_OVER-while-otherwise-untouched depend on landing
 * at a precise tick, so a real round-trip between two of them costs nothing.
 */

test.describe('KS-05-05 back navigation', () => {
  test('KS-05-05 AC: Esc on MAIN_MENU is a no-op', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );
  });

  test('KS-05-05 AC: Esc on MATCH_SETUP returns to MAIN_MENU', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // '2 PLAYERS' is the default-focused row on a fresh MAIN_MENU ('1 PLAYER' above it is permanently
    // disabled and can never hold focus — `mainMenu.js` AC2).
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );
  });

  test('KS-05-05 AC: Esc on COUNTDOWN does nothing', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.startMatch();
      // countdownStepSeconds is 0.8 s (`DESIGN-DECISIONS §2.4`); 0.9 s lands on the second beat ('2'), with
      // 0.7 s of margin on either side before the real background loop's own wall clock could carry the
      // countdown to a different beat or past COUNTDOWN entirely while this test's own real `Escape`
      // keypress (a separate round-trip from this script) is in flight.
      /** @type {any} */ (globalThis).__kobi.fastForward(0.9);
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'COUNTDOWN',
    );

    await page.keyboard.press('Escape');

    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'COUNTDOWN',
    );
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeVisible();
  });

  test('KS-05-05 AC: Esc on ROUND_OVER does nothing, and MATCH_OVER has no Esc route (QUIT TO MENU is its way back)', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Bo1 so the one scripted crash below both ends the round and decides the match, reaching ROUND_OVER and
    // then MATCH_OVER without playing a second round.
    await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 1 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
    });

    const crashed = await page.evaluate(crashPlayerOneInPage);
    expect(crashed.state).toBe('ROUND_OVER');

    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'ROUND_OVER',
    );
    await expect(page.locator('[data-screen="ROUND_OVER"]')).toBeVisible();

    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.fastForward(3); // scoreboardSeconds is 2.5
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_OVER',
    );

    // MATCH_OVER's own Esc: `gameStateMachine.js`'s TRANSITIONS[MATCH_OVER] has no BACK row, so this must be
    // provably inert before its real way back (QUIT TO MENU) is exercised.
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_OVER',
    );
    await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();

    // QUIT TO MENU is the second (and last) row on MATCH_OVER, below the default-focused REMATCH.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );
    // Leaving to the main menu clears the finished match (`session.js`'s `showMainMenu`).
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatch())).toBeNull();
  });
});
