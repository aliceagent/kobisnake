// @ts-check

/**
 * Grid primitives shared by every part of the simulation (ARCHITECTURE §4). Origin is bottom-left, x
 * increases to the right, y increases upward (DESIGN-DECISIONS §2.1) — a cell is one world unit.
 */

/**
 * @typedef {{x: number, y: number}} Cell
 * @typedef {{dx: number, dy: number}} Direction
 * @typedef {{width: number, height: number}} GridSize
 */

/**
 * The four cardinal step vectors a snake can move in. Frozen so nobody accidentally mutates a shared
 * direction object out from under every snake that references it.
 *
 * @type {{UP: Direction, DOWN: Direction, LEFT: Direction, RIGHT: Direction}}
 */
export const DIRECTIONS = Object.freeze({
  UP: Object.freeze({ dx: 0, dy: 1 }),
  DOWN: Object.freeze({ dx: 0, dy: -1 }),
  LEFT: Object.freeze({ dx: -1, dy: 0 }),
  RIGHT: Object.freeze({ dx: 1, dy: 0 }),
});

/**
 * True when `a` and `b` are exact opposites (UP/DOWN or LEFT/RIGHT) — the "ignore the reverse of the last
 * committed or last queued direction" rule (DESIGN-DECISIONS §2.2).
 *
 * @param {Direction} a
 * @param {Direction} b
 * @returns {boolean}
 */
export function isOpposite(a, b) {
  return a.dx === -b.dx && a.dy === -b.dy;
}

/**
 * The cell one step from `cell` in direction `dir`. Does not clamp to a grid — see {@link inBounds}.
 *
 * @param {Cell} cell
 * @param {Direction} dir
 * @returns {Cell}
 */
export function addDir(cell, dir) {
  return { x: cell.x + dir.dx, y: cell.y + dir.dy };
}

/**
 * True when `cell` is inside a `grid.width` x `grid.height` arena (0-indexed, inclusive of the near edges,
 * exclusive of `width`/`height`).
 *
 * @param {Cell} cell
 * @param {GridSize} grid
 * @returns {boolean}
 */
export function inBounds(cell, grid) {
  return cell.x >= 0 && cell.x < grid.width && cell.y >= 0 && cell.y < grid.height;
}

/**
 * A stable string key for a cell, suitable for `Set`/`Map` membership (occupied cells, visited cells, …).
 *
 * @param {Cell} cell
 * @returns {string}
 */
export function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

/**
 * Chebyshev (chessboard) distance between two cells: `max(|dx|, |dy|)`. Used for the food/power-up
 * minimum-distance-from-head rules (DESIGN-DECISIONS §2.3), which read as "N cells away in any direction,
 * diagonals included".
 *
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
