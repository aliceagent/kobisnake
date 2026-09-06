// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-04-02 AC1: visual baselines of the safe square at the ticket's own four moments — `t = 30, 24, 10, 3`
 * seconds remaining — matching `05-laser-closing-phase.png` (the `t = 30` warning) and
 * `06-final-shrink-showdown.png` (deep in the endgame).
 *
 * Reaching `t = 10` and `t = 3` remaining needs a round that has genuinely run for 80-87 simulated seconds
 * with both snakes still alive and, by the end, squeezed into a 6×6 square — exactly the scenario
 * `KS-04-04`'s laser-aware `survivorBot` exists for, and well outside a grey-box *rendering* ticket's scope
 * (`tests/e2e/laser.spec.js`'s own module doc comment covers the two checkpoints a hand-steered patrol can
 * reach safely; `t = 10`/`t = 3` are not among them). Instead, every checkpoint here drives `sim.lasers`
 * directly to the target `timeRemaining` with `core/lasers.js`'s own public `update()` — the same method
 * `RoundSimulation.advance()` itself calls every tick, not a private field or a workaround — which reaches
 * the exact state a real round would eventually be in without needing to actually survive to it. What this
 * file is proving is AC1's own wording: "match the safe square from the sim" — the beams, the emitters and
 * the dead-zone darkening painting correctly for a given laser state — not whether two snakes can fairly
 * survive to it, which is a different ticket's job.
 *
 * `?reducedFx=1` (`DEFAULT_QUERY`) is what makes this safe to screenshot immediately: `laserView.js` skips
 * its 0.3 s glide entirely under reduced effects and snaps straight to the sim's own inset, so there is no
 * timing race between forcing the laser state and capturing the frame.
 */

/**
 * Starts a round, freezes the frame loop and draws exactly one frame — `tests/e2e/test-hooks.spec.js`'s own
 * `startRoundAndFreeze`, duplicated here because Playwright serialises `page.evaluate` callbacks and cannot
 * close over a helper from this module (that file's own note on why its helper is not exported either).
 *
 * @param {number} timeRemaining - seconds left to force the laser schedule to
 * @returns {{phase: string, inset: number}} the laser state actually drawn, read back after the forced render
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

  kobi.sim.lasers.update(timeRemaining);
  kobi.fastForward(0); // re-render with the forced laser state; `advance(0)` never ticks, so nothing else moves.

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
