// @ts-check

/**
 * Apple placement and lifecycle (DESIGN-DECISIONS §1 row 18/19, §2.3; ARCHITECTURE §4). Food persists until
 * collected and never despawns, and exactly `SETTINGS.foodCount` apples exist at all times during PLAYING —
 * `FoodState` below models that as a fixed-size array of *slots* that gets `respawn(index)`-ed one slot at a
 * time as apples are eaten. `RoundSimulation` (KS-02-05) owns the occupied-cell set and the snake heads; this
 * module knows nothing about snakes, only about cells.
 *
 * **Sprint 07 (KS-07-00, issue #102) adds the two rules that stop apples reading as a pattern.** The owner's
 * playtest found apples lining up in rows and columns, and the design lead's ruling — now
 * `DESIGN-DECISIONS §2.3`, "Apples never line up" — is that a new apple may share neither a row nor a column
 * with an apple already on the board, and must be at least `SETTINGS.foodMinDistanceFromFood` Chebyshev
 * cells from every one of them. The opening board obeys it too. Both rules are relaxable: see
 * {@link relaxationLadder} for the order `§2.3` fixes.
 *
 * **Sprint 04 (KS-04-01, issue #39) makes a slot allowed to be empty.** Once the lasers shrink the arena to
 * 6 × 6 the placement constraints can genuinely exclude every remaining cell, and the design lead's ruling on
 * #39 — now `DESIGN-DECISIONS §2.3`, "When nothing fits" — is: relax the head distance 2 → 1 → 0, and if even
 * that finds nothing, leave the slot empty and retry it every tick. In that state `foodCount` is a target,
 * not an invariant. So a slot holds `Cell | null`, {@link placeFoodWithFallback} is what a round calls, and
 * {@link placeFood} keeps throwing {@link NoFreeCellError} for the direct callers that want to hear about it.
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
 * The cells {@link placeFood} will consider, as an inclusive rectangle. Defaults to the whole grid; a round
 * in the laser phase passes the safe square instead, which is the only part of the board an apple may occupy
 * anyway and is 36 cells rather than 576 by the end of a round.
 *
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} Region
 */

/**
 * The legal cells for a new apple, or `null` when there are none.
 *
 * A cell is legal when it is in bounds, inside `region`, not `occupied`, not inside `deadZone`, and at least
 * `minDistance` Chebyshev cells from every entry in `heads`.
 *
 * Determinism (CLAUDE.md, ARCHITECTURE §4): candidate cells are enumerated in a fixed order — x ascending,
 * then y ascending within each x — never by iterating a `Set` or object keys, whose order is an
 * implementation detail. The legal cells are collected into a plain array first and then a single
 * `rng.pick` chooses among them. This "list then pick once" shape (rather than "guess a cell and retry
 * until free") makes a successful placement consume exactly one `rng` call regardless of how full the grid
 * is, which keeps the number of random draws independent of occupancy — retry-until-free would make the
 * golden event log in KS-02-05 fragile to unrelated changes in how crowded the arena happens to be. A
 * *failed* placement consumes none, which is what lets `§2.3`'s "retried every tick" cost nothing until the
 * tick it finally succeeds on.
 *
 * @param {PlacementParams} params
 * @returns {Cell | null}
 */
function findFreeCell({
  grid,
  occupied,
  heads = [],
  deadZone = noDeadZone,
  rng,
  minDistance = SETTINGS.foodMinDistanceFromHead,
  region,
  apples = [],
  minFoodDistance = SETTINGS.foodMinDistanceFromFood,
  noSharedRowOrColumn = SETTINGS.foodNoSharedRowOrColumn,
}) {
  const minX = Math.max(0, region?.minX ?? 0);
  const maxX = Math.min(grid.width - 1, region?.maxX ?? grid.width - 1);
  const minY = Math.max(0, region?.minY ?? 0);
  const maxY = Math.min(grid.height - 1, region?.maxY ?? grid.height - 1);

  const candidates = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      const cell = { x, y };
      if (!inBounds(cell, grid) || occupied.has(cellKey(cell)) || deadZone(cell)) {
        continue;
      }
      const tooCloseToAHead = heads.some((head) => chebyshev(cell, head) < minDistance);
      if (tooCloseToAHead) {
        continue;
      }
      const linesUpWithAnApple =
        noSharedRowOrColumn && apples.some((apple) => apple.x === x || apple.y === y);
      if (linesUpWithAnApple) {
        continue;
      }
      const tooCloseToAnApple = apples.some((apple) => chebyshev(cell, apple) < minFoodDistance);
      if (tooCloseToAnApple) {
        continue;
      }
      candidates.push(cell);
    }
  }
  if (candidates.length === 0) {
    return null;
  }
  return rng.pick(candidates);
}

