// @ts-check
import { cellKey } from './grid.js';

/**
 * Death evaluation for one simulation tick (`DESIGN-DECISIONS §2.5`, `ARCHITECTURE §4`).
 *
 * Every snake due to step this tick is stepped **simultaneously**: all the new head cells are computed
 * first, then every death is judged against that one frozen picture. Resolving snakes one at a time would
 * make the outcome depend on the order they happen to be listed in — the first mover would step into an
 * empty cell and the second would crash into it — and head-to-head would stop being symmetric.
 */

/** @typedef {import('./grid.js').Cell} Cell */
/** @typedef {import('./snake.js').Snake} Snake */

/**
 * Why a snake died. `WALL` and `LASER` are both "the head entered a cell it may not be in" and are told
 * apart by the `isDeadly` callback the caller supplies, because only the caller knows where the lasers are
 * (`ARCHITECTURE §4`: "Walls are simply inset −1, so the same query answers wall and laser deaths").
 *
 * @type {{WALL: 'WALL', LASER: 'LASER', SELF: 'SELF', BODY: 'BODY', HEAD_ON: 'HEAD_ON'}}
 */
export const CAUSES = Object.freeze({
  WALL: 'WALL',
  LASER: 'LASER',
  SELF: 'SELF',
  BODY: 'BODY',
  HEAD_ON: 'HEAD_ON',
});

/** @typedef {'WALL' | 'LASER' | 'SELF' | 'BODY' | 'HEAD_ON'} DeathCause */
/** @typedef {{snakeId: string, cause: DeathCause}} Death */

/**
 * Answers "is this cell fatal to a head entering it, and why".
 *
 * Returning a cause rather than a bare boolean is what lets a single query cover both the outer wall and the
 * laser dead zone, which is exactly how the design treats them: the laser phase changes *where* the deadly
 * edge is, not whether there is one (`DESIGN-DECISIONS §1 row 9`). A plain `true` is accepted and read as
 * `WALL`, so a caller with no lasers yet — every caller in Sprint 02 — can pass an ordinary predicate.
 *
 * @callback IsDeadly
 * @param {Cell} cell
 * @returns {boolean | DeathCause | null | undefined}
 */

/**
 * The cells a snake still occupies *after* this tick resolves, as seen by a head arriving in one of them.
 *
 * A stepping snake's tail vacates its cell, so moving into it is safe — the classic "chase your own tail"
 * rule (AC1). Unless it is growing: then the tail stays put to become the new segment, and that same cell
 * kills. A snake that is not stepping this tick does not move at all, so every one of its cells is solid,
 * its head included — which is why running into a stationary head is `BODY` and not a head-on (AC4).
 *
 * @param {Snake} snake
 * @param {boolean} isStepping
 * @returns {Set<string>}
 */
function occupiedAfterStep(snake, isStepping) {
  const vacatesTail = isStepping && snake.pendingGrowth === 0;
  const solid = vacatesTail ? snake.segments.slice(0, -1) : snake.segments;
  return new Set(solid.map(cellKey));
}

/**
 * Resolves every death caused by this tick's simultaneous steps.
 *
 * Evaluation order per `DESIGN-DECISIONS §2.5`: wall/laser, self, other snake head, other snake body.
 *
 * §2.5 lists "other snake body" before "other snake head"; the two are swapped here for one case, which the
 * ticket itself calls a head-on: the **swap**, where A moves into B's current head cell while B moves into
 * A's. After a step, B's old head cell is still occupied — it has become B's neck — so checking body first
 * would report `BODY` for both snakes and kill the longer one too, contradicting row 8 and AC3. Nothing else
 * in the order changes: a cell that is both out of bounds and a body still reports `WALL` (AC5), and running
 * into a body that is not part of a head-on still reports `BODY`.
 *
 * Head-on resolves by length: **the longer snake survives, equal lengths both die** (`DESIGN-DECISIONS §1
 * row 8`, owner-approved 2026-09-05). Lengths are read from the frozen picture, before anything moves, so
 * growth that has not been paid off yet cannot retroactively win a collision.
 *
 * @param {object} options
 * @param {Snake[]} options.steppingSnakes - the snakes whose movement accumulator came due this tick
 * @param {Snake[]} options.allSnakes - every snake in the round, stepping or not
 * @param {IsDeadly} options.isDeadly - is this cell fatal to a head entering it, and why
 * @returns {{deaths: Death[]}} deaths in `steppingSnakes` order, so the result is deterministic
 */
