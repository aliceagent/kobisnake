// @ts-check
import { describe, expect, it } from 'vitest';
import { Snake } from '../../../src/core/snake.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/** @typedef {import('../../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */

/**
 * P1's start shape from DESIGN-DECISIONS §2.3: head at (5, 12) heading right, body extending left,
 * `startingSnakeLength` (4) segments.
 *
 * @param {number} [length]
 * @returns {Cell[]}
 */
function startCells(length = SETTINGS.startingSnakeLength) {
  return Array.from({ length }, (_, i) => ({ x: 5 - i, y: 12 }));
}

/**
 * @param {object} [options]
 * @param {Cell[]} [options.cells]
 * @param {Direction} [options.direction]
 * @param {import('../../../src/core/settings.js').Settings} [options.settings]
 * @returns {Snake}
 */
function makeSnake({
  cells = startCells(),
  direction = DIRECTIONS.RIGHT,
  settings = SETTINGS,
} = {}) {
  return new Snake({ id: 'p1', cells, direction, settings });
}

describe('KS-02-02 snake', () => {
  describe('AC1 input rules (DESIGN-DECISIONS §2.2)', () => {
    it('KS-02-02 AC1: a reversal of the current direction is ignored', () => {
      const snake = makeSnake();
      expect(snake.queueDirection(DIRECTIONS.LEFT)).toBe(false);
      expect(snake.queue).toEqual([]);
      // And it did not secretly change the committed direction either.
      expect(snake.direction).toBe(DIRECTIONS.RIGHT);
    });

    it('KS-02-02 AC1: a reversal of the last *queued* direction is ignored', () => {
      const snake = makeSnake();
      expect(snake.queueDirection(DIRECTIONS.UP)).toBe(true);
      expect(snake.queueDirection(DIRECTIONS.DOWN)).toBe(false);
      expect(snake.queue).toEqual([DIRECTIONS.UP]);
    });

    it('KS-02-02 AC1: a duplicate of the current direction is ignored', () => {
      const snake = makeSnake();
      expect(snake.queueDirection(DIRECTIONS.RIGHT)).toBe(false);
      expect(snake.queue).toEqual([]);
    });

    it('KS-02-02 AC1: a duplicate of the last queued direction is ignored', () => {
      const snake = makeSnake();
      snake.queueDirection(DIRECTIONS.UP);
      expect(snake.queueDirection(DIRECTIONS.UP)).toBe(false);
      expect(snake.queue).toEqual([DIRECTIONS.UP]);
    });

    it('KS-02-02 AC1: a third input while two are queued is dropped', () => {
      const snake = makeSnake();
      expect(snake.settings.inputBufferSize).toBe(2);
      expect(snake.queueDirection(DIRECTIONS.UP)).toBe(true);
      expect(snake.queueDirection(DIRECTIONS.LEFT)).toBe(true);
      // Legal on its own — DOWN is a clean 90° turn from LEFT — but the buffer is full, so it is dropped.
      expect(snake.queueDirection(DIRECTIONS.DOWN)).toBe(false);
      expect(snake.queue).toEqual([DIRECTIONS.UP, DIRECTIONS.LEFT]);
    });

    it('KS-02-02 AC1: an ignored input never consumes a buffer slot a real turn could use', () => {
      const snake = makeSnake();
      snake.queueDirection(DIRECTIONS.UP);
      snake.queueDirection(DIRECTIONS.DOWN); // reversal of the queued UP — rejected
      snake.queueDirection(DIRECTIONS.UP); // duplicate of the queued UP — rejected
      expect(snake.queueDirection(DIRECTIONS.LEFT)).toBe(true);
      expect(snake.queue).toEqual([DIRECTIONS.UP, DIRECTIONS.LEFT]);
    });

    it('KS-02-02 AC1: directions are compared by value, not identity', () => {
      const snake = makeSnake();
      // A caller that builds its own vector instead of using a DIRECTIONS constant must get the same rules.
      expect(snake.queueDirection({ dx: -1, dy: 0 })).toBe(false); // reversal of RIGHT
      expect(snake.queueDirection({ dx: 1, dy: 0 })).toBe(false); // duplicate of RIGHT
      expect(snake.queueDirection({ dx: 0, dy: 1 })).toBe(true); // a real turn
    });
  });

  describe('AC2 queued turns are consumed one per step', () => {
    it('KS-02-02 AC2: up-then-left within one step yields two turns on two consecutive steps', () => {
      const snake = makeSnake();
      // Both inputs arrive before any step is due — the buffer is what makes the second one survive.
      expect(snake.queueDirection(DIRECTIONS.UP)).toBe(true);
      expect(snake.queueDirection(DIRECTIONS.LEFT)).toBe(true);

      expect(snake.nextHeadCell()).toEqual({ x: 5, y: 13 });
      snake.commitStep();
      expect(snake.direction).toBe(DIRECTIONS.UP);
      expect(snake.head).toEqual({ x: 5, y: 13 });
      expect(snake.queue).toEqual([DIRECTIONS.LEFT]);

      expect(snake.nextHeadCell()).toEqual({ x: 4, y: 13 });
      snake.commitStep();
      expect(snake.direction).toBe(DIRECTIONS.LEFT);
      expect(snake.head).toEqual({ x: 4, y: 13 });
      expect(snake.queue).toEqual([]);

      // A third step with an empty queue carries straight on in the last committed direction.
      snake.commitStep();
      expect(snake.head).toEqual({ x: 3, y: 13 });
      expect(snake.direction).toBe(DIRECTIONS.LEFT);
    });

    it('KS-02-02 AC2: every segment follows the path of the one in front (image 09)', () => {
      const snake = makeSnake();
      snake.queueDirection(DIRECTIONS.UP);
      snake.commitStep();
      // The body has not teleported: each segment took the cell its predecessor just left.
      expect(snake.segments).toEqual([
        { x: 5, y: 13 },
        { x: 5, y: 12 },
        { x: 4, y: 12 },
        { x: 3, y: 12 },
      ]);
    });

    it('KS-02-02 AC2: nextHeadCell reads the queue without consuming it', () => {
      const snake = makeSnake();
      snake.queueDirection(DIRECTIONS.UP);
      expect(snake.nextHeadCell()).toEqual({ x: 5, y: 13 });
      expect(snake.nextHeadCell()).toEqual({ x: 5, y: 13 });
      expect(snake.queue).toEqual([DIRECTIONS.UP]);
    });
  });

  describe('AC3 growth', () => {
    it('KS-02-02 AC3: after grow(1) the next step adds a segment and length increases by exactly 1', () => {
      const snake = makeSnake();
      const before = snake.length;
      snake.grow(1);
      expect(snake.pendingGrowth).toBe(1);

      snake.commitStep();
      expect(snake.length).toBe(before + 1);
      expect(snake.pendingGrowth).toBe(0);
      // The head advanced and the tail stayed put — that is what "grew" means on a grid.
      expect(snake.segments[0]).toEqual({ x: 6, y: 12 });
      expect(snake.segments[snake.length - 1]).toEqual({ x: 2, y: 12 });

      // And the growth is paid off exactly once: the step after it drops the tail again.
      snake.commitStep();
      expect(snake.length).toBe(before + 1);
    });

    it('KS-02-02 AC3: grow(n) is paid off one segment per step', () => {
      const snake = makeSnake();
      const before = snake.length;
      snake.grow(3);
      for (let i = 1; i <= 3; i += 1) {
        snake.commitStep();
        expect(snake.length).toBe(before + i);
      }
      snake.commitStep();
      expect(snake.length).toBe(before + 3);
    });

    it('KS-02-02 AC3: grow() defaults to one segment', () => {
      const snake = makeSnake();
      snake.grow();
      snake.commitStep();
      expect(snake.length).toBe(SETTINGS.startingSnakeLength + 1);
    });
  });

  describe('AC4 the movement accumulator', () => {
    it('KS-02-02 AC4: at speed 6 and dt 1/120, a step is due every 20 accumulations', () => {
      const snake = makeSnake();
      const dt = 1 / SETTINGS.simHz;
      expect(SETTINGS.snakeSpeed).toBe(6);

      for (let cycle = 0; cycle < 3; cycle += 1) {
        for (let i = 0; i < 19; i += 1) {
          expect(snake.accumulate(dt)).toBe(false);
        }
        expect(snake.accumulate(dt)).toBe(true);
      }
    });

    it('KS-02-02 AC4: at multiplier 1.5 the fractional carry is preserved — 3 steps in 40 accumulations', () => {
      const snake = makeSnake();
      snake.speedMultiplier = SETTINGS.speedBoost.multiplier;
      expect(snake.speedMultiplier).toBe(1.5);
      const dt = 1 / SETTINGS.simHz;

      let steps = 0;
      /** @type {number[]} */
      const stepsAt = [];
      for (let i = 1; i <= 40; i += 1) {
        if (snake.accumulate(dt)) {
          steps += 1;
          stepsAt.push(i);
        }
      }
      // 1/13.3 of a cell per accumulation: steps land on the 14th, 27th and 40th, not every 13 or every 14.
      // Dropping the remainder instead of carrying it would give 2 steps here, and a boosted snake would
      // silently travel less far than the design says it does.
      expect(steps).toBe(3);
      expect(stepsAt).toEqual([14, 27, 40]);
    });

    it('KS-02-02 AC4: a slowed snake steps every 1/0.6 as often as the base rate', () => {
      const snake = makeSnake();
      snake.speedMultiplier = SETTINGS.slow.multiplier;
      const dt = 1 / SETTINGS.simHz;
      let steps = 0;
      // 3.6 cells/s for one simulated second is 3.6 cells: 3 steps, with 0.6 of a cell carried over.
      for (let i = 0; i < SETTINGS.simHz; i += 1) {
        if (snake.accumulate(dt)) steps += 1;
      }
      expect(steps).toBe(3);
      expect(snake.stepProgress).toBeCloseTo(0.6, 9);
    });

    it('KS-02-02 AC4: stepProgress carries the remainder rather than resetting to zero', () => {
      const snake = makeSnake();
      // Two thirds of a cell at a time: the step is due on the second call, with a third of a cell left.
      expect(snake.accumulate(1 / 9)).toBe(false);
      expect(snake.accumulate(1 / 9)).toBe(true);
      expect(snake.stepProgress).toBeCloseTo(1 / 3, 12);
    });

    it('KS-02-02 AC4: stepProgress is the renderer interpolation alpha, 0 <= alpha < 1', () => {
      const snake = makeSnake();
      const dt = 1 / SETTINGS.simHz;
      for (let i = 0; i < 500; i += 1) {
        snake.accumulate(dt);
        expect(snake.stepProgress).toBeGreaterThanOrEqual(-1e-9);
        expect(snake.stepProgress).toBeLessThan(1);
      }
    });

    it('KS-02-02 AC4: speed comes from settings, so a slower arena really is slower', () => {
      const snake = makeSnake({ settings: withOverrides({ snakeSpeed: 3 }) });
      const dt = 1 / SETTINGS.simHz;
      for (let i = 0; i < 39; i += 1) {
        expect(snake.accumulate(dt)).toBe(false);
      }
      expect(snake.accumulate(dt)).toBe(true);
    });
  });

  describe('AC5 previousSegments', () => {
    it('KS-02-02 AC5: previousSegments has the same length as segments after an ordinary step', () => {
      const snake = makeSnake();
      snake.commitStep();
      expect(snake.previousSegments).toHaveLength(snake.segments.length);
      expect(snake.previousSegments).toEqual([
        { x: 5, y: 12 },
        { x: 4, y: 12 },
        { x: 3, y: 12 },
        { x: 2, y: 12 },
      ]);
    });

    it('KS-02-02 AC5: previousSegments matches segments on a growth step, duplicating the tail', () => {
      const snake = makeSnake();
      const oldTail = { ...snake.segments[snake.length - 1] };
      snake.grow(1);
      snake.commitStep();

      expect(snake.previousSegments).toHaveLength(snake.segments.length);
      // The new segment has no previous cell of its own, so it starts life where the old tail was and
      // grows out of it rather than flying in from nowhere.
      expect(snake.previousSegments[snake.previousSegments.length - 1]).toEqual(oldTail);
      expect(snake.previousSegments[snake.previousSegments.length - 2]).toEqual(oldTail);
    });

    it('KS-02-02 AC5: the lengths stay equal through a mixed run of growth and plain steps', () => {
      const snake = makeSnake();
      for (let i = 0; i < 12; i += 1) {
        if (i % 3 === 0) snake.grow(1);
        snake.commitStep();
        expect(snake.previousSegments).toHaveLength(snake.segments.length);
      }
    });

    it('KS-02-02 AC5: previousSegments never aliases a live segment', () => {
      const snake = makeSnake();
      snake.commitStep();
      const previousHead = snake.previousSegments[0];
      snake.commitStep();
      // Mutating segments through a later step must not rewrite the snapshot handed to the renderer.
      expect(previousHead).toEqual({ x: 5, y: 12 });
      for (const cell of snake.previousSegments) {
        expect(snake.segments).not.toContain(cell);
      }
    });

    it('KS-02-02 AC5: before the first step, previousSegments is the start position', () => {
      const snake = makeSnake();
      expect(snake.previousSegments).toEqual(snake.segments);
      expect(snake.previousSegments).not.toBe(snake.segments);
    });
  });

  describe('construction', () => {
    it('KS-02-02: the constructor copies the cells it is given', () => {
      const cells = startCells();
      const snake = makeSnake({ cells });
      snake.commitStep();
      expect(cells).toEqual(startCells());
    });

    it('KS-02-02: a new snake is alive, unqueued, un-owed and at base speed', () => {
      const snake = makeSnake();
      expect(snake.alive).toBe(true);
      expect(snake.queue).toEqual([]);
      expect(snake.pendingGrowth).toBe(0);
      expect(snake.speedMultiplier).toBe(1);
      expect(snake.stepProgress).toBe(0);
      expect(snake.length).toBe(SETTINGS.startingSnakeLength);
      expect(snake.head).toEqual({ x: 5, y: 12 });
      expect(snake.id).toBe('p1');
    });

    it('KS-02-02: P2 mirrors P1 — start (18, 11) heading left (DESIGN-DECISIONS §2.3)', () => {
      const snake = new Snake({
        id: 'p2',
        cells: Array.from({ length: 4 }, (_, i) => ({ x: 18 + i, y: 11 })),
        direction: DIRECTIONS.LEFT,
        settings: SETTINGS,
      });
      expect(snake.nextHeadCell()).toEqual({ x: 17, y: 11 });
      snake.commitStep();
      expect(snake.head).toEqual({ x: 17, y: 11 });
    });
  });
});
