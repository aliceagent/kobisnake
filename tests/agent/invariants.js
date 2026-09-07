// @ts-check
import { HUD_INTERVAL_SECONDS } from '../../src/game/session.js';
import { SETTINGS } from '../../src/core/settings.js';

/**
 * KI-03-03 — the per-frame invariants the 2026-09-07 agent QA pass (#119, `docs/qa/reports/2026-09-07-agent-
 * qa-pass.md`) ran by hand, as a reusable module `tests/agent/driver.js` ships into the page.
 *
 * ## Shape (tech-lead ruling on #122, ruling 3)
 *
 * {@link checkInvariants} is **one self-contained function with no free variables**: every helper is nested
 * inside it, nothing in its body references this module's top-level scope, and no import is used by the
 * function itself. The driver serialises it with `Function.prototype.toString()` and runs it inside the page
 * (`driver.js`'s header explains why: a Best-of-3 is thousands of frames, and round-tripping each one through
 * `page.evaluate` would cost minutes). A free variable in the body would compile in Node, pass every unit
 * test here, and then throw a `ReferenceError` the first time the driver actually runs a match — which is
 * exactly why `tests/agent/README.md` says to prove this by running a match through the driver, not only by
 * unit-testing it in Node (`invariants.spec.js` AC3 below does that).
 *
 * The two exports above the function are the one exception the ruling allows: values *this* module derives
 * on the **Node side** from the real source of truth, for the driver's caller to forward into `config`
 * (`playMatch`'s `invariantConfig`) rather than the function importing them itself. See
 * {@link HUD_TIMER_TOLERANCE_SECONDS} and {@link HUD_LENGTH_TOLERANCE} for the derivations, and
 * `invariants.spec.js` for where they are read back out and handed to the driver.
 *
 * ## Every check states the design rule it derives from
 *
 * The sprint's own risk entry ("mistaking design for defects") is #119 F4: the first version of the HUD check
 * reported 135 false problems a match because it compared the throttled HUD text against the simulation as if
 * they should always agree exactly. Every check below therefore names its authority in a comment —
 * `DESIGN-DECISIONS` or `ARCHITECTURE`, an issue number, or the exact line of source code that is the actual
 * rule when no design document states one (documented as such, not invented).
 */

/**
 * @typedef {{rule: string, detail: string}} Problem
 */

/**
 * How many *whole seconds* the HUD's timer text may show more than `Math.floor(snapshot.timeRemaining)`
 * before it counts as a problem.
 *
 * Not one number applied to both the timer and the lengths (tech-lead ruling on #122, ruling 4) — the timer
 * needs this integer-second bound because of `formatTime`'s own flooring, and {@link HUD_LENGTH_TOLERANCE}
 * below is a completely different quantity (a segment count, not a duration).
 *
 * The derivation: `session.js`'s `writeHud()` runs at most once every {@link HUD_INTERVAL_SECONDS} of wall
 * time (`ARCHITECTURE §8`'s 10 Hz throttle), so the *continuous* value it wrote can lag the current one by at
 * most that long — under the driver's own 60 fps stepping this is exact, not "up to": `HUD_INTERVAL_SECONDS`
 * (0.1 s) is six driven frames of exactly `1/60` s each, with no overshoot, so the accumulator crosses the
 * 0.1 s threshold on the frame it reaches it, never later. `session.js`'s `formatTime` then floors that
 * continuous value to whole seconds. Flooring a value that is stale by less than one second can only ever
 * move the displayed integer by one — never more, and never in the direction of showing *less* time than is
 * actually left, since `timeRemaining` only ever counts down. `Math.ceil` is the formula that says exactly
 * that: for any stale-by-less-than-a-second lag, the floors of "then" and "now" differ by at most
 * `Math.ceil(lag)`, which is 1 for `HUD_INTERVAL_SECONDS = 1/10`. If the throttle interval were ever tuned up
 * near or past a second, this recomputes the right answer instead of silently staying wrong at 1.
 */
export const HUD_TIMER_TOLERANCE_SECONDS = Math.ceil(HUD_INTERVAL_SECONDS);

/**
 * The fastest a snake can ever complete one grid step: base speed times the only multiplier that ever
 * *raises* it (Speed Boost — Slow only lowers it, and `core/snake.js`'s `recomputeSpeedMultiplier` allows at
 * most one active effect per type, so the two can combine but never stack with themselves). `core/snake.js`'s
 * own `accumulate()` comment quotes this exact number ("the fastest speed in the design — 9 cells/s under
 * Speed Boost"), which is the authority this reads it from rather than re-deriving it independently.
 */
