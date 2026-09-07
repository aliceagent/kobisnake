// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-10-03 AC3: one baseline of the HOW TO PLAY panel open, `?seed=1&reducedFx=1` at 1280×720
 * (`playwright.config.js`'s shared `DEFAULT_QUERY`/`expect.toHaveScreenshot` settings).
 *
 * Kept in its own file rather than added to `tests/visual/screens.visual.spec.js`: that file (and
 * `smoke.visual.spec.js`'s `first-playable-idle.png`) already baseline the *closed* main menu, and
 * `KI-10-01` — merging before this ticket — restyles that same closed screen. A separate file here means
 * this ticket's one new baseline stands alone and does not collide with whatever `KI-10-01` adds or changes
 * in that file.
 */

test.describe('KI-10-03 HOW TO PLAY panel baseline', () => {
  test('KI-10-03 AC3: HOW TO PLAY panel matches its baseline', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    // One ArrowDown from the default-focused 2 PLAYERS reaches HOW TO PLAY directly — every row between them
    // is permanently disabled and skipped by `focus.js`'s wrap-around (see `howToPlay.spec.js`'s own note).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-how-to-play-panel]')).toBeVisible();

    await expect(page).toHaveScreenshot('how-to-play-panel.png');
  });
});
