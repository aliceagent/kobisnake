// @ts-check
import { describe, expect, it } from 'vitest';
import { CAUSES } from '../../src/core/collisions.js';
import { EVENTS, PHASES } from '../../src/core/events.js';
import { DIRECTIONS, addDir, isOpposite } from '../../src/core/grid.js';
import { createRng } from '../../src/core/rng.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * Adversarial fuzz over the seam KS-04-01 introduced: a laser step and a snake step can land on the same
 * tick, and the order in which they are applied decides whether the board is ever, even for one tick, in a
 * state `DESIGN-DECISIONS §2.4` says cannot exist (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-05).
 *
 * Three things make this a fuzz rather than a long test.
 *
 * 1. **The invariants are checked after every simulation tick**, not once at the end. A snapshot taken when
 *    the round is over cannot see a head that stood inside the dead zone for a tick before something else
 *    killed it, or an apple that spent one tick under a beam. Those are exactly the bugs an ordering mistake
 *    produces, and they are invisible to an end-state assertion.
 * 2. **The rounds have to reach the lasers.** Pure random play crashes into a wall inside four seconds and
 *    would exercise nothing this ticket is about. Each seed therefore drives both snakes with the cautious
 *    mover below at a seed-determined rate of random turns, and the test asserts that most seeds really did
 *    get to the closing phase — a coverage assertion on the fuzz itself, which fails the day the drivers
 *    stop producing rounds that survive to 0:30 and this suite quietly stops testing anything.
 * 3. **Everything is seeded**, so a failure is reproducible from its seed alone and can be minimised into a
 *    replay fixture (`tests/sim/replays/README.md`) rather than being a story about a run that once went red.
 *
 * The driver is deliberately local to this file rather than `tests/sim/bots/`. The bots there are design
 * instruments — KS-04-04 is changing `survivorBot` in this very sprint — and an adversary that shares them
 * would change what it covers whenever somebody tunes a bot. This one only has to keep snakes alive long
 * enough to be shot at.
 *
 * `expect` is called once, at the end, on a collected list. It is a Chai assertion behind a proxy and costs
 * roughly a microsecond; at twenty million ticks that alone is minutes of wall clock, so the hot loop uses
 * plain conditions and records violations instead. The failure message is built to name the seed and tick, so
 * a red run is still a reproduction recipe.
 */

/** @typedef {import('../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../src/core/snake.js').Snake} Snake */

const SEEDS = 2000;
const CARDINALS = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];
const TICKS_PER_STEP = Math.round(SETTINGS.simHz / SETTINGS.snakeSpeed);
/** The most steps the shipping settings can ever produce: `(24 − 6) / 2 = 9`. */
const MAX_STEPS = Math.ceil((SETTINGS.grid.width - SETTINGS.laserMinArena) / 2);

/**
 * How often this seed's snakes throw a random turn instead of playing safe: 0 %, 5 %, 10 %, 15 % or 20 %,
 * decided by the seed so every run covers both ends of the mix. At 0 % the round is two careful snakes and
 * reliably reaches the final 6 × 6, which is where a step-versus-step ordering bug would show. At 20 % it is
 * chaos that usually dies earlier, which is where a head walking *into* a freshly deadly cell gets hit
 * hardest.
 *
 * @param {number} seed
 * @returns {number}
 */
function chaosRate(seed) {
  return (seed % 5) * 0.05;
}

/**
 * Whether this seed's snakes deliberately hug the edge of the safe square — the ring the *next* laser step
 * will sweep. This is the adversary the sprint's QA plan asks for in so many words ("turn into a beam on the
 * exact frame it steps; sit on the boundary cell"): a snake standing on that ring is legal this tick and
 * dead the moment the beam moves, so hugging it maximises the number of ticks on which a laser step and a
 * snake step have to be resolved against each other. Every third seed.
 *
 * @param {number} seed
 * @returns {boolean}
 */
function hugsBoundary(seed) {
  return seed % 3 === 0;
}

/**
 * A cautious move: any direction that is not an immediate death, preferring the one with the most free
 * neighbours so the snake does not paint itself into a corner. Laser-aware, because a driver that walks into
 * the dead zone on purpose never survives to the interesting part of the round.
 *
 * @param {RoundSimulation} sim
 * @param {Snake} self
 * @param {import('../../src/core/rng.js').Rng} rng
 * @param {boolean} hug - prefer the ring the next laser step will sweep (see {@link hugsBoundary})
 * @returns {Direction | null}
 */
