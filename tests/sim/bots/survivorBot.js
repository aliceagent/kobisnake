// @ts-check
import { MEASUREMENT_RULES, MOVE_VECTORS } from '../../../src/game/bots/policy.js';
import { survivor } from '../../../src/game/bots/survivor.js';

/**
 * The "avoids death with two-step lookahead, ignores apples" bot of `QA-STRATEGY §4`, now a **thin adapter**
 * over the one survivor policy in `src/game/bots/survivor.js` (KI-12-01). See `greedyBot.js`'s module doc
 * for the shape of the move and why the snapshot is assembled from live objects rather than copied.
 *
 * **`MEASUREMENT_RULES` is not a preference, it is a fixture.** This bot's numbers are pinned by the
 * committed `docs/qa/playtests/gate1-bot-matrix.md` (`tests/sim/tuningMatrix.test.js` asserts against it to
 * one decimal place). The rule that matters here is `contested: 'penalise'`: this bot has always scored a
 * cell within one step of a living opponent's head down by 25 rather than refusing it, where the browser
 * policy — and therefore the CPU — excludes the cells the opponent could actually step into outright
 * (ruling 5 on #122). The two cover different sets of cells and are not re-weightings of each other, which
 * is why the older behaviour is named and kept rather than approximated.
 *
 * KS-04-04's laser awareness is unchanged and is not a knob: it is identical under both rule sets, gate and
 * all. `survivor.js`'s module doc carries the reasoning that used to live here.
 */

/** @typedef {import('../harness.js').Bot} Bot */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */

/**
 * @param {import('../harness.js').BotView} view
 * @returns {Direction | null}
 */
export function survivorBot({ self, others, apples, powerups, grid, rng, lasers }) {
  const move = survivor({
    snapshot: {
      snakes: [self, ...others],
      apples,
      powerUps: { pickups: powerups ?? [] },
      lasers,
    },
    playerIndex: 0,
    grid,
    // A bare `rng.next()`, unscaled — this bot's tie-break has always been a full unit against a free-space
    // weight of 10 and a straight bonus of 3, drawn once per candidate that clears the safety guards.
    rules: { ...MEASUREMENT_RULES, jitter: () => rng.next() },
  });
  return move === null ? null : MOVE_VECTORS[move];
}
