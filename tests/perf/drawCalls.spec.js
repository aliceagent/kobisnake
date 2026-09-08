// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { greedy } from '../agent/policies/greedy.js';
import { survivor } from '../agent/policies/survivor.js';
import {
  FRAME_SECONDS,
  SCENE_MAX_FRAMES,
  STATE_GUARD_CHUNK_SECONDS,
  STATE_GUARD_STEPS,
  buildBudgetFailureMessage,
  buildDrawCallsReportTable,
  checkDrawCallBudget,
  endgameOverrides,
  laserWarningOverrides,
  midRoundLengthTarget,
  sampleSceneInPage,
} from './drawCalls.js';

/**
 * KI-08-02 — the Playwright half. `drawCalls.js` names the scenes, the budget and the in-page measurement;
 * this file drives the real built site to take each sample and asserts every one against
 * `DRAW_CALL_BUDGET`.
 *
 * Not part of any other suite's gate — this is its own npm script, `npm run test:perf:drawcalls`
 * (`package.json`), through `scripts/run-playwright-suite.mjs` like every Playwright invocation in this
 * repository. Wiring it into CI is KI-08-04's, not this ticket's (tech-lead ruling 1).
 *
 * **`test.describe.serial`, not `fullyParallel` (`playwright.config.js`'s default):** every scene below is
 * independent — each does its own `page.goto` and needs nothing from another — but the combined report table
 * `afterAll` prints needs every row collected into one array from one worker process, the same reason
 * `viewports.spec.js` and `pacing.spec.js` keep their own multi-part runs to one test each. `serial` gets the
 * shared array without needing that.
 *
 * **Seeds, and why two scenes try more than one.** `opening-board`, `laser-warning` and every menu screen are
 * deterministic moments no bot has to survive to reach, so each uses the suite's own default seed. The two
 * policy-driven scenes — `mid-round-long-snakes` (greedy vs. greedy, grown well past spawn) and `endgame-6x6`
 * (survivor vs. survivor, the settings-shortened squeeze — see `drawCalls.js`'s module doc) — are not
 * guaranteed to succeed on any one seed, since a snake dying before the target condition is reached is a real
 * possible outcome of real play, not a bug. Each tries {@link POLICY_SEEDS} in order and keeps the first
 * whose sample reports `reached: true`, exactly the resilience a real playtest needs and a fixture would
 * hide.
 */

/** The suite's own default seed — deterministic scenes need no other (`ARCHITECTURE §11`). */
const DEFAULT_SEED = 1;

/** Seeds a policy-driven scene tries, in order, keeping the first that reaches its target condition. */
const POLICY_SEEDS = [1, 2, 3, 4, 5, 6];

/**
 * Loads the built site at `?test=1&seed=N` and waits for `__kobi` — `driver.js`'s own two lines, restated
 * here because this file does not import `driver.js` (no policy-driven whole-match loop is wanted; see the
 * module doc's "why this file writes its own in-page loop rather than calling `playMatch`" note below).
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} seed
 */
async function gotoSeed(page, seed) {
  await page.goto(`/?test=1&seed=${seed}`);
  await page.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));
}

/**
 * Runs one scene once at one seed and returns the sample plus any page errors observed during it — the unit
 * both {@link measureOnce} and {@link measureWithRetries} share.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} seed
 * @param {Parameters<typeof sampleSceneInPage>[0]} evalArgs
 * @returns {Promise<{sample: ReturnType<typeof sampleSceneInPage>, pageErrors: string[]}>}
 */
async function measureAtSeed(page, seed, evalArgs) {
  /** @type {string[]} */
  const pageErrors = [];
  const onPageError = (/** @type {Error} */ error) => pageErrors.push(error.message);
  page.on('pageerror', onPageError);
  try {
    await gotoSeed(page, seed);
    const sample = await page.evaluate(sampleSceneInPage, evalArgs);
    return { sample, pageErrors };
  } finally {
    page.off('pageerror', onPageError);
  }
}

/** A deterministic scene: one seed, no retry — a `false` `reached` here is a real defect, not bad luck. */
async function measureOnce(
  /** @type {import('@playwright/test').Page} */ page,
  /** @type {Parameters<typeof sampleSceneInPage>[0]} */ evalArgs,
) {
  const { sample, pageErrors } = await measureAtSeed(page, DEFAULT_SEED, evalArgs);
  expect(pageErrors, `${evalArgs.scene}: page error(s)`).toEqual([]);
  return sample;
}

