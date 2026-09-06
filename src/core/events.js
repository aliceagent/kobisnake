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
 *   POWERUP_DESPAWNED: 'POWERUP_DESPAWNED',
 *   POWERUP_REMOVED: 'POWERUP_REMOVED',
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

  // Power-ups arrive in Sprint 06 (KS-06-01, `src/core/powerups.js`).
  //
  // KS-06-01 declared deviation: the four power-up/effect events below carry the power-up's own type
  // (`'SPEED' | 'SLOW'`) under `powerUpType`, not the ticket's literal `type`. `round.js`'s `emit` builds
  // every event as `{ type: EventType, tick, t, ...payload }` on one flat object, and `.type` is the
  // EventType discriminant this whole engine (and every existing test) filters events by — a payload field
  // also called `type` would silently overwrite it the instant `emit` spreads the payload in, which is
  // exactly the bug a first pass at this ticket hit. `PowerUps.getState().pickups[i].type` is unaffected:
  // that field is a plain state snapshot, never merged with an event envelope, so it has no such collision
  // and keeps the literal name the tech lead asked for.
  /**
   * A power-up appeared: `{ powerUpType, cell }` (`DESIGN-DECISIONS §2.4`). Fires once for the very first
   * spawn and once for every later spawn/despawn cycle's replacement.
   */
  POWERUP_SPAWNED: 'POWERUP_SPAWNED',
  /**
   * An uncollected power-up's 15-second cycle ended and it was taken off the board to be replaced:
   * `{ powerUpType, cell }`. Despawn-and-replace is one act (`powerups.js` "Ruling 3") — this never fires
   * without a `POWERUP_SPAWNED` immediately after it, in the same tick.
   */
  POWERUP_DESPAWNED: 'POWERUP_DESPAWNED',
  /**
   * A power-up was swept off the board by a laser step passing over its cell before it was collected:
   * `{ cell }`. No type is carried and, unlike `POWERUP_DESPAWNED`, nothing spawns to replace it — spawning
   * has already stopped for the round by the time a laser exists at all (`DESIGN-DECISIONS §2.4`).
   */
  POWERUP_REMOVED: 'POWERUP_REMOVED',
  /** A snake's head entered the one power-up's cell: `{ playerId, powerUpType }`. */
  POWERUP_COLLECTED: 'POWERUP_COLLECTED',
  /**
   * A timed effect began on a snake, or (the solo-SLOW rule, `powerups.js`) its laser-clock equivalent began:
   * `{ playerId, powerUpType }`. Re-collecting the same type while it is already active refreshes the
   * duration silently and does not re-fire this event (KS-06-01 AC7).
   */
  EFFECT_STARTED: 'EFFECT_STARTED',
  /** The effect named in the matching `EFFECT_STARTED` just expired: `{ playerId, powerUpType }`. */
  EFFECT_ENDED: 'EFFECT_ENDED',
});

/** @typedef {'FOOD_SPAWNED' | 'FOOD_EATEN' | 'FOOD_REMOVED' | 'SNAKE_DIED' | 'ROUND_OVER' | 'LASER_WARNING' | 'LASER_STEP' | 'POWERUP_SPAWNED' | 'POWERUP_DESPAWNED' | 'POWERUP_REMOVED' | 'POWERUP_COLLECTED' | 'EFFECT_STARTED' | 'EFFECT_ENDED'} EventType */

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
