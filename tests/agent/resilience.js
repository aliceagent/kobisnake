// @ts-check
import { createRng } from '../../src/core/rng.js';

/**
 * KI-06-04 — the chaos pass: a seeded schedule of real WebGL context losses and restores, played against a
 * whole match through `tests/agent/driver.js`, proving KI-06-01's recovery on the real path rather than only
 * in the unit and e2e layers that exercise it one loss at a time.
 *
 * ## Shape
 *
 * This module holds the **pure, seeded parts** — {@link buildChaosSchedule} and
 * {@link chaosScheduleToEvents} — so a failure names a seed that reproduces it and so the schedule is provable
 * in Node without a browser (`resilience.test.js`). `resilience.spec.js` is the half that actually drives a
 * match: it turns a schedule into `driver.js`'s `chaosEvents` option and plays it, the way `pacing.js` /
 * `pacing.spec.js` / `pacing.test.js` split for the same reason (`tests/agent/README.md`, "the module holds the
 * pure parts, the spec plays the matches, the test proves the pure parts in Node").
 *
 * `driver.js` is where the schedule actually touches `WEBGL_lose_context` — this module never does, and never
 * imports anything DOM-shaped, so it stays plain Node.
 */

/** AC1's own number: every match this ticket plays must be interrupted at least this many times. */
export const MIN_INTERRUPTIONS = 3;

/**
 * The frame window every interruption is scheduled inside, and why it is safe for the pairing
 * `resilience.spec.js` plays (greedy vs survivor, the same ten seeds `docs/qa/playtests/agent-run.md` and
 * `tests/agent/playtest.spec.js` use).
 *
 * `tests/e2e/helpers.js`'s `COUNTDOWN_SECONDS` fixes the first round's countdown at 3.2 s — 192 frames at the
 * driver's `FRAME_SECONDS` — so `PLAYING` begins at frame 192 on every seed, every pairing, regardless of
 * policy. `docs/qa/playtests/agent-run.md`'s own machine-readable block reports this exact pairing's shortest
 * observed round, over these exact ten seeds, at `minSeconds: 15.5` — 930 frames of `PLAYING` — so the
 * earliest any round of this run can end is frame 192 + 930 = 1122. A Best-of-3 needs at least two rounds to
 * finish, so 1122 is a lower bound on the *whole match*, not just the first round.
 *
 * {@link WINDOW_START_FRAME} (300) and {@link WINDOW_END_FRAME} (800) sit well inside that bound on both
 * sides — 108 frames after `PLAYING` starts, 322 frames before the shortest round could end — so every
 * scheduled interruption lands inside a live, running round rather than racing the countdown at one end or a
 * round's own close at the other.
 */
export const WINDOW_START_FRAME = 300;

/** See {@link WINDOW_START_FRAME}. */
export const WINDOW_END_FRAME = 800;

/** How many frames a restore may lag its own loss, at minimum — half a second is plenty to be a real gap. */
const MIN_RESTORE_DELAY_FRAMES = 20;

/** How many frames a restore may lag its own loss, at most — under a second, so three fit the window. */
const MAX_RESTORE_DELAY_FRAMES = 50;

/** The gap a schedule always leaves between one interruption's restore and the next one's loss. */
const MIN_GAP_FRAMES = 30;

/**
 * @typedef {object} ChaosInterruption
 * @property {number} lossFrame - the driven frame `driver.js` fires `WEBGL_lose_context`'s `loseContext()` on.
 * @property {number} restoreFrame - the driven frame it fires `restoreContext()` on. Always `> lossFrame`.
 */

/**
 * A seeded, pure schedule of context-loss/restore pairs — the frames at which a loss happens and how many
 * frames later the restore does, derived through `src/core/rng.js` rather than `Math.random` (`CLAUDE.md`
 * "Determinism"), so a failing seed reproduces the exact same schedule on a replay.
 *
 * The window is split into `interruptionCount` equal slots, in order, so interruptions never reorder or
 * collide: each slot reserves room at its end for the widest possible restore delay plus the mandatory gap
 * before the next slot's loss, and the loss itself is placed at a random offset inside what is left. Every
 * event this produces satisfies `lossFrame < restoreFrame` and, for two consecutive interruptions, `restoreFrame
 * (i) + minGapFrames <= lossFrame (i + 1)`.
 *
 * @param {number} seed
 * @param {object} [options]
 * @param {number} [options.interruptionCount] - default {@link MIN_INTERRUPTIONS}.
 * @param {number} [options.windowStartFrame] - default {@link WINDOW_START_FRAME}.
 * @param {number} [options.windowEndFrame] - default {@link WINDOW_END_FRAME}.
 * @param {number} [options.minRestoreDelayFrames] - default {@link MIN_RESTORE_DELAY_FRAMES}.
 * @param {number} [options.maxRestoreDelayFrames] - default {@link MAX_RESTORE_DELAY_FRAMES}.
 * @param {number} [options.minGapFrames] - default {@link MIN_GAP_FRAMES}.
 * @returns {ChaosInterruption[]}
 */
