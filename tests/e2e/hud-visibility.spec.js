// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { crashPlayerOneInPage, playCountdownInPage, startMatchInPage } from './helpers.js';

/**
 * KS-06-00 AC2: the HUD is visible only in COUNTDOWN, PLAYING, LASER_WARNING and PAUSE
 * (`ARCHITECTURE §8`, the design lead's ruling on the Sprint 05 QA report).
 *
 * Before this ticket the timer and both length panels were drawn over every screen in the game, including
 * the main menu — visible in `first-playable-idle.png` and in all six `screen-*.png` baselines. It was not a
 * regression (Sprint 03's idle screen did the same behind its "PRESS ENTER" overlay) but it read as one the
 * moment the menus became real menus.
 *
 * The screenshots AC2 names are the `tests/visual/screens.visual.spec.js` baselines, regenerated in this same
 * PR. This file is the behavioural half: it walks the game through every state a player can reach and asserts
 * the HUD's own visibility at each, which a pixel diff can only imply. `.hud` is the container `hud.js`
 * builds; hiding it hides the timer, both player panels and the laser banner together.
 */

/** @param {import('@playwright/test').Page} page */
function hud(page) {
  return page.locator('.hud');
}

/** @param {import('@playwright/test').Page} page */
function state(page) {
  return page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState());
}

test.describe('KS-06-00 AC2: the HUD is hidden outside a round', () => {
  test('KS-06-00 AC2: no HUD on MAIN_MENU or MATCH_SETUP', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // The game boots straight into the menu (KS-05-03), so this is the first frame a player ever sees.
    expect(await state(page)).toBe('MAIN_MENU');
    await expect(hud(page)).toBeHidden();

    // 2 PLAYERS is the focused row; Enter opens MATCH SETUP.
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();
    await expect(hud(page)).toBeHidden();
  });

  test('KS-06-00 AC2: the HUD is up in COUNTDOWN, stays up in PLAYING, and stays up in PAUSE', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Into the countdown without playing it out: `startMatch()` leaves the game in COUNTDOWN.
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.startMatch());
    expect(await state(page)).toBe('COUNTDOWN');
    await expect(hud(page)).toBeVisible();

    await page.evaluate(playCountdownInPage);
    expect(await state(page)).toBe('PLAYING');
    await expect(hud(page)).toBeVisible();

    // PAUSE is drawn over a frozen round, and the timer under it is that round's own, stopped where the
    // player stopped it. That is the reason PAUSE is on the list at all.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    await expect(hud(page)).toBeVisible();
  });

  test('KS-06-00 AC2: no HUD on ROUND_OVER, and none on MATCH_OVER', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    // Best of 1, so one crash decides the whole match and both screens are reachable in one run.
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.startMatch({ bestOf: 1 }));
    await page.evaluate(playCountdownInPage);

    await page.evaluate(crashPlayerOneInPage);
    expect(await state(page)).toBe('ROUND_OVER');
    await expect(hud(page)).toBeHidden();

    // Past the 2.5 s scoreboard (`DESIGN-DECISIONS §2.6`) into the match-over screen.
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.fastForward(3));
    expect(await state(page)).toBe('MATCH_OVER');
    await expect(hud(page)).toBeHidden();
  });

  test('KS-06-00 AC2: quitting to the menu takes the HUD down with it', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);
    await expect(hud(page)).toBeVisible();

    // Esc, then down twice to QUIT TO MENU (`pause.js`'s row order), then Enter.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    expect(await state(page)).toBe('MAIN_MENU');
    await expect(hud(page)).toBeHidden();
  });
});
