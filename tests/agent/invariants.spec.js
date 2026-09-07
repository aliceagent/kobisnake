import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { HUD_LENGTH_TOLERANCE, HUD_TIMER_TOLERANCE_SECONDS, checkInvariants } from './invariants.js';
import { playMatch } from './driver.js';

/**
 * KI-03-03 AC3 — ten seeded matches through the real driver, invariants wired in, reporting zero problems.
 *
 * This is the "prove it in the page, not only in Node" half of ruling 3 on issue #122: `invariants.test.js`
 * proves the checks are individually correct against hand-built snapshots, but a free variable in
 * {@link checkInvariants}'s body would still compile fine in Node and only throw once the driver actually
 * serialises it with `Function.prototype.toString()` and runs it inside the page (`tests/agent/README.md`).
 * Running it here, through `playMatch`'s own `invariants`/`invariantConfig` options, is what actually proves
 * that.
 *
 * **Policies.** KI-03-02 (`tests/agent/policies/`) owns the real greedy/survivor/idle policies and is being
 * built in parallel on its own branch — it does not exist here. Per the ticket, this spec defines the
 * smallest policy that produces real, finishing matches (not the idle board `driver.js`'s own header warns a
 * "nothing to drive" run proves nothing with), inline, self-contained the same way {@link checkInvariants} is
 * (`driver.js`'s header: the driver ships a policy into the page as source text too).
 */

/**
 * Heads for the nearest apple; refuses a step that would leave the grid, enter the laser dead zone, reverse
 * into its own neck, or land on any living snake's segment. Not tuned, not a design instrument — it only
 * exists so AC3 is measured against real whole matches. Self-contained: no reference to anything outside its
 * own body (`driver.js`'s header; the driver ships this into the page with `Function.prototype.toString()`).
 *
 * @param {import('./driver.js').PolicyView} view
 * @returns {import('./driver.js').PolicyMove}
 */
function cautiousGreedyPolicy(view) {
  const { snapshot, playerIndex, grid } = view;
  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;

  const deltas = {
    UP: { dx: 0, dy: 1 },
    DOWN: { dx: 0, dy: -1 },
    LEFT: { dx: -1, dy: 0 },
    RIGHT: { dx: 1, dy: 0 },
  };

  const inset = snapshot.lasers.inset;
  const occupied = new Set();
  for (const snake of snapshot.snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.segments) occupied.add(cell.x + ',' + cell.y);
  }

  const apples = (snapshot.apples ?? []).filter((apple) => apple !== null && apple !== undefined);
  const head = me.segments[0];
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const target =
    apples.length === 0
      ? head
      : apples.reduce((best, apple) => (distance(apple, head) < distance(best, head) ? apple : best));

  let best = null;
  for (const name of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    const delta = deltas[name];
    if (delta.dx === -me.direction.dx && delta.dy === -me.direction.dy) continue;
    const next = { x: head.x + delta.dx, y: head.y + delta.dy };
    if (next.x < inset || next.y < inset) continue;
    if (next.x > grid.width - 1 - inset || next.y > grid.height - 1 - inset) continue;
    if (occupied.has(`${next.x},${next.y}`)) continue;
    const score = -distance(target, next);
    if (best === null || score > best.score) best = { score, name };
  }
  return best === null ? null : best.name;
}

/**
 * Ten fixed seeds, quoted here and in every log line, so a failure is replayable (the same discipline
 * `playtest.spec.js`'s own `SEEDS` follows). Distinct from that file's list on purpose — this spec answers a
 * different question (do the invariants stay silent) and should not be read as re-running KI-03-01's own AC1.
 */
export const SEEDS = [11, 22, 33, 44, 55, 66, 77, 88, 99, 110];

/**
 * The HUD tolerance derived from `session.js`'s real `HUD_INTERVAL_SECONDS` (KI-03-03 AC2), and the real
 * grid size from `src/core/settings.js` (`DESIGN-DECISIONS §2.1`, never hand-typed here) — the Node-side
 * values `checkInvariants`'s serialised body is not allowed to import for itself (ruling 3 on issue #122).
 *
 * @type {{grid: {width: number, height: number}, hudTimerToleranceSeconds: number, hudLengthTolerance: number}}
 */
const INVARIANT_CONFIG = {
  grid: { width: SETTINGS.grid.width, height: SETTINGS.grid.height },
  hudTimerToleranceSeconds: HUD_TIMER_TOLERANCE_SECONDS,
  hudLengthTolerance: HUD_LENGTH_TOLERANCE,
};

/** AC1's own budget (`playtest.spec.js`) is 60 s for ten matches driven by a comparable policy; matched here. */
const TEN_MATCH_BUDGET_MS = 60_000;

test.describe('KI-03-03 · per-frame invariants', () => {
  test('KI-03-03 AC3: ten seeded Best-of-3 matches report zero invariant problems', async ({ page }) => {
    test.setTimeout(TEN_MATCH_BUDGET_MS * 3);

    /** @type {import('./driver.js').MatchResult[]} */
    const results = [];
    for (const seed of SEEDS) {
      results.push(
        await playMatch(page, {
          seed,
          bestOf: 3,
          policy1: cautiousGreedyPolicy,
          policy2: cautiousGreedyPolicy,
          invariants: checkInvariants,
          invariantConfig: INVARIANT_CONFIG,
        }),
      );
    }

    for (const result of results) {
      // Every problem's own {rule, detail, frame, round}, not just a count, so a real failure here reads as
      // the actual thing that went wrong rather than as `0 !== 3`.
      expect(
        result.problemCount,
        `seed ${result.seed}: ${JSON.stringify(result.problems, null, 2)}`,
      ).toBe(0);
      // A page error or console.error is a real defect too, and the invariants module cannot see it —
      // `driver.js`'s own `pageErrors` collection is the only thing that does.
      expect(result.pageErrors, `seed ${result.seed}`).toEqual([]);
    }

    const notFinished = results.filter((result) => !result.finished);
    const rounds = results.reduce((sum, result) => sum + result.rounds.length, 0);
    const frames = results.reduce((sum, result) => sum + result.frames, 0);
    console.log(
      `KI-03-03 AC3: ${SEEDS.length} matches (seeds ${SEEDS.join(', ')}), ${rounds} rounds, ${frames} frames, ` +
        `0 invariant problems. ${notFinished.length} match(es) did not finish inside the frame budget: ` +
        `${notFinished.map((result) => result.seed).join(', ') || 'none'}.`,
    );
    // A match that never finishes is #119 F1 (`DESIGN-DECISIONS §1 row 26` is ruled but I01/#120 has not
    // landed it yet, per the I03 tech-lead's own ruling 2 on issue #122) — a filed, tracked design defect
    // this ticket does not own the fix for, not a new finding. It is still reported above by seed rather than
    // silently absorbed into a passing test, and the invariant/page-error assertions above still ran on
    // every frame this match *did* play.
  });
});
