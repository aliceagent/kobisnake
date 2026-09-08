// @ts-check

/**
 * The frame loop: the one place real time turns into simulated time (`ARCHITECTURE §5`).
 *
 * It knows nothing about snakes. Every frame it works out how much time has passed, clamps it, scales it and
 * hands it to `update(dt)`; then it calls `render(alpha)`. What `update` does with the seconds is the
 * session's business, and what the renderer does with the frame is the renderer's — putting simulation code
 * here would make the loop untestable and the simulation frame-rate dependent, which are the two things this
 * file exists to prevent.
 *
 * Three rules from the design carry the whole file:
 *
 * 1. **Frames are clamped** to `maxFrameSeconds` (0.1 s). A tab that was in the background for two minutes
 *    comes back with a two-minute frame, and feeding that to the simulation would run 14 400 ticks in one
 *    frame — the "spiral of death" `ARCHITECTURE §5` names. Clamping means the simulated clock *stalls*
 *    rather than jumping, which is the behaviour the design chose: "the timer counts simulated seconds, so
 *    pausing or a slow frame never steals time" (`DESIGN-DECISIONS §2.1`).
 * 2. **`timeScale` scales that dt** — 1 normally, 0.25 for the crash slow-mo beat (`crashSlowMo.scale`),
 *    0 when paused (`ARCHITECTURE §5`). Pausing by multiplying by zero rather than by stopping the loop
 *    keeps rendering alive, which is what a pause screen over a frozen arena needs.
 * 3. **A hidden tab stops updating at all**, and coming back calls `onAutoPause` before anything advances, so
 *    the UI can put up the "READY?" beat of `DESIGN-DECISIONS §2.8`.
 *
 * **KI-06-03 extends rule 3 to the rest of the tab lifecycle**, not a fourth rule beside it. `visibilitychange`
 * is not the only way a browser tells a page it is going away: a tab the browser suspends outright fires
 * `freeze` (and `resume` coming back) on `document`, and a tab torn down for a real navigation or restored
 * from the back/forward cache fires `pagehide` (and `pageshow` coming back) on `window` — either can arrive
 * without `visibilitychange` firing at all, and a two-minute suspension is exactly the shape of frame the
 * clamp above exists for. Both pairs reach the *same* machinery `hidden` already reaches — the same
 * {@link cancelPendingFrame}, the same `scheduleNextFrame` guard, the same `lastFrameMs = null` /
 * `autoPausePending = true` reset on the way back — rather than a second, parallel copy of it, so "suspended"
 * is one more flag next to `hidden`, not a second state machine. It is also kept a *different* flag from
 * `hidden`: a `pageshow` must not un-hide a tab that a real `pagehide` or `visibilitychange` hid, so lifecycle
 * events only ever clear *their own* flag, never `hidden` itself.
 *
 * Everything the loop touches from the outside — the clock, the frame scheduler, the visibility source, the
 * two lifecycle sources — is injectable, because a loop that can only be driven by a real browser is a loop no
 * unit test can pin down. The defaults are the real browser ones.
 */

/**
 * The per-frame update. It is handed the frame twice over, in two different currencies:
 *
 * - `dt` — **simulated** seconds: the clamped frame duration multiplied by `timeScale`. 0.25x during the
 *   crash slow-mo beat, exactly 0 while paused.
 * - `unscaledDt` — **wall** seconds: the clamped frame duration, unscaled.
 *
 * Both are needed because a game has two kinds of timer and they must not be confused (`session.js`'s header
 * comment, and Sprint 05's own stated risk: "slow-mo uses wall time while the sim uses sim time; keep them
 * separate or the timer drifts"). The simulation runs on `dt` so that a pause or a slow frame never steals
 * simulated time; the countdown, the scoreboard and the length of the slow-mo beat itself run on
 * `unscaledDt`, because they are presentation timings a player experiences in real seconds. A caller that
 * only cares about simulated time simply ignores the second argument, which is what every caller before
 * Sprint 05 did.
 *
 * @typedef {(dt: number, unscaledDt: number) => void} UpdateCallback
 */
/** @typedef {(alpha: number) => void} RenderCallback */

/**
 * A frame scheduler: `requestAnimationFrame`'s shape. The callback receives a timestamp in milliseconds.
 *
 * @typedef {(callback: (timestampMs: number) => void) => number} RequestFrame
 */

/**
 * What a browser gives us to notice the tab going away. `document` satisfies it; a test can pass any object
 * with the same three members.
 *
 * @typedef {object} VisibilitySource
 * @property {boolean} [hidden]
 * @property {(type: string, listener: () => void) => void} addEventListener
 * @property {(type: string, listener: () => void) => void} removeEventListener
 */

