// @ts-check
import { DIRECTIONS, addDir, inBounds, isOpposite } from '../../../src/core/grid.js';

/**
 * The "heads for the nearest apple" bot of `QA-STRATEGY §4`: greedy, one-step-safe, otherwise oblivious.
 * A faithful port of the `greedy` function in `docs/design/spikes/design-validation-sim.py` — the reference
 * these numbers were validated against — onto the real `Snake`/`grid` API instead of the spike's plain tuples.
 *
 * The small helper functions below (`candidateDirections`, `isImmediatelySafe`, `freeNeighborCount`) are
 * duplicated verbatim in `survivorBot.js` rather than factored into a shared module: this ticket's `Files:`
 * list names only the two bot files, and each is short enough that the duplication costs nothing a reader
 * would notice.
 *
 * **KS-06-04** (`tests/sim/powerupStats.test.js`) made this bot prefer a power-up over an apple when the
 * power-up is closer, per the ticket spec read literally: nearest target wins, and the power-up is preferred
 * on a tie. This is deliberately *not* a value model — no "a power-up is worth N apples" weighting — because
 * inventing one would be inventing a mechanic (`CLAUDE.md`). `view.powerups` (`../harness.js`) is a live list
 * of `{cell, type}` pickups, added to `BotView` for this ticket; the bot does not care which `type` it is,
 * matching "power-up" rather than "speed boost" in the spec.
 */

/** @typedef {import('../harness.js').Bot} Bot */
/** @typedef {import('../../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../../src/core/grid.js').GridSize} GridSize */
/** @typedef {import('../../../src/core/snake.js').Snake} Snake */

const CARDINALS = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];

/**
 * The three directions that are not a straight reversal of `current` — the only ones `Snake.queueDirection`
 * would ever accept (`DESIGN-DECISIONS §2.2`), so there is no point offering the fourth.
 *
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
 * `self`'s own segments as they will be solid *after* it takes this step: the tail cell vacates unless an
 * apple eaten earlier is still owed a segment (`collisions.js`'s `occupiedAfterStep`, simplified here since a
 * bot only ever asks this about its own upcoming step).
 *
 * @param {Snake} self
 * @returns {Cell[]}
 */
function ownBodyAfterStep(self) {
  return self.pendingGrowth > 0 ? self.segments : self.segments.slice(0, -1);
}

/**
 * Whether `cell` is immediately safe for `self`'s head to enter: in bounds, not `self`'s own body, and not
 * currently any living opponent's body. This does not account for an opponent also moving away from a cell it
 * occupies right now (the real engine's simultaneous-step resolution does, `collisions.js`) — matching the
 * spike this bot is ported from, and an acceptable simplification for a bot whose job is to be *good enough*
 * to measure design health, not to play optimally.
 *
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
 * How many of `cell`'s four neighbours would themselves be immediately safe — a cheap one-ply look beyond the
 * candidate cell itself, so the bot does not walk into a dead-end corridor just because the corridor's mouth
 * happens to be the closest cell to the apple.
 *
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
export function greedyBot({ self, others, apples, powerups, grid, rng }) {
  const head = self.head;
  const candidates = candidateDirections(self.direction);

  /** @type {{score: number, direction: Direction} | null} */
  let best = null;
  for (const direction of candidates) {
    const next = addDir(head, direction);
    if (!isImmediatelySafe(next, grid, self, others)) continue;
    if (freeNeighborCount(next, grid, self, others) === 0) continue; // a dead-end is as good as a wall

    // Power-up cells listed first: `nearest`'s reduce only replaces the running closest on a *strictly*
    // smaller distance, so a power-up at the same distance as the nearest apple stays chosen — "prefers a
    // power-up over an apple if closer" (KS-06-04), tie going to the power-up, nearest target wins otherwise.
    const targets = [...(powerups ?? []).map((pickup) => pickup.cell), ...apples];
    const target = targets.length > 0 ? nearest(targets, next) : next;
    const threatened = others.some(
      (opponent) => opponent.alive && manhattan(opponent.head, next) <= 1,
    );
    // Mirrors design-validation-sim.py's greedy(): close the distance to the nearest apple, break ties with a
    // little randomness (this bot's own rng stream, never the round's), and heavily penalise moving next to
    // an opponent's head, where a head-on is one bad step away.
    const score = -manhattan(target, next) + rng.next() * 0.5 - (threatened ? 30 : 0);
    if (best === null || score > best.score) best = { score, direction };
  }

  if (best === null || best.direction === self.direction) return null;
  return best.direction;
}

/**
 * @param {Cell[]} cells
 * @param {Cell} from
 * @returns {Cell}
 */
function nearest(cells, from) {
  return cells.reduce((closest, cell) =>
    manhattan(cell, from) < manhattan(closest, from) ? cell : closest,
  );
}
