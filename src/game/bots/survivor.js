// @ts-check

/**
 * KI-12-01 — the survivor play policy: never eats, maximises the room it can still reach, and keeps out of
 * the way of the opponent's head and of the closing beams.
 *
 * Moved into `src/` from `tests/sim/bots/survivorBot.js` (Sprint 02, ported from
 * `docs/design/spikes/design-validation-sim.py`'s `survivor`, made laser-aware by KS-04-04) and
 * `tests/agent/policies/survivor.js` (KI-03-02, PR #174). Both now import this file. `policy.js`'s module
 * doc explains why the two differed and how {@link import('./policy.js').PolicyRules} keeps both sets of
 * recorded numbers exact.
 *
 * **Everything is nested inside the exported function on purpose** — see `greedy.js`'s module doc; the
 * driver ships a policy into the page as source text and a module-level helper would arrive undefined.
 *
 * "Two-step lookahead" is the candidate cell itself (step one) scored by how many of *its* neighbours are
 * also safe (step two). A candidate that is safe right now but boxes the snake into a corridor with nowhere
 * to go next turn scores low, exactly as it did in the Python spike.
 *
 * ## The two rules that carry their history
 *
 * **Contested cells** (`rules.contested`). `survivorBot` *penalised* a cell within one step of a living
 * opponent's head. Two mirrored penalty-only survivors drive into each other from the spawn line and draw
 * seven seconds in, so KI-03-02 (ruling 5 on #122) changed the browser policy to **exclude outright** every
 * cell the opponent's own head could occupy after its next step — the same up-to-three directions the game
 * would let it choose, since it can never reverse — with a relaxation pass if that leaves no candidate at
 * all, because surviving now beats a hypothetical collision later. `'exclude'` is the default and the rule
 * the CPU plays by; `'penalise'` exists so `tests/sim` reproduces the matrix it recorded.
 *
 * Note that the two rules do not describe the same set of cells, which is why one could not simply be
 * re-weighted into the other: the penalty covers the opponent's head and its four neighbours (Manhattan
 * distance ≤ 1), the exclusion covers only the up-to-three cells the opponent could actually step into.
 *
 * **Laser awareness** is identical under both rule sets, including its load-bearing gate. A dead-zone cell
 * is always deadly, and the ring the *next* laser step will sweep is additionally deadly — but **only while
 * `phase` is `WARNING` or `CLOSING`**. Before the warning ignites `inset` is still 0 and that ring is just
 * the cells against the wall; treating it as deadly from second 0 would make this policy hug the arena
 * centre for the whole pre-laser round for no reason, which is not what "sees the laser coming and gets out
 * of the way" looks like and would quietly move every statistic this policy is used to measure.
 */

/**
 * @param {import('./policy.js').PolicyView} view
 * @returns {import('./policy.js').PolicyMove}
 */
export function survivor(view) {
  const { snapshot, playerIndex, grid } = view;

  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;

  // `policy.js`'s PLAY_RULES, inlined: a policy may not read a module-level constant (see that module's
  // doc). `tests/unit/game/bots/rules.test.js` pins these against PLAY_RULES so the two cannot drift apart.
  const rules = view.rules ?? {};
  const contested = rules.contested ?? 'exclude';
  const contestedPenalty = rules.contestedPenalty ?? 25;
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

  // The safe square is `[inset, width - 1 - inset]` on both axes (`src/core/lasers.js`'s `isDeadly` and
  // `safeRegion`). At inset 0 this is exactly "in bounds" — the wall being deadly from second 0.
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

  // True from the moment the warning ignites (WARNING, still at inset 0) through every CLOSING step; false
  // before the warning (PARKED, nothing scheduled yet) and once the minimum arena is reached (STOPPED).
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

  // Every cell a living opponent's own head could occupy after its next step — the `'exclude'` rule's set.
  /** @type {{x: number, y: number}[]} */
  const contestedCells = [];
  for (const opponent of opponents) {
    if (!opponent.alive) continue;
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
   * The `'penalise'` rule's set, which is a different one: the opponent's head and its four neighbours.
   *
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isThreatened = (cell) =>
    opponents.some((opponent) => opponent.alive && manhattan(opponent.segments[0], cell) <= 1);

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
   * @param {boolean} avoidContested
   * @returns {{score: number, dir: {name: string, dx: number, dy: number}} | null}
   */
  const evaluate = (avoidContested) => {
    /** @type {{score: number, dir: {name: string, dx: number, dy: number}} | null} */
    let best = null;
    for (const dir of candidates) {
      const next = { x: head.x + dir.dx, y: head.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;
      if (avoidContested && isContested(next)) continue;

      const free = freeNeighborCount(next, avoidContested);
      const straight = dir.dx === me.direction.dx && dir.dy === me.direction.dy;
      // Free space dominates (weight 10), with a small bonus for continuing straight so ties do not
      // flip-flop frame to frame. `jitter` is called here and only here — once per candidate that clears
      // the guards, in candidate order — because that is exactly where and how often `survivorBot` drew
      // from its stream, and the bot matrix reproduces only if the draws line up.
      const score =
        free * 10 +
        (straight ? 3 : 0) +
        (jitter === null ? 0 : jitter()) -
        (contested === 'penalise' && isThreatened(next) ? contestedPenalty : 0);
      if (best === null || score > best.score) best = { score, dir };
    }
    return best;
  };

  // Under `'exclude'`, the first pass rules out every cell the opponent could also step into; if that
  // leaves nothing at all, fall back to plain safety rather than returning `null` into what might be the
  // only way off a wall. Under `'penalise'` there is one pass and the cost lives in the score instead.
  const best = contested === 'exclude' ? (evaluate(true) ?? evaluate(false)) : evaluate(false);

  if (best === null) return null;
  if (best.dir.dx === me.direction.dx && best.dir.dy === me.direction.dy) return null;
  return /** @type {import('./policy.js').PolicyMove} */ (best.dir.name);
}
