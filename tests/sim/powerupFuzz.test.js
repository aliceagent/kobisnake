// @ts-check
import { describe, expect, it } from 'vitest';
import { EVENTS, PHASES } from '../../src/core/events.js';
import { DIRECTIONS, addDir, isOpposite } from '../../src/core/grid.js';
import { POWERUP_TYPES } from '../../src/core/powerups.js';
import { createRng } from '../../src/core/rng.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * Adversarial fuzz over the seam KS-06-01 introduced: a power-up's spawn cycle, its collection, and the
 * timed effects it starts all run on the same tick clock as the food, the snakes and the closing lasers, and
 * the order in which they are applied decides whether the board is ever — even for one tick — in a state
 * `DESIGN-DECISIONS §2.3`/`§2.4` says cannot exist (`docs/sprints/sprint-06-power-ups.md` KS-06-05).
 *
 * Modelled on `laserFuzz.test.js` (KS-04-05) and for the same three reasons.
 *
 * 1. **Every invariant is checked after every simulation tick**, not once at the end. A snapshot taken when
 *    the round is over cannot see two power-ups that shared the board for one tick, or a `speedMultiplier`
 *    that passed through 2.25 on its way back to 1.5. Those are exactly the bugs a stacking or ordering
 *    mistake produces and they are invisible to an end-state assertion.
 * 2. **The rounds have to actually collect power-ups.** Pure random play crashes inside four seconds and
 *    would exercise nothing this ticket is about, and even a careful snake that ignores pedestals never
 *    starts an effect. The driver below therefore *hunts* the power-up whenever one is on the board, and the
 *    test asserts at the end that most seeds really did collect one and really did watch an effect expire —
 *    a coverage assertion on the fuzz itself, which fails the day the driver stops producing rounds that
 *    reach the interesting part and this suite quietly stops testing anything.
 * 3. **Everything is seeded**, so a failure is reproducible from its seed alone and can be minimised into a
 *    replay fixture (`tests/sim/replays/README.md`) rather than being a story about a run that once went red.
 *
 * The driver is deliberately local to this file rather than `tests/sim/bots/`. The bots there are design
 * instruments — KS-06-04 is teaching `greedyBot` about power-ups in this very sprint — and an adversary that
 * shared them would change what it covers whenever somebody tunes a bot.
 *
 * `expect` is called once, at the end, on a collected list: it is a Chai assertion behind a proxy and costs
 * roughly a microsecond, which at millions of ticks is minutes of wall clock on its own. The hot loop uses
 * plain conditions and records violations instead, and every message names the seed and the tick, so a red
 * run is still a reproduction recipe.
 */

/** @typedef {import('../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../src/core/snake.js').Snake} Snake */

const SEEDS = 2000;
const CARDINALS = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];
const TICKS_PER_STEP = Math.round(SETTINGS.simHz / SETTINGS.snakeSpeed);

/**
 * Every value `speedMultiplier` is allowed to hold (the ticket's own list): 1 with nothing running, 1.5
 * boosted, 0.6 slowed, and 0.9 for a snake that is boosted *and* slowed at the same time — which is a real
 * state, because SLOW hits every snake except the collector and a boosted snake can be that victim.
 *
 * Compared with a tolerance rather than by identity: 1.5 × 0.6 is 0.8999999999999999 in binary floating
 * point, and a fuzz that failed on that would be testing IEEE 754 rather than the design.
 */
const LEGAL_MULTIPLIERS = [1, 1.5, 0.6, 0.9];
const MULTIPLIER_TOLERANCE = 1e-9;

/** Effect durations in whole ticks, which is what the timers actually count (`snake.js`). */
const EFFECT_TICKS = {
  [POWERUP_TYPES.SPEED]: Math.round(SETTINGS.speedBoost.duration * SETTINGS.simHz),
  [POWERUP_TYPES.SLOW]: Math.round(SETTINGS.slow.duration * SETTINGS.simHz),
};

/** @param {number} value */
function isLegalMultiplier(value) {
  return LEGAL_MULTIPLIERS.some((legal) => Math.abs(value - legal) < MULTIPLIER_TOLERANCE);
}

/**
 * How often this seed's snakes throw a random turn instead of playing safe: 0 %, 5 %, 10 % or 15 %, decided
 * by the seed so every run covers both ends of the mix. At 0 % the round is two careful hunters and reliably
 * reaches the laser phase with effects running, which is where an effect that outlives the warning
 * (`§2.4`) gets tested. At 15 % it is chaos that dies earlier, which is where a snake dying *while* boosted
 * — and the effect bookkeeping that has to survive it — gets hit hardest.
 *
 * @param {number} seed
 * @returns {number}
 */
