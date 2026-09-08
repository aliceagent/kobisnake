// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import {
  HUD_LENGTH_TOLERANCE,
  HUD_TIMER_TOLERANCE_SECONDS,
  checkInvariants,
} from './invariants.js';
import { generateActions, runMonkeySession } from './monkey.js';
import { buildShrinkFixture, shrinkFailure } from './shrink.js';
import { aggregateCampaign, failureKeysFor, renderSessionFuzzReport } from './sessionFuzz.js';

/**
 * KI-18-03 — the campaign runner (Improvement 18, `docs/sprints/improvement-18-session-fuzzing.md`, tracking
 * issue #303, ticket issue #313).
 *
 * **Why this is a new file rather than a bend of `monkey.spec.js`'s AC3 test.** AC3 means exactly one thing —
 * "200 seeds × 500 actions complete in under 10 minutes on CI" — and it always starts at seed 1. This ticket
 * needs to run two thousand seeds *in batches*, releasing the container-wide Playwright lock between them
 * (`tests/agent/README.md`: several agent sessions share one container, and one ~87-minute invocation would
 * make every other one wait out `scripts/run-playwright-suite.mjs`'s 20-minute timeout and fail). A "start at
 * seed N" knob bent into AC3's own test would let that criterion mean something else by accident; this file
 * exists so it never has to.
 *
 * ## How it batches, and how it knows when the campaign is done
 *
 * Every seed's full `MonkeyResult` is cached to disk (`cacheDir`, under the OS temp directory — never the
 * repository, the same choice `pacing.spec.js` makes and for the same reason) the moment it is played. Each
 * invocation plays `KI_SESSION_FUZZ_SEED_COUNT` seeds starting at `KI_SESSION_FUZZ_FIRST_SEED`, skipping any
 * seed already cached at the same action count — so an interrupted batch costs nothing to resume, exactly
 * `pacing.spec.js`'s own resumability argument. After playing its own range, every invocation checks whether
 * seeds `1..KI_SESSION_FUZZ_TOTAL_SEEDS` are now **all** cached; the first invocation for which that is true
 * — ordinarily the last of the batches — aggregates the whole campaign, shrinks every distinct failure it
 * finds, and writes the committed report. Every other invocation logs its progress and stops there: a
 * genuinely reproducible campaign is a pure function of which seeds have been played, not of which
 * invocation happens to run last.
 *
 * ## Filing issues is not this file's job
 *
 * Nothing here calls the GitHub API. What it produces for a distinct failure is the same two things
 * KI-18-02 defines — the replayable fixture (`buildShrinkFixture`, `failure` and `options` filled in) and the
 * sentence (`renderSentence`, folded into the fixture already) — written to {@link fixturesDir} as one JSON
 * file per failure, plus printed to the log. Filing the issue and recording its number back into the report
 * (`KI_SESSION_FUZZ_ISSUE_LINKS`, below) is a step outside this harness, the same way `report.spec.js` writes
 * numbers for a design lead to read rather than acting on them itself.
 *
 * ## Re-running the report once issues are filed
 *
 * A distinct failure's shrink is itself cached (`shrinkCacheDir`), keyed by its failure key, so that filing
 * issues from the first campaign's fixtures and then re-running this file to fold the issue links into the
 * committed report costs no further browser time: pass `KI_SESSION_FUZZ_ISSUE_LINKS` pointing at a small JSON
 * file of `{"<failure key>": "#123"}` entries, and every seed and every shrink is read straight back from
 * cache.
 */

const RUN = /** @type {any} */ (globalThis).process?.env?.KI_SESSION_FUZZ === '1';
const ENV = /** @type {any} */ (globalThis).process?.env ?? {};

/** The campaign's own shape — matches AC3's default action count, and is the shape the task's own wall-clock estimate (~2.6s/seed) was measured against. */
const DEFAULT_ACTIONS_PER_SEED = 500;
/** The ticket's own number: "Run 2 000 seeds." */
const DEFAULT_TOTAL_SEEDS = 2000;
/** One batch's default size — ≈ 11 minutes at the measured ≈2.6s/seed, comfortably inside the container's 20-minute suite-lock wait. */
const DEFAULT_SEED_COUNT = 250;

