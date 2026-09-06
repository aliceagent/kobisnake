// @ts-check
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAUSES } from '../../../src/core/collisions.js';
import { END_REASONS, EVENTS, PHASES, RESULTS } from '../../../src/core/events.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { LASER_PHASES, createLasers } from '../../../src/core/lasers.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/**
 * The closing laser arena (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-01,
 * `DESIGN-DECISIONS §1 rows 5/6/9/23`, `§2.3`, `§2.4`, `§2.5`).
 *
 * Every threshold asserted here is derived from `SETTINGS` rather than typed in as a literal, so a test can
 * never quietly disagree with the shipping numbers: if somebody proposes a different `laserStepInterval`, the
 * expectations move with it and only the ones that encode a *rule* (nine steps leave exactly `laserMinArena`,
 * a body in the dead zone does not kill) stay fixed.
 */

/** @typedef {import('../../../src/core/round.js').SimEvent} SimEvent */
/** @typedef {import('../../../src/core/grid.js').Cell} Cell */

const TWO_PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

const GOLDEN_LASER_ROUND = JSON.parse(
  readFileSync(new URL('./__golden__/laser-timeline-round.json', import.meta.url), 'utf8'),
);

/**
 * A round nobody can lose: `snakeSpeed: 0` so no snake ever steps, and `godMode` so the beams closing over
 * where they stand cannot kill them either (KS-04-01 QA). What is left is the schedule on its own.
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
 * Advances `sim` one tick at a time to `elapsed` seconds and returns every event produced on the way.
 * One tick at a time, never one big `advance`, because a test that asserts *when* an event happened has to
 * be able to fail when it happens on the wrong tick.
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

/** Seconds remaining at the moment `event` was emitted. `§2.4`'s timeline is written in these. */
function remainingAt(/** @type {SimEvent} */ event) {
  return SETTINGS.roundDuration - /** @type {number} */ (event.t);
}

