// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-06-02 — the last-resort screen (`docs/sprints/improvement-06-resilience-and-recovery.md`,
 * `src/ui/screens/error.js`, `src/main.js`).
 *
 * AC1 and AC2 share one code path by design (tech-lead notes on the ticket): `main.js` wraps the whole boot
 * sequence in one `try`/`catch`, and `createGameplayRenderer` throwing when no WebGL context can be created
 * is just one of the ways that `catch` can be reached. Each test below fabricates a different one of those
 * ways with `page.addInitScript` (run before any of the page's own scripts, per Playwright's own contract),
 * never by adding a production code path whose only purpose is to be broken by a test (tech-lead note).
 *
 * The third path — a lost context that never comes back — is proven with a fake clock in
 * `tests/unit/ui/errorScreen.test.js` instead of here: `CLAUDE.md` says e2e tests never sleep, and there is
 * no way to observe a real three-second grace period end without one.
 */

/**
 * Makes every `HTMLCanvasElement.prototype.getContext('webgl'|'webgl2'|...)` call return `null`, the way a
 * browser reports "no WebGL available at all" — exactly what `WEBGL_lose_context` is not for (that extension
 * needs a context to exist first) and exactly what three.js's own `WebGLRenderer` constructor throws on
 * finding. 2D and other non-WebGL context types are left alone, so nothing else on the page misbehaves.
 *
 * @param {import('@playwright/test').Page} page
 */
async function blockWebglContextCreation(page) {
  await page.addInitScript(() => {
    const proto = /** @type {any} */ (globalThis).HTMLCanvasElement.prototype;
    const originalGetContext = proto.getContext;
    proto.getContext = function (/** @type {string} */ type, ...args) {
      if (typeof type === 'string' && type.toLowerCase().includes('webgl')) return null;
      return originalGetContext.apply(this, [type, ...args]);
    };
  });
}

/**
 * Makes the very first thing `main.js` does inside its `try` — `new URLSearchParams(window.location.search)
 * .get('seed')` — throw, so AC2 is proven against a different failure than AC1's, per the tech-lead note
 * asking for "a different throw". This is a real browser API `main.js` genuinely depends on for a genuine
 * reason (`?seed=N`); the init script only makes it fail this once.
 *
 * @param {import('@playwright/test').Page} page
 */
async function breakUrlSearchParamsGet(page) {
  await page.addInitScript(() => {
    const proto = /** @type {any} */ (globalThis).URLSearchParams.prototype;
    proto.get = function () {
      throw new Error('KI-06-02 e2e: fabricated startup throw');
    };
  });
}

test.describe('KI-06-02 the last-resort screen', () => {
  test('KI-06-02 AC1: WebGL unavailable shows the screen instead of a blank page', async ({
    page,
  }) => {
    const pageErrors = /** @type {string[]} */ ([]);
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await blockWebglContextCreation(page);
    await page.goto(DEFAULT_QUERY);

    const screen = page.locator('[data-screen="ERROR"]');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText('RELOAD');

    // Not a blank page: something legible is actually on screen, not just a hidden test hook nobody sees.
    await expect(page.locator('body')).not.toBeEmpty();

    // Nothing else got far enough to build — `createUi` is called after the renderer, and the renderer is
    // what threw — so there is exactly one screen in the DOM, not the error screen stacked over a half-built
    // main menu.
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toHaveCount(0);

    // The `try`/`catch` caught it: nothing escaped as an uncaught page error for a human to have to notice in
    // devtools instead of on the screen itself (AC2's own point, true here too).
    expect(pageErrors).toEqual([]);
  });

  test('KI-06-02 AC1: the screen carries the data-screen hook the visual baseline addresses', async ({
    page,
  }) => {
    await blockWebglContextCreation(page);
    await page.goto(DEFAULT_QUERY);

    await expect(page.locator('[data-screen="ERROR"]')).toBeVisible();
  });

  test('KI-06-02 AC2: an unrelated thrown error during startup reaches the screen, not just the console', async ({
    page,
  }) => {
    const pageErrors = /** @type {string[]} */ ([]);
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const consoleErrors = /** @type {string[]} */ ([]);
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await breakUrlSearchParamsGet(page);
    await page.goto(DEFAULT_QUERY);

    const screen = page.locator('[data-screen="ERROR"]');
    await expect(screen).toBeVisible();
    await expect(screen).toContainText('RELOAD');

    // It did not merely vanish into the console silently — it also reached the screen (the "not just the
    // console" half of AC2). The console message is expected (`main.js`'s own `console.error(err)`, so
    // whoever files the bug still has the detail); what matters is it is not the *only* place this landed.
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.length).toBeGreaterThan(0);
  });

  test('KI-06-02: RELOAD is a real control — clicking it reloads the page', async ({ page }) => {
    await blockWebglContextCreation(page);
    await page.goto(DEFAULT_QUERY);

    const screen = page.locator('[data-screen="ERROR"]');
    await expect(screen).toBeVisible();

    // `addInitScript` re-runs on every navigation this page makes (Playwright's own contract), so WebGL is
    // still blocked after the reload — the screen coming back is proof the click actually navigated the page,
    // not just that some in-page handler ran. `waitForEvent('load')` rather than the deprecated
    // `waitForNavigation`.
    await Promise.all([page.waitForEvent('load'), page.locator('.error-reload-button').click()]);

    await expect(page.locator('[data-screen="ERROR"]')).toBeVisible();
  });

  test('KI-06-02: Enter reloads the page too, from this screen only', async ({ page }) => {
    await blockWebglContextCreation(page);
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="ERROR"]')).toBeVisible();

    await Promise.all([page.waitForEvent('load'), page.keyboard.press('Enter')]);

    await expect(page.locator('[data-screen="ERROR"]')).toBeVisible();
  });
});
