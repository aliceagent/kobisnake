// @ts-check

/**
 * KI-03-01 — the agent playtest driver.
 *
 * A fourth test layer (`QA-STRATEGY §1` has three: unit, simulation, end-to-end). `tests/sim` proves the
 * simulation headlessly and `tests/e2e` scripts individual behaviours; **nothing plays a whole match through
 * the whole stack**, which is why #119's F1 and F2 survived seven sprints and 643 green tests. This module
 * plays whole matches in a real browser against the built site, through the real `keydown` listener, the
 * real session, the real state machine and real renders, and hands back a plain result object per match.
 *
 * ## Everything happens inside one `page.evaluate`
 *
 * A Best-of-3 is a few thousand simulated frames. Round-tripping each one through `page.evaluate` to ask for
 * a snapshot and hand back a key would cost minutes per match, so {@link playMatch} ships the whole loop into
 * the page once and gets one result back. That is what fixes the shape of everything this module drives:
 *
 * - a **policy** and the **invariants module** are each a single self-contained function with no free
 *   variables — no imports referenced from the body, nothing captured from module scope — because the driver
 *   ships them into the page as source text (`Function.prototype.toString()`). `tests/e2e/helpers.js`
 *   documents the identical constraint for the same reason.
 * - anything derived on the Node side (the HUD tolerance of KI-03-03, say) is passed **in** as `config`
 *   rather than imported by the serialised function.
 * - and because they are ordinary exported functions, they stay unit-testable in plain Node against a
 *   hand-built snapshot, which is what KI-03-02 AC3 and KI-03-03 AC1 ask for.
 *
 * ## What it does *not* do
 *
 * It does not judge whether the game is fun. That is Gate 1 (KS-07-02) and no agent can report it. It does
 * not replace `tests/e2e` or `tests/sim` — this layer adds, never substitutes.
 */

/**
 * Simulated seconds per driven frame: 60 fps, the frame a real browser hands `loop.js`.
 *
 * Not a free choice. `RoundSimulation.advance` accumulates in tick units, so the *simulation* is indifferent
 * to frame size — but the session's wall-time beats (the countdown's four 0.8 s steps, the scoreboard, the
 * crash slow-mo) are `remaining -= unscaledDt` counters, so frame size decides which tick a round begins on.
 * KS-06-00 (#84) is the whole story. 1/60 is the honest answer: what a browser at 60 fps actually produces.
 */
export const FRAME_SECONDS = 1 / 60;

/**
 * How many driven frames pass between renders — one render every **four simulated seconds** at
 * {@link FRAME_SECONDS}.
 *
 * **Measured on this project's CI-shaped container, at `playwright.config.js`'s 1280×720 viewport: one
 * `renderer.render()` costs ≈ 124 ms** under Chromium's software WebGL (SwiftShader), against ≈ 0.04 ms for
 * one `__kobi.advance` frame — three thousand times cheaper. Rendering every frame turned a single
 * Best-of-3 into **196 s** (1 728 frames, 1 728 renders). Ten matches at one render every two simulated
 * seconds still cost 46.7 s of a 60 s budget, essentially all of it in the 381 renders; at this cadence the
 * same ten cost ≈ 24 s. `?reducedFx=1` changes nothing (121 ms) and a quarter-size viewport only halves it
 * (66 ms at 640×360), so the floor is the shadow pass rather than the pixels, and the cadence is the only
 * honest lever.
 *
 * Four seconds is sparse on purpose. Rendering is not what this layer tests — `tests/visual` owns pixels at
 * this same viewport, and `tests/e2e` owns individual rendered behaviours. What the renders buy here is that
 * the real render path runs against real match state at every beat of a real match (a 16 s round gets 4
 * renders, a full-length one 22, and ten matches ≈ 190 spanning countdown, play, warning, closing,
 * scoreboard and match-over) and that `getDrawCalls()` has something to sample against `ARCHITECTURE §12`'s
 * budget. A caller that wants a denser or sparser sample passes its own `renderEveryNFrames`.
 *
 * **Simulation, input and the HUD still run on every frame**, rendered or not: `__kobi.advance` drives
 * `session.runUpdate`, which is the same function a rendered frame runs — state transitions, the countdown
 * and scoreboard beats, `ui.hud.tick` and the 10 Hz HUD write included. The only thing skipped is
 * `renderer.render()`, which by construction cannot affect simulation state (`session.js`'s `drawFrame`
 * reads a snapshot and never writes one). `playtest.spec.js`'s AC2 test asserts exactly that, over two
 * simulated seconds of unrendered frames.
 */
