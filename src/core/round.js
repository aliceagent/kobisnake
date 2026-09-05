// @ts-check
import { CAUSES, resolveStep } from './collisions.js';
import { END_REASONS, EVENTS, PHASES, RESULTS } from './events.js';
import { FoodState } from './food.js';
import { DIRECTIONS, cellKey, inBounds } from './grid.js';
import { createInactive as createInactiveLasers } from './lasers.js';
import { createInactive as createInactivePowerUps } from './powerups.js';
import { createRng } from './rng.js';
import { SETTINGS } from './settings.js';
import { Snake } from './snake.js';

/**
 * One round of KOBI Snake, whole and headless (`ARCHITECTURE §4`).
 *
 * `advance(dt)` is the only way time passes here. Everything else — renderer, audio, UI, the game loop — sits
 * outside and reacts to the events `advance` returns or reads the snapshot `getState()` hands back. Nothing
 * in this file touches the DOM or three.js, which is what lets a whole 90-second round run in a unit test in
 * milliseconds.
 *
 * Determinism is the property the rest of the sprint is built on: the same seed and the same input log
 * produce the same event log, tick for tick. Two things buy it. Every random draw goes through the seeded
 * `rng`, and time is counted in whole ticks rather than accumulated seconds — see {@link RoundSimulation#advance}.
 */

/** @typedef {import('./grid.js').Cell} Cell */
/** @typedef {import('./grid.js').Direction} Direction */
/** @typedef {import('./settings.js').Settings} Settings */
/** @typedef {import('./collisions.js').DeathCause} DeathCause */
/** @typedef {import('./events.js').EventType} EventType */
/** @typedef {import('./events.js').RoundResult} RoundResult */
/** @typedef {import('./events.js').EndReason} EndReason */
/** @typedef {import('./events.js').Phase} Phase */

/** @typedef {{type: EventType, tick: number, t: number, [key: string]: unknown}} SimEvent */
/** @typedef {{id: string, color?: string}} Player */

/**
 * Where each player starts and which way they face (`DESIGN-DECISIONS §2.3`). The rows are deliberately
 * offset — P1 on y=12, P2 on y=11 — so a straight charge from both sides is never an instant head-on.
 *
 * @type {{head: Cell, direction: Direction}[]}
 */
const SPAWNS = [
  { head: { x: 5, y: 12 }, direction: DIRECTIONS.RIGHT },
  { head: { x: 18, y: 11 }, direction: DIRECTIONS.LEFT },
];

/**
 * The body cells of a snake spawned at `head` facing `direction`: the body extends *behind* the head, so the
 * snake reads as already travelling rather than about to reverse.
 *
 * @param {Cell} head
 * @param {Direction} direction
 * @param {number} length
 * @returns {Cell[]}
 */
function spawnCells(head, direction, length) {
  return Array.from({ length }, (_, i) => ({
    x: head.x - direction.dx * i,
    y: head.y - direction.dy * i,
  }));
}

