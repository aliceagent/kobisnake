// @ts-check

/**
 * KI-03-02 — the idle play policy: presses nothing, ever. This is the exact state that produced #119's F1
 * ("a match made of draws can never end"): a no-input round is deterministic and fixed at tick 380 as a
 * `DRAW` on the golden log, so two idle players redraw it forever until `DESIGN-DECISIONS §1 row 26`'s
 * third-consecutive-draw rule ends the match — a rule that is ruled but **not yet implemented** (I01/#120).
 *
 * `tests/agent/policies.spec.js` uses this policy for a bounded characterisation of exactly that defect, not
 * as part of the ten-match run `npm run test:agent` gates on (that run stays on greedy vs survivor, both of
 * which terminate).
 *
 * Trivially self-contained: no free variables to have, nothing captured from module scope. It takes no
 * parameter at all — the whole point of this policy is that it never looks at the snapshot, and the driver
 * calling it with a `PolicyView` argument it simply ignores is ordinary JavaScript, not a type mismatch
 * (`PolicyView => PolicyMove` describes what a policy may use, not what it must accept).
 */

/**
 * @returns {import('../driver.js').PolicyMove}
 */
export function idle() {
  return null;
}
