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

    // KI-05-05: this used to be `advance(0.5)` and then `expect(tick).toBeGreaterThan(1)` — a duration,
    // and an assertion loose enough to hide how many ticks actually arrived.
    //
    // Playing cannot be asserted against an absolute tick at all, and that is the real lesson here:
    // `main.js` keeps a live `requestAnimationFrame` loop running, `runUpdate`'s REPLAY case advances the
    // replay on every one of those frames, and frames land in the gaps between Playwright round-trips
    // (`determinism.spec.js`'s "everything inside ONE synchronous evaluate" note is the same hazard). So
    // between clicking PLAY and reading the tick back, an unknowable number of real frames have already
    // run — a first attempt at this fix asked for tick 12 and got 97.
    //
    // PAUSE first. `advanceReplayInternal` is a no-op while paused, so the live loop can no longer move
    // the replay, and from there `stepReplay` gives exact whole ticks (PR #154's rule) that are the same
    // on any machine. Play, pause and step are all still under test; only the unknowable wait is gone.
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.isReplayPlaying()),
    ).toBe(true);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.pauseLabel })
      .click();

    const stepped = await page.evaluate((steps) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const playing = kobi.isReplayPlaying();
      const before = kobi.getReplayTick();
      for (let i = 0; i < steps; i += 1) kobi.stepReplay();
      return { playing, before, after: kobi.getReplayTick() };
    }, 5);

    // Assert the player before the DOM: it is what advanced, and the readout is only a picture of it.
    expect(stepped.playing).toBe(false);
    expect(stepped.after).toBe(stepped.before + 5);
    expect(stepped.after).toBeGreaterThan(1);
    await expect(page.locator('[data-replay-readout]')).toHaveText(
      new RegExp(`TICK ${stepped.after}\\b`),
    );
  });

  test('KI-05-03 AC4: Esc leaves REPLAY and returns to MAIN_MENU', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    // KI-05-05 (#235): this failed roughly one run in four under full-suite load and passed 3/3 alone.
    // `page.keyboard.press` delivers to whatever currently has focus, and this test never clicked or
    // focused anything — it relied on the document holding focus by default, which stops being true when
    // several browser contexts are competing. Clicking the screen's own title takes focus deterministically
    // without touching a row: `.menu-title` is a plain `<div>`, not a `.menu-item`, so it cannot activate
    // anything. The fix is focus, never a longer timeout.
    await page.locator('[data-screen="REPLAY"] .menu-title').click();
    await page.keyboard.press('Escape');

    // The machine is what Escape actually drives; the DOM follows it on the next frame. Asserting the
    // state first means a failure says "the key never arrived" rather than "a div was still hidden".
    await expect
      .poll(() => page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState()))
      .toBe('MAIN_MENU');
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
  });
});