/**
 * @typedef {object} PlacementParams
 * @property {GridSize} grid
 * @property {Set<string>} occupied - cell keys ({@link cellKey}) currently occupied by any snake segment
 * @property {Cell[]} [heads] - current head cells of every snake; defaults to `[]` (no heads yet)
 * @property {(cell: Cell) => boolean} [deadZone] - true for cells inside the laser dead zone; defaults to a
 *   predicate that always returns `false`
 * @property {Rng} rng
 * @property {number} [minDistance] - minimum Chebyshev distance from every head; defaults to
 *   `SETTINGS.foodMinDistanceFromHead`
 * @property {Region} [region] - cells to consider; defaults to the whole grid
 * @property {Cell[]} [apples] - the apples already on the board, which the new one must not line up with or
 *   crowd (DESIGN-DECISIONS §2.3 "Apples never line up"). Defaults to `[]`, which makes both apple rules
 *   no-ops — that is the shape {@link import('./powerups.js')} uses, since the ruling is about apples
 *   relative to each other and a power-up only has to avoid *standing on* one (that is `occupied`'s job)
 * @property {number} [minFoodDistance] - minimum Chebyshev distance from every entry in `apples`; defaults
 *   to `SETTINGS.foodMinDistanceFromFood`
 * @property {boolean} [noSharedRowOrColumn] - when true, reject any cell sharing a row or a column with an
 *   entry in `apples`; defaults to `SETTINGS.foodNoSharedRowOrColumn`
 */

/**
 * Picks a random free cell for a new apple, or throws when there is none.
 *
 * This is the strict placement rule of `DESIGN-DECISIONS §2.3` with no fallback: it is what a direct caller
 * (a test, a tool, a future editor) wants, because "there is nowhere legal" is real information. A round in
 * progress calls {@link placeFoodWithFallback} instead — `§2.3` says placement never throws inside a round.
 *
 * @param {PlacementParams} params
 * @returns {Cell}
 * @throws {NoFreeCellError} when no cell satisfies every constraint
 */
export function placeFood(params) {
  const cell = findFreeCell(params);
  if (cell === null) {
    throw new NoFreeCellError();
  }
  return cell;
}

/**
 * The rungs {@link placeFoodWithFallback} tries, hardest first, as `DESIGN-DECISIONS §2.3` orders them:
 * the full rule, then **drop the row/column rule**, then apple distance 2, 1, 0, and only then the
 * head-distance ladder from the #39 ruling (`minDistance − 1`, … down to 0).
 *
 * Writing the ladder out as data rather than as nested loops is what makes "the ladder relaxes in the stated
 * order" a thing a test can read: `relaxationLadder` is the order, and {@link placeFoodWithFallback} is just
 * "first rung that finds a cell wins".
 *
 * The apple rules come off before the head distance because they are about how the *board reads* — the owner
 * playtest finding (#102) is that lined-up apples look mechanical — while the head distance is about whether
 * the round is fair. Given a board where something has to give, a fair round with a slightly patterned one is
 * the better trade, and in a 6×6 endgame four apples cannot avoid sharing rows at all.
 *
 * @param {PlacementParams} params
 * @returns {PlacementParams[]}
 */
