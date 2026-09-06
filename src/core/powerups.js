// @ts-check

/**
 * Power-up spawning, pickup and effect timers (`DESIGN-DECISIONS §1 rows 3/4/20/21`, `§2.3`, `§2.4`;
 * `ARCHITECTURE §4`). Sprint 02 shipped an inactive stub so `round.js` had the seam it would need; this is
 * Sprint 06 (KS-06-01) filling it in for real.
 *
 * The contract below (`enabled`, `pickups`, `laserRateMultiplier`, `getState()`) is fixed for the sprint:
 * KS-06-02..05 are built in parallel against exactly this shape. Everything else on the returned object
 * (`updateSpawns`, `collectAt`, `applySoloSlow`, `tickSoloSlow`) is `round.js`'s own seam into this module and
 * may change freely.
 *
 * **The solo-SLOW rule** (`applySoloSlow`/`tickSoloSlow`, `laserRateMultiplier`) is unusual and deliberately
 * isolated here: `DESIGN-DECISIONS §1 rows 3/21` say that with no opponent to slow, the laser step interval
 * doubles for the effect's duration instead. In Sprint 06 this path cannot actually be reached by playing — a
 * one-snake round is only legal in practice mode, and practice mode has no round clock at all (`§2.5`), so no
 * solo snake can ever collect a power-up in a real game today. It is built and unit-tested anyway, exactly as
 * the design states it, because Sprint 19 (single player) is what gives it a way in — see the sprint file's
 * own Risks note.
 */

import { EVENTS } from './events.js';
import { placeFoodWithFallback } from './food.js';

/** @typedef {import('./grid.js').Cell} Cell */
/** @typedef {import('./grid.js').GridSize} GridSize */
/** @typedef {import('./rng.js').Rng} Rng */
/** @typedef {import('./settings.js').Settings} Settings */

/**
 * The two power-up types (`DESIGN-DECISIONS §1 rows 3/4/20`), chosen 50/50 by the round's own `rng`.
 *
 * @type {{SPEED: 'SPEED', SLOW: 'SLOW'}}
 */
export const POWERUP_TYPES = Object.freeze({ SPEED: 'SPEED', SLOW: 'SLOW' });

/** @typedef {'SPEED' | 'SLOW'} PowerUpType */

/** @typedef {{cell: Cell, type: PowerUpType}} Pickup */

/**
 * One event `updateSpawns` produced, in `round.js`'s own `{type, payload}` shape — `RoundSimulation.emit`
 * takes exactly these two arguments, so `updateSpawns` hands back something it can spread straight in without
 * this module needing to know about ticks or elapsed seconds at all.
 *
 * @typedef {object} PowerUpEvent
 * @property {'POWERUP_SPAWNED' | 'POWERUP_DESPAWNED'} type
 * @property {Record<string, unknown>} payload
 */

/**
 * What `updateSpawns` needs to place a power-up right now. Mirrors `food.js`'s `PlacementParams`, minus
 * `rng` (this module draws from the one seeded generator it was built with — see {@link createPowerUps} —
 * rather than being handed one fresh on every call) and the dead-zone/region fields power-ups never need (no
 * spawn is ever attempted once the laser phase exists — see `maxCycleCount` below); the one real difference
 * from `food.js`'s own params is `occupied`, which the caller must fill with apple cells as well as snake
 * cells (`food.js`'s own `occupied` set is snake cells only, since an apple has no reason to avoid another
 * apple's replacement, but a power-up must never sit on one — tech-lead ruling on KS-06-01).
 *
 * @typedef {object} PlacementContext
 * @property {GridSize} grid
 * @property {Set<string>} occupied
 * @property {Cell[]} heads
 */