export function buildChaosSchedule(seed, options = {}) {
  const {
    interruptionCount = MIN_INTERRUPTIONS,
    windowStartFrame = WINDOW_START_FRAME,
    windowEndFrame = WINDOW_END_FRAME,
    minRestoreDelayFrames = MIN_RESTORE_DELAY_FRAMES,
    maxRestoreDelayFrames = MAX_RESTORE_DELAY_FRAMES,
    minGapFrames = MIN_GAP_FRAMES,
  } = options;

  if (!Number.isInteger(interruptionCount) || interruptionCount < 1) {
    throw new RangeError('buildChaosSchedule: interruptionCount must be a positive integer');
  }
  if (windowEndFrame <= windowStartFrame) {
    throw new RangeError(
      'buildChaosSchedule: windowEndFrame must be greater than windowStartFrame',
    );
  }

  const totalWindow = windowEndFrame - windowStartFrame;
  const slotWidth = Math.floor(totalWindow / interruptionCount);
  const reserved = maxRestoreDelayFrames + minGapFrames;
  if (slotWidth <= reserved) {
    throw new RangeError(
      `buildChaosSchedule: window (${totalWindow} frames) too small for ${interruptionCount} ` +
        `interruptions (slot ${slotWidth} <= reserved ${reserved})`,
    );
  }

  const rng = createRng(seed);
  /** @type {ChaosInterruption[]} */
  const schedule = [];
  for (let i = 0; i < interruptionCount; i += 1) {
    const slotStart = windowStartFrame + i * slotWidth;
    const jitterRange = slotWidth - reserved;
    const lossFrame = slotStart + rng.int(jitterRange + 1);
    const restoreDelay =
      minRestoreDelayFrames + rng.int(maxRestoreDelayFrames - minRestoreDelayFrames + 1);
    schedule.push({ lossFrame, restoreFrame: lossFrame + restoreDelay });
  }
  return schedule;
}

/**
 * @typedef {{frame: number, type: 'lose' | 'restore'}} ChaosEvent
 */

/**
 * Flattens a {@link buildChaosSchedule} result into the sorted `{frame, type}` list `driver.js`'s
 * `playMatch({chaosEvents})` option takes — the shape the driven loop can walk with a single index, one event
 * at a time, rather than reasoning about loss/restore pairs while it runs.
 *
 * @param {ChaosInterruption[]} schedule
 * @returns {ChaosEvent[]}
 */
export function chaosScheduleToEvents(schedule) {
  /** @type {ChaosEvent[]} */
  const events = [];
  for (const { lossFrame, restoreFrame } of schedule) {
    events.push({ frame: lossFrame, type: 'lose' });
    events.push({ frame: restoreFrame, type: 'restore' });
  }
  events.sort((a, b) => a.frame - b.frame);
  return events;
}

/**
 * Every reason a chaos-driven run is not healthy, in `driver.js`'s `failureReasons` style — a pure function so
 * a spec asserts one thing and the rule is unit-testable without a browser.
 *
 * This is deliberately narrower than `failureReasons` (which already covers "did not finish", page errors and
 * invariant problems) and is meant to run alongside it. Its own job is the one thing `failureReasons` cannot
 * see: whether the chaos this ticket asked for actually **happened** — the tech-lead ruling on #285 that a
 * schedule which plans interruptions and a page that delivers none must fail, not silently pass as ten clean
 * matches. `driver.js` counts the real `webglcontextlost`/`webglcontextrestored` events, not the calls that
 * asked for them, so a missing `WEBGL_lose_context` extension or a browser that never delivers the event shows
 * up here as a real, named failure.
 *
 * @param {import('./driver.js').MatchResult[]} results
 * @param {number} [minInterruptions] - default {@link MIN_INTERRUPTIONS}.
 * @returns {string[]}
 */
export function chaosFailureReasons(results, minInterruptions = MIN_INTERRUPTIONS) {
  /** @type {string[]} */
  const reasons = [];
  for (const result of results) {
    const where = `seed ${result.seed}`;
    const chaos = /** @type {{lostCount: number, restoredCount: number} | null | undefined} */ (
      result.chaos
    );
    if (chaos === null || chaos === undefined) {
      reasons.push(`${where}: no chaos was recorded — chaosEvents was never wired to this match`);
      continue;
    }
    if (chaos.lostCount < minInterruptions) {
      reasons.push(
        `${where}: only ${chaos.lostCount} real webglcontextlost event(s) landed, wanted >= ` +
          `${minInterruptions} — the schedule planned interruptions the page never delivered`,
      );
    }
    if (chaos.restoredCount < chaos.lostCount) {
      reasons.push(
        `${where}: ${chaos.lostCount} context loss(es) but only ${chaos.restoredCount} restore(s) — ` +
          'the match is owed a restore it never got',
      );
    }
  }
  return reasons;
}