function cautiousMove(sim, self, rng, hug) {
  /** @param {Cell} cell */
  const safe = (cell) => {
    if (sim.lasers.isDeadly(cell)) return false;
    for (const snake of sim.snakes) {
      if (!snake.alive) continue;
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

  const { inset } = sim.lasers;
  /** The ring the next step will sweep: the outermost cells still inside the safe square. */
  const onNextRing = (/** @type {Cell} */ cell) =>
    cell.x === inset ||
    cell.y === inset ||
    cell.x === SETTINGS.grid.width - 1 - inset ||
    cell.y === SETTINGS.grid.height - 1 - inset;

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
    const score =
      free * 10 +
      (direction === self.direction ? 3 : 0) +
      (hug && onNextRing(next) ? 25 : 0) +
      rng.next();
    if (score > bestScore) {
      bestScore = score;
      best = direction;
    }
  }
  return best;
}

/**
 * One seeded round, driven to its end, with every invariant checked after every tick.
 *
 * @param {number} seed
 * @param {string[]} violations - appended to in place; each entry names the seed and tick
 * @returns {{steps: number, laserDeaths: number, causes: string[]}}
 */
function fuzzRound(seed, violations) {
  const sim = new RoundSimulation({
    settings: SETTINGS,
    seed,
    players: [{ id: 'p1' }, { id: 'p2' }],
  });
  const rng = createRng((seed ^ 0x9e3779b1) >>> 0);
  const rate = chaosRate(seed);
  const hug = hugsBoundary(seed);
  const dt = 1 / SETTINGS.simHz;

  let previousInset = 0;
  let steps = 0;
  let laserDeaths = 0;
  // Where every snake's head was *before* the tick, in preallocated scratch so the hot loop allocates
  // nothing. Invariant 6 needs it: by the time `advance` returns, a snake the beam closed over has already
  // taken its own step, and the laser step always lands on a tick a snake is due on — 300 ticks between
  // steps at 120 Hz, 20 ticks per snake step, and 20 divides 300. There is no tick on which the two do not
  // have to be resolved against each other, which is precisely why this ticket exists.
  const preAlive = sim.snakes.map(() => false);
  const preX = sim.snakes.map(() => 0);
  const preY = sim.snakes.map(() => 0);
  /** @type {string[]} */
  const causes = [];
  /** @param {string} what */
  const fail = (what) => violations.push(`seed ${seed}, tick ${sim.tick}: ${what}`);

  while (sim.phase === PHASES.PLAYING) {
    if (sim.tick % TICKS_PER_STEP === 0) {
      for (const snake of sim.snakes) {
        if (!snake.alive) continue;
        const direction =
          rng.next() < rate
            ? CARDINALS[rng.int(CARDINALS.length)]
            : cautiousMove(sim, snake, rng, hug);
        if (direction !== null) sim.applyInput(snake.id, direction);
      }
    }

    for (let i = 0; i < sim.snakes.length; i += 1) {
      preAlive[i] = sim.snakes[i].alive;
      preX[i] = sim.snakes[i].head.x;
      preY[i] = sim.snakes[i].head.y;
    }

    const events = sim.advance(dt);
    const { inset } = sim.lasers;

    // 1. `inset` is monotonic and never exceeds the nine steps the settings allow.
    if (inset < previousInset) fail(`inset went backwards, ${previousInset} -> ${inset}`);
    if (inset > MAX_STEPS) fail(`inset ${inset} is past the ${MAX_STEPS}-step maximum`);
    previousInset = inset;

    let stepped = false;
    for (let i = 0; i < events.length; i += 1) {
      const event = events[i];
      // 2. Never a tenth step, and every step announces the inset it produced.
      if (event.type === EVENTS.LASER_STEP) {
        stepped = true;
        steps += 1;
        if (steps > MAX_STEPS)
          fail(`LASER_STEP number ${steps} — there is no ${MAX_STEPS + 1}th step`);
        if (event.inset !== steps) fail(`LASER_STEP ${steps} announced inset ${event.inset}`);
      }
      // 3. A LASER death is always a head that really is in the dead zone, on this very tick — and can
      //    never happen at inset 0, where the deadly edge is the wall and `WALL` is the honest cause.
      if (event.type === EVENTS.SNAKE_DIED) {
        causes.push(/** @type {string} */ (event.cause));
        if (
          event.cause === CAUSES.LASER &&
          events.some((e) => e.type === EVENTS.LASER_STEP && e.tick === event.tick)
        )
          globalThis.__stepKills = (globalThis.__stepKills ?? 0) + 1;
        if (event.cause === CAUSES.LASER) {
          laserDeaths += 1;
          if (!sim.lasers.inDeadZone(/** @type {Cell} */ (event.cell))) {
            fail(`LASER death at ${JSON.stringify(event.cell)} is not in the dead zone`);
          }
          if (inset === 0) fail('LASER death while inset is 0 — that is a WALL mislabel');
        }
      }
    }

    // 4. No living head is inside the dead zone. This is the invariant the whole ticket is about: a beam
    //    that closes over a head kills it on the same tick, never leaves it standing in the fire.
    for (const snake of sim.snakes) {
      if (snake.alive && sim.lasers.inDeadZone(snake.head)) {
        fail(`living head ${snake.id} at ${JSON.stringify(snake.head)} is inside the dead zone`);
      }
    }

    // 5. No apple is inside the dead zone (`DESIGN-DECISIONS §2.4`: removed the moment a laser passes).
    const { apples } = sim.food;
    for (let i = 0; i < apples.length; i += 1) {
      const apple = apples[i];
      if (apple !== null && sim.lasers.inDeadZone(apple)) {
        fail(`apple ${i} at ${JSON.stringify(apple)} is inside the dead zone`);
      }
    }

    // 6. A head the beam closed over is dead, even though it also moved on that same tick. Invariant 4
    //    alone cannot see this: the snake takes its step inside the same `advance` call and a careful
    //    driver steps straight back out of the fire, so by the time the tick returns there is no living
    //    head in the dead zone and nothing looks wrong. `§2.4` is about where the head *was* when the beam
    //    arrived — "the head entering or being inside the dead zone when the laser steps onto it dies" —
    //    so that is what this checks, from the pre-tick position.
    if (stepped) {
      for (let i = 0; i < sim.snakes.length; i += 1) {
        if (!preAlive[i] || !sim.snakes[i].alive) continue;
        if (sim.lasers.inDeadZone({ x: preX[i], y: preY[i] })) {
          fail(
            `${sim.snakes[i].id} was at (${preX[i]}, ${preY[i]}) when the beam closed over it and is still alive`,
          );
        }
      }
    }

    if (violations.length > 0) break;
  }

  return { steps, laserDeaths, causes };
}

describe('KS-04-05 laser fuzz', () => {
  it(`KS-04-05 AC1: the laser invariants hold on every tick of ${SEEDS} seeded rounds`, () => {
    /** @type {string[]} */
    const violations = [];
    let reachedLasers = 0;
    let reachedFinalSquare = 0;
    let laserDeaths = 0;
    /** @type {Record<string, number>} */
    const byCause = {};
    const start = performance.now();

    for (let seed = 0; seed < SEEDS && violations.length === 0; seed += 1) {
      const round = fuzzRound(seed, violations);
      if (round.steps > 0) reachedLasers += 1;
      if (round.steps === MAX_STEPS) reachedFinalSquare += 1;
      laserDeaths += round.laserDeaths;
      for (const cause of round.causes) byCause[cause] = (byCause[cause] ?? 0) + 1;
    }

    console.log('STEP KILLS', globalThis.__stepKills ?? 0);
    const elapsed = (performance.now() - start) / 1000;
    console.log(
      `\nKS-04-05 fuzz: ${SEEDS} seeds in ${elapsed.toFixed(1)}s — ${reachedLasers} reached the laser ` +
        `phase, ${reachedFinalSquare} reached the final ${SETTINGS.laserMinArena}x${SETTINGS.laserMinArena}, ` +
        `${laserDeaths} deaths by laser. Deaths by cause: ${JSON.stringify(byCause)}`,
    );

    // The invariants. A violation names its seed and tick, so a red run is a reproduction recipe.
    expect(violations).toEqual([]);

    // Coverage of the fuzz itself: a run that never got near a beam would satisfy every invariant above and
    // prove nothing at all. This is not a design measurement and asserts no rate — only that the adversary
    // is still pointed at the thing it was written to attack.
    expect(reachedLasers).toBeGreaterThan(SEEDS / 5);
    expect(reachedFinalSquare).toBeGreaterThan(0);
    expect(laserDeaths).toBeGreaterThan(0);
  }, 600_000);
});