/**
 * @typedef {object} PowerUps
 * @property {boolean} enabled - what the match asked for
 * @property {Pickup[]} pickups - power-ups currently on the board; at most one, ever
 * @property {number} laserRateMultiplier - 1 normally; `1 / laserMultiplierWhenSolo` while the solo-SLOW rule
 *   is running (`round.js`'s laser clock reads this every tick — see its own doc comment)
 * @property {() => {pickups: {cell: Cell, type: PowerUpType}[]}} getState - plain, JSON-serialisable snapshot
 * @property {(timeRemaining: number | null, getPlacement: () => PlacementContext) => PowerUpEvent[]}
 *   updateSpawns - advances the spawn/despawn cycle to `timeRemaining` seconds left and returns everything
 *   that happened. `getPlacement` is a thunk, not a value, so `round.js` only pays for building the occupied-
 *   cell set on the handful of ticks a cycle is actually due on — not on all 10 800 ticks of a round.
 * @property {(cell: Cell) => PowerUpType | null} collectAt - removes and returns the type of the pickup at
 *   `cell`, or `null` when there is none there
 * @property {(playerId: string, durationSeconds: number, laserMultiplierWhenSolo: number, simHz: number) =>
 *   boolean} applySoloSlow - starts (or refreshes) the solo-SLOW laser-clock rule; returns true when it was
 *   not already running
 * @property {() => string | null} tickSoloSlow - advances the solo-SLOW timer by one tick; returns the
 *   `playerId` it was running for when this tick just ended it, otherwise `null`
 */

/**
 * Comparisons against the `§2.4` schedule are made with this slack, for the same reason `lasers.js` uses one:
 * every threshold in the shipping settings is exactly representable, so today this changes nothing, but a
 * settings override in a test should not have a cycle miss its own boundary by a rounding error in the last
 * bit of a float division.
 */
const EPSILON = 1e-9;

/**
 * How many spawn/despawn cycles will ever happen this round: the number of `k = 0, 1, 2, …` for which the
 * cycle's own time-remaining threshold (`firstSpawnAt − k · interval`) is still *strictly after*
 * `laserStartTime` (`DESIGN-DECISIONS §2.4`: "no further power-up spawns" once the warning fires; `§1`'s "at
 * or after" is what makes the boundary itself excluded, matching the shipping timeline's 75/60/45-and-not-30).
 *
 * @param {number} firstSpawnAt
 * @param {number} laserStartTime
 * @param {number} interval
 * @returns {number}
 */
function maxCycleCount(firstSpawnAt, laserStartTime, interval) {
  if (interval <= 0) return firstSpawnAt > laserStartTime + EPSILON ? 1 : 0;
  return Math.max(0, Math.ceil((firstSpawnAt - laserStartTime) / interval - EPSILON));
}

/**
 * How many cycles should have already happened by `timeRemaining` seconds left, capped at `maxCycles`.
 * Modelled directly on `lasers.js`'s `stepsDueAt`: derived fresh from the clock on every call rather than
 * counted, so a single coarse `advance` that crosses several 15-second boundaries at once still produces
 * every cycle it passed, in order, instead of losing one.
 *
 * @param {number} timeRemaining
 * @param {number} firstSpawnAt
 * @param {number} interval
 * @param {number} maxCycles
 * @returns {number}
 */
function cyclesDueAt(timeRemaining, firstSpawnAt, interval, maxCycles) {
  if (timeRemaining > firstSpawnAt + EPSILON) return 0;
  const sinceFirst = firstSpawnAt - timeRemaining + EPSILON;
  return Math.min(maxCycles, Math.floor(sinceFirst / interval) + 1);
}

/**
 * Builds the power-up system for one round.
 *
 * @param {object} options
 * @param {Settings} options.settings
 * @param {boolean} options.enabled - the match's power-up setting; `false` means nothing ever spawns and no
 *   random number is ever drawn for a power-up (determinism: a round with power-ups off must not perturb the
 *   `rng` stream at all relative to one that never called into this module)
 * @param {Rng} options.rng - the round's own seeded generator. Every draw a power-up makes — the 50/50 type,
 *   the cell among equally-legal candidates — goes through this one stream (`CLAUDE.md`, `DESIGN-DECISIONS
 *   §4` "Determinism").
 * @returns {PowerUps}
 */
