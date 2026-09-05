// @ts-check
import { describe, expect, it } from 'vitest';
import { CAUSES, resolveStep } from '../../../src/core/collisions.js';
import { Snake } from '../../../src/core/snake.js';
import { DIRECTIONS, inBounds } from '../../../src/core/grid.js';
import { SETTINGS } from '../../../src/core/settings.js';

/** @typedef {import('../../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */

/**
 * @param {string} id
 * @param {Cell[]} cells - head first
 * @param {Direction} direction
 * @param {{growth?: number, queued?: Direction}} [extra]
 * @returns {Snake}
 */
function snakeAt(id, cells, direction, { growth = 0, queued } = {}) {
  const snake = new Snake({ id, cells, direction, settings: SETTINGS });
  if (growth > 0) snake.grow(growth);
  if (queued) snake.queueDirection(queued);
  return snake;
}

/**
 * A horizontal snake of `length` segments with its head at `head`, body trailing away from `direction`.
 *
 * @param {string} id
 * @param {Cell} head
 * @param {Direction} direction
 * @param {number} [length]
 * @param {{growth?: number}} [extra]
 * @returns {Snake}
 */
function straightSnake(id, head, direction, length = 4, { growth = 0 } = {}) {
  const cells = Array.from({ length }, (_, i) => ({
    x: head.x - direction.dx * i,
    y: head.y - direction.dy * i,
  }));
  return snakeAt(id, cells, direction, { growth });
}

/** Nothing is deadly: an empty arena with no walls, for isolating snake-on-snake rules. */
const nothingIsDeadly = () => false;

/** The real arena edge: anything outside the 24x24 grid kills (DESIGN-DECISIONS §1 row 9). */
const arenaWalls = (/** @type {Cell} */ cell) => !inBounds(cell, SETTINGS.grid);

/**
 * @param {Snake[]} stepping
 * @param {Snake[]} [all]
 * @param {(cell: Cell) => boolean | string | null | undefined} [isDeadly]
 */
function resolve(stepping, all = stepping, isDeadly = nothingIsDeadly) {
  return resolveStep({ steppingSnakes: stepping, allSnakes: all, isDeadly });
}

