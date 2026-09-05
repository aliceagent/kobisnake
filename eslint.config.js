// @ts-check
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import eslintConfigPrettier from 'eslint-config-prettier';

/**
 * Flat ESLint config (ARCHITECTURE §2: `eslint:recommended` + `eslint-plugin-import`; Prettier owns
 * formatting, so `eslint-config-prettier` turns off any rule that would fight it).
 *
 * Two kinds of file exist in the scaffold: browser code under `src/` (bundled by Vite, runs in a page) and
 * Node-ish tooling config at the repository root (this file, `vite.config.js`). Each gets its own globals so
 * `no-undef` knows what `window` or `process` means without pulling in a dependency neither list needs.
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
  // Prettier owns formatting; this must be last so it can switch off conflicting stylistic rules.
  eslintConfigPrettier,
];
