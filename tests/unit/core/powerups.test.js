// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { EVENTS, PHASES } from '../../../src/core/events.js';
import { POWERUP_TYPES, createPowerUps } from '../../../src/core/powerups.js';
import { createRng } from '../../../src/core/rng.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { Snake } from '../../../src/core/snake.js';

/**
 * Power-up spawning, pickup and effect timers (`docs/sprints/sprint-06-power-ups.md` KS-06-01,
 * `DESIGN-DECISIONS §1 rows 3/4/20/21`, `§2.3`, `§2.4`).
 *
 * Every threshold asserted here is derived from `SETTINGS` rather than typed in as a literal — the same
 * discipline `lasers.test.js` uses — so a test can never quietly disagree with the shipping numbers; a
 * handful of assertions restate the design's own numbers by hand (75/60/45, 1.5x/0.6x, 5s/4s) so the test
 * states the timeline rather than only restating its own formula.
 */

/** @typedef {import('../../../src/core/round.js').SimEvent} SimEvent */
/** @typedef {import('../../../src/core/grid.js').Cell} Cell */

const TWO_PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * A round nobody can lose and nobody moves: `snakeSpeed: 0` so no snake ever steps on its own, and `godMode`
 * so a beam or a wall closing over where a snake stands cannot kill it either (mirrors `lasers.test.js`'s own
 * `frozenRound`). What is left is the power-up schedule on its own.
 *
 * @param {import('../../../src/core/settings.js').SettingsOverride} [overrides]
 * @returns {RoundSimulation}
 */
function frozenRound(overrides = {}) {
  return new RoundSimulation({
    settings: withOverrides({ snakeSpeed: 0, godMode: true, ...overrides }),
    seed: 1,
    players: TWO_PLAYERS,
  });
}

/**
 * Advances `sim` one tick at a time up to `elapsed` simulated seconds, returning every event produced along
 * the way. One tick at a time (never one big `advance`) so a test asserting *when* an event happened can fail
 * on the wrong tick (`lasers.test.js`'s own `runTo`).
 *
 * @param {RoundSimulation} sim
 * @param {number} elapsed
 * @returns {SimEvent[]}
 */
function runTo(sim, elapsed) {
  const dt = 1 / sim.settings.simHz;
  /** @type {SimEvent[]} */
  const events = [];
  const target = Math.round(elapsed * sim.settings.simHz);
  while (sim.tick < target && sim.phase === PHASES.PLAYING) {
    events.push(...sim.advance(dt));
  }
  return events;
}

/**
 * @param {SimEvent[]} events
 * @param {string} type
 * @returns {SimEvent[]}
 */
function only(events, type) {
  return events.filter((event) => event.type === type);
}

/** Seconds remaining at the moment `event` was emitted (`DESIGN-DECISIONS §2.4`'s timeline is written in these). */
function remainingAt(/** @type {SimEvent} */ event) {
  return SETTINGS.roundDuration - /** @type {number} */ (event.t);
}

/** A minimal fake `Rng` that always picks the first candidate — used where the exact cell/type does not
 * matter and a test only needs the call *count*, not the outcome. */
function firstPickRng() {
  return { next: () => 0, int: () => 0, pick: (/** @type {unknown[]} */ array) => array[0], seed: 0 };
}

/** Wraps `rng` so every draw is counted, without changing what it returns. */
function countingRng(rng) {
  let calls = 0;
  return {
    rng: {
      next: () => {
        calls += 1;
        return rng.next();
      },
      int: (/** @type {number} */ max) => {
        calls += 1;
        return rng.int(max);
      },
      pick: (/** @type {unknown[]} */ array) => {
        calls += 1;
        return rng.pick(array);
      },
      seed: rng.seed,
    },
    get calls() {
      return calls;
    },
  };
}

