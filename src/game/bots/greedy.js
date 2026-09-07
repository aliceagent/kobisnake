// @ts-check

/**
 * KI-12-01 — the greedy play policy: heads for the nearest apple or power-up, refusing any cell that is not
 * immediately safe and any cell whose own neighbours are all unsafe.
 *
 * Moved into `src/` from the two places it used to live: `tests/sim/bots/greedyBot.js` (Sprint 02, ported
 * from `docs/design/spikes/design-validation-sim.py`'s `greedy`) and `tests/agent/policies/greedy.js`
 * (KI-03-02, PR #174). Both now import this file. See `policy.js`'s module doc for why the two were not the
 * same function and how {@link import('./policy.js').PolicyRules} keeps both sets of recorded numbers exact.
 *
 * **Everything is nested inside the exported function on purpose.** `tests/agent/driver.js` ships a policy
 * into the page as source text (`Function.prototype.toString()`), so a module-level helper or constant
 * referenced from the body would arrive in the page undefined. Nothing here may be hoisted out, however
 * much the duplication with `survivor.js` invites it.
 *
 * "One-step safe" means immediately-safe **and not a dead end**: a cell that is safe right now but whose
 * four neighbours are all unsafe is somewhere the snake is trapped on its very next step, so it is treated
 * as no better than a wall.
 *
 * **KS-06-04's power-up rule survives the move unchanged:** nearest target wins, and a power-up at the same
 * distance as the nearest apple is preferred, which falls out of listing pickups before apples and only
 * replacing the running closest on a *strictly* smaller distance. This is deliberately not a value model —
 * no "a power-up is worth N apples" weighting — because inventing one would be inventing a mechanic
 * (`CLAUDE.md`).
 */

/**
 * @param {import('./policy.js').PolicyView} view
 * @returns {import('./policy.js').PolicyMove}
 */
export function greedy(view) {
  const { snapshot, playerIndex, grid } = view;

  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;

  // `policy.js`'s PLAY_RULES, inlined: a policy may not read a module-level constant (see the module doc).
  // `tests/unit/game/bots/rules.test.js` pins these against PLAY_RULES so the two cannot drift apart.
  const rules = view.rules ?? {};
  const laserAware = rules.laserAware ?? true;
  const jitter = rules.jitter ?? null;
  const straightBonus = rules.straightBonus ?? 0.5;

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
   * `me`'s own segments as they will be solid *after* this step: the tail cell vacates unless an apple
   * eaten earlier is still owed a segment. This is the only `pendingGrowth` any policy may read, and only
   * ever its own — never an opponent's, which a human player cannot see (`policy.js`).
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

  // The safe square is `[inset, width - 1 - inset]` on both axes (`src/core/lasers.js`'s `isDeadly`; the
  // wall is simply "inset −1", so one query answers wall *and* dead-zone deaths). Pinning `inset` to 0
  // under `laserAware: false` reduces this to exactly `!inBounds`, which is the wall-only check
  // `greedyBot` has always made and the bot matrix was recorded with.
  const inset = laserAware ? snapshot.lasers.inset : 0;
  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isDeadly = (cell) =>
    cell.x < inset ||
    cell.x >= grid.width - inset ||
    cell.y < inset ||
    cell.y >= grid.height - inset;

  /**
   * @param {{x: number, y: number}} cell
   * @returns {boolean}
   */
  const isImmediatelySafe = (cell) => {
    if (isDeadly(cell)) return false;
    if (segmentsContain(ownBodyAfterStep(me), cell)) return false;
    return !opponents.some(
      (opponent) => opponent.alive && segmentsContain(opponent.segments, cell),
    );
  };

  /**
   * @param {{x: number, y: number}} cell
   * @returns {number}
   */
  const freeNeighborCount = (cell) => {
    let count = 0;
    for (const dir of CARDINALS) {
      if (isImmediatelySafe({ x: cell.x + dir.dx, y: cell.y + dir.dy })) count += 1;
    }
    return count;
  };

  // Pickups first, so a power-up at the same distance as the nearest apple wins the tie (see module doc).
  // `apples` is filtered because a snapshot may hold `null` for an empty slot — `§2.3` calls `foodCount` a
  // target rather than an invariant.
  const targets = [
    ...snapshot.powerUps.pickups.map((pickup) => pickup.cell),
    ...snapshot.apples.filter((apple) => apple !== null),
  ];

  /**
   * @param {{x: number, y: number}[]} cells
   * @param {{x: number, y: number}} from
   * @returns {{x: number, y: number}}
   */
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
    // Distance to the nearest target dominates; landing next to a living opponent's head, where a head-on
    // is one bad step away, is heavily penalised. `jitter` is called here and only here — once per
    // candidate that clears both guards, in candidate order — because that is exactly where and how often
    // `greedyBot` drew from its stream, and the bot matrix reproduces only if the draws line up.
    const straight = dir.dx === me.direction.dx && dir.dy === me.direction.dy;
    const score =
      -manhattan(target, next) +
      (straight ? straightBonus : 0) +
      (jitter === null ? 0 : jitter()) -
      (threatened ? 30 : 0);
    if (best === null || score > best.score) best = { score, dir };
  }

  if (best === null) return null;
  if (best.dir.dx === me.direction.dx && best.dir.dy === me.direction.dy) return null;
  return /** @type {import('./policy.js').PolicyMove} */ (best.dir.name);
}
