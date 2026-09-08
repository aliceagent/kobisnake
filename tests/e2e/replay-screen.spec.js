// @ts-check
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { REPLAY_COPY } from '../../src/ui/screens/replay.js';

/**
 * KI-05-03 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): the REPLAY entry point — a paste
 * box or a chosen local file, the transport, and Esc back out.
 *
 * `tests/e2e/replay.spec.js` (KI-05-02) already proves the *player* — `__kobi.loadReplay`/`stepReplay`/
 * `playReplay`/`seekReplay` reproduce a fixture tick for tick in a real browser. This file's job is the part
 * only a real page can prove about the *screen* around it: a real click reaches a real `<textarea>`, a real
 * chosen file goes through `File.text()` (never a request — `tests/e2e/offline.spec.js` proves that half),
 * and a real `Escape` keypress leaves the screen.
 */

const NO_INPUT_ROUND = readFileSync(
  new URL('../sim/replays/no-input-round.json', import.meta.url),
  'utf8',
);

/** @param {import('@playwright/test').Page} page */
async function openReplayScreen(page) {
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_REPLAY');
  });
  await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
}

test.describe('KI-05-03 the REPLAY screen', () => {
  test('KI-05-03: REPLAY is reachable from the main menu with the keyboard', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    // Default focus is 2 PLAYERS; DOWN twice passes over HOW TO PLAY and lands on REPLAY
    // (`mainMenu.js`'s own placement doc comment).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('.menu-item--focused .menu-item-label', { hasText: REPLAY_COPY.menuLabel }),
    ).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'REPLAY',
    );
  });

  test('KI-05-03 AC1: pasting a valid replay plays it', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    await page.locator('[data-replay-paste]').fill(NO_INPUT_ROUND);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();

    await expect(page.locator('.replay-player')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getReplayPhase())).toBe(
      'PLAYING',
    );
  });

  test('KI-05-03 AC1: pasting rubbish shows a readable error and stays on the screen', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    await page.locator('[data-replay-paste]').fill('{not valid json');
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();

    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeVisible();
    await expect(page.locator('.replay-player')).toBeHidden();
    await expect(page.locator('.replay-error-heading')).toHaveText(REPLAY_COPY.badReplayHeading);
    // AC1: "stays on the screen" — the pasted text survives the failed attempt.
    await expect(page.locator('[data-replay-paste]')).toHaveValue('{not valid json');
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'REPLAY',
    );
  });

  test('KI-05-03 AC1: choosing a local file loads it — no paste required', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    // A real file already on disk — the same committed fixture `replay.spec.js` drives — via Playwright's
    // own `setInputFiles`, never a data URI or an object URL this file would have to construct itself.
    await page
      .locator('[data-replay-file-input]')
      .setInputFiles('tests/sim/replays/no-input-round.json');

    await expect(page.locator('.replay-player')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeHidden();
  });

  test('KI-05-03: the transport plays, steps, and reads out the tick', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);
    await page.locator('[data-replay-paste]').fill(NO_INPUT_ROUND);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();
    await expect(page.locator('.replay-player')).toBeVisible();

    await expect(page.locator('[data-replay-readout]')).toHaveText(/TICK 0/);

    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.stepLabel })
      .click();
    await expect(page.locator('[data-replay-readout]')).toHaveText(/TICK 1/);

    // PLAY, then advance the session's own update path deterministically (CLAUDE.md: fast-forward, never
    // sleep) — `__kobi.advance` is the same path a real animation frame drives, so this exercises this
    // ticket's own `runUpdate` REPLAY case, not a shortcut around it.
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.playLabel })
      .click();
    await expect(
      page.locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.pauseLabel }),
    ).toBeVisible();
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.advance(0.5));
    const readoutText = await page.locator('[data-replay-readout]').textContent();
    const tick = Number((readoutText ?? '').match(/TICK (\d+)/)?.[1] ?? '0');
    expect(tick).toBeGreaterThan(1);
  });

  test('KI-05-03 AC4: Esc leaves REPLAY and returns to MAIN_MENU', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );
  });
});
