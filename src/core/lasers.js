// @ts-check

/**
 * The closing laser arena (`DESIGN-DECISIONS §1 rows 5/6`, `§2.4`). **Sprint 04 builds this**; Sprint 02
 * ships only the inactive stub the round simulation talks to, so that the seam exists and is exercised by
 * every test from today rather than being cut into working code later.
 *
 * The shape it has to grow into is already fixed by `ARCHITECTURE §4`: lasers own an `insetCells` count
 * (0 at the start) and the dead zone is any cell with `x < inset`, `x >= width − inset`, and the same for
 * `y`. The outer wall is simply "inset −1", which is why one query in `collisions.js` answers both wall and
 * laser deaths.
 */

/** @typedef {import('./grid.js').Cell} Cell */

/**
 * @typedef {object} Lasers
 * @property {number} insetCells - how many cells each side has stepped inward; 0 while the lasers are parked
 *   on the wall line
 * @property {(cell: Cell) => boolean} inDeadZone - true for cells the lasers have swept past
 * @property {() => {insetCells: number}} getState - plain, JSON-serialisable snapshot
 */

/**
 * The laser system as it behaves before Sprint 04: parked on the wall line, unlit, deadly to nobody
 * (`§1 row 9` — "lasers start parked exactly on the wall line, unlit"). Every query answers "no laser here",
 * which is the truth for the whole of a Sprint 02 round.
 *
 * @returns {Lasers}
 */
export function createInactive() {
  return {
    insetCells: 0,
    inDeadZone: () => false,
    getState: () => ({ insetCells: 0 }),
  };
}