function chaosRate(seed) {
  return (seed % 4) * 0.05;
}

/**
 * Whether this seed's snakes hunt the power-up in preference to apples. Two thirds of seeds do, which is what
 * makes collections common enough to fuzz the effects; the other third ignores pedestals entirely and so
 * spends its whole round on the *uncollected* path — the 15-second despawn/replace cycle, and the laser
 * sweeping a pedestal off the board (`POWERUP_REMOVED`), which a round that grabs every power-up on sight
 * would never reach.
 *
 * @param {number} seed
 * @returns {boolean}
 */
function huntsPowerUps(seed) {
  return seed % 3 !== 0;
}

/**
 * A cautious move that steers towards a target when one is given: any direction that is not an immediate
 * death, preferring the one that closes on the target and leaves the most free neighbours. Laser-aware,
 * because a driver that walks into the dead zone on purpose never survives to the interesting part.
 *
 * @param {RoundSimulation} sim
 * @param {Snake} self
 * @param {import('../../src/core/rng.js').Rng} rng
 * @param {Cell | null} target
 * @returns {Direction | null}
 */
function moveToward(sim, self, rng, target) {
  /** @param {Cell} cell */
  const safe = (cell) => {
    if (sim.lasers.isDeadly(cell)) return false;
    for (const snake of sim.snakes) {
      if (!snake.alive) continue;
      // The tail cell is about to move out from under the head, unless this snake is growing into it.
      const solid =
        snake === self && self.pendingGrowth === 0
          ? self.segments.length - 1
          : snake.segments.length;
      for (let i = 0; i < solid; i += 1) {
        if (snake.segments[i].x === cell.x && snake.segments[i].y === cell.y) return false;
      }
    }
    return true;
  };

  /** @type {Direction | null} */
  let best = null;
  let bestScore = -Infinity;
  for (const direction of CARDINALS) {
    if (isOpposite(direction, self.direction)) continue;
    const next = addDir(self.head, direction);
    if (!safe(next)) continue;
    let free = 0;
    for (const onward of CARDINALS) {
      if (safe(addDir(next, onward))) free += 1;
    }
    const closer =
      target === null
        ? 0
        : -(Math.abs(next.x - target.x) + Math.abs(next.y - target.y));
    const score = free * 10 + closer * 4 + (direction === self.direction ? 3 : 0) + rng.next();
    if (score > bestScore) {
      bestScore = score;
      best = direction;
    }
  }
  return best;
}

/**
 * What a snake should head for this step: the power-up when this seed hunts and one is on the board,
 * otherwise the nearest apple, otherwise nowhere in particular.
 *
 * @param {RoundSimulation} sim
 * @param {Snake} self
 * @param {boolean} hunt
 * @returns {Cell | null}
 */
function targetFor(sim, self, hunt) {
  if (hunt && sim.powerUps.pickups.length > 0) return sim.powerUps.pickups[0].cell;
  let nearest = null;
  let bestDistance = Infinity;
  for (const apple of sim.food.present()) {
    const distance = Math.abs(apple.x - self.head.x) + Math.abs(apple.y - self.head.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = apple;
    }
  }
  return nearest;
}

/**
 * One seeded round, driven to its end, with every invariant checked after every tick.
 *
 * @param {number} seed
 * @param {string[]} violations - appended to in place; each entry names the seed and tick
 * @returns {{spawns: number, collections: number, effectsEnded: number, removals: number,
 *   despawns: number, reachedWarning: boolean}}
 */
