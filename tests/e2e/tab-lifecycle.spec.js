// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KI-06-03 — the rest of the tab lifecycle beyond the hidden-tab freeze `pause.spec.js`'s own
 * `KS-05-05 AC` test already proves.
 *
 * `visibilitychange` is not the only way a browser tells a page it is going away: a tab the browser
 * suspends outright fires `freeze` (and `resume` coming back) on `document`, and a tab torn down for a real
 * navigation or restored from the back/forward cache fires `pagehide` (and `pageshow` coming back) on
 * `window` — either can arrive without `visibilitychange` ever firing. There is no API to genuinely suspend
 * a real tab from a test, so — exactly as `pause.spec.js`'s own hidden-tab test fabricates `hidden` — these
 * dispatch the bare events at the real targets `loop.js` listens on and read back what the round did.
 *
 * **Everything is observed from inside the event itself**, the same discipline `resilience.spec.js`'s own
 * module comment gives for `webglcontextlost`/`restored`: the live frame loop is running in a real browser
 * for as long as the tab is neither hidden nor suspended, so a tick read "just before" firing an event, in a
 * separate `page.evaluate` round trip, is racing that live loop — the round trip itself costs real wall time,
 * and an unsuspended loop spends every millisecond of it. Each helper below therefore dispatches the event
 * and reads `getState()`/`getSnapshot()` back in the *same* synchronous script, which is the only reading
 * "the instant the event was handled" can honestly mean. A tick read before firing the event is used only as
 * a loose `toBeGreaterThanOrEqual` lower bound, never for exact equality across a round trip.
 *
 * The one wait that is not racing anything is the `waitForTimeout` inside each "prove nothing happens" block:
 * a suspended loop schedules no frames at all, so there is nothing for real time to advance, which is the
 * identical justification `pause.spec.js`'s own hidden-tab test gives its one wait.
 */

/**
 * Reaches a running round and lets the live loop carry it a little further, so later "unchanged" readings
 * mean something.
 *
 * @param {import('@playwright/test').Page} page
 */
async function startRoundAndAdvance(page) {
  await page.goto(DEFAULT_QUERY);
  expect(await page.evaluate(startMatchInPage)).toBe('PLAYING');
  await page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    for (let i = 0; i < 30; i += 1) w.__kobi.advance(1 / 60);
  });
}

/**
 * Fires one lifecycle event at the real target it belongs on and reports what the game looked like the
 * instant handling it finished — synchronously, in the same script that dispatched it, so no live frame can
 * slip in between (see this file's own module comment).
 *
 * @param {import('@playwright/test').Page} page
 * @param {'document' | 'window'} target
 * @param {string} type
 * @returns {Promise<{state: string, tick: number | null}>}
 */
function fireLifecycleEvent(page, target, type) {
  return page.evaluate(
    ({ target, type }) => {
      const w = /** @type {any} */ (globalThis);
      const eventTarget = target === 'document' ? w.document : w.window;
      eventTarget.dispatchEvent(new w.Event(type));
      return {
        state: w.__kobi.getState(),
        tick: w.__kobi.getSnapshot()?.tick ?? null,
      };
    },
    { target, type },
  );
}

/** The current tick and state, read in their own script (no event fired). @param {import('@playwright/test').Page} page */
function readSnapshot(page) {
  return page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    return { state: w.__kobi.getState(), tick: w.__kobi.getSnapshot()?.tick ?? null };
  });
}

test.describe('KI-06-03 tab lifecycle', () => {
  test('KI-06-03 AC1: freeze suspends the round, and resume auto-pauses instead of resuming silently', async ({
    page,
  }) => {
    await startRoundAndAdvance(page);

    // `document` — `freeze`/`resume` are the Page Lifecycle API's own pair, delivered to `document`
    // (`loop.js`'s own `documentLifecycleSource`; ESLint's `no-undef` forces `globalThis`).
    const atFreeze = await fireLifecycleEvent(page, 'document', 'freeze');
    expect(atFreeze.state).toBe('PLAYING');
    expect(atFreeze.tick).toBeGreaterThanOrEqual(0);

    // Ten simulated minutes' worth of real wait would be absurd; 400 ms of real wall time with nothing
    // scheduled is the same proof `pause.spec.js`'s hidden-tab test already relies on — there is nothing for
    // real time to advance regardless of how long it runs.
    await page.waitForTimeout(400);
    expect(await readSnapshot(page)).toEqual({ state: 'PLAYING', tick: atFreeze.tick });

    const atResume = await fireLifecycleEvent(page, 'document', 'resume');
    // Firing the event alone runs no frame — `resume()`'s own reset only takes effect on the next real one —
    // so nothing has moved yet, synchronously.
    expect(atResume.tick).toBe(atFreeze.tick);

    // The same auto-pause a hidden tab coming back already lands on (`pause.spec.js`'s own test): the round
    // is not silently picked back up, and it is exactly the tick it stopped on. `expect(...).toBeVisible()`
    // auto-retries, which is what waits for that next real frame to actually arrive.
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await readSnapshot(page)).toEqual({ state: 'PAUSE', tick: atFreeze.tick });
  });

  test('KI-06-03 AC1: pagehide suspends the round the same way, and pageshow auto-pauses too', async ({
    page,
  }) => {
    await startRoundAndAdvance(page);

    // `window` — `pagehide`/`pageshow` fire there, the other real target `loop.js` listens on
    // (`windowLifecycleSource`): a real navigation away, or a restore from the back/forward cache.
    const atHide = await fireLifecycleEvent(page, 'window', 'pagehide');
    expect(atHide.state).toBe('PLAYING');

    await page.waitForTimeout(400);
    expect(await readSnapshot(page)).toEqual({ state: 'PLAYING', tick: atHide.tick });

    const atShow = await fireLifecycleEvent(page, 'window', 'pageshow');
    expect(atShow.tick).toBe(atHide.tick);

    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await readSnapshot(page)).toEqual({ state: 'PAUSE', tick: atHide.tick });
  });

  test('KI-06-03: a hidden-and-then-suspended tab does not un-hide itself on pageshow', async ({
    page,
  }) => {
    await startRoundAndAdvance(page);

    // Hidden first, the way a background tab genuinely goes — then suspended on top of it, the way a
    // browser reclaiming memory from that same tab would. One script, so the reading below is exact.
    const atSuspend = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => true });
      w.document.dispatchEvent(new w.Event('visibilitychange'));
      w.window.dispatchEvent(new w.Event('pagehide'));
      return { state: w.__kobi.getState(), tick: w.__kobi.getSnapshot()?.tick ?? null };
    });
    expect(atSuspend.state).toBe('PLAYING');

    // The suspension alone ends; the tab is still hidden. A `pageshow` here must not be mistaken for the tab
    // coming back on screen — nothing may auto-pause yet, because nothing may render yet either.
    const atShow = await fireLifecycleEvent(page, 'window', 'pageshow');
    expect(atShow).toEqual({ state: 'PLAYING', tick: atSuspend.tick });

    await page.waitForTimeout(400);
    expect(await readSnapshot(page)).toEqual({ state: 'PLAYING', tick: atSuspend.tick });

    // Only the tab genuinely coming back on screen auto-pauses.
    await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => false });
      w.document.dispatchEvent(new w.Event('visibilitychange'));
    });
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();
    expect(await readSnapshot(page)).toEqual({ state: 'PAUSE', tick: atSuspend.tick });
  });
});
