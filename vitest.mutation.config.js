import baseConfig from './vitest.config.js';

/**
 * KI-17-01 — the Vitest configuration the mutation run (`npm run test:mutation`) uses.
 *
 * This exists for one reason: **to say which tests run against a mutant**, which is `tests/unit/core` and
 * nothing else. `stryker.config.mjs` explains at length why the sim suites are scoped out (they cost most of
 * the suite's wall clock, they would be paid per mutant, and KI-19-06 already measured that they add 0.21 pp
 * over what `tests/unit` proves line by line). This is the file that does it.
 *
 * It is a separate config rather than an option on `stryker.config.mjs` because the vitest runner's own
 * narrowing options do not fit this project. `vitest.dir` re-roots Vitest's file scan, and `vitest.config.js`
 * writes its `include` globs from the repository root (`tests/unit/**` …), so a `dir` of `tests/unit/core`
 * makes every glob resolve under `tests/unit/core/tests/…` and Stryker exits with "No tests were executed".
 * `vitest.related` asks Vite's module graph which tests import a mutated file and answers "none" here, which
 * is the sibling failure. Overriding one array in a config that otherwise **inherits everything** is the
 * honest version of both: there is still exactly one place that says how this project's tests run, and this
 * file is a two-line diff against it rather than a second copy of it.
 *
 * Everything else is deliberately the base config's: the `node` environment, `maxWorkers`, and the coverage
 * block. Coverage is switched off because Stryker measures its own per-test coverage (`coverageAnalysis:
 * 'perTest'`) and v8 coverage on top of an instrumented file is pure cost — the same reason `npm run
 * test:unit` turns it off (KI-19-06).
 */
export default {
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['tests/unit/core/**/*.test.js'],
    coverage: { ...baseConfig.test.coverage, enabled: false },
    /**
     * Vitest's per-test default is 5 s and the core suite's slowest test takes 311 ms, so ordinarily this
     * would be absurd headroom. Under Stryker it is not: every mutable statement in `src/core` is compiled
     * with a guard around it, and the *initial* run additionally records which test executed which statement
     * (`coverageAnalysis: 'perTest'`). The tests that pay for that are the ones that run the simulation
     * thousands of times inside one `it` — `KS-06-01 AC1: OFF — zero power-up and effect events across 100
     * seeds` (311 ms plain) exceeded 5 s instrumented, and Stryker refuses to start when a test fails in the
     * initial run, so the whole gate fell over on a timeout that measured nothing but the instrumentation.
     *
     * Raising it is not weakening anything: the test's assertions are untouched and it still fails if the
     * behaviour is wrong. The thing that must still catch a mutant which makes the simulation loop forever
     * is Stryker's own per-mutant timeout (`timeoutMS` in `stryker.config.mjs`), which kills the runner
     * process and reports the mutant as a timeout — that is a *detected* mutant, and it is the mechanism
     * designed for it. Vitest's per-test timeout was never that mechanism; it was only ever in the way.
     */
    testTimeout: 60_000,
  },
};
