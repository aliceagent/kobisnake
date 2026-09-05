// @ts-check

/**
 * Apple placement and lifecycle (DESIGN-DECISIONS §1 row 18/19, §2.3; ARCHITECTURE §4). Food persists until
 * collected and never despawns, and exactly `SETTINGS.foodCount` apples exist at all times during PLAYING —
 * `FoodState` below models that as a fixed-size array of cells that gets `respawn(index)`-ed one slot at a
 * time as apples are eaten. `RoundSimulation` (KS-02-05) owns the occupied-cell set and the snake heads; this
 * module knows nothing about snakes, only about cells.
 */

import { cellKey, chebyshev, inBounds } from './grid.js';
import { SETTINGS } from './settings.js';

/**
 * @typedef {import('./grid.js').Cell} Cell
 * @typedef {import('./grid.js').GridSize} GridSize
 * @typedef {import('./rng.js').Rng} Rng
 */

/**
 * Thrown by {@link placeFood} when no cell satisfies every constraint (grid genuinely full, or every free
 * cell is excluded by `minDistance`/`deadZone` — DESIGN-DECISIONS §2.3, the 6x6 final laser arena is where
 * this actually happens in play). Exported as a named class, with `name` set explicitly, so callers can
 * `catch (e) { if (e instanceof NoFreeCellError) ... }` even after minification drops constructor names.
 */
export class NoFreeCellError extends Error {
  constructor(message = 'placeFood: no legal cell available') {
    super(message);
    this.name = 'NoFreeCellError';
  }
}

/** Default `deadZone` predicate: nothing is excluded. Lasers (Sprint 04) pass a real one. */
function noDeadZone() {
  return false;
}

/**
 * Picks a random free cell for a new apple.
 *
 * A cell is legal when it is in bounds, not `occupied`, not inside `deadZone`, and at least `minDistance`
 * Chebyshev cells from every entry in `heads`.
 *
 * Determinism (CLAUDE.md, ARCHITECTURE §4): candidate cells are enumerated in a fixed order — x ascending,
 * then y ascending within each x — never by iterating a `Set` or object keys, whose order is an
 * implementation detail. The legal cells are collected into a plain array first and then a single
 * `rng.pick` chooses among them. This "list then pick once" shape (rather than "guess a cell and retry
 * until free") makes `placeFood` consume exactly one `rng` call regardless of how full the grid is, which
 * keeps the number of random draws independent of occupancy — retry-until-free would make the golden event
 * log in KS-02-05 fragile to unrelated changes in how crowded the arena happens to be.
 *
 * @param {object} params
 * @param {GridSize} params.grid
 * @param {Set<string>} params.occupied - cell keys ({@link cellKey}) currently occupied by any snake segment
 * @param {Cell[]} [params.heads] - current head cells of every snake; defaults to `[]` (no heads yet)
 * @param {(cell: Cell) => boolean} [params.deadZone] - true for cells inside the laser dead zone; defaults
 *   to a predicate that always returns `false` (Sprint 02 has no lasers yet)
 * @param {Rng} params.rng
 * @param {number} [params.minDistance] - minimum Chebyshev distance from every head; defaults to
 *   `SETTINGS.foodMinDistanceFromHead`
 * @returns {Cell}
 * @throws {NoFreeCellError} when no cell satisfies every constraint
 */
export function placeFood({
  grid,
  occupied,
  heads = [],
  deadZone = noDeadZone,
  rng,
  minDistance = SETTINGS.foodMinDistanceFromHead,
}) {
  const candidates = [];
  for (let x = 0; x < grid.width; x += 1) {
    for (let y = 0; y < grid.height; y += 1) {
      const cell = { x, y };
      if (!inBounds(cell, grid) || occupied.has(cellKey(cell)) || deadZone(cell)) {
        continue;
      }
      const tooCloseToAHead = heads.some((head) => chebyshev(cell, head) < minDistance);
      if (tooCloseToAHead) {
        continue;
      }
      candidates.push(cell);
    }
  }
  if (candidates.length === 0) {
    throw new NoFreeCellError();
  }
  return rng.pick(candidates);
}

/**
 * Keeps exactly `foodCount` apples as plain `{x, y}` cells. Free of any reference to snakes: the occupied
 * set, heads and dead zone all change every simulation step, so `RoundSimulation` passes them into
 * {@link FoodState#fill} / {@link FoodState#respawn} rather than this class holding stale copies.
 */
export class FoodState {
  /**
   * @param {object} params
   * @param {number} params.foodCount - how many apples this state holds (`SETTINGS.foodCount`)
   */
  constructor({ foodCount }) {
    /** @type {number} */
    this.foodCount = foodCount;
    /** @type {Cell[]} */
    this.apples = [];
  }

  /**
   * Fills every apple slot with a freshly placed cell, in slot order (0, 1, 2, ...). Each apple placed is
   * added to a working `occupied` copy before the next is placed, so two apples never land on the same
   * cell. Used once at round start (DESIGN-DECISIONS §2.4: "4 apples present" when the round starts).
   *
   * @param {object} params
   * @param {GridSize} params.grid
   * @param {Set<string>} params.occupied - cells occupied by snakes; not mutated
   * @param {Cell[]} [params.heads]
   * @param {(cell: Cell) => boolean} [params.deadZone]
   * @param {Rng} params.rng
   * @param {number} [params.minDistance]
   */
  fill({
    grid,
    occupied,
    heads = [],
    deadZone = noDeadZone,
    rng,
    minDistance = SETTINGS.foodMinDistanceFromHead,
  }) {
    const working = new Set(occupied);
    this.apples = [];
    for (let i = 0; i < this.foodCount; i += 1) {
      const cell = placeFood({ grid, occupied: working, heads, deadZone, rng, minDistance });
      working.add(cellKey(cell));
      this.apples.push(cell);
    }
  }

  /**
   * Replaces the apple at `index` with a freshly placed cell (DESIGN-DECISIONS §1 row 19: "a collected apple
   * respawns immediately at a random free cell"). `occupied` should reflect the board *after* the eaten
   * apple's old cell is no longer reserved for it but snake segments are current.
   *
   * @param {number} index
   * @param {object} params
   * @param {GridSize} params.grid
   * @param {Set<string>} params.occupied
   * @param {Cell[]} [params.heads]
   * @param {(cell: Cell) => boolean} [params.deadZone]
   * @param {Rng} params.rng
   * @param {number} [params.minDistance]
   */
  respawn(
    index,
    {
      grid,
      occupied,
      heads = [],
      deadZone = noDeadZone,
      rng,
      minDistance = SETTINGS.foodMinDistanceFromHead,
    },
  ) {
    // The other apples still on the board must stay off-limits, or two apples could land on the same cell.
    const working = new Set(occupied);
    for (let i = 0; i < this.apples.length; i += 1) {
      if (i !== index) {
        working.add(cellKey(this.apples[i]));
      }
    }
    this.apples[index] = placeFood({ grid, occupied: working, heads, deadZone, rng, minDistance });
  }

  /**
   * The index of the apple at `cell`, or `-1` if none. Used by the caller to detect `FOOD_EATEN`.
   *
   * @param {Cell} cell
   * @returns {number}
   */
  indexAt(cell) {
    return this.apples.findIndex((apple) => apple.x === cell.x && apple.y === cell.y);
  }

  /**
   * Plain, JSON-serialisable snapshot of the current apple cells (ARCHITECTURE §4 `getState()`).
   *
   * @returns {Cell[]}
   */
  getApples() {
    return this.apples.map((apple) => ({ x: apple.x, y: apple.y }));
  }
}
