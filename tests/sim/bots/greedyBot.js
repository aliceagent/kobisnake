// @ts-check
import { greedy } from '../../../src/game/bots/greedy.js';
import { MEASUREMENT_RULES, MOVE_VECTORS } from '../../../src/game/bots/policy.js';

/**
 * The "heads for the nearest apple" bot of `QA-STRATEGY §4`, now a **thin adapter** over the one greedy
 * policy in `src/game/bots/greedy.js` (KI-12-01).
 *
 * Until this ticket the algorithm lived here in full, and a second, subtly different copy lived in
 * `tests/agent/policies/greedy.js`. Improvement 12 needs the CPU opponent to be the bot the design is
 * measured on, so the algorithm moved to `src/` and both call sites now import it. What is left here is the
 * conversion between the headless harness's live-object `BotView` and the policy's snapshot-shaped
 * `PolicyView`, plus the one thing that genuinely belongs to this call site: the seeded stream.
 *
 * **`MEASUREMENT_RULES` is not a preference, it is a fixture.** `tests/sim/tuningMatrix.test.js` asserts the
 * freshly computed bot matrix against the committed `docs/qa/playtests/gate1-bot-matrix.md` to one decimal
 * place, so this bot's behaviour is pinned by a document. The rules pin the two ways this bot differed from
 * the browser policy — it checks the walls but not the dead zone, and it breaks ties with its stream rather
 * than a bonus for continuing straight — so the matrix reproduces to the number after the move (AC1). See
 * `src/game/bots/policy.js`'s module doc for the full table and the rulings behind it.
 *
 * The stream is supplied here, never by the policy, because it belongs to the harness: `harness.js` derives
 * one per bot from `(seed, index)` precisely so a bot's choices cannot depend on the round's own draws. The
 * CPU player (KI-12-02) passes no stream at all and is a pure function of the snapshot.
 *
 * The snapshot is assembled from live objects rather than copied: `harness.js`'s `BotView` is "a read-only
 * view over the live simulation, not a copy", and copying every segment of every snake on every decision is
 * the allocation cost that harness deliberately avoids. `Snake` already carries `alive`, `segments`,
 * `direction` and `pendingGrowth` under those exact names, and the live `Lasers` already carries `phase` and
 * `inset`, so the shapes line up without a translation step.
 */

/** @typedef {import('../harness.js').Bot} Bot */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */

/**
 * @param {import('../harness.js').BotView} view
 * @returns {Direction | null}
 */
export function greedyBot({ self, others, apples, powerups, grid, rng, lasers }) {
  const move = greedy({
    snapshot: {
      // `playerIndex: 0` below, so `self` goes first; the policy only ever distinguishes itself from
      // everyone else, never one opponent from another.
      snakes: [self, ...others],
      apples,
      powerUps: { pickups: powerups ?? [] },
      lasers,
    },
    playerIndex: 0,
    grid,
    // `rng.next() * 0.5` is the exact tie-break term this bot has always added, drawn once per candidate
    // that clears both safety guards. The scale matters as much as the source: it is what keeps a tie-break
    // from ever outweighing one cell of distance to the target.
    rules: { ...MEASUREMENT_RULES, jitter: () => rng.next() * 0.5 },
  });
  return move === null ? null : MOVE_VECTORS[move];
}
