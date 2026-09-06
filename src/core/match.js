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
 *   - A `DRAW` never ends the match — it is replayed, not scored (`§2.5` row 7) — and a **practice** round's
 *     `result` is `null` rather than one of `RESULTS` (`§2.5`: "practice rounds have no result"). Both count
 *     the round as played and change nothing else, so `recordRound` treats `null` exactly like `DRAW`; there
 *     is no separate "practice" rule to invent.
 *   - `rewardKeys` is the prize the *match winner* takes home (`§2.6`: "to the winner only"), read once at
 *     match creation from `SETTINGS.rewards[bestOf]`. It is not a per-player amount and it does not change as
 *     the match is played — whoever's `winner` this match ends up with is who the caller pays it to.
 */

/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./events.js').RoundResult} RoundResult */
/** @typedef {{id: string, color?: string}} Player */
/** @typedef {1 | 2} PlayerNumber */

/**
 * @typedef {object} MatchState
 * @property {number} bestOf - the format this match was created with (one of `settings.bestOfOptions`)
 * @property {number} target - rounds a player must win to take the match: `Math.ceil(bestOf / 2)`
 * @property {number} rewardKeys - keys the match winner earns, from `settings.rewards[bestOf]` (`§2.6`)
 * @property {Player[]} players - the two players this match is between, in `[player 1, player 2]` order; a
 *   copy, never the caller's own array
 * @property {{1: number, 2: number}} wins - rounds won so far, keyed by player number
 * @property {number} roundsPlayed - every round recorded so far, wins and draws alike
 * @property {PlayerNumber | null} winner - the player number who reached `target` wins, or `null` while the
 *   match is still open
 * @property {(result: RoundResult | null) => void} recordRound - records one round's outcome; throws once
 *   {@link MatchState.isOver} is already true
 * @property {() => boolean} isOver - true once a player has reached `target` wins
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

  /** @type {MatchState} */
  const match = {
    bestOf,
    target,
    rewardKeys: settings.rewards[bestOf],
    players: players.map((player) => ({ id: player.id, color: player.color })),
    wins: { 1: 0, 2: 0 },
    roundsPlayed: 0,
    winner: null,

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
        if (match.wins[1] >= target) match.winner = 1;
      } else if (result === RESULTS.P2_WIN) {
        match.wins[2] += 1;
        if (match.wins[2] >= target) match.winner = 2;
      }
      // A draw is replayed, never scored (`§2.5` row 7), and a practice round's `null` result is the same
      // "nothing to score" case (`§2.5`: "practice rounds have no result") — both just count as played.
    },

    isOver() {
      return match.winner !== null;
    },

    winsNeeded(player) {
      return Math.max(0, target - match.wins[player]);
    },
  };

  return match;
}