const ACTIONS_PER_SEED = Number(ENV.KI_SESSION_FUZZ_ACTIONS ?? DEFAULT_ACTIONS_PER_SEED);
const TOTAL_SEEDS = Number(ENV.KI_SESSION_FUZZ_TOTAL_SEEDS ?? DEFAULT_TOTAL_SEEDS);
const FIRST_SEED = Number(ENV.KI_SESSION_FUZZ_FIRST_SEED ?? 1);
const SEED_COUNT = Number(ENV.KI_SESSION_FUZZ_SEED_COUNT ?? DEFAULT_SEED_COUNT);
/** Optional path to a `{"<failure key>": "#123"}` JSON file, folded into the rendered report when present. */
const ISSUE_LINKS_PATH = ENV.KI_SESSION_FUZZ_ISSUE_LINKS ?? null;

/** The Node-side values `checkInvariants`'s serialised body may not import for itself — `monkey.spec.js`'s own assembly. */
const INVARIANT_CONFIG = {
  grid: { width: SETTINGS.grid.width, height: SETTINGS.grid.height },
  hudTimerToleranceSeconds: HUD_TIMER_TOLERANCE_SECONDS,
  hudLengthTolerance: HUD_LENGTH_TOLERANCE,
};

const here = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = join(here, '..', '..', 'docs', 'qa', 'reports', '2026-09-08-session-fuzz.md');

/** Where every seed's played `MonkeyResult` is cached, and where a batch log and shrunk fixtures live beside it. */
const cacheDir = join(tmpdir(), 'kobisnake-ki-18-03-session-fuzz', `actions-${ACTIONS_PER_SEED}`);
const shrinkCacheDir = join(cacheDir, 'shrink');
const fixturesDir = join(cacheDir, 'fixtures');
const batchLogPath = join(cacheDir, 'batch-log.jsonl');

/** @param {number} seed @returns {string} */
const seedCachePath = (seed) => join(cacheDir, `seed-${seed}.json`);

/** @param {string} key @returns {string} */
const safeFileName = (key) => key.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);

/** @param {number} seed @returns {import('./monkey.js').MonkeyResult | null} */
function readSeedCache(seed) {
  const path = seedCachePath(seed);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} seed
 * @returns {Promise<{result: import('./monkey.js').MonkeyResult, cached: boolean}>}
 */
async function playOrReadSeed(page, seed) {
  const cached = readSeedCache(seed);
  if (cached !== null) return { result: cached, cached: true };
  const result = await runMonkeySession(page, {
    seed,
    actionCount: ACTIONS_PER_SEED,
    invariants: checkInvariants,
    invariantConfig: INVARIANT_CONFIG,
  });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(seedCachePath(seed), JSON.stringify(result));
  return { result, cached: false };
}

/** How many of `1..TOTAL_SEEDS` are cached right now. */
function seedsCachedSoFar() {
  let count = 0;
  for (let seed = 1; seed <= TOTAL_SEEDS; seed += 1) {
    if (existsSync(seedCachePath(seed))) count += 1;
    else break;
  }
  return count;
}

/** Every `1..TOTAL_SEEDS` result, read back from cache — only called once every one of them exists. */
function readAllCachedSeeds() {
  /** @type {import('./monkey.js').MonkeyResult[]} */
  const results = [];
  for (let seed = 1; seed <= TOTAL_SEEDS; seed += 1) {
    const result = readSeedCache(seed);
    if (result === null) throw new Error(`sessionFuzz: seed ${seed} is missing from the cache`);
    results.push(result);
  }
  return results;
}

/** Every batch invocation's own range, so the compiled report can name exactly how it was produced (AC1). */
function recordBatch() {
  mkdirSync(cacheDir, { recursive: true });
  const line = JSON.stringify({
    firstSeed: FIRST_SEED,
    count: SEED_COUNT,
    at: new Date().toISOString(),
  });
  const existing = existsSync(batchLogPath) ? readFileSync(batchLogPath, 'utf8') : '';
  writeFileSync(batchLogPath, `${existing}${line}\n`);
}

