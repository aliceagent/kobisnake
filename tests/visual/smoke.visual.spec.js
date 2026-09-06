// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * Captures whatever `index.html` renders at rest against a stored baseline in `tests/visual/__baselines__/`
 * (QA-STRATEGY §1: fixed seed, `?reducedFx=1`, 1280×720, 0.2% pixel-diff budget — configured once in
 * `playwright.config.js`). Through Sprints 03 and 04 that was the grey-box arena behind a placeholder
 * "PRESS ENTER" overlay; from KS-05-03 the game boots into the main menu (`ARCHITECTURE §6`), so that is
 * what this baseline now pictures. The file name stays `first-playable-idle.png`: it is the same baseline
 * doing the same job, and renaming it would lose its history for nothing.
 *
 * This baseline used to be the Sprint 01 scaffold scene (a green plane and a spinning red cube); KS-03-05
 * replaced that scene in `main.js`, which is what made the old `scaffold-scene.png` baseline permanently
 * stale rather than a flake, and KS-05-03's boot-into-the-menu change is the second time the same thing has
 * happened for the same kind of reason. Both were updated per QA-STRATEGY §1 ("baselines updated only via a
 * PR labelled `needs-design-review` with Fable's approval"). `gameplay.visual.spec.js` holds the in-round
 * baselines and `screens.visual.spec.js` (KS-05-05) holds one per screen; this file's job stays being the
 * visual-regression smoke test for the page at rest.
 */
test.describe('KS-01-03 visual', () => {
  test('KS-01-03 AC1: npm run test:visual passes — the idle screen matches its baseline', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('#game')).toBeVisible();

    await expect(page).toHaveScreenshot('first-playable-idle.png');
  });
});
