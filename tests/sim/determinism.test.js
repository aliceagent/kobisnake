// @ts-check
import { describe, expect, it } from 'vitest';
import { RoundSimulation } from '../../src/core/round.js';
import { EVENTS, PHASES } from '../../src/core/events.js';
import { DIRECTIONS } from '../../src/core/grid.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * Whole-round determinism (`QA-STRATEGY §3`, KS-02-05 AC2/AC3). The unit tests in
 * `tests/unit/core/round.test.js` check the rules; these run complete rounds end to end and check the one
 * property everything else in the project leans on: **the same seed and the same input log always replay to
 * the same round**. Replays, the golden event log, e2e fast-forwarding and every later sprint's regression
 * test are only worth anything if that holds.
 *
 * `tests/sim/` runs under `npm run test:unit`; there is no separate runner (`CLAUDE.md`).
 */

/** @typedef {import('../../src/core/grid.js').Direction} Direction */
/** @typedef {{t: number, player: string, dir: Direction}} Input */

const DIRS = [DIRECTIONS.UP, DIRECTIONS.RIGHT, DIRECTIONS.DOWN, DIRECTIONS.LEFT];
const PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * A reproducible input log for a seed. Deliberately built from its own tiny LCG rather than from
 * `src/core/rng.js`: an input log recorded from a real game is external to the simulation, and a determinism
 * test that fed the simulation's own generator back into it would be testing a smaller claim.
 *
 * @param {number} seed
 * @param {number} [count]
 * @returns {Input[]}
 */
function inputLog(seed, count = 120) {
  /** @type {Input[]} */
  const inputs = [];
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < count; i += 1) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    inputs.push({
      t: (i * 0.17) % 20,
      player: (x & 1) === 0 ? 'p1' : 'p2',
      dir: DIRS[(x >>> 9) % 4],
    });
  }
  return inputs.sort((a, b) => a.t - b.t);
}

/**
 * Runs a whole round with an input log, returning the event log, the snapshots taken every 0.5 s and the
 * final state.
 *
 * @param {number} seed
 * @param {Input[]} inputs
 * @param {number} [dt] - the step size to drive the round with
 * @returns {{events: object[], snapshots: object[], final: object}}
 */
function playRound(seed, inputs, dt = 1 / SETTINGS.simHz) {
  const sim = new RoundSimulation({ seed, players: PLAYERS });
  const pending = [...inputs];
  const events = [...sim.events];
  const snapshots = [];
  let nextSnapshotAt = 0.5;

  let guard = 0;
  while (sim.phase === PHASES.PLAYING && guard < 200000) {
    guard += 1;
    while (pending.length > 0 && pending[0].t <= sim.elapsed) {
      const input = /** @type {Input} */ (pending.shift());
      sim.applyInput(input.player, input.dir);
    }
    events.push(...sim.advance(dt));
    while (sim.elapsed >= nextSnapshotAt) {
      snapshots.push(sim.getState());
      nextSnapshotAt += 0.5;
    }
  }
  return { events, snapshots, final: sim.getState() };
}

/**
 * The same round, but with every input delivered on the tick its timestamp names, whatever `dt` the caller
 * uses: each `advance` call is cut short at the next input's tick, so no call ever steps past one. This is
 * what a replay harness does (`QA-STRATEGY §3`) and what makes "the step size does not change the round"
 * true even with inputs in play.
 *
 * @param {number} seed
 * @param {Input[]} inputs
 * @param {number} dt
 * @returns {{events: object[], final: object}}
 */
function playRoundWithAlignedInputs(seed, inputs, dt) {
  const sim = new RoundSimulation({ seed, players: PLAYERS });
  const pending = inputs.map((input) => ({
    ...input,
    tick: Math.round(input.t * SETTINGS.simHz),
  }));
  const events = [...sim.events];
  const ticksPerCall = dt * SETTINGS.simHz;

  let guard = 0;
  while (sim.phase === PHASES.PLAYING && guard < 200000) {
    guard += 1;
    while (pending.length > 0 && pending[0].tick <= sim.tick) {
      const input = /** @type {Input & {tick: number}} */ (pending.shift());
      sim.applyInput(input.player, input.dir);
    }
    const ticksUntilNextInput =
      pending.length > 0 ? pending[0].tick - sim.tick : Number.POSITIVE_INFINITY;
    const chunk = Math.min(ticksPerCall, ticksUntilNextInput);
    events.push(...sim.advance(chunk / SETTINGS.simHz));
  }
  return { events, final: sim.getState() };
}

