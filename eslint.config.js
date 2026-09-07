// @ts-check
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * Flat ESLint config (ARCHITECTURE §2: `eslint:recommended` + `eslint-plugin-import`; Prettier owns
 * formatting, so `eslint-config-prettier` turns off any rule that would fight it).
 *
 * Three kinds of file exist here: browser code under `src/` (bundled by Vite, runs in a page), Node-ish
 * tooling config at the repository root (this file, `vite.config.js`), and test files under `tests/` (Vitest
 * and Playwright, run by Node — KS-01-03 adds the first of these). Each gets its own globals so `no-undef`
 * knows what `window`, `process` or `describe` means without pulling in a dependency none of the three need.
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.claude/**',
    ],
  },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
  {
    // `eslint-plugin-import`'s recommended flat config pins `ecmaVersion` to 2018, which turns modern syntax
    // (`??`, `?.`) into a parse error in every file the per-directory blocks below do not cover —
    // `scripts/sync-labels.mjs` was the first casualty. Set the language level once, for everything.
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly',
        document: 'readonly',
        performance: 'readonly',
        console: 'readonly',
        URLSearchParams: 'readonly',
        requestAnimationFrame: 'readonly',
        HTMLCanvasElement: 'readonly',
      },
    },
  },
  {
    // KI-09-03 (`docs/sprints/improvement-09-determinism-across-browsers.md`): `src/core` is the pure
    // simulation (`ARCHITECTURE §4` — integer ticks, a seeded RNG) that every golden log, replay fixture, bot
    // matrix and `?seed=1` visual baseline is proved against. That proof only holds if the same seed and the
    // same input log always produce the same event log, which is false the moment anything in here reads
    // ambient time or randomness instead of the tick counter and `src/core/rng.js`'s seeded `Rng`. These three
    // built-in rules (no plugin, no new dependency) forbid the four ways that could happen: `Math.random` as
    // an unseeded second source of randomness, and `Date.now`, `performance.now` and `new Date` as sources of
    // wall-clock time. Scoped to `src/core` only — `src/game` and `src/render` legitimately use timers
    // (`src/game/loop.js`, `src/game/input.js`, `src/game/session.js`'s default match seed, …).
    files: ['src/core/**/*.js'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'src/core must be deterministic: all randomness goes through the seeded Rng in src/core/rng.js, never Math.random (ARCHITECTURE §4, KI-09-03).',
        },
        {
          object: 'Date',
          property: 'now',
          message:
            'src/core must be deterministic: time is counted in whole simulation ticks, never read from Date.now (ARCHITECTURE §4, KI-09-03).',
        },
        {
          object: 'performance',
          property: 'now',
          message:
            'src/core must be deterministic: time is counted in whole simulation ticks, never read from performance.now (ARCHITECTURE §4, KI-09-03).',
        },
      ],
      // `no-restricted-properties` only sees `Date.now(...)` written as a member access; `new Date(...)` is a
      // different syntax node (a NewExpression, not a MemberExpression) and needs its own rule to catch it.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'NewExpression[callee.name="Date"]',
          message:
            'src/core must be deterministic: time is counted in whole simulation ticks, never read from `new Date` (ARCHITECTURE §4, KI-09-03).',
        },
      ],
      // Closes the *aliasing* gap the two rules above leave open: `const p = performance; p.now()` (or the
      // same for `Date`) never writes the member expression `performance.now`/`Date.now` those rules match
      // on, so restricting the bare globals themselves is what catches it. (Destructuring, e.g.
      // `const { now } = performance`, is not actually this gap — `no-restricted-properties` already flags
      // that on its own; this block being the only place both rules fire is aliasing, not destructuring.)
      // `Date` is listed here for the same reason `performance` is: an alias walks around
      // `no-restricted-syntax`'s `new Date` check and `no-restricted-properties`'s `Date.now` check exactly
      // the same way, and there is no reason to guard one ambient clock against aliasing and not the other.
      //
      // What neither this nor the two rules above can catch: an indirection that never names `performance`
      // or `Date` as an identifier at all, e.g. `globalThis.performance.now()` or a value smuggled in through
      // a parameter. No static rule can chase every such path. The complementary guard is AC2's test
      // (`tests/unit/core/purity.test.js`): it does not care how a call to the ambient clock is spelled,
      // only whether one is ever actually made, by replacing the real globals with throwing stubs and
      // running a full round. The lint rule catches the common, nameable forms early and cheaply, at every
      // save; the throwing-stub test is the backstop that would still catch a form the lint rule cannot name.
      'no-restricted-globals': [
        'error',
        {
          name: 'performance',
          message:
            'src/core must be deterministic: do not reach for the ambient performance clock at all, not even through an alias (ARCHITECTURE §4, KI-09-03) — time is counted in whole simulation ticks.',
        },
        {
          name: 'Date',
          message:
            'src/core must be deterministic: do not reach for the ambient Date clock at all, not even through an alias (ARCHITECTURE §4, KI-09-03) — time is counted in whole simulation ticks.',
        },
      ],
    },
  },
  {
    // KI-12-01 (`docs/sprints/improvement-12-cpu-opponent.md` AC3): `src/game/bots` holds the play policies
    // the CPU opponent and both test layers share. It has to run in three places — a plain Node unit test,
    // the headless `tests/sim` harness, and *inside a browser page as source text*, because
    // `tests/agent/driver.js` ships a policy in with `Function.prototype.toString()`. A renderer, a
    // stylesheet or a test helper on the import graph breaks at least one of the three, and an import back
    // into `tests/` would invert the dependency the ticket just spent its whole scope straightening out.
    //
    // This rule matches the specifier written in the file in front of it, which is the common case and the
    // one worth catching at every save. It cannot follow the graph one hop further —
    // `tests/unit/game/bots/boundaries.test.js` is the backstop that does.
    files: ['src/game/bots/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/render/**', '**/ui/**', '**/tests/**'],
              message:
                'src/game/bots must stay importable from Node, from the sim harness and as source text inside a browser page: no src/render, no src/ui, nothing from tests/ (KI-12-01 AC3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
      },
    },
    rules: {
      // `eslint-plugin-import`'s default resolver reads a package's `main`/`module` fields but not its
      // `exports` map, so a conditional subpath like `vitest/config` (used by `vitest.config.js`) looks
      // unresolvable to it even though Node and Vite both resolve it fine. Off for the root config files
      // only — `import/no-unresolved` still runs on `src/` and `tests/`, where it earns its keep.
      'import/no-unresolved': 'off',
    },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Vitest's global test API (`vitest.config.js` turns it on) and the identifiers `@playwright/test`
        // specs commonly reach for, so `no-undef` does not flag KS-01-03's suites the moment they land.
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly',
        // Node globals a Playwright spec file genuinely runs under (the file itself executes in Node).
        URL: 'readonly',
        // `tests/sim/stats.test.js` (KS-02-06) times bot rounds and prints the QA-STRATEGY §4 statistics
        // table — both Node-standard globals, already whitelisted the same way for `src/**/*.js` above.
        performance: 'readonly',
        console: 'readonly',
        // KI-03-01: `tests/agent/suiteLock.test.js` spawns the Playwright suite runner as a real child
        // process and checks its exit status, which needs `process.execPath`, `process.env` and
        // `process.kill`. Same reasoning as the two above — a Vitest file executes in Node, and this is
        // the Node standard library, not a browser global smuggled in.
        process: 'readonly',
        // NOT a Node global: this exists so `page.evaluate(() => ... requestAnimationFrame ...)` lints
        // clean. That arrow function's *body* is serialised and runs inside the browser page, not in Node,
        // even though it is written inline in this Node-executed file — the one place in `tests/**` where
        // the static file and the runtime environment genuinely differ.
        requestAnimationFrame: 'readonly',
      },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        // Maintenance scripts run under Node, not in the page.
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
  },
  // Prettier owns formatting; this must be last so it can switch off conflicting stylistic rules.
  eslintConfigPrettier,
];
