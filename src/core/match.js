// @ts-check
import { RESULTS } from './events.js';
import { SETTINGS } from './settings.js';

/**
 * Best-of match bookkeeping (`ARCHITECTURE §3`, `DESIGN-DECISIONS §2.6`). A match is nothing but a running
 * tally of round results — how each round came out is `round.js`'s business, and `RoundSimulation.getState()`
 * already answers "who won this round" via its `ROUND_OVER` event. `MatchState` only ever sees the `result`
 * out of that event.
 *
 * Two things the ticket calls out that are easy to get backwards:
 *   - A `DRAW` never *scores* — it is replayed, not counted toward either player's `wins` (`§2.5` row 7) —
 *     but it is no longer free forever. Two draws in a row are still just replayed; the **third consecutive
 *     draw ends the match** (`§1` row 26, `DESIGN-DECISIONS §2.6`): whoever has more `wins` takes it, and a
 *     level score ends the match as a tie, won by nobody. Without this a match of nothing but draws never
 *     ends — the defect this rule exists to close (`§1` row 26 cites agent QA #119 F1: two idle players draw
 *     at tick 380 every round, forever). Any decisive round resets the streak back to zero.
 *   - A **practice** round's `result` is `null` rather than one of `RESULTS` (`§2.5`: "practice rounds have
 *     no result"). It still counts as played, exactly like a `DRAW` used to — but it is not itself a draw:
 *     it neither adds to nor resets the consecutive-draw streak, so three practice rounds in a row cannot
 *     trigger the cap. There is no separate "practice" rule beyond that one exclusion.
 *   - `rewardKeys` is the prize the *match winner* takes home (`§2.6`: "to the winner only"), read once at
 *     match creation from `SETTINGS.rewards[bestOf]`. It is not a per-player amount and it does not change as
 *     the match is played — whoever's `winner` this match ends up with is who the caller pays it to. A tie
 *     has no winner, so nothing is paid; that payout wiring belongs to the screen that shows it, not here.
 *   - **KI-12-04:** "keys are awarded only when at least one human played" (`§1` row 26 is the draw rule;
 *     row 27 is this one). A CPU never earns a key on a human's behalf, so `rewardKeys` above is forced to
 *     `0` the moment nobody in `players` is human — regardless of `bestOf`. This is a property of *who is
 *     playing the match*, decided once at the same moment `bestOf` picks the reward amount, so it lives here
 *     rather than as a branch in `session.js`'s `enterMatchOver` (which already has to special-case a tie's
 *     own "no winner, no keys" — this is the second, independent reason a match can pay nothing).
 */

/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./events.js').RoundResult} RoundResult */
/**
 * `isCpu` is KI-12-04's own addition: `true` when this player is a computer, `false`/absent for a human
 * (`DESIGN-DECISIONS §1` row 27's default, "HUMAN for both"). It is read once, at {@link createMatch} time,
 * to decide {@link MatchState.rewardKeys} below — never copied into {@link MatchState.players} itself, which
 * keeps its pre-existing `{id, color}` shape exactly (`tests/unit/core/match.test.js`'s own "players are
 * copied" test asserts `match.players` against a plain `{id, color}` fixture with no third key).
 * @typedef {{id: string, color?: string, isCpu?: boolean}} Player
 */
/** @typedef {1 | 2} PlayerNumber */

/**
 * Why a match ended: a player reached the win target the normal way, or the draw cap ended it early
 * (`DESIGN-DECISIONS §1` row 26). Exported so callers compare against named constants rather than bare
 * string literals, the same shape as `RESULTS` and `END_REASONS` in `events.js`.
 *
 * @type {{TARGET_REACHED: 'TARGET_REACHED', DRAW_CAP: 'DRAW_CAP'}}
 */
export const MATCH_END_REASONS = Object.freeze({
  TARGET_REACHED: 'TARGET_REACHED',
  DRAW_CAP: 'DRAW_CAP',
});

/** @typedef {'TARGET_REACHED' | 'DRAW_CAP'} MatchEndReason */

/**
 * @typedef {object} MatchState
 * @property {number} bestOf - the format this match was created with (one of `settings.bestOfOptions`)
 * @property {number} target - rounds a player must win to take the match: `Math.ceil(bestOf / 2)`
 * @property {number} rewardKeys - keys the match winner earns, from `settings.rewards[bestOf]` (`§2.6`), or
 *   `0` regardless of `bestOf` when no `players` entry is human (KI-12-04, `§1` row 27)
 * @property {Player[]} players - the two players this match is between, in `[player 1, player 2]` order; a
 *   copy, never the caller's own array
 * @property {{1: number, 2: number}} wins - rounds won so far, keyed by player number
 * @property {number} roundsPlayed - every round recorded so far, wins and draws alike
 * @property {number} consecutiveDraws - draws recorded since the last decisive round; a live property like
 *   `roundsPlayed`, reset to 0 by any `P1_WIN`/`P2_WIN` and left untouched by a practice round's `null`
 * @property {PlayerNumber | null} winner - the player number who reached `target` wins, or who held more
 *   `wins` when the draw cap fired; `null` while the match is open, and `null` again if the draw cap fires on
 *   a level score (a tie — the only way `isOver()` is true with `winner === null`)
 * @property {MatchEndReason | null} endReason - why the match ended, `null` while it is still open. Mirrors
 *   `winner`: both are set together, in the same `recordRound` call that ends the match.
 * @property {(result: RoundResult | null) => void} recordRound - records one round's outcome; throws once
 *   {@link MatchState.isOver} is already true
 * @property {() => boolean} isOver - true once the match has ended, by either {@link MatchEndReason}
 * @property {(player: PlayerNumber) => number} winsNeeded - wins still needed for `player` to take the match,
 *   floored at 0
 */

