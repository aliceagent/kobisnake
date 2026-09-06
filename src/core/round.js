// @ts-check
import { CAUSES, resolveStep } from './collisions.js';
import { END_REASONS, EVENTS, PHASES, RESULTS } from './events.js';
import { FoodState } from './food.js';
import { DIRECTIONS, cellKey, inBounds } from './grid.js';
import { createLasers } from './lasers.js';
import { POWERUP_TYPES, createPowerUps } from './powerups.js';
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
 * Whether this process is a test run. `import.meta.env.TEST` is Vitest's own flag; in a Vite production
 * build the key simply does not exist, so this is `false` there and {@link RoundSimulation}'s `godMode`
 * cannot be switched on by a hand-crafted settings object in a shipped game — which is the guard
 * KS-04-01's QA line asks for ("allowed only under `import.meta.env.TEST`"). It arrives as the *string*
 * `'true'` under Vitest (the flag is read out of the environment), hence the loose test rather than `===`.
 *
 * The optional chaining is not decoration: `import.meta.env` is added by Vite and by Vitest, and this module
 * is also imported straight into a plain Node process by `tests/e2e/first-playable.spec.js`, which runs the
 * headless engine beside the browser to compare them. There `import.meta.env` does not exist at all, and
 * reading `.TEST` off it would throw at import time. `import.meta` itself is never parenthesised, which is
 * what Vite's own replacement needs (see the same note in `src/main.js`).
 */
