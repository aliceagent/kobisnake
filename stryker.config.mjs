// @ts-check

/**
 * KI-17-01 (`docs/sprints/improvement-17-mutation-testing.md`) — mutation testing over `src/core`.
 *
 * ## Why this exists
 *
 * `src/core` has been at 100 % line coverage since Sprint 02, and in that time at least six tests that
 * asserted nothing reached `main` anyway (#111, #112, #115, #116, #142, #154). A line executed is not a line
 * checked, and coverage cannot tell the difference. Mutation testing can: it changes the code — flips a
 * comparison, drops a branch, alters a constant — and asks whether any test notices. A mutant that survives
 * is a test that is not testing.
 *
 * `src/core` is the right and only target for the gate: it is pure, deterministic, has no DOM and no
 * three.js, and its unit suite runs in seconds. `src/game` is measured once for information in KI-17-04 and
 * is deliberately not gated here.
 *
 * ## Which tests run against the mutants, and why the sim suites do not
 *
 * The ticket asks for `tests/unit/core/**` *and* `tests/sim/**`. The sim suites are scoped out, which the
 * ticket's own Risks section anticipates ("scope the sim suites out of the mutation run and say so"). This
 * is that saying-so:
 *
 * - `tests/sim` plays thousands of whole rounds per file and costs most of the wall clock of the whole
 *   suite — `tuningMatrix` 28 s, `laserStats` 19 s, `powerupFuzz` 16 s (the measurements are in
 *   `vitest.config.js`, from KI-19-06). A mutant covered by one of those files pays that cost *per mutant*,
 *   and there are over a thousand mutants. Including them does not fit AC2's twenty minutes; it does not fit
 *   twenty hours.
 * - They also add almost nothing that `tests/unit/core` does not already have. KI-19-06 measured the same
 *   question from the coverage side and found `tests/sim` worth 0.21 percentage points over `tests/unit` +
 *   `tests/agent`, because the sim suites drive the same rules the unit tests already pin line by line.
 * - The corollary is the one KI-19-06 already wrote down and is worth repeating here, because mutation
 *   testing makes it sharper: **a rule in `src/core` whose only proof is a fuzz run is a rule with no unit
 *   test.** If a mutant survives here that `tests/sim` would have killed, the answer is the unit test, not
 *   widening this config.
 *
 * The narrowing is done with the vitest runner's `dir` option rather than a second Vitest config file, so
 * there is exactly one place (`vitest.config.js`) that says how this project's tests run.
 *
 * ## No network, ever
 *
 * `reporters` deliberately omits Stryker's `dashboard` reporter, which is the one part of the tool that
 * talks to the internet (it POSTs the report to dashboard.stryker-mutator.io). Nothing else here opens a
 * socket, and `CLAUDE.md`'s first never — "never load anything from a CDN or external URL" — is about the
 * shipped game, which this cannot reach: Stryker is a dev dependency, no file under `src/` imports it, and
 * the bundle gate in `tests/perf/bundle.test.js` is unmoved by it.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',

  // `src/core` only. `src/game` and `src/render` are out of scope for the gate (the sprint file's "Out of
  // scope"); KI-17-04 measures `src/game` once, for information, by overriding this on the command line.
  mutate: ['src/core/**/*.js'],

  vitest: {
    // Only `tests/unit/core` runs against a mutant — see "Which tests run against the mutants" above.
    // `vitest.mutation.config.js` is where that narrowing is written, and it inherits everything else from
    // `vitest.config.js`; its header says why the runner's own `dir` and `related` options could not do it.
    configFile: 'vitest.mutation.config.js',
    // `related` mode asks Vite's module graph which test files import a mutated source file and answers
    // "none" here, at which point Stryker exits with "No tests were executed". It is redundant anyway:
    // `coverageAnalysis: 'perTest'` below narrows each mutant to the tests that actually cover it, from
    // measurement rather than from static resolution.
    related: false,
  },

  // Stryker records which tests cover which mutant during the initial run, then runs only those tests per
  // mutant. It is the difference between a run of minutes and a run of hours, and it is safe here precisely
  // because `src/core` is pure: a test's coverage of a line does not depend on the order the tests ran in.
  coverageAnalysis: 'perTest',

  // `clear-text` prints the surviving mutants with file and line, which is what AC1 commits; `html` is for a
  // human; `json` is what the nightly gate (KI-17-03) and the report generator read. `dashboard` is absent
  // on purpose — see "No network, ever" above.
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: {
    // Every survivor, not the first twenty: the whole point of the baseline is that the list is complete.
    maxTestsToLog: 0,
  },

  // Set by KI-17-02 from the honest baseline; the nightly gate (KI-17-03) compares against it.
  thresholds: { high: 100, low: 95, break: 95 },

  // Four cores in the container this runs in, shared with the other sprint sessions' worktrees, and a
  // GitHub runner is four cores too. Stryker's own default is already half the cores; it is stated here so
  // that a machine with more of them does not turn a twenty-minute gate into a fan-out nobody measured.
  concurrency: 2,

  // A mutant that makes the simulation loop forever (a `while (ticks < limit)` whose comparison is flipped)
  // must be reported as a timeout, not hang the run. Stryker derives the limit from the initial run's
  // duration plus this; `src/core`'s unit tests are milliseconds, so the constant is what matters.
  timeoutMS: 10_000,

  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
};

export default config;
