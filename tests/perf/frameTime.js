// @ts-check

/**
 * KI-08-03 — the frame-time budget (`docs/sprints/improvement-08-performance-budgets-before-the-art.md`,
 * tracking issue #277, this ticket #280).
 *
 * ## The honest part of this ticket, first
 *
 * `ARCHITECTURE §12` asks for **p95 frame time ≤ 16.6 ms during PLAYING, on an integrated GPU at 1080p**.
 * CI has no GPU at all: Chromium falls back to SwiftShader and a single `renderer.render()` costs ≈ 124 ms
 * on this project's runner (`tests/agent/driver.js`'s `RENDER_EVERY_N_FRAMES` comment has the measurement),
 * which is 7–8 fps. A raw millisecond gate there would fail on every commit while saying nothing whatsoever
 * about the game — the runner is 7× outside a budget written for hardware it does not have.
 *
 * KS-07-06 met exactly this and answered it by reporting a machine-independent figure beside the
 * milliseconds, and KI-19-00 turned that answer into a rule: **a gate keys on work done, never on wall
 * clock.** `tests/e2e/inputLatency.spec.js` gates on `stepWaitTicks` and prints its `WALL CLOCK` line as
 * information; this file does the same thing one layer up.
 *
 * So:
 *
 * | Measured | Gated? | Why |
 * |---|---|---|
 * | Draw calls, every sampled frame of a played round | **Yes**, ≤ 120 | `ARCHITECTURE §12`'s own number, and the same constant KI-08-02 gates its five staged scenes on — imported, never restated |
 * | Scene residency across 500 rounds' churn | **Yes**, must not grow | A leak is a leak on every machine; nothing about it is hardware-dependent |
 * | Triangles per frame | No — recorded | §12 sets no triangle budget, and inventing one would either be arbitrary or fire on exactly the art Sprints 08–10 are meant to add |
 * | Frame milliseconds (p50/p95/p99/max) | No — recorded | The `16.6 ms` row needs real hardware; see {@link FRAME_TIME_BUDGET_MS} |
 * | Heap used | No — recorded | See {@link measureRoundFrameCostInPage}: heap sampling in a garbage-collected runtime measures when the collector last ran, not what a frame allocated |
 *
 * `docs/qa/playtests/perf-baseline.md` is the written form of all five, and says what Sprint 16 has to add
 * on real hardware to close the gap this file cannot.
 *
 * ## Why draw calls are the frame-cost gate rather than a second copy of KI-08-02
 *
 * KI-08-02 samples five **staged moments** — it drives the game to a named scene and reads one frame. This
 * file samples a **played round continuously**, every {@link SAMPLE_EVERY_N_FRAMES} frames from the
 * countdown to the death, and gates the worst frame in that series. A scene composition KI-08-02 never
 * stages — a power-up pedestal and a laser step landing on the same frame as a crash, say — shows up here
 * and nowhere else. The budget is one constant in one place (`drawCalls.js`'s `DRAW_CALL_BUDGET`); what
 * differs is the sampling.
 *
 * ## Shape, following `tests/agent/README.md`'s two rules
 *
 * {@link measureRoundFrameCostInPage} and {@link measureChurnLeakInPage} each run **inside the page** and
 * are therefore single self-contained functions with no free variables — every helper nested, nothing
 * imported or read from module scope — because `frameTime.spec.js` ships them as source text through
 * `page.evaluate`. Everything else here is plain Node-side arithmetic, unit-tested in `frameTime.test.js`
 * against hand-built fixtures without a browser.
 */

import { DRAW_CALL_BUDGET } from './drawCalls.js';

