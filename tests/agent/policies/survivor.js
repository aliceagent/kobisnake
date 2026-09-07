// @ts-check

/**
 * The survivor play policy, re-exported from `src/game/bots/survivor.js` (KI-12-01). See `greedy.js` in this
 * directory for why these two files are now re-exports and why the behaviour is unchanged: the driver passes
 * no `rules`, and the default rules are exactly the ones KI-03-02 wrote here — contested cells excluded
 * outright (ruling 5 on #122), laser-aware, no randomness.
 */

export { survivor } from '../../../src/game/bots/survivor.js';
