// @ts-check
import { describe, expect, it } from 'vitest';
import { FoodState, NoFreeCellError, placeFood } from '../../../src/core/food.js';
import { cellKey } from '../../../src/core/grid.js';
import { createRng } from '../../../src/core/rng.js';
import { SETTINGS } from '../../../src/core/settings.js';

const GRID_6X6 = { width: 6, height: 6 };

/** Builds a `Set<cellKey>` of the first `count` cells in x-ascending, y-ascending order. */
function firstOccupiedCells(grid, count) {
  const occupied = new Set();
  let placed = 0;
  for (let x = 0; x < grid.width && placed < count; x += 1) {
    for (let y = 0; y < grid.height && placed < count; y += 1) {
      occupied.add(cellKey({ x, y }));
      placed += 1;
    }
  }
  return occupied;
}

/** Minimal fake Rng that always picks the first element — used where the specific cell chosen does not
 * matter, only that `placeFood` does not throw or misbehave. */
function firstPickRng() {
  return { next: () => 0, int: () => 0, pick: (array) => array[0], seed: 0 };
}

describe('KS-02-03 placeFood', () => {
  it('KS-02-03 AC1: never returns an occupied cell in 10000 seeded trials on a 6x6 grid with 20 occupied cells', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 20);
    expect(occupied.size).toBe(20); // 36 cells total, 16 free — sanity per the tech-lead note
    for (let seed = 0; seed < 10000; seed += 1) {
      const rng = createRng(seed);
      const cell = placeFood({ grid: GRID_6X6, occupied, rng });
      expect(occupied.has(cellKey(cell))).toBe(false);
    }
  });

  it('KS-02-03 AC2: respects minDistance from every head', () => {
    const heads = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ];
    const minDistance = 2;
    const occupied = new Set();
    for (let seed = 0; seed < 2000; seed += 1) {
      const rng = createRng(seed);
      const cell = placeFood({ grid: GRID_6X6, occupied, heads, rng, minDistance });
      for (const head of heads) {
        const dx = Math.abs(cell.x - head.x);
        const dy = Math.abs(cell.y - head.y);
        expect(Math.max(dx, dy)).toBeGreaterThanOrEqual(minDistance);
      }
    }
  });

  it('KS-02-03 AC2: minDistance defaults to SETTINGS.foodMinDistanceFromHead when omitted', () => {
    // Asserts against the design value, not a literal, so this stays a test of "the default tracks
    // SETTINGS" rather than a test that would keep passing (and lying) if Fable retunes the number at
    // Playtest Gate 1 and food.js's default silently did not follow.
    const heads = [{ x: 2, y: 2 }];
    const occupied = new Set();
    const rng = createRng(1);
    const cell = placeFood({ grid: GRID_6X6, occupied, heads, rng });
    expect(Math.max(Math.abs(cell.x - 2), Math.abs(cell.y - 2))).toBeGreaterThanOrEqual(
      SETTINGS.foodMinDistanceFromHead,
    );
  });

  it('KS-02-03 AC3: throws NoFreeCellError when every cell is occupied', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 36);
    const rng = createRng(1);
    expect(() => placeFood({ grid: GRID_6X6, occupied, rng })).toThrow(NoFreeCellError);
  });

  it('KS-02-03 AC3: throws NoFreeCellError when every free cell is excluded by minDistance (a small final arena with two long snakes)', () => {
    // The scenario the tech lead flagged as the one that actually happens in play: a 6x6 laser arena is
    // nowhere near empty, but every cell that IS free is too close to a head. No cell is occupied here —
    // the exclusion is entirely from minDistance — proving AC3's second failure mode is distinct from a
    // literally full grid.
    const occupied = new Set();
    const heads = [
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    const rng = createRng(1);
    expect(() => placeFood({ grid: GRID_6X6, occupied, heads, rng, minDistance: 6 })).toThrow(
      NoFreeCellError,
    );
  });

  it('KS-02-03 AC3: throws NoFreeCellError when deadZone excludes every remaining free cell', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 20); // 16 free cells left
    const rng = createRng(1);
    expect(() => placeFood({ grid: GRID_6X6, occupied, deadZone: () => true, rng })).toThrow(
      NoFreeCellError,
    );
  });

  it('KS-02-03 AC3: NoFreeCellError has a stable name after being thrown', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 36);
    const rng = createRng(1);
    try {
      placeFood({ grid: GRID_6X6, occupied, rng });
      throw new Error('expected placeFood to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(NoFreeCellError);
      expect(error.name).toBe('NoFreeCellError');
    }
  });

  it('KS-02-03 AC4: deterministic for a given seed and occupancy', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 20);
    const heads = [{ x: 0, y: 0 }];
    const resultA = placeFood({
      grid: GRID_6X6,
      occupied,
      heads,
      rng: createRng(777),
      minDistance: 2,
    });
    const resultB = placeFood({
      grid: GRID_6X6,
      occupied,
      heads,
      rng: createRng(777),
      minDistance: 2,
    });
    expect(resultA).toEqual(resultB);
  });

  it('KS-02-03 AC4: the same occupancy with a different seed can pick a different cell', () => {
    // Not every seed pair must differ (both could legally land on the same free cell), but across many
    // seeds at least one pair must disagree, or the RNG draw is not actually influencing the result.
    const occupied = firstOccupiedCells(GRID_6X6, 20);
    const results = new Set();
    for (let seed = 0; seed < 50; seed += 1) {
      const cell = placeFood({ grid: GRID_6X6, occupied, rng: createRng(seed) });
      results.add(cellKey(cell));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('KS-02-03: consumes exactly one rng.pick call regardless of occupancy (fixed draw count for determinism)', () => {
    let pickCalls = 0;
    let intCalls = 0;
    const rng = {
      next: () => 0,
      int: () => {
        intCalls += 1;
        return 0;
      },
      pick: (array) => {
        pickCalls += 1;
        return array[0];
      },
      seed: 0,
    };
    placeFood({ grid: GRID_6X6, occupied: firstOccupiedCells(GRID_6X6, 20), rng });
    expect(pickCalls).toBe(1);
    expect(intCalls).toBe(0);
  });

  it('KS-02-03: candidate cells are enumerated x-ascending then y-ascending (fixed, documented order)', () => {
    // Occupy every cell except (0,0) and (5,5); a spy rng records the candidate list handed to pick().
    const occupied = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (!(x === 0 && y === 0) && !(x === 5 && y === 5)) {
          occupied.add(cellKey({ x, y }));
        }
      }
    }
    let seenCandidates = null;
    const spyRng = {
      next: () => 0,
      int: () => 0,
      pick: (array) => (seenCandidates = array)[0],
      seed: 0,
    };
    placeFood({ grid: GRID_6X6, occupied, rng: spyRng });
    expect(seenCandidates).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
    ]);
  });

  it('KS-02-03: deadZone defaults to excluding nothing when omitted', () => {
    const cell = placeFood({ grid: GRID_6X6, occupied: new Set(), rng: firstPickRng() });
    expect(cell).toEqual({ x: 0, y: 0 });
  });

  it('KS-02-03: heads defaults to an empty array when omitted', () => {
    expect(() =>
      placeFood({ grid: GRID_6X6, occupied: new Set(), rng: firstPickRng() }),
    ).not.toThrow();
  });
});