describe('KS-06-01 power-up spawn cycle (RoundSimulation)', () => {
  describe('AC1 the spawn timeline', () => {
    it('KS-06-01 AC1: ON — spawns at 75, 60, 45 s remaining and none at 30', () => {
      const sim = frozenRound({ powerUpsEnabled: true });
      const events = runTo(sim, SETTINGS.roundDuration);
      const spawns = only(events, EVENTS.POWERUP_SPAWNED);

      expect(spawns).toHaveLength(3);
      expect(spawns.map(remainingAt)).toEqual([75, 60, 45]);
      expect(spawns.map(remainingAt)).not.toContain(30);
      for (const spawn of spawns) {
        expect(Object.values(POWERUP_TYPES)).toContain(spawn.powerUpType);
        expect(typeof spawn.cell.x).toBe('number');
        expect(typeof spawn.cell.y).toBe('number');
      }
    });

    it('KS-06-01 AC1: OFF — zero POWERUP_*/EFFECT_* events across 100 seeds', () => {
      for (let seed = 0; seed < 100; seed += 1) {
        const sim = new RoundSimulation({
          settings: withOverrides({ snakeSpeed: 0, godMode: true, powerUpsEnabled: false }),
          seed,
          players: TWO_PLAYERS,
        });
        const events = runTo(sim, SETTINGS.roundDuration);
        const powerUpEvents = events.filter((event) => event.type.startsWith('POWERUP_') || event.type.startsWith('EFFECT_'));
        expect(powerUpEvents).toEqual([]);
        expect(sim.powerUps.pickups).toEqual([]);
      }
    });

    it('KS-06-01 AC1: OFF — draws no random number for a power-up, ever', () => {
      // The strong form of the determinism claim: not merely "no event fires", but "the rng stream is never
      // touched", checked directly against `createPowerUps` rather than inferred from `RoundSimulation`.
      const counting = countingRng(createRng(1));
      const powerUps = createPowerUps({ settings: SETTINGS, enabled: false, rng: counting.rng });
      const grid = SETTINGS.grid;
      const placement = () => ({ grid, occupied: new Set(), heads: [] });

      for (let t = SETTINGS.roundDuration; t >= 0; t -= 1) {
        powerUps.updateSpawns(t, placement);
      }
      expect(counting.calls).toBe(0);
    });

    it('KS-06-01: no power-up ever spawns at or after laserStartTime, even in a round shorter than the first spawn threshold', () => {
      // `powerUpFirstSpawnAt` (75) is unmodified — the whole point is a round whose clock never reaches it.
      // `maxCycleCount` alone would allow every one of `maxCycles` cycles onto the very first tick here (all
      // after LASER_WARNING, in the same tick); `updateSpawns`'s own clock guard is what actually stops it.
      const sim = new RoundSimulation({
        settings: withOverrides({
          roundDuration: 2,
          laserStartTime: 2,
          laserWarningDuration: 1,
          laserStepInterval: 10,
          godMode: true,
          powerUpsEnabled: true,
        }),
        seed: 1,
        players: TWO_PLAYERS,
      });
      const events = runTo(sim, 2);

      expect(only(events, EVENTS.POWERUP_SPAWNED)).toEqual([]);
      expect(only(events, EVENTS.POWERUP_DESPAWNED)).toEqual([]);
      expect(sim.powerUps.pickups).toEqual([]);
      // Sanity: the warning really did fire this round, so "nothing spawned" is the guard working, not the
      // laser schedule simply never reaching the threshold.
      expect(only(events, EVENTS.LASER_WARNING)).toHaveLength(1);
    });
  });

  describe('AC2 despawn/spawn pairing', () => {
    it('KS-06-01 AC2: an uncollected pickup despawns exactly when the next one spawns', () => {
      const sim = frozenRound({ powerUpsEnabled: true });
      const events = runTo(sim, SETTINGS.roundDuration);

      const despawns = only(events, EVENTS.POWERUP_DESPAWNED);
      const spawns = only(events, EVENTS.POWERUP_SPAWNED);
      // Three spawns (75/60/45), the first has nothing to despawn, so exactly two despawns — one per later
      // cycle — and each is immediately followed by its replacement's spawn, in the same tick.
      expect(despawns).toHaveLength(2);
      for (const despawn of despawns) {
        const matchingSpawnIndex = spawns.findIndex(
          (spawn) => spawn.tick === despawn.tick && spawn !== spawns[0],
        );
        expect(matchingSpawnIndex).toBeGreaterThan(-1);
      }
      // Never more than one power-up on the board (tech-lead contract: "at most one, ever").
      expect(sim.powerUps.pickups.length).toBeLessThanOrEqual(1);
    });

    it('KS-06-01 AC2: a collected pickup does not despawn on the next cycle', () => {
      const settings = SETTINGS;
      const counting = countingRng(createRng(1));
      const powerUps = createPowerUps({ settings, enabled: true, rng: counting.rng });
      const placement = () => ({ grid: settings.grid, occupied: new Set(), heads: [] });

      const firstSpawn = only(powerUps.updateSpawns(settings.powerUpFirstSpawnAt, placement), EVENTS.POWERUP_SPAWNED);
      expect(firstSpawn).toHaveLength(1);
      const cell = firstSpawn[0].payload.cell;

      // Collected before the next cycle boundary.
      expect(powerUps.collectAt(cell)).not.toBeNull();
      expect(powerUps.pickups).toEqual([]);

      const secondCycleEvents = powerUps.updateSpawns(
        settings.powerUpFirstSpawnAt - settings.powerUpInterval,
        placement,
      );
      expect(only(secondCycleEvents, EVENTS.POWERUP_DESPAWNED)).toEqual([]);
      expect(only(secondCycleEvents, EVENTS.POWERUP_SPAWNED)).toHaveLength(1);
    });
  });

  describe('Ruling 3 — a placement failure skips the whole cycle', () => {
    it('KS-06-01: a cycle with nowhere legal to spawn despawns nothing and draws no rng', () => {
      const settings = SETTINGS;
      const counting = countingRng(firstPickRng());
      const powerUps = createPowerUps({ settings, enabled: true, rng: counting.rng });

      // First cycle: room to spawn.
      const openPlacement = () => ({ grid: settings.grid, occupied: new Set(), heads: [] });
      const firstEvents = powerUps.updateSpawns(settings.powerUpFirstSpawnAt, openPlacement);
      expect(only(firstEvents, EVENTS.POWERUP_SPAWNED)).toHaveLength(1);
      const before = powerUps.pickups[0];
      const callsAfterFirstSpawn = counting.calls;

      // Second cycle: every cell on the board is occupied, so no cell can ever satisfy even the relaxed
      // (minDistance 0) placement rule.
      const fullOccupied = new Set();
      for (let x = 0; x < settings.grid.width; x += 1) {
        for (let y = 0; y < settings.grid.height; y += 1) fullOccupied.add(`${x},${y}`);
      }
      const blockedPlacement = () => ({ grid: settings.grid, occupied: fullOccupied, heads: [] });
      const secondEvents = powerUps.updateSpawns(
        settings.powerUpFirstSpawnAt - settings.powerUpInterval,
        blockedPlacement,
      );

      expect(secondEvents).toEqual([]);
      // No rng draw for a cycle that placed nothing — not for a cell, not for a type.
      expect(counting.calls).toBe(callsAfterFirstSpawn);
      // The board is not emptied by the failed cycle: the original pickup is exactly as it was.
      expect(powerUps.pickups).toEqual([before]);
    });

    it('KS-06-01: a degenerate powerUpInterval of 0 still spawns at most once, never a divide-by-zero storm', () => {
      const settings = withOverrides({ powerUpInterval: 0 });
      const powerUps = createPowerUps({ settings, enabled: true, rng: createRng(1) });
      const placement = () => ({ grid: settings.grid, occupied: new Set(), heads: [] });

      const first = only(
        powerUps.updateSpawns(settings.powerUpFirstSpawnAt, placement),
        EVENTS.POWERUP_SPAWNED,
      );
      expect(first).toHaveLength(1);
      // Calling again at the same or a later moment never produces a second cycle.
      expect(powerUps.updateSpawns(settings.powerUpFirstSpawnAt - 1, placement)).toEqual([]);
      expect(powerUps.updateSpawns(0, placement)).toEqual([]);
    });
  });

  describe('POWERUP_REMOVED — a laser step sweeping an uncollected pickup off the board', () => {
    it('KS-06-01: fires with the exact swept cell, empties the board, and spares a pickup inside the safe square', () => {
      // The ticket names this event specifically ("this ticket adds the event and the test"): `round.js`'s
      // `sweepDeadZone` already filtered `powerUps.pickups`, but nothing asserted on the event or on what
      // survives. Two pickups are seeded directly (`round.test.js`'s own technique for reaching a laser
      // state without waiting out the schedule) so one real `LASER_STEP` can be shown to remove exactly one
      // of them and leave the other untouched.
      const sim = frozenRound({ powerUpsEnabled: false });
      sim.powerUps.pickups = [
        { cell: { x: 0, y: 12 }, type: POWERUP_TYPES.SPEED }, // x=0 < inset 1 after the first LASER_STEP
        { cell: { x: 12, y: 12 }, type: POWERUP_TYPES.SLOW }, // deep inside the safe square
      ];

      const firstStepAt = SETTINGS.laserStartTime - SETTINGS.laserWarningDuration; // 25 s remaining
      const events = runTo(sim, SETTINGS.roundDuration - firstStepAt);

      expect(only(events, EVENTS.LASER_STEP)).toHaveLength(1); // sanity: exactly the first step happened
      const removed = only(events, EVENTS.POWERUP_REMOVED);
      expect(removed).toHaveLength(1);
      expect(removed[0]).toMatchObject({ cell: { x: 0, y: 12 } });
      // `POWERUP_REMOVED` stays `{ cell }` — no type, unlike `POWERUP_SPAWNED`/`POWERUP_DESPAWNED`.
      expect(removed[0].powerUpType).toBeUndefined();
      expect(Object.keys(removed[0]).sort()).toEqual(['cell', 't', 'tick', 'type']);

      expect(sim.powerUps.pickups).toEqual([{ cell: { x: 12, y: 12 }, type: POWERUP_TYPES.SLOW }]);
      expect(sim.lasers.inDeadZone({ x: 12, y: 12 })).toBe(false);
    });
  });

  describe('Tech-lead ruling — a power-up never lands on an apple', () => {
    it("KS-06-01: RoundSimulation's power-up placement occupies every current apple cell", () => {
      const sim = frozenRound({ powerUpsEnabled: true });
      const placement = sim.powerUpPlacement();
      for (const apple of sim.food.present()) {
        expect(placement.occupied.has(`${apple.x},${apple.y}`)).toBe(true);
      }
    });

    it('KS-06-01: a power-up is never placed on a cell in `occupied`, across 2000 seeded trials', () => {
      // A tiny grid with only one legal cell (5,5) — everything else is "occupied" (snake or apple cells,
      // from `round.js`'s point of view). The system must always choose that one cell, never anything else.
      const grid = { width: 6, height: 6 };
      const occupied = new Set();
      for (let x = 0; x < grid.width; x += 1) {
        for (let y = 0; y < grid.height; y += 1) {
          if (x === 5 && y === 5) continue;
          occupied.add(`${x},${y}`);
        }
      }
      const settings = withOverrides({ grid, powerUpMinDistanceFromHead: 0 });
      for (let seed = 0; seed < 2000; seed += 1) {
        const powerUps = createPowerUps({ settings, enabled: true, rng: createRng(seed) });
        const events = only(
          powerUps.updateSpawns(settings.powerUpFirstSpawnAt, () => ({ grid, occupied, heads: [] })),
          EVENTS.POWERUP_SPAWNED,
        );
        expect(events).toHaveLength(1);
        expect(events[0].payload.cell).toEqual({ x: 5, y: 5 });
      }
    });

    it('KS-06-01: an apple never respawns onto a standing power-up, across 2000 seeded trials', () => {
      // Tech-lead review adversarial finding (KS-06-05 fuzz): `powerUpPlacement()` already avoided apple
      // cells, but nothing made *apple* placement avoid a standing power-up — two objects cannot occupy one
      // cell regardless of which arrived second. `round.js`'s own `foodPlacement()` was the bug, not
      // `placeFoodWithFallback` (already correct), so this drives a real `RoundSimulation` end to end
      // (`eatIfApple`, the actual caller) rather than handing the placement helper a hand-built `occupied`
      // set that could quietly agree with whichever side of the bug it was written to match.
      const grid = { width: 6, height: 6 };
      const settings = withOverrides({ grid, foodMinDistanceFromHead: 0, powerUpsEnabled: false });
      const pickupCell = { x: 5, y: 5 };
      // (0, 0) is the slot being eaten — it frees up as part of this very respawn — so two cells, not one,
      // are legitimately free afterwards; the invariant under test is only that neither of them is ever the
      // power-up's cell, which a bugged `occupied` set would have allowed as a *third* candidate.
      const eatenCell = { x: 0, y: 0 };
      const otherFreeCell = { x: 4, y: 5 };
      const freeCells = [eatenCell, otherFreeCell];

      for (let seed = 0; seed < 2000; seed += 1) {
        const sim = new RoundSimulation({ settings, seed, players: TWO_PLAYERS });
        /** @type {Cell[]} */
        const filler = [];
        for (let x = 0; x < grid.width; x += 1) {
          for (let y = 0; y < grid.height; y += 1) {
            const isPickup = x === pickupCell.x && y === pickupCell.y;
            const isFree = freeCells.some((cell) => cell.x === x && cell.y === y);
            if (!isPickup && !isFree) filler.push({ x, y });
          }
        }
        // Every cell but the power-up's and the two legitimately-free ones is another apple, so the only way
        // a respawn can land on `pickupCell` is if it is missing from `occupied` — exactly the bug.
        sim.food.apples = [eatenCell, ...filler];
        sim.powerUps.pickups = [{ cell: pickupCell, type: POWERUP_TYPES.SPEED }];
        sim.snakes[0].segments[0] = { ...eatenCell };

        sim.eatIfApple(sim.snakes[0]);

        const respawned = sim.food.apples[0];
        expect(respawned).not.toBeNull();
        expect(respawned).not.toEqual(pickupCell);
        expect(freeCells).toContainEqual(respawned);
      }
    });
  });

  describe('AC4 SLOW in a 2-player round', () => {
    it('KS-06-01 AC4: the opponent is slowed to 3.6 cells/s for 4 s; the collector is unaffected', () => {
      const sim = new RoundSimulation({
        settings: withOverrides({ snakeSpeed: 0, godMode: true, powerUpsEnabled: false }),
        seed: 2,
        players: TWO_PLAYERS,
      });
      sim.events = [];
      sim.applyPowerUpEffect(sim.snakes[0], POWERUP_TYPES.SLOW);
      // Inside a real tick, `resolvePowerUpPickup` (which calls `applyPowerUpEffect`) and
      // `tickPowerUpEffects` run in that order in the *same* tick (`simulateTick`) — calling
      // `applyPowerUpEffect` directly, as this white-box test does, skips straight to "just after
      // collection" and so must replay that same tick's own decrement ("settle") before measuring
      // durations, or every count below would land one tick off from what a real collection produces.
      sim.tickPowerUpEffects();

      expect(sim.snakes[1].speedMultiplier).toBe(SETTINGS.slow.multiplier);
      expect(SETTINGS.snakeSpeed * sim.snakes[1].speedMultiplier).toBeCloseTo(3.6, 12);
      expect(sim.snakes[0].speedMultiplier).toBe(1);
      expect(only(sim.events, EVENTS.EFFECT_STARTED)).toEqual([
        expect.objectContaining({ playerId: 'p2', powerUpType: POWERUP_TYPES.SLOW }),
      ]);

      const durationTicks = Math.round(SETTINGS.slow.duration * SETTINGS.simHz);
      let slowedTicks = 0;
      let endedAtTick = null;
      for (let tick = 1; tick <= durationTicks + 10 && endedAtTick === null; tick += 1) {
        if (sim.snakes[1].speedMultiplier === SETTINGS.slow.multiplier) slowedTicks += 1;
        sim.events = [];
        sim.tickPowerUpEffects();
        if (only(sim.events, EVENTS.EFFECT_ENDED).length > 0) endedAtTick = tick;
      }
      expect(slowedTicks).toBe(durationTicks); // 4.000 s at 120 Hz
      expect(endedAtTick).toBe(durationTicks);
      expect(sim.snakes[1].speedMultiplier).toBe(1);
      expect(only(sim.events, EVENTS.EFFECT_ENDED)).toEqual([
        expect.objectContaining({ playerId: 'p2', powerUpType: POWERUP_TYPES.SLOW }),
      ]);
    });
  });

  describe('AC5 SLOW in solo (Ruling 1/2 — the laser clock, not a mutated interval)', () => {
    it('KS-06-01 AC5: with no opponent, the laser clock halves for 4 s and the snake speed is unaffected', () => {
      // A one-snake round cannot exist in match mode (`RoundSimulation`'s own constructor guard), and
      // practice mode has no round clock at all — so "solo" is driven directly, exactly as the tech lead's
      // Ruling 2 asks: a real 2-player match round with P2 marked not-alive, so `applyPowerUpEffect` takes
      // the "no other snake" branch while a real laser clock still exists to observe.
      const sim = new RoundSimulation({
        settings: withOverrides({ snakeSpeed: 0, godMode: true, powerUpsEnabled: false }),
        seed: 3,
        players: TWO_PLAYERS,
      });
      sim.snakes[1].alive = false;
      sim.events = [];
      sim.applyPowerUpEffect(sim.snakes[0], POWERUP_TYPES.SLOW);
      // Same reasoning as AC4: `applyPowerUpEffect` called directly, outside any tick, skips straight to
      // "just after collection" without the same tick's own `tickPowerUpEffects` decrement a real collection
      // would also get — replay it once before measuring, so the rule runs for exactly `slow.duration`
      // ticks of laser-clock time from here, not one tick more.
      sim.tickPowerUpEffects();

      expect(sim.powerUps.laserRateMultiplier).toBe(1 / SETTINGS.slow.laserMultiplierWhenSolo);
      expect(sim.snakes[0].speedMultiplier).toBe(1); // "snake speed unchanged"
      expect(only(sim.events, EVENTS.EFFECT_STARTED)).toEqual([
        expect.objectContaining({ playerId: 'p1', powerUpType: POWERUP_TYPES.SLOW }),
      ]);

      // Run the laser clock for a long time (a laser-only round: nobody steps, snakeSpeed 0) with the rule
      // running, then compare where LASER_STEP would have landed against an identical, un-slowed round.
      const events = runTo(sim, SETTINGS.roundDuration);

      const baselineEvents = runTo(
        new RoundSimulation({
          settings: withOverrides({ snakeSpeed: 0, godMode: true, powerUpsEnabled: false }),
          seed: 3,
          players: TWO_PLAYERS,
        }),
        SETTINGS.roundDuration,
      );

      // 4.000 s at half rate advances the laser clock only 2.000 s worth of ticks, so every threshold after
      // the rule ends is reached exactly 2.000 s (half of 4 s) later than the un-slowed schedule.
      const shiftTicks = Math.round((SETTINGS.slow.duration / 2) * SETTINGS.simHz); // 240 ticks = 2.000s
      const steps = only(events, EVENTS.LASER_STEP);
      const baselineSteps = only(baselineEvents, EVENTS.LASER_STEP);
      expect(steps).toHaveLength(baselineSteps.length);
      for (let i = 0; i < steps.length; i += 1) {
        expect(steps[i].tick - baselineSteps[i].tick).toBe(shiftTicks);
      }
      expect(shiftTicks / SETTINGS.simHz).toBe(2);
      expect(steps[0].t - baselineSteps[0].t).toBe(2);

      // The rule itself ends after exactly 4.000 s and the multiplier reverts.
      expect(sim.powerUps.laserRateMultiplier).toBe(1);
    });
  });
});

