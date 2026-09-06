// @ts-check
import { EVENTS } from './events.js';
import { inBounds } from './grid.js';

/**
 * The closing laser arena (`DESIGN-DECISIONS §1 rows 5/6/9/23`, `§2.4`; `ARCHITECTURE §4`).
 *
 * Four beams park on the wall line, ignite at `laserStartTime`, and then step one cell inward per side every
 * `laserStepInterval` until the safe square reaches `laserMinArena`. Every number below comes from
 * `SETTINGS`; nothing here chooses one.
 *
 * The dead zone is the whole of the board outside the safe square `[inset, width − inset)` — and, crucially,
 * so is everything off the board. That is `ARCHITECTURE §4`'s "walls are simply inset −1, so the same query
 * answers wall and laser deaths": at `inset = 0` {@link Lasers.isDeadly} is *exactly* "out of bounds", which
 * is the outer wall being deadly from second 0 (`§1 row 9`), and every step after that moves the same edge
 * inward without changing what the query means. The caller tells the two apart by where the cell is, not by
 * asking a second question — see `round.js`'s `deadlyCause`.
 *
 * **Time runs backwards here.** Every threshold in `§2.4` is written in *seconds remaining*, so `update`
 * takes `timeRemaining` and the comparisons are `≤`, not `≥`. The schedule is recomputed from that number on
 * every call rather than counted down: `update` is driven by `RoundSimulation`'s integer tick clock, and
 * deriving "how many steps should have happened by now" from the clock means a coarse `advance(dt)` that
 * crosses two step boundaries at once emits both, in order, instead of losing one.
 */

/** @typedef {import('./grid.js').Cell} Cell */
/** @typedef {import('./grid.js').GridSize} GridSize */
/** @typedef {import('./settings.js').Settings} Settings */

/**
 * The four states of the laser system (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-01).
 * `WARNING` and `CLOSING` are laser states, not `RoundSimulation` phases — the simulation keeps running
 * through both (`src/core/events.js` `PHASES`, `ARCHITECTURE §6`).
 *
 * @type {{PARKED: 'PARKED', WARNING: 'WARNING', CLOSING: 'CLOSING', STOPPED: 'STOPPED'}}
 */
export const LASER_PHASES = Object.freeze({
  /** Before `laserStartTime`: beams sit unlit on the wall line and change nothing. */
  PARKED: 'PARKED',
  /** Beams lit at inset 0 for `laserWarningDuration` seconds. Deadly, but only where the wall already was. */
  WARNING: 'WARNING',
  /** Stepping inward, one cell per side every `laserStepInterval`. */
  CLOSING: 'CLOSING',
  /** The safe square has reached `laserMinArena`; no further step will ever be emitted. */
  STOPPED: 'STOPPED',
});

/** @typedef {'PARKED' | 'WARNING' | 'CLOSING' | 'STOPPED'} LaserPhase */

/** @typedef {{type: 'LASER_WARNING'} | {type: 'LASER_STEP', inset: number}} LaserEvent */

/**
 * The rectangle of cells the lasers have *not* swept, in inclusive cell coordinates.
 *
 * @typedef {{minX: number, minY: number, maxX: number, maxY: number}} SafeRegion
 */

/**
 * @typedef {object} Lasers
 * @property {LaserPhase} phase - see {@link LASER_PHASES}
 * @property {number} inset - how many cells each side has stepped inward; 0 while parked on the wall line
 * @property {number} insetCells - `ARCHITECTURE §4`'s name for {@link Lasers.inset}; the same number
 * @property {(timeRemaining: number | null) => LaserEvent[]} update - advances the schedule to
 *   `timeRemaining` seconds left and returns everything that became due, in order
 * @property {(cell: Cell) => boolean} isDeadly - true for any cell outside the safe square, on or off the board
 * @property {(cell: Cell) => boolean} inDeadZone - true for cells *on the board* the lasers have swept past
 * @property {() => SafeRegion} safeRegion - the cells still inside the safe square
 * @property {() => {phase: LaserPhase, inset: number, insetCells: number}} getState - plain, JSON-serialisable
 *   snapshot
 */

