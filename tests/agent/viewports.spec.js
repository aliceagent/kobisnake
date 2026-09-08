// @ts-check
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { previewBaseUrl } from '../../scripts/preview-port.mjs';
import { SETTINGS } from '../../src/core/settings.js';
import {
  MID_ROUND_HOLD_SECONDS,
  STATE_GUARD_CHUNK_SECONDS,
  STATE_GUARD_STEPS,
  VIEWPORTS,
  arenaCorners,
  buildViewportRow,
  laserWarningOverrides,
  measureLaserBanner,
  measureMidRoundFrame,
  renderViewportsReport,
} from './viewports.js';

/**
 * KI-16-01 — plays the seven viewports `tests/agent/viewports.js` measures and writes the committed
 * `docs/qa/playtests/viewports.md` plus one screenshot per viewport under `docs/qa/playtests/viewports/`
 * (a declared deviation from this ticket's own `Files:` list, per its PR description).
 *
 * **Not part of `npm run test:agent`'s ten-match gate**, gated behind `KI_VIEWPORTS=1` exactly the way
 * `report.spec.js` gates `KI_AGENT_REPORT` and `pacing.spec.js` gates `KI_PACING`: unset, this test is
 * discovered and instantly skipped, so it costs the fast gate nothing. `npm run test:agent:viewports` sets it.
 *
 * **One test, not seven** — the same shape `report.spec.js` and `pacing.spec.js` use and for the same reason:
 * the document this writes is one coherent run, and Playwright's `fullyParallel` config would otherwise let
 * per-viewport tests race each other's writes to a shared results array across workers.
 *
 * This ticket **measures. It does not fix anything.** A viewport whose arena runs outside the frame, or whose
 * HUD pill overlaps it, is the expected, correct output of a camera and a HUD only ever designed and baselined
 * at 1280×720 (`DESIGN-DECISIONS §1 row 24`) — the only thing asserted below is that the harness itself worked
 * (no page error, the laser warning was actually reached), never that a viewport "passed".
 */

const RUN = /** @type {any} */ (globalThis).process?.env?.KI_VIEWPORTS === '1';

const here = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(here, '..', '..', 'docs', 'qa', 'playtests', 'viewports.md');
const SCREENSHOT_DIR = join(here, '..', '..', 'docs', 'qa', 'playtests', 'viewports');

/** The exact command this document tells its reader to run — also what regenerates it (AC1). */
const REGENERATING_COMMAND = 'KI_VIEWPORTS=1 npm run test:agent:viewports';

/**
 * Plays one viewport's two short scenarios (mid-round frame, then a fresh round pushed straight to
 * `LASER_WARNING`) against an already-sized `page`, screenshots the mid-round frame, and returns the combined
 * row `viewports.js`'s pure `buildViewportRow` needs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(typeof VIEWPORTS)[number]} viewport
 * @returns {Promise<import('./viewports.js').ViewportRow>}
 */
async function measureViewport(page, viewport) {
  const pageErrors = /** @type {string[]} */ ([]);
  const onPageError = (/** @type {Error} */ error) => pageErrors.push(error.message);
  page.on('pageerror', onPageError);

  try {
    await page.goto(`${previewBaseUrl()}${DEFAULT_QUERY}`);
    await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));

    const corners = arenaCorners(SETTINGS);
    const midRound = await page.evaluate(measureMidRoundFrame, {
      corners,
      bestOf: 3,
      holdSeconds: MID_ROUND_HOLD_SECONDS,
      guardSteps: STATE_GUARD_STEPS,
      guardChunkSeconds: STATE_GUARD_CHUNK_SECONDS,
    });

    // The mid-round frame is captured here, right after the one render `measureMidRoundFrame` produced —
    // `docs/qa/playtests/viewports/<slug>.png`, AC1's "screenshot per viewport".
    await page.screenshot({ path: join(SCREENSHOT_DIR, `${viewport.slug}.png`) });

    // `startMatch` only accepts `MAIN_MENU`, and phase one's fastForward left the state machine in `PLAYING`
    // (`strict: true` in dev/test — `session.js` throws rather than ignoring an illegal transition), so the
    // laser-banner phase reloads the page rather than trying to walk the state machine back to the menu by
    // hand. A fresh load is also what keeps this phase's `setSettingsOverrides` from ever touching phase one's
    // default-settings measurement — the viewport itself (size/DPR) is untouched by the reload.
    await page.goto(`${previewBaseUrl()}${DEFAULT_QUERY}`);
    await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));

    const { laserStartTime } = laserWarningOverrides(SETTINGS);
    const laser = await page.evaluate(measureLaserBanner, {
      bestOf: 3,
      laserStartTime,
      guardSteps: STATE_GUARD_STEPS,
      guardChunkSeconds: STATE_GUARD_CHUNK_SECONDS,
    });

    expect(pageErrors, `${viewport.slug}: page error(s)`).toEqual([]);
    expect(
      laser.reached,
      `${viewport.slug}: LASER_WARNING was not reached inside its guard budget`,
    ).toBe(true);

    return buildViewportRow({
      slug: viewport.slug,
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.dpr,
      why: viewport.why,
      corners,
      midRound,
      laser,
    });
  } finally {
    page.off('pageerror', onPageError);
  }
}

test.describe('KI-16-01 · viewport matrix', () => {
  test('measures the game at seven viewports and writes docs/qa/playtests/viewports.md', async ({
    page,
    browser,
  }) => {
    test.skip(
      !RUN,
      'set KI_VIEWPORTS=1 (via `npm run test:agent:viewports`) to run the matrix — this is deliberately not ' +
        "part of the fast npm run test:agent gate (see this file's module doc)",
    );
    test.setTimeout(5 * 60_000);

    mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const startedAt = Date.now();
    /** @type {import('./viewports.js').ViewportRow[]} */
    const rows = [];

    for (const viewport of VIEWPORTS) {
      if (viewport.dpr === 1) {
        // `page.setViewportSize()` — the ordinary route, and what every other viewport uses (tech-lead notes
        // item 7).
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        rows.push(await measureViewport(page, viewport));
      } else {
        // Playwright only lets `deviceScaleFactor` be set at context creation, never on an existing page
        // (tech-lead notes item 7), so the DPR-2 row alone gets its own `browser.newContext`. `baseURL` is
        // passed explicitly because a manually created context does not inherit `playwright.config.js`'s
        // `use.baseURL` the way the default `page` fixture does.
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: viewport.dpr,
          baseURL: previewBaseUrl(),
        });
        try {
          const dprPage = await context.newPage();
          rows.push(await measureViewport(dprPage, viewport));
        } finally {
          await context.close();
        }
      }
      console.log(`KI-16-01: [${rows.length}/${VIEWPORTS.length}] measured ${viewport.slug}`);
    }

    const wallSeconds = Math.round((Date.now() - startedAt) / 1000);

    const markdown = renderViewportsReport({
      meta: {
        date: new Date().toISOString().slice(0, 10),
        command: REGENERATING_COMMAND,
        wallSeconds,
      },
      rows,
    });
    writeFileSync(REPORT_PATH, markdown);

    console.log(
      `KI-16-01: wrote ${REPORT_PATH} and ${rows.length} screenshots under ${SCREENSHOT_DIR} — ` +
        `${wallSeconds}s wall time.`,
    );
  });
});
