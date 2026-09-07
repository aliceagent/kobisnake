import { expect } from 'vitest';

/**
 * The three-part rule both colour rules in this codebase are judged by, in one place (KI-15-01, issue #191).
 *
 * KI-02-01 wrote it for WCAG relative luminance; KI-15-01 needs the identical rule over a different
 * measurement (CIEDE2000 under three vision models), and #152's instruction for this lineage is explicit —
 * "one named constant, one helper, no second implementation". So the rule moved here and both callers pass
 * their own `minimum` and `measure`; nothing about the rule itself is written twice.
 *
 * The rule, unchanged from KI-02-01:
 *  - **(a)** every pair not named in `waivers` clears `minimum` outright;
 *  - **(b)** every waived pair still measures at least what is recorded — a ratchet, so a waiver may improve
 *    and can never quietly worsen;
 *  - **(c)** `waivers` names nothing that is not a pair the table builds, and nothing that would have passed
 *    unwaived, so the waiver list is *exactly* the set of pairs that fail. A waiver is a record of a known
 *    failure, never a way to take a pair out of scrutiny.
 *
 * @template {{ key: string }} Pair
 * @param {Pair[]} pairs
 * @param {Record<string, { measured: number, blockedBy: string }>} waivers
 * @param {object} rule
 * @param {number} rule.minimum - the constant every pair must clear
 * @param {(pair: Pair) => { value: number, detail: string }} rule.measure - the measurement and how to
 *   describe it in a failure message
 * @param {string} rule.name - the constant's name, for failure messages
 */
export function assertContrastRule(pairs, waivers, { minimum, measure, name }) {
  const pairsByKey = new Map(pairs.map((pair) => [pair.key, pair]));

  for (const key of Object.keys(waivers)) {
    expect(pairsByKey.has(key), `waiver "${key}" does not match any pair the table builds`).toBe(
      true,
    );
  }

  for (const pair of pairs) {
    const { key } = pair;
    const { value: separation, detail } = measure(pair);
    const waiver = waivers[key];

    if (waiver) {
      // (c): a waiver on a pair that actually passes would be hiding it from scrutiny rather than recording
      // a known failure, so the waived pair must still genuinely fail unwaived.
      expect(
        separation,
        `${key}: waived but clears ${name} (${detail}) — drop the waiver`,
      ).toBeLessThan(minimum);
      // (b): the ratchet. May improve, must never worsen.
      expect(
        separation,
        `${key}: regressed below its recorded measurement of ${waiver.measured} (${detail}, blocked by ${waiver.blockedBy})`,
      ).toBeGreaterThanOrEqual(waiver.measured);
    } else {
      // (a): every pair not named as a waiver must clear the minimum outright.
      expect(
        separation,
        `${key}: separation ${separation} (${detail}) is below ${name} and is not a recorded waiver`,
      ).toBeGreaterThanOrEqual(minimum);
    }
  }
}
