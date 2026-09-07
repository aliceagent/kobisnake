// @ts-check
import { expect, test } from '@playwright/test';
import { cellToWorld } from '../../src/render/arenaView.js';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

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
 * The step to the target is a **whole-tick loop**, not `fastForward(deltaTicks / simHz)`. It used to be that
 * division, defended in this comment on the grounds that real frames leave an arbitrary fraction in the
 * simulation's tick accumulator, so a lost tick would need that leftover to be under ~1e-13. **That was
 * wrong, and it is issue #117** — the "one unidentified e2e failure in four local runs of `main`" that four
 * sprints could not attribute. The leftover is not arbitrary: a `fastForward` that asks for a whole number of
 * ticks leaves the accumulator at (near enough) exactly zero, and from zero **any** duration longer than
 * `fastForward`'s own 0.1 s chunk loses exactly one tick, because the chunks' tick counts do not sum to the
 * whole they came from. One tick is 0.05 of `stepProgress`, orders of magnitude outside the assertion below.
 * Caught in the act under full-suite load:
 *
 * ```
 * target=0.5  beforeProgress=0.8500000000000005  currentTicks=17
 *             deltaTicks=13  ticksAdvanced=12  afterProgress=0.4500000000000006
 * ```
 *
 * It only ever fires when the live frame loop has pushed the snake *past* the target inside the current step,
 * which is what makes `deltaTicks` wrap into the 13–20 range that spans two chunks — and that in turn depends
 * on how fast the machine is, which is why it looked like a flake and why running this spec on its own never
 * reproduced it.
 *
 * Stepping one tick at a time is exact (`1/120 * 120` is exactly `1` in binary float, so every call advances
 * precisely one tick) and it is the pattern the rest of the suite already uses for the same reason:
 * `helpers.js` steps to every state boundary rather than fast-forwarding a fixed duration (KS-06-00, #84),
 * and `first-playable.spec.js`'s AC2 replay steps whole ticks (KS-06-07, #100). `advance` is used rather
 * than `fastForward` so a loop of twenty steps costs one render instead of twenty (KS-06-06, #96); the render
 * that `getHeadWorldPosition` needs is taken once, at the end.
 *
 * The underlying sharp edge — `__kobi.advance(seconds)` silently delivering one tick fewer than `seconds`
 * asks for, whenever it spans more than one chunk and the accumulator is empty — is filed separately; this
 * spec stops relying on it rather than papering over it.
 */

test.describe('KS-03-07 interpolation', () => {
  test('KS-03-04 AC1: the head world position matches the lerp of previous and current cell at stepProgress 0.25/0.5/0.75', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    // KS-05-03: main menu -> match setup -> countdown -> PLAYING, in one synchronous script.
    await page.evaluate(startMatchInPage);

    for (const target of [0.25, 0.5, 0.75]) {
      const result = await page.evaluate((targetProgress) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        const snake = kobi.sim.snakes[0];
        const ticksPerStep =
          kobi.sim.settings.simHz / (kobi.sim.settings.snakeSpeed * snake.speedMultiplier);

        // How many *more* ticks, from wherever the live snake's progress happens to be right now, land it
        // exactly on `targetProgress` within its current step. `+= ticksPerStep` when the target has already
        // been passed this step handles the general case — and it is the case that fires in practice, because
        // the live frame loop advances the snake in the gap between this script and the previous one.
        const currentTicks = Math.round(snake.stepProgress * ticksPerStep);
        const targetTicks = Math.round(targetProgress * ticksPerStep);
        let deltaTicks = targetTicks - currentTicks;
        if (deltaTicks <= 0) deltaTicks += ticksPerStep;

        // One tick at a time, to an absolute target tick (see this file's module comment and #117): a single
        // `fastForward(deltaTicks / simHz)` loses exactly one tick whenever it spans more than one 0.1 s
        // chunk and the accumulator is empty, which silently turns 0.5 into 0.45.
        const tickSeconds = 1 / kobi.sim.settings.simHz;
        const targetTick = kobi.sim.tick + deltaTicks;
        while (kobi.sim.tick < targetTick) kobi.advance(tickSeconds);
        kobi.fastForward(0); // one render for the whole loop, not one per tick (KS-06-06)

        return {
          snapshot: kobi.getSnapshot(),
          worldPos: kobi.getHeadWorldPosition(1),
          // Asserted outside: the loop must have delivered exactly the ticks it asked for. This is the
          // assertion #117 never had, and the one that would have named the cause four sprints ago.
          deltaTicks,
          ticksAdvanced: kobi.sim.tick - (targetTick - deltaTicks),
        };
      }, target);

      // #117: the step landed on the tick it aimed for. Checked before `stepProgress`, because when this
      // fails the progress assertion below fails too and only this one says why.
      expect(result.ticksAdvanced).toBe(result.deltaTicks);

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