export const RENDER_EVERY_N_FRAMES = 240;

/**
 * The frame budget one match gets before {@link playMatch} gives up and reports `finished: false`.
 *
 * 30 000 frames is 500 simulated seconds — comfortably more than a Best-of-3 of three full-length 90 s
 * rounds with their countdowns and scoreboards (≈ 290 s), and deliberately finite: **a match of draws never
 * ends on this build** (#119 F1, `DESIGN-DECISIONS §1 row 26` ruled but unimplemented — I01/#120), so an
 * unbounded "play until MATCH_OVER" loop is a hang, not a test. A caller that wants to *measure* that — the
 * idle policy does — passes its own smaller `maxFrames` and reads `finished`.
 */
export const DEFAULT_MAX_FRAMES = 30_000;

/** How many invariant problems a result carries in full before it only counts them. */
const MAX_REPORTED_PROBLEMS = 50;

/**
 * KI-06-04: how long `runMatchInPage`'s chaos loop waits for a triggered `webglcontextlost`/
 * `webglcontextrestored` to actually arrive before moving on. Real delivery is effectively instant in every
 * observed run — this bound exists only so a browser that never delivers the event turns into a short count
 * `chaosFailureReasons` reports by name, rather than a hung page and a suite-wide timeout that names nothing.
 */
const DEFAULT_CHAOS_EVENT_TIMEOUT_MS = 2000;

/**
 * @typedef {'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | null} PolicyMove
 */

/**
 * KI-06-04 — one instruction in an optional chaos schedule: fire a real WebGL context loss or restore on the
 * driven frame named by `frame`. Plain data, not a function — `tests/agent/resilience.js`'s
 * `buildChaosSchedule`/`chaosScheduleToEvents` build the list, seeded and pure; this module only ever consumes
 * it. See {@link playMatch}'s `chaosEvents` option and this file's header on why the loop has to `await` to
 * deliver one.
 *
 * @typedef {{frame: number, type: 'lose' | 'restore'}} ChaosEvent
 */

/**
 * What a policy is handed. Everything a policy needs and nothing it would have to look up itself.
 *
 * @typedef {object} PolicyView
 * @property {object} snapshot - `__kobi.getSnapshot()`: the live `RoundSimulation.getState()`. Note the two
 *   shapes that cost #119's scratch run two failed starts — `snapshot.powerUps` is
 *   `{pickups: [{cell, type}]}`, not an array, and `snapshot.lasers` is `{phase, inset, insetCells}` with
 *   **no bounds**; the safe square is `[inset, width - 1 - inset]` on both axes.
 * @property {number} playerIndex - 0 for player 1, 1 for player 2 (the index into `snapshot.snakes`).
 * @property {{width: number, height: number}} grid
 * @property {number} decisionIndex - how many decisions this policy has been asked for in this round, from 0.
 */

/**
 * One round, as the driver saw it happen.
 *
 * @typedef {object} RoundRecord
 * @property {number} index - 0-based round number within the match.
 * @property {string | null} result - `P1_WIN | P2_WIN | DRAW`.
 * @property {string | null} endReason - `DEATH | TIMEOUT`.
 * @property {string | null} winnerId
 * @property {number} ticks - the simulation tick the round ended on.
 * @property {number} seconds - `ticks` in simulated seconds.
 * @property {number[]} lengths - both snakes' final lengths, player order.
 * @property {boolean} reachedLaserPhase - the beams left `PARKED` at some point in this round. This is F3's
 *   own measurement ("only 4 of 27 rounds lasted long enough to see a laser"), so it is recorded per round
 *   rather than derived from the clock afterwards.
 * @property {string} laserPhaseAtEnd
 * @property {number} maxLaserInset
 */

