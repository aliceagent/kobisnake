// @ts-check
import { DIRECTIONS, addDir, inBounds, isOpposite } from '../../../src/core/grid.js';
import { LASER_PHASES } from '../../../src/core/lasers.js';

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
 *
 * **KS-04-04 made this bot laser-aware** (`docs/sprints/sprint-04-closing-laser-arena.md`). Before this, two
 * careful snakes that both ignored the beams were routinely killed by the same step and drew — see
 * `tests/sim/stats.test.js`'s module doc for the control numbers (0 % before 0:30, 100 % during lasers, 100 %
 * draws). Two things changed:
 *
 * 1. `isImmediatelySafe`'s bounds check is replaced by `lasers.isDeadly(cell)` when a `lasers` view is
 *    available — a strict superset of "in bounds" (`src/core/lasers.js`'s module doc: the wall is just
 *    "inset −1", so the same query answers wall *and* dead-zone deaths). This is the ticket's "treat
 *    dead-zone cells as deadly".
 * 2. A candidate on the ring the *next* `LASER_STEP` will sweep — `onNextStepRing` below — is treated as
 *    deadly too ("treat next-step cells as deadly"), but **only while a next step is actually coming**
 *    (`lasers.phase` is `WARNING` or `CLOSING`). Before the beams have even warned, `inset` is still 0 and
 *    that ring is the cells directly against the wall — avoiding it unconditionally from second 0 would make
 *    this bot hug the centre of the arena for the first 60 seconds of every round for no reason, which is not
 *    what a human "sees the laser coming and gets out of the way" playstyle looks like and would quietly
 *    change every other statistic this bot is used to measure. Gating on `phase` is what keeps the new
 *    caution scoped to the part of the round it is actually about.
 */

/** @typedef {import('../../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../../src/core/grid.js').GridSize} GridSize */
/** @typedef {import('../../../src/core/snake.js').Snake} Snake */
/** @typedef {import('../../../src/core/lasers.js').Lasers} Lasers */

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
 * Whether `lasers` will sweep a new ring inward the next time it steps — true from the moment the warning
 * ignites (`WARNING`, still at inset 0) through every `CLOSING` step, false before the warning (`PARKED`,
 * nothing is scheduled yet) and once the minimum arena is reached (`STOPPED`, there is no next step).
 *
 * @param {Lasers} lasers
 * @returns {boolean}
 */
function nextStepIsImminent(lasers) {
  return lasers.phase === LASER_PHASES.WARNING || lasers.phase === LASER_PHASES.CLOSING;
}

/**
 * True for a cell on the outer ring of the *current* safe square — exactly the ring the next `LASER_STEP`
 * will turn into the dead zone (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-04: "at inset `n` that
 * is the ring at `n`"). Only meaningful while {@link nextStepIsImminent} is true; the caller is expected to
 * check that first.
 *
 * @param {Cell} cell
 * @param {Lasers} lasers
 * @returns {boolean}
 */
function onNextStepRing(cell, lasers) {
  const { minX, minY, maxX, maxY } = lasers.safeRegion();
  return cell.x === minX || cell.x === maxX || cell.y === minY || cell.y === maxY;
}

/**
 * Whether `cell` is immediately safe for `self`'s head to enter. `lasers` is optional only so this file keeps
 * working if ever called without one (`harness.js`'s `driveWithBots` always supplies it); when present it
 * replaces the plain bounds check with the laser system's own `isDeadly` (dead zone *and* the wall, off the
 * board included) and additionally rules out the next step's ring while one is imminent (see the module doc).
 *
 * @param {Cell} cell
 * @param {GridSize} grid
 * @param {Snake} self
 * @param {Snake[]} opponents
 * @param {Lasers} [lasers]
 * @returns {boolean}
 */
function isImmediatelySafe(cell, grid, self, opponents, lasers) {
  if (lasers) {
    if (lasers.isDeadly(cell)) return false;
    if (nextStepIsImminent(lasers) && onNextStepRing(cell, lasers)) return false;
  } else if (!inBounds(cell, grid)) {
    return false;
  }
  if (segmentsContain(ownBodyAfterStep(self), cell)) return false;
  return !opponents.some((opponent) => opponent.alive && segmentsContain(opponent.segments, cell));
}

/**
 * @param {Cell} cell
 * @param {GridSize} grid
 * @param {Snake} self
 * @param {Snake[]} opponents
 * @param {Lasers} [lasers]
 * @returns {number}
 */
function freeNeighborCount(cell, grid, self, opponents, lasers) {
  let count = 0;
  for (const direction of CARDINALS) {
    if (isImmediatelySafe(addDir(cell, direction), grid, self, opponents, lasers)) count += 1;
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
export function survivorBot({ self, others, grid, rng, lasers }) {
  const head = self.head;
  const candidates = candidateDirections(self.direction);

  /** @type {{score: number, direction: Direction} | null} */
  let best = null;
  for (const direction of candidates) {
    const next = addDir(head, direction);
    if (!isImmediatelySafe(next, grid, self, others, lasers)) continue;

    const free = freeNeighborCount(next, grid, self, others, lasers);
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
