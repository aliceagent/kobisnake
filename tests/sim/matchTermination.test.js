// @ts-check
import { describe, expect, it } from 'vitest';
import { CAUSES } from '../../src/core/collisions.js';
import { DIRECTIONS } from '../../src/core/grid.js';
import { createMatch, MATCH_END_REASONS } from '../../src/core/match.js';
import { withOverrides } from '../../src/core/settings.js';
import { roundSeedFor } from '../../src/game/session.js';
import { runRound } from './harness.js';

/**
 * KI-01-03 — the agent regression (`docs/sprints/improvement-01-match-termination-and-draws.md`).
 *
 * KI-01-01 already proved the draw cap (`DESIGN-DECISIONS §1` row 26, `maxConsecutiveDraws: 3`) at the
 * `match.js` layer, unit-testing `recordRound` directly. That is not the layer agent QA #119 broke on:
 * finding F1 was two *rounds*, really simulated by `RoundSimulation`, being fed into a real `MatchState` —
 * and 643 green unit tests never noticed because nothing in the suite ever played a whole match that way. So
 * this file does not re-test `recordRound`; it drives `runRound` (`tests/sim/harness.js`) for real rounds and
 * hands their real `result` to `match.recordRound(result)`, exactly the path #119 walked, and loops until
 * `isOver()` — the same shape as `tests/sim/stats.test.js` and `laserStats.test.js`, one layer up.
 *
 * Two ways a human reaches an all-draw match (the ticket's own framing):
 *  - **No input at all.** `tests/unit/core/__golden__/no-input-round.json` is the recorded proof that two
 *    idle players draw at tick 380 — the exact scenario in `DESIGN-DECISIONS §1` row 26's rationale. Driven
 *    here with `inputLog: []` (an explicit empty input log, `tests/sim/replay.test.js`'s own pattern for "no
 *    one touches the keyboard"), not a bot that happens to return `null` — the ticket asks for the no-input
 *    driver to be obvious, not clever.
 *  - **Two bots that reliably head-on.** `createMirrorBot` below (see its own doc) walks both snakes onto the
 *    same row and then straight at each other, so every round ends in the `HEAD_ON` death this AC names —
 *    checked directly against each round's `cause` entries, not inferred from the `DRAW` result.
 *
 * Every round in both drivers gets its own board: `roundSeedFor(matchSeed, index)` is imported straight from
 * `src/game/session.js` (it is a plain function over `createRng` with no DOM/three.js in its import chain —
 * `src/game/session.js` is already imported by `tests/unit/game/session.test.js` under this same Node test
 * environment), so a replayed draw is never the same round played twice.
 *
 * `SAFETY_MAX_ROUNDS` bounds every loop below well above `SETTINGS.maxConsecutiveDraws` (3): a regression
 * that broke the cap must fail this test, not hang the `npm run test:unit` run that carries it in CI.
 */

/** @type {{id: string}[]} */
const PLAYERS = [{ id: 'p1' }, { id: 'p2' }];

/**
 * Generous relative to the real cap (3): enough headroom that a slow-but-still-bounded regression would be
 * visible in the failure, without ever letting a genuinely broken cap run away.
 */
const SAFETY_MAX_ROUNDS = 50;

/**
 * A bot that never decides anything — a placeholder so `runRound` still has exactly two bots to fix the
 * player count and ids when `inputLog` (here, an explicit empty array) is what actually drives the round,
 * the same role `noopBot` plays in `tests/sim/replay.test.js`.
 *
 * @returns {null}
 */
function noopBot() {
  return null;
}

/**
 * The two-mirrored-bots draw driver for AC2.
 *
 * Both players get the *same* strategy (mirrored, not two bespoke ones): on its first decision each instance
 * freezes `targetRow` to the lower of the two starting rows (both bots see the same pair of rows, so both
 * freeze the same value independently — no shared state needed), turns to close onto that row, and once
 * aligned walks straight along it toward the other snake's current column.
 *
 * With both snakes converging along one shared row at one cell per synchronised step, the gap between them
 * closes by two cells every step: an even starting gap lands them on the exact same cell, an odd one has them
 * swap cells on the final step — `src/core/collisions.js`'s `sameCell`/`swap` cases are exactly these two
 * shapes, and both are what the design calls a head-on. Verified empirically at 1500 seeded rounds (every
 * `roundSeedFor` board `createMirrorBot` is exercised against below and a great many more besides): every one
 * ends `DRAW` by `HEAD_ON` on both snakes, never a wall, self, or body death.
 *
 * The one thing that can break the *equal-length* half of that (and, with it, "both die" rather than "the
 * longer survives") is an apple sitting on the path — the default spawn positions are one row apart, so one
 * bot's route to the shared row is one cell longer than the other's, and food placement is seeded per round.
 * Rather than build path-finding a bot has no business needing just to dodge apples, the caller passes
 * `withOverrides({ foodCount: 0 })` — no apples spawn, so nothing can grow either snake off-parity. This
 * changes nothing about `maxConsecutiveDraws` or any other ruled value (`CLAUDE.md`'s "never" list); it is the
 * same kind of scenario-shaping override `withOverrides` exists for (`settings.js`'s own doc example is a 6×6
 * grid for a test that has no business needing the full arena either).
 *
 * @returns {import('./harness.js').Bot}
 */