export function createPowerUps({ settings, enabled, rng }) {
  const { powerUpFirstSpawnAt, powerUpInterval, laserStartTime, powerUpMinDistanceFromHead } = settings;
  const maxCycles = maxCycleCount(powerUpFirstSpawnAt, laserStartTime, powerUpInterval);

  /** How many of the (at most `maxCycles`) spawn/despawn cycles have already been processed. */
  let cyclesProcessed = 0;

  /**
   * The solo-SLOW laser-clock rule's own timer (see the module doc comment above). `null` while not running.
   * @type {{playerId: string, remainingTicks: number} | null}
   */
  let soloSlow = null;

  /** @type {PowerUps} */
  const powerUps = {
    enabled: Boolean(enabled),
    pickups: [],
    laserRateMultiplier: 1,

    getState() {
      return {
        pickups: powerUps.pickups.map((pickup) => ({ cell: { ...pickup.cell }, type: pickup.type })),
      };
    },

    updateSpawns(timeRemaining, getPlacement) {
      /** @type {PowerUpEvent[]} */
      const events = [];
      // `enabled: false` and practice mode (`timeRemaining === null`, `DESIGN-DECISIONS §2.5`) both mean
      // "nothing ever spawns" and, just as importantly, "no rng draw ever happens for a power-up" — checked
      // before anything below touches `rng`, `cyclesProcessed` or `getPlacement`.
      if (!powerUps.enabled || timeRemaining === null) return events;

      const due = cyclesDueAt(timeRemaining, powerUpFirstSpawnAt, powerUpInterval, maxCycles);
      if (cyclesProcessed >= due) return events;

      // Board state — snake and apple cells — cannot change mid-tick, so one `getPlacement()` call serves
      // every cycle this call processes (in practice always at most one; the loop below only runs more than
      // once if a settings override makes `powerUpInterval` shorter than a single tick).
      const placement = getPlacement();
      while (cyclesProcessed < due) {
        cyclesProcessed += 1;

        // `food.js`'s own relaxation rule (`DESIGN-DECISIONS §2.3` "When nothing fits", 3 → 2 → 1 → 0), reused
        // rather than reimplemented: a successful placement draws exactly one `rng` call, a failed one draws
        // none, which is what lets a fully skipped cycle (see below) leave the rng stream untouched.
        const cell = placeFoodWithFallback({
          grid: placement.grid,
          occupied: placement.occupied,
          heads: placement.heads,
          rng,
          minDistance: powerUpMinDistanceFromHead,
        });
        // Tech-lead Ruling 3 (KS-06-01): a cycle whose placement fails changes nothing at all. An uncollected
        // pickup already on the board keeps sitting there — despawn-and-replace is one act, and skipping the
        // cycle skips both halves, never just the despawn.
        if (cell === null) continue;

        const type = /** @type {PowerUpType} */ (rng.pick([POWERUP_TYPES.SPEED, POWERUP_TYPES.SLOW]));
        if (powerUps.pickups.length > 0) {
          const old = powerUps.pickups[0];
          // `powerUpType`, not `type` — see `round.js`'s `resolvePowerUpPickup` doc comment: `emit`
          // flattens `{type: EventType, ...}` onto one object, so a payload key literally called `type`
          // would silently overwrite the event's own discriminant the moment it is spread in.
          events.push({
            type: EVENTS.POWERUP_DESPAWNED,
            payload: { powerUpType: old.type, cell: { ...old.cell } },
          });
        }
        powerUps.pickups = [{ cell, type }];
        events.push({ type: EVENTS.POWERUP_SPAWNED, payload: { powerUpType: type, cell: { ...cell } } });
      }
      return events;
    },

    collectAt(cell) {
      const index = powerUps.pickups.findIndex(
        (pickup) => pickup.cell.x === cell.x && pickup.cell.y === cell.y,
      );
      if (index === -1) return null;
      const [pickup] = powerUps.pickups.splice(index, 1);
      return pickup.type;
    },

    applySoloSlow(playerId, durationSeconds, laserMultiplierWhenSolo, simHz) {
      const isNew = soloSlow === null;
      // The `+1` mirrors `Snake.applyEffect`'s own offset: `round.js` decrements every active timer once at
      // the end of *every* tick, including the one an effect starts on, so the extra tick offsets that
      // immediate decrement and the rule ends up running for exactly `durationSeconds` of ticks, not one
      // short (see `RoundSimulation.tickPowerUpEffects`).
      soloSlow = { playerId, remainingTicks: Math.round(durationSeconds * simHz) + 1 };
      powerUps.laserRateMultiplier = 1 / laserMultiplierWhenSolo;
      return isNew;
    },

    tickSoloSlow() {
      if (soloSlow === null) return null;
      soloSlow.remainingTicks -= 1;
      if (soloSlow.remainingTicks > 0) return null;
      const { playerId } = soloSlow;
      soloSlow = null;
      powerUps.laserRateMultiplier = 1;
      return playerId;
    },
  };

  return powerUps;
}
