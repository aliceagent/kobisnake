// @ts-check
import { EVENTS, PHASES } from '../../src/core/events.js';
import { createRng } from '../../src/core/rng.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * The simulation harness `tests/sim` and `docs/qa` build on (`docs/sprints/sprint-02-core-simulation.md`
 * KS-02-06, `QA-STRATEGY §3–4`). `RoundSimulation` (KS-02-05) is the engine; this file is the thing that
 * drives it either with bots (for statistics — `stats.test.js`) or with a recorded input log (for regression
 * fixtures — `replay.test.js`), and hands back one plain result object either way.
 *
 * Two things here are deliberate, both flagged by the tech lead while reviewing this ticket:
 *
 * 1. **Every bot gets its own `rng` stream, derived from the round seed by index alone** ({@link
 *    deriveBotSeed}), not from the round's own `rng` or from anything that depends on how many bots exist.
 *    Sharing the round's `rng` would make a bot's choices depend on how many random draws food placement
 *    happened to make first; deriving from `(seed, botCount)` instead of `(seed, index)` would reseed bot 0
 *    the moment a third bot is added. Neither is acceptable for AC4 (determinism across arbitrary bot lists).
 * 2. **Bot decisions are taken once per grid step, not once per simulation tick.** A snake only consumes one
 *    queued direction per step (`Snake.commitStep`), and `queueDirection` already ignores a repeat of the
 *    current direction, so asking a bot every tick would recompute the same answer ~20 times over for nothing
 *    — the exact cost that makes AC1's 200-rounds-under-10s budget tight. `stepTicksFor` computes the tick
 *    count of one step at the settings' base speed and the harness advances the simulation in chunks of that
 *    size. This assumes every snake moves at `settings.snakeSpeed` — true for the whole of Sprint 02, since
 *    `speedMultiplier` is fixed at 1 until Sprint 06's power-ups can change it — and is called out here so
 *    whoever wires bots into a power-up-enabled round revisits it.
 */

/** @typedef {import('../../src/core/grid.js').Direction} Direction */
/** @typedef {import('../../src/core/grid.js').Cell} Cell */
/** @typedef {import('../../src/core/snake.js').Snake} Snake */
/** @typedef {import('../../src/core/settings.js').Settings} Settings */
/** @typedef {import('../../src/core/rng.js').Rng} Rng */

/**
 * What a bot sees to make one decision. Deliberately a read-only view over the live simulation, not a copy:
 * copying every segment of every snake on every decision is exactly the allocation cost point 2 above avoids
 * elsewhere, so bots must not mutate anything reachable from here.
 *
 * @typedef {object} BotView
 * @property {Snake} self - this bot's own snake; `self.alive` is already true when the bot is called
 * @property {Snake[]} others - every other snake in the round, alive or not
 * @property {Cell[]} apples - the current apple cells
 * @property {import('../../src/core/grid.js').GridSize} grid
 * @property {Rng} rng - this bot's own seeded stream (see {@link deriveBotSeed})
 * @property {number} decisionIndex - 0, 1, 2, … — how many times this bot has been asked to decide this round,
 *   which is also "how many of its own grid steps have elapsed" (point 2 above); `randomBot` uses this to turn
 *   only every N steps without keeping any state of its own
 */

/**
 * A bot: given a {@link BotView}, returns the direction it wants queued next, or `null`/`undefined` for "no
 * change". Returning the snake's current direction is treated the same as returning nothing — `applyInput`
 * would reject it anyway (`DESIGN-DECISIONS §2.2`), so bots need not special-case it, though most do to avoid
 * the wasted call.
 *
 * @callback Bot
 * @param {BotView} view
 * @returns {Direction | null | undefined}
 */

