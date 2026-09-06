// @ts-check
import { expect, test } from '@playwright/test';
import * as THREE from 'three';
import { SETTINGS } from '../../src/core/settings.js';
import { createGameplayCamera } from '../../src/render/camera.js';
import { POWERUP_TAG_OFFSET } from '../../src/ui/hud.js';

/**
 * KS-06-02: the grey-box power-up pedestal and the HUD tag, driven through a real, live two-player round —
 * `godMode` (`core/round.js`) does not exist in a built/served page (`import.meta.env.TEST` is unset there,
 * the same reasoning `laser-warning-banner.spec.js`'s own module comment gives), so every scenario below
 * steers both snakes for real, entirely inside one synchronous `page.evaluate` so no uncontrolled real frame
 * can land mid-script (same convention as every other e2e spec in this suite).
 *
 * **Steering: reactive, not a fixed schedule.** An earlier version of this file scripted absolute-tick turns
 * the way `laser.spec.js` does. It kept breaking for a reason specific to this ticket: a power-up's spawn
 * *cell* is chosen by the round's RNG with a rejection rule ("≥ 3 cells from any head",
 * `DESIGN-DECISIONS §2.3`), so it depends on exactly where both heads are at the spawn tick — and a fixed
 * schedule only reproduces one exact path. The moment either snake's steering has to react to *where the
 * pickup turned out to be* (which cell, and — once boosted — how fast the collector is now moving), no
 * amount of re-tuned absolute ticks stayed correct. Both helpers below read the live snapshot every step
 * instead:
 * - `boxWander(player, box, avoidCell)` keeps a snake safely inside a rectangle, turning toward its centre
 *   the instant continuing straight would leave the box (or the grid) — safe from any starting position,
 *   inside or out. `avoidCell` lets a snake circle *near* a pickup without walking onto it before it should.
 * - `walkToward(player, cell)` steers a straight line at whatever cell the snapshot says is there, replanning
 *   every step — so it is correct whether the snake is at base speed or mid-`SPEED`-boost, and whichever cell
 *   the RNG actually chose.
 *
 * Seed 97 (`kobi.setSeed(97)`, read by every test below) is not incidental: it is the first of several
 * hundred matchSeeds probed offline against this exact steering for which the first two power-up cycles are
 * `SLOW` then `SPEED` and both are reachable without a death — the property AC3's cross-cycle overlap needs
 * (see that test's own comment). AC1/AC2 do not require that property, but reuse the same seed for one fewer
 * moving part.
 *
 * **AC1's independent check.** `writeHud` computes a tag's screen fraction by projecting
 * `renderer.getHeadWorldPosition` through the real gameplay camera (`session.js`'s own doc comment on
 * `powerUpTagsFor`). This file re-derives the same projection from scratch — building the real
 * `createGameplayCamera` at the suite's fixed 1280×720 viewport and calling three's own `Vector3.project` —
 * rather than trusting the number the page already wrote to its own DOM, which would only prove the code
 * agrees with itself. `__kobi.pause()` before reading either number is what makes the two comparable at all:
 * the tag is written by `writeHud` (`session.js`, throttled to 10 Hz) one frame *before* a fresh render
 * updates `getHeadWorldPosition` (`ARCHITECTURE §5`'s update-then-render order), so without pausing first the
 * two would be reading two different instants of a still-moving head. Frozen, `fastForward(0)` renders the
 * paused position once and a further `advance()` (still paused, so nothing moves) forces one more `writeHud`
 * write past the throttle — both numbers now describe the same, motionless head.
 */

/** `?test=1` exposes `__kobi`; `?reducedFx=1` freezes the pedestal's own bob/spin and the camera's shake/zoom
 * so nothing but the snakes moves; the seed is fixed inline rather than via `kobi.setSeed` purely so every
 * test's query string alone says which board it runs on. */
const QUERY = '?test=1&seed=97&reducedFx=1';

/**
 * The viewport `playwright.config.js` fixes for every spec (`use.viewport`). Kept as a constant here (not
 * imported — the config does not export it) because AC1's independent camera has to be built at the exact
 * aspect ratio the real one was.
 */
const VIEWPORT = { width: 1280, height: 720 };

/**
 * Re-derives the screen point `session.js`'s `writeHud` should have projected a world position to, using the
 * real production camera rather than trusting the page's own arithmetic (see the module doc comment).
 *
 * @param {{x: number, y: number, z: number}} headWorld
 * @returns {{x: number, y: number}} expected `getBoundingClientRect()` top-left, in CSS pixels
 */
