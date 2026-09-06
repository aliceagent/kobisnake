// @ts-check
import { DIRECTIONS, addDir, inBounds, isOpposite } from '../../../src/core/grid.js';

/**
 * The "avoids death with two-step lookahead, ignores apples" bot of `QA-STRATEGY §4`. A faithful port of the
 * `survivor` function in `docs/design/spikes/design-validation-sim.py` onto the real `Snake`/`grid` API.
 *
 * "Two-step lookahead" is the candidate cell itself (step one) scored by how many of *its* neighbours are
 * also safe (step two) — exactly what `freeNeighborCount` below computes. A candidate that is safe right now
 * but boxes the snake into a corridor with nowhere to go next turn scores low, the same way it did in the
 * Python spike this ports.
 *
 * The helper functions below are duplicated from `greedyBot.js` rather than shared — see that file's module
 * doc for why: this ticket's `Files:` list names only the two bot files.
 */

/** @typedef {import('../../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../../src/core/grid.js').GridSize} GridSize */
/** @typedef {import('../../../src/core/snake.js').Snake} Snake */

const CARDINALS = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];

/**
 * @param {Direction} current
 * @returns {Direction[]}
 */
function candidateDirections(current) {
  return CARDINALS.filter((direction) => !isOpposite(direction, current));
}

/**
 * @param {Cell[]} segments
 * @param {Cell} cell
 * @returns {boolean}
 */
function segmentsContain(segments, cell) {
  return segments.some((segment) => segment.x === cell.x && segment.y === cell.y);
}

/**
 * @param {Snake} self
 * @returns {Cell[]}
 */
function ownBodyAfterStep(self) {
  return self.pendingGrowth > 0 ? self.segments : self.segments.slice(0, -1);
}

/**
 * @param {Cell} cell
 * @param {GridSize} grid
 * @param {Snake} self
 * @param {Snake[]} opponents
 * @returns {boolean}
 */
function isImmediatelySafe(cell, grid, self, opponents) {
  if (!inBounds(cell, grid)) return false;
  if (segmentsContain(ownBodyAfterStep(self), cell)) return false;
  return !opponents.some((opponent) => opponent.alive && segmentsContain(opponent.segments, cell));
}

/**
 * @param {Cell} cell
 * @param {GridSize} grid
 * @param {Snake} self
 * @param {Snake[]} opponents
 * @returns {number}
 */
function freeNeighborCount(cell, grid, self, opponents) {
  let count = 0;
  for (const direction of CARDINALS) {
    if (isImmediatelySafe(addDir(cell, direction), grid, self, opponents)) count += 1;
  }
  return count;
}

/**
 * @param {Cell} a
 * @param {Cell} b
 * @returns {number}
 */
function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * @param {import('../harness.js').BotView} view
 * @returns {Direction | null}
 */
export function survivorBot({ self, others, grid, rng }) {
  const head = self.head;
  const candidates = candidateDirections(self.direction);

  /** @type {{score: number, direction: Direction} | null} */
  let best = null;
  for (const direction of candidates) {
    const next = addDir(head, direction);
    if (!isImmediatelySafe(next, grid, self, others)) continue;

    const free = freeNeighborCount(next, grid, self, others);
    const threatened = others.some(
      (opponent) => opponent.alive && manhattan(opponent.head, next) <= 1,
    );
    const straightBonus = direction === self.direction ? 3 : 0;
    // Mirrors design-validation-sim.py's survivor(): free space dominates the score (weight 10, versus
    // greedyBot's distance term which tops out far lower), a small bias to keep going straight, this bot's
    // own rng stream for tie-breaking, and a heavy penalty for a cell next to a living opponent's head.
    const score = free * 10 + straightBonus + rng.next() - (threatened ? 25 : 0);
    if (best === null || score > best.score) best = { score, direction };
  }

  if (best === null || best.direction === self.direction) return null;
  return best.direction;
}
