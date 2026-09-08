// @ts-check

/**
 * Recursive freeze, shared by the two halves of the string catalogue (`strings.js` and `strings.playtest.js`).
 *
 * It has its own module for a bundling reason rather than a tidiness one (#317). `playtestPrompt.js` is a
 * dynamic-import boundary (KI-11-05) while every other screen sits in the static entry graph, so the two
 * halves of the catalogue must not share a module that carries copy: anything reachable from both Rollup
 * roots lands in a shared chunk, and Vite `modulepreload`s that chunk on a plain load. This file *is*
 * reachable from both roots and is expected to end up in exactly such a chunk — which is harmless precisely
 * because it holds no strings. `tests/e2e/playtest-bundle.spec.js` defines a "playtest chunk" as one that
 * *contains* a playtest-only string, and this one never can.
 */

/**
 * Recursively freezes `value` and everything reachable from it (nested plain objects, arrays and — since a
 * `Set` iterates its own values but freezing does not touch what a `Set` holds indirectly — every own property
 * of every object, function included). AC2's "a write throws" needs this to go all the way down: freezing only
 * the top-level `STRINGS` object would still let `STRINGS.menu.title = 'x'` or
 * `STRINGS.howToPlay.lines.push('x')` succeed silently.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(/** @type {any} */ (value)[key]);
    }
  }
  return value;
}
