// @ts-check
import { expect, test } from '@playwright/test';
import { crashPlayerOneInPage, nextRoundInPage, startMatchInPage } from './helpers.js';

/**
 * KS-07-01: the `?tuning=1` overlay (`docs/sprints/sprint-07-playtest-gate-1-and-tuning.md`).
 *
 * AC3 is proved the same way `test-hooks.spec.js` proves `__kobi`'s own gate (KS-03-06 tech-lead note 4):
 * both halves — present with the flag, genuinely absent (not merely hidden) without it — in one spec, so a
 * hook that is only *unused* rather than *absent* cannot slip through.
 *
 * AC1 is driven entirely through the real DOM the overlay builds (moving a slider, clicking a preset,
 * changing the SLOW-mode `<select>`) rather than by calling a session method directly, since the point of
 * this suite is proving the overlay itself is wired up — `tests/unit/game/session.test.js` and
 * `tests/unit/game/tuning.test.js` already prove the logic underneath it in Node.
 *
 * **PR #115 review finding.** A human measured the shipped panel at 1280×720 in `PLAYING` and found it sat
 * on top of P2's own HUD length pill — `document.elementFromPoint` at the pill's centre resolved to the
 * overlay, not the pill. The "must not cover a HUD pill" test below is that same measurement, kept as a
 * permanent assertion; the fix is `setRoundActive()` (`screens/tuning.js`) folding the panel down whenever
 * `ui.js`'s `HUD_STATES` puts a round's HUD up, which is why the copy-replay test below now unfolds it by
 * clicking the header first — clicking mid-round is still allowed, only the *default* changed.
 */

const TUNING_QUERY = '?test=1&tuning=1&seed=1&reducedFx=1';

/** @param {import('@playwright/test').Page} page @param {string} key @param {number} value */
async function setSlider(page, key, value) {
  await page.evaluate(
    ({ key, value }) => {
      // `globalThis`, not the bare browser globals `document`/`Event` — this arrow function's body runs in
      // the page, not in the Node process that lints it, and `no-undef` only knows the two globals this
      // repo's `eslint.config.js` whitelists for `tests/**` (`test-hooks.spec.js`'s own pattern).
      const global = /** @type {any} */ (globalThis);
      const input = /** @type {HTMLInputElement} */ (
        global.document.querySelector(`[data-tuning-key="${key}"]`)
      );
      input.value = String(value);
      input.dispatchEvent(new global.Event('input', { bubbles: true }));
    },
    { key, value },
  );
}