describe('KS-04-01 laser schedule', () => {
  describe('AC1 the timeline', () => {
    it('KS-04-01 AC1: LASER_WARNING at exactly 30.000 s remaining, once', () => {
      const sim = frozenRound();
      const events = runTo(sim, SETTINGS.roundDuration);
      const warnings = only(events, EVENTS.LASER_WARNING);

      expect(warnings).toHaveLength(1);
      expect(remainingAt(warnings[0])).toBe(SETTINGS.laserStartTime);
      // The tick, not just the second: 60 s elapsed at 120 Hz is tick 7200 and no other.
      expect(warnings[0].tick).toBe(
        (SETTINGS.roundDuration - SETTINGS.laserStartTime) * SETTINGS.simHz,
      );
    });

    it('KS-04-01 AC1: LASER_STEP at 25.0, 22.5, 20.0 … with inset 1..9', () => {
      const sim = frozenRound();
      const steps = only(runTo(sim, SETTINGS.roundDuration), EVENTS.LASER_STEP);

      const firstStepAt = SETTINGS.laserStartTime - SETTINGS.laserWarningDuration;
      const expected = steps.map((_, i) => firstStepAt - i * SETTINGS.laserStepInterval);
      expect(steps.map(remainingAt)).toEqual(expected);
      expect(steps.map((step) => step.inset)).toEqual(steps.map((_, i) => i + 1));
      // The first three by hand, so the test states the timeline rather than only restating its own formula.
      expect(steps.slice(0, 3).map(remainingAt)).toEqual([25, 22.5, 20]);
    });

    it('KS-04-01 AC1: the 9th step at 5.0 s remaining leaves a 6x6 square, and there is no 10th', () => {
      const sim = frozenRound();
      const steps = only(runTo(sim, SETTINGS.roundDuration), EVENTS.LASER_STEP);

      expect(steps).toHaveLength(9);
      expect(remainingAt(steps[8])).toBe(5);
      expect(steps[8].inset).toBe(9);
      expect(SETTINGS.grid.width - 2 * 9).toBe(SETTINGS.laserMinArena);
      expect(sim.lasers.inset).toBe(9);
      expect(sim.lasers.phase).toBe(LASER_PHASES.STOPPED);
    });

    it('KS-04-01 AC1: the phase walks PARKED -> WARNING -> CLOSING -> STOPPED', () => {
      const lasers = createLasers(SETTINGS);
      expect(lasers.phase).toBe(LASER_PHASES.PARKED);

      expect(lasers.update(SETTINGS.laserStartTime + 0.01)).toEqual([]);
      expect(lasers.phase).toBe(LASER_PHASES.PARKED);

      expect(lasers.update(SETTINGS.laserStartTime)).toEqual([{ type: EVENTS.LASER_WARNING }]);
      expect(lasers.phase).toBe(LASER_PHASES.WARNING);
      expect(lasers.inset).toBe(0);

      expect(lasers.update(25)).toEqual([{ type: EVENTS.LASER_STEP, inset: 1 }]);
      expect(lasers.phase).toBe(LASER_PHASES.CLOSING);

      lasers.update(5);
      expect(lasers.phase).toBe(LASER_PHASES.STOPPED);
      expect(lasers.inset).toBe(9);
      // Past the last step, and past the end of the round: still nine, still stopped.
      expect(lasers.update(0)).toEqual([]);
      expect(lasers.inset).toBe(9);
    });

    it('KS-04-01 AC1: one coarse update that crosses several boundaries emits every step it passed', () => {
      const coarse = createLasers(SETTINGS);
      const events = coarse.update(20);
      expect(events).toEqual([
        { type: EVENTS.LASER_WARNING },
        { type: EVENTS.LASER_STEP, inset: 1 },
        { type: EVENTS.LASER_STEP, inset: 2 },
        { type: EVENTS.LASER_STEP, inset: 3 },
      ]);
    });

    it('KS-04-01 AC1: practice mode has no clock, so the beams never leave PARKED', () => {
      const sim = new RoundSimulation({
        settings: withOverrides({ snakeSpeed: 0 }),
        seed: 1,
        players: [{ id: 'p1' }],
        mode: 'practice',
      });
      const events = runTo(sim, 300);
      expect(only(events, EVENTS.LASER_WARNING)).toEqual([]);
      expect(only(events, EVENTS.LASER_STEP)).toEqual([]);
      expect(sim.lasers.phase).toBe(LASER_PHASES.PARKED);
      // The rule lives in the laser system, not in a mode test in `round.js`: no clock, nothing due.
      expect(createLasers(SETTINGS).update(null)).toEqual([]);
    });
  });

  describe('AC2 the beam closing over a head', () => {
    /**
     * Puts one snake exactly where the test wants it, standing still. `snakeSpeed: 0` means the cells stay
     * put, so the only thing that can happen to this snake is a laser.
     *
     * @param {RoundSimulation} sim
     * @param {number} index
     * @param {Cell[]} cells
     */
    function placeSnake(sim, index, cells) {
      sim.snakes[index].segments = cells.map((cell) => ({ ...cell }));
      sim.snakes[index].previousSegments = cells.map((cell) => ({ ...cell }));
    }

    /** The first tick on which `inset` is 1 (`§2.4`: 0:25 remaining). */
    const firstStepElapsed =
      SETTINGS.roundDuration - (SETTINGS.laserStartTime - SETTINGS.laserWarningDuration);

    it('KS-04-01 AC2: a head at (0, 12) dies with LASER on the step that makes inset 1', () => {
      const sim = frozenRound({ godMode: false });
      placeSnake(sim, 0, [
        { x: 0, y: 12 },
        { x: 1, y: 12 },
        { x: 2, y: 12 },
        { x: 3, y: 12 },
      ]);

      const events = runTo(sim, firstStepElapsed + 0.1);
      const died = only(events, EVENTS.SNAKE_DIED);

      expect(died).toHaveLength(1);
      expect(died[0]).toMatchObject({
        snakeId: 'p1',
        cause: CAUSES.LASER,
        cell: { x: 0, y: 12 },
      });
      // On the step itself, not a tick later: the death and the LASER_STEP share a tick.
      expect(died[0].tick).toBe(only(events, EVENTS.LASER_STEP)[0].tick);
      expect(sim.endReason).toBe(END_REASONS.DEATH);
      expect(sim.result).toBe(RESULTS.P2_WIN);
    });

    it('KS-04-01 AC2: body segments in the dead zone do not kill', () => {
      const sim = frozenRound({ godMode: false });
      // Head safe in the middle, tail trailing out through the first ring the beam sweeps.
      placeSnake(sim, 0, [
        { x: 4, y: 12 },
        { x: 3, y: 12 },
        { x: 2, y: 12 },
        { x: 1, y: 12 },
        { x: 0, y: 12 },
      ]);
      placeSnake(sim, 1, [
        { x: 18, y: 11 },
        { x: 19, y: 11 },
        { x: 20, y: 11 },
        { x: 21, y: 11 },
      ]);

      const events = runTo(sim, firstStepElapsed + 0.1);

      expect(sim.lasers.inset).toBe(1);
      expect(sim.lasers.inDeadZone({ x: 0, y: 12 })).toBe(true);
      expect(only(events, EVENTS.SNAKE_DIED)).toEqual([]);
      expect(sim.snakes[0].alive).toBe(true);
      expect(sim.phase).toBe(PHASES.PLAYING);
    });

    it('KS-04-01 AC2: two heads killed by the same step is a DRAW', () => {
      const sim = frozenRound({ godMode: false });
      placeSnake(sim, 0, [
        { x: 0, y: 12 },
        { x: 1, y: 12 },
      ]);
      placeSnake(sim, 1, [
        { x: 23, y: 11 },
        { x: 22, y: 11 },
      ]);

      const events = runTo(sim, firstStepElapsed + 0.1);
      const died = only(events, EVENTS.SNAKE_DIED);

      expect(died.map((event) => event.snakeId)).toEqual(['p1', 'p2']);
      expect(died.every((event) => event.cause === CAUSES.LASER)).toBe(true);
      expect(sim.result).toBe(RESULTS.DRAW);
    });
  });

  describe('AC3 the boundary cell', () => {
    it('KS-04-01 AC3: a head moving into x = inset-1 dies with LASER', () => {
      const sim = new RoundSimulation({ settings: SETTINGS, seed: 3, players: TWO_PLAYERS });
      // The inset is moved directly rather than waiting 65 s for the schedule: this criterion is about the
      // boundary, not about when it arrives.
      sim.lasers.inset = 1;
      // Facing left with the body behind it, one cell from the boundary. The direction is set rather than
      // queued because a queued LEFT would be a reversal of the spawn's RIGHT and correctly ignored
      // (`DESIGN-DECISIONS §2.2`) — this test is about the cell, not about the input rules.
      sim.snakes[0].direction = DIRECTIONS.LEFT;
      sim.snakes[0].segments = [
        { x: 1, y: 12 },
        { x: 2, y: 12 },
        { x: 3, y: 12 },
      ];

      const events = runTo(sim, 1);
      const died = only(events, EVENTS.SNAKE_DIED);

      expect(died[0]).toMatchObject({ snakeId: 'p1', cause: CAUSES.LASER, cell: { x: 0, y: 12 } });
    });

    it('KS-04-01 AC3: a head moving into x = -1 dies with WALL, which is only possible at inset 0', () => {
      const sim = new RoundSimulation({ settings: SETTINGS, seed: 3, players: TWO_PLAYERS });
      expect(sim.lasers.inset).toBe(0);
      sim.snakes[0].direction = DIRECTIONS.LEFT;
      sim.snakes[0].segments = [
        { x: 0, y: 12 },
        { x: 1, y: 12 },
        { x: 2, y: 12 },
      ];

      const events = runTo(sim, 1);
      const died = only(events, EVENTS.SNAKE_DIED);

      expect(died[0]).toMatchObject({ snakeId: 'p1', cause: CAUSES.WALL, cell: { x: -1, y: 12 } });
    });

    it('KS-04-01 AC3: the cell one inside the boundary is safe, the boundary itself is not', () => {
      const lasers = createLasers(SETTINGS);
      lasers.update(25);
      expect(lasers.inset).toBe(1);

      expect(lasers.isDeadly({ x: 0, y: 12 })).toBe(true);
      expect(lasers.inDeadZone({ x: 0, y: 12 })).toBe(true);
      expect(lasers.isDeadly({ x: 1, y: 12 })).toBe(false);
      expect(lasers.isDeadly({ x: 22, y: 12 })).toBe(false);
      expect(lasers.isDeadly({ x: 23, y: 12 })).toBe(true);
      // Off the board is deadly too, and is *not* the dead zone: that difference is what tells the two
      // death causes apart in `round.js`.
      expect(lasers.isDeadly({ x: -1, y: 12 })).toBe(true);
      expect(lasers.inDeadZone({ x: -1, y: 12 })).toBe(false);
    });

    it('KS-04-01 AC3: at inset 0 "deadly" is exactly "off the board"', () => {
      const lasers = createLasers(SETTINGS);
      for (const cell of [
        { x: 0, y: 0 },
        { x: 23, y: 23 },
        { x: 12, y: 12 },
      ]) {
        expect(lasers.isDeadly(cell)).toBe(false);
      }
      for (const cell of [
        { x: -1, y: 0 },
        { x: 24, y: 0 },
        { x: 0, y: -1 },
        { x: 0, y: 24 },
      ]) {
        expect(lasers.isDeadly(cell)).toBe(true);
        expect(lasers.inDeadZone(cell)).toBe(false);
      }
    });
  });

  describe('AC4 items in the dead zone (issue #39)', () => {
    const firstStepElapsed =
      SETTINGS.roundDuration - (SETTINGS.laserStartTime - SETTINGS.laserWarningDuration);

    it('KS-04-01 AC4: an apple the beam sweeps over is removed and respawned inside the safe square', () => {
      const sim = frozenRound();
      runTo(sim, firstStepElapsed - 0.5);
      // Put an apple exactly on the ring the next step sweeps, so the assertion does not depend on where
      // the seeded placement happened to put the four opening apples.
      sim.food.apples[0] = { x: 0, y: 5 };

      const events = runTo(sim, firstStepElapsed + 0.1);
      const removed = only(events, EVENTS.FOOD_REMOVED);
      const spawned = only(events, EVENTS.FOOD_SPAWNED);
      const step = only(events, EVENTS.LASER_STEP)[0];

      // Slot 0 is the apple this test planted. The seeded opening apples that also happen to sit on the
      // swept ring are removed on the same tick and are not what is being asserted here.
      const removedSlotZero = removed.find((event) => event.index === 0);
      expect(removedSlotZero).toMatchObject({ index: 0, cell: { x: 0, y: 5 } });
      expect(/** @type {SimEvent} */ (removedSlotZero).tick).toBe(step.tick);
      for (const event of removed) {
        expect(event.tick).toBe(step.tick);
      }

      const respawned = spawned.find((event) => event.index === 0);
      expect(respawned).toBeDefined();
      expect(/** @type {SimEvent} */ (respawned).tick).toBe(step.tick);
      expect(sim.lasers.inDeadZone(/** @type {Cell} */ (sim.food.apples[0]))).toBe(false);
      expect(sim.food.getApples()).toHaveLength(SETTINGS.foodCount);
    });

    it('KS-04-01 AC4: no apple is ever left inside the dead zone, on any tick of a full round', () => {
      const sim = frozenRound();
      const dt = 1 / SETTINGS.simHz;
      while (sim.phase === PHASES.PLAYING) {
        sim.advance(dt);
        for (const apple of sim.food.getApples()) {
          expect(sim.lasers.inDeadZone(apple)).toBe(false);
        }
      }
      expect(sim.lasers.inset).toBe(9);
    });

    it('KS-04-01 AC4: a 6x6 square with two length-15 snakes never throws (closes #39)', () => {
      const sim = frozenRound();
      runTo(sim, SETTINGS.roundDuration - 4);
      expect(sim.lasers.inset).toBe(9);

      // Two 15-segment snakes folded into the final 6x6 (x and y both in [9, 15)): 30 of its 36 cells are
      // snake, and the >= 2-cell exclusion around each head covers what is left. This is exactly the state
      // issue #39 was filed about — placement has nowhere legal to go.
      const rows = [9, 10, 11, 12, 13];
      /** @type {Cell[]} */
      const p1 = [];
      /** @type {Cell[]} */
      const p2 = [];
      for (const y of rows) {
        p1.push({ x: 9, y }, { x: 10, y });
        p2.push({ x: 13, y }, { x: 14, y });
      }
      p1.push(
        { x: 11, y: 9 },
        { x: 11, y: 10 },
        { x: 11, y: 11 },
        { x: 11, y: 12 },
        { x: 11, y: 13 },
      );
      p2.push(
        { x: 12, y: 9 },
        { x: 12, y: 10 },
        { x: 12, y: 11 },
        { x: 12, y: 12 },
        { x: 12, y: 13 },
      );
      sim.snakes[0].segments = p1;
      sim.snakes[0].previousSegments = p1.map((cell) => ({ ...cell }));
      sim.snakes[1].segments = p2;
      sim.snakes[1].previousSegments = p2.map((cell) => ({ ...cell }));
      expect(sim.snakes[0].segments).toHaveLength(15);
      expect(sim.snakes[1].segments).toHaveLength(15);

      // Every apple slot is emptied to force placement to run from scratch on every one of them, every tick.
      for (let i = 0; i < SETTINGS.foodCount; i += 1) sim.food.clear(i);

      const dt = 1 / SETTINGS.simHz;
      expect(() => {
        while (sim.phase === PHASES.PLAYING) sim.advance(dt);
      }).not.toThrow();

      // `foodCount` is a target, not an invariant, in this state (`§2.3`) — but nothing illegal appeared.
      expect(sim.food.getApples().length).toBeLessThanOrEqual(SETTINGS.foodCount);
      for (const apple of sim.food.getApples()) {
        expect(sim.lasers.inDeadZone(apple)).toBe(false);
      }
      expect(sim.endReason).toBe(END_REASONS.TIMEOUT);
    });

    it('KS-04-01 AC4: an empty slot is refilled on the tick a legal cell appears', () => {
      const sim = frozenRound();
      runTo(sim, SETTINGS.roundDuration - 4);

      // Fill the whole 6x6 safe square with one snake, so no apple can be placed at any head distance.
      /** @type {Cell[]} */
      const wall = [];
      for (let x = 9; x < 15; x += 1) {
        for (let y = 9; y < 15; y += 1) wall.push({ x, y });
      }
      sim.snakes[0].segments = wall;
      sim.snakes[0].previousSegments = wall.map((cell) => ({ ...cell }));
      for (let i = 0; i < SETTINGS.foodCount; i += 1) sim.food.clear(i);

      expect(sim.advance(1 / SETTINGS.simHz)).toEqual([]);
      expect(sim.food.getApples()).toEqual([]);

      // Free one cell and the retry that runs every tick picks it up immediately.
      sim.snakes[0].segments = wall.slice(1);
      const events = sim.advance(1 / SETTINGS.simHz);
      expect(only(events, EVENTS.FOOD_SPAWNED)).toHaveLength(1);
      expect(sim.food.getApples()).toEqual([{ x: 9, y: 9 }]);
    });
  });

  describe('AC5 the clock still decides at 0:00', () => {
    it('KS-04-01 AC5: after STOPPED, the longer snake wins at 0:00', () => {
      const sim = frozenRound();
      sim.snakes[0].segments.push({ x: 21, y: 20 }, { x: 21, y: 21 });

      runTo(sim, SETTINGS.roundDuration - 1);
      expect(sim.lasers.phase).toBe(LASER_PHASES.STOPPED);
      expect(sim.snakes.every((snake) => snake.alive)).toBe(true);
      expect(sim.phase).toBe(PHASES.PLAYING);

      const events = runTo(sim, SETTINGS.roundDuration);
      const over = only(events, EVENTS.ROUND_OVER)[0];

      expect(over).toMatchObject({
        result: RESULTS.P1_WIN,
        reason: END_REASONS.TIMEOUT,
        winnerId: 'p1',
        lengths: [6, 4],
      });
      expect(sim.tick).toBe(SETTINGS.roundDuration * SETTINGS.simHz);
    });

    it('KS-04-01 AC5: equal lengths at 0:00 after the lasers have stopped are a DRAW', () => {
      const sim = frozenRound();
      const events = runTo(sim, SETTINGS.roundDuration);
      const over = only(events, EVENTS.ROUND_OVER)[0];

      expect(sim.lasers.phase).toBe(LASER_PHASES.STOPPED);
      expect(over).toMatchObject({ result: RESULTS.DRAW, reason: END_REASONS.TIMEOUT });
    });
  });

  describe('the golden laser timeline', () => {
    it('KS-04-01 QA: a no-input round with immortal snakes replays event-for-event', () => {
      // `powerUpsEnabled: false` (KS-06-01 declared deviation, narrower than an earlier draft of this same
      // fix): unlike the four `tests/sim/replays/laser-*.json` fixtures, this is a full 90 s round under the
      // *default* settings, where power-ups spawning at 75/60/45 s remaining is correct, real behaviour —
      // not the short-round threshold bug KS-06-01's tech-lead review found and fixed in `powerups.js`'s
      // `updateSpawns` guard. `GOLDEN_LASER_ROUND` was recorded before Sprint 06 existed, so only this one
      // call site keeps power-ups off to keep matching it, rather than the whole file defaulting to it —
      // every other test below still runs `frozenRound()`'s real, unmodified `powerUpsEnabled: true` default.
      const sim = frozenRound({ snakeSpeed: SETTINGS.snakeSpeed, powerUpsEnabled: false });
      const events = [...sim.events, ...runTo(sim, SETTINGS.roundDuration)];

      expect(events).toEqual(GOLDEN_LASER_ROUND.events);
    });

    it('KS-04-01 QA: godMode is ignored unless the settings ask for it', () => {
      const mortal = new RoundSimulation({ settings: SETTINGS, seed: 1, players: TWO_PLAYERS });
      expect(mortal.godMode).toBe(false);
      // And it is not in the shipping defaults at all, so nothing can switch it on by accident.
      expect('godMode' in SETTINGS).toBe(false);
    });
  });
});
