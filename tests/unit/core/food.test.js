// @ts-check
import { describe, expect, it } from 'vitest';
import {
  FoodState,
  NoFreeCellError,
  placeFood,
  placeFoodWithFallback,
} from '../../../src/core/food.js';
import { cellKey } from '../../../src/core/grid.js';
import { createRng } from '../../../src/core/rng.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { RoundSimulation } from '../../../src/core/round.js';

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

describe('KS-04-01 AC4 the "when nothing fits" fallback (DESIGN-DECISIONS §2.3, issue #39)', () => {
  /** A head in the middle of a 6x6 board: at distance 2 it excludes a 5x5 block, leaving eight cells. */
  const CENTRE_HEAD = [{ x: 2, y: 2 }];

  it('KS-04-01 AC4: takes the strict distance when the strict distance still fits', () => {
    const cell = placeFoodWithFallback({
      grid: GRID_6X6,
      occupied: new Set(),
      heads: CENTRE_HEAD,
      rng: firstPickRng(),
      minDistance: 2,
    });
    expect(cell).not.toBeNull();
    expect(
      Math.max(
        Math.abs(/** @type {any} */ (cell).x - 2),
        Math.abs(/** @type {any} */ (cell).y - 2),
      ),
    ).toBeGreaterThanOrEqual(2);
  });

  it('KS-04-01 AC4: relaxes 2 -> 1 when nothing sits two cells from a head', () => {
    // Everything at Chebyshev distance >= 2 from the head is occupied, so distance 2 has no candidate and
    // distance 1 does. `placeFood` itself would throw here; the round must not.
    const occupied = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (Math.max(Math.abs(x - 2), Math.abs(y - 2)) >= 2) occupied.add(cellKey({ x, y }));
      }
    }
    const params = { grid: GRID_6X6, occupied, heads: CENTRE_HEAD, rng: firstPickRng() };

    expect(() => placeFood({ ...params, minDistance: 2 })).toThrow(NoFreeCellError);
    const cell = placeFoodWithFallback({ ...params, minDistance: 2 });
    expect(
      Math.max(
        Math.abs(/** @type {any} */ (cell).x - 2),
        Math.abs(/** @type {any} */ (cell).y - 2),
      ),
    ).toBe(1);
  });

  it('KS-04-01 AC4: relaxes all the way to 0, so an apple may appear under a head', () => {
    // Only the head's own cell is free.
    const occupied = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (!(x === 2 && y === 2)) occupied.add(cellKey({ x, y }));
      }
    }
    const cell = placeFoodWithFallback({
      grid: GRID_6X6,
      occupied,
      heads: CENTRE_HEAD,
      rng: firstPickRng(),
      minDistance: 2,
    });
    expect(cell).toEqual({ x: 2, y: 2 });
  });

  it('KS-04-01 AC4: returns null instead of throwing when the board is genuinely full', () => {
    const occupied = firstOccupiedCells(GRID_6X6, 36);
    const params = { grid: GRID_6X6, occupied, rng: firstPickRng() };
    expect(() => placeFood(params)).toThrow(NoFreeCellError);
    expect(placeFoodWithFallback(params)).toBeNull();
  });

  it('KS-04-01 AC4: a failed placement draws no random number, so retrying every tick is free', () => {
    let draws = 0;
    const countingRng = {
      next: () => 0,
      int: () => 0,
      pick: (/** @type {any[]} */ array) => {
        draws += 1;
        return array[0];
      },
      seed: 0,
    };
    expect(
      placeFoodWithFallback({
        grid: GRID_6X6,
        occupied: firstOccupiedCells(GRID_6X6, 36),
        rng: countingRng,
      }),
    ).toBeNull();
    expect(draws).toBe(0);

    // And exactly one draw when it succeeds, whatever rung of the ladder it succeeded on.
    placeFoodWithFallback({ grid: GRID_6X6, occupied: new Set(), rng: countingRng });
    expect(draws).toBe(1);
  });

  it('KS-04-01 AC4: `region` narrows the search to the laser safe square', () => {
    const region = { minX: 2, minY: 2, maxX: 3, maxY: 3 };
    for (let seed = 0; seed < 50; seed += 1) {
      const cell = placeFood({
        grid: GRID_6X6,
        occupied: new Set(),
        rng: createRng(seed),
        minDistance: 0,
        region,
      });
      expect(cell.x).toBeGreaterThanOrEqual(2);
      expect(cell.x).toBeLessThanOrEqual(3);
      expect(cell.y).toBeGreaterThanOrEqual(2);
      expect(cell.y).toBeLessThanOrEqual(3);
    }
  });

  it('KS-04-01 AC4: a slot with nowhere to go stays empty and out of the snapshot', () => {
    const state = new FoodState({ foodCount: 2 });
    state.fill({ grid: GRID_6X6, occupied: firstOccupiedCells(GRID_6X6, 36), rng: firstPickRng() });

    expect(state.apples).toEqual([null, null]);
    expect(state.getApples()).toEqual([]);
    expect(state.present()).toEqual([]);
    expect(state.indexAt({ x: 0, y: 0 })).toBe(-1);

    // The slot keeps its index: refilling slot 1 leaves slot 0 empty rather than renumbering.
    state.respawn(1, { grid: GRID_6X6, occupied: new Set(), rng: firstPickRng() });
    expect(state.apples[0]).toBeNull();
    expect(state.apples[1]).toEqual({ x: 0, y: 0 });
    expect(state.getApples()).toEqual([{ x: 0, y: 0 }]);
    expect(state.indexAt({ x: 0, y: 0 })).toBe(1);
  });

  it('KS-04-01 AC4: clear() empties a slot and hands back what it held', () => {
    const state = new FoodState({ foodCount: 2 });
    state.fill({ grid: GRID_6X6, occupied: new Set(), rng: firstPickRng() });
    const held = state.apples[0];

    expect(state.clear(0)).toEqual(held);
    expect(state.apples[0]).toBeNull();
    expect(state.clear(0)).toBeNull();
  });
});