/**
 * One entry of a recorded input log / replay fixture (`docs/sprints/sprint-02-core-simulation.md` KS-02-06:
 * "Replay JSON `{ seed, settingsOverrides, inputs:[{t, player, dir}], expectedEvents }`"). `t` is simulated
 * seconds from round start, exactly like an event's `t` field; `dir` is one of `UP | DOWN | LEFT | RIGHT`,
 * chosen for the JSON fixture over a raw `{dx, dy}` pair because a replay file is meant to be read and hand
 * -edited by a QA engineer (`tests/sim/replays/README.md`).
 *
 * @typedef {object} InputLogEntry
 * @property {number} t
 * @property {string} player
 * @property {'UP' | 'DOWN' | 'LEFT' | 'RIGHT'} dir
 */

/** @type {{UP: Direction, DOWN: Direction, LEFT: Direction, RIGHT: Direction}} */
const DIRECTIONS_BY_NAME = {
  UP: { dx: 0, dy: 1 },
  DOWN: { dx: 0, dy: -1 },
  LEFT: { dx: -1, dy: 0 },
  RIGHT: { dx: 1, dy: 0 },
};

/**
 * Every random draw in the round itself goes through `sim.rng`, seeded from `seed` alone (`round.js`). Bots
 * are drivers *outside* the simulation, so they need their own streams — sharing the round's `rng` would make
 * a bot's choice depend on how many draws food placement happened to make before it, which has nothing to do
 * with the bot's own decisions. Deriving from `(seed, index)` — never from `bots.length` — is what keeps bot
 * 0's stream identical whether it is playing alone, against one opponent, or (a future sprint) against two:
 * `Math.imul` mixes the seed and a per-index odd constant into one 32-bit stream identifier, cheaply and with
 * no dependency on anything but those two numbers (`createRng` only uses the low 32 bits anyway).
 *
 * @param {number} seed
 * @param {number} index
 * @returns {number}
 */