describe('KS-06-01 Snake power-up effects', () => {
  /** @returns {Snake} */
  function makeSnake() {
    return new Snake({
      id: 'p1',
      cells: [
        { x: 0, y: 0 },
        { x: -1, y: 0 },
      ],
      direction: DIRECTIONS.RIGHT,
      settings: SETTINGS,
    });
  }

  describe('AC3 SPEED boost duration', () => {
    it('KS-06-01 AC3: the step interval shrinks to 1/9 s for exactly 5.000 s of sim time, then back to 1/6 s', () => {
      const snake = makeSnake();
      const isNew = snake.applyEffect(
        POWERUP_TYPES.SPEED,
        SETTINGS.speedBoost.multiplier,
        SETTINGS.speedBoost.duration,
        SETTINGS.simHz,
      );
      expect(isNew).toBe(true);
      expect(snake.speedMultiplier).toBe(1.5);
      expect(SETTINGS.snakeSpeed * snake.speedMultiplier).toBe(9); // step interval 1/9 s

      // `round.js`'s `simulateTick` calls `snake.tickEffects()` in the *same* tick a pickup is applied
      // (`resolvePowerUpPickup` then `tickPowerUpEffects`, in that order) — replaying that one decrement
      // here is what makes the tick-by-tick count below land on exactly 5.000 s, not 5.000 s plus one tick.
      snake.tickEffects();

      let boostedTicks = 0;
      let endedAtTick = null;
      for (let tick = 1; tick <= 10000 && endedAtTick === null; tick += 1) {
        if (snake.speedMultiplier === 1.5) boostedTicks += 1;
        snake.accumulate(1 / SETTINGS.simHz);
        const expired = snake.tickEffects();
        if (expired.includes(POWERUP_TYPES.SPEED)) endedAtTick = tick;
      }

      const expectedTicks = Math.round(SETTINGS.speedBoost.duration * SETTINGS.simHz);
      expect(expectedTicks).toBe(600); // 5.000 s at 120 Hz — states the number, not just the formula
      expect(boostedTicks).toBe(expectedTicks);
      expect(endedAtTick).toBe(expectedTicks);
      expect(snake.speedMultiplier).toBe(1);
      expect(SETTINGS.snakeSpeed * snake.speedMultiplier).toBe(6); // back to the base step interval 1/6 s
      expect(snake.effects).toEqual([]);
    });
  });

  describe('AC7 refresh, not stack', () => {
    it('KS-06-01 AC7: two SPEED pickups end 5 s after the second, at 1.5x, never 2.25x', () => {
      const snake = makeSnake();
      snake.applyEffect(
        POWERUP_TYPES.SPEED,
        SETTINGS.speedBoost.multiplier,
        SETTINGS.speedBoost.duration,
        SETTINGS.simHz,
      );
      snake.tickEffects(); // settle the first pickup's own tick, as in the AC3 test above
      expect(snake.speedMultiplier).toBe(1.5);

      // A couple of seconds later, well before the first boost would have expired (5 s).
      for (let i = 0; i < 240; i += 1) snake.tickEffects();
      expect(snake.speedMultiplier).toBe(1.5); // still active, uninterrupted

      const isNew = snake.applyEffect(
        POWERUP_TYPES.SPEED,
        SETTINGS.speedBoost.multiplier,
        SETTINGS.speedBoost.duration,
        SETTINGS.simHz,
      );
      snake.tickEffects(); // settle the second pickup's own tick
      expect(isNew).toBe(false); // refreshed, not a second effect
      expect(snake.effects).toHaveLength(1);
      expect(snake.speedMultiplier).toBe(1.5); // never 2.25

      // Ends exactly 5.000 s (600 ticks) after the *second* pickup, not the first.
      const expectedTicks = Math.round(SETTINGS.speedBoost.duration * SETTINGS.simHz);
      let endedAtTick = null;
      for (let tick = 1; tick <= expectedTicks && endedAtTick === null; tick += 1) {
        const expired = snake.tickEffects();
        if (expired.includes(POWERUP_TYPES.SPEED)) endedAtTick = tick;
      }
      expect(endedAtTick).toBe(expectedTicks);
      expect(snake.speedMultiplier).toBe(1);
    });
  });
});