/**
 * A policy-driven scene: tries {@link POLICY_SEEDS} in order and keeps the first sample that both ran clean
 * and reached its target condition.
 */
async function measureWithRetries(
  /** @type {import('@playwright/test').Page} */ page,
  /** @type {Parameters<typeof sampleSceneInPage>[0]} */ evalArgs,
) {
  /** @type {string[]} */
  const attempts = [];
  for (const seed of POLICY_SEEDS) {
    const { sample, pageErrors } = await measureAtSeed(page, seed, evalArgs);
    if (pageErrors.length > 0) {
      attempts.push(`seed ${seed}: page error(s) ${pageErrors.join('; ')}`);
      continue;
    }
    if (sample.reached) return sample;
    attempts.push(
      `seed ${seed}: not reached — ${JSON.stringify(sample.composition)}, ${SCENE_MAX_FRAMES} frames spent`,
    );
  }
  throw new Error(
    `${evalArgs.scene}: no seed among [${POLICY_SEEDS.join(', ')}] reached its target condition.\n` +
      attempts.join('\n'),
  );
}

/** @type {Parameters<typeof sampleSceneInPage>[0]} */
const BASE_ARGS = Object.freeze({
  scene: /** @type {any} */ (null), // overridden per call
  bestOf: 3,
  powerUpsEnabled: false, // AC2 isolation (tech-lead ruling 5 / KS-07-00's own cautionary tale).
  settingsOverrides: null,
  frameSeconds: FRAME_SECONDS,
  maxFrames: SCENE_MAX_FRAMES,
  guardSteps: STATE_GUARD_STEPS,
  guardChunkSeconds: STATE_GUARD_CHUNK_SECONDS,
  lengthTarget: 0,
  policySources: null,
});

/** @type {{slug: string, drawCalls: number, composition: import('./drawCalls.js').SceneComposition}[]} */
const rows = [];

/**
 * Records one measured row, asserts it against `DRAW_CALL_BUDGET`, and logs its evidence — the one place
 * every scene's assertion and console line come from, so no scene's check can drift from another's.
 *
 * @param {string} slug
 * @param {ReturnType<typeof sampleSceneInPage>} sample
 */
function recordAndAssert(slug, sample) {
  rows.push({ slug, drawCalls: sample.drawCalls, composition: sample.composition });
  console.log(
    `KI-08-02: ${slug} — ${sample.drawCalls} draw calls — ${JSON.stringify(sample.composition)}`,
  );
  const { overBudget } = checkDrawCallBudget(sample.drawCalls);
  expect(overBudget, buildBudgetFailureMessage(slug, sample.drawCalls, sample.composition)).toBe(false);
}

