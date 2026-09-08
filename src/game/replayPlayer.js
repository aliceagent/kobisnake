// @ts-check
import { PHASES } from '../core/events.js';
import { DIRECTIONS } from '../core/grid.js';
import { parseReplay } from '../core/replay.js';
import { RoundSimulation } from '../core/round.js';
import { withOverrides } from '../core/settings.js';

/**
 * KI-05-02: a driver that plays a parsed replay back through a real `RoundSimulation`, so the round re-runs
 * identically (`docs/sprints/improvement-05-replay-capture-and-playback.md`, `ARCHITECTURE §4`).
 *
 * This file is deliberately plain — no DOM, no three.js, provable in Node (`tests/unit/game/replayPlayer.test.js`
 * runs it there with no browser at all). `session.js` is the only caller that gives it a renderer and a HUD to
 * draw into; this module knows about neither.
 *
 * ## The reference semantics: `tests/sim/harness.js`'s `driveWithInputLog`
 *
 * Everything below reproduces that function's behaviour exactly, because a replay that disagrees with it
 * would disagree with every committed fixture (`tests/sim/replays/*.json`) it is meant to reproduce:
 *
 * - **Whole ticks, never a duration.** {@link stepOnce} is the one place time ever moves, and it always calls
 *   `sim.advance(1 / settings.simHz)` — one tick, exactly. `__kobi.advance(seconds)` chunks at 0.1 s
 *   (`src/game/testHooks.js`) and `RoundSimulation` accumulates in tick units, so a duration spanning more
 *   than one chunk from an empty accumulator can silently deliver one tick fewer than asked (PR #154,
 *   `tests/e2e/determinism.spec.js`'s "Whole ticks, never a duration"). {@link ReplayPlayer#advance} converts
 *   wall time into ticks with its own accumulator for exactly this reason, one tick at a time, never a single
 *   `sim.advance(ticks / settings.simHz)` call.
 * - **Inputs land on a tick, not at an instant.** Every `ReplayInput.t` (simulated seconds) is resolved once,
 *   up front, to `Math.round(t * settings.simHz)` — the same formula `tests/sim/replays/README.md` documents
 *   — and applied on that exact tick, before the tick's own `advance` runs. Inputs are sorted by resolved
 *   tick; `Array.prototype.sort` has been a stable sort since ES2019, so two inputs resolving to the same
 *   tick keep their recorded relative order, exactly as `driveWithInputLog`'s own `.sort` does (it carries no
 *   explicit tie-breaker either).
 * - **The event log is seeded before the first advance.** {@link reset} captures `[...sim.events]` right
 *   after construction, so the constructor's own opening `FOOD_SPAWNED` events are included — what
 *   `tests/sim/harness.js`'s `runRound` and `session.js`'s `startRound` both do. Skipping this would make
 *   every replay's log open one event short of its golden.
 *
 * ## Seed and settings come from the replay, not from a session
 *
 * `createReplayPlayer` builds its `RoundSimulation` straight from the replay's own `seed` and
 * `withOverrides(replay.settingsOverrides)` — never through `startMatch`/`roundSeedFor`. A replay's `seed` is
 * a **round** seed, and most round seeds (including every fixture's) are not reachable as anybody's first
 * round through any match seed (`tests/e2e/determinism.spec.js`'s own module comment, issue #159) — routing a
 * replay through match setup would silently play the wrong round or fail to reach it at all.
 *
 * ## `seed: null` is refused here, not by `parseReplay`
 *
 * `parseReplay` accepts `seed: null` as a well-formed recording of "no round has started yet"
 * (`src/core/replay.js`'s own module doc). There is no round to rebuild from it, so {@link createReplayPlayer}
 * refuses it with a named {@link REPLAY_PLAYER_ERROR_CODES.NO_SEED} result rather than handing `null` to
 * `RoundSimulation`'s constructor and finding out what that does.
 */

/** @typedef {import('../core/replay.js').Replay} Replay */
/** @typedef {import('../core/replay.js').ReplayError} ReplayError */
/** @typedef {import('../core/round.js').SimEvent} SimEvent */
/** @typedef {import('../core/settings.js').Settings} Settings */

/**
 * @typedef {object} ReplayPlayerError
 * @property {string} code
 * @property {string} message
 */

/** Every {@link ReplayPlayerError.code} this module can produce, on top of `parseReplay`'s own. */
export const REPLAY_PLAYER_ERROR_CODES = Object.freeze({
  /** The replay's `seed` is `null` — well-formed, but there is no round to rebuild (module doc). */
  NO_SEED: 'NO_SEED',
});

/** `RoundSimulation` player ids, in the order every fixture's `inputs[].player` uses. */
const PLAYER_IDS = ['p1', 'p2'];

/** @typedef {{tick: number, player: string, dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'}} ResolvedInput */

/**
 * Resolves every input's `t` (simulated seconds since round start) to the exact tick it is due on, once, up
 * front — `tests/sim/replays/README.md`'s "The tick, not the wall-clock time". Sorted by tick; ties keep
 * their original relative order (module doc: `Array.prototype.sort`'s stability, matching
 * `driveWithInputLog`'s own untied `.sort`).
 *
 * @param {Replay['inputs']} inputs
 * @param {Settings} settings
 * @returns {ResolvedInput[]}
 */
function resolveInputs(inputs, settings) {
  return inputs
    .map((entry) => ({
      tick: Math.round(entry.t * settings.simHz),
      player: entry.player,
      dir: entry.dir,
    }))
    .sort((a, b) => a.tick - b.tick);
}