/**
 * @typedef {object} MatchResult
 * @property {number} seed
 * @property {number} bestOf
 * @property {boolean} finished - the match reached `MATCH_OVER` inside its frame budget.
 * @property {RoundRecord[]} rounds
 * @property {object | null} match - `__kobi.getMatch()`: wins, winner, roundsPlayed.
 * @property {string[]} statesVisited
 * @property {number} frames
 * @property {number} renders
 * @property {number} maxDrawCalls - against `ARCHITECTURE §12`'s budget of 120.
 * @property {number} problemCount
 * @property {{rule: string, detail: string, frame: number, round: number}[]} problems - the first
 *   {@link MAX_REPORTED_PROBLEMS}; `problemCount` is the true total.
 * @property {string[]} pageErrors - uncaught exceptions and `console.error` output from the page
 *   (`QA-STRATEGY §8`: "console has zero errors during a full match").
 * @property {number} wallMs
 * @property {{lostCount: number, restoredCount: number} | null} chaos - KI-06-04: `null` when `playMatch` was
 *   not given `chaosEvents`. Otherwise the **real** `webglcontextlost`/`webglcontextrestored` events the page
 *   observed — counted from the events themselves, not from how many times the loop asked for one, so a
 *   missing `WEBGL_lose_context` extension or an event the browser never delivered shows up as a short count
 *   rather than a silently clean run (`tests/agent/resilience.js`'s `chaosFailureReasons` reads this).
 */

/**
 * The loop, as it runs **inside the page**. Written as a top-level function taking one bag of arguments
 * rather than a closure, because `page.evaluate` serialises it: it may not reference anything in this
 * module's scope.
 *
 * **`async` for KI-06-04, and only for it.** `WEBGL_lose_context`'s `loseContext()`/`restoreContext()` fire
 * their events asynchronously — a queued task, not something that can land inside one synchronous loop — so
 * delivering one for real requires yielding the loop after asking for it. `chaosEvents` is the only thing
 * that ever does that: with it `null` (every caller before this ticket, and every caller that never passes
 * it), the chaos block below never runs and the loop `await`s nothing, so this stays exactly the tight
 * synchronous loop it always was for a caller that does not opt in.
 *
 * @param {object} args
 * @returns {Promise<object>}
 */