test.describe('KS-07-01 tuning overlay', () => {
  test('AC3: the overlay is absent (no DOM node) from ?test=1 without ?tuning=1, and from a plain load', async ({
    page,
  }) => {
    await page.goto('?test=1&seed=1&reducedFx=1');
    expect(await page.locator('[data-tuning-overlay]').count()).toBe(0);

    await page.goto('/');
    expect(await page.locator('[data-tuning-overlay]').count()).toBe(0);
    // Not merely hidden — genuinely never built, same discipline test-hooks.spec.js applies to `__kobi`.
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'undefined',
    );
  });

  test('AC3: the overlay is present with ?tuning=1', async ({ page }) => {
    await page.goto(TUNING_QUERY);
    await expect(page.locator('[data-tuning-overlay]')).toHaveCount(1);
    await expect(page.locator('[data-tuning-overlay]')).toBeVisible();
  });

  test('AC1: moving the snake-speed slider changes the *next* round, not the one in progress', async ({
    page,
  }) => {
    await page.goto(TUNING_QUERY);
    await page.evaluate(startMatchInPage);

    const before = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.sim.settings.snakeSpeed,
    );
    expect(before).toBe(6); // DESIGN-DECISIONS §2.1 shipping default

    await setSlider(page, 'snakeSpeed', 3);
    // Still the same running round.
    const midRound = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.sim.settings.snakeSpeed,
    );
    expect(midRound).toBe(6);

    // Crash P1 into the wall and play through the next round's countdown into PLAYING —
    // `match-flow.spec.js`'s own helpers for exactly this.
    const crashed = await page.evaluate(crashPlayerOneInPage);
    expect(crashed.state).toBe('ROUND_OVER');
    const nextState = await page.evaluate(nextRoundInPage);
    expect(nextState).toBe('PLAYING');

    const nextRound = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.sim.settings.snakeSpeed,
    );
    expect(nextRound).toBe(3);
  });

  test('AC1: the laser-start and speed-boost presets (tech-lead note 2) apply without a reload', async ({
    page,
  }) => {
    await page.goto(TUNING_QUERY);

    // "laser start 25 / 30 / 35 s" and the Speed Boost 1.5x/5s vs 1.35x/4s pair, quick buttons per the
    // sprint's own tech-lead notes — clicked, not slider-dragged, matching how a human reaches them.
    await page.getByRole('button', { name: '25s' }).first().click();
    await page.getByRole('button', { name: '1.35× / 4s' }).click();

    await page.evaluate(startMatchInPage);
    const settings = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.settings);
    expect(settings.laserStartTime).toBe(25);
    expect(settings.speedBoost).toEqual({ multiplier: 1.35, duration: 4 });
  });

  test('AC1: the SLOW target mode select applies to settings.slow.targetMode', async ({ page }) => {
    await page.goto(TUNING_QUERY);
    await page.selectOption('[data-tuning-slow-mode]', 'collector');
    await page.evaluate(startMatchInPage);

    const targetMode = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.sim.settings.slow.targetMode,
    );
    expect(targetMode).toBe('collector');
  });

  test('PR #115 review: the overlay must not cover either HUD pill while a round is running', async ({
    page,
  }) => {
    await page.goto(TUNING_QUERY);
    await page.evaluate(startMatchInPage);

    const state = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState());
    expect(state).toBe('PLAYING');

    // The reviewer's own measurement, kept as a permanent check: `elementFromPoint` at the centre of each
    // `.hud-player` pill must never resolve to the tuning overlay. It does not resolve to the pill itself
    // either, in this app, by design — `#ui` (the pill's own ancestor) is `pointer-events: none` so clicks
    // pass through to the canvas underneath (`styles.css`'s own comment on that rule), and a browser's hit
    // test skips any element that cannot receive pointer events. The tuning overlay is the one thing on this
    // page that opts back into `pointer-events: auto`, which is exactly how it was able to steal the hit
    // test out from under the pill in the first place — the bug this test guards against.
    const results = await page.evaluate(() => {
      const global = /** @type {any} */ (globalThis);
      const pills = /** @type {HTMLElement[]} */ (
        Array.from(global.document.querySelectorAll('.hud-player'))
      );
      return pills.map((pill) => {
        const rect = pill.getBoundingClientRect();
        const hit = global.document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit !== null && hit.closest('[data-tuning-overlay]') !== null;
      });
    });

    expect(results).toHaveLength(2); // one pill per player
    for (const hitsOverlay of results) {
      expect(hitsOverlay).toBe(false);
    }
  });

  test('AC2/tech-lead note 6: copy replay always fills the fallback textarea with valid replay JSON', async ({
    page,
  }) => {
    await page.goto(TUNING_QUERY);
    await page.evaluate(startMatchInPage);
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.pressKey(1, 'UP'));
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.fastForward(0.5));

    // The round going live just folded the panel (PR #115 review) — clicking the header is still allowed
    // mid-round, it just is not the default any more. Unfold it to reach the copy button underneath.
    await page.locator('[data-tuning-fold-toggle]').click();

    await page.locator('[data-tuning-copy-replay]').click();

    // Reachable "another way too" regardless of whether the browser's clipboard permission allowed the
    // write (tech-lead note 6) — the textarea is populated either way.
    const json = await page.locator('[data-tuning-replay-json]').inputValue();
    const replay = JSON.parse(json);
    expect(typeof replay.seed).toBe('number');
    expect(Array.isArray(replay.inputs)).toBe(true);
    expect(replay.inputs.some((/** @type {any} */ i) => i.dir === 'UP' && i.player === 'p1')).toBe(
      true,
    );
    expect(Array.isArray(replay.expectedEvents)).toBe(true);
    expect(replay.expectedEvents.length).toBeGreaterThan(0);

    // The failure/success message must be visible, never silent (tech-lead note 6).
    const status = await page.locator('[data-tuning-copy-status]').textContent();
    expect(status?.trim().length).toBeGreaterThan(0);
  });
});
