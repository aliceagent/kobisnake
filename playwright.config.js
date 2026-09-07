import { defineConfig, devices } from '@playwright/test';

import { previewBaseUrl, previewPort } from './scripts/preview-port.mjs';

/**
 * Every spec navigates with this query string (ARCHITECTURE §11: `?test=1` exposes `window.__kobi`,
 * `?seed=1` fixes the RNG, `?reducedFx=1` freezes anything that animates so screenshots are stable). The
 * scaffold ignores all three today — there is no simulation or RNG yet — but the ticket asks for it as the
 * default now so every later sprint's spec inherits it automatically.
 */
export const DEFAULT_QUERY = '?test=1&seed=1&reducedFx=1';

/**
 * KI-19-00 (#170): the preview port is derived from **this checkout's path**, not fixed at 4173, so a
 * `vite preview` left behind by another worktree in the same container is on another port entirely — it can
 * neither be adopted by `reuseExistingServer` below (a suite green about a different branch's `dist/`) nor
 * block this checkout's `--strictPort` as an orphan. `scripts/preview-port.mjs` holds the reasoning and is
 * also what `vite.config.js` binds, so a hand-started `npm run preview` in this worktree lands on the same
 * port this config dials — which is what keeps `reuseExistingServer`'s convenience working *within* a
 * checkout while removing it *between* checkouts.
 */
const PORT = previewPort();

export default defineConfig({
  testDir: './tests',
  // Only `.spec.js` files are Playwright's; `tests/unit` and `tests/sim` are `.test.js` files owned by
  // Vitest (see vitest.config.js) and must never be picked up here.
  testMatch: '**/*.spec.js',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // No retries: a test that fails once and passes on retry reports green while hiding the flake from
  // everybody, which is exactly what CLAUDE.md's "never quarantine a flaky test, say so and file it" rule
  // exists to prevent. This governs every sprint through S20, including visual baselines whose cross-machine
  // stability is not yet proven — a retry must never paper over that.
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  // Baselines are compared with a 0.2% pixel-diff budget (QA-STRATEGY §1) so the same software-rendered
  // WebGL frame travels between machines without either widening the threshold or being flaky.
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.002 },
  },
  // A flat, predictable baseline location per the ticket's Files list, instead of Playwright's default
  // per-test-file nested snapshot folders.
  snapshotPathTemplate: 'tests/visual/__baselines__/{arg}{ext}',
  use: {
    // From the same module as `webServer.port` below, so the URL the tests dial can never drift from the
    // port the server was told to bind (#170's ruling: "make `baseURL` follow").
    baseURL: previewBaseUrl(),
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    // Retries are off, so 'on-first-retry' would never capture anything; keep the trace from the one and
    // only failing run instead.
    trace: 'retain-on-failure',
  },
  // One project per engine. Playwright refuses the `--browser` CLI flag whenever a config defines projects,
  // so the engine has to be chosen with `--project` — which is what `nightly.yml` and the npm scripts do.
  // Chromium is the only engine a pull request blocks on; WebKit runs nightly (QA-STRATEGY §1). The
  // `firefox` project is defined but nothing runs it: its nightly leg was removed until Sprint 16 (#23).
  // Visual baselines are Chromium-only: `snapshotPathTemplate` deliberately has no project segment, so
  // `tests/visual` must never be run under another engine — it would compare a Firefox frame against a
  // Chromium baseline. Nightly runs `tests/e2e` only, for exactly this reason.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Headless Firefox on a GPU-less CI runner will not create a WebGL context, where Chromium falls
        // back to SwiftShader. These prefs are NOT sufficient on their own: they get Firefox past
        // "AllowWebgl2:false restricts context creation" to "Exhausted GL driver options", which is as far
        // as three attempts got (see issue #23 for what was tried and what is left). They are kept because
        // they are correct and because the next person should not repeat this ground. No workflow selects
        // this project today — `nightly.yml` dropped its Firefox leg until KS-16-02 solves #23 — so running
        // it by hand (`npx playwright test tests/e2e --project=firefox`) is still expected to fail, and the
        // failing test is right.
        launchOptions: {
          firefoxUserPrefs: {
            'webgl.force-enabled': true,
            'webgl.disabled': false,
            'webgl.enable-webgl2': true,
            'gfx.webrender.all': true,
            // The runner has no GL driver at all ("Exhausted GL driver options"), so Firefox needs to be
            // told to render WebGL in software the way Chromium does with SwiftShader by default.
            'gfx.webrender.software': true,
          },
        },
      },
    },
    {
      // Also the engine Improvement 09's determinism check runs on (KI-09-02). `nightly.yml` gives that one
      // spec its own `determinism (webkit)` job on top of the whole-directory `e2e (webkit)` leg, because
      // "WebKit and Node disagree on the same seed" is a different order of failure from a rendering gap and
      // has to be readable without opening a report. The spec drives its rounds through `__kobi` and a
      // detached `RoundSimulation` rather than through a rendered frame, so it does not depend on this
      // engine's WebGL — which is what lets it be trusted here while #23's Firefox context problem is still
      // open.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  // `vite preview` only has something to serve once `dist/` exists, so the web server builds first.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
