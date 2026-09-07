// @ts-check

/**
 * KI-03-02 — the greedy play policy: heads for the nearest apple or power-up, refusing any cell that is not
 * immediately safe. A browser-side port of `tests/sim/bots/greedyBot.js` onto the driver's `PolicyView`
 * shape rather than the headless harness's `BotView` — see that file's module doc for the reasoning this
 * mirrors (dead-end avoidance, the power-up-over-apple tie rule, the threatened-cell penalty).
 *
 * **Self-contained by the driver's own constraint** (`driver.js`'s header, `tests/agent/README.md` §1): the
 * driver ships this function into the page as source text (`Function.prototype.toString()`), so every helper
 * is nested inside the exported function rather than a module-level import or constant. No randomness either
 * — `PolicyView` carries no rng stream, and the match's own determinism (AC1: the same seed replays
 * identically) would break if this function's own choices were not a pure function of the snapshot; ties are
 * broken deterministically (candidate order, with a small bonus for continuing straight) rather than with
 * `Math.random()`.
 *
 * "One-step safe" here means immediately-safe-and-not-a-dead-end, exactly as `greedyBot.js`'s
 * `freeNeighborCount` gate does: a candidate cell that is safe right now but has no safe neighbour of its own
 * is a dead end the bot would be trapped in on its very next step, so it is treated as no better than a wall.
 */

/**
 * @param {import('../driver.js').PolicyView} view
 * @returns {import('../driver.js').PolicyMove}
 */
export function greedy(view) {
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

  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  const opponents = snapshot.snakes.filter((_, index) => index !== playerIndex);

  // `snapshot.lasers` is `{phase, inset, insetCells}` with no bounds of its own — the safe square is
  // `[inset, grid.width - 1 - inset]` on both axes (driver.js's `PolicyView` doc, `src/core/lasers.js`'s
  // `isDeadly`). At inset 0 this is exactly "in bounds", which is the wall being deadly from second 0.
  const inset = snapshot.lasers.inset;
  const isDeadly = (cell) =>
    cell.x < inset ||
    cell.x >= grid.width - inset ||
    cell.y < inset ||
    cell.y >= grid.height - inset;

  const isImmediatelySafe = (cell) => {
    if (isDeadly(cell)) return false;
    if (segmentsContain(ownBodyAfterStep(me), cell)) return false;
    return !opponents.some(
      (opponent) => opponent.alive && segmentsContain(opponent.segments, cell),
    );
  };

  const freeNeighborCount = (cell) => {
    let count = 0;
    for (const dir of CARDINALS) {
      if (isImmediatelySafe({ x: cell.x + dir.dx, y: cell.y + dir.dy })) count += 1;
    }
    return count;
  };

  // `snapshot.powerUps` is `{pickups: [{cell, type}]}`, not an array; `snapshot.apples` may contain `null`
  // entries for empty slots (`§2.3`: `foodCount` is a target, not an invariant) so they are filtered here.
  const pickups = snapshot.powerUps.pickups;
  const apples = snapshot.apples.filter((apple) => apple !== null);
  // Power-up cells listed first: `nearest`'s reduce only replaces the running closest on a *strictly*
  // smaller distance, so a power-up at the same distance as the nearest apple stays chosen (KS-06-04: prefer
  // a power-up over an apple on a tie, nearest target wins otherwise).
  const targets = [...pickups.map((pickup) => pickup.cell), ...apples];

  const nearest = (cells, from) =>
    cells.reduce((closest, cell) =>
      manhattan(cell, from) < manhattan(closest, from) ? cell : closest,
    );

  const head = me.segments[0];
  const candidates = CARDINALS.filter((dir) => !isOpposite(dir, me.direction));

  /** @type {{score: number, dir: {name: string, dx: number, dy: number}} | null} */
  let best = null;
  for (const dir of candidates) {
    const next = { x: head.x + dir.dx, y: head.y + dir.dy };
    if (!isImmediatelySafe(next)) continue;
    if (freeNeighborCount(next) === 0) continue; // a dead-end is as good as a wall

    const target = targets.length > 0 ? nearest(targets, next) : next;
    const threatened = opponents.some(
      (opponent) => opponent.alive && manhattan(opponent.segments[0], next) <= 1,
    );
    // Distance to the nearest apple/power-up dominates the score; a heavy penalty for landing next to a
    // living opponent's head, where a head-on is one bad step away; a small deterministic bonus for
    // continuing straight, so ties do not flip-flop between two equally-close targets frame to frame.
    const straightBonus = dir.dx === me.direction.dx && dir.dy === me.direction.dy ? 0.5 : 0;
    const score = -manhattan(target, next) + straightBonus - (threatened ? 30 : 0);
    if (best === null || score > best.score) best = { score, dir };
  }

  if (best === null) return null;
  if (best.dir.dx === me.direction.dx && best.dir.dy === me.direction.dy) return null;
  return /** @type {import('../driver.js').PolicyMove} */ (best.dir.name);
}
