// @ts-check
import { expect, test } from '@playwright/test';

/**
 * KI-15-03: reduced motion via the `prefers-reduced-motion: reduce` media query — the second way into
 * `reducedFx`, alongside the existing `?reducedFx=1` (`ARCHITECTURE §11`; `src/render/reducedMotion.js`).
 *
 * Every other e2e and visual spec navigates with `DEFAULT_QUERY` (`playwright.config.js`), which always
 * carries `?reducedFx=1` — exactly the path AC2 says must stay unchanged. This file is the one spec that
 * deliberately omits it, so the media query is the *only* thing making `reducedFx` true here, proved in a
 * real browser via Playwright's own `page.emulateMedia` rather than a mocked `matchMedia`
 * (`tests/unit/render/camera.test.js` and `tests/unit/render/reducedMotion.test.js` cover that side in Node).
 *
 * `session.js` never calls `camera.shake()` for a crash today (grep the whole of `src/game` and `src/render`
 * for a call site: there is none outside tests) — see this ticket's PR notes. So this drives the live
 * gameplay camera's own `shake()` directly, through the two small test-only hooks KI-15-03 added to
 * `__kobi` (`isReducedMotion`, `shakeCameraForTest`), rather than staging a scripted crash that would only
 * prove the slow-mo *simulation* beat still runs (unchanged; not this ticket's job) and say nothing about
 * whether the camera was gated correctly.
 */
test.describe('KI-15-03 reduced motion', () => {
  test('KI-15-03 AC1: with the media query emulated, a crash produces no camera displacement — asserted numerically through the renderer', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // `?test=1&seed=1`, deliberately without `reducedFx=1` (see the module doc comment above).
    await page.goto('/?test=1&seed=1');

    const reduced = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.isReducedMotion(),
    );
    expect(reduced).toBe(true);

    // DESIGN-DECISIONS §3's own crash-shake numbers: amplitude 0.15 units, 0.3 s.
    const displacement = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.shakeCameraForTest(0.15, 0.3),
    );
    expect(displacement).toBe(0);
  });

  test('the same shake produces nonzero displacement without the media query (the case AC1 rules out)', async ({
    page,
  }) => {
    // No `emulateMedia` call — Playwright's own default is "no preference" — and no `?reducedFx=1` either,
    // so this is the control: the one case where the camera is *not* under reduced motion.
    await page.goto('/?test=1&seed=1');

    const reduced = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.isReducedMotion(),
    );
    expect(reduced).toBe(false);

    const displacement = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.shakeCameraForTest(0.15, 0.3),
    );
    expect(displacement).toBeGreaterThan(0);
  });

  test("KI-15-03: ?reducedFx=1 still wins with no media-query preference expressed (AC2's own path, unchanged)", async ({
    page,
  }) => {
    await page.goto('/?test=1&seed=1&reducedFx=1');

    const reduced = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.isReducedMotion(),
    );
    expect(reduced).toBe(true);
  });
});