const FASTEST_STEP_SECONDS = 1 / (SETTINGS.snakeSpeed * SETTINGS.speedBoost.multiplier);

/**
 * How many segments the HUD's length readout may lag the true `length` before it counts as a problem.
 *
 * A snake's `length` (`= segments.length`) increases by exactly one segment per completed grid step,
 * regardless of how many apples are queued in `pendingGrowth` — `core/snake.js`'s `commitStep` pays off at
 * most one pending growth per step (`pendingGrowth -= 1`, once). So the number of times `length` can grow
 * inside one HUD write window is bounded by how many grid steps can complete in that window, and the
 * *fastest* a step can ever complete is {@link FASTEST_STEP_SECONDS} (≈ 0.111 s at the shipped defaults) —
 * longer than {@link HUD_INTERVAL_SECONDS} (0.1 s), so at most one step, hence at most one segment, can land
 * inside a single throttle window. `Math.ceil(HUD_INTERVAL_SECONDS / FASTEST_STEP_SECONDS)` is that bound
 * made general: it stays correct (not just "1") if either number is ever tuned.
 */
export const HUD_LENGTH_TOLERANCE = Math.max(
  1,
  Math.ceil(HUD_INTERVAL_SECONDS / FASTEST_STEP_SECONDS),
);

/**
 * The per-frame checks. Every simulated frame, `driver.js` calls this with the live snapshot, the HUD's
 * current DOM text, the game state name, and whatever `config` the caller passed as `invariantConfig`.
 *
 * `config` carries three things this function may not otherwise know, because it must not import them
 * (ruling 3): `grid: {width, height}` (`DESIGN-DECISIONS §2.1`'s 24×24 arena — defaulted below so a unit test
 * that does not care about grid size need not pass it), `hudTimerToleranceSeconds`
 * ({@link HUD_TIMER_TOLERANCE_SECONDS}) and `hudLengthTolerance` ({@link HUD_LENGTH_TOLERANCE}).
 *
 * @param {object} input
 * @param {object} input.snapshot - `RoundSimulation.getState()` (never `null` — the driver does not call
 *   this function when `getSnapshot()` is `null`).
 * @param {{timerText: string | null, p1Text: string | null, p2Text: string | null}} input.hud
 * @param {string} input.state - the game state name for this frame.
 * @param {{grid?: {width: number, height: number}, hudTimerToleranceSeconds?: number,
 *   hudLengthTolerance?: number}} [input.config]
 * @returns {Problem[]}
 */
