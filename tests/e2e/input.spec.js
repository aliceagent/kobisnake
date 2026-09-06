// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-03-07 scenario (b): a reversal input does nothing.
 *
 * `input.js` and `snake.js` already prove this rule at the unit level (`tests/unit/game/input.test.js`,
 * `tests/unit/core/snake.test.js`); what this file proves is that the whole wired-up game — the real
 * `keydown` `pressKey` dispatches, through `input.js`, into `session.js`'s `applyInput`, into the live
 * `RoundSimulation` — honours it too, with nothing in the wiring between those pieces silently letting a
 * reversal through.
 */

test.describe('KS-03-07 input', () => {
  test('KS-03-07 scenario (b): the reversal key does nothing', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    // KS-05-03: a round is reached through the real flow now — main menu, match setup, countdown — rather
    // than by pressing Enter on the placeholder overlay Sprint 03 had.
    await page.evaluate(startMatchInPage);

    // P1 spawns heading RIGHT (`DESIGN-DECISIONS §2.3`). LEFT is its exact reverse, which `queueDirection`
    // (`DESIGN-DECISIONS §2.2`) must drop silently rather than queue.
    const snapshot = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.pressKey(1, 'LEFT');
      kobi.fastForward(1);
      return kobi.getSnapshot();
    });

    const p1 = /** @type {any} */ (snapshot).snakes[0];
    // Still committed to RIGHT — a reversal accepted into the queue would have turned the snake around by
    // now, one whole simulated second (6 steps at the base speed) later.
    expect(p1.direction).toEqual({ dx: 1, dy: 0 });
    // Still alive: a snake that reversed onto its own neck would have crashed into itself immediately.
    expect(p1.alive).toBe(true);
  });
});
