// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-04-03: the "LASERS CLOSING!" banner and red-timer presentation, in a real browser.
 *
 * New file — not on the ticket's own `Files:` list (declared in the PR description).
 *
 * `LASER_WARNING` fires at 30 s remaining of a 90 s round (`DESIGN-DECISIONS §2.4`). The test-only `godMode`
 * override (KS-04-01) that reaches this point trivially in the unit suite is deliberately inert here —
 * `import.meta.env.TEST` is unset in a built/served page (`core/round.js`'s own comment on `UNDER_TEST`) — so
 * the scenario below drives both snakes for real through `window.__kobi`, entirely inside one synchronous
 * `page.evaluate` (no Playwright round-trip can let an uncontrolled real frame land in the middle of it —
 * `first-playable.spec.js`'s own doc comment explains why that matters).
 *
 * **The steering.** Each snake is walked clockwise around a fixed rectangle in its own half of the arena,
 * chosen so its spawn cell already sits on the rectangle's edge heading the right way (`DESIGN-DECISIONS
 * §2.3`'s spawns) — no repositioning manoeuvre needed before the loop starts. A fixed rectangle can never
 * self-intersect, so however many segments a stray apple grows the snake by, it only ever chases its own
 * tail around the same loop; the two rectangles sit in disjoint x-ranges, so the snakes can never meet
 * either. `pressKey` takes the direction as a string name for exactly this reason (KS-03-06) — a
 * `page.evaluate` cannot serialise a frozen `DIRECTIONS` object across the bridge.
 *
 * This is also how the round is driven to `ROUND_OVER`: the rectangles are not laser-aware, so once the
 * beams close far enough in, whichever snake's rectangle they reach first dies there — which is exactly the
 * real ending this scenario needs to see the timer through, not a contrivance to avoid it.
 */

test.describe('KS-04-03 laser warning banner', () => {
  test('the banner starts hidden and the timer starts unwarned', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    const banner = page.locator('.hud-laser-banner');
    await expect(banner).toBeHidden();
    await expect(banner).toHaveText('LASERS CLOSING!');

    const timer = page.locator('.hud-timer');
    await expect(timer).not.toHaveClass(/hud-timer--warning/);
  });

  test('a fresh round still starts with the banner hidden and the timer unwarned', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    // KS-05-03: main menu -> match setup -> countdown -> PLAYING, in one synchronous script.
    await page.evaluate(startMatchInPage);

    const banner = page.locator('.hud-laser-banner');
    await expect(banner).toBeHidden();

    const timer = page.locator('.hud-timer');
    await expect(timer).not.toHaveClass(/hud-timer--warning/);
  });

  test('KS-04-03 AC1/AC2: a real, steered round shows the banner at 0:30, hides it 5 s later, and keeps the timer red through ROUND_OVER', async ({
    page,
  }) => {
    // Hundreds of small fastForward+render steps run inside the one evaluate below; generous but still far
    // under Playwright's own hang-detection budgets.
    test.setTimeout(60_000);

    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const global = /** @type {any} */ (globalThis);
      const kobi = global.__kobi;
      // KS-05-03: the real flow, in this same synchronous script — main menu, match setup, and the four
      // countdown beats of `DESIGN-DECISIONS §2.4`, after which the round is at tick 0 exactly. (Inlined
      // rather than calling `startMatchInPage`: `page.evaluate` ships this function's *source*, so it cannot
      // reach a helper in the spec's own module scope.)
      kobi.startMatch();
      kobi.fastForward(3.21);

      const settings = kobi.sim.settings;
      const stepChecks = 3; // check every N grid steps rather than every single one, for speed
      const stepSeconds = stepChecks / settings.snakeSpeed;
      const guardLimit = Math.ceil(settings.roundDuration / stepSeconds) + 60; // a whole round, plus slack

      // P1 spawns (5,12) heading RIGHT; P2 spawns (18,11) heading LEFT (DESIGN-DECISIONS §2.3). Each box is
      // built so that spawn cell already sits on its own perimeter, travelling the way the loop below
      // expects — P1's spawn row is its box's bottom edge (RIGHT), P2's is its box's top edge (LEFT).
      const boxes = [
        { xMin: 2, xMax: 9, yMin: 12, yMax: 19 },
        { xMin: 13, xMax: 21, yMin: 3, yMax: 11 },
      ];

      /** @param {{dx: number, dy: number}} d */
      function directionName(d) {
        if (d.dx === 1) return 'RIGHT';
        if (d.dx === -1) return 'LEFT';
        return d.dy === 1 ? 'UP' : 'DOWN';
      }

      // Walks the box's perimeter clockwise: RIGHT along the bottom until xMax, UP the right side until
      // yMax, LEFT along the top until xMin, DOWN the left side until yMin, then RIGHT again. `>=`/`<=`
      // rather than `===` so an occasional one-cell overshoot (float drift over hundreds of steps) still
      // turns on the very next check instead of falling through unhandled.
      /** @param {{xMin: number, xMax: number, yMin: number, yMax: number}} box @param {{x: number, y: number}} cell @param {string} dirName */
      function turnIfNeeded(box, cell, dirName) {
        switch (dirName) {
          case 'RIGHT':
            return cell.x >= box.xMax ? 'UP' : 'RIGHT';
          case 'UP':
            return cell.y >= box.yMax ? 'LEFT' : 'UP';
          case 'LEFT':
            return cell.x <= box.xMin ? 'DOWN' : 'LEFT';
          default:
            return cell.y <= box.yMin ? 'RIGHT' : 'DOWN';
        }
      }

      function steerAndAdvance() {
        const snap = kobi.getSnapshot();
        snap.snakes.forEach((snake, i) => {
          if (!snake.alive) return;
          const dirName = directionName(snake.direction);
          const wanted = turnIfNeeded(boxes[i], snake.segments[0], dirName);
          kobi.pressKey(i + 1, wanted);
        });
        kobi.fastForward(stepSeconds);
      }

      /** @param {ReturnType<typeof kobi.getSnapshot>} snap */
      function readHud(snap) {
        return {
          timeRemaining: snap.timeRemaining,
          bannerHidden: global.document.querySelector('.hud-laser-banner').hidden,
          timerWarning: global.document
            .querySelector('.hud-timer')
            .classList.contains('hud-timer--warning'),
        };
      }

      let sawWarning = null;
      let sawBannerHidden = null;
      let guard = 0;

      while (kobi.getSnapshot().phase !== 'ROUND_OVER' && guard < guardLimit) {
        steerAndAdvance();
        guard += 1;
        const snap = kobi.getSnapshot();

        if (sawWarning === null && snap.timeRemaining <= settings.laserStartTime) {
          sawWarning = readHud(snap);
        }
        if (
          sawWarning !== null &&
          sawBannerHidden === null &&
          snap.timeRemaining <= settings.laserStartTime - settings.laserWarningDuration
        ) {
          sawBannerHidden = readHud(snap);
        }
      }

      const finalSnap = kobi.getSnapshot();
      return {
        sawWarning,
        sawBannerHidden,
        guardHit: guard >= guardLimit,
        finalPhase: finalSnap.phase,
        finalTimerWarning: global.document
          .querySelector('.hud-timer')
          .classList.contains('hud-timer--warning'),
      };
    });

    // The steering worked and the round actually reached ROUND_OVER (not the guard giving up).
    expect(result.guardHit).toBe(false);
    expect(result.finalPhase).toBe('ROUND_OVER');

    // AC1: the banner is up the moment 0:30 is crossed...
    expect(result.sawWarning).not.toBeNull();
    expect(result.sawWarning.bannerHidden).toBe(false);
    // ...and hidden again 5 s later (SETTINGS.laserWarningDuration).
    expect(result.sawBannerHidden).not.toBeNull();
    expect(result.sawBannerHidden.bannerHidden).toBe(true);

    // AC2: the timer is red from the moment the warning starts, stays red once the banner itself has
    // hidden, and is still red at ROUND_OVER — never un-reddened mid-round.
    expect(result.sawWarning.timerWarning).toBe(true);
    expect(result.sawBannerHidden.timerWarning).toBe(true);
    expect(result.finalTimerWarning).toBe(true);
  });
});