describe('KS-02-03 FoodState', () => {
  it('fills exactly foodCount apples at construction time, none overlapping', () => {
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: createRng(3) });
    expect(state.apples).toHaveLength(4);
    const keys = new Set(state.apples.map(cellKey));
    expect(keys.size).toBe(4); // no two apples share a cell
  });

  it('fill respects the occupied set passed in (e.g. snake bodies)', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 30); // 6 free cells left
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied, rng: createRng(9) });
    for (const apple of state.apples) {
      expect(occupied.has(cellKey(apple))).toBe(false);
    }
  });

  it('respawn(index) replaces only that slot, leaving the others untouched', () => {
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: createRng(5) });
    const before = state.getApples();
    state.respawn(1, { grid: GRID_6X6, occupied: new Set(), rng: createRng(42) });
    expect(state.apples[0]).toEqual(before[0]);
    expect(state.apples[2]).toEqual(before[2]);
    expect(state.apples[3]).toEqual(before[3]);
  });

  it('respawn never lands a new apple on another apple still on the board', () => {
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: createRng(5) });
    state.respawn(0, { grid: GRID_6X6, occupied: new Set(), rng: createRng(5) });
    const keys = state.apples.map(cellKey);
    expect(new Set(keys).size).toBe(4);
  });

  it('indexAt finds the apple at a cell, or -1 when none is there', () => {
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: createRng(5) });
    const target = state.apples[2];
    expect(state.indexAt(target)).toBe(2);
    expect(state.indexAt({ x: -1, y: -1 })).toBe(-1);
  });

  it('getApples returns a plain, independent, JSON-serialisable snapshot', () => {
    const state = new FoodState({ foodCount: 4 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: createRng(5) });
    const snapshot = state.getApples();
    expect(JSON.stringify(snapshot)).toEqual(JSON.stringify(state.apples));
    snapshot[0].x = -999; // mutating the snapshot must not affect internal state
    expect(state.apples[0].x).not.toBe(-999);
  });
});
