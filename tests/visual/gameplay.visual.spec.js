// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-03-07 scenario (e): visual baselines of a round in progress, at t=0 and t=5 s, with `?seed=1&reducedFx=1`
 * (QA-STRATEGY §1). `tests/visual/smoke.visual.spec.js` (KS-03-05) already owns the idle "PRESS ENTER" screen
 * baseline (`first-playable-idle.png`) — this file's job is the two moments *inside* a round, which is new
 * ground: the arena with both snakes moving, apples on the board, the HUD showing a live timer and lengths.
 *
 * A no-input round is already over by t=5 s (both snakes hit opposite walls at t≈3.167 s, the golden log's
 * own timing — `tests/unit/core/round.test.js`), so an untouched t=5 baseline would just be a second picture
 * of the round-over overlay. `gameplay-t5.png` steers both snakes instead, so it shows what the ticket's own
 * wording asks for: gameplay, not an overlay.
 *
 * The steering is a simple bent path for each snake — three sides of six grid steps, then a longer fourth
 * side, then one last turn just two steps before t=5 s — chosen so neither snake ever nears a wall or the
 * other snake, and so the frame at t=5 s catches each snake just after its last turn, corner segment still
 * in the body (`09-snake-turning-animation.png`'s bend), rather than long since straightened out. P1 stays
 * inside x:[5,11] y:[8,18]; P2 stays inside x:[12,18] y:[5,15] — adjacent, never overlapping.
 *
 * Every `pressKey`/`fastForward` pair happens inside one `page.evaluate()` call, for the same reason
 * `first-playable.spec.js`'s module doc comment explains: the background frame loop must never get a chance
 * to advance the sim between a scripted press and the fast-forward that is meant to follow it.
 *
 * Each phase boundary below is an *absolute* tick count from round start (120 ticks per grid step at the
 * base speed of 6 cells/s), not "6 more steps from here" — an earlier version of this file used the latter
 * and was genuinely flaky (run 3 times in a row, it failed roughly one time in three). The cause was the same
 * `Enter`-to-`evaluate()` gap `first-playable.spec.js`'s AC2 test accounts for: the background loop can carry
 * the still-unsteered snakes a step or more past round start before this script's first line ever runs, and
 * "6 more steps" on top of that lands one whole cell further along than "6 more steps" on top of zero would
 * — different enough, over 30 steps, to occasionally cross a different apple's cell and change the picture.
 * Reading `sim.tick` fresh before every phase and asking for exactly the ticks needed to reach the next
 * *absolute* target erases that gap instead of accumulating it, the same fix scenario (a) and
 * `interpolation.spec.js` use for the same underlying reason.
 *
 * One more thing has to happen inside that same script, and it is the reason this file exists as its own
 * finding rather than a two-line addition: `page.expect(page).toHaveScreenshot()` does its own real
 * wall-clock stability wait before it captures anything (Playwright renders a few frames apart and compares
 * them), and the round keeps running in real time the entire while it does — `loop.js` never stops on its
 * own just because a test finished calling `fastForward`. Left alone, that stability wait is easily long
 * enough for a live round to run right past the position this script just set up, in the worst case all the
 * way to a crash (that is exactly what an early, unfrozen version of this file captured: both baselines
 * showing the same "DRAW — PRESS ENTER" overlay, because by the time the screenshot was actually taken the
 * background loop had carried the *unsteered* golden no-input log all the way to its own ~3.167 s wall crash
 * while Playwright was still stabilising the frame). The fix reuses scenario (c)'s own mechanism rather than
 * inventing a new one: dispatching a fake `visibilitychange` with `document.hidden` overridden to `true`
 * makes `loop.js` cancel its pending frame and stop scheduling new ones (`ARCHITECTURE §5`'s "a hidden tab
 * stops requesting frames outright"), which freezes the canvas at exactly the frame this script's last
 * `fastForward` drew, for however long the screenshot then takes to settle.
 */

test.describe('KS-03-07 visual', () => {
  test('KS-03-07 scenario (e): gameplay baseline at t=0', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.keyboard.press('Enter');
    await expect(page.locator('.overlay')).toBeHidden();

    // One deliberate render of whatever the just-started round looks like, through the same `fastForward`
    // path every other scripted moment in this suite uses rather than trusting a background frame to have
    // drawn one already — then freeze the loop in the same script, before the screenshot's own stability
    // wait gives the still-running background loop a chance to carry the round past this moment (see the
    // module doc comment).
    await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(0);

      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new (/** @type {any} */ (globalThis).Event)('visibilitychange'));
    });

    await expect(page).toHaveScreenshot('gameplay-t0.png');
  });

  test('KS-03-07 scenario (e): gameplay baseline at t=5s, both snakes steered and alive', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.keyboard.press('Enter');
    await expect(page.locator('.overlay')).toBeHidden();

    // The steering, the freeze and the snapshot read all happen in this one script — not split across
    // separate `evaluate()` calls — for the same reason the module doc comment gives for the freeze itself:
    // any gap here is a gap the background loop could use to advance the sim before it is frozen.
    const snapshot = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const simHz = kobi.sim.settings.simHz;

      /** Fast-forwards from wherever `sim.tick` is right now to the given *absolute* tick count. */
      const advanceToTick = (/** @type {number} */ targetTick) => {
        kobi.fastForward(Math.max(0, targetTick - kobi.sim.tick) / simHz);
      };

      // Phase boundaries as absolute ticks from round start (120 per grid step): 6, 6, 6, 10 and 2 more
      // steps — a bent path for each snake, landing just 2 steps past the last turn (module doc comment).
      advanceToTick(120); // P1 RIGHT x6 (its spawn direction), P2 LEFT x6 (its spawn direction)
      kobi.pressKey(1, 'UP');
      kobi.pressKey(2, 'DOWN');
      advanceToTick(240); // P1 UP x6, P2 DOWN x6
      kobi.pressKey(1, 'LEFT');
      kobi.pressKey(2, 'RIGHT');
      advanceToTick(360); // P1 LEFT x6, P2 RIGHT x6
      kobi.pressKey(1, 'DOWN');
      kobi.pressKey(2, 'UP');
      advanceToTick(560); // P1 DOWN x10, P2 UP x10 (a longer fourth side)
      kobi.pressKey(1, 'RIGHT');
      kobi.pressKey(2, 'LEFT');
      advanceToTick(600); // P1 RIGHT x2, P2 LEFT x2 — 30 steps, 5.0 simulated seconds

      const doc = /** @type {any} */ (globalThis).document;
      Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
      doc.dispatchEvent(new (/** @type {any} */ (globalThis).Event)('visibilitychange'));

      return kobi.getSnapshot();
    });

    // Both must still be alive for this to be the "gameplay" baseline the ticket asks for, not a crash.
    for (const snake of /** @type {any} */ (snapshot).snakes) {
      expect(snake.alive).toBe(true);
    }

    await expect(page).toHaveScreenshot('gameplay-t5.png');
  });
});