export class RoundSimulation {
  /**
   * @param {object} options
   * @param {Settings} [options.settings] - defaults to the shipping `SETTINGS`
   * @param {number} options.seed - every random draw in the round comes from this
   * @param {Player[]} options.players - one or two players; a single player is only legal in practice mode
   * @param {boolean} [options.powerUpsEnabled] - remembered for Sprint 06; nothing acts on it yet
   * @param {'match' | 'practice'} [options.mode] - practice has no round timer (`DESIGN-DECISIONS §5`)
   */
  constructor({ settings = SETTINGS, seed, players, powerUpsEnabled, mode = 'match' }) {
    if (players.length < 1 || players.length > SPAWNS.length) {
      throw new RangeError(`RoundSimulation: expected 1 or 2 players, got ${players.length}`);
    }
    if (players.length === 1 && mode !== 'practice') {
      throw new RangeError('RoundSimulation: a single-snake round is only legal in practice mode');
    }

    /** @type {Settings} */
    this.settings = settings;
    /** @type {number} */
    this.seed = seed;
    /** @type {'match' | 'practice'} */
    this.mode = mode;
    /** @type {import('./rng.js').Rng} */
    this.rng = createRng(seed);
    /** @type {Player[]} */
    this.players = players.map((player) => ({ id: player.id, color: player.color }));

    /** Whole simulation ticks elapsed. The clock is an integer, never a running float sum. @type {number} */
    this.tick = 0;
    /** Leftover fraction of a tick from the last `advance`, in tick units. @type {number} */
    this.tickAccumulator = 0;
    /** @type {Phase} */
    this.phase = PHASES.PLAYING;
    /** @type {RoundResult | null} */
    this.result = null;
    /** @type {EndReason | null} */
    this.endReason = null;
    /** @type {string | null} */
    this.winnerId = null;

    /** @type {Snake[]} */
    this.snakes = players.map((player, index) => {
      const spawn = SPAWNS[index];
      return new Snake({
        id: player.id,
        cells: spawnCells(spawn.head, spawn.direction, settings.startingSnakeLength),
        direction: spawn.direction,
        settings,
      });
    });

    this.lasers = createInactiveLasers();
    this.powerUps = createInactivePowerUps(powerUpsEnabled ?? settings.powerUpsEnabled);

    /** Events produced by the `advance` call in progress. @type {SimEvent[]} */
    this.events = [];

    this.food = new FoodState({ foodCount: settings.foodCount });
    this.food.fill({
      grid: settings.grid,
      occupied: this.occupiedCells(),
      heads: this.heads(),
      deadZone: this.lasers.inDeadZone,
      rng: this.rng,
      minDistance: settings.foodMinDistanceFromHead,
    });
    // The apples that are on the board when the round opens are announced like any other, so a view built
    // purely from the event stream sees the same board as one built from `getState()`.
    this.food.apples.forEach((cell, index) => {
      this.emit(EVENTS.FOOD_SPAWNED, { index, cell: { ...cell } });
    });
  }

  /** Seconds of simulated time per tick. @returns {number} */
  get tickDuration() {
    return 1 / this.settings.simHz;
  }

  /** Simulated seconds since the round began, derived from the integer tick count. @returns {number} */
  get elapsed() {
    return this.tick / this.settings.simHz;
  }

  /**
   * Simulated seconds left on the round clock, or `null` in practice mode, which has no timer
   * (`DESIGN-DECISIONS §5`). Derived from `tick` rather than decremented, so 10 800 small steps and one big
   * one agree exactly instead of drifting apart by a float epsilon.
   *
   * @returns {number | null}
   */
  get timeRemaining() {
    if (this.mode === 'practice') return null;
    return this.settings.roundDuration - this.elapsed;
  }

  /**
   * Advances the simulation by `dt` seconds of simulated time and returns everything that happened.
   *
   * Time is accumulated in **tick units**, not seconds: `dt * simHz` is added to a counter and whole ticks
   * are taken off it. That is what makes `advance(90)` and 10 800 calls of `advance(1/120)` produce byte-
   * identical logs (AC3). Accumulating seconds and subtracting `1/120` each time would not: `1/120` is not
   * representable in binary, so ten thousand subtractions drift, and the two paths would disagree on whether
   * a step falls on tick 10 800 or 10 801. In tick units, 90 × 120 is exactly 10 800 and subtracting 1.0 from
   * an integer-valued double is exact.
   *
   * @param {number} dt - seconds of simulated time; the caller clamps frame spikes (`ARCHITECTURE §5`)
   * @returns {SimEvent[]} the events this call produced, in the order they happened
   */
  advance(dt) {
    this.events = [];
    if (this.phase !== PHASES.PLAYING) {
      return this.events;
    }
    this.tickAccumulator += dt * this.settings.simHz;
    while (this.tickAccumulator >= 1 && this.phase === PHASES.PLAYING) {
      this.tickAccumulator -= 1;
      this.simulateTick();
    }
    return this.events;
  }