function expectedTagPosition(headWorld) {
  const camera = createGameplayCamera({
    settings: SETTINGS,
    aspect: VIEWPORT.width / VIEWPORT.height,
    reducedFx: true, // QUERY carries `?reducedFx=1`
  });
  camera.update(0);
  const projected = new THREE.Vector3(headWorld.x, headWorld.y, headWorld.z).project(camera);
  const xFraction = (projected.x + 1) / 2;
  const yFraction = (1 - projected.y) / 2;
  return {
    x: xFraction * VIEWPORT.width + POWERUP_TAG_OFFSET.x,
    y: yFraction * VIEWPORT.height + POWERUP_TAG_OFFSET.y,
  };
}

/**
 * `page.evaluate`'s callbacks below cannot close over anything in this module — Playwright serialises them
 * as source text and runs them in the page (`laser.spec.js`'s own module doc comment) — so this whole block
 * of reactive-steering helpers is repeated, verbatim, inside each one, rather than shared from here.
 */

test.describe('KS-06-02 power-up pedestal and HUD tag', () => {
  test('KS-06-02 AC1: the tag sits within 2 px of the projected head position plus the fixed offset', async ({
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

      /** Steers `player` at `target`, replanning from the live snapshot every call — see the module doc comment. */
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

      const P1_BOX = { xMin: 2, xMax: 10, yMin: 2, yMax: 10 };
      const P2_BOX = { xMin: 14, xMax: 21, yMin: 14, yMax: 21 };
      const CHUNK = 2 / kobi.sim.settings.simHz;

      let collectorIndex = null;
      for (let guard = 0; guard < 30000; guard += 1) {
        const snapshot = kobi.getSnapshot();
        if (!snapshot.snakes.every((s) => s.alive))
          throw new Error('a snake died before any pickup');

        boxWander(2, P2_BOX);
        const pickup = snapshot.powerUps.pickups[0];
        if (pickup) walkToward(1, pickup.cell);
        else boxWander(1, P1_BOX);

        if (snapshot.snakes[0].effects.length > 0) collectorIndex = 0;
        else if (snapshot.snakes[1].effects.length > 0) collectorIndex = 1;
        if (collectorIndex !== null) break;

        kobi.advance(CHUNK);
      }
      if (collectorIndex === null) throw new Error('no power-up was ever collected');

      // Freeze, then re-render and re-write the HUD from the now-motionless head (module doc comment).
      kobi.pause();
      kobi.fastForward(0);
      kobi.advance(0.15);

      const player = collectorIndex + 1;
      const head = kobi.getHeadWorldPosition(player);
      const tag = doc.querySelector('.hud-powerup-tag');
      const rect = tag?.getBoundingClientRect();

      return { head, rect: rect ? { x: rect.left, y: rect.top } : null };
    });

    expect(result.rect).not.toBeNull();

    const expected = expectedTagPosition(result.head);
    expect(Math.abs(/** @type {any} */ (result.rect).x - expected.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(/** @type {any} */ (result.rect).y - expected.y)).toBeLessThanOrEqual(2);
  });

  test('KS-06-02 AC2: the tag reads the ceil()d remaining seconds and disappears once the effect ends', async ({
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

      const P1_BOX = { xMin: 2, xMax: 10, yMin: 2, yMax: 10 };
      const P2_BOX = { xMin: 14, xMax: 21, yMin: 14, yMax: 21 };
      const CHUNK = 2 / kobi.sim.settings.simHz;

      let collectorIndex = null;
      let type = null;
      let midCheck = null;
      for (let guard = 0; guard < 60000; guard += 1) {
        const snapshot = kobi.getSnapshot();
        if (!snapshot.snakes.every((s) => s.alive)) throw new Error('a snake died');

        boxWander(2, P2_BOX);

        if (collectorIndex === null) {
          const pickup = snapshot.powerUps.pickups[0];
          if (pickup) walkToward(1, pickup.cell);
          else boxWander(1, P1_BOX);

          const effect = snapshot.snakes[0].effects[0] ?? snapshot.snakes[1].effects[0];
          if (effect) {
            collectorIndex = snapshot.snakes[0].effects[0] ? 0 : 1;
            type = effect.type;
          }
        } else {
          boxWander(1, P1_BOX);
          const effects = snapshot.snakes[collectorIndex].effects;
          if (effects.length > 0 && midCheck === null && effects[0].remaining <= 2.5) {
            const remaining = effects[0].remaining;
            // `writeHud` is throttled to 10 Hz (`ARCHITECTURE §8`): the many small `kobi.advance(CHUNK)`
            // calls above keep it roughly current, but the DOM could still be up to one throttle interval
            // stale relative to the snapshot just read. `advance(0.11)` — comfortably over 0.1 s — forces one
            // more write before the tag text is trusted, the same reasoning AC1's own pause+advance uses.
            kobi.advance(0.11);
            midCheck = {
              remaining,
              tagSeconds: doc.querySelector('.hud-powerup-tag-seconds')?.textContent ?? null,
            };
          }
          if (effects.length === 0) {
            kobi.advance(0.11); // same reasoning: force a fresh `writeHud` write past the throttle
            return {
              type,
              midCheck,
              goneEffect: true,
              goneTag: doc.querySelector('.hud-powerup-tag') === null,
            };
          }
        }

        kobi.advance(CHUNK);
      }
      throw new Error('the effect never ended');
    });

    expect(result.midCheck).not.toBeNull();
    const mid = /** @type {any} */ (result.midCheck);
    expect(mid.tagSeconds).toBe(`${Math.ceil(mid.remaining)}s`);
    expect(result.goneEffect).toBe(true);
    expect(result.goneTag).toBe(true);
  });

  test('KS-06-02 AC3: two tags show at once, offset apart, and neither overlaps the timer panel', async ({
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

      function manhattan(a, b) {
        return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      }

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

      // Phase 1: P1 collects the *first* cycle's pickup as late as it safely can — its own effect (`SPEED`,
      // self) or the victim effect it hands the other snake (`SLOW`) then still has as much of its window as
      // possible left once the *second* cycle spawns 15 s later (`DESIGN-DECISIONS §2.4`), which is what
      // gives phase 2 room to also land inside it. Phase 2: once that happens, P1 makes straight for whatever
      // the second cycle's pickup turns out to be.
      let phase = 'toFirst';
      let firstCell = null;
      for (let guard = 0; guard < 60000; guard += 1) {
        const snapshot = kobi.getSnapshot();
        if (!snapshot.snakes.every((s) => s.alive)) throw new Error('a snake died');

        const p1Active = snapshot.snakes[0].effects.length > 0;
        const p2Active = snapshot.snakes[1].effects.length > 0;
        if (p1Active && p2Active) break;

        boxWander(2, P2_BOX);

        if (phase === 'toFirst') {
          const pickup = snapshot.powerUps.pickups[0];
          if (pickup) {
            if (firstCell === null) firstCell = pickup.cell;
            const head = snapshot.snakes[0].segments[0];
            const dist = manhattan(head, firstCell);
            const travelTicks = (dist / kobi.sim.settings.snakeSpeed) * simHz;
            let despawnTick = FIRST_SPAWN_AT * simHz;
            while (despawnTick <= kobi.sim.tick) despawnTick += CYCLE * simHz;
            if (despawnTick - kobi.sim.tick <= travelTicks * 1.25 + 20) walkToward(1, firstCell);
            else boxWander(1, P1_BOX, firstCell);
          } else {
            boxWander(1, P1_BOX);
          }
          if (p1Active || p2Active) phase = 'toSecond';
        } else {
          const pickup = snapshot.powerUps.pickups.find(
            (p) => !(p.cell.x === firstCell.x && p.cell.y === firstCell.y),
          );
          if (pickup) walkToward(1, pickup.cell);
          else boxWander(1, P1_BOX, firstCell);
        }

        kobi.advance(CHUNK);
      }

      // Both active: freeze and re-render/re-write the HUD from here (module doc comment on AC1's own use of
      // the same pattern) before reading anything.
      kobi.pause();
      kobi.fastForward(0);
      kobi.advance(0.15);

      const snapshot = kobi.getSnapshot();
      const tags = [...doc.querySelectorAll('.hud-powerup-tag')].map((el) =>
        el.getBoundingClientRect(),
      );
      const timerPanel = doc.querySelector('.hud-row')?.getBoundingClientRect();

      return {
        bothActive: snapshot.snakes[0].effects.length > 0 && snapshot.snakes[1].effects.length > 0,
        tagCount: tags.length,
        tags: tags.map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })),
        timerPanel: timerPanel
          ? {
              left: timerPanel.left,
              top: timerPanel.top,
              right: timerPanel.right,
              bottom: timerPanel.bottom,
            }
          : null,
      };
    });

    expect(result.bothActive).toBe(true);
    expect(result.tagCount).toBe(2);

    // Two genuinely distinct positions — "at once" never collapses into one drawn tag.
    const [first, second] = result.tags;
    expect(first.left !== second.left || first.top !== second.top).toBe(true);

    // Neither tag's box intersects the timer panel's.
    expect(result.timerPanel).not.toBeNull();
    const panel = /** @type {any} */ (result.timerPanel);
    for (const tag of result.tags) {
      const overlaps =
        tag.left < panel.right &&
        tag.right > panel.left &&
        tag.top < panel.bottom &&
        tag.bottom > panel.top;
      expect(overlaps).toBe(false);
    }
  });
});
