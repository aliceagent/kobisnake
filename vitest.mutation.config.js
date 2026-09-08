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

    /**
     * The three settings that make an exhaustive run affordable, and the measurement that forced them.
     *
     * The first full baseline took **53 minutes** for 1320 mutants against AC2's twenty-minute budget. It
     * was not the tests: Stryker narrows each mutant to the tests that cover it (18.84 of 286 on average,
     * about 0.27 s of actual test time), so of the ~4.8 s each mutant cost, roughly 4.5 s was Vitest
     * standing a test run back up — re-forking workers, re-transforming and re-collecting twelve files —
     * 1320 times over. A mutant is not a code change from Vitest's point of view: the instrumented source is
     * already loaded and the switch is a runtime check on a global. Paying a cold start for each one buys
     * nothing.
     *
     * So: one worker (Stryker already provides the parallelism, and stacking Vitest's fan-out inside each of
     * its workers only oversubscribes a four-core runner), the threads pool rather than forks (a thread is
     * far cheaper to hand work to than a process), and no per-file isolation (the module registry survives
     * between runs, which is what removes the re-transform).
     *
     * `isolate: false` is the one with teeth, and it is safe *here* for the reason this directory was chosen
     * as the mutation target in the first place: `src/core` is pure. It holds no module-level mutable state,
     * reads no ambient clock and no ambient randomness — `eslint.config.js` forbids all four ways it could
     * (KI-09-03) and `tests/unit/core/purity.test.js` proves it. All 286 tests pass unchanged under these
     * settings; if that ever stops being true, the honest fix is to find the shared state, not to re-isolate
     * and accept the hour.
     */
    maxWorkers: 1,
    pool: 'threads',
    poolOptions: { threads: { singleThread: true, isolate: false } },
  },
};
