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
 * **`#82` is fixed as of KS-06-00, and the note that used to stand here is reversed.** When this file was
 * written Esc on PAUSE did nothing — `TRANSITIONS[PAUSE]` had no `BACK` row and `pause.js` wired no `onBack`
 * — and the Sprint 05 tech-lead notes said not to write a test asserting otherwise, because it would have
 * papered over a real bug. The design lead has since ruled that Esc is "back" on every screen
 * (`ARCHITECTURE §8`) and that back out of PAUSE is back into the round, through the same READY? beat
 * (`DESIGN-DECISIONS §2.8`). So the behaviour is now asserted, in the last test below.
 *
 * One thing this file still does not test:
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
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );

    // RESUME is the default-focused row (index 0) — the same key a player would press.
    await page.keyboard.press('Enter');

    // READY? for one wall second (`DESIGN-DECISIONS §2.8`), then back to PLAYING with no grey screen up.
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );
  });

  test('KS-05-05 AC: QUIT TO MENU from PAUSE returns to MAIN_MENU and clears the match', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    // RESUME (0) -> RESTART MATCH (1) -> QUIT TO MENU (2), `pause.js`'s row order.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );
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
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));
      return /** @type {any} */ (globalThis).__kobi.getSnapshot().tick;
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );

    // Nothing to poll for while hidden — the point is that nothing happens — so waiting on the wall clock is
    // safe here for the same reason KS-05-03 AC3's pause test gives: a hidden tab's frame loop schedules no
    // frames at all, so there is nothing for real time to advance.
    await page.waitForTimeout(400);
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getSnapshot().tick),
    ).toBe(hiddenTick);
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );

    // The tab comes back. `loop.js` fires `onAutoPause` on the very next real frame, before advancing
    // anything, so the game lands on PAUSE rather than quietly carrying on from where it was frozen
    // (`DESIGN-DECISIONS §2.8`, `QA-STRATEGY §8`: "Tab away and back; game is paused, timer did not
    // advance."). That next real frame is genuine browser time, not something `fastForward` can stand in
    // for, so this waits for it with an auto-retrying assertion rather than a fixed sleep.
    await page.evaluate(() => {
      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => false });
      doc.dispatchEvent(new /** @type {any} */ (globalThis).Event('visibilitychange'));
    });

    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );
    // And simulated time was not stolen or advanced by any of this — the round is exactly where it was.
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getSnapshot().tick),
    ).toBe(hiddenTick);
  });
});

test.describe('KS-06-00 Esc resumes from the pause screen (#82)', () => {
  test('KS-06-00 AC1: Esc on PAUSE plays the READY? beat and lands back in PLAYING', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );

    // The same key that opened it. `ARCHITECTURE §8`: Esc is "back" on every screen, and back out of the
    // pause screen is back into the round — the design lead's ruling on #82.
    await page.keyboard.press('Escape');

    // Identical to what the RESUME item does: one wall second of READY? with the round still frozen, then
    // PLAYING with no screen up. Asserted here rather than assumed equal to the RESUME path, because "the
    // same handler" is exactly the claim being tested.
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );
  });

  test('KS-06-00 AC1: Esc, resume, Esc again — the round is still there and still running', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    for (let round = 0; round < 2; round += 1) {
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
      // The READY? beat has to finish before the next Esc means anything: `session.js` ignores a BACK while
      // `readyRemaining > 0`, which is the "Esc through the READY? beat does not re-open the pause screen"
      // rule KS-05-03 already tests. Waiting for the beat's own screen to go is how a player experiences it.
      await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    }

    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );
    const tick = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.tick);
    expect(tick).toBeGreaterThan(0);
  });
});

test.describe('KS-07-00 Space pauses and resumes exactly like Esc (#103)', () => {
  test('KS-07-00 AC3: Space during PLAYING opens PAUSE, and Space on PAUSE plays the READY? beat back into PLAYING', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();

    await page.keyboard.press('Space');

    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );

    // The same key that opened it, and the same beat the RESUME item and Esc both play — `DESIGN-DECISIONS
    // §2.8`: "Space behaves exactly like Esc for pausing... goes through the same READY? beat".
    await page.keyboard.press('Space');

    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );
  });

  test('KS-07-00 AC3: Space and Esc are interchangeable — pause with one, resume with the other', async ({
    page,
  }) => {
    // "Exactly like Esc" is a claim about one behaviour reached two ways, not two behaviours that happen to
    // look alike, so the strongest test of it mixes the keys rather than repeating each on its own.
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    await page.keyboard.press('Space');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();

    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PLAYING',
    );
  });

  test('KS-07-00 AC3: Space does nothing on MAIN_MENU or MATCH_SETUP', async ({ page }) => {
    // `§2.8`: "Space has no other meaning anywhere (Enter remains select on menus; Space on a menu does
    // nothing)". The failure this guards against is Space arriving as CONFIRM — which on MAIN_MENU would
    // start a match — or as BACK, which on MATCH_SETUP would leave the screen.
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MAIN_MENU',
    );

    // Onto MATCH_SETUP with the key that does work there, then the same check.
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();

    const before = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.getMatchSettings(),
    );
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');

    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_SETUP',
    );
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings()),
    ).toEqual(before);
  });

  test('KS-07-00 AC3: a held Space does not repeat-toggle the pause screen', async ({ page }) => {
    // A browser re-fires `keydown` with `repeat: true` while a key is held. Without `input.js`'s repeat
    // guard that is pause/resume/pause/resume at the auto-repeat rate.
    //
    // The repeats are dispatched rather than produced by `page.keyboard.down`, because **Playwright's
    // `down()` does not auto-repeat**: with the guard deliberately bypassed for Space, a `down()` +
    // 600 ms + `up()` version of this test still passed while the unit test failed. A test that cannot
    // fail is worse than no test, so this sends the event the browser would actually send, through the
    // same real listener `page.keyboard.press` reaches.
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    await page.keyboard.press('Space');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    await page.evaluate(() => {
      const g = /** @type {any} */ (globalThis);
      for (let i = 0; i < 8; i += 1) {
        g.window.dispatchEvent(
          new g.KeyboardEvent('keydown', { code: 'Space', repeat: true, cancelable: true }),
        );
      }
    });

    // Eight repeats is an even number: were the guard missing, this would have toggled back to PAUSE and
    // read as a pass. What proves it is the state *between* — so assert the screen never left, by checking
    // that no READY? beat was ever played and the simulation is still frozen where the pause left it.
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );

    const tick = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.tick);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.tick)).toBe(tick);
  });
});
