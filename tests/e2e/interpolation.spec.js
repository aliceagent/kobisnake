// @ts-check
import { expect, test } from '@playwright/test';
import { cellToWorld } from '../../src/render/arenaView.js';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-03-04 AC1, proved through the real renderer rather than a hand-built snapshot.
 *
 * `tests/unit/render/snakeView.test.js` and `tests/unit/render/gameplayScene.test.js` already prove the lerp
 * math against `SnakeView`/`createGameplayScene` directly, in Node, without a browser. What is missing — and
 * what this file is for, per this ticket's `Files:` list — is the same proof through the actual production
 * path: a real WebGL canvas, the real camera, `renderer.getHeadWorldPosition` reading back the mesh matrix
 * three.js actually drew. `getHeadWorldPosition`'s own doc comment (`src/render/renderer.js`) says as much:
 * "this is what KS-03-04 AC1 measures interpolation against."
 *
 * Landing exactly on `stepProgress` 0.25/0.5/0.75 (the ticket's own wording) is done by reading the *live*
 * `stepProgress` the moment this script starts — not by assuming a fixed real-time offset lands there, which
 * the background frame loop (`ARCHITECTURE §5`) would make unreliable (see `first-playable.spec.js`'s module
 * doc comment for why) — and fast-forwarding by exactly enough simulation ticks to reach the target. A step
 * is 20 ticks at the base speed (`120 simHz / 6 cells-per-second`), so every multiple of 0.05 progress,
 * including 0.25/0.5/0.75, is landed on exactly rather than approximated.
 *
 * `deltaTicks / kobi.sim.settings.simHz` below is a division, not a whole-tick loop — safe here specifically
 * because by the time this script runs, real frames have already left an arbitrary fraction in the browser's
 * own accumulator, so losing a tick to binary-float rounding would need that leftover to be under ~1e-13
 * (essentially never true of a real elapsed-time fraction). `first-playable.spec.js`'s module doc comment
 * explains why the *Node-side* replay in its AC2 test cannot rely on the same safety margin and uses a
 * whole-tick loop instead — the two are not interchangeable.
 */

test.describe('KS-03-07 interpolation', () => {
  test('KS-03-04 AC1: the head world position matches the lerp of previous and current cell at stepProgress 0.25/0.5/0.75', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.keyboard.press('Enter');

    for (const target of [0.25, 0.5, 0.75]) {
      const result = await page.evaluate((targetProgress) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        const snake = kobi.sim.snakes[0];
        const ticksPerStep = kobi.sim.settings.simHz / (kobi.sim.settings.snakeSpeed * snake.speedMultiplier);

        // How many *more* ticks, from wherever the live snake's progress happens to be right now, land it
        // exactly on `targetProgress` within its current step. `+= ticksPerStep` when the target has already
        // been passed this step handles the general case; for this test's three ascending targets in one
        // straight step it never triggers, but it keeps the helper honest for any starting phase.
        const currentTicks = Math.round(snake.stepProgress * ticksPerStep);
        const targetTicks = Math.round(targetProgress * ticksPerStep);
        let deltaTicks = targetTicks - currentTicks;
        if (deltaTicks <= 0) deltaTicks += ticksPerStep;

        kobi.fastForward(deltaTicks / kobi.sim.settings.simHz);
        return { snapshot: kobi.getSnapshot(), worldPos: kobi.getHeadWorldPosition(1) };
      }, target);

      const p1 = /** @type {any} */ (result.snapshot).snakes[0];
      expect(p1.stepProgress).toBeCloseTo(target, 9);

      const from = p1.previousSegments[0];
      const to = p1.segments[0];
      const expected = cellToWorld(
        {
          x: from.x + (to.x - from.x) * p1.stepProgress,
          y: from.y + (to.y - from.y) * p1.stepProgress,
        },
        SETTINGS.grid,
      );

      // The ticket's own tolerance: "within 0.02 units of the expected lerp".
      expect(Math.abs(result.worldPos.x - expected.x)).toBeLessThan(0.02);
      expect(Math.abs(result.worldPos.z - expected.z)).toBeLessThan(0.02);
    }
  });
});
