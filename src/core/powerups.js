// @ts-check

/**
 * Power-up spawning, pickup and effect timers (`DESIGN-DECISIONS §1 rows 3/4/20/21`, `§2.4`). **Sprint 06
 * builds this**; Sprint 02 ships only the inactive stub, so the round simulation has the seam it will need
 * and every test exercises it from today.
 *
 * Sprint 02 rounds always run with power-ups off, whatever `powerUpsEnabled` says, because there is nothing
 * to spawn yet — `RoundSimulation` records the flag so a saved match setting survives, and Sprint 06 turns it
 * into behaviour.
 */

/** @typedef {import('./grid.js').Cell} Cell */

/**
 * @typedef {object} PowerUps
 * @property {boolean} enabled - what the match asked for, whether or not anything acts on it yet
 * @property {{cell: Cell, kind: string}[]} pickups - power-ups currently on the board
 * @property {() => {pickups: {cell: Cell, kind: string}[]}} getState - plain, JSON-serialisable snapshot
 */

/**
 * The power-up system as it behaves before Sprint 06: nothing ever spawns, so no cell is ever occupied by a
 * pickup and no snake ever carries an effect. Speed multipliers stay at 1.
 *
 * @param {boolean} [enabled] - the match's power-up setting, remembered but not yet acted on
 * @returns {PowerUps}
 */
export function createInactive(enabled = false) {
  return {
    enabled,
    pickups: [],
    getState: () => ({ pickups: [] }),
  };
}
