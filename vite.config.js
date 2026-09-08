import { defineConfig } from 'vite';

import { resolveBuildCommit, resolveBuildDate } from './scripts/build-stamp.mjs';
import { previewPort } from './scripts/preview-port.mjs';

// The whole game is a single static page. Everything (three.js included) is bundled from npm so the built
// site never asks the network for anything after it loads.

/**
 * KI-19-03: the commit short-hash and build date, resolved once per `vite.config.js` evaluation (`resolveBuildCommit`'s
 * own doc comment in `scripts/build-stamp.mjs` covers the env-var-then-`git`-then-`'unknown'` fallback chain)
 * and baked into `import.meta.env` below via `define` — a build-time substitution, not a runtime read, which
 * is what makes AC2 ("no runtime network request to find it out") true: the string is already sitting in the
 * bundle before the page is ever served, there is nothing left to ask for.
 */
const BUILD_COMMIT = resolveBuildCommit();
const BUILD_DATE = resolveBuildDate();

export default defineConfig({
  base: './',
  // KI-19-03: extends `import.meta.env` with two build-time constants, the same mechanism Vite itself uses
  // for `import.meta.env.DEV` (`src/main.js`'s own comment: that file is the one place allowed to read
  // `import.meta.env`, and does — see its `buildStamp` constant). `KOBI_`-prefixed rather than `VITE_`:
  // Vite's `VITE_` convention is for values it loads from an actual `.env` file, and these two never come
  // from one.
  define: {
    'import.meta.env.KOBI_BUILD_COMMIT': JSON.stringify(BUILD_COMMIT),
    'import.meta.env.KOBI_BUILD_DATE': JSON.stringify(BUILD_DATE),
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // Sourcemaps are off so `dist/` carries no absolute URLs at all (KS-01-01 AC3).
    sourcemap: false,
    assetsInlineLimit: 0,
    // three.js is ~500 kB raw but ~130 kB gzipped, and the budget that actually matters is the gzip one in
    // ARCHITECTURE §12 (≤ 350 kB). This raises Vite's raw-size warning just above today's bundle so it still
    // fires if something unexpectedly large lands, without crying about three.js on every build.
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
  },
  preview: {
    // KI-19-00 (#170): derived from this checkout's path rather than fixed at 4173, so two worktrees in one
    // container never contend for one preview port and `playwright.config.js` — which reads the same module
    // — always dials the server this one binds. `scripts/preview-port.mjs` has the full reasoning.
    port: previewPort(),
  },
});
