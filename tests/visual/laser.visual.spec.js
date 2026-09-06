// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-04-02 AC1: visual baselines of the safe square at the ticket's own four moments — `t = 30, 24, 10, 3`
 * seconds remaining — matching `05-laser-closing-phase.png` (the `t = 30` warning) and
 * `06-final-shrink-showdown.png` (deep in the endgame).
 *
 * These frames have to be internally consistent, not just show the right safe square: `06-final-shrink-
 * showdown.png` is the one image everyone reviewing this ticket will hold a baseline next to, and it shows
 * both snakes *inside* the small square with the outer tiles darkened and swept clean. A baseline that got
 * the beams right but left the snakes standing on darkened dead-zone tiles — where a real round would have
 * killed them seconds earlier — would contradict the one thing that reference image is famous for (tech-lead
 * review of an earlier version of this file, on PR #71).
 *
 * The fix does not need 80+ simulated seconds of a laser-aware bot actually surviving to these moments (that
 * is `KS-04-04`'s `survivorBot`, and a different ticket's job) — it needs the *board* to already be in a
 * state a survived round would be in, then a single ordinary `advance()` through `RoundSimulation`'s own tick
 * loop to let the sim itself do the rest:
 *
 * 1. Place both snakes' `segments`/`previousSegments` inside the **final** 6×6 square (`x, y ∈ [9, 15)`).
 *    That square is inside every earlier, larger safe square too, so one placement is inside the safe region
 *    at all four checkpoints — the snakes never need to move to stay legal.
 * 2. Set `sim.tick` directly to 12 ticks short of the target `timeRemaining`, then `fastForward(0.1)`.
 *    `0.1 s` is exactly 12 ticks at `simHz` 120, and a grid step needs `simHz / snakeSpeed` = 20 ticks, so
 *    neither snake actually steps — only `stepProgress` advances, which is harmless since `segments` and
 *    `previousSegments` are identical. `core/lasers.js`'s schedule is derived from the clock on every call,
 *    not counted, so this one `advance()` fires every `LASER_STEP` between wherever the clock was and the
 *    target, in order, exactly as a real round crossing the same span would. Because it runs through
 *    `round.js`'s own `updateLasers()` rather than poking `sim.lasers` directly, `sweepDeadZone()` and
 *    `refillFood()` run for real on each of those steps: apples the beam swept over are removed and
 *    respawned inside the safe square, and `killHeadsInDeadZone()` runs too (and never fires, since the
 *    snakes are already inside every safe square it will ever check against). `0.1 s` is also
 *    `session.js`'s own HUD throttle interval, so the timer text catches up to the right value in the same
 *    step.
 *
 * `?reducedFx=1` (`DEFAULT_QUERY`) is what makes the laser geometry itself safe to screenshot immediately:
 * `laserView.js` skips its 0.3 s glide entirely under reduced effects and snaps straight to the sim's own
 * inset, so there is no timing race between the catch-up above and capturing the frame.
 *
 * **The HUD is hidden before every screenshot (tech-lead review of an earlier version of this file, after
 * KS-04-03 merged).** KS-04-03 puts the "LASERS CLOSING!" banner up on `LASER_WARNING` and expires it 5 s
 * later on the HUD's own real-time countdown — but the catch-up above jumps `sim.tick` straight to a moment
 * up to 27 simulated seconds after the warning, in one `advance(0.1)`. The warning fires inside that single
 * call regardless, so every checkpoint's banner "just happened" and is still on screen when the frame is
 * captured — including the `t = 3` frame, where a design reviewer holding it next to `06-final-shrink-
 * showdown.png` would see a fresh 0:30 banner over the final 6×6. That is an artefact of how this file
 * reaches the moment, not something `laserView.js`/`arenaView.js` did wrong, and dressing it — hiding only
 * the banner element, or forcing the HUD's internal timer past the warning — would still be showing a HUD
 * state no real clock produces at these checkpoints. A visual baseline should pin one subsystem: these four
 * are about beams, emitters, arrows and dead-zone darkening, not the HUD (which is KS-04-03's own ticket,
 * has its own real-clock browser proof in `tests/e2e/laser-warning-banner.spec.js`, and is wholly restyled in
 * Sprint 11 — coupling these baselines to it would fail all four on an unrelated CSS change). So the whole
 * `.hud` element is hidden, not faked, before the screenshot.
 */

/**
 * Starts a round, freezes the frame loop, places both snakes inside the final safe square and catches the
 * simulation up to `timeRemaining` seconds left — see the module doc comment for why each step is safe and
 * deterministic. Duplicated from nothing: `page.evaluate` callbacks are serialised by Playwright and cannot
 * close over a helper from this module (`tests/e2e/test-hooks.spec.js`'s own note on the same constraint).
 *
 * @param {number} timeRemaining - seconds left to catch the round up to
 * @returns {{phase: string, inset: number}} the laser state actually drawn, read back after the catch-up
 */
function startFrozenRoundAtLaserState(timeRemaining) {
  const win = /** @type {any} */ (globalThis);
  const doc = /** @type {any} */ (globalThis).document;
  const kobi = win.__kobi;

  win.dispatchEvent(
    new win.KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }),
  );
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => true });
  doc.dispatchEvent(new win.Event('visibilitychange'));
  kobi.fastForward(0); // one frame at tick 0, loop now stopped (`ARCHITECTURE §5`: a hidden tab stops it).

  const sim = kobi.sim;

  // Both inside x, y ∈ [9, 15) — the final 6×6 square (`laserMinArena`) — so they are inside the safe region
  // at every one of this ticket's four checkpoints, not just the deepest one.
  const p1Cells = [
    { x: 12, y: 11 },
    { x: 11, y: 11 },
    { x: 10, y: 11 },
    { x: 9, y: 11 },
  ];
  const p2Cells = [
    { x: 9, y: 13 },
    { x: 10, y: 13 },
    { x: 11, y: 13 },
    { x: 12, y: 13 },
  ];
  sim.snakes[0].segments = p1Cells.map((cell) => ({ ...cell }));
  sim.snakes[0].previousSegments = p1Cells.map((cell) => ({ ...cell }));
  sim.snakes[0].direction = { dx: 1, dy: 0 };
  sim.snakes[1].segments = p2Cells.map((cell) => ({ ...cell }));
  sim.snakes[1].previousSegments = p2Cells.map((cell) => ({ ...cell }));
  sim.snakes[1].direction = { dx: -1, dy: 0 };

  // 12 ticks short of the target; `fastForward(0.1)` below is exactly 12 ticks at `simHz` 120, one grid step
  // short of the 20 a step at `snakeSpeed` 6 needs, so neither snake moves from where it was just placed.
  sim.tick = Math.round((sim.settings.roundDuration - timeRemaining) * sim.settings.simHz) - 12;
  kobi.fastForward(0.1); // one ordinary advance: fires every due LASER_STEP, sweeps/refills food, writes the HUD.

  // Hide the whole HUD, not just the KS-04-03 warning banner it carries — see the module doc comment for why
  // these four frames pin the laser/dead-zone view alone rather than also being a HUD baseline.
  doc.querySelector('.hud').style.display = 'none';

  return kobi.getSnapshot().lasers;
}

/** The ticket's own four moments, and the safe square `core/lasers.js`'s schedule puts them at. */
const CHECKPOINTS = [
  { timeRemaining: 30, phase: 'WARNING', inset: 0, label: 'laser-t30-warning' },
  { timeRemaining: 24, phase: 'CLOSING', inset: 1, label: 'laser-t24-closing' },
  { timeRemaining: 10, phase: 'CLOSING', inset: 7, label: 'laser-t10-closing' },
  { timeRemaining: 3, phase: 'STOPPED', inset: 9, label: 'laser-t3-stopped' },
];

test.describe('KS-04-02 laser visual baselines', () => {
  for (const checkpoint of CHECKPOINTS) {
    test(`KS-04-02 AC1: the safe square at t=${checkpoint.timeRemaining}s remaining matches the sim`, async ({
      page,
    }) => {
      await page.goto(DEFAULT_QUERY);

      const lasers = await page.evaluate(startFrozenRoundAtLaserState, checkpoint.timeRemaining);

      expect(lasers.phase).toBe(checkpoint.phase);
      expect(lasers.inset).toBe(checkpoint.inset);

      await expect(page).toHaveScreenshot(`${checkpoint.label}.png`);
    });
  }
});
