// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-05-05: pause, resume, quit, and auto-pause on a hidden tab (`DESIGN-DECISIONS §2.8`).
 *
 * `match-flow.spec.js`'s KS-05-03 AC3 already proves pause/resume through `__kobi.pause()`/`resume()` and the
 * timer freeze that is the point of that ticket. This file proves the rest of `§2.8` — the same beats driven
 * through the *real* keyboard and the real PAUSE screen's menu items instead of the test hooks, plus the one
 * thing AC3 does not touch: a hidden tab.
 *
 * Two known, filed things this file deliberately does not test around:
 * - **Esc on PAUSE does nothing** (`pause.js`: no `onBack` is wired to its focus model at all, and
 *   `gameStateMachine.js`'s `TRANSITIONS[PAUSE]` has no `BACK` row). This is `#82`, and the tech-lead notes
 *   say plainly not to write a test asserting Esc resumes it — it does not, and that is the known bug the
 *   issue tracks, not a design intention this suite should paper over.
 * - **RESTART MATCH** (`PAUSE`'s middle row, `REMATCH` under the hood) is not exercised here; `REMATCH`'s
 *   settings-preserving behaviour is already proven from `MATCH_OVER` in `match-flow.spec.js`, and testing
 *   the identical event twice from two different rows would not prove anything new.
 *
 * Reaching a round (`startMatchInPage`) stays inside one `page.evaluate()` for the reason
 * `first-playable.spec.js`'s module comment explains; once a spec only cares which screen is showing rather
 * than a precise simulated tick, a real `page.keyboard.press()` between two evaluations is safe, because
 * none of PAUSE/MAIN_MENU ever advance on their own (`session.js`'s `runUpdate`, default case: "nothing
 * ticks").
 */

test.describe('KS-05-05 pause, resume, quit', () => {
  test('KS-05-05 AC: Esc opens PAUSE for real, and Enter on RESUME (its default-focused row) plays the READY? beat back into PLAYING', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PAUSE');

    // RESUME is the default-focused row (index 0) — the same key a player would press.
    await page.keyboard.press('Enter');

    // READY? for one wall second (`DESIGN-DECISIONS §2.8`), then back to PLAYING with no grey screen up.
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PLAYING');
  });

  test('KS-05-05 AC: QUIT TO MENU from PAUSE returns to MAIN_MENU and clears the match', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    // RESUME (0) -> RESTART MATCH (1) -> QUIT TO MENU (2), `pause.js`'s row order.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('MAIN_MENU');
    // `session.js`'s `showMainMenu` nulls both the round and the match on the way in — quitting mid-match
    // must not leave a stale match tally behind for the next `startMatch` to inherit.
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatch())).toBeNull();
  });

  test('KS-05-05 AC: a hidden tab freezes simulated time, and coming back auto-pauses instead of resuming silently', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    // Fake the tab going away, in the same script that started the match — no real frame gets a chance to
    // run between the two, so the tick read back below is the exact one the freeze below applies to.
    // `loop.js` stops scheduling any further real frame while `document.hidden` reads true; this is a
    // stronger freeze than `__kobi.pause()` here, and unlike that test hook it is the actual mechanism
    // `DESIGN-DECISIONS §2.8` describes ("losing window focus pauses automatically") for a backgrounded tab,
    // not a state-machine shortcut.
    const hiddenTick = await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new (/** @type {any} */ (globalThis).Event)('visibilitychange'));
      return /** @type {any} */ (globalThis).__kobi.getSnapshot().tick;
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PLAYING');

    // Nothing to poll for while hidden — the point is that nothing happens — so waiting on the wall clock is
    // safe here for the same reason KS-05-03 AC3's pause test gives: a hidden tab's frame loop schedules no
    // frames at all, so there is nothing for real time to advance.
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getSnapshot().tick)).toBe(
      hiddenTick,
    );
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PLAYING');

    // The tab comes back. `loop.js` fires `onAutoPause` on the very next real frame, before advancing
    // anything, so the game lands on PAUSE rather than quietly carrying on from where it was frozen
    // (`DESIGN-DECISIONS §2.8`, `QA-STRATEGY §8`: "Tab away and back; game is paused, timer did not
    // advance."). That next real frame is genuine browser time, not something `fastForward` can stand in
    // for, so this waits for it with an auto-retrying assertion rather than a fixed sleep.
    await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => false });
      doc.dispatchEvent(new (/** @type {any} */ (globalThis).Event)('visibilitychange'));
    });

    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PAUSE');
    // And simulated time was not stolen or advanced by any of this — the round is exactly where it was.
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getSnapshot().tick)).toBe(
      hiddenTick,
    );
  });
});