function fuzzRound(seed, violations) {
  const sim = new RoundSimulation({
    settings: SETTINGS,
    seed,
    players: [{ id: 'p1' }, { id: 'p2' }],
    powerUpsEnabled: true,
  });
  const rng = createRng((seed ^ 0x85ebca6b) >>> 0);
  const rate = chaosRate(seed);
  const hunt = huntsPowerUps(seed);
  const dt = 1 / SETTINGS.simHz;

  let spawns = 0;
  let collections = 0;
  let effectsEnded = 0;
  let removals = 0;
  let despawns = 0;
  let warned = false;

  /**
   * The tick each running effect started on, keyed `playerId:type`, so an `EFFECT_ENDED` can be checked
   * against the exact tick the design says it must land on rather than merely "some time later".
   * @type {Map<string, number>}
   */
  const startedAt = new Map();

  /** @param {string} what */
  const fail = (what) => violations.push(`seed ${seed}, tick ${sim.tick}: ${what}`);

  while (sim.phase === PHASES.PLAYING) {
    if (sim.tick % TICKS_PER_STEP === 0) {
      for (const snake of sim.snakes) {
        if (!snake.alive) continue;
        const direction =
          rng.next() < rate
            ? CARDINALS[rng.int(CARDINALS.length)]
            : moveToward(sim, snake, rng, targetFor(sim, snake, hunt));
        if (direction !== null) sim.applyInput(snake.id, direction);
      }
    }

    const events = sim.advance(dt);

    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];

      if (event.type === EVENTS.LASER_WARNING) warned = true;

      // 4. No `POWERUP_SPAWNED` once the warning has fired (`§2.4`: "no further power-up spawns"). Checked
      //    against the warning actually having been announced, not against the clock, so it holds however
      //    the schedule is derived.
      if (event.type === EVENTS.POWERUP_SPAWNED) {
        spawns += 1;
        if (warned) fail('POWERUP_SPAWNED after LASER_WARNING');
        // A despawn is only ever half of a replace (`§2.4`, tech-lead Ruling 3): every `POWERUP_DESPAWNED`
        // is immediately followed by the `POWERUP_SPAWNED` that replaced it, in the same tick.
        const previous = events[i - 1];
        if (previous !== undefined && previous.type === EVENTS.POWERUP_DESPAWNED) despawns += 1;
      }
      if (event.type === EVENTS.POWERUP_DESPAWNED) {
        const next = events[i + 1];
        if (next === undefined || next.type !== EVENTS.POWERUP_SPAWNED) {
          fail('POWERUP_DESPAWNED with no POWERUP_SPAWNED replacing it in the same tick');
        }
      }

      // 6. A power-up is only ever *removed* by a beam closing over it, never for any other reason.
      if (event.type === EVENTS.POWERUP_REMOVED) {
        removals += 1;
        if (!sim.lasers.inDeadZone(/** @type {Cell} */ (event.cell))) {
          fail('POWERUP_REMOVED for a cell that is not in the dead zone');
        }
      }

      if (event.type === EVENTS.POWERUP_COLLECTED) collections += 1;

      // 5. Effect timers reach exactly 0: an `EFFECT_STARTED` at tick T is matched by an `EFFECT_ENDED` at
      //    exactly T + duration × simHz, never a tick early or late. A refresh (`AC7`) re-stamps the start,
      //    which is the whole of "refresh, not stack" seen from the event log.
      if (event.type === EVENTS.EFFECT_STARTED) {
        startedAt.set(`${event.playerId}:${event.powerUpType}`, /** @type {number} */ (event.tick));
      }
      if (event.type === EVENTS.EFFECT_ENDED) {
        effectsEnded += 1;
        const key = `${event.playerId}:${event.powerUpType}`;
        const started = startedAt.get(key);
        if (started === undefined) {
          fail(`EFFECT_ENDED for ${key} that never started`);
        } else {
          const expected = started + EFFECT_TICKS[/** @type {string} */ (event.powerUpType)];
          if (event.tick !== expected) {
            fail(`EFFECT_ENDED for ${key} at tick ${event.tick}, expected ${expected}`);
          }
          startedAt.delete(key);
        }
      }
    }

    // 1. At most one power-up on the board, ever (`§2.4`: the cycle replaces, it never accumulates).
    if (sim.powerUps.pickups.length > 1) {
      fail(`${sim.powerUps.pickups.length} power-ups on the board at once`);
    }

    // 2. Never on an apple, never on a snake cell, always inside the arena and never in the dead zone
    //    (`§2.3`, and the tech-lead ruling that a power-up must avoid apples as well as snakes).
    for (const pickup of sim.powerUps.pickups) {
      const { cell } = pickup;
      if (
        cell.x < 0 ||
        cell.y < 0 ||
        cell.x >= SETTINGS.grid.width ||
        cell.y >= SETTINGS.grid.height
      ) {
        fail(`power-up outside the arena at (${cell.x}, ${cell.y})`);
      }
      if (sim.lasers.inDeadZone(cell)) fail(`power-up left inside the dead zone at (${cell.x}, ${cell.y})`);
      for (const apple of sim.food.present()) {
        if (apple.x === cell.x && apple.y === cell.y) fail('power-up sharing a cell with an apple');
      }
      for (const snake of sim.snakes) {
        if (!snake.alive) continue;
        for (const segment of snake.segments) {
          if (segment.x === cell.x && segment.y === cell.y) {
            fail('power-up sharing a cell with a snake segment');
          }
        }
      }
    }

    // 3. `speedMultiplier` only ever holds one of the four legal products, and no effect ever carries a
    //    negative or zero timer into a tick.
    for (const snake of sim.snakes) {
      if (!isLegalMultiplier(snake.speedMultiplier)) {
        fail(`illegal speedMultiplier ${snake.speedMultiplier} on ${snake.id}`);
      }
      if (snake.effects.length > 2) fail(`${snake.effects.length} effects on ${snake.id}`);
      const seen = new Set();
      for (const effect of snake.effects) {
        // "Refresh, not stack" (`AC7`) as a board-state invariant rather than an event one: two entries of
        // the same type could never be produced by a correct `applyEffect`.
        if (seen.has(effect.type)) fail(`two ${effect.type} effects at once on ${snake.id}`);
        seen.add(effect.type);
        if (effect.remainingTicks <= 0) {
          fail(`${effect.type} on ${snake.id} still present at ${effect.remainingTicks} ticks`);
        }
      }
    }
  }

  return { spawns, collections, effectsEnded, removals, despawns, reachedWarning: warned };
}