test.describe.serial('KI-08-02 · draw-call budget', () => {
  test('KI-08-02 AC1/AC2: opening-board — the round at tick 0, both snakes at spawn, no lasers', async ({
    page,
  }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'opening-board' });
    expect(sample.reached, 'opening-board: PLAYING was not reached').toBe(true);
    expect(sample.composition.snakeLengths).toEqual([
      SETTINGS.startingSnakeLength,
      SETTINGS.startingSnakeLength,
    ]);
    expect(sample.composition.pickupCount, 'powerUpsEnabled: false must isolate this sample from a pedestal')
      .toBe(0);
    recordAndAssert('opening-board', sample);
  });

  test('KI-08-02 AC1/AC2: mid-round-long-snakes — both snakes grown well past spawn on real greedy play', async ({
    page,
  }) => {
    const target = midRoundLengthTarget(SETTINGS);
    const sample = await measureWithRetries(page, {
      ...BASE_ARGS,
      scene: 'mid-round-long-snakes',
      lengthTarget: target,
      policySources: [greedy.toString(), greedy.toString()],
    });
    // AC1's own wording: state the lengths actually reached and assert they are meaningfully longer than
    // spawn, so a regression that stops growth cannot quietly turn this into a second opening-board sample.
    expect(sample.composition.snakeLengths, 'both snakes must reach the growth target').not.toBeNull();
    for (const length of /** @type {number[]} */ (sample.composition.snakeLengths)) {
      expect(length, `snake length ${length} vs. spawn ${SETTINGS.startingSnakeLength}`).toBeGreaterThanOrEqual(
        target,
      );
    }
    expect(sample.composition.pickupCount, 'powerUpsEnabled: false must isolate this sample from a pedestal')
      .toBe(0);
    recordAndAssert('mid-round-long-snakes', sample);
  });

  test('KI-08-02 AC1/AC2: laser-warning — the beams lit, lasers.phase left PARKED', async ({ page }) => {
    const sample = await measureOnce(page, {
      ...BASE_ARGS,
      scene: 'laser-warning',
      settingsOverrides: laserWarningOverrides(SETTINGS),
    });
    expect(sample.reached, 'laser-warning: PARKED never left').toBe(true);
    expect(sample.composition.laserPhase).not.toBe('PARKED');
    expect(sample.composition.pickupCount, 'powerUpsEnabled: false must isolate this sample from a pedestal')
      .toBe(0);
    recordAndAssert('laser-warning', sample);
  });

  test('KI-08-02 AC1/AC2: endgame-6x6 — the lasers at maximum inset, the safe square shrunk to 6×6', async ({
    page,
  }) => {
    const sample = await measureWithRetries(page, {
      ...BASE_ARGS,
      scene: 'endgame-6x6',
      settingsOverrides: endgameOverrides(SETTINGS),
      policySources: [survivor.toString(), survivor.toString()],
    });
    expect(sample.composition.laserPhase, 'endgame-6x6: lasers never reached STOPPED (max inset)').toBe(
      'STOPPED',
    );
    const safeSquareWidth = SETTINGS.grid.width - 2 * /** @type {number} */ (sample.composition.laserInset);
    expect(safeSquareWidth, 'the safe square at STOPPED must be the 6×6 minimum').toBe(SETTINGS.laserMinArena);
    expect(sample.composition.pickupCount, 'powerUpsEnabled: false must isolate this sample from a pedestal')
      .toBe(0);
    recordAndAssert('endgame-6x6', sample);
  });

  test('KI-08-02 AC1: menu-main-menu — the idle title screen; also AC2\'s floor sample (nothing on the board)', async ({
    page,
  }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-main-menu' });
    expect(sample.reached).toBe(true);
    expect(sample.composition.state).toBe('MAIN_MENU');
    expect(sample.composition.snakeLengths, 'the floor sample must have nothing on the board').toBeNull();
    recordAndAssert('menu-main-menu', sample);
  });

  test('KI-08-02 AC1: menu-match-setup — reached from MAIN_MENU via SELECT_2P', async ({ page }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-match-setup' });
    expect(sample.reached, 'menu-match-setup: MATCH_SETUP was not reached').toBe(true);
    expect(sample.composition.state).toBe('MATCH_SETUP');
    recordAndAssert('menu-match-setup', sample);
  });

  test('KI-08-02 AC1: menu-pause — a live round frozen mid-play', async ({ page }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-pause' });
    expect(sample.reached, 'menu-pause: PAUSE was not reached').toBe(true);
    expect(sample.composition.state).toBe('PAUSE');
    expect(sample.composition.snakeLengths, 'the arena keeps drawing behind the pause panel').not.toBeNull();
    recordAndAssert('menu-pause', sample);
  });

  test('KI-08-02 AC1: menu-round-over — the between-round scoreboard', async ({ page }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-round-over' });
    expect(sample.reached, 'menu-round-over: ROUND_OVER was not reached').toBe(true);
    expect(sample.composition.state).toBe('ROUND_OVER');
    recordAndAssert('menu-round-over', sample);
  });

  test('KI-08-02 AC1: menu-match-over — a Bo1 decided by the same scripted crash', async ({ page }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-match-over', bestOf: 1 });
    expect(sample.reached, 'menu-match-over: MATCH_OVER was not reached').toBe(true);
    expect(sample.composition.state).toBe('MATCH_OVER');
    // KI-03-06 / #119 F5: `getSnapshot()` is `null` in MATCH_OVER, so there is no live composition to check
    // here beyond the state name itself — documented in `drawCalls.js`'s `SceneComposition` doc comment.
    expect(sample.composition.snakeLengths).toBeNull();
    recordAndAssert('menu-match-over', sample);
  });

  test('KI-08-02 AC1: menu-replay — the REPLAY screen\'s load view, nothing loaded', async ({ page }) => {
    const sample = await measureOnce(page, { ...BASE_ARGS, scene: 'menu-replay' });
    expect(sample.reached, 'menu-replay: REPLAY was not reached').toBe(true);
    expect(sample.composition.state).toBe('REPLAY');
    recordAndAssert('menu-replay', sample);
  });

  test.afterAll(() => {
    // AC3 / tech-lead ruling 6: a record, not a second gate — nothing here is asserted on, it only makes
    // drift against `BASELINE_DRAW_CALLS` visible in a green log.
    console.log('\nKI-08-02: measured vs. baseline vs. budget\n' + buildDrawCallsReportTable(rows));
  });
});
