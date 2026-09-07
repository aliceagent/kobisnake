// @ts-check
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { failureReasons, playMatch } from './driver.js';
import { greedy } from './policies/greedy.js';
import { survivor } from './policies/survivor.js';
import { idle } from './policies/idle.js';
import { aggregateRun, renderReport } from './report.js';

/**
 * KI-03-04 — plays the seeded matches `tests/agent/report.js` aggregates, and writes the committed
 * `docs/qa/playtests/agent-run.md`.
 *
 * **Not part of `npm run test:agent`'s ten-match gate**, on purpose. This file lives in `tests/agent/` (the
 * ticket's own suggested location) and is therefore discovered by `npx playwright test tests/agent`, exactly
 * like `playtest.spec.js`, `policies.spec.js` and `invariants.spec.js` — but regenerating a committed report
 * document on every push to the fast gate would be exactly the "wall-clock line changes every run" problem
 * ruling 2 warns about, applied to the whole repository's CI cadence rather than just this one document. So
 * the real work below is gated behind `KI_AGENT_REPORT=1`: unset, this test is discovered and instantly
 * skipped (near-zero cost to `npm run test:agent`); set, it plays every pairing for real and overwrites the
 * document. `npm run test:agent:report` sets it. This mirrors the codebase's own precedent for an opt-in
 * full run behind an env var (`tests/sim/tuningMatrix.test.js`'s `KS_TUNING_MATRIX_FULL`,
 * `docs/qa/playtests/gate1-bot-matrix.md`'s own "What actually ran").
 *
 * **Pairings and seeds are chosen to be comparable with existing figures** (tech-lead ruling on #122, ruling
 * 3): `GREEDY_VS_GREEDY_SEEDS`/`SURVIVOR_VS_SURVIVOR_SEEDS` below are the exact 20 seeds
 * `tests/agent/policies.spec.js`'s own `SEEDS` uses for its mirrored measurements, and
 * `GREEDY_VS_SURVIVOR_SEEDS` is the exact 10 seeds `tests/agent/playtest.spec.js`'s own `SEEDS` uses for the
 * ten-match gate — the same pairing F3 measured. They are copied here as literals rather than imported,
 * because importing a `.spec.js` file would re-register that file's own `test.describe` blocks against this
 * file's test run.
 */

const FULL_RUN = /** @type {any} */ (globalThis).process?.env?.KI_AGENT_REPORT === '1';

/** Mirrors `policies.spec.js`'s own `SEEDS` (KI-03-02's 20-seed mirrored sample). */
const MIRRORED_SEEDS = [
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
];

/** Mirrors `playtest.spec.js`'s own `SEEDS` (KI-03-01's ten-match gate; F3's own pairing). */
const GREEDY_VS_SURVIVOR_SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** Mirrors `policies.spec.js`'s own idle characterisation scenario (#119 F1), extended to three seeds. */
const IDLE_SEEDS = [1, 2, 3];
/** 100 simulated seconds — several full round/countdown/scoreboard cycles, same order as that scenario's own. */
const IDLE_MAX_FRAMES = 6000;

/**
 * One render every 20 simulated seconds. This run reads only `RoundRecord`/`MatchResult` fields, never
 * `maxDrawCalls`, so it renders far more sparsely than the driver's own default — the same trade
 * `policies.spec.js`'s `STATS_RENDER_EVERY_N_FRAMES` makes, and the same value.
 */
const REPORT_RENDER_EVERY_N_FRAMES = 1200;

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'qa',
  'playtests',
  'agent-run.md',
);

/** The exact command this document tells its reader to run — also what regenerates it (AC1). */
const REGENERATING_COMMAND = 'KI_AGENT_REPORT=1 npm run test:agent:report';

/**
 * @param {import('@playwright/test').Page} page
 * @param {number[]} seeds
 * @param {(view: import('./driver.js').PolicyView) => import('./driver.js').PolicyMove} policy1
 * @param {(view: import('./driver.js').PolicyView) => import('./driver.js').PolicyMove} policy2
 * @param {number} [maxFrames]
 * @returns {Promise<import('./driver.js').MatchResult[]>}
 */
