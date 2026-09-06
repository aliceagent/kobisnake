// @ts-check
import { expect, test } from '@playwright/test';

/**
 * KS-06-02 (declared deviation — a new baseline, not on the ticket's own `Files:` list; see the PR
 * description): the grey-box power-up pedestal and the HUD tag, side by side in one frame, for the design
 * lead to compare against `docs/reference/images/13-gameplay-hud.png`'s own "SPEED BOOST 5s" tag and pedestal
 * annotations.
 *
 * The four laser baselines (`laser.visual.spec.js`) deliberately run with power-ups off, so this is the only
 * baseline in the suite where either the pedestal or the tag appears at all.
 *
 * **The moment chosen.** `?test=1&seed=97` (this file's own fixed seed — the same one `tests/e2e/
 * powerups.spec.js` uses and documents at length: the first of several hundred candidates probed offline for
 * which the first two power-up cycles are reachable without a death) reaches a point where P1 has just
 * collected the first cycle's pickup (a `SLOW`, victimising P2 — `DESIGN-DECISIONS §1 row 3`) and the second
 * cycle's pickup has just spawned but not yet been touched. That single frame shows both new views this
 * ticket adds at once: a live pedestal still on the board, and a HUD tag over the snake it affects — exactly
 * the pairing `13-gameplay-hud.png` shows. Steering is the same reactive, snapshot-driven approach
 * `powerups.spec.js` uses and explains in its own module doc comment (a fixed schedule cannot survive a
 * power-up's spawn cell depending on live head positions), not repeated here beyond what differs: this file
 * stops as soon as the second pedestal exists, rather than walking onto it.
 *
 * `?reducedFx=1` freezes the pedestal's own idle bob/spin (`DESIGN-DECISIONS §3` "Power-up sheet") and the
 * camera's shake/zoom, the same way it already does for every other baseline in this suite — a screenshot of
 * a bobbing, spinning mesh is a screenshot of whatever phase it happened to be paused at, never twice the
 * same.
 *
 * A second test below adds a second baseline, `powerups-slow-pedestal.png` — a design-review request after
 * this file's first baseline shipped with its SPEED pedestal effectively invisible; see that test's own doc
 * comment for why a second frame, not a second pedestal in this one, is how "both types, comparable" has to
 * be shown.
 */

const QUERY = '?test=1&seed=97&reducedFx=1';