/**
 * `ARCHITECTURE §12`'s frame-time row: "Frame time during PLAYING (integrated GPU, 1080p) | p95 ≤ 16.6 ms".
 *
 * **Recorded, never gated — and that is a deliberate ruling, not an omission.** The budget is written for an
 * integrated GPU at 1080p. CI has no GPU, renders in software at 7–8 fps, and would fail this on every
 * commit for reasons that have nothing to do with the game. Gating on it here would produce a permanently
 * red job that everyone learns to ignore, which is worse than no gate — the same reasoning that removed the
 * Firefox nightly leg (#23) and that KI-19-00 wrote down as a rule.
 *
 * It lives here as a constant anyway, because the number belongs in the report next to the measurement it
 * cannot yet judge, and because Sprint 16 — which owns the real-hardware run (`KS-16-01`) — should find it
 * already named rather than have to re-derive it from §12.
 */
export const FRAME_TIME_BUDGET_MS = 16.6;

/**
 * How many simulated frames pass between samples of a played round. 60 frames at the driver's own 1/60
 * frame is **one simulated second**.
 *
 * Sampling is not free: a sample renders, and one `renderer.render()` is ≈ 124 ms under software WebGL
 * against ≈ 0.04 ms for an unrendered `advance` (`driver.js`). The cadence is therefore the only lever on
 * this suite's runtime, exactly as it is for the agent driver. One second is dense enough that a spike
 * lasting a beat of the game — a crash, a laser step, a power-up spawn — cannot fall between two samples.
 */
export const SAMPLE_EVERY_N_FRAMES = 60;

/**
 * The most samples one round contributes, so a long round cannot turn this suite into a ten-minute job.
 * 90 samples is 90 simulated seconds — a full-length round (`settings.roundDuration`) — so in practice the
 * cap is never what stops the loop; the round ending is.
 */
export const MAX_SAMPLES_PER_ROUND = 90;

/**
 * How many rounds of scene churn the leak check drives (AC2: "asserted over 500 rounds' worth of scene
 * churn").
 *
 * Each iteration is a whole round **and** a whole match: a Bo1 match is started, player one is steered into
 * a wall, the round and match end, and `REMATCH` starts the next one from `MATCH_OVER` (the state machine's
 * own row, `MATCH_OVER → REMATCH → COUNTDOWN`). That is strictly more churn than 500 rounds inside longer
 * matches would be — every round boundary the ticket asks for, plus 500 match resets on top.
 */
export const CHURN_ROUNDS = 500;

/**
 * How often the churn loop stops to read residency. Reading is a render, so this is the same cost trade-off
 * as {@link SAMPLE_EVERY_N_FRAMES}: 25 readings across 500 rounds is enough to distinguish "flat" from
 * "climbing", which is the only question a leak check asks.
 */
export const CHURN_SAMPLE_EVERY_N_ROUNDS = 20;

/**
 * The residency fields a leak would move, and the only ones {@link checkNoLeak} compares.
 *
 * `calls`, `triangles`, `lines` and `points` are deliberately **not** here: they are per-frame cost and
 * legitimately differ between two frames of a match (a laser-warning frame draws more than an opening one),
 * so comparing them across checkpoints would report the game working correctly as a leak. These four only
 * move when something is **created or disposed**, which is what makes a rise in them a defect rather than a
 * measurement.
 */
export const RESIDENCY_FIELDS = Object.freeze(['geometries', 'textures', 'programs', 'sceneNodes']);

/**
 * @typedef {import('../../src/render/renderer.js').RenderStats} RenderStats
 */

/**
 * One sampled frame of a played round.
 *
 * @typedef {object} FrameSample
 * @property {number} frame - which driven frame this was, from 0.
 * @property {string} state - the game state at the sample.
 * @property {RenderStats} stats
 * @property {number} submitMs - wall clock around this one `render()` call, i.e. the time the **JavaScript
 *   side** spent submitting the frame. Information only, and read the caveat in {@link
 *   summariseFrameCost}: under SwiftShader this is not what the frame costs.
 * @property {number | null} heapBytes - `performance.memory.usedJSHeapSize` where the browser offers it,
 *   `null` where it does not. Information only; see {@link measureRoundFrameCostInPage}.
 */

/**
 * @typedef {object} ChurnReading
 * @property {number} round - how many rounds had completed when this was read.
 * @property {RenderStats} stats
 * @property {number | null} heapBytes
 */