async function runMatchInPage(args) {
  const {
    bestOf,
    powerUpsEnabled,
    settingsOverrides,
    frameSeconds,
    renderEveryNFrames,
    maxFrames,
    maxReportedProblems,
    policySources,
    invariantsSource,
    invariantConfig,
    chaosEvents,
    chaosEventTimeoutMs,
  } = args;

  const kobi = /** @type {any} */ (globalThis).__kobi;
  const doc = /** @type {any} */ (globalThis).document;
  /** `new Function` rather than `eval`: the sources arrive as plain text (see this module's header). */
  const compile = (src) => (src === null ? null : new Function('return (' + src + ')')());
  const policies = [compile(policySources[0]), compile(policySources[1])];
  const checkInvariants = compile(invariantsSource);

  // Settings first, match second: `session.js` reads `settings` when it constructs each round, so a tree
  // applied here reaches every round of this match including the first (KI-04-01).
  if (settingsOverrides !== null) kobi.setSettingsOverrides(settingsOverrides);

  const overrides = { bestOf };
  if (powerUpsEnabled !== null) overrides.powerUps = powerUpsEnabled;
  kobi.startMatch(overrides);

  const grid = { width: 24, height: 24 };
  const statesVisited = [];
  const rounds = [];
  const problems = [];
  let problemCount = 0;
  let frames = 0;
  let renders = 0;
  let maxDrawCalls = 0;
  let previousState = null;
  let roundIndex = 0;
  let reachedLaserPhase = false;
  let maxLaserInset = 0;
  /** Last head cell each policy decided from, so a policy is asked once per grid step, not once per frame. */
  let lastHeadKeys = [null, null];
  let decisionIndex = [0, 0];

  const readHud = () => ({
    timerText: doc.querySelector('.hud-timer')?.textContent ?? null,
    p1Text: doc.querySelector('.hud-player--p1')?.textContent ?? null,
    p2Text: doc.querySelector('.hud-player--p2')?.textContent ?? null,
  });

  // KI-06-04: an opt-in chaos source. `chaosEvents` is `null` for every caller before this ticket, in which
  // case none of this runs — `chaos` stays `null` and the returned `MatchResult.chaos` says so.
  //
  // The two listeners below are permanent, for the whole match, and are how the **real** counts are taken —
  // never how many times the loop asked `loseContext()`/`restoreContext()` for one (the driver may ask on a
  // menu screen where nothing is listening, or the extension may simply not exist), because a chaos pass that
  // reports the calls it made rather than the events the page actually saw would report ten clean matches on
  // a build that silently never wired the recovery path at all — precisely the risk this ticket exists to
  // close (`tests/agent/resilience.js`'s `chaosFailureReasons` reads these counts back out).
  let chaos = null;
  if (chaosEvents !== null) {
    const canvas = /** @type {any} */ (doc.getElementById('game'));
    const gl = canvas === null ? null : canvas.getContext('webgl2');
    const ext = gl === null ? null : gl.getExtension('WEBGL_lose_context');
    chaos = { canvas, ext, lostCount: 0, restoredCount: 0, nextIndex: 0 };
    if (canvas !== null) {
      canvas.addEventListener('webglcontextlost', () => {
        chaos.lostCount += 1;
      });
      canvas.addEventListener('webglcontextrestored', () => {
        chaos.restoredCount += 1;
      });
    }
  }

  /**
   * Real milliseconds the loop waits after a chaos event is delivered before it may trigger the next one.
   *
   * Not part of `chaosEventTimeoutMs` — that bounds how long the loop waits *for* an event; this is a
   * settle time *after* one arrives, and both are needed for a different reason. Measured directly against
   * this build: `restoreContext()` called in the same task the `webglcontextlost` listener ran in is rejected
   * by Chromium (`WebGL: INVALID_OPERATION: restoreContext: context restoration not allowed`) — the event
   * firing is not, in practice, the browser's internal loss handling actually finishing, only this ticket's
   * own signal that it started. One further real task-queue turn is what the browser needs to catch up; a
   * bare `await Promise.resolve()` (a microtask) is not enough, only a macrotask is, which is why this is a
   * `setTimeout`, not a `then`.
   */
  const CHAOS_SETTLE_MS = 50;

  /**
   * Fires `trigger`, then waits for the real event it should cause — the yield this file's own header
   * describes, since `loseContext()`/`restoreContext()` deliver their event as a queued task, never inside the
   * synchronous call that asked for it. Bounded by `chaosEventTimeoutMs` rather than awaited forever: a browser
   * that never delivers the event is exactly the failure `chaosFailureReasons` is for, and a hung page proves
   * nothing a timed-out one does not — the permanent listeners above still count whatever arrives later, so a
   * late event is not lost, only not waited on. Settles for {@link CHAOS_SETTLE_MS} afterwards regardless — see
   * that constant's own comment for why the event alone is not enough.
   *
   * @param {string} eventName
   * @param {() => void} trigger
   * @returns {Promise<void>}
   */
  function waitForChaosEvent(eventName, trigger) {
    // `globalThis.setTimeout` rather than the bare identifier: this function is serialised into the page and
    // never called from this file (this file's own header), so it needs the page's timer, not Node's — and
    // spelling it this way keeps `eslint.config.js`'s `tests/**` globals untouched (it already lists `window`,
    // which every browser exposes `setTimeout` on too) rather than declaring a new one for one call site.
    const pageSetTimeout = /** @type {any} */ (globalThis).setTimeout;
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        chaos.canvas.removeEventListener(eventName, finish);
        pageSetTimeout(() => resolve(undefined), CHAOS_SETTLE_MS);
      };
      chaos.canvas.addEventListener(eventName, finish, { once: true });
      pageSetTimeout(finish, chaosEventTimeoutMs);
      trigger();
    });
  }

  for (; frames < maxFrames; frames += 1) {
    if (chaos !== null) {
      while (
        chaos.nextIndex < chaosEvents.length &&
        chaosEvents[chaos.nextIndex].frame === frames
      ) {
        const event = chaosEvents[chaos.nextIndex];
        chaos.nextIndex += 1;
        // No extension: nothing to trigger. `chaos.lostCount`/`restoredCount` simply stay short of what was
        // planned, which `chaosFailureReasons` turns into a named failure rather than a silent no-op.
        if (chaos.ext === null) continue;
        if (event.type === 'lose') {
          await waitForChaosEvent('webglcontextlost', () => chaos.ext.loseContext());
        } else {
          await waitForChaosEvent('webglcontextrestored', () => chaos.ext.restoreContext());
        }
      }
    }

    const state = kobi.getState();
    if (statesVisited.indexOf(state) === -1) statesVisited.push(state);
    if (state === 'MATCH_OVER') break;

    const snapshot = kobi.getSnapshot();
    if (snapshot !== null) {
      if (snapshot.lasers.phase !== 'PARKED') reachedLaserPhase = true;
      if (snapshot.lasers.inset > maxLaserInset) maxLaserInset = snapshot.lasers.inset;

      // Input. The countdown's "GO" beat already queues turns (`DESIGN-DECISIONS §2.4`), so the policies are
      // asked there too and the session decides whether to accept — exactly as a player pressing early is
      // handled. `pressKey` dispatches a real `keydown` at the same target `createInput` listens on.
      if (state === 'COUNTDOWN' || state === 'PLAYING' || state === 'LASER_WARNING') {
        for (let i = 0; i < 2; i += 1) {
          const snake = snapshot.snakes[i];
          const policy = policies[i];
          if (policy === null || snake === undefined || !snake.alive) continue;
          const head = snake.segments[0];
          const headKey = head.x + ',' + head.y;
          if (headKey === lastHeadKeys[i]) continue;
          lastHeadKeys[i] = headKey;
          const move = policy({
            snapshot,
            playerIndex: i,
            grid,
            decisionIndex: decisionIndex[i],
          });
          decisionIndex[i] += 1;
          if (move !== null && move !== undefined) kobi.pressKey(i + 1, move);
        }
      }

      // Invariants, every simulated frame — the point of the layer.
      if (checkInvariants !== null) {
        const found = checkInvariants({
          snapshot,
          hud: readHud(),
          state,
          config: invariantConfig,
        });
        for (let i = 0; i < found.length; i += 1) {
          problemCount += 1;
          if (problems.length < maxReportedProblems) {
            problems.push({
              rule: found[i].rule,
              detail: found[i].detail,
              frame: frames,
              round: roundIndex,
            });
          }
        }
      }

      // The round's own numbers are read on the frame the scoreboard opens, while `sim` still holds the
      // round that just ended (KI-03-06 leaves `getSnapshot()` serving it in ROUND_OVER, and nulls it only
      // in MATCH_OVER).
      if (previousState !== 'ROUND_OVER' && state === 'ROUND_OVER') {
        rounds.push({
          index: roundIndex,
          result: snapshot.result,
          endReason: snapshot.endReason,
          winnerId: snapshot.winnerId,
          ticks: snapshot.tick,
          seconds: snapshot.elapsed,
          lengths: snapshot.snakes.map((snake) => snake.length),
          reachedLaserPhase,
          laserPhaseAtEnd: snapshot.lasers.phase,
          maxLaserInset,
        });
        roundIndex += 1;
        reachedLaserPhase = false;
        maxLaserInset = 0;
        lastHeadKeys = [null, null];
        decisionIndex = [0, 0];
      }
    }
    previousState = state;

    if (frames % renderEveryNFrames === 0) {
      kobi.fastForward(frameSeconds);
      renders += 1;
      const drawCalls = kobi.getDrawCalls();
      if (drawCalls > maxDrawCalls) maxDrawCalls = drawCalls;
    } else {
      kobi.advance(frameSeconds);
    }
  }

  return {
    finished: kobi.getState() === 'MATCH_OVER',
    rounds,
    match: kobi.getMatch(),
    statesVisited,
    frames,
    renders,
    maxDrawCalls,
    problemCount,
    problems,
    chaos:
      chaos === null ? null : { lostCount: chaos.lostCount, restoredCount: chaos.restoredCount },
  };
}

