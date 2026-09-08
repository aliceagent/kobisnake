// @ts-check
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { greedy } from '../agent/policies/greedy.js';
import { survivor } from '../agent/policies/survivor.js';
import {
  CHURN_ROUNDS,
  CHURN_SAMPLE_EVERY_N_ROUNDS,
  MAX_SAMPLES_PER_ROUND,
  SAMPLE_EVERY_N_FRAMES,
  buildChurnTable,
  buildFrameCostFailureMessage,
  buildFrameCostTable,
  buildLeakFailureMessage,
  checkFrameCost,
  checkNoLeak,
  measureChurnLeakInPage,
  measureRoundFrameCostInPage,
  summariseFrameCost,
} from './frameTime.js';

/**
 * KI-08-03 — the Playwright half. `frameTime.js` holds the measurement and the arithmetic; this file drives
 * the real built site and asserts the two things that are the same on every machine: the worst sampled
 * frame's draw calls against `ARCHITECTURE §12`, and that scene residency does not grow across 500 rounds.
 *
 * Millisecond figures are printed and never asserted (KI-19-00, KS-07-06). `frameTime.js`'s module doc has
 * the whole table of what gates and what only gets recorded, and `docs/qa/playtests/perf-baseline.md` is
 * the committed written form.
 *
 * Its own npm script, `npm run test:perf:frametime`, through `scripts/run-playwright-suite.mjs` like every
 * Playwright invocation in this repository (#86). Wiring it into CI is KI-08-04's.
 *
 * **`KI_PERF_BASELINE=1` regenerates the baseline document**, the same opt-in shape `report.spec.js` and
 * `pacing.spec.js` use for the documents they own: unset, the suite still measures and asserts everything,
 * it just does not rewrite a committed file as a side effect of an ordinary run.
 *
 * `describe.serial` because the two tests share nothing but must not overlap: each drives its own page, and
 * the churn test is the long one — running them in parallel would put two software-WebGL contexts on one
 * GPU-less runner, which is the same contention #86 is about one level down.
 */

/** `ARCHITECTURE §11`: a fixed seed, so a failure is replayable. */
const SEED = 1;

/** Guard bounds for the in-page state waits — the same shape `viewports.js` and `drawCalls.js` use. */
const GUARD_STEPS = 60;
const GUARD_CHUNK_SECONDS = 0.1;

/** The driver's own frame size (`tests/agent/driver.js`'s `FRAME_SECONDS`), passed in rather than imported
 *  by the in-page function, which may not reference module scope. */
const FRAME_SECONDS = 1 / 60;

/** Where the committed baseline lives (AC1). */
const BASELINE_PATH = join(process.cwd(), 'docs/qa/playtests/perf-baseline.md');

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoGame(page) {
  await page.goto(`/?test=1&seed=${SEED}`);
  await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));
}

test.describe.serial('KI-08-03 · frame-time budget', () => {
  /** @type {string[]} */
  const reportSections = [];

  test('KI-08-03 AC1: a played round is sampled frame by frame; the machine-independent figures gate, the milliseconds do not', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
    });

    await gotoGame(page);
    const result = await page.evaluate(measureRoundFrameCostInPage, {
      bestOf: 3,
      // Power-ups **on**, deliberately, and this is the one place in `tests/perf` where that is right.
      // KI-08-02 turns them off so a staged scene's number is attributable to the thing it names; this test
      // asks the opposite question — what is the worst frame a real round produces — and a pedestal on the
      // board during a laser step is exactly the frame it wants to catch.
      powerUpsEnabled: true,
      settingsOverrides: null,
      frameSeconds: FRAME_SECONDS,
      sampleEveryNFrames: SAMPLE_EVERY_N_FRAMES,
      maxSamples: MAX_SAMPLES_PER_ROUND,
      guardSteps: GUARD_STEPS,
      guardChunkSeconds: GUARD_CHUNK_SECONDS,
      policySources: [greedy.toString(), survivor.toString()],
    });

    expect(pageErrors, 'the page logged errors while being measured').toEqual([]);
    expect(
      result.statsAvailable,
      'this build has no __kobi.getRenderStats seam, so nothing was measured — a missing seam must never ' +
        'read as a scene that costs nothing',
    ).toBe(true);
    expect(result.samples.length, 'a played round produced no samples').toBeGreaterThan(0);

    const summary = summariseFrameCost(result.samples, result.wallMs);
    const table = buildFrameCostTable(summary);
    console.log(`\nKI-08-03: one played round, seed ${SEED}\n${table}\n`);
    reportSections.push(`### One played round (seed ${SEED}, power-ups on)\n\n${table}`);

    // The gate. Draw calls only — see this file's module doc and `frameTime.js`'s table.
    expect(checkFrameCost(summary).ok, buildFrameCostFailureMessage(summary)).toBe(true);
  });

  test(`KI-08-03 AC2: scene object counts do not grow across ${CHURN_ROUNDS} rounds' worth of churn`, async ({
    page,
  }) => {
    test.setTimeout(600_000);
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
    });

    await gotoGame(page);
    const result = await page.evaluate(measureChurnLeakInPage, {
      rounds: CHURN_ROUNDS,
      sampleEveryNRounds: CHURN_SAMPLE_EVERY_N_ROUNDS,
      powerUpsEnabled: true,
      guardSteps: GUARD_STEPS,
      guardChunkSeconds: GUARD_CHUNK_SECONDS,
    });

    expect(pageErrors, 'the page logged errors during the churn run').toEqual([]);
    expect(result.statsAvailable, 'no __kobi.getRenderStats seam; nothing was measured').toBe(true);
    expect(
      result.abandonedAt,
      'the churn loop stopped early, so fewer rounds were driven than the leak check claims',
    ).toBeNull();
    expect(
      result.roundsDriven,
      `only ${result.roundsDriven} of ${CHURN_ROUNDS} rounds were driven`,
    ).toBe(CHURN_ROUNDS);

    const table = buildChurnTable(result.readings);
    console.log(`\nKI-08-03: ${result.roundsDriven} rounds of churn\n${table}\n`);
    reportSections.push(`### Residency across ${result.roundsDriven} rounds of churn\n\n${table}`);

    const leak = checkNoLeak(result.readings);
    expect(leak.ok, buildLeakFailureMessage(leak, result.roundsDriven)).toBe(true);
  });

  // AC1's document is regenerated only behind `KI_PERF_BASELINE=1`, and only below the marker: everything
  // above it is prose a person wrote and a measurement run has no business rewriting. The same opt-in shape
  // `report.spec.js` and `pacing.spec.js` use for the documents they own.
  test.afterAll(() => {
    if (process.env.KI_PERF_BASELINE !== '1' || reportSections.length === 0) return;
    const marker = '<!-- MEASUREMENTS -->';
    const head = readFileSync(BASELINE_PATH, 'utf8').split(marker)[0];
    writeFileSync(BASELINE_PATH, `${head}${marker}\n\n${reportSections.join('\n\n')}\n`, 'utf8');
  });
});