function deriveBotSeed(seed, index) {
  return (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
}

/**
 * The number of simulation ticks one grid step takes at `settings.snakeSpeed` and `settings.simHz` — see the
 * module doc's point 2. Rounded rather than truncated so a non-exact ratio (a settings override a test might
 * use) still lands close to a real step instead of always drifting short.
 *
 * @param {Settings} settings
 * @returns {number}
 */
function stepTicksFor(settings) {
  return Math.max(1, Math.round(settings.simHz / settings.snakeSpeed));
}

/**
 * A generous cap on the number of decision/advance cycles a round may take before {@link runRound} gives up
 * and throws, rather than looping forever. A real round always ends (`RoundSimulation` AC2/AC4); this only
 * guards against a bug — in a bot, in the harness, or in the engine — turning that guarantee into an infinite
 * loop inside a test run.
 */
const MAX_CYCLES = 2_000_000;

/**
 * Runs one whole round of KOBI Snake headlessly, either bot-driven or replayed from a recorded input log, and
 * returns a single plain summary (`docs/sprints/sprint-02-core-simulation.md` KS-02-06 spec).
 *
 * `bots.length` fixes the number of players (always 2 for the pairings this ticket measures — Sprint 02 has
 * no solo bot play) and their ids, `p1`/`p2`, matching `RoundSimulation`'s own two-player spawns. When
 * `inputLog` is supplied every entry in it is applied on its own exact tick (`Math.round(t * settings.simHz)`,
 * `tests/sim/replays/README.md`) and the bots' decision functions are never called — they still fix the player
 * count and ids, but a replay is a *recording*, and re-deciding on top of it would defeat the point of one.
 * Otherwise each bot is asked to decide once per grid step (module doc point 2) and its answer, if any, is
 * queued with `sim.applyInput` before the simulation advances that step.
 *
 * Determinism (AC4): for fixed `seed`, `bots` (as functions) and `settings`, the sequence of `sim.advance`
 * calls, the ticks they land on and the `rng` stream each bot reads from are all pure functions of those
 * inputs, so the same call always plays out identically.
 *
 * @param {object} options
 * @param {number} options.seed - seeds the round's own `rng` (food placement, …); see {@link deriveBotSeed}
 *   for how each bot's own stream is derived from it
 * @param {Bot[]} options.bots - exactly two bots; see above for the replay case
 * @param {Settings} [options.settings] - defaults to the shipping `SETTINGS`
 * @param {InputLogEntry[]} [options.inputLog] - when given, drives the round instead of the bots
 * @returns {{
 *   events: object[],
 *   result: import('../../src/core/events.js').RoundResult | null,
 *   lengths: number[],
 *   endedAt: number,
 *   cause: {snakeId: string, cause: string}[],
 *   reason: import('../../src/core/events.js').EndReason | null,
 * }}
 */
export function runRound({ seed, bots, settings = SETTINGS, inputLog }) {
  if (bots.length !== 2) {
    throw new RangeError(`runRound: expected exactly 2 bots, got ${bots.length}`);
  }

  const players = bots.map((_, index) => ({ id: `p${index + 1}` }));
  const sim = new RoundSimulation({ settings, seed, players });
  const events = [...sim.events];

  if (inputLog !== undefined) {
    driveWithInputLog(sim, inputLog, settings, events);
  } else {
    driveWithBots(sim, bots, settings, events);
  }

  return {
    events,
    result: sim.result,
    lengths: sim.snakes.map((snake) => snake.segments.length),
    endedAt: sim.elapsed,
    cause: events
      .filter((event) => event.type === EVENTS.SNAKE_DIED)
      .map((event) => ({
        snakeId: /** @type {any} */ (event).snakeId,
        cause: /** @type {any} */ (event).cause,
      })),
    reason: sim.endReason,
  };
}

/**
 * Delivers a recorded input log tick-exact (`tests/sim/replays/README.md`): every entry is resolved to a tick
 * once up front, entries due are applied before the tick they are due on, and the simulation advances one
 * tick at a time so an input can never land later than the tick that names it. This is the same shape as
 * `playRoundWithAlignedInputs` in `tests/sim/determinism.test.js`, which is what a replay must reproduce.
 *
 * @param {RoundSimulation} sim
 * @param {InputLogEntry[]} inputLog
 * @param {Settings} settings
 * @param {object[]} events - appended to in place
 */
function driveWithInputLog(sim, inputLog, settings, events) {
  const pending = [...inputLog]
    .map((entry) => ({ ...entry, tick: Math.round(entry.t * settings.simHz) }))
    .sort((a, b) => a.tick - b.tick);
  const dt = 1 / settings.simHz;

  let cycles = 0;
  while (sim.phase === PHASES.PLAYING) {
    cycles += 1;
    if (cycles > MAX_CYCLES) {
      throw new Error('runRound: input-log round exceeded the safety cycle cap without ending');
    }
    while (pending.length > 0 && pending[0].tick <= sim.tick) {
      const input = /** @type {InputLogEntry & {tick: number}} */ (pending.shift());
      sim.applyInput(input.player, DIRECTIONS_BY_NAME[input.dir]);
    }
    events.push(...sim.advance(dt));
  }
}

/**
 * Drives the round with bot decisions, one decision per bot per grid step (module doc point 2).
 *
 * @param {RoundSimulation} sim
 * @param {Bot[]} bots
 * @param {Settings} settings
 * @param {object[]} events - appended to in place
 */
function driveWithBots(sim, bots, settings, events) {
  const rngs = bots.map((_, index) => createRng(deriveBotSeed(sim.seed, index)));
  const decisionIndex = bots.map(() => 0);
  const chunkDt = stepTicksFor(settings) / settings.simHz;

  let cycles = 0;
  while (sim.phase === PHASES.PLAYING) {
    cycles += 1;
    if (cycles > MAX_CYCLES) {
      throw new Error('runRound: bot-driven round exceeded the safety cycle cap without ending');
    }
    for (let i = 0; i < bots.length; i += 1) {
      const self = sim.snakes[i];
      if (!self.alive) continue;
      const direction = bots[i]({
        self,
        others: sim.snakes.filter((_, j) => j !== i),
        apples: sim.food.present(),
        grid: settings.grid,
        rng: rngs[i],
        decisionIndex: decisionIndex[i],
      });
      decisionIndex[i] += 1;
      if (direction) sim.applyInput(self.id, direction);
    }
    events.push(...sim.advance(chunkDt));
  }
}