/**
 * Comparisons against the `§2.4` thresholds are made with this slack.
 *
 * Every threshold and every tick boundary in the shipping settings is a dyadic rational — 90 − tick/120 is
 * exact for the ticks that matter, and 25, 22.5, … 5 are all exactly representable — so today this changes
 * nothing. It is here for the settings overrides tests use: a `simHz` or a `laserStepInterval` that is not a
 * power-of-two fraction would otherwise let a step land one tick late purely from a rounding error in the
 * last bit. One 120 Hz tick is 8.3 ms, seven orders of magnitude above this, so no real boundary can be
 * crossed by the slack itself.
 */
const EPSILON = 1e-9;

/**
 * How many steps the lasers will ever take: the smallest `n` with `width − 2n ≤ laserMinArena`
 * (KS-04-01: "Stop when `grid.width − 2·inset ≤ laserMinArena`"). For the shipping 24-cell arena and a 6-cell
 * minimum that is 9, leaving exactly 6 × 6.
 *
 * `grid.width` is what the ticket names, and the arena is square (`§2.1`); a non-square override would shrink
 * on the width's schedule, which is why {@link createLasers}'s dead-zone test uses each axis's own extent
 * rather than assuming they match.
 *
 * @param {number} width
 * @param {number} minArena
 * @returns {number}
 */
function maxStepCount(width, minArena) {
  return Math.max(0, Math.ceil((width - minArena) / 2));
}

/**
 * Builds the laser system for one round.
 *
 * @param {Settings} settings
 * @returns {Lasers}
 */
export function createLasers(settings) {
  const { grid, laserStartTime, laserWarningDuration, laserStepInterval, laserMinArena } = settings;
  const maxSteps = maxStepCount(grid.width, laserMinArena);
  /** Seconds remaining when the first step lands (`§2.4`: 0:25 for the shipping numbers). */
  const firstStepAt = laserStartTime - laserWarningDuration;

  /** Whether `LASER_WARNING` has already been emitted; it fires exactly once per round. */
  let warned = false;

  /**
   * How many steps should have happened by `timeRemaining`. Derived from the clock rather than counted, so
   * a single coarse `advance` that crosses several boundaries still produces every step it passed.
   *
   * @param {number} timeRemaining
   * @returns {number}
   */
  function stepsDueAt(timeRemaining) {
    if (timeRemaining > firstStepAt + EPSILON) return 0;
    const sinceFirst = firstStepAt - timeRemaining + EPSILON;
    return Math.min(maxSteps, Math.floor(sinceFirst / laserStepInterval) + 1);
  }

  /** @type {Lasers} */
  const lasers = {
    phase: LASER_PHASES.PARKED,
    inset: 0,

    get insetCells() {
      return lasers.inset;
    },

    update(timeRemaining) {
      /** @type {LaserEvent[]} */
      const events = [];
      // Practice mode has no round clock (`DESIGN-DECISIONS §5`), so it has no laser schedule either: the
      // beams stay parked for as long as the player wants to practise.
      if (timeRemaining === null) return events;

      if (!warned && timeRemaining <= laserStartTime + EPSILON) {
        warned = true;
        events.push({ type: EVENTS.LASER_WARNING });
      }
      const due = stepsDueAt(timeRemaining);
      while (lasers.inset < due) {
        lasers.inset += 1;
        events.push({ type: EVENTS.LASER_STEP, inset: lasers.inset });
      }

      // Recomputed from scratch every call rather than assigned at each transition, so there is exactly one
      // description of what a phase means and no path through the schedule can leave a stale one behind.
      if (!warned) {
        lasers.phase = LASER_PHASES.PARKED;
      } else if (lasers.inset >= maxSteps) {
        lasers.phase = LASER_PHASES.STOPPED;
      } else if (lasers.inset === 0) {
        lasers.phase = LASER_PHASES.WARNING;
      } else {
        lasers.phase = LASER_PHASES.CLOSING;
      }
      return events;
    },

    isDeadly(cell) {
      const { inset } = lasers;
      return (
        cell.x < inset ||
        cell.x >= grid.width - inset ||
        cell.y < inset ||
        cell.y >= grid.height - inset
      );
    },

    inDeadZone(cell) {
      return lasers.isDeadly(cell) && inBounds(cell, grid);
    },

    safeRegion() {
      const { inset } = lasers;
      return {
        minX: inset,
        minY: inset,
        maxX: grid.width - inset - 1,
        maxY: grid.height - inset - 1,
      };
    },

    getState() {
      return { phase: lasers.phase, inset: lasers.inset, insetCells: lasers.inset };
    },
  };

  return lasers;
}