/**
 * What a browser gives us to notice the rest of the tab lifecycle (KI-06-03): no `hidden`-style property to
 * read, only the two events a caller registers for — `freeze`/`resume` for whichever source stands in for
 * `document`, `pagehide`/`pageshow` for whichever stands in for `window`. Structurally
 * {@link VisibilitySource} minus `hidden`, kept as its own type rather than reused because nothing here ever
 * reads a property off it.
 *
 * @typedef {object} LifecycleSource
 * @property {(type: string, listener: () => void) => void} addEventListener
 * @property {(type: string, listener: () => void) => void} removeEventListener
 */

/**
 * @typedef {object} Loop
 * @property {number} timeScale - 1 normally, 0.25 during crash slow-mo, 0 when paused
 * @property {() => void} start - begin requesting frames; idempotent
 * @property {() => void} stop - stop requesting frames; idempotent
 * @property {(dt: number) => void} step - advance one frame by hand, through the same clamp/scale path
 * @property {() => boolean} isRunning
 * @property {() => boolean} isHidden - true while the visibility source says the tab is hidden
 * @property {() => boolean} isSuspended - KI-06-03: true from a `pagehide`/`freeze` until the matching
 *   `pageshow`/`resume`, independently of {@link isHidden}
 * @property {() => void} dispose - stop and remove the visibility and lifecycle listeners
 */

/**
 * The longest frame the simulation is ever asked to swallow, in seconds (`ARCHITECTURE §5`).
 */
const MAX_FRAME_SECONDS = 0.1;

/**
 * Milliseconds per second, named so the conversions below read as conversions rather than as a magic 1000.
 */
const MS_PER_SECOND = 1000;

/**
 * The default fixed step the render `alpha` is measured against: one simulation tick at `SETTINGS.simHz`
 * (`DESIGN-DECISIONS §2.1` fixes 120 Hz). See {@link createLoop} for what `alpha` is and is not.
 */
const DEFAULT_SIM_HZ = 120;

/**
 * `performance.now()` where there is one, `Date.now()` where there is not. Node has both, browsers have both;
 * this exists so the module can be imported in an environment that has neither without throwing at import.
 *
 * @returns {number} milliseconds, monotonic where the platform offers it
 */
function defaultNow() {
  const performanceRef = /** @type {{now?: () => number} | undefined} */ (
    /** @type {any} */ (globalThis).performance
  );
  return performanceRef?.now ? performanceRef.now() : Date.now();
}

/**
 * Build the game's frame loop.
 *
 * @param {object} options
 * @param {UpdateCallback} options.update - called once per frame with the clamped, scaled seconds to advance
 *   and, second, the same frame unscaled (see {@link UpdateCallback})
 * @param {RenderCallback} [options.render] - called once per frame with the fixed-step interpolation alpha
 * @param {() => void} [options.onAutoPause] - called when a hidden tab becomes visible again, before the
 *   first update of the resumed loop, so the UI can show "READY?" (`DESIGN-DECISIONS §2.8`)
 * @param {number} [options.timeScale] - initial time scale; defaults to 1
 * @param {number} [options.maxFrameSeconds] - frame clamp; defaults to 0.1 s (`ARCHITECTURE §5`)
 * @param {number} [options.stepSeconds] - the fixed step `alpha` is measured against; defaults to 1/120 s
 * @param {RequestFrame} [options.requestFrame] - defaults to `requestAnimationFrame`
 * @param {(handle: number) => void} [options.cancelFrame] - defaults to `cancelAnimationFrame`
 * @param {() => number} [options.now] - millisecond clock; defaults to `performance.now()`
 * @param {VisibilitySource | null} [options.visibilitySource] - defaults to `document` where there is one;
 *   pass `null` to opt out of visibility handling entirely
 * @param {LifecycleSource | null} [options.documentLifecycleSource] - KI-06-03: where `freeze`/`resume` come
 *   from. Defaults to `document` where there is one, same rule as {@link options.visibilitySource}; pass
 *   `null` to opt out. A separate option rather than reusing `visibilitySource` even though both default to
 *   the same real object: `visibilitySource: null` already has a documented meaning ("opt out of visibility
 *   handling entirely") and folding a second concern into it would mean a test opting out of one silently
 *   opted out of the other too.
 * @param {LifecycleSource | null} [options.windowLifecycleSource] - KI-06-03: where `pagehide`/`pageshow`
 *   come from. Defaults to `window` where there is one; pass `null` to opt out. A separate option from
 *   {@link options.documentLifecycleSource} because the two pairs fire on two different real targets
 *   (`document` and `window`) — a fake standing in for one should not also have to pretend to be the other.
 * @returns {Loop}
 */