/**
 * Builds a fresh `MatchState` for one best-of match.
 *
 * @param {object} options
 * @param {number} options.bestOf - must be one of `settings.bestOfOptions` ([1, 3, 5] shipping)
 * @param {Player[]} options.players - exactly two players, `[player 1, player 2]`
 * @param {Settings} [options.settings] - defaults to the shipping `SETTINGS`, exactly as `RoundSimulation` does
 *   (`round.js`), so a test can pass `withOverrides(...)`
 * @returns {MatchState}
 * @throws {RangeError} when `bestOf` is not one of `settings.bestOfOptions`, or `players` is not exactly two
 */
export function createMatch({ bestOf, players, settings = SETTINGS }) {
  if (!settings.bestOfOptions.includes(bestOf)) {
    throw new RangeError(
      `createMatch: bestOf must be one of ${settings.bestOfOptions.join(', ')}, got ${bestOf}`,
    );
  }
  if (players.length !== 2) {
    throw new RangeError(`createMatch: expected exactly 2 players, got ${players.length}`);
  }

  // Bo1 → 1, Bo3 → 2, Bo5 → 3 (`DESIGN-DECISIONS §2.6`). Derived rather than a literal {1: 1, 3: 2, 5: 3}
  // table, so a future best-of format needs no new row here — only a new entry in `settings.bestOfOptions`.
  const target = Math.ceil(bestOf / 2);

  // KI-12-04 (`§1` row 27): "keys are awarded only when at least one human played". `isCpu` defaults to
  // falsy (a plain `{id, color}` player, as every caller before this ticket already passes, counts as
  // human) so this reproduces every existing `rewardKeys` expectation unchanged the moment either seat is
  // human — the only new outcome is the all-CPU case, which was never reachable before KI-12-02.
  const hasHuman = players.some((player) => !player.isCpu);

  /** @type {MatchState} */
  const match = {
    bestOf,
    target,
    rewardKeys: hasHuman ? settings.rewards[bestOf] : 0,
    players: players.map((player) => ({ id: player.id, color: player.color })),
    wins: { 1: 0, 2: 0 },
    roundsPlayed: 0,
    consecutiveDraws: 0,
    winner: null,
    endReason: null,

    recordRound(result) {
      if (match.isOver()) {
        throw new Error('createMatch: recordRound called after the match is already over');
      }
      if (
        result !== RESULTS.P1_WIN &&
        result !== RESULTS.P2_WIN &&
        result !== RESULTS.DRAW &&
        result !== null
      ) {
        // Validated before anything is recorded: a garbage value must not count as a played round any more
        // than it should silently corrupt the score.
        throw new RangeError(`createMatch: recordRound: unrecognised result ${String(result)}`);
      }

      match.roundsPlayed += 1;
      if (result === RESULTS.P1_WIN) {
        match.wins[1] += 1;
        match.consecutiveDraws = 0; // a decisive round resets the streak (`§1` row 26)
        if (match.wins[1] >= target) {
          match.winner = 1;
          match.endReason = MATCH_END_REASONS.TARGET_REACHED;
        }
      } else if (result === RESULTS.P2_WIN) {
        match.wins[2] += 1;
        match.consecutiveDraws = 0;
        if (match.wins[2] >= target) {
          match.winner = 2;
          match.endReason = MATCH_END_REASONS.TARGET_REACHED;
        }
      } else if (result === RESULTS.DRAW) {
        // A draw is replayed, never scored (`§2.5` row 7) — but not indefinitely. The third in a row ends
        // the match right here: the player with more `wins` takes it, or nobody does when they're level.
        match.consecutiveDraws += 1;
        if (match.consecutiveDraws >= settings.maxConsecutiveDraws) {
          if (match.wins[1] > match.wins[2]) {
            match.winner = 1;
          } else if (match.wins[2] > match.wins[1]) {
            match.winner = 2;
          } else {
            match.winner = null; // level score: a tie, won by nobody (`§2.6`)
          }
          match.endReason = MATCH_END_REASONS.DRAW_CAP;
        }
      }
      // `result === null` is a practice round (`§2.5`: "practice rounds have no result"). It counts as
      // played like everything above, but it is deliberately excluded from every branch above it: it must
      // neither add to nor reset `consecutiveDraws`, because a practice round is not itself a draw and three
      // of them must not be able to trigger — or delay — the draw cap.
    },

    isOver() {
      // Both branches above set `endReason` in the same call that decides the match, so this one check
      // covers a normal win *and* the draw-cap case — including the tie, where `winner` stays `null` but
      // `endReason` does not. Checking `winner !== null` alone would miss the tie and leave it replaying
      // forever, exactly the defect this rule exists to close.
      return match.endReason !== null;
    },

    winsNeeded(player) {
      return Math.max(0, target - match.wins[player]);
    },
  };

  return match;
}
