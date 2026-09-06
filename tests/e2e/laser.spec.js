// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KS-04-02: the laser and dead-zone view, driven through a real, live two-player round rather than a hand-
 * built snapshot — the same distinction `interpolation.spec.js`'s own module doc comment draws for the
 * snake view. `tests/unit/render/laserView.test.js` and `tests/unit/render/arenaView.test.js` already prove
 * the geometry and the glide math against the view directly, in Node, with a `godMode`-immortal round
 * (`core/round.js`'s test-only flag); what is missing, and what this file is for, is the same behaviour
 * through the actual production path a real match takes — a real WebGL canvas, real gameplay, real deaths
 * still possible — where `godMode` does not exist at all (it is gated on `import.meta.env.TEST`, Vitest's own
 * flag, which a `vite build` production bundle never sets).
 *
 * That means both snakes have to genuinely survive to the laser phase rather than being made immortal, so
 * this file steers each one around a small rectangular patrol, entirely via `__kobi.pressKey` at absolute
 * tick targets (`gameplay.visual.spec.js`'s own convention, and for the same reason: an offset measured
 * "N steps from here" compounds the Enter-to-`evaluate()` gap every scenario in this suite has to account
 * for, where an offset measured from tick 0 does not). The two boxes — P1 in `x:[4,11] y:[4,11]`, P2 in
 * `x:[14,21] y:[14,21]` — were chosen and checked against the real `RoundSimulation` (seed 1, the suite's own
 * default) for the specific span this file needs: both snakes are still alive and on their loop through
 * `t = 24 s` remaining (66 s elapsed, one `LASER_STEP` in), which is as deep into the endgame as a *fixed*
 * patrol can safely go — by `t = 20 s` remaining the second step's inset reaches P2's own box edge. Proving
 * the view deeper into the closing square than that is `tests/visual/laser.visual.spec.js`'s job, which
 * drives `sim.lasers` directly rather than needing a laser-aware bot (`KS-04-04`'s job, not this ticket's).
 *
 * Everything below runs inside one `page.evaluate()`, including the schedule-building helper — Playwright
 * serialises the callback and runs it in the page, so it cannot close over anything from this module; the
 * helper is declared again, inline, for that reason alone.
 */

test.describe('KS-04-02 laser rendering', () => {
  test('lasers stay hidden while PARKED, appear within the AC3 draw-call budget from WARNING, and the sim keeps agreeing with a real round through the first LASER_STEP', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;

      // KS-05-03: starts the round through the real flow — main menu, match setup, and the four countdown
      // beats of `DESIGN-DECISIONS §2.4` — synchronously, so it leaves the round at tick 0 exactly. See the
      // module doc comment on why every scripted moment in this suite stays inside one `evaluate`.
      kobi.startMatch();
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      kobi.fastForward(0); // one render at tick 0, so `getDrawCalls` reflects something real before any input.

      const parkedDrawCalls = kobi.getDrawCalls();
      const parkedPhase = kobi.getSnapshot().lasers.phase;

      const simHz = kobi.sim.settings.simHz;
      const stepTicks = simHz / kobi.sim.settings.snakeSpeed;

      /** Builds an absolute-tick `{tick, dir}` schedule for a rectangular clockwise patrol, from tick 0. */
      function buildSchedule(legs) {
        const schedule = [];
        let tick = 0;
        for (const [dir, cells] of legs) {
          schedule.push({ tick, dir });
          tick += cells * stepTicks;
        }
        return schedule;
      }
      const loop = (legs, repeats) => Array.from({ length: repeats }, () => legs).flat();

      // P1 spawns (5, 12) heading RIGHT: down into the box x:[4,11] y:[4,11], then loop its perimeter.
      const p1Legs = [
        ['DOWN', 8],
        ['RIGHT', 6],
        ['UP', 7],
        ['LEFT', 7],
        ['DOWN', 7],
        ...loop(
          [
            ['RIGHT', 7],
            ['UP', 7],
            ['LEFT', 7],
            ['DOWN', 7],
          ],
          14,
        ),
      ];
      // P2 spawns (18, 11) heading LEFT: into its own box x:[14,21] y:[14,21], well clear of P1's.
      const p2Legs = [
        ['UP', 3],
        ['LEFT', 4],
        ['UP', 7],
        ['RIGHT', 7],
        ['DOWN', 7],
        ...loop(
          [
            ['LEFT', 7],
            ['UP', 7],
            ['RIGHT', 7],
            ['DOWN', 7],
          ],
          14,
        ),
      ];

      const events = [
        ...buildSchedule(p1Legs).map((e) => ({ ...e, player: 1 })),
        ...buildSchedule(p2Legs).map((e) => ({ ...e, player: 2 })),
      ].sort((a, b) => a.tick - b.tick);

      const advanceToTick = (targetTick) =>
        kobi.fastForward(Math.max(0, targetTick - kobi.sim.tick) / simHz);

      let eventIndex = 0;
      /** Applies every scheduled turn up to and including `targetTick`, then lands exactly on it. */
      function advanceApplyingTurns(targetTick) {
        while (eventIndex < events.length && events[eventIndex].tick <= targetTick) {
          advanceToTick(events[eventIndex].tick);
          kobi.pressKey(events[eventIndex].player, events[eventIndex].dir);
          eventIndex += 1;
        }
        advanceToTick(targetTick);
      }

      // 60 s survived: exactly `laserStartTime` (`DESIGN-DECISIONS §2.4`) — the WARNING moment.
      advanceApplyingTurns(60 * simHz);
      const warningSnapshot = kobi.getSnapshot();
      const warningDrawCalls = kobi.getDrawCalls();

      // 66 s survived: `laserStartTime - laserWarningDuration` (25 s remaining) plus one `laserStepInterval`
      // (2.5 s) has passed — the first `LASER_STEP` has landed, one cell inward, 24 s remaining.
      advanceApplyingTurns(66 * simHz);
      const closingSnapshot = kobi.getSnapshot();
      const closingDrawCalls = kobi.getDrawCalls();

      return {
        parkedDrawCalls,
        parkedPhase,
        warningSnapshot,
        warningDrawCalls,
        closingSnapshot,
        closingDrawCalls,
      };
    });

    // The round is still genuinely being played — no death, no `godMode` — so this is the real proof the
    // wiring works, not a restatement of the unit tests' geometry math.
    expect(result.parkedPhase).toBe('PARKED');
    expect(result.parkedDrawCalls).toBeGreaterThan(0); // the arena and both snakes are already drawing.

    expect(result.warningSnapshot.lasers.phase).toBe('WARNING');
    expect(result.warningSnapshot.lasers.inset).toBe(0);
    expect(result.warningSnapshot.snakes.every((snake) => snake.alive)).toBe(true);
    // KS-04-02 AC3, measured against three's own real render-call counter, not a mesh count in Node.
    expect(result.warningDrawCalls - result.parkedDrawCalls).toBeGreaterThan(0);
    expect(result.warningDrawCalls - result.parkedDrawCalls).toBeLessThanOrEqual(6);

    expect(result.closingSnapshot.lasers.phase).toBe('CLOSING');
    expect(result.closingSnapshot.lasers.inset).toBe(1);
    expect(result.closingSnapshot.snakes.every((snake) => snake.alive)).toBe(true);
    expect(result.closingDrawCalls - result.parkedDrawCalls).toBeLessThanOrEqual(6);
  });
});