describe('KS-06-05 power-up adversarial fuzz', () => {
  it(`KS-06-05 AC1: every power-up invariant holds across ${SEEDS} seeded rounds`, () => {
    /** @type {string[]} */
    const violations = [];
    const totals = {
      spawns: 0,
      collections: 0,
      effectsEnded: 0,
      removals: 0,
      despawns: 0,
      roundsThatCollected: 0,
      roundsThatEndedAnEffect: 0,
      roundsThatReachedTheWarning: 0,
    };

    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const round = fuzzRound(seed, violations);
      totals.spawns += round.spawns;
      totals.collections += round.collections;
      totals.effectsEnded += round.effectsEnded;
      totals.removals += round.removals;
      totals.despawns += round.despawns;
      if (round.collections > 0) totals.roundsThatCollected += 1;
      if (round.effectsEnded > 0) totals.roundsThatEndedAnEffect += 1;
      if (round.reachedWarning) totals.roundsThatReachedTheWarning += 1;
      // A fuzz that reports two thousand identical failures is unreadable and slow; the first handful is
      // enough to reproduce from, since every message carries its own seed.
      if (violations.length > 20) break;
    }

    expect(violations).toEqual([]);

    // Coverage assertions on the fuzz itself: without these the suite could pass by never reaching any of
    // the behaviour it is supposed to be attacking. The thresholds are deliberately far below what the
    // drivers actually achieve, so they fail on a driver that has stopped working rather than on noise.
    //
    // The numbers these were set from, on the run that first went green (2 000 seeds): 1 883 spawns,
    // 1 238 collections, 837 effects expired, 191 despawn/replace pairs, 11 laser removals; 792 rounds
    // collected something, 543 watched an effect run out, 93 survived to the laser warning.
    expect(totals.spawns).toBeGreaterThan(SEEDS * 0.5);
    expect(totals.roundsThatCollected).toBeGreaterThan(SEEDS * 0.25);
    expect(totals.roundsThatEndedAnEffect).toBeGreaterThan(SEEDS * 0.2);
    expect(totals.despawns).toBeGreaterThan(50);
    // Reaching 0:30 alive is rare — two snakes hunting each other's power-ups mostly crash first — so this
    // threshold is low on purpose. It is here because the "effects outlive the warning" half of `§2.4` is
    // only exercised by the rounds that get there at all.
    expect(totals.roundsThatReachedTheWarning).toBeGreaterThan(SEEDS * 0.02);
    // Rarest of the lot: a pedestal still standing when a beam closes over it. Asserted as "happened at
    // all", because the invariant it guards (`POWERUP_REMOVED` only ever for a dead-zone cell) is worthless
    // if no round in the run ever produced one. The deterministic test for the event itself is KS-06-01's.
    expect(totals.removals).toBeGreaterThan(0);
    // Same explicit budget `laserFuzz.test.js` uses: two thousand rounds is minutes of head-room over the
    // ~19 s this actually takes, and vitest's 5 s default would otherwise fail the suite for being thorough.
  }, 600_000);
});
