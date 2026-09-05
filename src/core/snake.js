// @ts-check
import { addDir, isOpposite } from './grid.js';

/**
 * One snake: where its segments are, which way it is going, which turns the player has queued, and how much
 * of a grid step it has accumulated. Pure simulation (ARCHITECTURE §4) — no DOM, no three.js, no rendering
 * concerns beyond exposing the two things a renderer needs to interpolate: `previousSegments` and
 * `stepProgress`.
 *
 * The movement model is the one in `docs/reference/images/09-snake-turning-animation.png`: the snake lives on
 * the grid and turns are clean 90° steps, while the *visuals* are smooth because every segment follows the
 * exact path of the segment in front of it. That is what `previousSegments` is for — segment `i` of the
 * drawn snake is lerped from `previousSegments[i]` to `segments[i]` by `stepProgress`.
 */

/** @typedef {import('./grid.js').Cell} Cell */
/** @typedef {import('./grid.js').Direction} Direction */
/** @typedef {import('./settings.js').Settings} Settings */

/**
 * Slack allowed when deciding whether a grid step is due.
 *
 * `stepProgress` is a sum of floats, and the design's own numbers do not survive binary addition exactly: at
 * `snakeSpeed` 6 and `dt` 1/120 a step is one cell every 20 accumulations, but adding 0.05 twenty times gives
 * 1.0000000000000002, and at a 1.5× multiplier adding 0.075 forty times gives 0.9999999999999996 — three
 * cells of movement that a `>= 1` test would report as two, losing a whole step every 40 ticks. The epsilon
 * says "a step whose arithmetic says it is due, is due". It is 1e-9 of a cell, i.e. under a nanosecond of
 * simulated time at any speed in `DESIGN-DECISIONS §4`, and it is applied identically on every run, so it
 * costs nothing in fairness and nothing in determinism.
 */
const STEP_EPSILON = 1e-9;

/**
 * True when two directions are the same step vector. Directions are compared by value, not identity, so a
 * caller may pass its own `{dx, dy}` literal rather than a `DIRECTIONS` constant.
 *
 * @param {Direction} a
 * @param {Direction} b
 * @returns {boolean}
 */
function sameDirection(a, b) {
  return a.dx === b.dx && a.dy === b.dy;
}

/**
 * A copy of a cell, so a snapshot can never alias a live segment.
 *
 * @param {Cell} cell
 * @returns {Cell}
 */
function cloneCell(cell) {
  return { x: cell.x, y: cell.y };
}

export class Snake {
  /**
   * @param {object} options
   * @param {string} options.id - player id this snake belongs to
   * @param {Cell[]} options.cells - segments, head first; copied, never aliased
   * @param {Direction} options.direction - the direction the head is already travelling in
   * @param {Settings} options.settings - the frozen settings this snake reads its speed and buffer size from
   */
  constructor({ id, cells, direction, settings }) {
    /** @type {string} */
    this.id = id;
    /** @type {Settings} */
    this.settings = settings;
    /** Segments, head first (ARCHITECTURE §4). @type {Cell[]} */
    this.segments = cells.map(cloneCell);
    /**
     * Where each segment was before the last committed step, for render interpolation. Always the same
     * length as `segments` (see {@link commitStep}). Before the first step it is simply the start position.
     * @type {Cell[]}
     */
    this.previousSegments = cells.map(cloneCell);
    /** The last *committed* direction — what the snake is actually travelling in. @type {Direction} */
    this.direction = direction;
    /** Buffered turns, consumed one per grid step (DESIGN-DECISIONS §2.2). @type {Direction[]} */
    this.queue = [];
    /** Segments still owed from eaten apples; one is paid off per step. @type {number} */
    this.pendingGrowth = 0;
    /** Product of the active effect multipliers (Sprint 06 sets it; 1 means base speed). @type {number} */
    this.speedMultiplier = 1;
    /** @type {boolean} */
    this.alive = true;
    /** Fraction of the way to the next cell, 0..1 — also the renderer's interpolation alpha. @type {number} */
    this.stepProgress = 0;
  }

  /** @returns {number} number of segments, head included */
  get length() {
    return this.segments.length;
  }

  /** @returns {Cell} the head cell (live, not a copy) */
  get head() {
    return this.segments[0];
  }

