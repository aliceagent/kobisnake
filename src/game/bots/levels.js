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
 * ## HARD, redefined (design-lead ruling on #210, 2026-09-08)
 *
 * The original `hard` steered into a cell a strictly-longer snake could win a head-on over (`DESIGN-DECISIONS
 * §1` row 8's "longer survives"). Measured against NORMAL over 1 000 seeded rounds (`docs/qa/playtests/
 * cpu-levels.md`'s first table), it came out **3.5 points weaker**, not stronger — the mechanic spends a
 * little of survivor's own defensive margin chasing a coin the opponent can simply decline to flip (NORMAL's
 * own contested-cell exclusion means it rarely walks into the cell HARD was steering toward), and that spent
 * margin cost more in the laser endgame than the occasional won head-on paid back. The ruling accepted that
 * finding outright and replaced the mechanic rather than asking for it to be tuned until the number moved:
 *
 * > HARD is: NORMAL's survival rules, plus eating when it is safe — take an apple when the cell it sits on
 * > still leaves at least as much reachable room as the best non-apple move, so the snake grows without
 * > boxing itself in.
 *
 * The reasoning behind the words: NORMAL never eats (`survivor.js`'s own module doc) and stays at spawn
 * length all round. A HARD that grows wins timeouts on length (`DESIGN-DECISIONS §2.5`: "Longer snake wins
 * the round" at 0:00), wins a head-on **without ever having sought one** (row 8 already pays out for length —
 * `hard` no longer needs to go looking for the chance), and reaches the laser phase with the same survival
 * discipline survivor already has, only carrying more length. It is stronger the way a more experienced human
 * is stronger — playing the same safe game a little better, not gambling on a coin the opponent can refuse —
 * which is exactly what "harder" ought to mean for a level a beginner can still play against.
 *
 * `hard` still does not call `survivor()` — `policy.js`'s module doc's constraint 2: `tests/agent/driver.js`
 * ships a policy into a browser page as source text via `Function.prototype.toString()`, so a policy function
 * may not reference anything outside itself. `greedy.js` and `survivor.js` each pay the cost of re-declaring
 * their own small helpers rather than sharing a module for exactly this reason; `hard` pays the same cost,
 * duplicating survivor's safety machinery inline. Two things follow directly from the ruling's own wording:
 *
 * 1. **Contested cells are excluded outright, always** — exactly survivor's own two-pass exclusion (try
 *    excluding every cell the opponent's head could also reach next step; fall back to plain safety only if
 *    that leaves nothing at all). There is no branch that ever relaxes this, at any length: the ruling is
 *    explicit that steering into (or even tolerating) a contested cell for the sake of a head-on is the
 *    behaviour being deleted, not narrowed.
 * 2. **"Reachable room" is `freeNeighborCount`, unmodified.** The ruling's own wording — "at least as much
 *    reachable room as the best non-apple move" — names the existing measure rather than asking for a new
 *    one, so eating is scored with the identical two-step-lookahead count survivor's own free-space term
 *    already uses, computed under whichever exclusion pass is actually in effect. An apple only ever *breaks
 *    a tie* among cells that were already safe; it can never buy a step into a cell with less room than the
 *    best available alternative, and it plays no part in the safety filter itself.
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
 * The HARD policy: survivor's own safety, laser awareness and contested-cell exclusion, unmodified, plus
 * eating an apple when doing so costs no reachable room (the ruling on #210 — see the module doc). Every
 * helper is nested here rather than shared with `survivor.js`; see the module doc for why.
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

  const opponents = snapshot.snakes.filter((_, index) => index !== playerIndex);
  const livingOpponents = opponents.filter((opponent) => opponent.alive);

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
  // excluding the reverse of its own current direction, exactly `survivor.js`'s `contestedCells`. Unlike the
  // pre-ruling `hard`, there is no branch that ever stops excluding this set (module doc).
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

  // Apples only (module doc: the ruling names apples, not power-ups) — filtered for `null` the same way
  // `greedy.js` does, since a food slot can stand empty (`DESIGN-DECISIONS §2.3`: "foodCount is a target, not
  // an invariant").
  const appleCells = snapshot.apples.filter((apple) => apple !== null);
  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const hasApple = (cell) => appleCells.some((apple) => apple.x === cell.x && apple.y === cell.y);

  const head = me.segments[0];
  const candidates = CARDINALS.filter((dir) => !isOpposite(dir, me.direction));

  /**
   * Every direction that survives the safety filter under one exclusion pass, scored exactly as `survivor.js`
   * scores it (free space dominates at weight 10, a small straight-line bonus of 3 keeps ties from
   * flip-flopping, `jitter` breaks the rest) — no eating term here at all; that preference is applied once,
   * after this returns, over whichever pass actually produced candidates (module doc point 1).
   *
   * @param {boolean} avoidContested
   * @returns {{dir: {name: string, dx: number, dy: number}, score: number, room: number, hasApple: boolean}[]}
   */
  const evaluateCandidates = (avoidContested) => {
    const evaluated = [];
    for (const dir of candidates) {
      const next = { x: head.x + dir.dx, y: head.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;
      if (avoidContested && isContested(next)) continue;

      const room = freeNeighborCount(next, avoidContested);
      const straight = dir.dx === me.direction.dx && dir.dy === me.direction.dy;
      const score = room * 10 + (straight ? 3 : 0) + (jitter === null ? 0 : jitter());
      evaluated.push({ dir, score, room, hasApple: hasApple(next) });
    }
    return evaluated;
  };

  // Survivor's own two-pass exclusion, unchanged: try excluding every contested cell; if that leaves nothing
  // at all, fall back to plain safety rather than returning `null` into what might be the only way off a wall.
  let evaluated = evaluateCandidates(true);
  if (evaluated.length === 0) evaluated = evaluateCandidates(false);
  if (evaluated.length === 0) return null;

  // Survivor's own pick: highest score wins, first candidate (fixed CARDINALS order) keeps a tie.
  let best = evaluated[0];
  for (const candidate of evaluated) {
    if (candidate.score > best.score) best = candidate;
  }

  // The ruling's safe-eating rule: an apple cell is preferred over `best` whenever its own reachable room is
  // at least as good as the best *non-apple* candidate's — never a reduction in room, only a tie broken in
  // favour of growing. With no non-apple candidate at all the comparison is vacuously true, so the best-scoring
  // apple (there is nothing else in `evaluated`) simply stands, which already equals `best` above.
  const nonAppleCandidates = evaluated.filter((candidate) => !candidate.hasApple);
  const appleCandidates = evaluated.filter((candidate) => candidate.hasApple);
  if (appleCandidates.length > 0) {
    const bestNonAppleRoom =
      nonAppleCandidates.length > 0
        ? Math.max(...nonAppleCandidates.map((candidate) => candidate.room))
        : -Infinity;
    /** @type {(typeof appleCandidates)[number] | null} */
    let bestApple = null;
    for (const candidate of appleCandidates) {
      if (candidate.room < bestNonAppleRoom) continue;
      if (bestApple === null || candidate.score > bestApple.score) bestApple = candidate;
    }
    if (bestApple !== null) best = bestApple;
  }

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