describe('KS-02-05 whole-round determinism', () => {
  it('KS-02-05 AC2: 100 seeds — same seed and input log give an identical event log and identical 0.5 s snapshots', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const inputs = inputLog(seed);
      const first = playRound(seed, inputs);
      const second = playRound(seed, inputs);
      expect(second.events).toEqual(first.events);
      expect(second.snapshots).toEqual(first.snapshots);
      expect(second.final).toEqual(first.final);
    }
  });

  it('KS-02-05 AC2: 100 seeds — every round actually ends, and the log ends with ROUND_OVER', () => {
    // Guards the test above from passing vacuously: two empty logs are also identical.
    for (let seed = 0; seed < 100; seed += 1) {
      const { events, final } = playRound(seed, inputLog(seed));
      expect(/** @type {any} */ (final).phase).toBe(PHASES.ROUND_OVER);
      expect(events[events.length - 1].type).toBe(EVENTS.ROUND_OVER);
      expect(events.length).toBeGreaterThan(SETTINGS.foodCount);
    }
  });

  it('KS-02-05 AC2: a different seed changes the round even with the same inputs', () => {
    const inputs = inputLog(1);
    const logs = new Set();
    for (let seed = 0; seed < 25; seed += 1) {
      logs.add(JSON.stringify(playRound(seed, inputs).events));
    }
    expect(logs.size).toBeGreaterThan(1);
  });

  it('KS-02-05 AC2: a different input log changes the round even with the same seed', () => {
    const logs = new Set();
    for (let variant = 0; variant < 25; variant += 1) {
      logs.add(JSON.stringify(playRound(3, inputLog(variant)).events));
    }
    expect(logs.size).toBeGreaterThan(1);
  });

  it('KS-02-05 AC3: 20 seeds — the step size the caller uses does not change the round', () => {
    // A real frame is never a whole number of simulation ticks. 1/60 s, 1/50 s and 1/30 s must land on
    // exactly the same ticks as 1/120 s, or a player on a 50 Hz display would be playing a different game.
    for (let seed = 0; seed < 20; seed += 1) {
      const fine = playRound(seed, [], 1 / SETTINGS.simHz);
      for (const dt of [1 / 60, 1 / 50, 1 / 30, 0.1]) {
        const coarse = playRound(seed, [], dt);
        expect(coarse.events).toEqual(fine.events);
        expect(coarse.final).toEqual(fine.final);
      }
    }
  });

  it('KS-02-05 AC3: a coarser frame moves when an input lands, not how the round runs', () => {
    // Worth stating plainly, because it looks like a determinism failure and is not. An input is delivered
    // at a frame boundary, so at 1/30 s a key pressed "at t = 0.31" is applied on the tick that begins the
    // frame containing it, not the one 1/120 s would have chosen. The rounds then legitimately diverge —
    // the *inputs* differ, not the simulation. This is exactly what the two-deep input buffer of
    // DESIGN-DECISIONS §2.2 exists to smooth over, and it is why replays record a tick, not a wall-clock
    // time. What must hold is the other direction: the same inputs on the same ticks give the same round,
    // whatever dt carried them there.
    let divergedAtLeastOnce = false;
    for (let seed = 0; seed < 20; seed += 1) {
      const inputs = inputLog(seed);
      // Delivered at frame boundaries, a coarser frame can shift an input onto a later tick. It does not
      // always — plenty of inputs are ignored by the queue rules anyway — so the claim is that it happens,
      // not that it happens every time.
      if (
        JSON.stringify(playRound(seed, inputs, 1 / 30).final) !==
        JSON.stringify(playRound(seed, inputs, 1 / SETTINGS.simHz).final)
      ) {
        divergedAtLeastOnce = true;
      }

      // Same inputs on the same ticks, different dt: identical rounds, every time. This is the property
      // replays rely on, and it holds for all 20 seeds.
      const alignedFine = playRoundWithAlignedInputs(seed, inputs, 1 / SETTINGS.simHz);
      for (const dt of [1 / 60, 1 / 30]) {
        const alignedCoarse = playRoundWithAlignedInputs(seed, inputs, dt);
        expect(alignedCoarse.events).toEqual(alignedFine.events);
        expect(alignedCoarse.final).toEqual(alignedFine.final);
      }
    }
    expect(divergedAtLeastOnce).toBe(true);
  });

  it('KS-02-05 AC3: one advance(90) matches 10800 advance(1/120) with no inputs', () => {
    const oneShot = new RoundSimulation({ seed: 42, players: PLAYERS });
    const oneShotEvents = [...oneShot.events, ...oneShot.advance(SETTINGS.roundDuration)];

    const ticked = new RoundSimulation({ seed: 42, players: PLAYERS });
    const tickedEvents = [...ticked.events];
    for (let i = 0; i < SETTINGS.roundDuration * SETTINGS.simHz; i += 1) {
      tickedEvents.push(...ticked.advance(1 / SETTINGS.simHz));
    }

    expect(tickedEvents).toEqual(oneShotEvents);
    expect(ticked.getState()).toEqual(oneShot.getState());
  });

  it('KS-02-05: a living snake never has two segments in the same cell', () => {
    // The property from the sprint QA plan, asserted across whole rounds: a snapshot showing a living snake
    // overlapping itself is a blocker, because it means a step wrote a segment somewhere it should not be.
    for (let seed = 0; seed < 40; seed += 1) {
      for (const snapshot of playRound(seed, inputLog(seed)).snapshots) {
        for (const snake of /** @type {any} */ (snapshot).snakes) {
          if (!snake.alive) continue;
          const keys = snake.segments.map(
            (/** @type {{x: number, y: number}} */ c) => `${c.x},${c.y}`,
          );
          expect(new Set(keys).size).toBe(keys.length);
        }
      }
    }
  });

  it('KS-02-05: a living snake never gets shorter', () => {
    // The other sprint QA-plan property: segments are only ever added, never removed, so a length that goes
    // down means a step dropped a tail it still owed.
    for (let seed = 0; seed < 40; seed += 1) {
      /** @type {Record<string, number>} */
      const longest = {};
      for (const snapshot of playRound(seed, inputLog(seed)).snapshots) {
        for (const snake of /** @type {any} */ (snapshot).snakes) {
          if (!snake.alive) continue;
          const previous = longest[snake.id] ?? 0;
          expect(snake.length).toBeGreaterThanOrEqual(previous);
          longest[snake.id] = snake.length;
        }
      }
    }
  });
});
