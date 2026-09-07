// @ts-check

/**
 * KI-03-02 — the survivor play policy: never eats, maximises reachable room, and refuses any cell the
 * opponent's own head could also step into. A browser-side port of `tests/sim/bots/survivorBot.js` onto the
 * driver's `PolicyView` shape — see that file's module doc for the laser-awareness reasoning this mirrors.
 *
 * **Self-contained by the driver's own constraint** (`driver.js`'s header, `tests/agent/README.md` §1):
 * every helper is nested inside the exported function, nothing is imported or referenced from module scope,
 * and there is no randomness — `PolicyView` carries no rng stream, and using `Math.random()` here would
 * break AC1's "the same seed replays identically". Ties are broken deterministically: free space dominates
 * the score, with a small bonus for continuing straight.
 *
 * **The rule that matters** (KI-03-02's own spec, ruling 5 on issue #122): `survivorBot.js` only penalises a
 * cell within one step of a living opponent head, in its score. Two mirrored survival bots built only that
 * way drive into each other from the spawn line and draw seven seconds in, because a *penalty* still loses
 * to "every other candidate is worse". This policy instead **excludes outright** every cell the opponent's
 * own head could occupy after its next step — the same up-to-three directions the game itself would let it
 * choose (it can never reverse) — so two mirrored bots never contest the same cell in the first place. If
 * that exclusion leaves no safe candidate at all (the opponent's next step happens to cover every option),
 * it is relaxed rather than forcing a `null` into a wall: surviving now beats a hypothetical collision later.
 *
 * **Laser awareness mirrors `survivorBot.js` exactly**, including the same load-bearing gate: a dead-zone
 * cell (outside `[inset, grid.width - 1 - inset]`) is always deadly, and the ring the *next* laser step will
 * sweep is additionally deadly, but **only while `phase` is `WARNING` or `CLOSING`**. Before the warning
 * ignites, `inset` is still 0 and that ring is just the cells against the wall; treating it as deadly from
 * second 0 would make this bot hug the arena centre for the whole pre-laser round for no reason, distorting
 * every statistic this policy is used to measure (see `survivorBot.js`'s own module doc for the full case).
 */

/**
 * @param {import('../driver.js').PolicyView} view
 * @returns {import('../driver.js').PolicyMove}
 */
export function survivor(view) {
  const { snapshot, playerIndex, grid } = view;

  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;

  /** The three directions `Snake.queueDirection` would ever accept: never the reverse of `current`. */
  const CARDINALS = [
    { name: 'UP', dx: 0, dy: 1 },
    { name: 'DOWN', dx: 0, dy: -1 },
    { name: 'LEFT', dx: -1, dy: 0 },
    { name: 'RIGHT', dx: 1, dy: 0 },
  ];

  const isOpposite = (a, b) => a.dx === -b.dx && a.dy === -b.dy;

  const segmentsContain = (segments, cell) =>
    segments.some((segment) => segment.x === cell.x && segment.y === cell.y);

  /** `self`'s own segments as they will be solid after this step: the tail vacates unless growth is owed. */
  const ownBodyAfterStep = (snake) =>
    snake.pendingGrowth > 0 ? snake.segments : snake.segments.slice(0, -1);

  const opponents = snapshot.snakes.filter((_, index) => index !== playerIndex);

  // `snapshot.lasers` is `{phase, inset, insetCells}` with no bounds of its own — the safe square is
  // `[inset, grid.width - 1 - inset]` on both axes (driver.js's `PolicyView` doc, `src/core/lasers.js`'s
  // `isDeadly`/`safeRegion`). At inset 0 this is exactly "in bounds", the wall being deadly from second 0.
  const lasers = snapshot.lasers;
  const inset = lasers.inset;
  const isDeadly = (cell) =>
    cell.x < inset ||
    cell.x >= grid.width - inset ||
    cell.y < inset ||
    cell.y >= grid.height - inset;

  // True from the moment the warning ignites (WARNING, still at inset 0) through every CLOSING step; false
  // before the warning (PARKED, nothing scheduled yet) and once the minimum arena is reached (STOPPED).
  const nextStepIsImminent = lasers.phase === 'WARNING' || lasers.phase === 'CLOSING';
  const safeMinX = inset;
  const safeMinY = inset;
  const safeMaxX = grid.width - inset - 1;
  const safeMaxY = grid.height - inset - 1;
  const onNextStepRing = (cell) =>
    cell.x === safeMinX || cell.x === safeMaxX || cell.y === safeMinY || cell.y === safeMaxY;

  // Every cell a living opponent's own head could occupy after its next step. Excluded outright below,
  // rather than merely scored down, which is the rule that keeps two mirrored survivors apart from the
  // spawn line (see module doc).
  const contestedCells = [];
  for (const opponent of opponents) {
    if (!opponent.alive) continue;
    const oHead = opponent.segments[0];
    for (const dir of CARDINALS) {
      if (isOpposite(dir, opponent.direction)) continue;
      contestedCells.push({ x: oHead.x + dir.dx, y: oHead.y + dir.dy });
    }
  }
  const isContested = (cell) => contestedCells.some((c) => c.x === cell.x && c.y === cell.y);

  const isImmediatelySafe = (cell) => {
    if (isDeadly(cell)) return false;
    if (nextStepIsImminent && onNextStepRing(cell)) return false;
    if (segmentsContain(ownBodyAfterStep(me), cell)) return false;
    return !opponents.some(
      (opponent) => opponent.alive && segmentsContain(opponent.segments, cell),
    );
  };

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
    let best = null;
    for (const dir of candidates) {
      const next = { x: head.x + dir.dx, y: head.y + dir.dy };
      if (!isImmediatelySafe(next)) continue;
      if (avoidContested && isContested(next)) continue;

      const free = freeNeighborCount(next, avoidContested);
      const straightBonus = dir.dx === me.direction.dx && dir.dy === me.direction.dy ? 3 : 0;
      // Free space dominates the score (mirrors `survivorBot.js`'s weight of 10), with a small deterministic
      // bonus for continuing straight so ties do not flip-flop frame to frame.
      const score = free * 10 + straightBonus;
      if (best === null || score > best.score) best = { score, dir };
    }
    return best;
  };

  // First pass excludes every cell the opponent could also step into; if that leaves nothing at all, fall
  // back to plain safety rather than returning `null` into what might be the only way off a wall.
  const best = evaluate(true) ?? evaluate(false);

  if (best === null) return null;
  if (best.dir.dx === me.direction.dx && best.dir.dy === me.direction.dy) return null;
  return /** @type {import('../driver.js').PolicyMove} */ (best.dir.name);
}
