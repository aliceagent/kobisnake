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

export default defineConfig({
  test: {
    // `tests/sim` (ARCHITECTURE §3) is headless whole-round simulation and shares Vitest with `tests/unit`;
    // there is no separate runner for it, so both live under `npm run test:unit`.
    include: ['tests/unit/**/*.test.js', 'tests/sim/**/*.test.js'],
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
