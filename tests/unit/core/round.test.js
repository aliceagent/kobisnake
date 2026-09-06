// @ts-check
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { RoundSimulation } from '../../../src/core/round.js';
import { END_REASONS, EVENTS, PHASES, RESULTS } from '../../../src/core/events.js';
import { CAUSES } from '../../../src/core/collisions.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/** @typedef {import('../../../src/core/round.js').SimEvent} SimEvent */
/** @typedef {import('../../../src/core/grid.js').Direction} Direction */

const GOLDEN_NO_INPUT_ROUND = JSON.parse(
  readFileSync(new URL('./__golden__/no-input-round.json', import.meta.url), 'utf8'),
);

const TWO_PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {import('../../../src/core/settings.js').Settings} [options.settings]
 * @param {'match' | 'practice'} [options.mode]
 * @param {{id: string, color?: string}[]} [options.players]
 * @returns {RoundSimulation}
 */
function makeRound({ seed = 1, settings = SETTINGS, mode = 'match', players = TWO_PLAYERS } = {}) {
  return new RoundSimulation({ settings, seed, players, mode });
}

/**
 * Runs a round to its end, one simulation tick at a time, and returns every event including the ones the
 * constructor produced.
 *
 * @param {RoundSimulation} sim
 * @param {{inputs?: {t: number, player: string, dir: Direction}[], maxTicks?: number}} [options]
 * @returns {SimEvent[]}
 */
function runToEnd(sim, { inputs = [], maxTicks = 20000 } = {}) {
  const dt = 1 / sim.settings.simHz;
  const pending = [...inputs].sort((a, b) => a.t - b.t);
  const events = [...sim.events];
  for (let i = 0; i < maxTicks && sim.phase === PHASES.PLAYING; i += 1) {
    while (pending.length > 0 && pending[0].t <= sim.elapsed) {
      const input = /** @type {{t: number, player: string, dir: Direction}} */ (pending.shift());
      sim.applyInput(input.player, input.dir);
    }
    events.push(...sim.advance(dt));
  }
  return events;
}