function relaxationLadder(params) {
  const minDistance = params.minDistance ?? SETTINGS.foodMinDistanceFromHead;
  // With no other apple on the board both apple rules are already satisfied by every cell, so the rungs that
  // relax them would each re-scan the same candidates and find the same answer. Collapsing them keeps a
  // caller that never has apples to compare against — a power-up spawn — at exactly the cost it had before
  // #102, and keeps the empty-board case out of the "which rung succeeded" reasoning entirely.
  const hasApples = (params.apples ?? []).length > 0;
  const minFoodDistance = hasApples
    ? (params.minFoodDistance ?? SETTINGS.foodMinDistanceFromFood)
    : 0;
  const noSharedRowOrColumn =
    hasApples && (params.noSharedRowOrColumn ?? SETTINGS.foodNoSharedRowOrColumn);

  /** @type {PlacementParams[]} */
  const rungs = [];
  if (noSharedRowOrColumn) {
    rungs.push({ ...params, minDistance, minFoodDistance, noSharedRowOrColumn: true });
  }
  for (let distance = minFoodDistance; distance >= 0; distance -= 1) {
    rungs.push({
      ...params,
      minDistance,
      minFoodDistance: distance,
      noSharedRowOrColumn: false,
    });
  }
  for (let head = minDistance - 1; head >= 0; head -= 1) {
    rungs.push({
      ...params,
      minDistance: head,
      minFoodDistance: 0,
      noSharedRowOrColumn: false,
    });
  }
  return rungs;
}

/**
 * Places an apple under `DESIGN-DECISIONS §2.3`'s fallback ladder (the design lead's ruling on issue #39,
 * extended by the ruling on #102): walk {@link relaxationLadder} and return the first cell any rung finds, or
 * `null` when even a cell touching a head is unavailable. Never throws.
 *
 * Occupancy and the dead zone are the two constraints that are never traded away — an apple inside a snake or
 * under a laser is not an apple — and everything else relaxes in the documented order, accepting that "an
 * apple occasionally appearing right in front of a snake, which in a 6×6 endgame is a gift rather than a
 * hazard".
 *
 * A rung that finds nothing costs no `rng` call (see {@link findFreeCell}: it lists candidates, then picks
 * once), so a placement still draws **exactly one** random number when it succeeds and **none** when it
 * fails, however many rungs were walked. That is what keeps a golden event log stable against a change in
 * how crowded the arena happens to be — including this one.
 *
 * @param {PlacementParams} params
 * @returns {Cell | null}
 */
export function placeFoodWithFallback(params) {
  for (const rung of relaxationLadder(params)) {
    const cell = findFreeCell(rung);
    if (cell !== null) return cell;
  }
  return null;
}

/**
 * Keeps `foodCount` apple **slots**, each holding a plain `{x, y}` cell or `null` when the arena has nowhere
 * legal to put one (`DESIGN-DECISIONS §2.3`, issue #39). Free of any reference to snakes: the occupied set,
 * heads and dead zone all change every simulation step, so `RoundSimulation` passes them into
 * {@link FoodState#fill} / {@link FoodState#respawn} rather than this class holding stale copies.
 *
 * A slot's index is its identity for the whole round — it is the `index` on every `FOOD_SPAWNED`,
 * `FOOD_EATEN` and `FOOD_REMOVED` event — which is why an empty slot stays in the array as `null` instead of
 * being spliced out and renumbering its neighbours.
 */
export class FoodState {
  /**
   * @param {object} params
   * @param {number} params.foodCount - how many apple slots this state holds (`SETTINGS.foodCount`)
   */
  constructor({ foodCount }) {
    /** @type {number} */
    this.foodCount = foodCount;
    /** @type {(Cell | null)[]} */
    this.apples = [];
  }

  /**
   * Fills every apple slot, in slot order (0, 1, 2, ...). Each apple placed is added to a working `occupied`
   * copy before the next is placed, so two apples never land on the same cell. Used once at round start
   * (DESIGN-DECISIONS §2.4: "4 apples present" when the round starts), where the board is empty enough that
   * every slot is filled — but a slot that cannot be filled is left `null` here too rather than throwing,
   * because `§2.3` says placement never throws inside a round and a round starts inside itself.
   *
   * @param {object} params
   * @param {GridSize} params.grid
   * @param {Set<string>} params.occupied - cells occupied by snakes; not mutated
   * @param {Cell[]} [params.heads]
   * @param {(cell: Cell) => boolean} [params.deadZone]
   * @param {Rng} params.rng
   * @param {number} [params.minDistance]
   * @param {Region} [params.region]
   * @param {number} [params.minFoodDistance]
   * @param {boolean} [params.noSharedRowOrColumn]
   */
  fill({
    grid,
    occupied,
    heads = [],
    deadZone = noDeadZone,
    rng,
    minDistance = SETTINGS.foodMinDistanceFromHead,
    region,
    minFoodDistance = SETTINGS.foodMinDistanceFromFood,
    noSharedRowOrColumn = SETTINGS.foodNoSharedRowOrColumn,
  }) {
    const working = new Set(occupied);
    this.apples = [];
    for (let i = 0; i < this.foodCount; i += 1) {
      const cell = placeFoodWithFallback({
        grid,
        occupied: working,
        heads,
        deadZone,
        rng,
        minDistance,
        region,
        // `§2.3`'s apple rules apply to the opening board too (#102), and the board fills one slot at a
        // time, so each apple is placed against the ones already down rather than against a snapshot taken
        // before any of them existed.
        apples: this.present(),
        minFoodDistance,
        noSharedRowOrColumn,
      });
      if (cell !== null) working.add(cellKey(cell));
      this.apples.push(cell);
    }
  }

