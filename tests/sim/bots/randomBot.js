// @ts-check
import { DIRECTIONS, isOpposite } from '../../../src/core/grid.js';

/**
 * The "dumb" bot of `QA-STRATEGY §4`: random legal turns every N steps. It exists to measure design health
 * against noise, not to play well — a game whose numbers only look reasonable against careful bots is hiding
 * something.
 *
 * "Legal" here means only "not the reverse of the current direction" (`DESIGN-DECISIONS §2.2`; `Snake` would
 * silently drop a reversal anyway). It does not mean "safe" — this bot walks into walls and its own body just
 * as readily as anywhere else, which is the point.
 */

/** @typedef {import('../harness.js').Bot} Bot */

const CARDINALS = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];

/**
 * Builds a `randomBot`. `turnEveryNSteps` is read off `view.decisionIndex` rather than kept as internal state,
 * so the same bot instance can be reused across rounds (or several instances built once) without needing to
 * be reset — `decisionIndex` restarts at 0 for every round because the harness builds it fresh each call to
 * `runRound` (`harness.js`).
 *
 * Direction is drawn with `rng.pick` (`src/core/rng.js`), never a modulo on a raw integer — CLAUDE.md and the
 * tech lead's note on `harness.js` both call out `rnd() % 4` as the mistake that biased an earlier fuzzing run.
 *
 * @param {object} [options]
 * @param {number} [options.turnEveryNSteps] - how many of this bot's own grid steps pass between turns
 * @returns {Bot}
 */
export function createRandomBot({ turnEveryNSteps = 5 } = {}) {
  return function randomBot({ self, rng, decisionIndex }) {
    if (decisionIndex % turnEveryNSteps !== 0) return null;
    const candidates = CARDINALS.filter((direction) => !isOpposite(direction, self.direction));
    const choice = rng.pick(candidates);
    return choice === self.direction ? null : choice;
  };
}

/** A ready-to-use `randomBot` with the default turn frequency. */
export const randomBot = createRandomBot();
