// @ts-check

/**
 * KI-12-03 — the three CPU levels: a name-to-policy lookup, and nothing else.
 *
 * `DESIGN-DECISIONS §1 row 27` names exactly three levels and exactly three words for them —
 * `EASY`, `NORMAL`, `HARD` — and rules that EASY is the greedy policy, NORMAL is the survivor policy, and HARD
 * is "survivor with the head-on rule exploited". This module is the map from those words to
 * {@link import('./policy.js').Policy} functions. It is deliberately data plus one function: KI-12-04 imports
 * {@link LEVELS} and {@link policyForLevel} for the match-setup row, and nothing here may name a screen, a
 * label, or any word not already approved above — a new level name is a design-lead ruling on #210, not a
 * line of code.
 *
 * ## EASY and NORMAL are not wrapped
 *
 * `greedy` and `survivor` already default to {@link import('./policy.js').PLAY_RULES} — no laser blindness, no
 * randomness — the moment a caller passes no `rules` at all (`policy.js`'s module doc: "a policy called with
 * no `rules` at all behaves exactly as the KI-03-02 browser policy did"). That is exactly the CPU's contract,
 * so `LEVEL_POLICIES.EASY` and `LEVEL_POLICIES.NORMAL` *are* `greedy` and `survivor`, unmodified. Introducing
 * a wrapper here would be new code with nothing to justify it.
 *
 * ## HARD duplicates survivor's body on purpose
 *
 * `hard` does not call `survivor()`. `policy.js`'s module doc's constraint 2 is the reason: `tests/agent/
 * driver.js` ships a policy into a browser page as source text via `Function.prototype.toString()`, so a
 * policy function may not reference anything outside itself — not a module-level constant, not an import, not
 * a sibling function. `greedy.js` and `survivor.js` each accept the cost of re-declaring their own small
 * helpers rather than sharing a module for exactly this reason; `hard` pays the same cost, duplicating
 * survivor's safety/lookahead machinery inline rather than importing it, so it can ship the same way its two
 * siblings do.
 *
 * The design brief (`docs/sprints/improvement-12-cpu-opponent.md` KI-12-03, `DESIGN-DECISIONS §1 row 8`):
 * when both heads enter the same cell, or swap cells, in one step, **the longer snake survives, equal
 * lengths both die**. Two things follow from that rule, both load-bearing for `hard`:
 *
 * 1. **Only a strictly-longer snake should ever want a head-on.** Equal length kills both sides — the same
 *    outcome as staying out of the way, but with the extra risk of actually reaching that cell — so `hard`
 *    only ever relaxes survivor's caution when `me.segments.length` is strictly greater than every living
 *    opponent's. Ticket wording: "steers to force head-ons **it will win** by length". When it is not
 *    strictly longer, `hard` runs exactly survivor's own two-pass evaluation (exclude every contested cell,
 *    fall back to plain safety only if that leaves nothing at all) with no bonus terms at all, which is what
 *    makes it byte-for-byte survivor's answer on every board where it is not ahead — proved in
 *    `tests/sim/cpuLevels.test.js` and (optionally) `tests/unit/game/bots/purity.test.js`.
 * 2. **"Contested" is the only cell a head-on can actually land on.** `isImmediatelySafe` already refuses any
 *    cell currently occupied by an opponent's body — including its current head cell — because a snake that
 *    steps there dies to an ordinary body collision unless the opponent happens to vacate it into *my* current
 *    head cell at the same instant (the "swap" case), which a policy cannot engineer without knowing the
 *    opponent's own choice in advance. What a policy *can* aim at is a cell the opponent's head could occupy
 *    **after its next step** — survivor's own `contestedCells` set, up to three cells per living opponent,
 *    already excludes the reverse of its current direction the same way this snake's own candidates do. If
 *    both heads land there on the same tick, that is the "both heads enter the same cell" branch of row 8, not
 *    a guess. `hard` keeps that same set unmodified; a longer `hard` simply stops excluding it and gives it a
 *    strong bonus, and adds a gentle pull toward the nearest living opponent's head so it is actually steering
 *    toward the chance of one, not just declining to avoid it when one happens to arise.
 *
 * Both bonus terms are named constants nested inside `hard` (not module scope — constraint 2 again):
 * `HEAD_ON_BONUS` is set well above the largest possible free-space/straight score (4 safe neighbours × the
 * free-space weight of 10, plus the straight bonus of 3 = 43 at most) so an available contested cell always
 * wins the comparison outright rather than merely nudging it; `APPROACH_WEIGHT` is a single point per
 * Manhattan cell of distance closed, the same order of magnitude as the straight-line bonus, so it steers
 * play toward the opponent without ever overriding a real difference in safety.
 */

/** @typedef {'EASY' | 'NORMAL' | 'HARD'} Level */

import { greedy } from './greedy.js';
import { survivor } from './survivor.js';

/**
 * The three approved level ids (`DESIGN-DECISIONS §1 row 27`). No other string is a level.
 *
 * @type {Readonly<Record<Level, Level>>}
 */
