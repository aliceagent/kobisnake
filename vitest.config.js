import { cpus } from 'node:os';

import { defineConfig } from 'vitest/config';

/**
 * Sprint 02 flips `COVERAGE_STRICT=1` on in CI once `src/core` and `src/game` have real code in them
 * (QA-STRATEGY §1). Until then the thresholds are expressed here at their real target values but pinned to 0
 * so an empty `src/core`/`src/game` does not fail a build that has not written any simulation code yet.
 */
const STRICT = process.env.COVERAGE_STRICT === '1';

/** Coverage floor for `src/core` (QA-STRATEGY §1: "≥ 90 % lines on src/core"). */
const CORE_THRESHOLD = STRICT ? 90 : 0;
/** Coverage floor for `src/game` (QA-STRATEGY §1: "≥ 75 % on src/game"). */
const GAME_THRESHOLD = STRICT ? 75 : 0;
/**
 * Coverage floor for `src/render` (QA-STRATEGY §1, amended by the design lead at Sprint 03 sign-off:
 * "from Sprint 04, ≥ 75 % on `src/render`"). Sprint 03 left 75 view-module tests behind with no floor under
 * them; KS-04-00 puts the floor in before Sprint 04 adds `laserView.js` on top.
 */
const RENDER_THRESHOLD = STRICT ? 75 : 0;

/**
 * KI-19-00 (#181): **local runs use half this machine's cores; CI uses Vitest's own default.**
 *
 * The failure this fixes is `npm run test:unit` exiting **non-zero with every test passing**:
 *
 * ```
 *  Test Files  41 passed (41)  ·  Tests  718 passed (718)  ·  Errors  1 error
 *  Error: [vitest-worker]: Timeout calling "onTaskUpdate"
 * ```
 *
 * That is Vitest's own worker→main progress RPC missing its window, not a test — and it is the worst possible
 * pair of signals: an agent trusting the exit code hunts through 718 green tests for a failure that is not
 * there, and an agent trusting the summary learns to wave a red `test:unit` through, which is how a real
 * failure gets missed later. `CLAUDE.md`'s setup section now says what to do when it happens; this is the
 * half that makes it happen less.
 *
 * Vitest's default fans out to every core. `HANDOFF.md` gives every ticket its own worktree and several of
 * them share one four-core container, so "every core" is a fiction — the cores are already taken, and the
 * fan-out is what starves the RPC. Half the cores leaves room for the neighbours that are the reason this is
 * contended in the first place, and it is `maxWorkers` (a pool-agnostic option) rather than
 * `poolOptions.threads.maxThreads` so it holds whichever pool Vitest defaults to.
 *
 * **CI is deliberately untouched.** A GitHub Actions runner is one container running one job with nothing
 * else on it: there is no contention to relieve, and halving its workers would buy nothing and cost wall
 * clock on the gate every PR waits for.
 *
 * What is *not* done here, per the ruling on #170: `dangerouslyIgnoreUnhandledErrors` is not set. Muting
 * unhandled errors would give a clean exit by hiding real ones, which is the same disease this is treating,
 * from the other direction.
 */
const LOCAL_MAX_WORKERS = Math.max(1, Math.floor(cpus().length / 2));

export default defineConfig({
  test: {
    // See LOCAL_MAX_WORKERS above. `undefined` on CI leaves Vitest's own default in place rather than
    // restating it here, so a future Vitest that changes that default changes CI too.
    maxWorkers: process.env.CI ? undefined : LOCAL_MAX_WORKERS,
    // `tests/sim` (ARCHITECTURE §3) is headless whole-round simulation and shares Vitest with `tests/unit`;
    // there is no separate runner for it, so both live under `npm run test:unit`.
    //
    // `tests/agent` (KI-03-01) is the browser playtest layer, and its *suite* is Playwright's — Playwright
    // takes only `*.spec.js`, Vitest only `*.test.js`, so the two runners split that directory cleanly. The
    // `.test.js` half is the pure functions the browser layer is built from: the driver's own failure gate,
    // KI-03-02's policies and KI-03-03's invariants, each provable in Node against a hand-built snapshot.
    // Without this line those tests would exist and never run.
    include: ['tests/unit/**/*.test.js', 'tests/sim/**/*.test.js', 'tests/agent/**/*.test.js'],
    environment: 'node',
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/core/**/*.js', 'src/game/**/*.js', 'src/render/**/*.js'],
      // The one exclusion QA-STRATEGY §1 allows for `src/render`, by name: "renderer/WebGL entry points may
      // be excluded by name". `renderer.js` owns `THREE.WebGLRenderer`, the resize handler and the rAF-facing
      // `render()` — none of which can execute in Node, where there is no canvas and no GL context. Every
      // other `src/render` module is a plain scene-graph builder and is unit-tested in Node against real
      // three.js objects, so it is gated like any other file. Nothing else may be added here: a view module
      // below the floor gets tests, not an exclusion (KS-04-00).
      exclude: ['src/render/renderer.js'],
      thresholds: {
        // Per-file, not aggregate. KS-02-07's review found that the aggregate gate needed eight untested
        // functions to trip: `grid.js` alone sat at 38 % functions and 86 % statements while the whole of
        // `src/core` was still just under the floor, so a single badly covered module hides behind its
        // well-covered neighbours. Accepted by the design lead for Sprint 03 housekeeping (issue #26).
        perFile: true,
        'src/core/**/*.js': {
          lines: CORE_THRESHOLD,
          statements: CORE_THRESHOLD,
          functions: CORE_THRESHOLD,
          branches: CORE_THRESHOLD,
        },
        'src/game/**/*.js': {
          lines: GAME_THRESHOLD,
          statements: GAME_THRESHOLD,
          functions: GAME_THRESHOLD,
          branches: GAME_THRESHOLD,
        },
        'src/render/**/*.js': {
          lines: RENDER_THRESHOLD,
          statements: RENDER_THRESHOLD,
          functions: RENDER_THRESHOLD,
          branches: RENDER_THRESHOLD,
        },
      },
    },
  },
});