describe('KS-02-05 RoundSimulation', () => {
  describe('AC1 the no-input round', () => {
    it('KS-02-05 AC1: P1 reaches x=23 on its 18th step and dies on its 19th into the wall at x=24', () => {
      const sim = makeRound();
      const dt = 1 / SETTINGS.simHz;
      const ticksPerStep = SETTINGS.simHz / SETTINGS.snakeSpeed; // 20

      for (let step = 1; step <= 18; step += 1) {
        for (let i = 0; i < ticksPerStep; i += 1) sim.advance(dt);
        expect(sim.snakes[0].head).toEqual({ x: 5 + step, y: 12 });
        expect(sim.snakes[0].alive).toBe(true);
      }
      expect(sim.snakes[0].head).toEqual({ x: 23, y: 12 });
      expect(sim.phase).toBe(PHASES.PLAYING);

      const events = sim.advance(dt * ticksPerStep);
      const died = events.filter((event) => event.type === EVENTS.SNAKE_DIED);
      expect(died).toHaveLength(2);
      expect(died[0]).toMatchObject({ snakeId: 'p1', cause: CAUSES.WALL, cell: { x: 24, y: 12 } });
    });

    it('KS-02-05 AC1: P2 mirrors it into x=-1', () => {
      const sim = makeRound();
      runToEnd(sim);
      expect(sim.snakes[1].segments[0]).toEqual({ x: 0, y: 11 });
      // (0, 11) is where P2 stopped; the cell that killed it is one further left.
    });

    it('KS-02-05 AC1: both die on the same step at t = 19/6 s, and the round is a DRAW', () => {
      const sim = makeRound();
      const events = runToEnd(sim);
      const died = events.filter((event) => event.type === EVENTS.SNAKE_DIED);

      expect(died).toHaveLength(2);
      expect(died[0].tick).toBe(died[1].tick);
      // 19 steps x 20 ticks per step = tick 380, which is 19/6 s at 120 Hz.
      expect(died[0].tick).toBe(380);
      expect(died[0].t).toBeCloseTo(19 / 6, 12);
      expect(sim.result).toBe(RESULTS.DRAW);
      expect(sim.endReason).toBe(END_REASONS.DEATH);
      expect(sim.winnerId).toBeNull();
    });

    it('KS-02-05 AC1: the event log matches the golden file exactly', () => {
      // `tests/unit/core/__golden__/no-input-round.json` is the reference every later determinism test is
      // measured against. It is committed, not generated at test time: if a change to placement, stepping or
      // event payloads shifts this log, that shows up here as a diff rather than as a quietly moving target.
      const sim = makeRound();
      expect(runToEnd(sim)).toEqual(GOLDEN_NO_INPUT_ROUND);
    });

    it('KS-02-05 AC1: the golden log agrees with the Python design spike', () => {
      // docs/design/spikes/design-validation-sim.py records this round as DRAW, causes WALL/WALL, at
      // t = 3.167 s. The engine and the model the design numbers were validated against must not disagree.
      const deaths = GOLDEN_NO_INPUT_ROUND.filter(
        (/** @type {SimEvent} */ event) => event.type === EVENTS.SNAKE_DIED,
      );
      expect(deaths.map((/** @type {SimEvent} */ event) => event.cause)).toEqual([
        CAUSES.WALL,
        CAUSES.WALL,
      ]);
      expect(Number(deaths[0].t).toFixed(3)).toBe('3.167');
      const over = GOLDEN_NO_INPUT_ROUND[GOLDEN_NO_INPUT_ROUND.length - 1];
      expect(over.type).toBe(EVENTS.ROUND_OVER);
      expect(over.result).toBe(RESULTS.DRAW);
    });
  });

  describe('AC2 same seed and inputs give the same round', () => {
    /**
     * A deterministic pseudo-input log for a seed: turns often enough to keep the snakes alive past the
     * first wall and to make them eat, so the log under test is not four spawns and two deaths.
     *
     * @param {number} seed
     * @returns {{t: number, player: string, dir: Direction}[]}
     */
    function inputLogFor(seed) {
      const dirs = [DIRECTIONS.UP, DIRECTIONS.RIGHT, DIRECTIONS.DOWN, DIRECTIONS.LEFT];
      const inputs = [];
      let x = seed;
      for (let i = 0; i < 60; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        inputs.push({
          t: (i * 0.21) % 12,
          player: (x & 1) === 0 ? 'p1' : 'p2',
          dir: dirs[(x >>> 8) % 4],
        });
      }
      return inputs;
    }

    it('KS-02-05 AC2: 100 seeds — same seed and input log give an identical event log', () => {
      for (let seed = 0; seed < 100; seed += 1) {
        const inputs = inputLogFor(seed);
        const first = runToEnd(makeRound({ seed }), { inputs });
        const second = runToEnd(makeRound({ seed }), { inputs });
        expect(second).toEqual(first);
      }
    });

    it('KS-02-05 AC2: 100 seeds — snapshots agree at every 0.5 s', () => {
      for (let seed = 0; seed < 100; seed += 1) {
        const inputs = inputLogFor(seed);
        expect(snapshotsEveryHalfSecond(seed, inputs)).toEqual(
          snapshotsEveryHalfSecond(seed, inputs),
        );
      }
    });

    it('KS-02-05 AC2: a different seed gives a different round', () => {
      // Determinism tests that only assert equality pass just as well on a simulation that ignores its seed.
      const logs = new Set();
      for (let seed = 0; seed < 20; seed += 1) {
        logs.add(JSON.stringify(runToEnd(makeRound({ seed }), { inputs: inputLogFor(7) })));
      }
      expect(logs.size).toBeGreaterThan(1);
    });

    /**
     * @param {number} seed
     * @param {{t: number, player: string, dir: Direction}[]} inputs
     * @returns {object[]}
     */
    function snapshotsEveryHalfSecond(seed, inputs) {
      const sim = makeRound({ seed });
      const dt = 1 / SETTINGS.simHz;
      const pending = [...inputs].sort((a, b) => a.t - b.t);
      const snapshots = [];
      let sinceSnapshot = 0;
      for (let i = 0; i < 20000 && sim.phase === PHASES.PLAYING; i += 1) {
        while (pending.length > 0 && pending[0].t <= sim.elapsed) {
          const input = /** @type {{t: number, player: string, dir: Direction}} */ (
            pending.shift()
          );
          sim.applyInput(input.player, input.dir);
        }
        sim.advance(dt);
        sinceSnapshot += 1;
        if (sinceSnapshot === SETTINGS.simHz / 2) {
          snapshots.push(sim.getState());
          sinceSnapshot = 0;
        }
      }
      snapshots.push(sim.getState());
      return snapshots;
    }
  });

  describe('AC3 the size of a dt does not change the round', () => {
    it('KS-02-05 AC3: advance(90) in one call and 10800 calls of advance(1/120) give identical logs', () => {
      const oneShot = makeRound({ seed: 4 });
      const oneShotEvents = [...oneShot.events, ...oneShot.advance(SETTINGS.roundDuration)];

      const ticked = makeRound({ seed: 4 });
      const tickedEvents = [...ticked.events];
      for (let i = 0; i < SETTINGS.roundDuration * SETTINGS.simHz; i += 1) {
        tickedEvents.push(...ticked.advance(1 / SETTINGS.simHz));
      }

      expect(tickedEvents).toEqual(oneShotEvents);
      expect(ticked.getState()).toEqual(oneShot.getState());
    });

    it('KS-02-05 AC3: a round that runs the full 90 s ticks exactly 10800 times', () => {
      // The arithmetic AC3 rests on: `dt * simHz` is accumulated in tick units, so 90 x 120 is exactly
      // 10 800 and one big call cannot land on a different tick from ten thousand small ones.
      // `godMode` (KS-04-01) is what "nobody can crash" now costs: from Sprint 04 a snake standing still
      // outside the shrinking safe square is killed by the beam that closes over it (DESIGN-DECISIONS
      // §2.4), so `snakeSpeed: 0` alone no longer guarantees the clock is the only way out. The rule this
      // test is about — 90 s is exactly 10 800 ticks — is untouched.
      const sim = makeRound({ seed: 4, settings: withOverrides({ snakeSpeed: 0, godMode: true }) });
      sim.advance(SETTINGS.roundDuration);
      expect(sim.tick).toBe(10800);
      expect(sim.endReason).toBe(END_REASONS.TIMEOUT);
    });

    it('KS-02-05 AC3: uneven dts land on the same ticks as even ones', () => {
      const even = makeRound({ seed: 9 });
      const evenEvents = [...even.events];
      for (let i = 0; i < 1200; i += 1) evenEvents.push(...even.advance(1 / 120));

      const uneven = makeRound({ seed: 9 });
      const unevenEvents = [...uneven.events];
      // A frame budget that never divides evenly into a tick — the shape of a real 60 Hz display.
      for (let i = 0; i < 600; i += 1) unevenEvents.push(...uneven.advance(1 / 60));

      expect(unevenEvents).toEqual(evenEvents);
      expect(uneven.tick).toBe(even.tick);
    });

    it('KS-02-05 AC3: time does not pass once the round is over', () => {
      const sim = makeRound();
      runToEnd(sim);
      const after = sim.getState();
      expect(sim.advance(10)).toEqual([]);
      expect(sim.getState()).toEqual(after);
    });
  });

  describe('AC4 timeout', () => {
    /**
     * A round where nobody can crash: `snakeSpeed` 0 means no snake ever steps, and `godMode` (KS-04-01)
     * means the lasers cannot kill the two snakes where they stand — from Sprint 04 the beams close over
     * both spawn cells (DESIGN-DECISIONS §2.4), so speed 0 on its own would end this round by DEATH at
     * inset 6 instead of by the clock. With both, the only way out is the clock, which is the point of the
     * test. Lengths are set directly — the timeout rule reads length and nothing else.
     *
     * @param {number} p1Growth
     * @param {number} p2Growth
     */
    function timeoutRound(p1Growth, p2Growth) {
      const sim = makeRound({ seed: 2, settings: withOverrides({ snakeSpeed: 0, godMode: true }) });
      for (let i = 0; i < p1Growth; i += 1) sim.snakes[0].segments.push({ x: -50 - i, y: -50 });
      for (let i = 0; i < p2Growth; i += 1) sim.snakes[1].segments.push({ x: -50 - i, y: -60 });
      sim.advance(SETTINGS.roundDuration);
      return sim;
    }

    it('KS-02-05 AC4: with both alive at 0:00 the longer snake wins', () => {
      const p1Longer = timeoutRound(3, 0);
      expect(p1Longer.endReason).toBe(END_REASONS.TIMEOUT);
      expect(p1Longer.result).toBe(RESULTS.P1_WIN);
      expect(p1Longer.winnerId).toBe('p1');

      const p2Longer = timeoutRound(0, 3);
      expect(p2Longer.result).toBe(RESULTS.P2_WIN);
      expect(p2Longer.winnerId).toBe('p2');
    });

    it('KS-02-05 AC4: equal lengths at 0:00 are a DRAW', () => {
      const sim = timeoutRound(0, 0);
      expect(sim.result).toBe(RESULTS.DRAW);
      expect(sim.winnerId).toBeNull();
      expect(sim.endReason).toBe(END_REASONS.TIMEOUT);
    });

    it('KS-02-05 AC4: ROUND_OVER carries the result, the reason and both lengths', () => {
      const sim = timeoutRound(3, 0);
      const over = sim.events[sim.events.length - 1];
      expect(over).toMatchObject({
        type: EVENTS.ROUND_OVER,
        result: RESULTS.P1_WIN,
        reason: END_REASONS.TIMEOUT,
        winnerId: 'p1',
        lengths: [7, 4],
      });
    });

    it('KS-02-05 AC4: the timer counts simulated seconds, and hits 0 exactly at tick 10800', () => {
      const sim = makeRound({ seed: 2, settings: withOverrides({ snakeSpeed: 0, godMode: true }) });
      expect(sim.timeRemaining).toBe(SETTINGS.roundDuration);
      sim.advance(SETTINGS.roundDuration - 1);
      expect(sim.timeRemaining).toBeCloseTo(1, 12);
      expect(sim.phase).toBe(PHASES.PLAYING);
      sim.advance(1);
      expect(sim.tick).toBe(10800);
      expect(sim.timeRemaining).toBeCloseTo(0, 12);
      expect(sim.phase).toBe(PHASES.ROUND_OVER);
    });

    it('KS-02-05 AC4: practice mode has no timer and so never times out', () => {
      const sim = makeRound({ mode: 'practice', settings: withOverrides({ snakeSpeed: 0 }) });
      expect(sim.timeRemaining).toBeNull();
      sim.advance(SETTINGS.roundDuration * 3);
      expect(sim.phase).toBe(PHASES.PLAYING);
    });
  });

  describe('AC5 apple count', () => {
    it('KS-02-05 AC5: exactly foodCount apples exist at every tick of PLAYING', () => {
      // Snakes that eat: three seeds driven with an input log that keeps them alive long enough to collect.
      for (const seed of [11, 12, 13]) {
        const sim = makeRound({ seed });
        const dt = 1 / SETTINGS.simHz;
        let eaten = 0;
        for (let i = 0; i < 20000 && sim.phase === PHASES.PLAYING; i += 1) {
          steerTowardsNearestApple(sim);
          eaten += sim.advance(dt).filter((event) => event.type === EVENTS.FOOD_EATEN).length;
          expect(sim.food.apples).toHaveLength(SETTINGS.foodCount);
        }
        // The assertion above is only worth anything if apples were actually being consumed and replaced.
        expect(eaten).toBeGreaterThan(0);
      }
    });

    it('KS-02-05 AC5: every FOOD_EATEN is answered by a FOOD_SPAWNED for the same slot', () => {
      const sim = makeRound({ seed: 12 });
      const events = [];
      for (let i = 0; i < 20000 && sim.phase === PHASES.PLAYING; i += 1) {
        steerTowardsNearestApple(sim);
        events.push(...sim.advance(1 / SETTINGS.simHz));
      }
      const eaten = events.filter((event) => event.type === EVENTS.FOOD_EATEN);
      expect(eaten.length).toBeGreaterThan(0);
      for (const meal of eaten) {
        const replacement = events.find(
          (event) =>
            event.type === EVENTS.FOOD_SPAWNED &&
            event.index === meal.index &&
            event.tick === meal.tick,
        );
        expect(replacement).toBeDefined();
      }
    });

    it('KS-02-05 AC5: apples never spawn on a snake, and never within foodMinDistanceFromHead of a head', () => {
      const sim = makeRound({ seed: 12 });
      for (let i = 0; i < 20000 && sim.phase === PHASES.PLAYING; i += 1) {
        steerTowardsNearestApple(sim);
        for (const event of sim.advance(1 / SETTINGS.simHz)) {
          if (event.type !== EVENTS.FOOD_SPAWNED) continue;
          const cell = /** @type {{x: number, y: number}} */ (event.cell);
          for (const snake of sim.snakes) {
            if (!snake.alive) continue;
            for (const segment of snake.segments) {
              expect(segment).not.toEqual(cell);
            }
            const distance = Math.max(
              Math.abs(cell.x - snake.head.x),
              Math.abs(cell.y - snake.head.y),
            );
            expect(distance).toBeGreaterThanOrEqual(SETTINGS.foodMinDistanceFromHead);
          }
        }
      }
    });

    it('KS-02-05 AC5: eating grows the snake by growthPerFood', () => {
      const sim = makeRound({ seed: 12 });
      let lengthBefore = sim.snakes[0].segments.length;
      let grew = 0;
      for (let i = 0; i < 20000 && sim.phase === PHASES.PLAYING; i += 1) {
        steerTowardsNearestApple(sim);
        const ate = sim
          .advance(1 / SETTINGS.simHz)
          .some((event) => event.type === EVENTS.FOOD_EATEN && event.snakeId === 'p1');
        if (ate) grew += 1;
        expect(sim.snakes[0].segments.length).toBeLessThanOrEqual(
          lengthBefore + grew * SETTINGS.growthPerFood,
        );
      }
      expect(sim.snakes[0].segments.length).toBe(lengthBefore + grew * SETTINGS.growthPerFood);
      lengthBefore = 0;
    });
  });

  describe('AC6 getState is a plain snapshot', () => {
    it('KS-02-05 AC6: getState() is JSON-serialisable and survives a round trip unchanged', () => {
      const sim = makeRound();
      sim.advance(1.5);
      const state = sim.getState();
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });

    it('KS-02-05 AC6: getState() contains no functions and no class instances', () => {
      const sim = makeRound();
      sim.advance(1.5);
      const offenders = [];
      /**
       * @param {unknown} value
       * @param {string} path
       */
      function walk(value, path) {
        if (value === null) return;
        const type = typeof value;
        if (type === 'function') {
          offenders.push(`${path}: function`);
          return;
        }
        if (type !== 'object') return;
        if (Array.isArray(value)) {
          value.forEach((item, i) => walk(item, `${path}[${i}]`));
          return;
        }
        const proto = Object.getPrototypeOf(value);
        if (proto !== Object.prototype && proto !== null) {
          offenders.push(`${path}: ${/** @type {object} */ (value).constructor?.name}`);
          return;
        }
        for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
      }
      walk(sim.getState(), 'state');
      expect(offenders).toEqual([]);
    });

    it('KS-02-05 AC6: a snapshot is a copy — later ticks do not rewrite it', () => {
      const sim = makeRound();
      sim.advance(1);
      const before = sim.getState();
      const beforeJson = JSON.stringify(before);
      sim.advance(1);
      expect(JSON.stringify(before)).toBe(beforeJson);
      expect(sim.getState()).not.toEqual(before);
    });

    it('KS-02-05 AC6: the snapshot carries what a renderer interpolates from', () => {
      const sim = makeRound();
      sim.advance(0.1);
      const state = /** @type {any} */ (sim.getState());
      for (const snake of state.snakes) {
        // ARCHITECTURE §5: the renderer lerps segment i from previousSegments[i] to segments[i] by
        // stepProgress, so those three have to travel together and the arrays have to line up.
        expect(snake.previousSegments).toHaveLength(snake.segments.length);
        expect(snake.stepProgress).toBeGreaterThanOrEqual(0);
        expect(snake.stepProgress).toBeLessThan(1);
      }
      expect(state.snakes[0].color).toBe('red');
      expect(state.apples).toHaveLength(SETTINGS.foodCount);
      expect(state.lasers).toEqual({ phase: 'PARKED', inset: 0, insetCells: 0 });
      expect(state.powerUps).toEqual({ pickups: [] });
    });
  });

  describe('construction, input and modes', () => {
    it('KS-02-05: snakes spawn where DESIGN-DECISIONS §2.3 says, body behind the head', () => {
      const sim = makeRound();
      expect(sim.snakes[0].segments).toEqual([
        { x: 5, y: 12 },
        { x: 4, y: 12 },
        { x: 3, y: 12 },
        { x: 2, y: 12 },
      ]);
      expect(sim.snakes[0].direction).toBe(DIRECTIONS.RIGHT);
      expect(sim.snakes[1].segments).toEqual([
        { x: 18, y: 11 },
        { x: 19, y: 11 },
        { x: 20, y: 11 },
        { x: 21, y: 11 },
      ]);
      expect(sim.snakes[1].direction).toBe(DIRECTIONS.LEFT);
    });

    it('KS-02-05: the round opens with foodCount apples, each announced', () => {
      const sim = makeRound();
      expect(sim.food.apples).toHaveLength(SETTINGS.foodCount);
      expect(sim.events).toHaveLength(SETTINGS.foodCount);
      expect(sim.events.every((event) => event.type === EVENTS.FOOD_SPAWNED)).toBe(true);
    });

    it('KS-02-05: applyInput queues a turn for the named player only', () => {
      const sim = makeRound();
      expect(sim.applyInput('p1', DIRECTIONS.UP)).toBe(true);
      expect(sim.snakes[0].queue).toEqual([DIRECTIONS.UP]);
      expect(sim.snakes[1].queue).toEqual([]);
    });

    it('KS-02-05: applyInput ignores unknown players, dead snakes and finished rounds', () => {
      const sim = makeRound();
      expect(sim.applyInput('nobody', DIRECTIONS.UP)).toBe(false);
      // An illegal turn is still refused by the snake's own rules.
      expect(sim.applyInput('p1', DIRECTIONS.LEFT)).toBe(false);
      runToEnd(sim);
      // A key pressed a frame after the crash is ordinary, not an error.
      expect(sim.applyInput('p1', DIRECTIONS.UP)).toBe(false);
    });

    it('KS-02-05: practice mode allows a single snake, and its death ends the round with no result', () => {
      const sim = new RoundSimulation({
        seed: 3,
        players: [{ id: 'solo', color: 'green' }],
        mode: 'practice',
      });
      expect(sim.snakes).toHaveLength(1);
      const events = runToEnd(sim);
      expect(sim.phase).toBe(PHASES.ROUND_OVER);
      expect(sim.endReason).toBe(END_REASONS.DEATH);
      // Nobody to beat, so there is no P1_WIN to record. Inventing one would put a made-up rule in the log.
      expect(sim.result).toBeNull();
      expect(events[events.length - 1].type).toBe(EVENTS.ROUND_OVER);
    });

    it('KS-02-05: a single snake outside practice mode is refused', () => {
      expect(() => makeRound({ players: [{ id: 'solo' }] })).toThrow(RangeError);
    });

    it('KS-02-05: more players than there are spawn positions is refused', () => {
      expect(() => makeRound({ players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] })).toThrow(
        RangeError,
      );
    });

    it('KS-02-05: a death ends the round immediately, even with one snake still running', () => {
      // p1 is steered into the wall above it while p2 keeps going; the round stops on p1's crash.
      const sim = makeRound({ seed: 5 });
      sim.applyInput('p1', DIRECTIONS.UP);
      const events = runToEnd(sim);
      const died = events.filter((event) => event.type === EVENTS.SNAKE_DIED);
      expect(died).toHaveLength(1);
      expect(died[0].snakeId).toBe('p1');
      expect(sim.result).toBe(RESULTS.P2_WIN);
      expect(sim.winnerId).toBe('p2');
      expect(sim.snakes[1].alive).toBe(true);
      expect(events[events.length - 1].type).toBe(EVENTS.ROUND_OVER);
    });

    it('KS-02-05: a player with no colour chosen yet snapshots as null, not undefined', () => {
      // `undefined` disappears through JSON.stringify, which would make the snapshot lose a key rather than
      // report an empty one — AC6 says the state is JSON-serialisable, and that has to survive a round trip.
      const sim = new RoundSimulation({
        seed: 8,
        players: [{ id: 'p1' }, { id: 'p2' }],
      });
      const state = /** @type {any} */ (sim.getState());
      expect(state.snakes[0].color).toBeNull();
      expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    });

    it('KS-02-05: the laser seam reports LASER, not WALL, for a dead-zone cell', () => {
      // Written in Sprint 02 against a hand-made stub, to prove the wiring the real laser system would plug
      // into. Sprint 04 built that system, so the stub is gone and the same assertion now runs against it:
      // the inset is moved to 1 directly instead of waiting 65 simulated seconds for the schedule to do it,
      // which leaves x=23 inside the arena but inside the dead zone. It must kill, and say LASER.
      const sim = makeRound({ seed: 8 });
      sim.lasers.inset = 1;
      const events = runToEnd(sim);
      const died = events.filter((event) => event.type === EVENTS.SNAKE_DIED);
      expect(died[0]).toMatchObject({ snakeId: 'p1', cause: CAUSES.LASER, cell: { x: 23, y: 12 } });
    });

    it('KS-02-05: a dead snake stops reserving cells from food placement', () => {
      // Reachable in a real round: deaths are applied before survivors commit and eat, so a snake can
      // collect an apple on the very tick its opponent crashes.
      const sim = makeRound({ seed: 8 });
      const before = sim.occupiedCells().size;
      sim.snakes[1].alive = false;
      expect(sim.occupiedCells().size).toBe(before - SETTINGS.startingSnakeLength);
      expect(sim.heads()).toHaveLength(1);
    });

    it('KS-02-05: the power-up hook is inert, and a round decided before 0:30 sees no laser event', () => {
      // The power-up half is still Sprint 06's stub. The laser half changed meaning in Sprint 04: the
      // system is real now, and what this asserts is the other half of the timeline — a round that ends
      // long before `laserStartTime` never hears from it. Seed 6 is a no-input round, over at 3.167 s.
      const sim = makeRound({ seed: 6 });
      const events = runToEnd(sim);
      const laserOrPowerUp = events.filter((event) =>
        [
          EVENTS.LASER_WARNING,
          EVENTS.LASER_STEP,
          EVENTS.POWERUP_SPAWNED,
          EVENTS.POWERUP_COLLECTED,
          EVENTS.EFFECT_STARTED,
          EVENTS.EFFECT_ENDED,
        ].includes(/** @type {never} */ (event.type)),
      );
      expect(laserOrPowerUp).toEqual([]);
      expect(sim.lasers.insetCells).toBe(0);
      expect(sim.snakes.every((snake) => snake.speedMultiplier === 1)).toBe(true);
    });
  });
});

/**
 * Steers every living snake one step towards the nearest apple, avoiding the obviously fatal turn. Not a
 * bot — `tests/sim/bots/` is KS-02-06's — just enough steering to make a snake eat, so the food tests are
 * exercised by rounds where apples are actually collected.
 *
 * @param {RoundSimulation} sim
 */
function steerTowardsNearestApple(sim) {
  for (const snake of sim.snakes) {
    if (!snake.alive) continue;
    const head = snake.head;
    const apples = sim.food.apples;
    if (apples.length === 0) continue;
    let target = apples[0];
    for (const apple of apples) {
      const best = Math.abs(target.x - head.x) + Math.abs(target.y - head.y);
      if (Math.abs(apple.x - head.x) + Math.abs(apple.y - head.y) < best) target = apple;
    }
    const wanted =
      target.x !== head.x
        ? target.x > head.x
          ? DIRECTIONS.RIGHT
          : DIRECTIONS.LEFT
        : target.y > head.y
          ? DIRECTIONS.UP
          : DIRECTIONS.DOWN;
    sim.applyInput(snake.id, wanted);
  }
}