/**
 * Plays one whole match of the **built site** and returns what happened.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} options
 * @param {number} options.seed - fixes the match seed through `?seed=N` (`ARCHITECTURE §11`), so the same
 *   seed replays identically (AC1).
 * @param {(view: PolicyView) => PolicyMove} options.policy1
 * @param {(view: PolicyView) => PolicyMove} options.policy2
 * @param {number} [options.bestOf]
 * @param {boolean | null} [options.powerUpsEnabled] - `null` leaves the match-setup default alone.
 * @param {object | null} [options.settingsOverrides] - KI-04-01: a `withOverrides()`-shaped tree applied
 *   through `__kobi.setSettingsOverrides` **before** the match starts, so it reaches every round including
 *   the first. `null` (the default) does not call it at all, which is why every caller written before this
 *   option existed measures exactly what it always did — the property `docs/qa/playtests/round-pacing.md`'s
 *   reconciliation against `docs/qa/playtests/agent-run.md` depends on. `src/core/settings.js` is never
 *   edited to sweep a value; this is the supported route.
 * @param {((input: object) => {rule: string, detail: string}[]) | null} [options.invariants]
 * @param {object} [options.invariantConfig] - passed through to `invariants` untouched; this is how a value
 *   derived on the Node side (KI-03-03's HUD tolerance) reaches a function that may not import it.
 * @param {number} [options.maxFrames]
 * @param {number} [options.renderEveryNFrames]
 * @param {ChaosEvent[] | null} [options.chaosEvents] - KI-06-04: an optional, opt-in chaos source — plain
 *   data, built by `tests/agent/resilience.js`'s `buildChaosSchedule` + `chaosScheduleToEvents`, never a
 *   function (unlike `policy1`/`invariants` this never needs `Function.prototype.toString()`; it is only ever
 *   read, not called, inside the page). `null` (the default) triggers nothing and costs the loop no `await` —
 *   every caller written before this option existed is unaffected. Each event fires real
 *   `WEBGL_lose_context.loseContext()`/`restoreContext()` on the live canvas at the driven `frame` named, and
 *   the loop yields for the real `webglcontextlost`/`webglcontextrestored` event before continuing
 *   (`runMatchInPage`'s own header explains why a synchronous loop cannot deliver one otherwise).
 * @param {number} [options.chaosEventTimeoutMs] - how long the loop waits for a triggered event before giving
 *   up on it and moving on; default {@link DEFAULT_CHAOS_EVENT_TIMEOUT_MS}. The permanent counters still pick
 *   up a late event — see `runMatchInPage`'s `waitForChaosEvent`.
 * @returns {Promise<MatchResult>}
 */
