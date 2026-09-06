// @ts-check
import { DIRECTIONS } from '../core/grid.js';

/**
 * KS-07-06: input-feel instrumentation.
 *
 * Measures the pipeline the ticket names — keydown -> queued -> committed step -> first rendered frame with
 * the new direction — and keeps enough of each sample to tell two very different things apart (tech-lead
 * note 2): the few microseconds this game's *own code* costs between one stage and the next, versus the
 * dozens to hundreds of milliseconds that are simply the wait for a snake's movement accumulator to reach
 * the next whole cell (`DESIGN-DECISIONS §2.1`: base speed 6 cells/s at `simHz` 120 makes a grid step 20
 * ticks, ~167 ms). The second number is not overhead; it is the grid itself.
 *
 * This module is pure — no DOM, no three.js, no wall clock of its own opinion about *when* it runs — so it
 * is provable in Node like everything else under `src/game/`. It knows nothing about `input.js`'s key codes
 * or `session.js`'s state machine; it is handed four kinds of fact by whoever wires it up (`session.js`,
 * declared as a deviation in this ticket's PR — see the module comment on `createSession`'s `enableInputStats`
 * option) and turns them into matched samples:
 *
 *   1. `recordKeydown(playerId, dir, atMs)` — a direction key resolved, before anything else happens to it.
 *   2. `recordApplied(playerId, tick, accepted)` — `RoundSimulation.applyInput` just returned for that same
 *      key: `accepted` is its return value, `tick` is `RoundSimulation.getState().tick` at that moment.
 *      Rejected inputs (a reversal, a repeat, a full buffer — `Snake.queueDirection`'s own rules) are
 *      consumed here and produce no sample, exactly right, since nothing in the simulation reacted to them
 *      either.
 *   3. `observeState(state)` — call once per frame with `RoundSimulation.getState()`'s snapshot, *after*
 *      `sim.advance()` for that frame. Detects a queued direction becoming the snake's actual committed
 *      heading by watching `state.snakes[i].direction` change (`Snake.commitStep` is the only thing that
 *      changes it, and only when it consumes a queued turn — ARCHITECTURE §4, §11).
 *   4. `markRendered()` — call once per frame, immediately after the renderer has drawn the state most
 *      recently handed to `observeState`. Finalises every sample `observeState` moved into "committed" on
 *      this same frame.
 *
 * Steps 3 and 4 are deliberately two calls bracketing one `renderer.render(...)` invocation rather than one:
 * `committedAt` is stamped before the draw, `renderedAt` immediately after, so the gap between them is
 * nothing but that one draw call — everything upstream of it (the wait for the accumulator, the queueing, the
 * keydown itself) is already accounted for in the earlier stages.
 *
 * ## What this honestly measures, and what it does not
 *
 * `observeState`/`markRendered` are driven once per real frame, from `session.js`'s own render callback,
 * which is the same one the live `requestAnimationFrame` loop uses. A sample recorded while the game is
 * running under `__kobi.fastForward`/`advance` (`testHooks.js`) collapses to whatever `renderFrame()` is
 * called (usually once at the end of a bulk advance) rather than once per real animation frame, so its
 * "committed -> rendered" gap says nothing about a paint the player would actually have seen. This module has
 * no way to tell the two situations apart — it only sees calls — so the honesty burden sits with the caller:
 * `tests/e2e/inputLatency.spec.js` gathers its samples from real, live frames for exactly this reason (see
 * that file's own comment), and the PR says so plainly rather than publishing a fast-forwarded number as if
 * it were a human's experience.
 */

/** @typedef {{dx: number, dy: number}} Direction */

