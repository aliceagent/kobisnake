// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-10-01: the main menu reads as an invitation — one clear primary action, five grouped-away unavailable
 * items that stay honest (visible, unselectable), and the approved one-line description under the title.
 *
 * `tests/e2e/menus.spec.js` already covers Esc/back navigation through MAIN_MENU end to end and is left
 * untouched, per the ticket. This file is new — not on the ticket's `Files:` list by name, but `tests` is —
 * and owns exactly this ticket's two e2e-shaped acceptance criteria.
 */

const ALL_LABELS = ['1 PLAYER', '2 PLAYERS', 'PRACTICE', 'TUTORIAL', 'SHOP', 'SETTINGS'];
const UNAVAILABLE_LABELS = ['1 PLAYER', 'PRACTICE', 'TUTORIAL', 'SHOP', 'SETTINGS'];

test.describe('KI-10-01 a menu that reads as an invitation', () => {
  test('KI-10-01 AC1: every previously unavailable item is still present and still unselectable', async ({
    page,
  }) => {
    // Ten rows' worth of assertions and clicks, each a real actionability-checked Playwright action; give it
    // real headroom (same pattern as inputLatency.spec.js / laser-warning-banner.spec.js) rather than racing
    // the 30s default on a shared, loaded machine.
    test.setTimeout(60_000);

    await page.goto(DEFAULT_QUERY);
    const menu = page.locator('[data-screen="MAIN_MENU"]');
    await expect(menu).toBeVisible();

    // All six labels are still on screen, each exactly once.
    for (const label of ALL_LABELS) {
      await expect(menu.locator('.menu-item-label', { hasText: label })).toHaveCount(1);
    }

    // Every one of the five unavailable rows still carries COMING SOON and the disabled class, and clicking
    // it does nothing — no row ever gains the focus ring, and no other screen ever appears.
    const disabledRows = UNAVAILABLE_LABELS.map((label) =>
      menu.locator('.menu-item', { has: page.locator('.menu-item-label', { hasText: label }) }),
    );
    for (const row of disabledRows) {
      await expect(row).toHaveClass(/menu-item--disabled/);
      await expect(row.locator('.menu-item-tag')).toHaveText('COMING SOON');
      await row.click();
    }
    await expect(menu).toBeVisible();
    for (const row of disabledRows) {
      await expect(row).not.toHaveClass(/menu-item--focused/);
    }
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );

    // The one playable row is unaffected by any of the above, and Enter on a fresh menu still lands on
    // MATCH_SETUP — the existing focus/default-row contract this ticket must not disturb.
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();
  });

  test('KI-10-01 AC2: the description line is on screen at 1280x720 without pushing any item off it', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    const menu = page.locator('[data-screen="MAIN_MENU"]');
    await expect(menu).toBeVisible();

    const description = menu.locator('.menu-description');
    await expect(description).toBeVisible();
    await expect(description).toHaveText(
      'Two players, one keyboard. Eat apples, grow long, and make the other snake crash.',
    );

    const viewport = page.viewportSize();
    expect(viewport).toEqual({ width: 1280, height: 720 });

    // The description and every one of the six menu rows must sit fully inside the 1280x720 viewport —
    // nothing pushed off the bottom (or top) of the screen.
    const boxes = await Promise.all(
      [description, ...(await menu.locator('.menu-item').all())].map((locator) =>
        locator.boundingBox(),
      ),
    );
    for (const box of boxes) {
      expect(box).not.toBeNull();
      const b = /** @type {{x: number, y: number, width: number, height: number}} */ (box);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(720);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1280);
    }
  });
});