  /**
   * Queues a direction for a player (`DESIGN-DECISIONS §2.2`). Inputs for a dead snake, an unknown player or
   * a finished round are ignored rather than throwing: input arrives from a keyboard, and a key pressed a
   * frame after a crash is a normal thing to happen, not an error.
   *
   * @param {string} playerId
   * @param {Direction} dir
   * @returns {boolean} true when the input was queued
   */
  applyInput(playerId, dir) {
    if (this.phase !== PHASES.PLAYING) return false;
    const snake = this.snakes.find((candidate) => candidate.id === playerId);
    if (snake === undefined || !snake.alive) return false;
    return snake.queueDirection(dir);
  }

  /**
   * A plain, JSON-serialisable snapshot of everything a renderer or a test needs (AC6). Nothing here is a
   * class instance, a function or a live reference into the simulation — every cell is copied, so a caller
   * that keeps a snapshot around still holds what the board looked like at that moment.
   *
   * @returns {object}
   */
  getState() {
    return {
      seed: this.seed,
      mode: this.mode,
      tick: this.tick,
      elapsed: this.elapsed,
      timeRemaining: this.timeRemaining,
      phase: this.phase,
      result: this.result,
      winnerId: this.winnerId,
      endReason: this.endReason,
      snakes: this.snakes.map((snake, index) => ({
        id: snake.id,
        color: this.players[index].color ?? null,
        alive: snake.alive,
        length: snake.segments.length,
        direction: { dx: snake.direction.dx, dy: snake.direction.dy },
        segments: snake.segments.map((cell) => ({ x: cell.x, y: cell.y })),
        previousSegments: snake.previousSegments.map((cell) => ({ x: cell.x, y: cell.y })),
        stepProgress: snake.stepProgress,
        pendingGrowth: snake.pendingGrowth,
        speedMultiplier: snake.speedMultiplier,
      })),
      apples: this.food.getApples(),
      lasers: this.lasers.getState(),
      powerUps: this.powerUps.getState(),
    };
  }

  // --- internals -------------------------------------------------------------------------------------

  /**
   * One simulation tick, in the order the ticket fixes: the clock moves, every living snake accumulates,
   * the snakes that came due are resolved together, survivors commit their step and eat, and finally the
   * round clock is checked.
   *
   * Deaths are resolved from the pre-step picture and applied *before* any survivor commits, which is what
   * makes simultaneous steps symmetric (`ARCHITECTURE §4`).
   */
  simulateTick() {
    this.tick += 1;

    /** @type {Snake[]} */
    const due = [];
    for (const snake of this.snakes) {
      if (snake.alive && snake.accumulate(this.tickDuration)) {
        due.push(snake);
      }
    }
    if (due.length === 0) {
      this.checkTimeout();
      return;
    }

    const { deaths } = resolveStep({
      steppingSnakes: due,
      allSnakes: this.snakes,
      isDeadly: (cell) => this.deadlyCause(cell),
    });

    for (const death of deaths) {
      const snake = /** @type {Snake} */ (this.snakes.find((s) => s.id === death.snakeId));
      snake.alive = false;
      this.emit(EVENTS.SNAKE_DIED, {
        snakeId: death.snakeId,
        cause: death.cause,
        cell: snake.nextHeadCell(),
      });
    }

    for (const snake of due) {
      if (snake.alive) snake.commitStep();
    }
    for (const snake of due) {
      if (snake.alive) this.eatIfApple(snake);
    }

    if (deaths.length > 0) {
      // A death ends the round immediately (DESIGN-DECISIONS §2.5). The 0.25x slow-mo beat that follows is
      // the game loop's `timeScale`, not simulated time (ARCHITECTURE §5), so nothing here waits for it.
      this.endRound(END_REASONS.DEATH);
      return;
    }
    this.checkTimeout();
  }

  /**
   * Whether a cell kills a head entering it, and why. The arena edge is deadly from second 0
   * (`DESIGN-DECISIONS §1 row 9`); from Sprint 04 the same query also answers for the laser dead zone, which
   * is why `collisions.js` needs only one callback for both.
   *
   * @param {Cell} cell
   * @returns {DeathCause | false}
   */
  deadlyCause(cell) {
    if (!inBounds(cell, this.settings.grid)) return CAUSES.WALL;
    if (this.lasers.inDeadZone(cell)) return CAUSES.LASER;
    return false;
  }