/** @returns {{firstSeed: number, count: number}[]} */
function readBatchLog() {
  if (!existsSync(batchLogPath)) return [];
  return readFileSync(batchLogPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

/**
 * The distinct seed ranges that were played, in the order each was first run — deduplicated by
 * `(firstSeed, count)`. A range retried after a transient failure (a container-load hiccup, say) logs one
 * entry per attempt in {@link readBatchLog}'s raw log, and both the regenerating command (AC1) and the
 * reported batch count should say "this range was played", once, not "this range was attempted N times" —
 * a reader reproducing this document only needs to run each range once to get the same cache.
 *
 * @returns {{firstSeed: number, count: number}[]}
 */
function distinctBatches() {
  const seen = new Set();
  /** @type {{firstSeed: number, count: number}[]} */
  const distinct = [];
  for (const batch of readBatchLog()) {
    const key = `${batch.firstSeed}:${batch.count}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(batch);
  }
  return distinct;
}

/** The regenerating command (AC1), built from {@link distinctBatches}. */
function regeneratingCommand() {
  const batches = distinctBatches();
  if (batches.length === 0) {
    return `KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_TOTAL_SEEDS=${TOTAL_SEEDS} npm run test:agent:sessionfuzz`;
  }
  return batches
    .map(
      (batch) =>
        `KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=${batch.firstSeed} ` +
        `KI_SESSION_FUZZ_SEED_COUNT=${batch.count} npm run test:agent:sessionfuzz`,
    )
    .join(' && ');
}

/** @returns {Record<string, string>} `DistinctFailure.key` -> `"#123"`, when {@link ISSUE_LINKS_PATH} names a file. */
function readIssueLinks() {
  if (ISSUE_LINKS_PATH === null || !existsSync(ISSUE_LINKS_PATH)) return {};
  return JSON.parse(readFileSync(ISSUE_LINKS_PATH, 'utf8'));
}

test.describe('KI-18-03 · the first campaign', () => {
  test('plays its batch of seeds, then compiles the report once every seed is cached', async ({
    page,
  }) => {
    test.skip(
      !RUN,
      'set KI_SESSION_FUZZ=1 (via npm run test:agent:sessionfuzz) to play a batch — this is deliberately ' +
        "not part of the fast npm run test:agent gate (see this file's module doc)",
    );
    // A batch of 250 seeds is ≈11 minutes; this budget covers a slow batch with room, never the whole
    // campaign in one invocation (that is exactly the thing batching exists to avoid).
    test.setTimeout(30 * 60_000);

    const lastSeed = Math.min(FIRST_SEED + SEED_COUNT - 1, TOTAL_SEEDS);
    let playedThisBatch = 0;
    let cachedThisBatch = 0;
    const startedAt = Date.now();

    for (let seed = FIRST_SEED; seed <= lastSeed; seed += 1) {
      const { cached } = await playOrReadSeed(page, seed);
      if (cached) cachedThisBatch += 1;
      else playedThisBatch += 1;
    }
    recordBatch();

    const batchMs = Date.now() - startedAt;
    console.log(
      `KI-18-03: batch seeds ${FIRST_SEED}..${lastSeed} — ${playedThisBatch} played, ` +
        `${cachedThisBatch} already cached, ${Math.round(batchMs / 1000)}s.`,
    );

    const cachedSoFar = seedsCachedSoFar();
    if (cachedSoFar < TOTAL_SEEDS) {
      console.log(
        `KI-18-03: ${cachedSoFar} of ${TOTAL_SEEDS} seeds cached so far — campaign not yet complete, ` +
          'nothing to compile this invocation.',
      );
      return;
    }

    console.log(`KI-18-03: all ${TOTAL_SEEDS} seeds cached — compiling the campaign report.`);
    const results = readAllCachedSeeds();
    const wallSeconds = Math.round(results.reduce((total, r) => total + r.wallMs, 0) / 1000);

    const aggregated = aggregateCampaign({
      meta: {
        date: new Date().toISOString().slice(0, 10),
        command: regeneratingCommand(),
        wallSeconds,
        actionsPerSeed: ACTIONS_PER_SEED,
        batchCount: distinctBatches().length,
      },
      results,
    });

    console.log(
      `KI-18-03: ${aggregated.seedsRun} seeds, ${aggregated.actionsApplied} actions applied, ` +
        `${aggregated.simSeconds.toFixed(0)} simulated seconds, ${wallSeconds}s wall clock. ` +
        `States reached: ${aggregated.stateCoverage.reached.length}/${aggregated.stateCoverage.reached.length + aggregated.stateCoverage.notReached.length}. ` +
        `LASER_WARNING reached on ${aggregated.laserWarning.seedsThatReachedIt}/${aggregated.laserWarning.totalSeeds} seeds. ` +
        `${aggregated.failures.length} distinct failure(s).`,
    );

    // Shrink every distinct failure, caching each result so a re-run to fold in issue links costs no
    // further browser time.
    mkdirSync(shrinkCacheDir, { recursive: true });
    mkdirSync(fixturesDir, { recursive: true });
    for (const failure of aggregated.failures) {
      const shrinkCachePath = join(shrinkCacheDir, `${safeFileName(failure.key)}.json`);
      /** @type {import('./shrink.js').ShrinkFixture} */
      let fixture;
      if (existsSync(shrinkCachePath)) {
        fixture = JSON.parse(readFileSync(shrinkCachePath, 'utf8'));
        console.log(
          `KI-18-03: [${failure.key}] shrink read from cache — ${fixture.shrunkActionCount} action(s).`,
        );
      } else {
        const seed = failure.firstSeen.seed;
        const originalActions = generateActions(seed, failure.firstSeen.actionsApplied);
        const predicate = async (/** @type {import('./monkey.js').MonkeyAction[]} */ candidate) => {
          if (candidate.length === 0) return false;
          try {
            const candidateResult = await runMonkeySession(page, {
              seed,
              actions: candidate,
              invariants: checkInvariants,
              invariantConfig: INVARIANT_CONFIG,
            });
            return failureKeysFor(candidateResult).has(failure.key);
          } catch (error) {
            // A `resize` action's target viewport is baked in at generation time relative to whichever
            // resize came before it in the *original* sequence (`monkey.js`'s own `generateActions` doc
            // comment) — so once shrinking drops an earlier resize, a later one's stored target can
            // coincide with the viewport actually in force when this shorter candidate is replayed. A
            // `setViewportSize` to the size already in force fires no `resize` event at all (the #291
            // shape, applied to a candidate rather than a seed), and `runMonkeySession` throws rather than
            // returning a `MonkeyResult` for a resize that never lands. This candidate cannot be evaluated,
            // not "cannot reproduce the failure" — but the only two answers `shrinkFailure` understands are
            // "still fails" and "does not", and this is honestly neither. Reporting it as "does not still
            // fail" is the safe reading: it keeps the dropped chunk in place (the search tries a different
            // reduction next) rather than risking a false "still fails" on a candidate nothing actually
            // observed. `runMonkeySession` always reloads the page fresh via `page.goto` on its own next
            // call, so a candidate that throws here cannot corrupt the one evaluated after it.
            console.log(
              `KI-18-03: [${failure.key}] a shrink candidate could not be replayed — ${error}`,
            );
            return false;
          }
        };
        const shrunk = await shrinkFailure(originalActions, predicate);
        fixture = buildShrinkFixture({
          seed,
          originalActionCount: originalActions.length,
          actions: shrunk.actions,
          evaluations: shrunk.evaluations,
          failure: { rule: failure.rule, detail: failure.detail },
        });
        writeFileSync(shrinkCachePath, JSON.stringify(fixture, null, 2));
        console.log(
          `KI-18-03: [${failure.key}] shrunk seed ${seed} from ${originalActions.length} to ` +
            `${fixture.shrunkActionCount} action(s) over ${shrunk.evaluations} evaluation(s).`,
        );
      }
      writeFileSync(
        join(fixturesDir, `${safeFileName(failure.key)}.json`),
        JSON.stringify(fixture, null, 2),
      );
      console.log(`KI-18-03: [${failure.key}] sentence — ${fixture.sentence}`);
    }

    const issueLinks = readIssueLinks();
    const markdown = renderSessionFuzzReport(aggregated, issueLinks);
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, markdown);
    console.log(
      `KI-18-03: wrote ${REPORT_PATH} — ${aggregated.failures.length} failure(s), ` +
        `${Object.keys(issueLinks).length} issue link(s) folded in. Fixtures at ${fixturesDir}.`,
    );

    expect(existsSync(REPORT_PATH)).toBe(true);
  });
});
