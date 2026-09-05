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
