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
 * `interpolation.spec.js` use for the same underlying reason. `advanceToTick`'s division is safe here for
 * the same reason it is safe in those two — a real leftover fraction in the browser's own accumulator, not
 * the zero-starting-point that makes the *Node-side* replay in `first-playable.spec.js`'s AC2 test need a
 * whole-tick loop instead (see that file's module doc comment) — so do not "fix" this one to match that one.
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
 * inventing a new one: the game is put into its real PAUSE state, which sets `loop.timeScale` to 0 and
 * freezes the canvas at exactly the frame this script's last `fastForward` drew, for however long the
 * screenshot then takes to settle.
 *
 * **KS-05-03 changed how that freeze is spelled, and when it happens.** Until Sprint 05 these scripts faked a
 * `visibilitychange` with `document.hidden` overridden to `true`, leaning on `loop.js`'s hidden-tab
 * behaviour; the game now has a real PAUSE state that means exactly "freeze this round", and
 * `__kobi.pause()` is the supported way to reach it. Because a paused round cannot be fast-forwarded (that
 * is the point of it), the freeze moved from the start of each script to the end — which costs nothing, since
 * a whole script is synchronous and no frame can land inside one anyway. The PAUSE panel is hidden before the
 * screenshot, the same way `laser.visual.spec.js` hides `.hud` for its own baselines: these two baselines are
 * pictures of gameplay, and the pause screen gets its own in `tests/visual/screens.visual.spec.js`.
 */

/**
 * Starts a round and stops the frame loop **in one synchronous step inside the page**, then draws exactly one
 * frame. Returns the simulation tick that frame shows, which is always `0`.
 *
 * This exists because a baseline captured after `page.keyboard.press('Enter')` is not reproducible. That
 * keypress and the `page.evaluate()` that follows it are two separate round-trips to the browser, and the
 * game's frame loop keeps advancing the simulation in real time in between — so the frame a screenshot
 * catches depends on how long that gap happened to be on that machine, on that run. Measured here, the gap
 * ranged from **85 to 134 ticks** (0.7 s to 1.1 s of simulated time) across four runs on one machine, and a
 * baseline approved at one end of that range differs from the other end by **1 % of all pixels** — five times
 * the 0.2 % budget of `QA-STRATEGY §1`. That is what turned `main` red after KS-03-07 merged, having passed
 * on the same commit's pull-request run.
 *
 * Starting the round from inside the page removes the gap entirely rather than trying to measure or
 * tolerate it: JavaScript is single-threaded, so no `requestAnimationFrame` callback can run between the
 * call that starts the match and the pause that freezes it. The round is therefore frozen at tick 0, every
 * time, on any machine.
 */
function startRoundAndFreeze() {
  const doc = /** @type {any} */ (globalThis).document;
  const kobi = /** @type {any} */ (globalThis).__kobi;

  // Main menu, match setup, and the four countdown beats of `DESIGN-DECISIONS §2.4`. The countdown runs on
  // wall time and the simulation does not run at all during it, so this leaves the round at tick 0.
  kobi.startMatch();
  // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
  // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
  // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
  // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);

  kobi.pause();
  kobi.fastForward(0);

  const pausePanel = doc.querySelector('[data-screen="PAUSE"]');
  if (pausePanel !== null) pausePanel.hidden = true;

  return kobi.sim.tick;
}

test.describe('KS-03-07 visual', () => {
  test('KS-03-07 scenario (e): gameplay baseline at t=0', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // The round is started from *inside* this script, not with a Playwright `keyboard.press` before it, and
    // that is the whole of what makes a t=0 baseline reproducible — see {@link startRoundAndFreeze}.
    const tick = await page.evaluate(startRoundAndFreeze);

    // t=0 means t=0. If this ever reads anything else, the frame below is not the picture this baseline was
    // approved as, and the test should say so rather than fail later as an unexplained pixel diff.
    expect(tick).toBe(0);

    await expect(page).toHaveScreenshot('gameplay-t0.png');
  });

  test('KS-03-07 scenario (e): gameplay baseline at t=5s, both snakes steered and alive', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // The round start, the steering, the freeze and the snapshot read all happen in this one script — not
    // split across separate `evaluate()` calls — for the same reason the module doc comment gives for the
    // freeze itself: any gap here is a gap the background loop could use to advance the sim before it is
    // frozen, and starting the round outside the script leaves the biggest gap of all (see
    // {@link startRoundAndFreeze}).
    const snapshot = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;

      // Start the round inside this script, so every absolute tick target below is measured from a real tick
      // 0 rather than from wherever a background frame happened to leave the sim.
      kobi.startMatch();
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      const simHz = kobi.sim.settings.simHz;

      /**
       * Fast-forwards from wherever `sim.tick` is right now to the given *absolute* tick count.
       *
       * The half-tick and the `tickAccumulator` term are what make this exact. `round.js` accumulates
       * `dt * simHz` and consumes whole ticks, so asking for exactly `n / simHz` seconds can land at
       * `n - 1e-14` ticks and leave the round one tick short — 40/120 seconds is 39.99999999999999 ticks, not
       * 40. Before KS-05-03 this file got away with the naive division because real frames had already left
       * an arbitrary fraction in the accumulator by the time the script ran; now the round starts inside the
       * script with the accumulator at exactly 0, which is precisely the unlucky case. Asking for half a tick
       * more than is needed, minus whatever the accumulator already holds, lands on the target every time and
       * leaves the accumulator at a steady half tick rather than drifting upward call by call.
       */
      const advanceToTick = (/** @type {number} */ targetTick) => {
        const needed = Math.max(0, targetTick - kobi.sim.tick);
        kobi.fastForward((needed + 0.5 - kobi.sim.tickAccumulator) / simHz);
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

      // Freeze last, not first: a paused round cannot be fast-forwarded (see the module doc comment).
      kobi.pause();
      kobi.fastForward(0);
      const pausePanel = doc.querySelector('[data-screen="PAUSE"]');
      if (pausePanel !== null) pausePanel.hidden = true;

      return kobi.getSnapshot();
    });

    // Exactly 5.0 simulated seconds, every run — not "about five seconds, wherever the loop had got to".
    expect(/** @type {any} */ (snapshot).tick).toBe(600);
    // Both must still be alive for this to be the "gameplay" baseline the ticket asks for, not a crash.
    for (const snake of /** @type {any} */ (snapshot).snakes) {
      expect(snake.alive).toBe(true);
    }

    await expect(page).toHaveScreenshot('gameplay-t5.png');
  });
});