test.describe('KS-06-02 visual', () => {
  test('KS-06-02: power-up pedestal and HUD tag baseline', async ({ page }) => {
    await page.goto(QUERY);

    const result = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;
      const DIRS = {
        UP: { dx: 0, dy: 1 },
        DOWN: { dx: 0, dy: -1 },
        LEFT: { dx: -1, dy: 0 },
        RIGHT: { dx: 1, dy: 0 },
      };

      /** Steers `player` at `target`, replanning from the live snapshot every call (see the module doc comment). */
      function walkToward(player, target) {
        const snake = kobi.getSnapshot().snakes[player - 1];
        if (!snake.alive) return;
        const head = snake.segments[0];
        const dir = snake.direction;
        const dx = target.x - head.x;
        const dy = target.y - head.y;
        let want;
        if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) want = dx > 0 ? 'RIGHT' : 'LEFT';
        else if (dy !== 0) want = dy > 0 ? 'UP' : 'DOWN';
        else return;
        const wv = DIRS[want];
        if (wv.dx === -dir.dx && wv.dy === -dir.dy) {
          want =
            want === 'RIGHT' || want === 'LEFT'
              ? dy > 0
                ? 'UP'
                : dy < 0
                  ? 'DOWN'
                  : null
              : dx > 0
                ? 'RIGHT'
                : dx < 0
                  ? 'LEFT'
                  : null;
        }
        if (want) kobi.pressKey(player, want);
      }

      /** Keeps `player` inside `box` (and the grid), turning toward its centre before it would leave either. */
      function boxWander(player, box, avoidCell) {
        const snake = kobi.getSnapshot().snakes[player - 1];
        if (!snake.alive) return;
        const head = snake.segments[0];
        const dir = snake.direction;
        const nx = head.x + dir.dx;
        const ny = head.y + dir.dy;
        const hitsAvoid = avoidCell && nx === avoidCell.x && ny === avoidCell.y;
        const wouldLeave =
          hitsAvoid ||
          nx < box.xMin ||
          nx > box.xMax ||
          ny < box.yMin ||
          ny > box.yMax ||
          nx < 0 ||
          nx > GRID.width - 1 ||
          ny < 0 ||
          ny > GRID.height - 1;
        if (!wouldLeave) return;
        const candidates = dir.dx !== 0 ? ['UP', 'DOWN'] : ['LEFT', 'RIGHT'];
        const cx = (box.xMin + box.xMax) / 2;
        const cy = (box.yMin + box.yMax) / 2;
        candidates.sort((a, b) => {
          const da = DIRS[a];
          const db = DIRS[b];
          const sa = (cx - head.x) * da.dx + (cy - head.y) * da.dy;
          const sb = (cx - head.x) * db.dx + (cy - head.y) * db.dy;
          return sb - sa;
        });
        kobi.pressKey(player, candidates[0]);
      }

      kobi.setSeed(97);
      kobi.startMatch();
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      const GRID = kobi.sim.settings.grid;
      const simHz = kobi.sim.settings.simHz;
      const FIRST_SPAWN_AT =
        kobi.sim.settings.roundDuration - kobi.sim.settings.powerUpFirstSpawnAt;
      const CYCLE = kobi.sim.settings.powerUpInterval;

      const P1_BOX = { xMin: 2, xMax: 10, yMin: 2, yMax: 10 };
      const P2_BOX = { xMin: 14, xMax: 21, yMin: 14, yMax: 21 };
      const CHUNK = 2 / simHz;

      let firstCell = null;
      let firstCollected = false;
      for (let guard = 0; guard < 60000; guard += 1) {
        const snapshot = kobi.getSnapshot();
        if (!snapshot.snakes.every((s) => s.alive)) throw new Error('a snake died');

        boxWander(2, P2_BOX);

        if (!firstCollected) {
          const pickup = snapshot.powerUps.pickups[0];
          if (pickup) {
            if (firstCell === null) firstCell = pickup.cell;
            const head = snapshot.snakes[0].segments[0];
            const dist = Math.abs(head.x - firstCell.x) + Math.abs(head.y - firstCell.y);
            const travelTicks = (dist / kobi.sim.settings.snakeSpeed) * simHz;
            let despawnTick = FIRST_SPAWN_AT * simHz;
            while (despawnTick <= kobi.sim.tick) despawnTick += CYCLE * simHz;
            if (despawnTick - kobi.sim.tick <= travelTicks * 1.25 + 20) walkToward(1, firstCell);
            else boxWander(1, P1_BOX, firstCell);
          } else {
            boxWander(1, P1_BOX);
          }
          firstCollected =
            snapshot.snakes[0].effects.length > 0 || snapshot.snakes[1].effects.length > 0;
        } else {
          // Wait for the second cycle's pedestal to appear, but do not walk onto it — this baseline wants it
          // still standing.
          boxWander(1, P1_BOX, firstCell);
          const secondPickup = snapshot.powerUps.pickups.find(
            (p) => !(p.cell.x === firstCell.x && p.cell.y === firstCell.y),
          );
          if (secondPickup) break;
        }

        kobi.advance(CHUNK);
      }

      kobi.pause();
      kobi.fastForward(0);
      kobi.advance(0.15); // one more `writeHud` write past the throttle, so the tag reflects the frozen state

      const pausePanel = doc.querySelector('[data-screen="PAUSE"]');
      if (pausePanel !== null) pausePanel.hidden = true;

      const snapshot = kobi.getSnapshot();
      return {
        pickups: snapshot.powerUps.pickups.length,
        anyEffect: snapshot.snakes.some((s) => s.effects.length > 0),
        tagCount: doc.querySelectorAll('.hud-powerup-tag').length,
      };
    });

    // The whole point of this baseline: a pedestal still standing and at least one tag, in the same frame.
    expect(result.pickups).toBeGreaterThan(0);
    expect(result.anyEffect).toBe(true);
    expect(result.tagCount).toBeGreaterThan(0);

    await expect(page).toHaveScreenshot('powerups-pedestal-and-tag.png');
  });

  /**
   * A second baseline, added on design-lead review of the first: the SPEED pedestal in
   * `powerups-pedestal-and-tag.png` above was found to be effectively invisible (`pickupView.js`'s
   * `ICON_FLOAT_GAP`/`ICON_SIZE` comments have the full story — the icon sat inside the pedestal's own box
   * geometry, occluded by it from this camera's near-overhead pitch). Row 20's whole point ("different
   * silhouette, icon, colour and pedestal... never rely on colour alone") is exactly what a design review
   * needs to be able to see, so it needs both types legible and, ideally, comparable side by side.
   *
   * `core/powerups.js` guarantees at most one pickup on the board, ever (its own doc comment), so "both
   * pedestal types in one frame" can only mean two frames, not one faked snapshot — this is the second one.
   * Seed 97's first cycle is always a `SLOW` (the same fact `powerups.spec.js` and the baseline above both
   * document and rely on), so stopping the instant it spawns — before either snake has moved far enough to
   * touch it, let alone collect it — gives a clean, untouched SLOW pedestal: no tag, no effect, nothing else
   * in frame competing for attention. Reviewed together, this and `powerups-pedestal-and-tag.png` show one of
   * each pedestal type, each on its own, at the same camera scale.
   */
  test('KS-06-02: SLOW pedestal baseline, for comparison against the SPEED pedestal above', async ({
    page,
  }) => {
    await page.goto(QUERY);

    const result = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;
      const DIRS = {
        UP: { dx: 0, dy: 1 },
        DOWN: { dx: 0, dy: -1 },
        LEFT: { dx: -1, dy: 0 },
        RIGHT: { dx: 1, dy: 0 },
      };

      /** Keeps `player` inside `box` (and the grid), turning toward its centre before it would leave either. */
      function boxWander(player, box) {
        const snake = kobi.getSnapshot().snakes[player - 1];
        if (!snake.alive) return;
        const head = snake.segments[0];
        const dir = snake.direction;
        const nx = head.x + dir.dx;
        const ny = head.y + dir.dy;
        const wouldLeave =
          nx < box.xMin ||
          nx > box.xMax ||
          ny < box.yMin ||
          ny > box.yMax ||
          nx < 0 ||
          nx > GRID.width - 1 ||
          ny < 0 ||
          ny > GRID.height - 1;
        if (!wouldLeave) return;
        const candidates = dir.dx !== 0 ? ['UP', 'DOWN'] : ['LEFT', 'RIGHT'];
        const cx = (box.xMin + box.xMax) / 2;
        const cy = (box.yMin + box.yMax) / 2;
        candidates.sort((a, b) => {
          const da = DIRS[a];
          const db = DIRS[b];
          const sa = (cx - head.x) * da.dx + (cy - head.y) * da.dy;
          const sb = (cx - head.x) * db.dx + (cy - head.y) * db.dy;
          return sb - sa;
        });
        kobi.pressKey(player, candidates[0]);
      }

      kobi.setSeed(97);
      kobi.startMatch();
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      const GRID = kobi.sim.settings.grid;

      const P1_BOX = { xMin: 2, xMax: 10, yMin: 2, yMax: 10 };
      const P2_BOX = { xMin: 14, xMax: 21, yMin: 14, yMax: 21 };

      for (let guard = 0; guard < 60000; guard += 1) {
        const snapshot = kobi.getSnapshot();
        if (!snapshot.snakes.every((s) => s.alive)) throw new Error('a snake died');
        // Neither snake walks toward the pickup — this baseline wants it caught untouched, the instant it
        // spawns, not partway approached.
        boxWander(1, P1_BOX);
        boxWander(2, P2_BOX);
        if (snapshot.powerUps.pickups.length > 0) break;
        kobi.advance(2 / kobi.sim.settings.simHz);
      }

      kobi.pause();
      kobi.fastForward(0);

      const pausePanel = doc.querySelector('[data-screen="PAUSE"]');
      if (pausePanel !== null) pausePanel.hidden = true;

      const snapshot = kobi.getSnapshot();
      return {
        pickupType: snapshot.powerUps.pickups[0]?.type ?? null,
        pickupCount: snapshot.powerUps.pickups.length,
        anyEffect: snapshot.snakes.some((s) => s.effects.length > 0),
      };
    });

    // Seed 97's first cycle is always SLOW (see the module doc comment) — asserted rather than assumed, so a
    // seed or spawn-order change fails loudly here instead of quietly recording the wrong pedestal type.
    expect(result.pickupCount).toBe(1);
    expect(result.pickupType).toBe('SLOW');
    expect(result.anyEffect).toBe(false);

    await expect(page).toHaveScreenshot('powerups-slow-pedestal.png');
  });
});