/**
 * Plays one round with real policies and samples it every `sampleEveryNFrames`, returning the series.
 *
 * Runs **inside the page**: one self-contained function, no free variables (this file's module doc).
 *
 * **On `heapBytes`.** `performance.memory` is a Chromium-only, quantised reading of the whole JS heap, and
 * in a garbage-collected runtime its value says when the collector last ran at least as much as it says
 * what the frame allocated — two identical frames can differ by megabytes across a collection, and a real
 * leak can read flat because a collection happened to land inside the window. The ticket names per-frame
 * allocation among the proxies, so it is measured and reported; it is **not** gated, because a budget on a
 * number that moves for reasons unrelated to the code is precisely the "budget that fires on noise" this
 * sprint's own Risks section warns against. What actually catches a leak here is
 * {@link measureChurnLeakInPage}'s residency counts, which move only when something is created or disposed.
 *
 * @param {{
 *   bestOf: number,
 *   powerUpsEnabled: boolean | null,
 *   settingsOverrides: object | null,
 *   frameSeconds: number,
 *   sampleEveryNFrames: number,
 *   maxSamples: number,
 *   guardSteps: number,
 *   guardChunkSeconds: number,
 *   policySources: [string | null, string | null],
 * }} args
 * @returns {{samples: FrameSample[], statsAvailable: boolean, roundsCompleted: number}}
 */
export function measureRoundFrameCostInPage(args) {
  const {
    bestOf,
    powerUpsEnabled,
    settingsOverrides,
    frameSeconds,
    sampleEveryNFrames,
    maxSamples,
    guardSteps,
    guardChunkSeconds,
    policySources,
  } = args;

  const kobi = /** @type {any} */ (globalThis).__kobi;
  const perf = /** @type {any} */ (globalThis).performance;
  const grid = { width: 24, height: 24 };

  const compile = (/** @type {string | null} */ src) =>
    src === null ? null : new Function('return (' + src + ')')();

  const readHeap = () => {
    const memory = perf.memory;
    return memory === undefined || memory === null ? null : memory.usedJSHeapSize;
  };

  const measurementStartedAt = perf.now();
  if (settingsOverrides !== null) kobi.setSettingsOverrides(settingsOverrides);
  kobi.startMatch({ bestOf, powerUpsEnabled });
  for (let i = 0; i < guardSteps && kobi.getState() === 'COUNTDOWN'; i += 1) {
    kobi.advance(guardChunkSeconds);
  }

  const policies = [compile(policySources[0]), compile(policySources[1])];
  const lastHeadKeys = [null, null];
  const decisionIndex = [0, 0];
  /** @type {FrameSample[]} */
  const samples = [];
  let statsAvailable = true;
  let frame = 0;

  while (samples.length < maxSamples) {
    const state = kobi.getState();
    if (state !== 'PLAYING' && state !== 'LASER_WARNING' && state !== 'COUNTDOWN') break;

    const snapshot = kobi.getSnapshot();
    if (snapshot !== null) {
      for (let i = 0; i < 2; i += 1) {
        const policy = policies[i];
        const snake = snapshot.snakes[i];
        if (policy === null || snake === undefined || !snake.alive) continue;
        const head = snake.segments[0];
        const headKey = head.x + ',' + head.y;
        if (headKey === lastHeadKeys[i]) continue;
        lastHeadKeys[i] = headKey;
        const move = policy({ snapshot, playerIndex: i, grid, decisionIndex: decisionIndex[i] });
        decisionIndex[i] += 1;
        if (move !== null && move !== undefined) kobi.pressKey(i + 1, move);
      }
    }

    if (frame % sampleEveryNFrames === 0) {
      // One render, timed. `fastForward(0)` advances no simulation and draws exactly one frame, so the
      // interval below is the render and nothing else.
      const startedAt = perf.now();
      kobi.fastForward(0);
      const submitMs = perf.now() - startedAt;
      const stats = kobi.getRenderStats();
      if (stats === null) {
        statsAvailable = false;
        break;
      }
      samples.push({ frame, state, stats, submitMs, heapBytes: readHeap() });
    }

    kobi.advance(frameSeconds);
    frame += 1;
  }

  const match = kobi.getMatch();
  return {
    samples,
    statsAvailable,
    // The whole measurement's wall clock, so the Node side can divide it by the render count the way
    // `driver.js` derived its own ≈ 124 ms figure. See {@link summariseFrameCost} for why both numbers are
    // needed and why neither is `ARCHITECTURE §12`'s p95.
    wallMs: perf.now() - measurementStartedAt,
    roundsCompleted: match === null ? 0 : (match.roundsPlayed ?? 0),
  };
}