async function playSet(page, seeds, policy1, policy2, maxFrames) {
  const results = [];
  for (const seed of seeds) {
    results.push(
      await playMatch(page, {
        seed,
        bestOf: 3,
        policy1,
        policy2,
        renderEveryNFrames: REPORT_RENDER_EVERY_N_FRAMES,
        ...(maxFrames === undefined ? {} : { maxFrames }),
      }),
    );
  }
  return results;
}

test.describe('KI-03-04 · statistics report generation', () => {
  test('regenerates docs/qa/playtests/agent-run.md from seeded matches', async ({ page }) => {
    test.skip(
      !FULL_RUN,
      'set KI_AGENT_REPORT=1 (via `npm run test:agent:report`) to regenerate the committed report — ' +
        'this is deliberately not part of the fast npm run test:agent gate (see this file\'s module doc)',
    );
    test.setTimeout(15 * 60_000);

    const startedAt = Date.now();

    const greedyVsGreedy = await playSet(page, MIRRORED_SEEDS, greedy, greedy);
    const survivorVsSurvivor = await playSet(page, MIRRORED_SEEDS, survivor, survivor);
    const greedyVsSurvivor = await playSet(page, GREEDY_VS_SURVIVOR_SEEDS, greedy, survivor);
    const idleVsIdle = await playSet(page, IDLE_SEEDS, idle, idle, IDLE_MAX_FRAMES);

    const wallSeconds = Math.round((Date.now() - startedAt) / 1000);

    // Health checks on the three pairings that are expected to finish — the same discipline every other
    // spec in this directory applies (KI-03-01 AC3's own `failureReasons`). Idle vs idle is checked
    // separately, on its own terms: it is *supposed* to not finish (ruling 4).
    const terminating = [...greedyVsGreedy, ...survivorVsSurvivor, ...greedyVsSurvivor];
    expect(failureReasons(terminating).join('\n')).toBe('');
    expect(terminating.every((result) => result.finished)).toBe(true);

    expect(idleVsIdle.every((result) => result.pageErrors.length === 0)).toBe(true);
    expect(idleVsIdle.every((result) => !result.finished)).toBe(true);
    expect(idleVsIdle.every((result) => result.rounds.length > 0)).toBe(true);
    expect(idleVsIdle.every((result) => result.rounds.every((round) => round.result === 'DRAW'))).toBe(
      true,
    );

    const aggregated = aggregateRun({
      meta: {
        date: new Date().toISOString().slice(0, 10),
        command: REGENERATING_COMMAND,
        wallSeconds,
      },
      pairings: [
        {
          label: 'greedy vs greedy',
          seeds: MIRRORED_SEEDS,
          results: greedyVsGreedy,
          expectFinish: true,
        },
        {
          label: 'survivor vs survivor',
          seeds: MIRRORED_SEEDS,
          results: survivorVsSurvivor,
          expectFinish: true,
        },
        {
          label: 'greedy vs survivor',
          seeds: GREEDY_VS_SURVIVOR_SEEDS,
          results: greedyVsSurvivor,
          expectFinish: true,
        },
        {
          label: 'idle vs idle',
          seeds: IDLE_SEEDS,
          results: idleVsIdle,
          expectFinish: false,
          maxFrames: IDLE_MAX_FRAMES,
        },
      ],
    });

    const markdown = renderReport(aggregated);
    writeFileSync(REPORT_PATH, markdown);

    const totalRounds = aggregated.pairings.reduce((total, stats) => total + stats.rounds, 0);
    console.log(
      `KI-03-04: wrote ${REPORT_PATH} — ${terminating.length + idleVsIdle.length} matches, ` +
        `${totalRounds} rounds, ${wallSeconds}s wall time.`,
    );
  });
});