describe('KS-06-01 replays', () => {
  /**
   * Loads a scenario fixture and plays it through a fresh `RoundSimulation`. The fixture format extends the
   * project's `{seed, settingsOverrides, inputs}` replay convention (`tests/sim/replays/README.md`) with two
   * fields this suite's scenarios need and a plain input log cannot express on its own: `startTick` jumps the
   * round clock directly before anything is simulated — the same technique `round.test.js` uses
   * ("the inset is moved to 1 directly instead of waiting 65 simulated seconds for the schedule to do it") —
   * and `initialPickup` seeds the one power-up on the board, so the scenario does not depend on the exact
   * cell a real spawn cycle's rng would have chosen.
   *
   * @param {string} file
   * @returns {{replay: any, sim: RoundSimulation}}
   */
  function loadReplay(file) {
    const replay = JSON.parse(
      readFileSync(new URL(`./__golden__/${file}`, import.meta.url), 'utf8'),
    );
    const sim = new RoundSimulation({
      settings: replay.settingsOverrides ? withOverrides(replay.settingsOverrides) : SETTINGS,
      seed: replay.seed,
      players: TWO_PLAYERS,
      mode: replay.mode ?? 'match',
    });
    if (typeof replay.startTick === 'number') {
      sim.tick = replay.startTick;
      sim.laserClockTicks = replay.startTick;
      sim.laserClockCarry = 0;
    }
    if (replay.initialPickup) {
      sim.powerUps.pickups = [replay.initialPickup];
    }
    return { replay, sim };
  }

  /**
   * Applies a recorded input log (`{t, player, dir}`, `dir` a `DIRECTIONS` name) while advancing tick by
   * tick to `untilElapsed` seconds, exactly `tests/sim/harness.js`'s own resolve-to-a-tick discipline.
   *
   * @param {RoundSimulation} sim
   * @param {{t: number, player: string, dir: keyof typeof DIRECTIONS}[]} inputs
   * @param {number} untilElapsed
   * @returns {SimEvent[]}
   */
  function replayTo(sim, inputs, untilElapsed) {
    const dt = 1 / sim.settings.simHz;
    const pending = [...inputs].sort((a, b) => a.t - b.t);
    /** @type {SimEvent[]} */
    const events = [];
    const target = Math.round(untilElapsed * sim.settings.simHz);
    while (sim.tick < target && sim.phase === PHASES.PLAYING) {
      while (pending.length > 0 && pending[0].t <= sim.elapsed) {
        const input = pending.shift();
        sim.applyInput(input.player, DIRECTIONS[input.dir]);
      }
      events.push(...sim.advance(dt));
    }
    return events;
  }

  it('KS-06-01 AC6: collecting SPEED at 0:31 keeps it active until 0:26, across the 0:30 warning', () => {
    const { replay, sim } = loadReplay('ac6-speed-across-warning.json');
    // Stop just short of 0:25 (tick 7800), the very first LASER_STEP — this window is about the effect's
    // own clock, not the lasers, and running exactly to 65 s would include that boundary tick's step.
    const events = replayTo(sim, replay.inputs, 64.9);

    const collected = only(events, EVENTS.POWERUP_COLLECTED);
    const started = only(events, EVENTS.EFFECT_STARTED);
    const warning = only(events, EVENTS.LASER_WARNING);
    const ended = only(events, EVENTS.EFFECT_ENDED);

    expect(collected).toEqual([expect.objectContaining({ playerId: 'p1', powerUpType: 'SPEED' })]);
    expect(remainingAt(collected[0])).toBe(31);
    expect(started).toEqual([expect.objectContaining({ playerId: 'p1', powerUpType: 'SPEED' })]);

    expect(warning).toHaveLength(1);
    expect(remainingAt(warning[0])).toBe(SETTINGS.laserStartTime); // 0:30, as the AC says

    expect(ended).toEqual([expect.objectContaining({ playerId: 'p1', powerUpType: 'SPEED' })]);
    expect(remainingAt(ended[0])).toBe(26); // still active 4 s into the warning

    // No LASER_STEP yet in this window (the first is at 0:25) — the effect ended purely on its own clock.
    expect(only(events, EVENTS.LASER_STEP)).toEqual([]);
  });

  it('KS-06-01 AC7: two SPEED pickups end 5 s after the second (replayed through a real round)', () => {
    const { replay, sim } = loadReplay('ac7-speed-refresh.json');
    const dt = 1 / sim.settings.simHz;
    const pending = [...replay.inputs].sort((a, b) => a.t - b.t);
    const targetTick = Math.round(replay.runToElapsed * sim.settings.simHz);

    // A real round never carries two power-ups at once, so the second is placed on the board by the test —
    // "as soon as the collector's replay collects the first" — rather than baked into the fixture up front.
    let secondPlaced = false;
    let multiplierRightAfterSecond = null;
    /** @type {SimEvent[]} */
    const events = [];
    while (sim.tick < targetTick && sim.phase === PHASES.PLAYING) {
      while (pending.length > 0 && pending[0].t <= sim.elapsed) {
        const input = pending.shift();
        sim.applyInput(input.player, DIRECTIONS[input.dir]);
      }
      const tickEvents = sim.advance(dt);
      events.push(...tickEvents);
      const collectedThisTick = only(tickEvents, EVENTS.POWERUP_COLLECTED);
      if (collectedThisTick.length > 0) {
        if (!secondPlaced) {
          sim.powerUps.pickups = [replay.secondPickup];
          secondPlaced = true;
        } else {
          // The multiplier right after the *second* collection — captured here, not after the whole loop
          // finishes, because the refreshed boost will itself have expired by then.
          multiplierRightAfterSecond = sim.snakes[0].speedMultiplier;
        }
      }
    }

    const collected = only(events, EVENTS.POWERUP_COLLECTED);
    expect(collected).toHaveLength(2);
    const [first, second] = collected;
    expect(second.tick).toBeGreaterThan(first.tick);

    // Refresh, not stack: only one EFFECT_STARTED for the whole scenario.
    expect(only(events, EVENTS.EFFECT_STARTED)).toHaveLength(1);
    // Multiplier never exceeds 1.5, including right after the second pickup.
    expect(multiplierRightAfterSecond).toBe(1.5);

    const ended = only(events, EVENTS.EFFECT_ENDED);
    expect(ended).toHaveLength(1);
    const expectedTicks = Math.round(SETTINGS.speedBoost.duration * SETTINGS.simHz);
    expect(ended[0].tick - second.tick).toBe(expectedTicks);
    // ...and specifically *not* 5 s after the first pickup, which is what "stacking" or "no refresh" would do.
    expect(ended[0].tick - first.tick).not.toBe(expectedTicks);
  });
});