export async function playMatch(page, options) {
  const {
    seed,
    policy1,
    policy2,
    bestOf = 3,
    powerUpsEnabled = null,
    settingsOverrides = null,
    invariants = null,
    invariantConfig = {},
    maxFrames = DEFAULT_MAX_FRAMES,
    renderEveryNFrames = RENDER_EVERY_N_FRAMES,
    chaosEvents = null,
    chaosEventTimeoutMs = DEFAULT_CHAOS_EVENT_TIMEOUT_MS,
  } = options;

  /** @type {string[]} */
  const pageErrors = [];
  const onPageError = (/** @type {Error} */ error) =>
    pageErrors.push(`pageerror: ${error.message}`);
  const onConsole = (/** @type {import('@playwright/test').ConsoleMessage} */ message) => {
    if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
  };
  page.on('pageerror', onPageError);
  page.on('console', onConsole);

  const startedAt = Date.now();
  try {
    await page.goto(`/?test=1&seed=${seed}`);
    await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));
    const raw = await page.evaluate(runMatchInPage, {
      bestOf,
      powerUpsEnabled,
      settingsOverrides,
      frameSeconds: FRAME_SECONDS,
      renderEveryNFrames,
      maxFrames,
      maxReportedProblems: MAX_REPORTED_PROBLEMS,
      policySources: [policy1.toString(), policy2.toString()],
      invariantsSource: invariants === null ? null : invariants.toString(),
      invariantConfig,
      chaosEvents,
      chaosEventTimeoutMs,
    });
    return { seed, bestOf, ...raw, pageErrors, wallMs: Date.now() - startedAt };
  } finally {
    page.off('pageerror', onPageError);
    page.off('console', onConsole);
  }
}

/**
 * Every reason this run is not healthy, in the words a failure message should use — empty when it is.
 *
 * KI-03-01 AC3 ("`npm run test:agent` fails on a non-zero problem count, a page error, or a match that does
 * not finish") is exactly these three clauses, kept here as a pure function so a spec asserts one thing and
 * so the rule itself is unit-testable without a browser (`tests/agent/driver.test.js`).
 *
 * Every message names the **seed**, because KI-03-05's CI job has to be replayable from its log alone.
 *
 * @param {MatchResult[]} results
 * @returns {string[]}
 */
export function failureReasons(results) {
  /** @type {string[]} */
  const reasons = [];
  for (const result of results) {
    const where = `seed ${result.seed}`;
    if (!result.finished) {
      reasons.push(
        `${where}: the match did not finish inside ${result.frames} frames ` +
          `(${result.rounds.length} rounds played, last state ${result.statesVisited.at(-1) ?? 'none'})`,
      );
    }
    for (const error of result.pageErrors) reasons.push(`${where}: ${error}`);
    if (result.problemCount > 0) {
      const shown = result.problems
        .slice(0, 5)
        .map(
          (problem) =>
            `${problem.rule} @frame ${problem.frame} round ${problem.round}: ${problem.detail}`,
        );
      reasons.push(
        `${where}: ${result.problemCount} invariant problem(s)\n    ${shown.join('\n    ')}` +
          (result.problemCount > shown.length
            ? `\n    …and ${result.problemCount - shown.length} more`
            : ''),
      );
    }
  }
  return reasons;
}
