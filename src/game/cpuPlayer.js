// @ts-check

import { MOVE_VECTORS } from './bots/policy.js';

/**
 * KI-12-02 — driving a CPU player through the input queue.
 *
 * A CPU player is a thin adapter, not a second way to move a snake. `session.js`'s `handleDirection` is
 * already the one seam a keyboard feeds — it state-gates (PLAYING / LASER_WARNING / COUNTDOWN's "GO" beat),
 * records the input into `roundInputLog` (so a CPU match lands in the replay for free) and calls
 * `sim.applyInput` (so `inputBufferSize` and the no-reversal rule apply exactly as they do for a human). This
 * module never calls `sim.applyInput` itself and never reaches into a `RoundSimulation` beyond the public
 * `getState()` snapshot `session.js` hands it — see `src/game/bots/policy.js`'s module doc for why a policy
 * may see nothing else.
 *
 * ## Once per grid step, not once per frame
 *
 * `tests/sim/harness.js`'s own module doc (point 2) and `tests/agent/driver.js` both drive a bot from the
 * same cheap signal: **the bot's own head cell changed**. A snake commits at most one queued direction per
 * grid step (`Snake.commitStep`), so asking a policy every simulation frame would recompute the same answer
 * many times over for nothing, and — worse for a CPU whose decisions are meant to look considered — would
 * spend the policy on frames where nothing has actually happened yet. Comparing the head cell to the one the
 * last decision was made from is `driver.js`'s own trick, reused rather than reinvented so this module cannot
 * drift from the one other place a policy is already driven frame-by-frame in this repository.
 *
 * `decisionIndex` (see `policy.js`'s `PolicyView`) counts from 0 every round; {@link CpuPlayer.reset} is
 * `session.js`'s cue that a fresh round has started and both the head-cell memory and the count must forget
 * the round that just ended — otherwise a spawn cell that happens to match the previous round's final head
 * cell would silently swallow this round's first decision.
 *
 * ## No randomness, ever
 *
 * `createCpuPlayer` never builds a `rules` field for the view it hands the policy. An absent `rules` means
 * {@link import('./bots/policy.js').PLAY_RULES} — dead-zone aware, contested cells excluded, no `jitter` —
 * which is what makes a CPU a pure function of the snapshot and a CPU-vs-CPU match replay identically on the
 * same seed (KI-12-02 AC1). Passing `MEASUREMENT_RULES` here would be reaching for `tests/sim`'s fixture
 * rules in production code, and passing any `jitter` at all would put randomness outside `core/rng.js`'s
 * seeded stream — both are exactly what this ticket's "no RNG, ever" instruction forbids.
 */

/** @typedef {import('./bots/policy.js').Policy} Policy */
/** @typedef {import('./bots/policy.js').PolicySnapshot} PolicySnapshot */
/** @typedef {import('../core/grid.js').GridSize} GridSize */
/** @typedef {import('../core/grid.js').Direction} Direction */

/**
 * @typedef {object} CreateCpuPlayerOptions
 * @property {1 | 2} playerNumber - which player this CPU is playing; indexes `snapshot.snakes` at
 *   `playerNumber - 1`, the same convention `policy.js`'s `playerIndex` uses.
 * @property {Policy} policy - a pure `(view) => PolicyMove` function. KI-12-03 supplies EASY/NORMAL/HARD;
 *   this module knows nothing about level names, only that it was handed a function.
 */

/**
 * @typedef {object} CpuPlayer
 * @property {(snapshot: PolicySnapshot, grid: GridSize) => Direction | null} decide - asks the policy for
 *   this player's next steering input, but only when this player's head has moved to a new cell since the
 *   last call; otherwise returns `null` without calling the policy at all. `null` also means "press nothing"
 *   when the policy itself declines to answer (dead, or chose to keep going straight).
 * @property {() => void} reset - forgets the last-seen head cell and restarts `decisionIndex` at 0. Call this
 *   once per fresh round, before the first `decide()` of that round.
 */

/**
 * Builds one CPU player. Stateless with respect to the simulation — every `decide()` call is handed the
 * current public snapshot rather than holding a reference to a live `RoundSimulation` — so the only state
 * this closure keeps is "what did I decide from last", which is exactly the state {@link CpuPlayer.reset}
 * clears.
 *
 * @param {CreateCpuPlayerOptions} options
 * @returns {CpuPlayer}
 */
export function createCpuPlayer({ playerNumber, policy }) {
  const playerIndex = playerNumber - 1;

  /**
   * The head cell (`"x,y"`) this player last decided from, or `null` before this round's first decision.
   * A string key rather than a `{x, y}` compare so `decide()` stays a single equality check.
   * @type {string | null}
   */
  let lastHeadKey = null;

  /** How many decisions this policy has been asked for this round, from 0 (`policy.js`'s `decisionIndex`). */
  let decisionIndex = 0;

  return {
    decide(snapshot, grid) {
      const snake = snapshot.snakes[playerIndex];
      if (snake === undefined || !snake.alive) return null;

      const head = snake.segments[0];
      const headKey = `${head.x},${head.y}`;
      if (headKey === lastHeadKey) return null;
      lastHeadKey = headKey;

      const move = policy({ snapshot, playerIndex, grid, decisionIndex });
      decisionIndex += 1;
      return move === null || move === undefined ? null : MOVE_VECTORS[move];
    },
    reset() {
      lastHeadKey = null;
      decisionIndex = 0;
    },
  };
}