// @ts-expect-error import.meta.env is Vite's own addition; not present in this project's jsconfig types.
const UNDER_TEST = Boolean(import.meta.env?.TEST);

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
   * @param {boolean} [options.powerUpsEnabled] - defaults to `settings.powerUpsEnabled`; `false` means no
   *   `POWERUP_*` event is ever emitted and no random draw is ever made for one (`DESIGN-DECISIONS §1 row 20`)
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
    /**
     * The laser system's own clock, in whole ticks — `timeRemaining` unless the solo-SLOW rule is running
     * (KS-06-01 Ruling 1, `powerups.js` module doc). See {@link advanceLaserClock}.
     * @type {number}
     */
    this.laserClockTicks = 0;
    /** Fractional tick withheld from {@link laserClockTicks} so far, an integer count never a float sum.
     * @type {number} */
    this.laserClockCarry = 0;
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

    this.lasers = createLasers(settings);
    this.powerUps = createPowerUps({
      settings,
      enabled: powerUpsEnabled ?? settings.powerUpsEnabled,
      rng: this.rng,
    });

    /**
     * Test-only immortality (KS-04-01 QA). With it on, a snake that would die simply refuses the step that
     * would have killed it and stays where it is: nothing dies, no `SNAKE_DIED` is emitted, and the round
     * runs its full 90 seconds. That is what lets a golden log cover the *whole* laser timeline — a real
     * no-input round is over in 3.167 s, long before the lasers do anything. It is off unless the settings
     * ask for it **and** this is a test process; see {@link UNDER_TEST}.
     *
     * @type {boolean}
     */
    this.godMode = UNDER_TEST && settings.godMode === true;

    /** Events produced by the `advance` call in progress. @type {SimEvent[]} */
    this.events = [];

    this.food = new FoodState({ foodCount: settings.foodCount });
    this.food.fill(this.foodPlacement());
    // The apples that are on the board when the round opens are announced like any other, so a view built
    // purely from the event stream sees the same board as one built from `getState()`.
    this.food.apples.forEach((cell, index) => {
      if (cell !== null) this.emit(EVENTS.FOOD_SPAWNED, { index, cell: { ...cell } });
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
   * Seconds left on the **laser** clock — identical to {@link timeRemaining} unless the solo-SLOW rule
   * (`powerups.js`) is currently running, in which case it lags behind it (KS-06-01 AC5). Derived from
   * {@link laserClockTicks} the same way {@link timeRemaining} is derived from {@link tick}, so the two stay
   * bit-for-bit identical on every tick a round never runs the rule on — see {@link advanceLaserClock}.
   *
   * @returns {number | null}
   */
  get laserTimeRemaining() {
    if (this.mode === 'practice') return null;
    return this.settings.roundDuration - this.laserClockTicks / this.settings.simHz;
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
        effects: snake.effects.map((effect) => ({
          type: effect.type,
          remaining: effect.remainingTicks / this.settings.simHz,
          multiplier: effect.multiplier,
        })),
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

    // The lasers run off the round clock, not off anybody's movement, so they are advanced before the
    // snakes and on every tick — including the ticks on which nobody is due to step.
    this.updateLasers();
    if (this.phase !== PHASES.PLAYING) return;

    // Same reasoning for power-ups (DESIGN-DECISIONS §2.4): the spawn/despawn cycle is driven by the round
    // clock, not by movement, so it is checked every tick regardless of who steps. Unlike the laser clock,
    // this always reads the real `timeRemaining` — the solo-SLOW rule slows the lasers, never the power-up
    // schedule itself (`powerups.js` "Ruling 1").
    this.updatePowerUpSpawns();

    /** @type {Snake[]} */
    const due = [];
    for (const snake of this.snakes) {
      if (snake.alive && snake.accumulate(this.tickDuration)) {
        due.push(snake);
      }
    }
    if (due.length === 0) {
      // Nobody moved, but effect timers are sim time, not step count (DESIGN-DECISIONS §2.4: "Effects tick
      // in sim time and continue through LASER_WARNING and CLOSING") — they still tick down every tick.
      this.tickPowerUpEffects();
      this.checkTimeout();
      return;
    }

    const { deaths } = resolveStep({
      steppingSnakes: due,
      allSnakes: this.snakes,
      isDeadly: (cell) => this.deadlyCause(cell),
    });

    if (this.godMode) {
      // Immortal snakes refuse the fatal step instead of taking it: committing it would walk a head out of
      // bounds and every later query — food placement, the dead-zone test, the snapshot — would be reasoning
      // about a board position that cannot exist. Standing still is the only "did not die" that stays legal.
      const blocked = new Set(deaths.map((death) => death.snakeId));
      for (const snake of due) {
        if (!blocked.has(snake.id)) snake.commitStep();
      }
      for (const snake of due) {
        if (!blocked.has(snake.id)) this.eatIfApple(snake);
      }
      for (const snake of due) {
        if (!blocked.has(snake.id)) this.resolvePowerUpPickup(snake);
      }
      this.tickPowerUpEffects();
      this.checkTimeout();
      return;
    }

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
    for (const snake of due) {
      if (snake.alive) this.resolvePowerUpPickup(snake);
    }
    this.tickPowerUpEffects();

    if (deaths.length > 0) {
      // A death ends the round immediately (DESIGN-DECISIONS §2.5). The 0.25x slow-mo beat that follows is
      // the game loop's `timeScale`, not simulated time (ARCHITECTURE §5), so nothing here waits for it.
      this.endRound(END_REASONS.DEATH);
      return;
    }
    this.checkTimeout();
  }

  /**
   * Whether a cell kills a head entering it, and why — the single `isDeadly` callback `collisions.js` needs
   * for both the wall and the lasers (`ARCHITECTURE §4`).
   *
   * `lasers.isDeadly` answers the "is it fatal" half for both, because the wall is just inset −1: at inset 0
   * it is exactly "off the board", which is the arena edge being deadly from second 0
   * (`DESIGN-DECISIONS §1 row 9`). Only the *name* of the death depends on where the cell is, and only this
   * method knows both halves, which is why the mapping lives here: on the board with the lasers moved in, a
   * beam killed you; anywhere else it was the wall. At inset 0 the two coincide and `WALL` is the honest
   * answer — a `LASER` cause while `inset === 0` would be a mislabel, and KS-04-04 AC2 asserts it never
   * happens.
   *
   * @param {Cell} cell
   * @returns {DeathCause | false}
   */
  deadlyCause(cell) {
    if (!this.lasers.isDeadly(cell)) return false;
    return this.lasers.inset > 0 && inBounds(cell, this.settings.grid) ? CAUSES.LASER : CAUSES.WALL;
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
    const cell = this.food.respawn(index, this.foodPlacement());
    // `null` means the shrunken arena had nowhere legal to put it (`DESIGN-DECISIONS §2.3`, issue #39). The
    // slot stays empty and {@link RoundSimulation#refillFood} retries it on every following tick, so there
    // is nothing to announce yet.
    if (cell !== null) this.emit(EVENTS.FOOD_SPAWNED, { index, cell: { ...cell } });
  }

  /**
   * The placement constraints an apple must satisfy right now (`DESIGN-DECISIONS §2.3`), gathered in one
   * place because three callers need exactly the same set. `region` is the safe square rather than the whole
   * board: it is redundant with `deadZone` — both exclude the same cells — but it is what keeps the endgame
   * cheap, since the candidate scan then walks 36 cells instead of 576 on every retry of an empty slot.
   *
   * @returns {{grid: import('./grid.js').GridSize, occupied: Set<string>, heads: Cell[],
   *   deadZone: (cell: Cell) => boolean, rng: import('./rng.js').Rng, minDistance: number,
   *   region: import('./lasers.js').SafeRegion}}
   */
  foodPlacement() {
    return {
      grid: this.settings.grid,
      occupied: this.occupiedCells(),
      heads: this.heads(),
      deadZone: this.lasers.inDeadZone,
      rng: this.rng,
      minDistance: this.settings.foodMinDistanceFromHead,
      region: this.lasers.safeRegion(),
    };
  }

  /**
   * The placement constraints a power-up must satisfy right now (`DESIGN-DECISIONS §2.3`; tech-lead ruling on
   * KS-06-01): everything an apple needs, minus the dead-zone/region fields (no power-up spawn is ever
   * attempted once the laser phase exists — see `powerups.js`'s `maxCycleCount`), plus every apple cell.
   * `food.js`'s own `occupied` set is snake cells only — an apple has no reason to avoid another apple's
   * *replacement* — but a power-up must never land on one, so this method adds them itself rather than
   * teaching `food.js` a rule that is only ever power-ups' to know.
   *
   * @returns {import('./powerups.js').PlacementContext}
   */
  powerUpPlacement() {
    const occupied = this.occupiedCells();
    for (const apple of this.food.present()) occupied.add(cellKey(apple));
    return { grid: this.settings.grid, occupied, heads: this.heads() };
  }

  /**
   * Advances the laser schedule to this tick and applies everything a step does to the board
   * (`DESIGN-DECISIONS §2.4`).
   *
   * The order inside a step is deliberate: the beam sweeps the cells first (apples in the dead zone are gone
   * "the moment a laser passes over" them, and the slots they leave are refilled immediately), and only then
   * are the heads it swept over killed. Doing it the other way round would end the round on the kill and
   * leave an apple sitting inside the dead zone in the final snapshot — a state `§2.4` says cannot exist, and
   * one KS-04-05's fuzz invariants check after every single tick.
   */
  updateLasers() {
    this.advanceLaserClock();
    // `laserTimeRemaining` is `null` in practice mode and `lasers.update` answers "nothing is due" to that,
    // which is why there is no mode test here: "practice has no laser schedule" is the laser system's rule
    // to know.
    for (const event of this.lasers.update(this.laserTimeRemaining)) {
      if (event.type === EVENTS.LASER_WARNING) {
        this.emit(EVENTS.LASER_WARNING, {});
        continue;
      }
      this.emit(EVENTS.LASER_STEP, { inset: event.inset });
      this.sweepDeadZone();
      this.refillFood();
      this.killHeadsInDeadZone();
      if (this.phase !== PHASES.PLAYING) return;
    }
    // `§2.3`: a slot the arena had no room for is retried every tick, not only on a laser step — the space
    // that frees it up is usually a snake's tail moving, not a beam.
    this.refillFood();
  }

  /**
   * Advances {@link laserClockTicks} by one *laser* tick, which is not always one simulation tick
   * (KS-06-01 Ruling 1, `powerups.js` module doc: the solo-SLOW rule is a laser *clock*, not a mutated
   * interval).
   *
   * `denom` is `1` normally and `laserMultiplierWhenSolo` (2 in the shipping settings) while the rule is
   * running, read fresh off `this.powerUps.laserRateMultiplier` every tick. `laserClockCarry` and
   * `laserClockTicks` are both integers incremented by exactly 1 or reset by exactly `denom` — "an integer
   * count of ticks withheld from the laser clock, never a running float sum of seconds" — which is what keeps
   * {@link laserTimeRemaining} bit-for-bit identical to {@link timeRemaining} on every tick of a round that
   * never runs the rule: with `denom` always 1, every call below adds 1 to the carry and immediately takes
   * it back off again, advancing `laserClockTicks` in permanent lockstep with `tick`.
   *
   * While the rule runs, the clock advances on only one tick in every `denom`, so it falls behind by exactly
   * the ticks withheld — which is what shifts every later laser threshold later by that same amount once the
   * rule ends (KS-06-01 AC5).
   */
  advanceLaserClock() {
    const denom = Math.round(1 / this.powerUps.laserRateMultiplier);
    this.laserClockCarry += 1;
    if (this.laserClockCarry >= denom) {
      this.laserClockCarry -= denom;
      this.laserClockTicks += 1;
    }
  }

  /**
   * Takes every apple and power-up the lasers have just swept over off the board (`DESIGN-DECISIONS §2.4`).
   */
  sweepDeadZone() {
    for (let index = 0; index < this.food.apples.length; index += 1) {
      const apple = this.food.apples[index];
      if (apple === null || !this.lasers.inDeadZone(apple)) continue;
      this.food.clear(index);
      this.emit(EVENTS.FOOD_REMOVED, { index, cell: { ...apple } });
    }
    /** @type {{cell: Cell, type: import('./powerups.js').PowerUpType}[]} */
    const survivors = [];
    for (const pickup of this.powerUps.pickups) {
      if (this.lasers.inDeadZone(pickup.cell)) {
        this.emit(EVENTS.POWERUP_REMOVED, { cell: { ...pickup.cell } });
      } else {
        survivors.push(pickup);
      }
    }
    this.powerUps.pickups = survivors;
  }

  /**
   * Advances the power-up spawn/despawn cycle to `timeRemaining` and announces whatever happened
   * (`DESIGN-DECISIONS §2.4`).
   */
  updatePowerUpSpawns() {
    const events = this.powerUps.updateSpawns(this.timeRemaining, () => this.powerUpPlacement());
    for (const event of events) {
      this.emit(event.type, event.payload);
    }
  }

  /**
   * Checks whether `snake`'s head just landed on the board's one power-up and, if so, applies its effect
   * (`DESIGN-DECISIONS §1 rows 3/4/20/21`). Only called for a snake that just committed a step — same as
   * {@link eatIfApple} — since a head that has not moved cannot have just entered a new cell.
   *
   * @param {Snake} snake
   */
  resolvePowerUpPickup(snake) {
    const type = this.powerUps.collectAt(snake.head);
    if (type === null) return;
    // `powerUpType`, not `type` — see the "Declared deviations" note in this ticket's PR description:
    // `emit` flattens `{type: EventType, tick, t, ...payload}` onto one object, and `.type` is the
    // EventType discriminant every consumer in the engine relies on; a payload key also called `type`
    // would silently overwrite it the instant `emit` spreads the payload.
    this.emit(EVENTS.POWERUP_COLLECTED, { playerId: snake.id, powerUpType: type });
    this.applyPowerUpEffect(snake, type);
  }

  /**
   * Turns a collected power-up into its effect (`DESIGN-DECISIONS §1 rows 3/4/20/21`).
   *
   * SPEED always boosts the collector. SLOW slows every *other* living snake — unless there is none, in which
   * case (practice/solo) it slows the laser clock instead (`powerups.js`'s solo-SLOW rule; see that module's
   * doc comment for why this path cannot be reached by playing in Sprint 06).
   *
   * @param {Snake} collector
   * @param {import('./powerups.js').PowerUpType} type
   */
  applyPowerUpEffect(collector, type) {
    if (type === POWERUP_TYPES.SPEED) {
      const { multiplier, duration } = this.settings.speedBoost;
      const isNew = collector.applyEffect(type, multiplier, duration, this.settings.simHz);
      if (isNew) this.emit(EVENTS.EFFECT_STARTED, { playerId: collector.id, powerUpType: type });
      return;
    }

    const { multiplier, duration, laserMultiplierWhenSolo } = this.settings.slow;
    const others = this.snakes.filter((snake) => snake !== collector && snake.alive);
    if (others.length === 0) {
      const isNew = this.powerUps.applySoloSlow(
        collector.id,
        duration,
        laserMultiplierWhenSolo,
        this.settings.simHz,
      );
      if (isNew) this.emit(EVENTS.EFFECT_STARTED, { playerId: collector.id, powerUpType: type });
      return;
    }
    for (const other of others) {
      const isNew = other.applyEffect(type, multiplier, duration, this.settings.simHz);
      if (isNew) this.emit(EVENTS.EFFECT_STARTED, { playerId: other.id, powerUpType: type });
    }
  }

  /**
   * Advances every snake's power-up effect timers by one tick, and the solo-SLOW laser-clock timer with
   * them, announcing whichever expire (`DESIGN-DECISIONS §2.4`: effects tick in sim time regardless of
   * movement or the laser phase).
   */
  tickPowerUpEffects() {
    for (const snake of this.snakes) {
      if (!snake.alive) continue;
      for (const type of snake.tickEffects()) {
        this.emit(EVENTS.EFFECT_ENDED, { playerId: snake.id, powerUpType: type });
      }
    }
    const expiredSoloPlayerId = this.powerUps.tickSoloSlow();
    if (expiredSoloPlayerId !== null) {
      this.emit(EVENTS.EFFECT_ENDED, { playerId: expiredSoloPlayerId, powerUpType: POWERUP_TYPES.SLOW });
    }
  }

  /**
   * Tries to fill every empty apple slot, announcing the ones that succeed. A slot that still has nowhere to
   * go costs nothing — `placeFoodWithFallback` finds no candidate and draws no random number — so calling
   * this every tick is the cheap half of `§2.3`'s "retried every tick" and keeps the `rng` stream identical
   * to a round that never had an empty slot at all.
   */
  refillFood() {
    for (let index = 0; index < this.food.apples.length; index += 1) {
      if (this.food.apples[index] !== null) continue;
      const cell = this.food.respawn(index, this.foodPlacement());
      if (cell !== null) this.emit(EVENTS.FOOD_SPAWNED, { index, cell: { ...cell } });
    }
  }

  /**
   * Kills every snake the beam has just closed over. Only the **head** counts (`DESIGN-DECISIONS §2.4`: "A
   * snake *body* in the dead zone does not die"), and this is the one death that happens to a snake standing
   * still — every other death in the game happens to a head that moved into something.
   */
  killHeadsInDeadZone() {
    if (this.godMode) return;
    /** @type {Snake[]} */
    const killed = this.snakes.filter((snake) => snake.alive && this.lasers.inDeadZone(snake.head));
    if (killed.length === 0) return;

    for (const snake of killed) {
      snake.alive = false;
      this.emit(EVENTS.SNAKE_DIED, {
        snakeId: snake.id,
        cause: CAUSES.LASER,
        cell: { ...snake.head },
      });
    }
    this.endRound(END_REASONS.DEATH);
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
