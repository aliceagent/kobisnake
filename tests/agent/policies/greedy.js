// @ts-check

/**
 * The greedy play policy, re-exported from `src/game/bots/greedy.js` (KI-12-01).
 *
 * KI-03-02 wrote this policy here, as a browser-side port of `tests/sim/bots/greedyBot.js`. Improvement 12
 * needs the CPU opponent to be the same code the statistics are measured on, so the policy moved into `src/`
 * and this file became the re-export that keeps `playtest.spec.js`, `policies.spec.js` and
 * `policies.test.js` importing the path they always have.
 *
 * **Behaviour is unchanged.** The driver builds a `PolicyView` with no `rules` field, and a policy with no
 * rules falls back to `PLAY_RULES` — which *is* the KI-03-02 behaviour (dead-zone aware, a 0.5 straight
 * bonus for tie-breaking, no randomness). `tests/sim` is the side that opts in to the older measurement
 * rules, not this one. See `src/game/bots/policy.js`'s module doc.
 *
 * **The `Function.prototype.toString()` constraint survives the move**: the function this re-exports is a
 * single self-contained function with every helper nested inside it and no module-level references, so the
 * driver can still ship it into the page as source text. `policies.spec.js` proves that by actually running
 * it through the driver, which is the only place a `toString()` round-trip can be proved.
 */

export { greedy } from '../../../src/game/bots/greedy.js';
