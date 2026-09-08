// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-10-03: the HOW TO PLAY panel (`docs/sprints/improvement-10-first-minute.md`,
 * `docs/design/DESIGN-DECISIONS.md` §3 "First-minute copy").
 *
 * The panel is an overlay `src/ui/screens/mainMenu.js` owns directly — not a `gameStateMachine.js` state
 * (tech-lead ruling on issue #138) — so this file's AC2 tests prove that fact from the outside: the machine
 * never leaves `MAIN_MENU` while the panel opens and closes, and `MAIN_MENU`'s legal events are exactly the
 * six the table already had, unchanged by this ticket.
 *
 * `2 PLAYERS` is the default-focused row on a fresh menu; every disabled row between it and HOW TO PLAY
 * (PRACTICE/TUTORIAL/SHOP/SETTINGS) is skipped by `focus.js`'s own wrap-around, so one `ArrowDown` from boot
 * lands directly on HOW TO PLAY — the entry point this ticket appends after SETTINGS.
 */

/** The four approved lines, verbatim from `DESIGN-DECISIONS §3` — used here to assert the panel's own text. */
const LINES = [
  'Eat apples to grow longer.',
  "Don't hit a wall, yourself, or the other snake.",
  'After 30 seconds the lasers close in.',
  'The last snake alive wins the round.',
];

test.describe('KI-10-03 HOW TO PLAY panel', () => {
  test('KI-10-03 AC1: reachable from the main menu and dismissible with Esc', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    const panel = page.locator('[data-how-to-play-panel]');
    await expect(panel).toBeHidden();

    // 2 PLAYERS is focused by default; every row between it and HOW TO PLAY is disabled, so one ArrowDown
    // reaches it directly (`focus.js`'s wrap-around skips disabled entries).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(panel).toBeVisible();
    await expect(panel).toContainText('HOW TO PLAY');
    for (const line of LINES) {
      await expect(panel).toContainText(line);
    }
    // The main menu itself is still the current screen underneath — opening the panel does not navigate.
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(panel).toBeHidden();
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
  });

  test('KI-10-03 AC1: reachable by mouse click too', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    await page.locator('.menu-item', { hasText: 'HOW TO PLAY' }).click();

    const panel = page.locator('[data-how-to-play-panel]');
    await expect(panel).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('KI-10-03 AC2: opening and closing the panel adds no state-machine transition', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    /** @returns {Promise<{state: string, legalEvents: string[]}>} */
    const readMachine = () =>
      page.evaluate(() => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        return { state: kobi.getState(), legalEvents: kobi.stateMachine.legalEvents() };
      });

    const before = await readMachine();
    expect(before.state).toBe('MAIN_MENU');
    // The rows `TRANSITIONS[MAIN_MENU]` already had, in table order (KI-05-03 added `SELECT_REPLAY`) — HOW
    // TO PLAY must not add one of its own, since it dispatches no `GAME_EVENTS` at all (`mainMenu.js`'s
    // `isHowToPlay` row).
    expect(before.legalEvents).toEqual([
      'SELECT_2P',
      'SELECT_PRACTICE',
      'SELECT_TUTORIAL',
      'SELECT_SHOP',
      'SELECT_SETTINGS',
      'SELECT_REPLAY',
      'BACK',
    ]);

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-how-to-play-panel]')).toBeVisible();

    const whileOpen = await readMachine();
    expect(whileOpen).toEqual(before);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-how-to-play-panel]')).toBeHidden();

    const after = await readMachine();
    expect(after).toEqual(before);
  });

  test('KI-10-03 AC2: UP/DOWN/CONFIRM do not drive the menu behind the open panel', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    await page.keyboard.press('ArrowDown'); // focus HOW TO PLAY
    await page.keyboard.press('Enter'); // open it
    const panel = page.locator('[data-how-to-play-panel]');
    await expect(panel).toBeVisible();

    // Mash navigation and confirm while the panel is open: none of it may reach the menu underneath.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(panel).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );

    // Esc closes it; focus is exactly where it was (HOW TO PLAY), unmoved by the swallowed ArrowUp presses
    // above — proven by Enter reopening the same panel rather than landing on some other row's action.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
  });
});
