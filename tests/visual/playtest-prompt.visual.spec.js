// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-11-02 AC4: one baseline of the `?playtest=1` between-round prompt, 1280×720, `?seed=1&reducedFx=1` —
 * `DEFAULT_QUERY` plus the flag itself, the same convention every other visual spec in this suite follows.
 *
 * The freeze is the same one, and for the same reason, as `tests/visual/screens.visual.spec.js`'s own
 * ROUND_OVER baseline: neither COUNTDOWN nor ROUND_OVER carries a `PAUSE` row, so `__kobi.pause()` cannot
 * reach either, and faking `document.hidden` is what actually stops `loop.js` from ever scheduling another
 * real frame. It is not load-bearing for the prompt itself — `session.js`'s `advanceScoreboard` already holds
 * the scoreboard's own 2.5 s clock still for as long as a gap is open (tech-lead note 3 on issue #161) — but
 * it keeps this spec honest with the rest of the file's own established practice, and the whole script stays
 * one `page.evaluate()` call for the same reason every other baseline here does (`screens.visual.spec.js`'s
 * module comment).
 *
 * A Best of 5 match, not the default Best of 3: two straight P2 wins would end a Bo3 match at round 2, before
 * `M1`/`M2` (`afterRound(3)`) are ever due.
 */

const PLAYTEST_QUERY = `${DEFAULT_QUERY}&playtest=1`;

test.describe('KI-11-02 the between-round prompt: visual', () => {
  test('AC4: the prompt matches its baseline', async ({ page }) => {
    await page.goto(PLAYTEST_QUERY);

    const state = await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));

      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 5 });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);

      /** P1 spawns at (5, 12) heading RIGHT; UP kills it on the top wall at 2.0 s (`DESIGN-DECISIONS §2.3`).
       * P2 is unsteered and does not reach its own wall until ≈ 3.167 s, so P1 dies alone every round. */
      function crashPlayerOne() {
        kobi.pressKey(1, 'UP');
        kobi.fastForward(3);
      }
      function playNextRoundCountdown() {
        for (let i = 0; i < 60 && kobi.getState() === 'ROUND_OVER'; i += 1) kobi.advance(0.1);
        for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
        kobi.fastForward(0);
      }

      crashPlayerOne(); // round 0 — M1-M4 not due yet (`afterRound(3)`)
      playNextRoundCountdown();
      crashPlayerOne(); // round 1 — still not due
      playNextRoundCountdown();
      crashPlayerOne(); // round 2 — M1 and M2 become due the instant this round is recorded

      return kobi.getState();
    });

    expect(state).toBe('ROUND_OVER');
    await expect(page.locator('[data-playtest-prompt]')).toBeVisible();
    await expect(page.locator('[data-playtest-question="M1"]')).toBeVisible();

    await expect(page).toHaveScreenshot('playtest-prompt.png');
  });
});