/**
 * @typedef {object} InputLatencySample
 * @property {string} playerId
 * @property {string} dirName
 * @property {number} queuedTick
 * @property {number} committedTick
 * @property {number} stepWaitTicks - `committedTick - queuedTick`: the ticket's "in sim steps".
 * @property {number} totalMs - `renderedAt - keydownAt`: the whole keydown-to-render pipeline.
 * @property {number} overheadMs - `queuedAt - keydownAt`: this game's own call-stack cost of enqueuing.
 * @property {number} stepWaitMs - `committedAt - queuedAt`: the wait for the grid step, in wall time.
 * @property {number} renderMs - `renderedAt - committedAt`: the cost of the one draw call that followed.
 */

/**
 * @typedef {object} StatSummary
 * @property {number | null} median
 * @property {number | null} p10
 * @property {number | null} p90
 * @property {number | null} min
 * @property {number | null} max
 */

/**
 * @typedef {object} InputLatencyHistogram
 * @property {number} bucketWidthMs
 * @property {number[]} buckets - counts, one per bucket, `[0, bucketWidthMs)`, `[bucketWidthMs, 2*..)`, ...
 * @property {number} overflowCount - samples at or past the last bucket's upper edge
 * @property {'totalMs'} metric
 */

/**
 * @typedef {object} InputLatencyStats
 * @property {boolean} enabled
 * @property {number} sampleCount
 * @property {StatSummary} totalMs
 * @property {StatSummary} overheadMs
 * @property {StatSummary} stepWaitMs
 * @property {StatSummary} renderMs
 * @property {{median: number | null, min: number | null, max: number | null}} stepWaitTicks
 * @property {{simHz: number, snakeSpeed: number, ticksPerStepAtBaseSpeed: number, stepMsAtBaseSpeed: number}} context
 * @property {InputLatencyHistogram} histogram
 * @property {InputLatencySample[]} samples - most recent samples, oldest first, capped at `historySize`.
 */

/** How many completed samples to keep for the median/histogram/overlay. Oldest are dropped first. */
const DEFAULT_HISTORY_SIZE = 300;

/** Histogram bucket width for `totalMs`, chosen to resolve a base-speed step (~167 ms) into several bars. */
const DEFAULT_BUCKET_WIDTH_MS = 20;

/** Number of histogram buckets, covering `[0, DEFAULT_BUCKET_COUNT * DEFAULT_BUCKET_WIDTH_MS)` ms. */
const DEFAULT_BUCKET_COUNT = 25;

/** How long a pending stage may wait for its next stage before it is dropped as stale (round-over, etc.). */
const DEFAULT_MAX_PENDING_AGE_MS = 4000;

/** Defensive cap on how many un-committed queued turns one player can have pending at once. */
const MAX_PENDING_PER_PLAYER = 4;

/**
 * `performance.now()` where there is one, `Date.now()` where there is not (mirrors `loop.js`'s own
 * `defaultNow`, duplicated rather than imported so this module stays independent of the loop's internals).
 *
 * @returns {number}
 */
function defaultNow() {
  const performanceRef = /** @type {{now?: () => number} | undefined} */ (
    /** @type {any} */ (globalThis).performance
  );
  return performanceRef?.now ? performanceRef.now() : Date.now();
}

/**
 * @param {Direction} a
 * @param {Direction} b
 * @returns {boolean}
 */
function sameDirection(a, b) {
  return a.dx === b.dx && a.dy === b.dy;
}

/**
 * The human-readable name of a `DIRECTIONS` vector, for samples and the overlay. Falls back to a literal
 * `"dx,dy"` for a value that never comes from `DIRECTIONS` itself (defensive; every real caller does).
 *
 * @param {Direction} dir
 * @returns {string}
 */
function directionName(dir) {
  for (const name of /** @type {const} */ (['UP', 'DOWN', 'LEFT', 'RIGHT'])) {
    if (sameDirection(DIRECTIONS[name], dir)) return name;
  }
  return `${dir.dx},${dir.dy}`;
}

/**
 * The middle value of a sorted numeric array (average of the two middles when even-length). `null` for an
 * empty array, so a caller never has to special-case `NaN`.
 *
 * @param {number[]} sorted
 * @returns {number | null}
 */