describe('KS-02-04 collisions', () => {
  describe('AC1 tails', () => {
    /**
     * A 2x2 coil: head at (5,5) having arrived from below, tail at (4,5) directly to its left. Turning LEFT
     * walks the head straight into the cell the tail is about to leave — the classic "chase your own tail".
     *
     * @param {{growth?: number}} [extra]
     * @returns {Snake}
     */
    function coiledSnake({ growth = 0 } = {}) {
      return snakeAt(
        'p1',
        [
          { x: 5, y: 5 },
          { x: 5, y: 4 },
          { x: 4, y: 4 },
          { x: 4, y: 5 },
        ],
        DIRECTIONS.UP,
        { growth, queued: DIRECTIONS.LEFT },
      );
    }

    it('KS-02-04 AC1: moving into your own tail cell is safe while you are not growing', () => {
      const snake = coiledSnake();
      expect(snake.nextHeadCell()).toEqual({ x: 4, y: 5 });
      expect(resolve([snake]).deaths).toEqual([]);
    });

    it('KS-02-04 AC1: moving into your own tail cell is death while you are growing', () => {
      const snake = coiledSnake({ growth: 1 });
      expect(snake.nextHeadCell()).toEqual({ x: 4, y: 5 });
      // The tail does not vacate — it stays to become the new segment — so the cell is still solid.
      expect(resolve([snake]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.SELF }]);
    });

    it('KS-02-04 AC1: moving into another stepping snake tail cell is safe while it is not growing', () => {
      // p1 heads right into (6,5); p2 runs upward with its tail sitting on exactly that cell.
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = snakeAt(
        'p2',
        [
          { x: 6, y: 8 },
          { x: 6, y: 7 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
        ],
        DIRECTIONS.UP,
      );
      expect(p1.nextHeadCell()).toEqual({ x: 6, y: 5 });
      expect(resolve([p1, p2]).deaths).toEqual([]);
    });

    it('KS-02-04 AC1: moving into another stepping snake tail cell is death while that snake is growing', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = snakeAt(
        'p2',
        [
          { x: 6, y: 8 },
          { x: 6, y: 7 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
        ],
        DIRECTIONS.UP,
        { growth: 1 },
      );
      expect(resolve([p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.BODY }]);
    });

    it('KS-02-04 AC1: a tail that is not stepping this tick does not vacate', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = snakeAt(
        'p2',
        [
          { x: 6, y: 8 },
          { x: 6, y: 7 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
        ],
        DIRECTIONS.UP,
      );
      // Only p1 is due to step — p2 stands still, so every one of its cells is solid.
      expect(resolve([p1], [p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.BODY }]);
    });
  });

  describe('AC2 two heads entering the same cell', () => {
    /**
     * p1 runs right from (5,5), p2 runs left from (7,5); both target (6,5).
     *
     * @param {number} p1Length
     * @param {number} p2Length
     */
    function headOnPair(p1Length, p2Length) {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT, p1Length);
      const p2 = straightSnake('p2', { x: 7, y: 5 }, DIRECTIONS.LEFT, p2Length);
      expect(p1.nextHeadCell()).toEqual({ x: 6, y: 5 });
      expect(p2.nextHeadCell()).toEqual({ x: 6, y: 5 });
      return [p1, p2];
    }

    it('KS-02-04 AC2: equal length — both die with HEAD_ON', () => {
      const [p1, p2] = headOnPair(4, 4);
      expect(resolve([p1, p2]).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.HEAD_ON },
        { snakeId: 'p2', cause: CAUSES.HEAD_ON },
      ]);
    });

    it('KS-02-04 AC2: lengths 5 vs 4 — only the length-4 snake dies with HEAD_ON', () => {
      const [p1, p2] = headOnPair(5, 4);
      // Row 8, owner-approved 2026-09-05: the longer snake survives a head-on.
      expect(resolve([p1, p2]).deaths).toEqual([{ snakeId: 'p2', cause: CAUSES.HEAD_ON }]);
    });

    it('KS-02-04 AC2: the length rule does not depend on which snake is listed first', () => {
      const [p1, p2] = headOnPair(4, 5);
      expect(resolve([p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.HEAD_ON }]);
    });

    it('KS-02-04 AC2: length is read before anything moves, so unpaid growth does not win a head-on', () => {
      const [p1, p2] = headOnPair(4, 4);
      // p1 ate an apple this tick but has not grown yet — it is still a length-4 snake meeting a length-4
      // snake, and both die. Judging on the length it is *about* to be would decide the round on an apple
      // the players cannot see it has swallowed.
      p1.grow(1);
      expect(resolve([p1, p2]).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.HEAD_ON },
        { snakeId: 'p2', cause: CAUSES.HEAD_ON },
      ]);
    });
  });

  describe('AC3 the swap', () => {
    /**
     * Adjacent snakes running at each other: p1's head is at (5,5) going right, p2's at (6,5) going left, so
     * each moves into the cell the other is leaving. Nobody shares a target cell, so only the swap rule
     * catches this.
     *
     * @param {number} p1Length
     * @param {number} p2Length
     */
    function swapPair(p1Length, p2Length) {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT, p1Length);
      const p2 = straightSnake('p2', { x: 6, y: 5 }, DIRECTIONS.LEFT, p2Length);
      expect(p1.nextHeadCell()).toEqual({ x: 6, y: 5 });
      expect(p2.nextHeadCell()).toEqual({ x: 5, y: 5 });
      return [p1, p2];
    }

    it('KS-02-04 AC3: equal length — both die with HEAD_ON', () => {
      const [p1, p2] = swapPair(4, 4);
      expect(resolve([p1, p2]).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.HEAD_ON },
        { snakeId: 'p2', cause: CAUSES.HEAD_ON },
      ]);
    });

    it('KS-02-04 AC3: lengths 5 vs 4 — only the length-4 snake dies with HEAD_ON', () => {
      const [p1, p2] = swapPair(5, 4);
      // The cell p1 moves into is p2's head now and p2's neck after the step, so a body-first evaluation
      // would report BODY and kill the longer snake too. The swap is a head-on, and row 8 decides it.
      expect(resolve([p1, p2]).deaths).toEqual([{ snakeId: 'p2', cause: CAUSES.HEAD_ON }]);
    });

    it('KS-02-04 AC3: the shorter snake dies whichever side it is on', () => {
      const [p1, p2] = swapPair(4, 5);
      expect(resolve([p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.HEAD_ON }]);
    });
  });

  describe('AC4 one mover, one stationary', () => {
    it('KS-02-04 AC4: only the mover dies, with BODY, when it enters a stationary head', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = straightSnake('p2', { x: 6, y: 5 }, DIRECTIONS.LEFT);
      expect(p1.nextHeadCell()).toEqual({ x: 6, y: 5 });
      // p2's accumulator is not due this tick: it is not in steppingSnakes, so it neither moves nor dies.
      // A head that is standing still is just another solid cell — this is not a head-on and the length
      // rule does not apply, which is why a slowed snake cannot be rammed to death by a shorter one.
      expect(resolve([p1], [p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.BODY }]);
    });

    it('KS-02-04 AC4: the length rule does not rescue a longer mover from a stationary head', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT, 9);
      const p2 = straightSnake('p2', { x: 6, y: 5 }, DIRECTIONS.LEFT, 4);
      expect(resolve([p1], [p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.BODY }]);
    });

    it('KS-02-04 AC4: entering a stationary snake mid-body is BODY too', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = snakeAt(
        'p2',
        [
          { x: 6, y: 7 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
          { x: 6, y: 4 },
        ],
        DIRECTIONS.UP,
      );
      expect(resolve([p1], [p1, p2]).deaths).toEqual([{ snakeId: 'p1', cause: CAUSES.BODY }]);
    });
  });

  describe('AC5 evaluation order', () => {
    it('KS-02-04 AC5: a cell that is both out of bounds and a body reports WALL', () => {
      // p1's head is on the left edge heading further left; p2's body occupies the very cell it would enter.
      const p1 = straightSnake('p1', { x: 0, y: 5 }, DIRECTIONS.LEFT);
      const p2 = snakeAt(
        'p2',
        [
          { x: -1, y: 5 },
          { x: -1, y: 6 },
          { x: -1, y: 7 },
          { x: -1, y: 8 },
        ],
        DIRECTIONS.DOWN,
      );
      expect(p1.nextHeadCell()).toEqual({ x: -1, y: 5 });
      expect(resolve([p1], [p1, p2], arenaWalls).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.WALL },
      ]);
    });

    it('KS-02-04 AC5: the same order holds for a laser cell that also holds a body', () => {
      // The version of AC5 that actually happens in play: a body may sit in the dead zone without dying
      // (DESIGN-DECISIONS §2.4), so a head entering that cell meets a laser and a body at once.
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = snakeAt(
        'p2',
        [
          { x: 6, y: 7 },
          { x: 6, y: 6 },
          { x: 6, y: 5 },
          { x: 6, y: 4 },
        ],
        DIRECTIONS.UP,
      );
      const laserAt6 = (/** @type {Cell} */ cell) => (cell.x === 6 ? CAUSES.LASER : false);
      expect(resolve([p1], [p1, p2], laserAt6).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.LASER },
      ]);
    });

    it('KS-02-04 AC5: wall beats self as well as body', () => {
      // Coiled against the left edge: turning LEFT is both off the board and into its own tail cell.
      const snake = snakeAt(
        'p1',
        [
          { x: 0, y: 5 },
          { x: 0, y: 4 },
          { x: 1, y: 4 },
          { x: 1, y: 5 },
        ],
        DIRECTIONS.UP,
        { queued: DIRECTIONS.LEFT, growth: 1 },
      );
      expect(snake.nextHeadCell()).toEqual({ x: -1, y: 5 });
      expect(resolve([snake], [snake], arenaWalls).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.WALL },
      ]);
    });

    it('KS-02-04 AC5: a boolean isDeadly is read as WALL, a returned cause is used as-is', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      expect(resolve([p1], [p1], () => true).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.WALL },
      ]);
      const p2 = straightSnake('p2', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      expect(resolve([p2], [p2], () => CAUSES.LASER).deaths).toEqual([
        { snakeId: 'p2', cause: CAUSES.LASER },
      ]);
    });
  });

  describe('simultaneity and bookkeeping', () => {
    it('KS-02-04: two snakes stepping into free cells produce no deaths', () => {
      const p1 = straightSnake('p1', { x: 5, y: 12 }, DIRECTIONS.RIGHT);
      const p2 = straightSnake('p2', { x: 18, y: 11 }, DIRECTIONS.LEFT);
      expect(resolve([p1, p2], [p1, p2], arenaWalls).deaths).toEqual([]);
    });

    it('KS-02-04: the no-input round ends with both snakes hitting opposite walls on the same step', () => {
      // The scenario KS-02-05 AC1 pins down, checked here at the collision layer: from the spawn cells in
      // DESIGN-DECISIONS §2.3, eighteen steps put P1 on x=23 and P2 on x=0, and the nineteenth takes both
      // off the board in the same tick.
      const p1 = straightSnake('p1', { x: 5, y: 12 }, DIRECTIONS.RIGHT);
      const p2 = straightSnake('p2', { x: 18, y: 11 }, DIRECTIONS.LEFT);
      for (let step = 1; step <= 18; step += 1) {
        expect(resolve([p1, p2], [p1, p2], arenaWalls).deaths).toEqual([]);
        p1.commitStep();
        p2.commitStep();
      }
      expect(p1.head).toEqual({ x: 23, y: 12 });
      expect(p2.head).toEqual({ x: 0, y: 11 });
      expect(resolve([p1, p2], [p1, p2], arenaWalls).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.WALL },
        { snakeId: 'p2', cause: CAUSES.WALL },
      ]);
    });

    it('KS-02-04: nothing is mutated — resolveStep only reads', () => {
      const [p1, p2] = [
        straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT),
        straightSnake('p2', { x: 7, y: 5 }, DIRECTIONS.LEFT),
      ];
      const before = JSON.stringify([p1.segments, p2.segments, p1.alive, p2.alive]);
      resolve([p1, p2]);
      expect(JSON.stringify([p1.segments, p2.segments, p1.alive, p2.alive])).toBe(before);
    });

    it('KS-02-04: deaths come back in steppingSnakes order, so the result is deterministic', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = straightSnake('p2', { x: 7, y: 5 }, DIRECTIONS.LEFT);
      expect(resolve([p2, p1]).deaths.map((death) => death.snakeId)).toEqual(['p2', 'p1']);
      const q1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const q2 = straightSnake('p2', { x: 7, y: 5 }, DIRECTIONS.LEFT);
      expect(resolve([q1, q2]).deaths.map((death) => death.snakeId)).toEqual(['p1', 'p2']);
    });

    it('KS-02-04: a dead snake neither dies again nor blocks anyone', () => {
      const p1 = straightSnake('p1', { x: 5, y: 5 }, DIRECTIONS.RIGHT);
      const p2 = straightSnake('p2', { x: 6, y: 5 }, DIRECTIONS.LEFT);
      p2.alive = false;
      // A corpse is not a wall: p1 walks through where p2 was. Sprint 02 ends the round on the first death
      // so this cannot arise yet, but leaving it undefined is how a Sprint 05 rematch bug is born.
      expect(resolve([p1, p2], [p1, p2]).deaths).toEqual([]);
    });

    it('KS-02-04: a snake dying at the wall still occupies its cells for this tick', () => {
      // p1 steps off the left edge and dies; p2 steps into the cell p1's head is leaving.
      const p1 = straightSnake('p1', { x: 0, y: 5 }, DIRECTIONS.LEFT);
      const p2 = straightSnake('p2', { x: 0, y: 4 }, DIRECTIONS.RIGHT, 1);
      p2.queueDirection(DIRECTIONS.UP);
      expect(p1.nextHeadCell()).toEqual({ x: -1, y: 5 });
      expect(p2.nextHeadCell()).toEqual({ x: 0, y: 5 });
      // (0, 5) is p1's *head*, which becomes its neck after the step, not its tail — so it stays solid and
      // p2 crashes into it. Both deaths are judged against the same frozen picture: p1 dying does not
      // retroactively clear the board for p2 within the tick they share. The round ends on the first death
      // anyway (DESIGN-DECISIONS §2.5), so this never decides a round; it is pinned because the alternative
      // — letting one death rewrite the picture the others are judged against — is where step-order
      // dependence creeps back in.
      expect(resolve([p1, p2], [p1, p2], arenaWalls).deaths).toEqual([
        { snakeId: 'p1', cause: CAUSES.WALL },
        { snakeId: 'p2', cause: CAUSES.BODY },
      ]);
    });

    it('KS-02-04: CAUSES is the frozen set of causes the ticket names', () => {
      expect(Object.keys(CAUSES)).toEqual(['WALL', 'LASER', 'SELF', 'BODY', 'HEAD_ON']);
      expect(Object.isFrozen(CAUSES)).toBe(true);
    });
  });
});
