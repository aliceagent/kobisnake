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
    ],
  },
  js.configs.recommended,
  importPlugin.flatConfigs.recommended,
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
      },
    },
  },
  // Prettier owns formatting; this must be last so it can switch off conflicting stylistic rules.
  eslintConfigPrettier,
];
