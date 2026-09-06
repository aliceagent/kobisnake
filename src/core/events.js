// @ts-check

/**
 * The names of everything the simulation announces, and the vocabulary of a round's outcome
 * (`ARCHITECTURE §4`). Render, audio and UI react to these events; they never poll the simulation's internal
 * fields, they only read `getState()`.
 *
 * Every event is a plain object `{ type, tick, t, ... }` where `tick` is the simulation tick it happened on
 * and `t` is that tick in simulated seconds since the round began. Both are recorded because they answer
 * different questions: `tick` is the exact integer two runs are compared on, `t` is what a human reads in a
 * golden log or a bug report.
 *
 * Constants for events Sprint 02 does not emit yet are defined here anyway. The alternative is that Sprint 04
 * and Sprint 06 each invent their own string for the same thing, and a typo in one of them fails silently.
 */

/**
 * @type {{
 *   FOOD_SPAWNED: 'FOOD_SPAWNED',
 *   FOOD_EATEN: 'FOOD_EATEN',
 *   FOOD_REMOVED: 'FOOD_REMOVED',
 *   SNAKE_DIED: 'SNAKE_DIED',
 *   ROUND_OVER: 'ROUND_OVER',
 *   LASER_WARNING: 'LASER_WARNING',
 *   LASER_STEP: 'LASER_STEP',
 *   POWERUP_SPAWNED: 'POWERUP_SPAWNED',
 *   POWERUP_COLLECTED: 'POWERUP_COLLECTED',
 *   EFFECT_STARTED: 'EFFECT_STARTED',
 *   EFFECT_ENDED: 'EFFECT_ENDED',
 * }}
 */
export const EVENTS = Object.freeze({
  /** An apple appeared. `{ index, cell }`. Emitted once per apple at round start and once per respawn. */
  FOOD_SPAWNED: 'FOOD_SPAWNED',
  /** A snake's head entered an apple's cell. `{ snakeId, index, cell }`. */
  FOOD_EATEN: 'FOOD_EATEN',
  /**
   * An apple was taken off the board without being eaten: `{ index, cell }`. The only thing that does this is
   * a laser step sweeping over its cell (`DESIGN-DECISIONS §2.4`: "Anything in it is removed the moment a
   * laser passes over it"), which is why the payload names no snake. A `FOOD_SPAWNED` for the same slot
   * normally follows in the same tick — unless the shrunken arena has nowhere legal to put it, in which case
   * the slot stays empty and is retried (`§2.3`, issue #39).
   */
  FOOD_REMOVED: 'FOOD_REMOVED',
  /** `{ snakeId, cause, cell }` where `cause` is a `collisions.js` `CAUSES` value. */
  SNAKE_DIED: 'SNAKE_DIED',
  /** `{ result, reason, lengths, winnerId }`. Always the last event of a round. */
  ROUND_OVER: 'ROUND_OVER',

  /** The beams ignite on the wall line at `laserStartTime`, once per round. No payload. */
  LASER_WARNING: 'LASER_WARNING',
  /** Each side stepped one cell inward: `{ inset }`, the new inset (`DESIGN-DECISIONS §2.4`). */
  LASER_STEP: 'LASER_STEP',

  // Not emitted before Sprint 06, which is where power-ups arrive.
  POWERUP_SPAWNED: 'POWERUP_SPAWNED',
  POWERUP_COLLECTED: 'POWERUP_COLLECTED',
  EFFECT_STARTED: 'EFFECT_STARTED',
  EFFECT_ENDED: 'EFFECT_ENDED',
});

/** @typedef {'FOOD_SPAWNED' | 'FOOD_EATEN' | 'FOOD_REMOVED' | 'SNAKE_DIED' | 'ROUND_OVER' | 'LASER_WARNING' | 'LASER_STEP' | 'POWERUP_SPAWNED' | 'POWERUP_COLLECTED' | 'EFFECT_STARTED' | 'EFFECT_ENDED'} EventType */

/**
 * How a round ended (`DESIGN-DECISIONS §2.5`). A draw never counts towards a match; the match simply replays
 * the round.
 *
 * @type {{P1_WIN: 'P1_WIN', P2_WIN: 'P2_WIN', DRAW: 'DRAW'}}
 */
export const RESULTS = Object.freeze({
  P1_WIN: 'P1_WIN',
  P2_WIN: 'P2_WIN',
  DRAW: 'DRAW',
});

/** @typedef {'P1_WIN' | 'P2_WIN' | 'DRAW'} RoundResult */

/**
 * Why the round stopped: somebody crashed, or the clock ran out (`DESIGN-DECISIONS §2.4`).
 *
 * @type {{DEATH: 'DEATH', TIMEOUT: 'TIMEOUT'}}
 */
export const END_REASONS = Object.freeze({
  DEATH: 'DEATH',
  TIMEOUT: 'TIMEOUT',
});

/** @typedef {'DEATH' | 'TIMEOUT'} EndReason */

/**
 * The phases a `RoundSimulation` itself passes through. This is deliberately *not* the game state machine of
 * `ARCHITECTURE §6` — the countdown, pause and scoreboard are Sprint 05's, and a round simulation that knew
 * about them could not be driven straight from a unit test. `LASER_WARNING` is likewise a UI sub-state of
 * PLAYING (§6), not a phase here: the simulation keeps running through it.
 *
 * @type {{PLAYING: 'PLAYING', ROUND_OVER: 'ROUND_OVER'}}
 */
export const PHASES = Object.freeze({
  PLAYING: 'PLAYING',
  ROUND_OVER: 'ROUND_OVER',
});

/** @typedef {'PLAYING' | 'ROUND_OVER'} Phase */