  /**
   * Eats the apple under `snake`'s head, if there is one, and respawns it immediately at a random free cell
   * (`DESIGN-DECISIONS §1 row 19`). The respawn keeps the apple count at exactly `foodCount` at all times
   * (AC5), and happens inside the same tick so no frame ever renders three apples.
   *
   * @param {Snake} snake
   */
  eatIfApple(snake) {
    const index = this.food.indexAt(snake.head);
    if (index < 0) return;

    this.emit(EVENTS.FOOD_EATEN, { snakeId: snake.id, index, cell: { ...snake.head } });
    snake.grow(this.settings.growthPerFood);
    this.food.respawn(index, {
      grid: this.settings.grid,
      occupied: this.occupiedCells(),
      heads: this.heads(),
      deadZone: this.lasers.inDeadZone,
      rng: this.rng,
      minDistance: this.settings.foodMinDistanceFromHead,
    });
    this.emit(EVENTS.FOOD_SPAWNED, { index, cell: { ...this.food.apples[index] } });
  }

  /**
   * Ends the round at 0:00 if the clock has run out. Practice mode has no clock and so never times out.
   */
  checkTimeout() {
    const remaining = this.timeRemaining;
    if (remaining !== null && remaining <= 0) {
      this.endRound(END_REASONS.TIMEOUT);
    }
  }

  /**
   * Closes the round: works out who won, records it and emits `ROUND_OVER` as the last event.
   *
   * Both endings use the same rule, which is why they share this function. On a timeout the longer snake
   * wins and equal lengths draw (`DESIGN-DECISIONS §2.4`); on a death the survivor wins and nobody surviving
   * draws (`§2.5`). In both cases the winner is "the one snake still standing tallest", and a draw is what
   * happens when that does not pick out exactly one — which is the whole of row 7: a draw is replayed, never
   * scored.
   *
   * @param {EndReason} reason
   */
  endRound(reason) {
    this.phase = PHASES.ROUND_OVER;
    this.endReason = reason;

    const alive = this.snakes.filter((snake) => snake.alive);
    /** @type {Snake[]} */
    let winners;
    if (reason === END_REASONS.TIMEOUT) {
      const longest = Math.max(...alive.map((snake) => snake.segments.length));
      winners = alive.filter((snake) => snake.segments.length === longest);
    } else {
      winners = alive;
    }

    if (this.snakes.length === 1) {
      // A practice round with nobody to beat: it ended, and there is no result to record. Inventing a "win"
      // for surviving alone would put a made-up rule in the event log.
      this.result = null;
      this.winnerId = null;
    } else if (winners.length === 1) {
      this.winnerId = winners[0].id;
      this.result = this.snakes.indexOf(winners[0]) === 0 ? RESULTS.P1_WIN : RESULTS.P2_WIN;
    } else {
      this.winnerId = null;
      this.result = RESULTS.DRAW;
    }

    this.emit(EVENTS.ROUND_OVER, {
      result: this.result,
      reason,
      winnerId: this.winnerId,
      lengths: this.snakes.map((snake) => snake.segments.length),
    });
  }

  /**
   * Every cell any living snake occupies right now, as `cellKey` strings — what food placement must avoid.
   *
   * @returns {Set<string>}
   */
  occupiedCells() {
    /** @type {Set<string>} */
    const occupied = new Set();
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      for (const cell of snake.segments) occupied.add(cellKey(cell));
    }
    return occupied;
  }

  /**
   * The head cells of every living snake — apples must keep `foodMinDistanceFromHead` from all of them
   * (`DESIGN-DECISIONS §2.3`).
   *
   * @returns {Cell[]}
   */
  heads() {
    return this.snakes.filter((snake) => snake.alive).map((snake) => snake.head);
  }

  /**
   * Records an event against the current tick.
   *
   * @param {EventType} type
   * @param {Record<string, unknown>} payload
   */
  emit(type, payload) {
    this.events.push({ type, tick: this.tick, t: this.elapsed, ...payload });
  }
}