/**
 * Drives `rounds` whole rounds of scene churn and reads residency at checkpoints (AC2).
 *
 * Runs **inside the page**: one self-contained function, no free variables.
 *
 * Each iteration plays a Bo1 match to `MATCH_OVER` by steering player one into the top wall — the same
 * scripted crash `tests/visual/screens.visual.spec.js` uses for its ROUND_OVER baseline — and then
 * dispatches `REMATCH`, which the state machine takes straight back to `COUNTDOWN`. So every iteration
 * exercises a round boundary *and* a match reset, which is more churn than the ticket's "500 rounds"
 * asks for rather than less.
 *
 * Advancing happens in `guardChunkSeconds` chunks rather than frame-sized ones: nothing here samples a
 * frame's cost, only what is resident afterwards, and 500 rounds of frame-sized stepping would spend
 * minutes to reach the identical state.
 *
 * @param {{
 *   rounds: number,
 *   sampleEveryNRounds: number,
 *   powerUpsEnabled: boolean | null,
 *   guardSteps: number,
 *   guardChunkSeconds: number,
 * }} args
 * @returns {{readings: ChurnReading[], roundsDriven: number, statsAvailable: boolean, abandonedAt: string | null}}
 */
export function measureChurnLeakInPage(args) {
  const { rounds, sampleEveryNRounds, powerUpsEnabled, guardSteps, guardChunkSeconds } = args;

  const kobi = /** @type {any} */ (globalThis).__kobi;
  const perf = /** @type {any} */ (globalThis).performance;

  const readHeap = () => {
    const memory = perf.memory;
    return memory === undefined || memory === null ? null : memory.usedJSHeapSize;
  };

  /** Advances in chunks until `predicate` holds or the guard runs out. @returns {boolean} */
  function advanceUntil(/** @type {() => boolean} */ predicate) {
    for (let i = 0; i < guardSteps; i += 1) {
      if (predicate()) return true;
      kobi.advance(guardChunkSeconds);
    }
    return predicate();
  }

  /** @type {ChurnReading[]} */
  const readings = [];
  let statsAvailable = true;
  /** @type {string | null} */
  let abandonedAt = null;

  const sample = (/** @type {number} */ round) => {
    kobi.fastForward(0);
    const stats = kobi.getRenderStats();
    if (stats === null) {
      statsAvailable = false;
      return false;
    }
    readings.push({ round, stats, heapBytes: readHeap() });
    return true;
  };

  kobi.startMatch({ bestOf: 1, powerUpsEnabled });
  if (!sample(0)) return { readings, roundsDriven: 0, statsAvailable, abandonedAt };

  let driven = 0;
  for (let round = 1; round <= rounds; round += 1) {
    if (!advanceUntil(() => kobi.getState() !== 'COUNTDOWN')) {
      abandonedAt = 'countdown never finished at round ' + round;
      break;
    }
    // P1 spawns (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); UP walks it into the top wall.
    kobi.pressKey(1, 'UP');
    if (!advanceUntil(() => kobi.getState() === 'MATCH_OVER')) {
      abandonedAt = 'MATCH_OVER not reached at round ' + round + ', state ' + kobi.getState();
      break;
    }
    driven = round;

    if (round % sampleEveryNRounds === 0 && !sample(round)) break;
    if (round < rounds) kobi.stateMachine.dispatch('REMATCH');
  }

  if (statsAvailable && (readings.length === 0 || readings[readings.length - 1].round !== driven)) {
    sample(driven);
  }
  return { readings, roundsDriven: driven, statsAvailable, abandonedAt };
}

