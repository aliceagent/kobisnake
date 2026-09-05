// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * Captures the Sprint 01 scaffold scene (green plane, red spinning cube, frozen by `?reducedFx=1`) against a
 * stored baseline in `tests/visual/__baselines__/` (QA-STRATEGY §1: fixed seed, `?reducedFx=1`, 1280×720,
 * 0.2% pixel-diff budget — configured once in `playwright.config.js`). Sprint 03 replaces the scene this
 * captures; it does not need to replace this file's role as the visual-regression smoke test.
 */
test.describe('KS-01-03 visual', () => {
  test('KS-01-03 AC1: npm run test:visual passes — scaffold scene matches its baseline', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('#game')).toBeVisible();

    await expect(page).toHaveScreenshot('scaffold-scene.png');
  });
});