export const LEVELS = Object.freeze({
  EASY: 'EASY',
  NORMAL: 'NORMAL',
  HARD: 'HARD',
});

/**
 * The HARD policy: survivor's own safety and two-step lookahead, plus steering into a cell the opponent's
 * head could also reach next step when — and only when — `me` is strictly longer than every living opponent.
 * See the module doc for why every helper is nested here rather than shared with `survivor.js`.
 *
 * @param {import('./policy.js').PolicyView} view
 * @returns {import('./policy.js').PolicyMove}
 */
export function hard(view) {
  const { snapshot, playerIndex, grid } = view;

  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;

  // `policy.js`'s PLAY_RULES, inlined: a policy may not read a module-level constant (module doc's constraint
  // 2, restated in `policy.js`'s own module doc). Only `jitter` is accepted here — `hard` has no historical
  // measurement rules to reproduce, so it needs none of `survivor`'s other knobs.
  const rules = view.rules ?? {};
  const jitter = rules.jitter ?? null;

  /** The three directions `Snake.queueDirection` would ever accept: never the reverse of `current`. */
  const CARDINALS = [
    { name: 'UP', dx: 0, dy: 1 },
    { name: 'DOWN', dx: 0, dy: -1 },
    { name: 'LEFT', dx: -1, dy: 0 },
    { name: 'RIGHT', dx: 1, dy: 0 },
  ];

  /**
   * @param {{dx: number, dy: number}} a
   * @param {{dx: number, dy: number}} b
   * @returns {boolean}
   */
  const isOpposite = (a, b) => a.dx === -b.dx && a.dy === -b.dy;

  /**
   * @param {{x: number, y: number}[]} segments
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const segmentsContain = (segments, cell) =>
    segments.some((segment) => segment.x === cell.x && segment.y === cell.y);

  /**
   * The only `pendingGrowth` any policy may read, and only ever its own (`policy.js`).
   *
   * @param {import('./policy.js').PolicySnake} snake
   * @returns {{x: number, y: number}[]}
   */
  const ownBodyAfterStep = (snake) =>
    snake.pendingGrowth > 0 ? snake.segments : snake.segments.slice(0, -1);

  /**
   * @param {{x: number, y: number}} a
   * @param {{x: number, y: number}} b
   * @returns {number}
   */
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  const opponents = snapshot.snakes.filter((_, index) => index !== playerIndex);
  const livingOpponents = opponents.filter((opponent) => opponent.alive);

  // Row 8: a head-on this snake does not win outright is exactly as bad as one it never risked, so only a
  // *strictly* longer snake ever steers toward one. `segments.length` is public and is measured before this
  // step's own growth resolves, matching the length the engine itself compares (`DESIGN-DECISIONS §2.5`).
  const amLonger =
    livingOpponents.length > 0 &&
    livingOpponents.every((opponent) => me.segments.length > opponent.segments.length);

  // The safe square is `[inset, width - 1 - inset]` on both axes (`src/core/lasers.js`'s `isDeadly`).
  const inset = snapshot.lasers.inset;
  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isDeadly = (cell) =>
    cell.x < inset ||
    cell.x >= grid.width - inset ||
    cell.y < inset ||
    cell.y >= grid.height - inset;

  // True from the moment the warning ignites through every CLOSING step; see `survivor.js`'s module doc for
  // why this gate does not fire before the warning (`inset` is still 0 pre-warning, so the ring would just be
  // the wall).
  const nextStepIsImminent =
    snapshot.lasers.phase === 'WARNING' || snapshot.lasers.phase === 'CLOSING';
  const safeMinX = inset;
  const safeMinY = inset;
  const safeMaxX = grid.width - inset - 1;
  const safeMaxY = grid.height - inset - 1;
  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const onNextStepRing = (cell) =>
    cell.x === safeMinX || cell.x === safeMaxX || cell.y === safeMinY || cell.y === safeMaxY;

  // Every cell a living opponent's own head could occupy after its next step — up to three per opponent,
  // excluding the reverse of its own current direction, exactly `survivor.js`'s `contestedCells`.
  /** @type {{x: number, y: number}[]} */
  const contestedCells = [];
  for (const opponent of livingOpponents) {
    const opponentHead = opponent.segments[0];
    for (const dir of CARDINALS) {
      if (isOpposite(dir, opponent.direction)) continue;
      contestedCells.push({ x: opponentHead.x + dir.dx, y: opponentHead.y + dir.dy });
    }
  }
  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isContested = (cell) => contestedCells.some((c) => c.x === cell.x && c.y === cell.y);

  const livingOpponentHeads = livingOpponents.map((opponent) => opponent.segments[0]);
  /**
   * The Manhattan distance from `cell` to the nearest living opponent's head, or 0 with no living opponent
   * (in which case the hunting bonus below never fires anyway — `amLonger` is false with no living opponent).
   *
   * @param {{x: number, y: number}} cell
   * @returns {number}
   */
  const nearestOpponentHeadDistance = (cell) => {
    if (livingOpponentHeads.length === 0) return 0;
    let min = Infinity;
    for (const opponentHead of livingOpponentHeads) {
      const d = manhattan(opponentHead, cell);
      if (d < min) min = d;
    }
    return min;
  };

  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isImmediatelySafe = (cell) => {
    if (isDeadly(cell)) return false;
    if (nextStepIsImminent && onNextStepRing(cell)) return false;
    if (segmentsContain(ownBodyAfterStep(me), cell)) return false;
    return !opponents.some(
      (opponent) => opponent.alive && segmentsContain(opponent.segments, cell),
    );
  };

  /**
   * @param {{x: number, y: number}} cell
   * @param {boolean} avoidContested
   * @returns {number}
   */
  const freeNeighborCount = (cell, avoidContested) => {
    let count = 0;
    for (const dir of CARDINALS) {
      const next = { x: cell.x + dir.dx, y: cell.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;
      if (avoidContested && isContested(next)) continue;
      count += 1;
    }
    return count;
  };

  const head = me.segments[0];
  const candidates = CARDINALS.filter((dir) => !isOpposite(dir, me.direction));

  /**
   * Exactly survivor's own scoring under its `'exclude'` rule: free space dominates (weight 10), a small
   * straight-line bonus (3) keeps ties from flip-flopping, `jitter` breaks the rest. No head-on term at all —
   * this is the branch a `hard` that is not strictly longer must reproduce exactly.
   *
   * @param {boolean} avoidContested
   * @returns {{score: number, dir: {name: string, dx: number, dy: number}} | null}
   */
  const evaluateDefensive = (avoidContested) => {
    /** @type {{score: number, dir: {name: string, dx: number, dy: number}} | null} */
    let best = null;
    for (const dir of candidates) {
      const next = { x: head.x + dir.dx, y: head.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;
      if (avoidContested && isContested(next)) continue;

      const free = freeNeighborCount(next, avoidContested);
      const straight = dir.dx === me.direction.dx && dir.dy === me.direction.dy;
      const score = free * 10 + (straight ? 3 : 0) + (jitter === null ? 0 : jitter());
      if (best === null || score > best.score) best = { score, dir };
    }
    return best;
  };

  /**
   * The hunting branch: same safety and free-space scoring as `evaluateDefensive(false)`, plus a decisive
   * bonus for a contested cell (module doc's `HEAD_ON_BONUS`) and a gentle pull toward the nearest living
   * opponent's head (`APPROACH_WEIGHT`) so `hard` actively closes the distance instead of only accepting a
   * head-on that happens to fall in its lap.
   *
   * @returns {{score: number, dir: {name: string, dx: number, dy: number}} | null}
   */
  const evaluateHunting = () => {
    // Comfortably above the largest possible free-space + straight score (4 neighbours * 10 + 3 = 43): an
    // available contested cell always outranks every purely-defensive alternative.
    const HEAD_ON_BONUS = 1000;
    // One point per Manhattan cell of distance closed — the same order of magnitude as the straight-line
    // bonus, enough to steer play toward the opponent without ever outweighing a real safety difference.
    const APPROACH_WEIGHT = 1;

    /** @type {{score: number, dir: {name: string, dx: number, dy: number}} | null} */
    let best = null;
    for (const dir of candidates) {
      const next = { x: head.x + dir.dx, y: head.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;

      const free = freeNeighborCount(next, false);
      const straight = dir.dx === me.direction.dx && dir.dy === me.direction.dy;
      const headOnBonus = isContested(next) ? HEAD_ON_BONUS : 0;
      const score =
        free * 10 +
        (straight ? 3 : 0) +
        (jitter === null ? 0 : jitter()) +
        headOnBonus -
        APPROACH_WEIGHT * nearestOpponentHeadDistance(next);
      if (best === null || score > best.score) best = { score, dir };
    }
    return best;
  };

  // Not strictly longer: exactly survivor's own two-pass exclusion (`survivor.js`'s own comment: "if that
  // leaves nothing at all, fall back to plain safety rather than returning null into what might be the only
  // way off a wall"). Strictly longer: hunt, with no exclusion pass at all — there is nothing to fall back to
  // that hunting itself does not already consider, since it is `evaluateDefensive(false)` plus bonus terms.
  const best = amLonger ? evaluateHunting() : (evaluateDefensive(true) ?? evaluateDefensive(false));

  if (best === null) return null;
  if (best.dir.dx === me.direction.dx && best.dir.dy === me.direction.dy) return null;
  return /** @type {import('./policy.js').PolicyMove} */ (best.dir.name);
}

/**
 * The level lookup KI-12-04 consumes for the match-setup row: a level id to its {@link
 * import('./policy.js').Policy}, and nothing else — no UI vocabulary belongs in this module.
 *
 * @type {Readonly<Record<Level, import('./policy.js').Policy>>}
 */
export const LEVEL_POLICIES = Object.freeze({
  EASY: greedy,
  NORMAL: survivor,
  HARD: hard,
});

/**
 * @param {Level} level
 * @returns {import('./policy.js').Policy}
 */
export function policyForLevel(level) {
  const policy = LEVEL_POLICIES[level];
  if (policy === undefined) {
    throw new RangeError(`policyForLevel: unknown level "${level}"`);
  }
  return policy;
}
