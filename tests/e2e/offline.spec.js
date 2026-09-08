// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { REPLAY_COPY } from '../../src/ui/screens/replay.js';

/**
 * KOBI Snake is offline by construction (CLAUDE.md "never" list: "the built site makes zero network requests
 * after load; a test enforces this" — this is that test; ARCHITECTURE §12 also budgets this at exactly 0).
 *
 * Two checks live here, both needed to make AC2 ("fails if a `<script src="https://…">` is added to
 * index.html") true in practice:
 *  - a request to an external host during the initial page load would resolve *before* the `load` event
 *    fires, not after, so a check that only listens after `load` would miss it;
 *  - so this file also asserts that not one request — at any point in the page's lifecycle — leaves the
 *    page's own origin, which is exactly what "no CDN, ever" means and is what an added `<script
 *    src="https://…">` violates immediately.
 *
 * **KI-05-03 AC2** adds a third check, below, that actually *drives* `src/ui/screens/replay.js`'s paste box
 * and local-file input before asserting zero requests — not "the offline check still passes by luck" (that
 * ticket's own tech-lead note), but a check that would fail the moment a `fetch`, a blob URL round trip, or
 * any other request-shaped call landed in that file. Pasting rubbish, pasting a real replay, and choosing a
 * real file off disk (`File.text()`, never an upload) are exactly the three things a player can do on that
 * screen without a network, and this test does all three inside the zero-request window the two checks above
 * already established the shape of.
 */
test.describe('KS-01-03 offline', () => {
  test('KS-01-03 AC1: npm run test:e2e passes — zero network requests after load', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });

    /** @type {string[]} */
    const requestsAfterLoad = [];
    page.on('request', (request) => requestsAfterLoad.push(request.url()));

    // Flush a few animation frames so anything the render loop might trigger has a chance to fire, without
    // sleeping for wall-clock time (CLAUDE.md: e2e tests fast-forward time, they never sleep).
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }),
    );

    expect(requestsAfterLoad, `requests fired after load: ${requestsAfterLoad.join(', ')}`).toEqual(
      [],
    );
  });

  test('KS-01-03 AC2: offline spec fails if index.html adds an external <script src>', async ({
    page,
    baseURL,
  }) => {
    const ownOrigin = new URL(/** @type {string} */ (baseURL)).origin;
    /** @type {string[]} */
    const foreignRequests = [];
    page.on('request', (request) => {
      if (new URL(request.url()).origin !== ownOrigin) {
        foreignRequests.push(request.url());
      }
    });

    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });

    expect(foreignRequests, `requests left ${ownOrigin}: ${foreignRequests.join(', ')}`).toEqual(
      [],
    );
  });

  test('KI-05-03 AC2: pasting, a bad paste, and choosing a local file on the REPLAY screen make zero requests', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });

    /** @type {string[]} */
    const requestsAfterLoad = [];
    page.on('request', (request) => requestsAfterLoad.push(request.url()));

    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_REPLAY');
    });
    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();

    // A bad paste (AC1's "readable error"), a real replay pasted as text, and a real file chosen straight
    // off disk — the three ways this screen ever gets a replay, module doc: never `fetch`, never a blob URL.
    await page.locator('[data-replay-paste]').fill('{not valid json');
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();
    await expect(page.locator('.replay-error')).toBeVisible();

    await page
      .locator('[data-replay-file-input]')
      .setInputFiles('tests/sim/replays/no-input-round.json');
    await expect(page.locator('.replay-player')).toBeVisible();

    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }),
    );

    expect(requestsAfterLoad, `requests fired after load: ${requestsAfterLoad.join(', ')}`).toEqual(
      [],
    );
  });
});