function medianOfSorted(sorted) {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * A simple nearest-rank percentile of a sorted numeric array. `p` is 0..1. `null` for an empty array.
 *
 * @param {number[]} sorted
 * @param {number} p
 * @returns {number | null}
 */
function percentileOfSorted(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

/**
 * @param {number[]} values - need not be sorted
 * @returns {StatSummary}
 */
function summarize(values) {
  if (values.length === 0) return { median: null, p10: null, p90: null, min: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: medianOfSorted(sorted),
    p10: percentileOfSorted(sorted, 0.1),
    p90: percentileOfSorted(sorted, 0.9),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/**
 * @param {object} options
 * @param {() => number} [options.now] - defaults to {@link defaultNow}; injectable for tests.
 * @param {number} [options.historySize] - completed samples kept; defaults to {@link DEFAULT_HISTORY_SIZE}.
 * @param {number} [options.maxPendingAgeMs] - defaults to {@link DEFAULT_MAX_PENDING_AGE_MS}.
 * @param {number} [options.simHz] - for the `context` block only; defaults to 120 (`DESIGN-DECISIONS §2.1`).
 * @param {number} [options.snakeSpeed] - for the `context` block only; defaults to 6 cells/s.
 */
export function createInputLatencyTracker({
  now = defaultNow,
  historySize = DEFAULT_HISTORY_SIZE,
  maxPendingAgeMs = DEFAULT_MAX_PENDING_AGE_MS,
  simHz = 120,
  snakeSpeed = 6,
} = {}) {
  /**
   * The most recent keydown not yet resolved into "accepted" or "rejected", per player. A single slot, not a
   * queue: between one player's keydown and the `recordApplied` call that resolves it, no *other* keydown for
   * that same player can occur, because `input.js` and `session.js` handle one keydown to completion
   * (synchronously, same call stack) before the browser's event loop can deliver the next one.
   * @type {Map<string, {dirName: string, keydownAtMs: number}>}
   */
  const lastKeydown = new Map();

  /**
   * Turns queued but not yet committed, per player, oldest first. `Snake.queue` is itself FIFO
   * (`core/snake.js` `commitStep`), and every entry here corresponds 1:1 to an entry that really was pushed
   * onto it (only accepted inputs are recorded — see `recordApplied`), so consuming this array in the same
   * order `observeState` sees direction changes arrive keeps the two in lockstep without needing to match by
   * direction value.
   * @type {Map<string, Array<{dirName: string, keydownAtMs: number, queuedAtMs: number, queuedTick: number}>>}
   */
  const pendingCommit = new Map();

  /**
   * Committed but not yet drawn — filled by `observeState`, drained by `markRendered` on the same frame.
   * @type {Array<{playerId: string, dirName: string, keydownAtMs: number, queuedAtMs: number, queuedTick: number, committedAtMs: number, committedTick: number}>}
   */
  const awaitingRender = [];

  /** The last committed direction seen per player, to detect `commitStep`'s change (`ARCHITECTURE §11`). */
  const lastDirection = new Map();

  /** @type {InputLatencySample[]} */
  const samples = [];

  /**
   * @param {string} playerId
   * @returns {Array<{dirName: string, keydownAtMs: number, queuedAtMs: number, queuedTick: number}>}
   */
  function pendingFor(playerId) {
    let list = pendingCommit.get(playerId);
    if (list === undefined) {
      list = [];
      pendingCommit.set(playerId, list);
    }
    return list;
  }

  /**
   * A direction key resolved for `playerId`, before any queueing has happened. `atMs` is `input.js`'s own
   * timestamp, taken at the moment the keydown was decoded (see that file's `onDirectionTimed`), so this
   * stays a pure recording call with no clock of its own to disagree with.
   *
   * Overwrites any previous unresolved keydown for the same player rather than queueing one — see
   * {@link lastKeydown}'s own comment for why that is always correct rather than merely convenient.
   *
   * @param {string} playerId
   * @param {Direction} dir
   * @param {number} atMs
   */
  function recordKeydown(playerId, dir, atMs) {
    lastKeydown.set(playerId, { dirName: directionName(dir), keydownAtMs: atMs });
  }

  /**
   * `RoundSimulation.applyInput` just returned for the most recent keydown recorded for `playerId`.
   * `accepted === false` (a reversal, a repeat, a full buffer) simply discards the pending keydown; only an
   * accepted one is promoted into {@link pendingCommit}, where `observeState` will look for its commit.
   *
   * @param {string} playerId
   * @param {number} tick - `RoundSimulation.getState().tick` at the moment of queuing; ignored when
   *   `accepted` is false, so a caller may pass any placeholder (`-1`) rather than paying for a snapshot it
   *   will not use.
   * @param {boolean} accepted
   */
  function recordApplied(playerId, tick, accepted) {
    const pending = lastKeydown.get(playerId);
    lastKeydown.delete(playerId);
    if (!accepted || pending === undefined) return;

    const list = pendingFor(playerId);
    if (list.length >= MAX_PENDING_PER_PLAYER) list.shift(); // defensive; inputBufferSize is 2 in practice
    list.push({
      dirName: pending.dirName,
      keydownAtMs: pending.keydownAtMs,
      queuedAtMs: now(),
      queuedTick: tick,
    });
  }

  /**
   * Call once per frame with `RoundSimulation.getState()`, after `sim.advance()` for that frame and before
   * the renderer draws it. Detects every snake whose committed `direction` just changed and matches it
   * against the oldest still-pending queued turn for that player.
   *
   * @param {{tick: number, snakes: Array<{id: string, direction: Direction}>}} state
   */
  function observeState(state) {
    // Swept here, not only in `getStats()`: a stale entry (its snake died before it ever committed) must be
    // gone *before* the FIFO match below runs, or the very next real commit would pop it instead of the turn
    // that actually produced this direction change — matching the wrong sample to the wrong keydown.
    sweepStale();
    for (const snake of state.snakes) {
      const previous = lastDirection.get(snake.id);
      lastDirection.set(snake.id, snake.direction);
      if (previous === undefined || sameDirection(previous, snake.direction)) continue;

      const list = pendingCommit.get(snake.id);
      const entry = list?.shift();
      if (entry === undefined) continue; // a turn the simulation made on its own (there is no such thing
      // today, but this stays defensive rather than assuming) or a stale match after a round restart.

      awaitingRender.push({
        playerId: snake.id,
        dirName: entry.dirName,
        keydownAtMs: entry.keydownAtMs,
        queuedAtMs: entry.queuedAtMs,
        queuedTick: entry.queuedTick,
        committedAtMs: now(),
        committedTick: state.tick,
      });
    }
  }

  /**
   * Call once per frame, immediately after the renderer has drawn the state most recently passed to
   * `observeState`. Finalises every sample that became "committed" this same frame.
   */
  function markRendered() {
    if (awaitingRender.length === 0) return;
    const renderedAtMs = now();
    for (const entry of awaitingRender) {
      /** @type {InputLatencySample} */
      const sample = {
        playerId: entry.playerId,
        dirName: entry.dirName,
        queuedTick: entry.queuedTick,
        committedTick: entry.committedTick,
        stepWaitTicks: entry.committedTick - entry.queuedTick,
        totalMs: renderedAtMs - entry.keydownAtMs,
        overheadMs: entry.queuedAtMs - entry.keydownAtMs,
        stepWaitMs: entry.committedAtMs - entry.queuedAtMs,
        renderMs: renderedAtMs - entry.committedAtMs,
      };
      samples.push(sample);
      if (samples.length > historySize) samples.shift();
    }
    awaitingRender.length = 0;
  }

  /**
   * Drops anything mid-flight — pending turns and the last-known direction per player — without touching the
   * completed sample history. Call this when a round restarts: a fresh `RoundSimulation` resets every
   * snake's direction to its spawn heading, and without this a spawn heading that differs from the previous
   * round's final heading would be misread as a commit matching some stale pending entry from the round that
   * just ended.
   */
  function resetForRound() {
    lastKeydown.clear();
    pendingCommit.clear();
    awaitingRender.length = 0;
    lastDirection.clear();
  }

  /** Drops everything, samples included. Tests use this; a running game never needs to. */
  function clear() {
    resetForRound();
    samples.length = 0;
  }

  /** Sweeps pending entries older than `maxPendingAgeMs` (a snake that died before its turn ever committed). */
  function sweepStale() {
    const cutoff = now() - maxPendingAgeMs;
    for (const list of pendingCommit.values()) {
      while (list.length > 0 && list[0].queuedAtMs < cutoff) list.shift();
    }
  }

  /**
   * @returns {InputLatencyStats}
   */
  function getStats() {
    sweepStale();
    const totalMs = summarize(samples.map((s) => s.totalMs));
    const overheadMs = summarize(samples.map((s) => s.overheadMs));
    const stepWaitMs = summarize(samples.map((s) => s.stepWaitMs));
    const renderMs = summarize(samples.map((s) => s.renderMs));
    const ticks = samples.map((s) => s.stepWaitTicks).sort((a, b) => a - b);

    const bucketWidthMs = DEFAULT_BUCKET_WIDTH_MS;
    const buckets = new Array(DEFAULT_BUCKET_COUNT).fill(0);
    let overflowCount = 0;
    for (const sample of samples) {
      const index = Math.floor(sample.totalMs / bucketWidthMs);
      if (index >= 0 && index < buckets.length) buckets[index] += 1;
      else if (index >= buckets.length) overflowCount += 1;
      // A negative index (a clock that went backwards) is dropped rather than crashing the overlay.
    }

    return {
      enabled: true,
      sampleCount: samples.length,
      totalMs,
      overheadMs,
      stepWaitMs,
      renderMs,
      stepWaitTicks: {
        median: medianOfSorted(ticks),
        min: ticks.length > 0 ? ticks[0] : null,
        max: ticks.length > 0 ? ticks[ticks.length - 1] : null,
      },
      context: {
        simHz,
        snakeSpeed,
        ticksPerStepAtBaseSpeed: Math.round(simHz / snakeSpeed),
        stepMsAtBaseSpeed: 1000 / snakeSpeed,
      },
      histogram: { bucketWidthMs, buckets, overflowCount, metric: 'totalMs' },
      samples: [...samples],
    };
  }

  return {
    recordKeydown,
    recordApplied,
    observeState,
    markRendered,
    resetForRound,
    clear,
    getStats,
  };
}

/**
 * The shape `getStats()` returns when no tracker exists at all (`enableInputStats: false` — the default, and
 * every production load). `testHooks.js`'s `getInputStats()` returns exactly this rather than throwing, so
 * an overlay or a spec can call it unconditionally and branch on `enabled`.
 *
 * @returns {InputLatencyStats}
 */
export function disabledInputLatencyStats() {
  return {
    enabled: false,
    sampleCount: 0,
    totalMs: { median: null, p10: null, p90: null, min: null, max: null },
    overheadMs: { median: null, p10: null, p90: null, min: null, max: null },
    stepWaitMs: { median: null, p10: null, p90: null, min: null, max: null },
    renderMs: { median: null, p10: null, p90: null, min: null, max: null },
    stepWaitTicks: { median: null, min: null, max: null },
    context: {
      simHz: 120,
      snakeSpeed: 6,
      ticksPerStepAtBaseSpeed: 20,
      stepMsAtBaseSpeed: 1000 / 6,
    },
    histogram: {
      bucketWidthMs: DEFAULT_BUCKET_WIDTH_MS,
      buckets: [],
      overflowCount: 0,
      metric: 'totalMs',
    },
    samples: [],
  };
}