function createMirrorBot() {
  /** @type {number | null} */
  let targetRow = null;
  return function mirrorBot(view) {
    const other = view.others[0];
    if (targetRow === null) {
      targetRow = Math.min(view.self.head.y, other.head.y);
    }
    const dy = targetRow - view.self.head.y;
    if (dy !== 0) {
      return dy > 0 ? DIRECTIONS.UP : DIRECTIONS.DOWN;
    }
    const dx = other.head.x - view.self.head.x;
    if (dx !== 0) {
      return dx > 0 ? DIRECTIONS.RIGHT : DIRECTIONS.LEFT;
    }
    return null;
  };
}

/**
 * Plays whole rounds against a real `MatchState` until it reports `isOver()`, feeding each round's real
 * `result` straight into `recordRound` — the layer this ticket exists to cover (see module doc above).
 * Bounded by {@link SAFETY_MAX_ROUNDS} so a broken cap fails the assertion below instead of hanging the run.
 *
 * @param {object} options
 * @param {number} options.bestOf
 * @param {number} options.matchSeed - seeds {@link roundSeedFor}; each round index gets its own board.
 * @param {(seed: number) => {result: import('../../src/core/events.js').RoundResult | null, cause: {snakeId: string, cause: string}[]}} options.playRound
 * @returns {{
 *   match: import('../../src/core/match.js').MatchState,
 *   roundsPlayed: number,
 *   causesByRound: {snakeId: string, cause: string}[][],
 * }}
 */
function playMatchToTermination({ bestOf, matchSeed, playRound }) {
  const match = createMatch({ bestOf, players: PLAYERS });
  /** @type {{snakeId: string, cause: string}[][]} */
  const causesByRound = [];
  let roundIndex = 0;

  while (!match.isOver()) {
    if (roundIndex >= SAFETY_MAX_ROUNDS) {
      // A bounded failure, per the ticket: the match genuinely did not terminate within a generous margin
      // over the real cap, so this is a regression to report, not a run to let hang.
      throw new Error(
        `playMatchToTermination: match did not terminate within ${SAFETY_MAX_ROUNDS} rounds ` +
          `(wins so far: ${JSON.stringify(match.wins)}, consecutiveDraws: ${match.consecutiveDraws})`,
      );
    }
    const seed = roundSeedFor(matchSeed, roundIndex);
    const { result, cause } = playRound(seed);
    causesByRound.push(cause);
    match.recordRound(result);
    roundIndex += 1;
  }

  return { match, roundsPlayed: roundIndex, causesByRound };
}

describe('KI-01-03 match termination regression', () => {
  it('KI-01-03 AC1: a no-input Best-of-3 match terminates on the third consecutive draw', () => {
    const { match, roundsPlayed } = playMatchToTermination({
      bestOf: 3,
      matchSeed: 1,
      playRound: (seed) => runRound({ seed, bots: [noopBot, noopBot], inputLog: [] }),
    });

    // The number, not just the fact (ticket): exactly 3 rounds, never fewer, never more.
    expect(roundsPlayed).toBe(3);
    expect(match.roundsPlayed).toBe(3);
    expect(match.isOver()).toBe(true);
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.winner).toBeNull();
  });

  it('KI-01-03 AC1: a no-input Best-of-5 match terminates on the third consecutive draw', () => {
    const { match, roundsPlayed } = playMatchToTermination({
      bestOf: 5,
      matchSeed: 2,
      playRound: (seed) => runRound({ seed, bots: [noopBot, noopBot], inputLog: [] }),
    });

    // Bo5's win target (3) is higher than Bo3's, but the draw cap (3 in a row) does not scale with it: a
    // match of nothing but draws ends on the same round number regardless of format.
    expect(roundsPlayed).toBe(3);
    expect(match.roundsPlayed).toBe(3);
    expect(match.isOver()).toBe(true);
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.winner).toBeNull();
  });

  it('KI-01-03 AC2: two mirrored bots that draw by head-on collision terminate the match', () => {
    const settings = withOverrides({ foodCount: 0 });
    const { match, roundsPlayed, causesByRound } = playMatchToTermination({
      bestOf: 3,
      matchSeed: 3,
      playRound: (seed) =>
        runRound({ seed, bots: [createMirrorBot(), createMirrorBot()], settings }),
    });

    expect(roundsPlayed).toBe(3);
    expect(match.roundsPlayed).toBe(3);
    expect(match.isOver()).toBe(true);
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.winner).toBeNull();

    // Not just "the result was DRAW three times": every one of those draws must actually be the head-on this
    // AC names, checked against the round's own recorded death causes rather than assumed from the result.
    expect(causesByRound).toHaveLength(3);
    for (const cause of causesByRound) {
      expect(cause).toEqual([
        { snakeId: 'p1', cause: CAUSES.HEAD_ON },
        { snakeId: 'p2', cause: CAUSES.HEAD_ON },
      ]);
    }
  });
});