/**
 * The `p`-th percentile of `values` by nearest-rank, which is what a small sample deserves: interpolating
 * between two neighbours invents a number that was never measured, and these series are tens of samples,
 * not thousands.
 *
 * @param {number[]} values
 * @param {number} p - 0..100
 * @returns {number}
 */
export function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Reduces a round's samples to the figures the baseline document records.
 *
 * ## Two millisecond figures, because one of them lies
 *
 * The first version of this file reported a single "render ms" — `performance.now()` bracketed around
 * `renderer.render()` — and measured a **median of 1.0 ms on a runner that manages 7–8 fps**. Those two
 * facts cannot both describe the same frame, and the reason is that under SwiftShader a `render()` call
 * *submits* work and returns: the rasterisation is not inside the bracket. `driver.js`'s ≈ 124 ms figure was
 * derived the other way, from suite wall clock divided by render count, and it catches the part the bracket
 * misses.
 *
 * Both are true measurements of different things, so both are reported and each is labelled:
 *
 * - **`submitMs`** — what the JS side spent inside `render()`. Real, and about a hundredth of the story.
 * - **`wallMsPerSample`** — the whole measurement's elapsed time divided by the number of sampled frames,
 *   `driver.js`'s own methodology. Includes the deferred rasterisation, and also the simulation frames
 *   between samples, so it is an over-estimate of one frame in the other direction.
 *
 * **Neither is `ARCHITECTURE §12`'s p95, and neither gates.** The true figure is bracketed by them, on
 * hardware nobody wants to know about. Sprint 16 measures it on a real GPU; `docs/qa/playtests/perf-baseline.md`
 * says exactly what that run has to do.
 *
 * @param {FrameSample[]} samples
 * @param {number} [wallMs] - the whole measurement's elapsed wall clock, from the in-page loop.
 * @returns {{
 *   sampleCount: number,
 *   drawCalls: {max: number, p95: number, median: number},
 *   triangles: {max: number, p95: number, median: number},
 *   submitMs: {max: number, p99: number, p95: number, median: number},
 *   wallMsPerSample: number | null,
 *   residency: {geometries: number, textures: number, programs: number, sceneNodes: number} | null,
 *   heapBytes: {first: number, last: number} | null,
 * }}
 */
export function summariseFrameCost(samples, wallMs = 0) {
  const at = (/** @type {(sample: FrameSample) => number} */ pick) => samples.map(pick);
  const calls = at((sample) => sample.stats.calls);
  const triangles = at((sample) => sample.stats.triangles);
  const submitMs = at((sample) => sample.submitMs);
  const heaps = samples.map((sample) => sample.heapBytes).filter((value) => value !== null);
  const last = samples[samples.length - 1];

  return {
    sampleCount: samples.length,
    drawCalls: {
      max: percentile(calls, 100),
      p95: percentile(calls, 95),
      median: percentile(calls, 50),
    },
    triangles: {
      max: percentile(triangles, 100),
      p95: percentile(triangles, 95),
      median: percentile(triangles, 50),
    },
    submitMs: {
      max: percentile(submitMs, 100),
      p99: percentile(submitMs, 99),
      p95: percentile(submitMs, 95),
      median: percentile(submitMs, 50),
    },
    wallMsPerSample: wallMs > 0 && samples.length > 0 ? wallMs / samples.length : null,
    residency:
      last === undefined
        ? null
        : {
            geometries: last.stats.geometries,
            textures: last.stats.textures,
            programs: last.stats.programs,
            sceneNodes: last.stats.sceneNodes,
          },
    heapBytes:
      heaps.length === 0
        ? null
        : {
            first: /** @type {number} */ (heaps[0]),
            last: /** @type {number} */ (heaps[heaps.length - 1]),
          },
  };
}