  /**
   * Places a fresh apple in slot `index` (DESIGN-DECISIONS §1 row 19: "a collected apple respawns immediately
   * at a random free cell"), under `§2.3`'s fallback, and returns the cell it chose or `null` when the arena
   * had nowhere legal. `occupied` should reflect the board *after* the eaten apple's old cell is no longer
   * reserved for it but snake segments are current.
   *
   * The slot is written either way: a `null` return leaves it empty, which is the state `§2.3` says is
   * retried on every following tick.
   *
   * @param {number} index
   * @param {object} params
   * @param {GridSize} params.grid
   * @param {Set<string>} params.occupied
   * @param {Cell[]} [params.heads]
   * @param {(cell: Cell) => boolean} [params.deadZone]
   * @param {Rng} params.rng
   * @param {number} [params.minDistance]
   * @param {Region} [params.region]
   * @param {number} [params.minFoodDistance]
   * @param {boolean} [params.noSharedRowOrColumn]
   * @returns {Cell | null}
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
      region,
      minFoodDistance = SETTINGS.foodMinDistanceFromFood,
      noSharedRowOrColumn = SETTINGS.foodNoSharedRowOrColumn,
    },
  ) {
    // The other apples still on the board must stay off-limits, or two apples could land on the same cell.
    // They are also what `§2.3`'s row/column and distance rules are measured against, so the same pass
    // collects them as cells.
    const working = new Set(occupied);
    /** @type {Cell[]} */
    const others = [];
    for (let i = 0; i < this.apples.length; i += 1) {
      const other = this.apples[i];
      if (i !== index && other !== null) {
        working.add(cellKey(other));
        others.push(other);
      }
    }
    this.apples[index] = placeFoodWithFallback({
      grid,
      occupied: working,
      heads,
      deadZone,
      rng,
      minDistance,
      region,
      apples: others,
      minFoodDistance,
      noSharedRowOrColumn,
    });
    return this.apples[index];
  }

  /**
   * Empties slot `index` and returns the cell it held, or `null` if it was already empty. The one caller is
   * a laser step sweeping over the cell (`DESIGN-DECISIONS §2.4`); eating goes through {@link respawn},
   * which fills the slot again in the same breath.
   *
   * @param {number} index
   * @returns {Cell | null}
   */
  clear(index) {
    const cell = this.apples[index] ?? null;
    this.apples[index] = null;
    return cell;
  }

  /**
   * The index of the apple at `cell`, or `-1` if none. Used by the caller to detect `FOOD_EATEN`.
   *
   * @param {Cell} cell
   * @returns {number}
   */
  indexAt(cell) {
    return this.apples.findIndex(
      (apple) => apple !== null && apple.x === cell.x && apple.y === cell.y,
    );
  }

  /**
   * The apples actually on the board right now, empty slots skipped — a live view, not a copy, for callers
   * that only read (bots, the occupied-cell set). {@link getApples} is the snapshot.
   *
   * @returns {Cell[]}
   */
  present() {
    return /** @type {Cell[]} */ (this.apples.filter((apple) => apple !== null));
  }

  /**
   * Plain, JSON-serialisable snapshot of the current apple cells (ARCHITECTURE §4 `getState()`). Empty slots
   * are skipped rather than serialised as `null`: a renderer draws the apples that exist, and `§2.3` calls
   * `foodCount` a target rather than an invariant precisely so that "how many are on the board" is a real
   * number and not always four.
   *
   * @returns {Cell[]}
   */
  getApples() {
    return this.present().map((apple) => ({ x: apple.x, y: apple.y }));
  }
}