/**
 * @typedef {object} ReplayPlayer
 * @property {() => boolean} step - advances exactly one simulation tick, applying whatever input is due
 *   first. `false` and a no-op once the round has left `PLAYING`. Independent of {@link play}/{@link pause} —
 *   this is KI-05-02's "step one simulation step" control.
 * @property {() => void} play - marks playback as running; {@link advance} is what actually moves it.
 * @property {() => void} pause - marks playback as stopped. `step`/`seek` still work while paused.
 * @property {() => boolean} isPlaying
 * @property {(wallSeconds: number) => void} advance - consumes `wallSeconds` of real time in whole ticks
 *   while {@link play} is in effect; a no-op while paused. See the module doc's "whole ticks" note.
 * @property {(targetTick: number) => void} seek - seeks to `targetTick` by rebuilding the round from tick 0
 *   and stepping forward (the ticket's own "cheap and exact", rather than storing snapshots). Stops early if
 *   the round ends before `targetTick`. Leaves {@link isPlaying} exactly as it was.
 * @property {number} tick
 * @property {import('../core/events.js').Phase} phase
 * @property {() => SimEvent[]} getEvents - a copy of the event log so far: the constructor's opening events
 *   plus everything `step`/`advance`/`seek` produced since the last {@link seek}/construction.
 * @property {() => object} getSnapshot - `sim.getState()` right now.
 * @property {() => number} getSeed
 * @property {() => Settings} getSettings
 * @property {() => Replay} getReplay - the parsed replay this player was built from, verbatim.
 */

/**
 * Builds a {@link ReplayPlayer} for a replay (KI-05-02). `input` is whatever `parseReplay` accepts — JSON
 * text, or an already-parsed value such as `session.getReplay()`'s own return (KI-05-01's seam, tech-lead
 * note F) — so a caller with either in hand can pass it straight through with no second entry point.
 *
 * Never throws: a malformed file, an unsupported version or a `null` seed all come back as
 * `{ok: false, error}` (module doc), the same never-throws contract `parseReplay` itself keeps.
 *
 * @param {string | unknown} input
 * @returns {{ok: true, player: ReplayPlayer} | {ok: false, error: ReplayError | ReplayPlayerError}}
 */
export function createReplayPlayer(input) {
  const parsed = parseReplay(input);
  if (!parsed.ok) return parsed;
  const replay = parsed.replay;

  if (replay.seed === null) {
    return {
      ok: false,
      error: {
        code: REPLAY_PLAYER_ERROR_CODES.NO_SEED,
        message:
          'This replay has no seed (it was recorded before any round started) and cannot be played back.',
      },
    };
  }
  const seed = replay.seed;

  const settings = withOverrides(replay.settingsOverrides);
  const resolvedInputs = resolveInputs(replay.inputs, settings);
  const players = PLAYER_IDS.map((id) => ({ id }));
  const dt = 1 / settings.simHz;

  /** @type {RoundSimulation} */
  let sim;
  /** @type {SimEvent[]} */
  let events;
  /** How many of {@link resolvedInputs}, in order, have already been applied to the live `sim`. */
  let appliedCount = 0;
  let playing = false;
  /**
   * Wall-time accumulator {@link ReplayPlayer#advance} converts into whole ticks — the same pattern
   * `RoundSimulation.advance` itself uses internally, kept here instead so every tick this module ever takes
   * still goes through {@link stepOnce} one at a time (module doc: "whole ticks, never a duration").
   */
  let tickAccumulator = 0;

  /**
   * (Re)builds `sim` and `events` from tick 0 — what {@link ReplayPlayer#seek} uses to replay from the start
   * (ticket spec: "seek by replaying from the start, which is cheap and exact").
   */
  function reset() {
    sim = new RoundSimulation({ settings, seed, players });
    // Module doc: seeded with the constructor's own opening events before anything else runs.
    events = [...sim.events];
    appliedCount = 0;
    tickAccumulator = 0;
  }
  reset();

  /** Applies every resolved input due at or before `sim.tick`, in their recorded (tie-stable) order. */
  function applyDueInputs() {
    while (appliedCount < resolvedInputs.length && resolvedInputs[appliedCount].tick <= sim.tick) {
      const due = resolvedInputs[appliedCount];
      sim.applyInput(due.player, DIRECTIONS[due.dir]);
      appliedCount += 1;
    }
  }

  /**
   * The one place time ever moves: exactly one tick, with whatever is due applied first. Every control below
   * is built from calling this a certain number of times.
   *
   * @returns {boolean} `false`, and does nothing, once the round has left `PLAYING`.
   */
  function stepOnce() {
    if (sim.phase !== PHASES.PLAYING) return false;
    applyDueInputs();
    events.push(...sim.advance(dt));
    return true;
  }

  return {
    ok: true,
    player: {
      step() {
        return stepOnce();
      },
      play() {
        playing = true;
      },
      pause() {
        playing = false;
      },
      isPlaying() {
        return playing;
      },
      advance(wallSeconds) {
        if (!playing) return;
        tickAccumulator += wallSeconds * settings.simHz;
        while (tickAccumulator >= 1 && sim.phase === PHASES.PLAYING) {
          tickAccumulator -= 1;
          stepOnce();
        }
        if (sim.phase !== PHASES.PLAYING) playing = false;
      },
      seek(targetTick) {
        reset();
        while (sim.tick < targetTick && sim.phase === PHASES.PLAYING) {
          stepOnce();
        }
      },
      get tick() {
        return sim.tick;
      },
      get phase() {
        return sim.phase;
      },
      getEvents() {
        return [...events];
      },
      getSnapshot() {
        return sim.getState();
      },
      getSeed() {
        return seed;
      },
      getSettings() {
        return settings;
      },
      getReplay() {
        return replay;
      },
    },
  };
}