  /**
   * Queues a turn, applying the input rules of `DESIGN-DECISIONS §2.2`.
   *
   * The direction an input is judged against is the last queued one if anything is queued, and the committed
   * direction otherwise — *not* both. That distinction is the whole point of a buffer: travelling RIGHT with
   * UP already queued, a LEFT is legal and gives the two-step U-turn of AC2, even though LEFT reverses the
   * direction the snake is committed to right now. By the time LEFT is consumed the snake will be going UP,
   * and UP → LEFT is an ordinary 90° turn.
   *
   * Rejected inputs are dropped silently, exactly as a real Snake game drops them: the player mashing a key
   * into a wall gets no feedback and needs none.
   *
   * @param {Direction} dir
   * @returns {boolean} true when the input was queued, false when it was ignored or dropped
   */
  queueDirection(dir) {
    const last = this.queue.length > 0 ? this.queue[this.queue.length - 1] : this.direction;
    // A reversal would drive the head straight into the neck, and a repeat of what is already happening is
    // not an input at all. Both are checked before the buffer's capacity so a rejected key never consumes a
    // slot a real turn could have used.
    if (sameDirection(dir, last) || isOpposite(dir, last)) {
      return false;
    }
    if (this.queue.length >= this.settings.inputBufferSize) {
      return false;
    }
    this.queue.push(dir);
    return true;
  }

  /**
   * The cell the head will occupy on the next step — the queued turn if one is buffered, otherwise straight
   * on. Collision resolution (`collisions.js`) asks every stepping snake for this *before* anything moves,
   * which is what makes simultaneous steps symmetric (ARCHITECTURE §4).
   *
   * @returns {Cell}
   */
  nextHeadCell() {
    return addDir(this.segments[0], this.queue.length > 0 ? this.queue[0] : this.direction);
  }

  /**
   * Takes one grid step: consumes the queued turn if there is one, moves the head into
   * {@link nextHeadCell}, and either grows (paying off one `pendingGrowth`) or drops the tail.
   *
   * `previousSegments` is captured first so the renderer can lerp each segment from where it was to where it
   * now is. When the snake grows, the new segment has no previous cell of its own — it is *appearing* at the
   * tail — so the old tail cell is duplicated for it. That keeps `previousSegments.length ===
   * segments.length` at all times (AC5), which means the renderer never has to special-case a growth frame,
   * and it makes the new brick grow out of the tail rather than fly in from nowhere (DESIGN-DECISIONS §3,
   * "new segment appears at the tail").
   */
  commitStep() {
    const previous = this.segments.map(cloneCell);
    const queued = this.queue.shift();
    if (queued !== undefined) {
      this.direction = queued;
    }

    this.segments.unshift(addDir(this.segments[0], this.direction));
    if (this.pendingGrowth > 0) {
      this.pendingGrowth -= 1;
      previous.push(cloneCell(previous[previous.length - 1]));
    } else {
      this.segments.pop();
    }

    this.previousSegments = previous;
  }

  /**
   * Advances this snake's movement accumulator by `dt` seconds of simulated time.
   *
   * Each snake carries its own accumulator rather than sharing a global step clock, which is what lets two
   * snakes move at different speeds without float drift (DESIGN-DECISIONS §2.1). The remainder is kept, not
   * discarded, so a snake at 1.5× really does travel 1.5 cells for every cell at base speed instead of
   * quietly losing the fraction.
   *
   * Exactly one step is subtracted per call. The simulation drives this at `1/simHz` (1/120 s), where the
   * fastest speed in the design — 9 cells/s under Speed Boost — advances the accumulator by 0.075, so a
   * single call can never earn two steps.
   *
   * @param {number} dt - seconds of simulated time
   * @returns {boolean} true when a grid step is due
   */
  accumulate(dt) {
    this.stepProgress += dt * this.settings.snakeSpeed * this.speedMultiplier;
    if (this.stepProgress >= 1 - STEP_EPSILON) {
      this.stepProgress -= 1;
      return true;
    }
    return false;
  }

  /**
   * Owes the snake `amount` more segments, paid off one per step (DESIGN-DECISIONS §1 row 2:
   * `growthPerFood` is 1, so one apple is one segment).
   *
   * @param {number} [amount]
   */
  grow(amount = 1) {
    this.pendingGrowth += amount;
  }
}
