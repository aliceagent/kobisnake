// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-04-03: the "LASERS CLOSING!" banner and red-timer markup, in a real browser.
 *
 * New file — not on the ticket's own `Files:` list (declared in the PR description).
 *
 * `LASER_WARNING` fires at 30 s remaining of a 90 s round (`DESIGN-DECISIONS §2.4`); reaching that point with
 * both snakes still alive needs either the test-only `godMode` settings override (KS-04-01), which is
 * deliberately inert outside Vitest (`import.meta.env.TEST` is unset in a built/served page — see
 * `core/round.js`'s own comment on `UNDER_TEST`), or a script that steers both snakes safely for a full
 * simulated minute — neither of which this ticket's scope stretches to. AC1 and AC2's actual timing and
 * persistence are proved directly and deterministically against `hud.js` in `tests/unit/ui/hud.test.js`
 * (`showLaserWarning`/`tick`/`resetWarning`, driven by hand-counted frames) and against the wiring in
 * `tests/unit/game/session.test.js` (`LASER_WARNING` → `hud.showLaserWarning` + `camera.pulseLaserWarning`,
 * and that nothing un-reds the timer before the next round). What only a real browser can confirm is that the
 * markup and stylesheet this ticket adds actually mount and start in the right state — that is this file's
 * whole job.
 */

test.describe('KS-04-03 laser warning banner', () => {
  test('the banner starts hidden and the timer starts unwarned', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    const banner = page.locator('.hud-laser-banner');
    await expect(banner).toBeHidden();
    await expect(banner).toHaveText('LASERS CLOSING!');

    const timer = page.locator('.hud-timer');
    await expect(timer).not.toHaveClass(/hud-timer--warning/);
  });

  test('a fresh round after Enter still starts with the banner hidden and the timer unwarned', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.keyboard.press('Enter');

    const banner = page.locator('.hud-laser-banner');
    await expect(banner).toBeHidden();

    const timer = page.locator('.hud-timer');
    await expect(timer).not.toHaveClass(/hud-timer--warning/);
  });
});
