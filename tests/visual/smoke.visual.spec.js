// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * Captures the first-playable idle screen (KS-03-05: the grey-box arena behind the "PRESS ENTER" overlay,
 * frozen by `?reducedFx=1`) against a stored baseline in `tests/visual/__baselines__/` (QA-STRATEGY §1: fixed
 * seed, `?reducedFx=1`, 1280×720, 0.2% pixel-diff budget — configured once in `playwright.config.js`).
 *
 * This baseline used to be the Sprint 01 scaffold scene (a green plane and a spinning red cube); KS-03-05
 * replaced that scene in `main.js`, which is what made the old `scaffold-scene.png` baseline permanently
 * stale rather than a flake. Updated here per QA-STRATEGY §1 ("baselines updated only via a PR labelled
 * `needs-design-review` with Fable's approval") — this PR carries that label. KS-03-07 adds
 * `gameplay.visual.spec.js` alongside this file for the in-round baselines; this file's job stays being the
 * visual-regression smoke test for whatever `index.html` renders at rest.
 */
test.describe('KS-01-03 visual', () => {
  test('KS-01-03 AC1: npm run test:visual passes — first-playable idle screen matches its baseline', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('#game')).toBeVisible();

    await expect(page).toHaveScreenshot('first-playable-idle.png');
  });
});
