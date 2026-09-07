// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { resolveBuildCommit } from '../../scripts/build-stamp.mjs';

/**
 * KI-19-03: the commit short-hash and build date are baked into the bundle at build time
 * (`docs/sprints/improvement-19-supply-chain-and-release-engineering.md`), shown small on the main menu, and
 * additionally exposed on `window.__kobi` for harnesses (behind `__kobi`'s own existing dev/test gate,
 * unwidened by this ticket).
 *
 * AC1 ("the stamp on the deployed page matches the commit that built it") is asserted honestly here: rather
 * than hard-coding a sha, `resolveBuildCommit()` — the exact function `vite.config.js` calls to bake the
 * value into this build — is called again from this spec. Both run inside the same `npm run test:e2e`
 * process tree (`playwright.config.js`'s `webServer` builds the page this suite dials), so they see the same
 * environment and the same `git` state, and a real disagreement between them is a real bug, not a race.
 */
test.describe('KI-19-03 build stamp', () => {
  test('KI-19-03 AC1: the stamp on the deployed page matches the commit that built it', async ({
    page,
  }) => {
    const expectedCommit = resolveBuildCommit();

    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });

    const stampText = await page.locator('[data-build-stamp]').textContent();
    expect(stampText).toContain(expectedCommit);

    // `__kobi.buildStamp` (available here because `DEFAULT_QUERY` carries `?test=1`) carries the identical
    // commit — the harnesses' own copy of the same build-time value the menu displays.
    const kobiCommit = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.buildStamp.commit,
    );
    expect(kobiCommit).toBe(expectedCommit);

    // The build date half of the stamp: not pinned to a specific value (there is no "the build's own env" to
    // check it against, only "the moment `vite.config.js` ran"), but it must be a real, parseable date — a
    // bug report reading "unknown" or an empty string would be as useless as no stamp at all.
    const kobiDate = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.buildStamp.date);
    expect(Number.isNaN(Date.parse(kobiDate))).toBe(false);
  });

  test('KI-19-03 AC1: the stamp is visible on a normal production load, not gated behind ?test=1', async ({
    page,
  }) => {
    const expectedCommit = resolveBuildCommit();

    // No query string at all — the point of this ticket is a bug report from an ordinary player, who never
    // passes `?test=1`. `__kobi` must stay absent here (the existing gate, unwidened by this ticket) while
    // the menu's own stamp must still be correct.
    await page.goto('/', { waitUntil: 'load' });

    const stampText = await page.locator('[data-build-stamp]').textContent();
    expect(stampText).toContain(expectedCommit);

    const hasKobi = await page.evaluate(() => Boolean(/** @type {any} */ (globalThis).__kobi));
    expect(hasKobi).toBe(false);
  });

  test('KI-19-03 AC2: no network request is needed to learn the stamp', async ({ page }) => {
    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });

    /** @type {string[]} */
    const requestsAfterLoad = [];
    page.on('request', (request) => requestsAfterLoad.push(request.url()));

    // Same "flush a few frames" pattern as `tests/e2e/offline.spec.js`, so anything the render loop might
    // trigger has a chance to fire without sleeping for wall-clock time.
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }),
    );

    // The stamp is readable...
    const stampText = await page.locator('[data-build-stamp]').textContent();
    expect(stampText).toContain(resolveBuildCommit());
    // ...and reading it triggered nothing: it was already in the bundle, not fetched.
    expect(requestsAfterLoad, `requests fired after load: ${requestsAfterLoad.join(', ')}`).toEqual(
      [],
    );
  });
});
