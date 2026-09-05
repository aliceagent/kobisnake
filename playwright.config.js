import { defineConfig, devices } from '@playwright/test';

/**
 * Every spec navigates with this query string (ARCHITECTURE §11: `?test=1` exposes `window.__kobi`,
 * `?seed=1` fixes the RNG, `?reducedFx=1` freezes anything that animates so screenshots are stable). The
 * scaffold ignores all three today — there is no simulation or RNG yet — but the ticket asks for it as the
 * default now so every later sprint's spec inherits it automatically.
 */
export const DEFAULT_QUERY = '?test=1&seed=1&reducedFx=1';

const PORT = 4173;

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
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    // Retries are off, so 'on-first-retry' would never capture anything; keep the trace from the one and
    // only failing run instead.
    trace: 'retain-on-failure',
  },
  // One project per engine. Playwright refuses the `--browser` CLI flag whenever a config defines projects,
  // so the engine has to be chosen with `--project` — which is what `nightly.yml` and the npm scripts do.
  // Chromium is the only engine a pull request blocks on; Firefox and WebKit run nightly (QA-STRATEGY §1).
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
        // they are correct and because the next person should not repeat this ground. The nightly Firefox
        // leg is red until #23 is solved; the failing test is right and stays failing.
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
