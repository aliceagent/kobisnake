import { defineConfig } from 'vite';

// The whole game is a single static page. Everything (three.js included) is bundled from npm so the built
// site never asks the network for anything after it loads.
export default defineConfig({
  base: './',
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
    port: 4173,
  },
});