export function createLoop({
  update,
  render,
  onAutoPause,
  timeScale = 1,
  maxFrameSeconds = MAX_FRAME_SECONDS,
  stepSeconds = 1 / DEFAULT_SIM_HZ,
  requestFrame,
  cancelFrame,
  now = defaultNow,
  visibilitySource,
  documentLifecycleSource,
  windowLifecycleSource,
}) {
  const scheduleFrame =
    requestFrame ??
    /** @type {RequestFrame} */ (
      /** @type {any} */ (globalThis).requestAnimationFrame?.bind(globalThis)
    );
  const unscheduleFrame =
    cancelFrame ??
    /** @type {(handle: number) => void} */ (
      /** @type {any} */ (globalThis).cancelAnimationFrame?.bind(globalThis)
    );
  // `undefined` means "use the platform's document if it has one"; an explicit `null` means "this loop has no
  // visibility source", which is what a headless test wants when it is not testing visibility at all.
  const visibility =
    visibilitySource === undefined
      ? /** @type {VisibilitySource | null} */ (/** @type {any} */ (globalThis).document ?? null)
      : visibilitySource;
  // Same defaulting rule as `visibility` above, one per real target (KI-06-03).
  const documentLifecycle =
    documentLifecycleSource === undefined
      ? /** @type {LifecycleSource | null} */ (/** @type {any} */ (globalThis).document ?? null)
      : documentLifecycleSource;
  const windowLifecycle =
    windowLifecycleSource === undefined
      ? /** @type {LifecycleSource | null} */ (/** @type {any} */ (globalThis).window ?? null)
      : windowLifecycleSource;

  /** @type {number | null} the handle of the frame we are waiting on, or null when we are not */
  let frameHandle = null;
  /** Timestamp of the previous frame, in ms. `null` means "the next frame is the first one". */
  let lastFrameMs = /** @type {number | null} */ (null);
  /**
   * Simulated seconds accumulated within the current fixed step, always in `[0, stepSeconds)`. This mirrors
   * the simulation's own tick accumulator (`RoundSimulation.tickAccumulator`), because both accumulate the
   * same scaled dt at the same rate, and it is what `alpha` is derived from.
   */
  let stepAccumulator = 0;
  let running = false;
  /** True while the visibility source reports the tab hidden. */
  let hidden = visibility?.hidden === true;
  /**
   * True from a `pagehide`/`freeze` until the matching `pageshow`/`resume` (KI-06-03). Kept separate from
   * `hidden` on purpose: a suspension can arrive without `visibilitychange` ever firing, and a `pageshow` must
   * not un-hide a tab that a real `pagehide` or a `visibilitychange` hid — see this file's own header note.
   * There is no browser-readable property to seed it from at construction the way `visibility?.hidden` seeds
   * `hidden`, so it always starts `false`.
   */
  let suspended = false;
  /**
   * Set when a hidden tab becomes visible again; consumed by the next frame, which fires `onAutoPause` before
   * it advances anything. It is a flag rather than a direct call because the visibility event can arrive at
   * any point between frames, and "before the first update of the resumed loop" is the guarantee the UI needs.
   */
  let autoPausePending = false;

  const loop = /** @type {Loop} */ ({
    timeScale,
    start,
    stop,
    step,
    isRunning: () => running,
    isHidden: () => hidden,
    isSuspended: () => suspended,
    dispose,
  });

  /**
   * Advance one frame's worth of real seconds: clamp it, scale it, hand it to `update`, then render.
   *
   * The clamp comes first and the scale second, so slow-mo is a quarter of *at most* 100 ms rather than a
   * quarter of however long the tab was asleep.
   *
   * @param {number} rawSeconds - wall-clock seconds since the previous frame
   */
  function advance(rawSeconds) {
    if (autoPausePending) {
      autoPausePending = false;
      onAutoPause?.();
    }
    const clamped = Math.min(Math.max(rawSeconds, 0), maxFrameSeconds);
    const dt = clamped * loop.timeScale;

    update(dt, clamped);

    // `alpha` is how far the simulated clock stands into the current fixed step. The snake renderer does not
    // use it — each snake has its own movement accumulator and its own `stepProgress` in the snapshot
    // (DESIGN-DECISIONS §2.1), which is the alpha that interpolates segments — but the loop owes the frame a
    // fixed-step fraction and this is the honest one.
    stepAccumulator = (stepAccumulator + dt) % stepSeconds;
    render?.(stepAccumulator / stepSeconds);
  }

  /**
   * The frame callback. Uses the timestamp the scheduler passes when there is one (`requestAnimationFrame`
   * always passes one) and the injected clock otherwise, so a fake scheduler that calls back with nothing
   * still produces sane deltas.
   *
   * @param {number} [timestampMs]
   */
  function onFrame(timestampMs) {
    frameHandle = null;
    if (!running) return;

    const nowMs = typeof timestampMs === 'number' ? timestampMs : now();
    // The first frame after a start or a resume has no previous frame to measure against. Treating it as a
    // zero-length frame is what keeps a resumed tab from advancing by however long it was away — the clamp
    // would cap that at 100 ms, but 100 ms of stolen simulated time is still 100 ms the players did not play.
    const rawSeconds = lastFrameMs === null ? 0 : (nowMs - lastFrameMs) / MS_PER_SECOND;
    lastFrameMs = nowMs;

    advance(rawSeconds);
    scheduleNextFrame();
  }

  function scheduleNextFrame() {
    if (!running || hidden || suspended || frameHandle !== null) return;
    frameHandle = scheduleFrame(onFrame);
  }

  /**
   * The tab went away or came back. Hidden stops the frames outright: `requestAnimationFrame` is throttled or
   * silent in a background tab anyway, and stopping explicitly means the guarantee does not depend on how a
   * given browser throttles.
   */
  function onVisibilityChange() {
    const nowHidden = visibility?.hidden === true;
    if (nowHidden === hidden) return;
    hidden = nowHidden;

    if (hidden) {
      cancelPendingFrame();
      return;
    }
    // Back on screen. The next frame must not be measured against the timestamp from before the tab went
    // away, and the UI gets its "READY?" beat before anything advances.
    lastFrameMs = null;
    autoPausePending = true;
    scheduleNextFrame();
  }

  /**
   * KI-06-03: the tab was suspended (`freeze`, or `pagehide` for a real navigation away or a bfcache-eligible
   * one) or came back from either (`resume`, `pageshow`). Deliberately does not touch `hidden` — only
   * {@link onVisibilityChange} ever writes it — so a tab that is hidden *and* suspended does not un-hide
   * itself the moment the suspension alone ends; `scheduleNextFrame`'s own guard still refuses to run while
   * `hidden` is true regardless of what this function just set `suspended` to. A `pagehide` fired for a real
   * unload behaves identically to one that turns into a bfcache restore: cancelling the pending frame costs
   * nothing (there is nothing to draw for while the page may never run again), and if the page really is
   * gone, no `pageshow` ever arrives to undo it.
   *
   * @param {boolean} nextSuspended
   */
  function onSuspendChange(nextSuspended) {
    if (nextSuspended === suspended) return;
    suspended = nextSuspended;

    if (suspended) {
      cancelPendingFrame();
      return;
    }
    // Back from suspension. Exactly `onVisibilityChange`'s own "coming back" contract: the next frame must
    // not be measured against a timestamp from before the suspension, and the UI gets its "READY?" beat
    // before anything advances. `scheduleNextFrame` is still the one place that decides whether a frame is
    // actually owed right now — if the tab is also still hidden, this is a no-op until visibility says
    // otherwise, and `autoPausePending` simply waits for that frame instead of firing one early.
    lastFrameMs = null;
    autoPausePending = true;
    scheduleNextFrame();
  }

  function onFreeze() {
    onSuspendChange(true);
  }
  function onDocumentResume() {
    onSuspendChange(false);
  }
  function onPageHide() {
    onSuspendChange(true);
  }
  function onPageShow() {
    onSuspendChange(false);
  }

  function cancelPendingFrame() {
    if (frameHandle === null) return;
    unscheduleFrame?.(frameHandle);
    frameHandle = null;
  }

  function start() {
    if (running) return;
    running = true;
    lastFrameMs = null;
    scheduleNextFrame();
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelPendingFrame();
  }

  /**
   * Advance the loop by hand. Tests use it to feed exact frame lengths without a clock, and it goes through
   * the same clamp/scale/render path a real frame does, so what a test proves about `step` is true of frames.
   *
   * A hidden or suspended tab ignores it (KI-06-03), for the same reason it gets no real frames: a suspended
   * tab is not merely clamped to `maxFrameSeconds` (`update` would still see 100 ms of it), it is stopped from
   * reaching `update` at all — a "multi-minute suspension advances the round by nothing" (KI-06-03 AC1), not
   * by a little.
   *
   * @param {number} dtSeconds - wall-clock seconds this frame represents
   */
  function step(dtSeconds) {
    if (hidden || suspended) return;
    advance(dtSeconds);
  }

  function dispose() {
    stop();
    visibility?.removeEventListener('visibilitychange', onVisibilityChange);
    documentLifecycle?.removeEventListener('freeze', onFreeze);
    documentLifecycle?.removeEventListener('resume', onDocumentResume);
    windowLifecycle?.removeEventListener('pagehide', onPageHide);
    windowLifecycle?.removeEventListener('pageshow', onPageShow);
  }

  visibility?.addEventListener('visibilitychange', onVisibilityChange);
  documentLifecycle?.addEventListener('freeze', onFreeze);
  documentLifecycle?.addEventListener('resume', onDocumentResume);
  windowLifecycle?.addEventListener('pagehide', onPageHide);
  windowLifecycle?.addEventListener('pageshow', onPageShow);

  return loop;
}
