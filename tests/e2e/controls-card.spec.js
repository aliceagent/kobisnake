// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-10-02: the controls card on the match-setup screen (`DESIGN-DECISIONS §3` "Controls card on match
 * setup"). The unit tests in `tests/unit/ui/matchSetup.test.js` prove `controlsCardLabel`'s pure string logic
 * without a DOM; this file proves the same thing landed in the real page — real text nodes, colour-matched via
 * a live CSS class — the way the ticket's `QA: e2e + visual` line asks for.
 *
 * Reached via `SELECT_2P` on the live state machine `__kobi` exposes (`ARCHITECTURE §11`), the same way
 * `tests/visual/screens.visual.spec.js`'s MATCH_SETUP baseline reaches it: MATCH_SETUP does not tick, so there
 * is nothing a real keypress buys over dispatching directly.
 */

test.describe('KI-10-02 controls card', () => {
  test('KI-10-02 AC1: names both players\' keys, colour-matched to the snakes it describes', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    const rows = page.locator('.controls-card-row');
    await expect(rows).toHaveCount(2);

    // Approved copy (`DESIGN-DECISIONS §3`), verbatim, at the shipping default colours.
    await expect(rows.nth(0)).toHaveText('PLAYER 1 · RED — W A S D');
    await expect(rows.nth(1)).toHaveText('PLAYER 2 · BLUE — ARROW KEYS');

    // Colour-matched: each row carries the CSS class keyed to the colour it names (hex values live only in
    // styles.css, per CLAUDE.md's never list — this only ever asserts a class name).
    await expect(rows.nth(0)).toHaveClass(/controls-card-row--red/);
    await expect(rows.nth(1)).toHaveClass(/controls-card-row--blue/);
  });

  test('KI-10-02 AC2: each side is labelled in words, not only by colour', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    // Real DOM text, asserted as text — not a screenshot diff — so the card still reads correctly for a
    // player who cannot tell the swatch colours apart (the GDD's "never rely on colour alone").
    const cardText = await page.locator('.controls-card').innerText();
    expect(cardText).toContain('PLAYER 1');
    expect(cardText).toContain('RED');
    expect(cardText).toContain('PLAYER 2');
    expect(cardText).toContain('BLUE');
  });

  test('KI-10-02: the card follows a live colour change instead of staying on a stale literal', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    const rows = page.locator('.controls-card-row');
    await expect(rows.nth(0)).toHaveText('PLAYER 1 · RED — W A S D');

    // Move focus down to the PLAYER 1 COLOUR row (MATCH LENGTH -> POWER-UPS -> MUSIC -> PLAYER 1 (KI-12-04's
    // own HUMAN/CPU row) -> PLAYER 1 COLOUR) and cycle it. With only red/blue owned, this swaps the two
    // players' colours (`DESIGN-DECISIONS §2.7`).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');

    await expect(rows.nth(0)).toHaveText('PLAYER 1 · BLUE — W A S D');
    await expect(rows.nth(1)).toHaveText('PLAYER 2 · RED — ARROW KEYS');
    await expect(rows.nth(0)).toHaveClass(/controls-card-row--blue/);
    await expect(rows.nth(1)).toHaveClass(/controls-card-row--red/);
  });
});
