// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

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
});
