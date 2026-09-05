// @ts-check

/**
 * Deterministic randomness for the whole simulation (DESIGN-DECISIONS §4 "Determinism"; ARCHITECTURE §4). All
 * randomness — food placement, power-up placement, bot decisions in `tests/sim` — must go through an `Rng`
 * built here so that a seed plus an input log always replays to the same event log (CLAUDE.md "Determinism").
 *
 * Algorithm: mulberry32, a small, fast, well-distributed 32-bit PRNG. It is not cryptographically secure and
 * does not need to be; it only needs to be fast, seedable and reproducible across platforms, which it is
 * (pure 32-bit integer arithmetic, no `Math.random`).
 */

/**
 * @typedef {object} Rng
 * @property {() => number} next - next float in [0, 1)
 * @property {(maxExclusive: number) => number} int - next integer in [0, maxExclusive), one `next()` call
 * @property {<T>(array: T[]) => T} pick - a uniformly random element of `array`, one `next()` call
 * @property {number} seed - the seed this generator was created with
 */

/**
 * Builds the mulberry32 step function for a given 32-bit state. Each call advances `state` by reference
 * (closed over) and returns the next float in [0, 1).
 *
 * @param {number} seed
 * @returns {() => number}
 */
function createMulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a seeded deterministic random number generator.
 *
 * @param {number} seed - any finite number; only its lower 32 bits are used
 * @returns {Rng}
 */
export function createRng(seed) {
  const next = createMulberry32(seed);

  /**
   * @param {number} maxExclusive - must be a positive integer
   * @returns {number}
   */
  function int(maxExclusive) {
    return Math.floor(next() * maxExclusive);
  }

  /**
   * Picks a uniformly random element of `array`. `array` must not be empty — this is a caller error, and
   * throwing here (rather than e.g. returning `undefined`) surfaces the mistake immediately instead of
   * letting `undefined` leak into the simulation.
   *
   * @template T
   * @param {T[]} array
   * @returns {T}
   */
  function pick(array) {
    if (array.length === 0) {
      throw new Error('Rng.pick: array must not be empty');
    }
    return array[int(array.length)];
  }

  return { next, int, pick, seed };
}