/**
 * The frame-cost gate: **the worst sampled frame of a played round, against `ARCHITECTURE §12`'s draw-call
 * budget** — the one figure in this file that is the same number on every machine and already has a ruled
 * value. `DRAW_CALL_BUDGET` is imported from `drawCalls.js` rather than restated, so the two perf gates can
 * never disagree about what §12 says.
 *
 * @param {ReturnType<typeof summariseFrameCost>} summary
 * @returns {{ok: boolean, worst: number, budget: number, pctOfBudget: number}}
 */
export function checkFrameCost(summary) {
  const worst = summary.drawCalls.max;
  return {
    ok: worst <= DRAW_CALL_BUDGET,
    worst,
    budget: DRAW_CALL_BUDGET,
    pctOfBudget: Math.round((worst / DRAW_CALL_BUDGET) * 100),
  };
}

/**
 * The failure message the frame-cost gate shows: the budget, the measurement, and what to do (the sprint's
 * own design constraint). The milliseconds ride along as context and are explicitly labelled as not the
 * reason for the failure, so nobody reads a red build here as "CI is too slow".
 *
 * @param {ReturnType<typeof summariseFrameCost>} summary
 * @returns {string}
 */
export function buildFrameCostFailureMessage(summary) {
  const { worst, budget, pctOfBudget } = checkFrameCost(summary);
  return (
    `KI-08-03: the worst sampled frame of a played round cost ${worst} draw calls, over ` +
    `ARCHITECTURE §12's budget of ${budget} (${pctOfBudget}% used), across ${summary.sampleCount} samples. ` +
    `Median ${summary.drawCalls.median}, p95 ${summary.drawCalls.p95}. Triangles: median ` +
    `${summary.triangles.median}, max ${summary.triangles.max}. ` +
    `Wall clock is context, never the cause of this failure — this gate never keys on milliseconds ` +
    `(KI-19-00): submit median ${summary.submitMs.median.toFixed(1)} ms, p95 ` +
    `${summary.submitMs.p95.toFixed(1)} ms on a GPU-less runner. Reduce what the frame draws. If the art ` +
    `genuinely needs more than ${budget} draw ` +
    'calls, that is a change to ARCHITECTURE §12 for the design lead to make — propose it in a PR labelled ' +
    'tuning-proposal, never by raising the constant.'
  );
}

/**
 * The leak gate (AC2): every {@link RESIDENCY_FIELDS} count must be **exactly** what it was at the first
 * reading, at every later checkpoint.
 *
 * Zero tolerance, deliberately. These four only move when something is created or disposed, and
 * `createGameplayScene` builds the arena, both snake views, the pickups and the lasers **once**, at renderer
 * construction — no round boundary and no match reset is supposed to add to any of them. A tolerance would
 * therefore only ever hide the thing being looked for; there is no legitimate drift for it to absorb.
 *
 * The first reading is the reference rather than a committed constant, because these numbers are a property
 * of the scene the art sprints will legitimately change: what must hold is that 500 rounds do not change
 * them, not that they equal today's values forever. `docs/qa/playtests/perf-baseline.md` records today's for
 * the record; this function never reads them.
 *
 * @param {ChurnReading[]} readings
 * @returns {{ok: boolean, growth: {field: string, from: number, to: number, round: number}[]}}
 */
export function checkNoLeak(readings) {
  /** @type {{field: string, from: number, to: number, round: number}[]} */
  const growth = [];
  if (readings.length < 2) return { ok: growth.length === 0, growth };

  const first = readings[0];
  for (const reading of readings.slice(1)) {
    for (const field of RESIDENCY_FIELDS) {
      const from = /** @type {any} */ (first.stats)[field];
      const to = /** @type {any} */ (reading.stats)[field];
      if (to !== from) growth.push({ field, from, to, round: reading.round });
    }
  }
  return { ok: growth.length === 0, growth };
}

/**
 * The failure message the leak gate shows: which count moved, from what to what, and by which round.
 *
 * "What to do" here is not a tuning proposal — a rising residency count is a defect, never a budget to
 * renegotiate — so this one says where to look instead.
 *
 * @param {ReturnType<typeof checkNoLeak>} result
 * @param {number} roundsDriven
 * @returns {string}
 */
