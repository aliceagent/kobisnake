// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { MATCH_SETUP_APPLE_CELL } from '../../src/game/session.js';

/**
 * KI-15-02 (issue #192, from #157/#152, tracked on #184): the colour-safe pairing note on match setup, and
 * the one apple on its preview.
 *
 * **AC1's failing pair is forced, not found.** Only `red` and `blue` are owned before Sprint 14's shop, and
 * that pair clears KI-15-01's check three times over (`colourVision.js`'s own doc comment) — the note is
 * unreachable through the shipping colour pool. `?ownedColors=` (this ticket's own test-only seam, `main.js`,
 * declared in the PR description as outside its `Files:` list) widens the pool so a **real keyboard
 * navigation** — the same `ArrowDown`/`ArrowRight` presses a player would make — lands on `red`/`green`, a
 * pair KI-15-01 records failing at 9.88 (`tests/unit/render/colourVision.test.js`'s own waiver table).
 *
 * **Every assertion binds to structure, not to the note's sentence** (`checkColourSafety`'s own doc comment
 * in `matchSetup.js`): whether `[data-colour-note]` is hidden, and its `data-recommended-color` attribute.
 * The copy itself is provisional pending #184 and is never quoted here.
 */

test.describe('KI-15-02 colour-safe pairing', () => {
  test('KI-15-02 AC1: a passing pair (the shipping default, red/blue) shows no note', async ({
    page,
  }) => {
    await page.goto(`${DEFAULT_QUERY}&ownedColors=red,blue,green`);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    const note = page.locator('[data-colour-note]');
    await expect(note).toBeHidden();
  });

  test('KI-15-02 AC1: choosing a failing pair shows the note, naming the nearest passing colour', async ({
    page,
  }) => {
    await page.goto(`${DEFAULT_QUERY}&ownedColors=red,blue,green`);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    const note = page.locator('[data-colour-note]');
    await expect(note).toBeHidden();

    // Real keyboard navigation, exactly as a player would use it: down to PLAYER 2 COLOUR (MATCH LENGTH ->
    // POWER-UPS -> MUSIC -> PLAYER 1 COLOUR -> PLAYER 2 COLOUR), then cycle it. With `ownedColors` widened to
    // `red, blue, green`, blue's next owned colour is green — `red`/`green` is KI-15-01's own recorded 9.88.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    await expect(page.locator('.menu-item-value').nth(4)).toHaveText('GREEN');
    await expect(note).toBeVisible();
    // Structural, not the sentence: the note names the computed alternative — the only owned colour (`blue`)
    // that still clears the check against `red` — as a `data-` attribute.
    await expect(note).toHaveAttribute('data-recommended-color', 'blue');

    // Never blocks starting: START MATCH is still the last, reachable row.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.menu-item--action')).toHaveClass(/menu-item--focused/);

    // Cycling P2 back to blue (red/blue passes) hides the note again — it tracks the live pair, not a
    // one-shot check.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect(note).toBeHidden();
  });

  test('KI-15-02 AC2: the match-setup preview draws one apple at its fixed cell, never on MAIN_MENU', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const beforeSnapshot = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(0);
      return kobi.getRenderedSnapshot();
    });
    expect(beforeSnapshot).toEqual({ snakes: [], apples: [] });

    const afterSnapshot = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.stateMachine.dispatch('SELECT_2P');
      kobi.fastForward(0);
      return kobi.getRenderedSnapshot();
    });
    expect(afterSnapshot.snakes).toEqual([]);
    expect(afterSnapshot.apples).toEqual([MATCH_SETUP_APPLE_CELL]);
  });
});