export function checkInvariants(input) {
  const { snapshot, hud, config: rawConfig } = input;
  const config = rawConfig ?? {};
  // DESIGN-DECISIONS §2.1: the arena is 24x24 and that number never changes (CLAUDE.md "never list"), so a
  // caller that has nothing more specific in mind (every unit test below, for instance) gets the real grid
  // rather than having to know to pass it.
  const grid = config.grid ?? { width: 24, height: 24 };
  const hudTimerToleranceSeconds = config.hudTimerToleranceSeconds ?? 1;
  const hudLengthTolerance = config.hudLengthTolerance ?? 1;

  /** @type {Problem[]} */
  const problems = [];
  /**
   * @param {string} rule
   * @param {string} detail
   */
  function report(rule, detail) {
    problems.push({ rule, detail });
  }

  const snakes = snapshot.snakes ?? [];

  for (const snake of snakes) {
    const segments = snake.segments ?? [];

    // segments-in-bounds (DESIGN-DECISIONS §2.1: 24x24 arena, origin bottom-left).
    for (const cell of segments) {
      if (cell.x < 0 || cell.x > grid.width - 1 || cell.y < 0 || cell.y > grid.height - 1) {
        report(
          'segments-in-bounds',
          `${snake.id}'s segment (${cell.x}, ${cell.y}) is outside the ${grid.width}x${grid.height} grid`,
        );
      }
    }

    // segments-integral (ARCHITECTURE §4: "cell = 1 world unit" — a segment is a lattice cell, never a
    // fractional position; interpolation happens in the renderer via `stepProgress`, never in `segments`).
    for (const cell of segments) {
      if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
        report('segments-integral', `${snake.id} has a non-integer segment cell (${cell.x}, ${cell.y})`);
      }
    }

    // no-self-overlap, while alive (DESIGN-DECISIONS §2.5: death is evaluated in order "wall/laser, self, ...
    // other snake body, other snake head" — a living snake's own segments never revisit a cell it still
    // occupies, because that is exactly the death it would already have taken).
    if (snake.alive) {
      const seen = new Set();
      for (const cell of segments) {
        const key = `${cell.x},${cell.y}`;
        if (seen.has(key)) {
          report('no-self-overlap', `${snake.id} occupies (${cell.x}, ${cell.y}) more than once while alive`);
        }
        seen.add(key);
      }
    }

    // length-matches-segments (core/round.js's getState(): `length: snake.segments.length` is how the
    // snapshot itself defines the field — this is the shape the snapshot promises, made explicit).
    if (snake.length !== segments.length) {
      report(
        'length-matches-segments',
        `${snake.id} length=${snake.length} but segments.length=${segments.length}`,
      );
    }

    // step-progress-range (ARCHITECTURE §5: "Renderer receives alpha = snake.stepProgress (0..1)"). A small
    // epsilon (looser than `core/snake.js`'s own internal `1e-9` step-completion guard) allows for floating
    // point, not for a real defect — a genuine bug reads as a value nowhere near the [0, 1] band.
    const stepProgressEpsilon = 1e-6;
    if (
      typeof snake.stepProgress !== 'number' ||
      Number.isNaN(snake.stepProgress) ||
      snake.stepProgress < -stepProgressEpsilon ||
      snake.stepProgress > 1 + stepProgressEpsilon
    ) {
      report('step-progress-range', `${snake.id} stepProgress=${snake.stepProgress} outside [0, 1]`);
    }

    // speed-multiplier-positive-finite (core/snake.js's recomputeSpeedMultiplier: the product of active
    // effect multipliers, all of which DESIGN-DECISIONS §1 rows 3/4 define as positive numbers, so the
    // product can never be zero, negative, infinite or NaN).
    if (!(Number.isFinite(snake.speedMultiplier) && snake.speedMultiplier > 0)) {
      report(
        'speed-multiplier-positive-finite',
        `${snake.id} speedMultiplier=${snake.speedMultiplier}`,
      );
    }

    // pending-growth-non-negative (core/snake.js: `grow()` only adds, `commitStep()` only subtracts 1 while
    // strictly positive, so pendingGrowth can never go negative).
    if (!(Number.isFinite(snake.pendingGrowth) && snake.pendingGrowth >= 0)) {
      report('pending-growth-non-negative', `${snake.id} pendingGrowth=${snake.pendingGrowth}`);
    }

    // no-head-in-dead-zone, living heads only (ARCHITECTURE §4: the dead zone is any cell with
    // `x < inset || x >= width - inset`, same for y; `core/lasers.js`'s `safeRegion` is the inclusive square
    // `[inset, width - 1 - inset]` on both axes — DESIGN-DECISIONS §2.4: "the head entering or being inside
    // the dead zone when the laser steps onto it dies", so a *living* head is never inside it. A dead
    // snake's frozen corpse can sit in the dead zone — that is how it died — so this does not apply to it.)
    if (snake.alive && segments.length > 0) {
      const inset = snapshot.lasers?.inset ?? 0;
      const head = segments[0];
      const minSafe = inset;
      const maxSafeX = grid.width - 1 - inset;
      const maxSafeY = grid.height - 1 - inset;
      if (head.x < minSafe || head.x > maxSafeX || head.y < minSafe || head.y > maxSafeY) {
        report(
          'no-head-in-dead-zone',
          `${snake.id}'s living head at (${head.x}, ${head.y}) is inside the laser dead zone (inset ${inset})`,
        );
      }
    }
  }

  // time-remaining-finite-non-negative (ARCHITECTURE §4: the round clock; DESIGN-DECISIONS §2.1 "the timer
  // counts simulated seconds"). `null` is practice mode, which has no clock — not a violation (tech-lead
  // ruling on #122, ruling 6).
  if (snapshot.timeRemaining !== null && snapshot.timeRemaining !== undefined) {
    if (!(Number.isFinite(snapshot.timeRemaining) && snapshot.timeRemaining >= 0)) {
      report('time-remaining-finite-non-negative', `timeRemaining=${snapshot.timeRemaining}`);
    }
  }

  // no-apple-under-snake, living snakes only. **Narrowed**: `core/round.js`'s `occupiedCells()` (what
  // `eatIfApple`'s respawn is checked against) skips dead snakes on purpose, and a death ends the round on
  // the very same tick a surviving snake's apple can respawn (`core/round.js`: the deaths loop marks
  // `alive = false` before the survivors' `commitStep`/`eatIfApple` loops run). So a fresh apple can, by the
  // engine's own documented occupancy rule, legally land on a cell a snake's corpse still occupies in the
  // final frame of a round that ended in a kill. No `DESIGN-DECISIONS` row states this either way — it falls
  // out of `occupiedCells()`'s definition — so this is disclosed rather than invented, and the check is
  // scoped to *living* snakes only, matching what the engine actually protects.
  {
    const livingOccupied = new Set();
    for (const snake of snakes) {
      if (!snake.alive) continue;
      for (const cell of snake.segments ?? []) livingOccupied.add(`${cell.x},${cell.y}`);
    }
    for (const apple of snapshot.apples ?? []) {
      if (apple === null || apple === undefined) continue;
      if (livingOccupied.has(`${apple.x},${apple.y}`)) {
        report('no-apple-under-snake', `apple at (${apple.x}, ${apple.y}) sits on a living snake's segment`);
      }
    }
  }

  // apples-no-shared-row-or-column (DESIGN-DECISIONS §2.3 "Apples never line up", issue #102). **Narrowed**:
  // that same section documents the fallback ladder a shrinking arena walks when nothing fits —
  // "drop the row/column rule, then apple distance 2, 1, 0" — so once the lasers have moved in at all
  // (`inset > 0`), a placement can legally violate this rule rather than leave a slot empty. The rule is
  // therefore only guaranteed at the full board size, and only checked then.
  if ((snapshot.lasers?.inset ?? 0) === 0) {
    const apples = (snapshot.apples ?? []).filter((apple) => apple !== null && apple !== undefined);
    for (let i = 0; i < apples.length; i += 1) {
      for (let j = i + 1; j < apples.length; j += 1) {
        const a = apples[i];
        const b = apples[j];
        if (a.x === b.x || a.y === b.y) {
          report(
            'apples-no-shared-row-or-column',
            `apples at (${a.x}, ${a.y}) and (${b.x}, ${b.y}) share a row or column`,
          );
        }
      }
    }
  }

  // hud-timer-agrees (ARCHITECTURE §8's 10 Hz throttle; see HUD_TIMER_TOLERANCE_SECONDS's derivation above).
  // The HUD can only be *stale*, i.e. show a time no smaller than the truth right now, floored the same way
  // `session.js`'s own `formatTime` does — inlined here rather than imported, since the serialised function
  // may reference nothing outside itself (ruling 3).
  if (
    snapshot.timeRemaining !== null &&
    snapshot.timeRemaining !== undefined &&
    typeof hud?.timerText === 'string'
  ) {
    const match = /^(\d+):(\d{2})$/.exec(hud.timerText);
    if (match !== null) {
      const hudSeconds = Number(match[1]) * 60 + Number(match[2]);
      const trueFloorSeconds = Math.floor(Math.max(0, snapshot.timeRemaining));
      const lag = hudSeconds - trueFloorSeconds;
      if (lag < 0 || lag > hudTimerToleranceSeconds) {
        report(
          'hud-timer-agrees',
          `hud shows "${hud.timerText}" (${hudSeconds}s) but timeRemaining is ${snapshot.timeRemaining}s ` +
            `(floors to ${trueFloorSeconds}s, tolerance ${hudTimerToleranceSeconds}s)`,
        );
      }
    }
  }

  // hud-lengths-agree (same throttle; see HUD_LENGTH_TOLERANCE's derivation above). The HUD can only be
  // stale, i.e. show a length no larger than the truth right now (`length` only ever grows).
  const hudLengthTexts = [hud?.p1Text, hud?.p2Text];
  for (let i = 0; i < snakes.length && i < hudLengthTexts.length; i += 1) {
    const text = hudLengthTexts[i];
    if (typeof text !== 'string') continue;
    const match = /(-?\d+)\s*$/.exec(text);
    if (match === null) continue;
    const hudLength = Number(match[1]);
    const trueLength = snakes[i].length;
    const lag = trueLength - hudLength;
    if (lag < 0 || lag > hudLengthTolerance) {
      report(
        'hud-lengths-agree',
        `hud shows "${text}" (length ${hudLength}) but ${snakes[i].id}'s true length is ${trueLength} ` +
          `(tolerance ${hudLengthTolerance})`,
      );
    }
  }

  return problems;
}
