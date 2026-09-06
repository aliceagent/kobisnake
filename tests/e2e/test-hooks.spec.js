// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-03-06: test hooks (`window.__kobi`, `ARCHITECTURE §11`).
 *
 * These specs are this ticket's own — KS-03-07 owns `first-playable.spec.js`, `interpolation.spec.js` and
 * `input.spec.js`, and none of them prove the hooks' own two acceptance criteria, so this is a new file
 * (declared in the PR description, per this ticket's tech-lead notes).
 *
 * AC1 needs both halves proved together: `?test=1` present must expose `window.__kobi`, *and* the very same
 * production build loaded without it must genuinely lack it — a hook that is merely unused would still pass
 * a test that only checked the first half. That is why this spec loads the bare `/` for the second half
 * instead of `DEFAULT_QUERY`, which always carries `?test=1`.
 */
test.describe('KS-03-06 test hooks', () => {
  test('KS-03-06 AC1: window.__kobi is absent from the production build unless ?test=1', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'object',
    );

    await page.goto('/');
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'undefined',
    );
  });

  test('KS-03-06 AC2: fastForward(90) completes in under 500 ms', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    // Enter starts a round (the placeholder round flow, KS-03-05), so fastForward has a live sim to advance
    // — the same round-flow path (ROUND_OVER handling, HUD write) a real 90 s of play would take, not just
    // an idle no-op.
    // KS-05-03: main menu -> match setup -> countdown -> PLAYING, in one synchronous script.
    await page.evaluate(startMatchInPage);

    const elapsedMs = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const start = performance.now();
      kobi.fastForward(90);
      return performance.now() - start;
    });

    expect(elapsedMs).toBeLessThan(500);
  });
});