describe('KS-07-00 AC1/AC2 "apples never line up" (DESIGN-DECISIONS §2.3, issue #102)', () => {
  const FULL_GRID = SETTINGS.grid;
  // The two starting heads, DESIGN-DECISIONS §2.3. The opening board is placed against these.
  const SPAWN_HEADS = [
    { x: 5, y: 12 },
    { x: 18, y: 11 },
  ];

  /**
   * Every way `§2.3` says two apples may not sit relative to each other, as a list of readable complaints.
   * Returns `[]` for a board that obeys the rule, which makes a failure message name the offending pair
   * instead of just "expected true to be false".
   *
   * @param {{x: number, y: number}[]} apples
   * @returns {string[]}
   */
  function ruleViolations(apples) {
    const complaints = [];
    for (let i = 0; i < apples.length; i += 1) {
      for (let j = i + 1; j < apples.length; j += 1) {
        const a = apples[i];
        const b = apples[j];
        if (a.x === b.x) complaints.push(`(${a.x},${a.y}) and (${b.x},${b.y}) share column ${a.x}`);
        if (a.y === b.y) complaints.push(`(${a.x},${a.y}) and (${b.x},${b.y}) share row ${a.y}`);
        const distance = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
        if (distance < SETTINGS.foodMinDistanceFromFood) {
          complaints.push(`(${a.x},${a.y}) and (${b.x},${b.y}) are only ${distance} apart`);
        }
      }
    }
    return complaints;
  }

  it('KS-07-00 AC1: the opening board never lines apples up, over 500 seeds', () => {
    // The rule "applies to the opening board too" (§2.3), and the opening board is filled one slot at a
    // time, so each apple has to be placed against the ones already down rather than against an empty board.
    for (let seed = 0; seed < 500; seed += 1) {
      const state = new FoodState({ foodCount: SETTINGS.foodCount });
      state.fill({
        grid: FULL_GRID,
        occupied: new Set(),
        heads: SPAWN_HEADS,
        rng: createRng(seed),
      });
      expect(state.apples).toHaveLength(SETTINGS.foodCount);
      expect(state.present()).toHaveLength(SETTINGS.foodCount);
      expect(ruleViolations(state.getApples())).toEqual([]);
    }
  });

  it('KS-07-00 AC1: 10000 seeded respawns never violate the rule on a board with room', () => {
    // A 24x24 board with three other apples on it always has a legal cell, so this asserts the rule
    // unconditionally; the ladder's behaviour when there is *no* legal cell is the next three tests.
    const state = new FoodState({ foodCount: SETTINGS.foodCount });
    state.fill({ grid: FULL_GRID, occupied: new Set(), heads: SPAWN_HEADS, rng: createRng(1) });

    for (let seed = 0; seed < 10000; seed += 1) {
      const index = seed % SETTINGS.foodCount;
      const cell = state.respawn(index, {
        grid: FULL_GRID,
        occupied: new Set(),
        heads: SPAWN_HEADS,
        rng: createRng(seed),
      });
      expect(cell).not.toBeNull();
      expect(ruleViolations(state.getApples())).toEqual([]);
    }
  });

  it('KS-07-00 AC1: the ladder drops the row/column rule before it shortens the apple distance', () => {
    // Two free cells, each legal on exactly one rung: (0,3) shares a column with the apple at (0,0) but is
    // the full 3 cells away, and (2,2) shares neither row nor column but is only 2 away. §2.3's order is
    // "drop the row/column rule, then apple distance 2, 1, 0", so (0,3) must win.
    const apple = { x: 0, y: 0 };
    const occupied = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (!(x === 0 && y === 3) && !(x === 2 && y === 2)) occupied.add(cellKey({ x, y }));
      }
    }
    const cell = placeFoodWithFallback({
      grid: GRID_6X6,
      occupied,
      rng: firstPickRng(),
      minDistance: 0,
      apples: [apple],
    });
    expect(cell).toEqual({ x: 0, y: 3 });
  });

  it('KS-07-00 AC1: the ladder shortens the apple distance before it shortens the head distance', () => {
    // (1,1) is 1 cell from the apple at (0,0) and far from the head; (5,4) is far from the apple but 1 cell
    // from the head at (5,5). §2.3 puts the whole apple ladder ahead of the head-distance ladder, so the
    // apple rung wins and (1,1) is chosen.
    const occupied = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (!(x === 1 && y === 1) && !(x === 5 && y === 4)) occupied.add(cellKey({ x, y }));
      }
    }
    const cell = placeFoodWithFallback({
      grid: GRID_6X6,
      occupied,
      heads: [{ x: 5, y: 5 }],
      rng: firstPickRng(),
      minDistance: SETTINGS.foodMinDistanceFromHead,
      apples: [{ x: 0, y: 0 }],
    });
    expect(cell).toEqual({ x: 1, y: 1 });
  });

  it('KS-07-00 AC1: the 6x6 endgame of #39 still never throws with the apple rules on', () => {
    // Issue #39's case, now with three apples crowding the same square: four apples cannot all avoid each
    // other's rows and columns in a 6x6, so the ladder has to relax — and must still hand back a cell
    // rather than throw or return null while one is free.
    const region = { minX: 9, minY: 9, maxX: 14, maxY: 14 };
    const apples = [
      { x: 9, y: 9 },
      { x: 10, y: 10 },
      { x: 11, y: 11 },
    ];
    for (let seed = 0; seed < 200; seed += 1) {
      const cell = placeFoodWithFallback({
        grid: FULL_GRID,
        occupied: new Set(apples.map(cellKey)),
        heads: [{ x: 12, y: 12 }],
        rng: createRng(seed),
        region,
        apples,
      });
      expect(cell).not.toBeNull();
      expect(cell.x).toBeGreaterThanOrEqual(9);
      expect(cell.x).toBeLessThanOrEqual(14);
      expect(cell.y).toBeGreaterThanOrEqual(9);
      expect(cell.y).toBeLessThanOrEqual(14);
    }

    // And when the square is genuinely full it still returns null instead of throwing (§2.3, "never throws
    // inside a round").
    const full = new Set();
    for (let x = 9; x <= 14; x += 1) {
      for (let y = 9; y <= 14; y += 1) full.add(cellKey({ x, y }));
    }
    expect(() =>
      placeFoodWithFallback({
        grid: FULL_GRID,
        occupied: full,
        rng: firstPickRng(),
        region,
        apples,
      }),
    ).not.toThrow();
  });

  it('KS-07-00 AC2: a placement that fails every rung draws no random number', () => {
    let draws = 0;
    const countingRng = {
      next: () => 0,
      int: () => 0,
      pick: (/** @type {any[]} */ array) => {
        draws += 1;
        return array[0];
      },
      seed: 0,
    };
    const apples = [{ x: 0, y: 0 }];

    // Nowhere to go: every rung of the longer ladder scans, none picks.
    expect(
      placeFoodWithFallback({
        grid: GRID_6X6,
        occupied: firstOccupiedCells(GRID_6X6, 36),
        rng: countingRng,
        apples,
      }),
    ).toBeNull();
    expect(draws).toBe(0);

    // And still exactly one draw when a placement succeeds, whichever rung succeeded — which is what keeps
    // the rng stream, and so every golden log's *timing*, independent of how crowded the board is.
    placeFoodWithFallback({ grid: GRID_6X6, occupied: new Set(), rng: countingRng, apples });
    expect(draws).toBe(1);

    const occupiedButForOneLinedUpCell = new Set();
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        if (!(x === 0 && y === 4)) occupiedButForOneLinedUpCell.add(cellKey({ x, y }));
      }
    }
    expect(
      placeFoodWithFallback({
        grid: GRID_6X6,
        occupied: occupiedButForOneLinedUpCell,
        rng: countingRng,
        apples,
      }),
    ).toEqual({ x: 0, y: 4 });
    expect(draws).toBe(2);
  });

  it('KS-07-00 AC1: a real round opens on a board that obeys the rule, and reads it from its settings', () => {
    // `RoundSimulation` is what wires §4's two new values into placement, and it is the only place where
    // getting that wiring wrong would leave every test above green while the actual game ignored the rule.
    // The second half is the same round with the rule overridden off: it must then be *possible* to line
    // apples up, or `round.js` is reading `food.js`'s module defaults rather than its own settings.
    const players = [
      { id: 'p1', color: 'red' },
      { id: 'p2', color: 'blue' },
    ];
    for (let seed = 0; seed < 200; seed += 1) {
      const sim = new RoundSimulation({ settings: SETTINGS, seed, players });
      expect(ruleViolations(sim.food.getApples())).toEqual([]);
    }

    const relaxed = withOverrides({ foodNoSharedRowOrColumn: false, foodMinDistanceFromFood: 0 });
    let sawALinedUpBoard = false;
    for (let seed = 0; seed < 200 && !sawALinedUpBoard; seed += 1) {
      const sim = new RoundSimulation({ settings: relaxed, seed, players });
      sawALinedUpBoard = ruleViolations(sim.food.getApples()).length > 0;
    }
    expect(sawALinedUpBoard).toBe(true);
  });

  it('KS-07-00 AC2: power-up placement is unchanged — no apples passed, no apple rules applied', () => {
    // `powerups.js` calls `placeFoodWithFallback` without `apples`, and §2.3's ruling is about apples
    // relative to each other. A power-up must not *stand on* an apple, which is `occupied`'s job in
    // `round.js`, but it may share a row with one.
    let draws = 0;
    const countingRng = {
      next: () => 0,
      int: () => 0,
      pick: (/** @type {any[]} */ array) => {
        draws += 1;
        return array[0];
      },
      seed: 0,
    };
    const cell = placeFoodWithFallback({ grid: GRID_6X6, occupied: new Set(), rng: countingRng });
    expect(cell).toEqual({ x: 0, y: 0 });
    expect(draws).toBe(1);
  });
});