export function buildLeakFailureMessage(result, roundsDriven) {
  const lines = result.growth.map(
    (entry) =>
      `  ${entry.field}: ${entry.from} → ${entry.to} by round ${entry.round} ` +
      `(+${entry.to - entry.from})`,
  );
  return (
    `KI-08-03: scene residency grew across ${roundsDriven} rounds of churn — a leak.\n` +
    `${lines.join('\n')}\n` +
    'These counts move only when something is created or disposed, and `createGameplayScene` builds the ' +
    'arena, both snake views, the pickups and the lasers exactly once, at renderer construction. So a rise ' +
    'means a round or match boundary is creating something it never disposes. Look at what runs on ' +
    'ROUND_OVER/REMATCH in `src/game/session.js` and at the `dispose()` of whichever view owns the count ' +
    'that moved. This is a defect to fix, not a budget to raise.'
  );
}

/**
 * The markdown table `frameTime.spec.js` prints and `perf-baseline.md` records: what the frame cost, with
 * the gated rows marked as such so a reader never has to guess which numbers can fail a build.
 *
 * @param {ReturnType<typeof summariseFrameCost>} summary
 * @returns {string}
 */
export function buildFrameCostTable(summary) {
  const { residency, heapBytes } = summary;
  const rows = [
    `| Draw calls | ${summary.drawCalls.median} | ${summary.drawCalls.p95} | ${summary.drawCalls.max} | **${DRAW_CALL_BUDGET}, gated** |`,
    `| Triangles | ${summary.triangles.median} | ${summary.triangles.p95} | ${summary.triangles.max} | recorded |`,
    `| Submit ms (JS side of render()) | ${summary.submitMs.median.toFixed(1)} | ${summary.submitMs.p95.toFixed(1)} | ${summary.submitMs.max.toFixed(1)} | recorded (${FRAME_TIME_BUDGET_MS} ms needs real hardware) |`,
  ];
  if (summary.wallMsPerSample !== null) {
    rows.push(
      `| Wall ms per sampled frame | ${summary.wallMsPerSample.toFixed(1)} | — | — | recorded; includes the rasterisation \`submitMs\` misses |`,
    );
  }
  if (residency !== null) {
    rows.push(
      `| Geometries resident | ${residency.geometries} | — | — | must not grow, gated |`,
      `| Textures resident | ${residency.textures} | — | — | must not grow, gated |`,
      `| Shader programs | ${residency.programs} | — | — | must not grow, gated |`,
      `| Scene nodes | ${residency.sceneNodes} | — | — | must not grow, gated |`,
    );
  }
  if (heapBytes !== null) {
    const mb = (/** @type {number} */ bytes) => (bytes / (1024 * 1024)).toFixed(1);
    rows.push(
      `| Heap used (MB) | ${mb(heapBytes.first)} → ${mb(heapBytes.last)} | — | — | recorded, never gated |`,
    );
  }
  return [
    `Sampled ${summary.sampleCount} frames, one every ${SAMPLE_EVERY_N_FRAMES} simulated frames.`,
    '',
    '| Measure | Median | p95 | Max | Budget |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * The churn table: residency at each checkpoint, so "flat" is visible rather than asserted.
 *
 * @param {ChurnReading[]} readings
 * @returns {string}
 */
export function buildChurnTable(readings) {
  const header =
    '| After round | Geometries | Textures | Programs | Scene nodes | Heap (MB) |\n|---|---|---|---|---|---|';
  const lines = readings.map((reading) => {
    const heap = reading.heapBytes === null ? '—' : (reading.heapBytes / (1024 * 1024)).toFixed(1);
    return (
      `| ${reading.round} | ${reading.stats.geometries} | ${reading.stats.textures} | ` +
      `${reading.stats.programs} | ${reading.stats.sceneNodes} | ${heap} |`
    );
  });
  return [header, ...lines].join('\n');
}