export function resolveStep({ steppingSnakes, allSnakes, isDeadly }) {
  const stepping = steppingSnakes.filter((snake) => snake.alive);
  const living = allSnakes.filter((snake) => snake.alive);

  // The frozen picture: where every stepping head is going, computed before any of them has moved.
  /** @type {Map<string, Cell>} */
  const nextHeads = new Map();
  for (const snake of stepping) {
    nextHeads.set(snake.id, snake.nextHeadCell());
  }

  /** @type {Map<string, Set<string>>} */
  const bodies = new Map();
  for (const snake of living) {
    bodies.set(snake.id, occupiedAfterStep(snake, nextHeads.has(snake.id)));
  }

  /** @type {Death[]} */
  const deaths = [];
  for (const snake of stepping) {
    const cause = causeOfDeath(snake, { living, nextHeads, bodies, isDeadly });
    if (cause !== null) {
      deaths.push({ snakeId: snake.id, cause });
    }
  }
  return { deaths };
}

/**
 * How `snake` dies this tick, or `null` when it survives.
 *
 * @param {Snake} snake
 * @param {object} context
 * @param {Snake[]} context.living - every living snake, including `snake` itself
 * @param {Map<string, Cell>} context.nextHeads - target cell per stepping snake id
 * @param {Map<string, Set<string>>} context.bodies - post-step solid cells per living snake id
 * @param {IsDeadly} context.isDeadly
 * @returns {DeathCause | null}
 */
function causeOfDeath(snake, { living, nextHeads, bodies, isDeadly }) {
  const target = /** @type {Cell} */ (nextHeads.get(snake.id));
  const targetKey = cellKey(target);

  // 1. Wall or laser. First, so a head leaving the arena reports WALL even when the cell it would have
  //    landed in is also a body (AC5) — off the board there is nothing else left to hit.
  const deadly = isDeadly(target);
  if (deadly) {
    return deadly === true ? CAUSES.WALL : deadly;
  }

  // 2. Self.
  if (/** @type {Set<string>} */ (bodies.get(snake.id)).has(targetKey)) {
    return CAUSES.SELF;
  }

  for (const other of living) {
    if (other.id === snake.id) continue;
    const otherTarget = nextHeads.get(other.id);

    // 3. The other snake's head, but only while both are stepping: two heads into the same cell, or the
    //    swap, where each moves into the cell the other is leaving. Both are what the design calls a
    //    head-on.
    if (otherTarget !== undefined) {
      const sameCell = cellKey(otherTarget) === targetKey;
      const swap =
        targetKey === cellKey(other.head) && cellKey(otherTarget) === cellKey(snake.head);
      if (sameCell || swap) {
        if (snake.length > other.length) {
          // Survives this head-on (row 8). Skip the body test against *this* snake — in the swap case the
          // cell is that snake's neck, and the head-on rule is precisely what overrides it — but keep
          // checking every other snake.
          continue;
        }
        return CAUSES.HEAD_ON;
      }
    }

    // 4. The other snake's body, which includes its head when that snake is standing still: a stationary
    //    head is just another solid cell to run into (AC4).
    if (/** @type {Set<string>} */ (bodies.get(other.id)).has(targetKey)) {
      return CAUSES.BODY;
    }
  }

  return null;
}
