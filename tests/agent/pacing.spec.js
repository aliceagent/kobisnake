// @ts-check
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { failureReasons, playMatch } from './driver.js';
import { greedy } from './policies/greedy.js';
import { survivor } from './policies/survivor.js';
import {
  aggregateSweep,
  combinationsFor,
  droppedCellLines,
  pacingSeeds,
  renderPacingReport,
  PAIRINGS,
} from './pacing.js';

/**
 * KI-04-01 — plays the swept matches `tests/agent/pacing.js` aggregates, and writes the committed
 * `docs/qa/playtests/round-pacing.md`.
 *
 * **Not part of `npm run test:agent`'s ten-match gate**, for the reason `report.spec.js` gives for the same
 * choice: this file is discovered by `npx playwright test tests/agent` like every other spec here, but a
 * multi-thousand-round sweep on every push would be absurd, so the real work is gated behind `KI_PACING=1`.
 * Unset, the test is discovered and instantly skipped. `npm run test:agent:pacing` sets it.
 *
 * ## The three knobs, and why they are knobs
 *
 * | Env var | Default | What it does |
 * |---|---|---|
 * | `KI_PACING` | unset | `1` runs the sweep. Anything else skips. |
 * | `KI_PACING_SEEDS` | {@link DEFAULT_SEEDS_PER_CELL} | Seeds (= matches) per cell. |
 * | `KI_PACING_SHAPE` | `grid` | `grid` (the full 3×3) or `cross` (one lever at a time). |
 *
 * The last two exist because the sprint's budget rule needs them to: "if a cell will not finish inside a
 * sensible budget, reduce the cell count and say which cells were dropped and why rather than quietly
 * shrinking rounds per cell". `KI_PACING_SHAPE` is the sanctioned reduction and it is recorded in the
 * document; `KI_PACING_SEEDS` exists so the harness can be *probed* for cost before a long run is committed
 * to, which is why a run below {@link DEFAULT_SEEDS_PER_CELL} **refuses to write the document** — an
 * under-sampled document is exactly what the rule forbids, and making that a hard failure is cheaper than
 * trusting nobody will do it by accident.
 *
 * ## Why the run is resumable
 *
 * The full sweep is hours of Chromium in a container shared with other sprint sessions. Losing all of it to
 * one interrupted process would be bad enough; doing so *repeatedly* would make the ticket impossible. So
 * every finished cell is cached to disk as its raw `MatchResult[]` and reused on a later invocation instead
 * of being replayed.
 *
 * This is safe precisely because of what the layer already guarantees: a match is a pure function of its seed
 * and its settings (`ARCHITECTURE §11`), so a cached cell is *identical* to a replayed one, not merely
 * similar. The cache key carries every input that could change a number — pairing, both swept values, and the
 * seed list — so a changed sweep can never silently read a stale cell. Delete {@link cacheDir} to force a
 * cold run.
 */

const RUN = /** @type {any} */ (globalThis).process?.env?.KI_PACING === '1';

/**
 * Stand-in metadata for the mid-run reconciliation check below. `aggregateSweep` needs a `meta` to build an
 * `AggregatedSweep`, but that check only ever reads `.reconciliation`, and nothing it produces is written
 * anywhere — the real metadata is assembled once, at the end, from what actually ran.
 *
 * @type {import('./pacing.js').SweepMeta}
 */
const PLACEHOLDER_META = {
  date: '',
  command: '',
  wallSeconds: 0,
  seedsPerCell: 0,
  renderEveryNFrames: 0,
  droppedCells: [],
};
const ENV = /** @type {any} */ (globalThis).process?.env ?? {};

/**
 * Seeds — and therefore matches — per cell.
 *
 * 150 rather than "however many it takes to reach 300 rounds", because a Best-of-3 is first-to-two: every
 * match plays **at least** two rounds, so 150 seeds guarantee ≥ 300 rounds in every cell however the sweep
 * changes the shape of a round. The ticket's floor is then met by construction rather than checked after the
 * fact, and a cell that turns out to be unusually short cannot quietly under-sample.
 */
const DEFAULT_SEEDS_PER_CELL = 150;

const SEEDS_PER_CELL = Number(ENV.KI_PACING_SEEDS ?? DEFAULT_SEEDS_PER_CELL);
const SHAPE = /** @type {'grid' | 'cross'} */ (ENV.KI_PACING_SHAPE ?? 'grid');

/**
 * One render every 20 simulated seconds — `report.spec.js`'s own cadence, and for its own reason: this run
 * reads only `RoundRecord`/`MatchResult` fields and never `maxDrawCalls`, so it trades a render sample it
 * does not use for wall time it very much does. `driver.js`'s header is explicit that this cannot affect
 * simulation state.
 */
const PACING_RENDER_EVERY_N_FRAMES = 1200;

/** @type {Record<string, (view: import('./driver.js').PolicyView) => import('./driver.js').PolicyMove>} */
const POLICY_BY_NAME = { greedy, survivor };

/** Splits `"greedy vs survivor"` into its two policies. */
const policiesFor = (/** @type {string} */ pairing) => {
  const [first, second] = pairing.split(' vs ');
  return [POLICY_BY_NAME[first], POLICY_BY_NAME[second]];
};

const here = dirname(fileURLToPath(import.meta.url));

const REPORT_PATH = join(here, '..', '..', 'docs', 'qa', 'playtests', 'round-pacing.md');

/**
 * Where finished cells are cached. Under the OS temp directory rather than the repository, so a resumed run
 * never leaves anything for `git status` to show and `npm run format` has nothing extra to reformat.
 */
const cacheDir = join(tmpdir(), 'kobisnake-ki-04-01-pacing');

/**
 * The exact command that regenerates this document — built from what actually ran, never hard-coded, so a
 * document produced by a reduced sweep tells its reader how to reproduce *that* sweep rather than a different
 * one (AC1).
 */
const regeneratingCommand = () => {
  const parts = ['KI_PACING=1'];
  if (SEEDS_PER_CELL !== DEFAULT_SEEDS_PER_CELL) parts.push(`KI_PACING_SEEDS=${SEEDS_PER_CELL}`);
  if (SHAPE !== 'grid') parts.push(`KI_PACING_SHAPE=${SHAPE}`);
  parts.push('npm run test:agent:pacing');
  return parts.join(' ');
};

/**
 * @param {string} pairing
 * @param {number} laserStartTime
 * @param {number} roundDuration
 */
const cachePathFor = (pairing, laserStartTime, roundDuration) =>
  join(
    cacheDir,
    `${pairing.replace(/ /g, '-')}__laser-${laserStartTime}__round-${roundDuration}__seeds-${SEEDS_PER_CELL}.json`,
  );

/**
 * Plays one cell — every seed, at one pairing and one `(laserStartTime, roundDuration)` — or reads it back
 * from the cache.
 *
 * The override tree is the ticket's whole method: `{laserStartTime, roundDuration}` reaches `withOverrides()`
 * inside `session.js` through `driver.playMatch`'s `settingsOverrides` option. **`src/core/settings.js` is
 * never edited.** The baseline cell passes the shipping values explicitly rather than passing `null`, so that
 * cell exercises the same override path every other cell does — if the plumbing were wrong, the
 * reconciliation against `agent-run.md` would catch it, which it could not do if the baseline quietly took a
 * different route.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} pairing
 * @param {number} laserStartTime
 * @param {number} roundDuration
 * @param {number[]} seeds
 * @returns {Promise<{results: import('./driver.js').MatchResult[], playedMs: number, cached: boolean}>}
 */
async function playCell(page, pairing, laserStartTime, roundDuration, seeds) {
  const cachePath = cachePathFor(pairing, laserStartTime, roundDuration);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    if (cached.seeds.join(',') === seeds.join(',')) {
      return { results: cached.results, playedMs: cached.playedMs, cached: true };
    }
  }

  const [policy1, policy2] = policiesFor(pairing);
  const startedAt = Date.now();
  /** @type {import('./driver.js').MatchResult[]} */
  const results = [];
  for (const seed of seeds) {
    results.push(
      await playMatch(page, {
        seed,
        bestOf: 3,
        policy1,
        policy2,
        settingsOverrides: { laserStartTime, roundDuration },
        renderEveryNFrames: PACING_RENDER_EVERY_N_FRAMES,
      }),
    );
  }
  const playedMs = Date.now() - startedAt;

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ seeds, results, playedMs }));
  return { results, playedMs, cached: false };
}

test.describe('KI-04-01 · round pacing sweep', () => {
  test('sweeps laserStartTime × roundDuration and writes docs/qa/playtests/round-pacing.md', async ({
    page,
  }) => {
    test.skip(
      !RUN,
      'set KI_PACING=1 (via `npm run test:agent:pacing`) to run the sweep — this is deliberately not part ' +
        "of the fast npm run test:agent gate (see this file's module doc)",
    );
    // The whole sweep in one test, because the document it writes is one coherent run. Hours, not minutes:
    // the resumability above is what makes an interrupted run cheap rather than catastrophic.
    test.setTimeout(8 * 60 * 60_000);

    const combinations = combinationsFor(SHAPE);
    const seeds = pacingSeeds(SEEDS_PER_CELL);

    /** @type {import('./pacing.js').CellRun[]} */
    const cells = [];
    let playedMs = 0;

    /**
     * Plays one cell, health-checks it on the spot and records it.
     *
     * Checked here rather than at the end because a cell with an invariant problem or a page error is not a
     * slightly noisy cell — it is a cell whose numbers must not be read at all, and learning that after
     * another two hours of sweeping would be strictly worse than learning it now. Every message names the
     * cell, and `failureReasons` already names the seed inside it (KI-03-01 AC3).
     *
     * @param {import('./pacing.js').Combination} combination
     * @param {string} pairing
     */
    const runCell = async ({ laserStartTime, roundDuration }, pairing) => {
      const cell = await playCell(page, pairing, laserStartTime, roundDuration, seeds);
      playedMs += cell.playedMs;
      expect(
        failureReasons(cell.results).join('\n'),
        `${pairing} @ laser ${laserStartTime}s / round ${roundDuration}s`,
      ).toBe('');
      const rounds = cell.results.reduce((total, result) => total + result.rounds.length, 0);
      cells.push({ pairing, laserStartTime, roundDuration, seeds, results: cell.results });
      console.log(
        `KI-04-01: [${cells.length}] ${pairing} @ laser ${laserStartTime}s / round ${roundDuration}s — ` +
          `${cell.results.length} matches, ${rounds} rounds` +
          `${cell.cached ? ' (cached)' : `, ${Math.round(cell.playedMs / 1000)}s`}`,
      );
    };

    // The three baseline cells first, and the reconciliation asserted the moment they are done.
    //
    // The whole sweep rests on one claim: that a `withOverrides()` tree carrying the shipping values changes
    // nothing. If that is false — if the plumbing drops the tree, or applies it a round late — then every
    // cell in this run is measuring something other than what it says, and the cheapest possible moment to
    // discover it is after three cells rather than after twenty-seven.
    const [baseline, ...rest] = combinations;
    for (const pairing of PAIRINGS) await runCell(baseline, pairing);

    if (SEEDS_PER_CELL >= DEFAULT_SEEDS_PER_CELL) {
      const check = aggregateSweep({ meta: PLACEHOLDER_META, cells });
      expect(check.reconciliation).toHaveLength(PAIRINGS.length);
      for (const row of check.reconciliation) {
        expect(row.differences.join('; '), `baseline vs agent-run.md — ${row.pairing}`).toBe('');
      }
      console.log(
        'KI-04-01: baseline reconciles with agent-run.md on all three pairings; sweeping the rest.',
      );
    }

    for (const combination of rest) {
      for (const pairing of PAIRINGS) await runCell(combination, pairing);
    }

    // Grouped by pairing, then in `combinationsFor` order, so the document and its JSON block read in a fixed
    // order rather than in the order the run happened to play them.
    cells.sort(
      (a, b) =>
        PAIRINGS.indexOf(a.pairing) - PAIRINGS.indexOf(b.pairing) ||
        combinations.findIndex(
          (c) => c.laserStartTime === a.laserStartTime && c.roundDuration === a.roundDuration,
        ) -
          combinations.findIndex(
            (c) => c.laserStartTime === b.laserStartTime && c.roundDuration === b.roundDuration,
          ),
    );

    const aggregated = aggregateSweep({
      meta: {
        date: new Date().toISOString().slice(0, 10),
        command: regeneratingCommand(),
        wallSeconds: Math.round(playedMs / 1000),
        seedsPerCell: SEEDS_PER_CELL,
        renderEveryNFrames: PACING_RENDER_EVERY_N_FRAMES,
        droppedCells: droppedCellLines(
          SHAPE,
          'The full 3×3 grid did not fit the budget this container could give it — see the PR on ' +
            "issue #231 for the measured per-match cost the decision was made from. I04's own question " +
            'asks for the single lever that moves the climax most, so the sweep was reduced to the ' +
            'combinations that change one lever at a time.',
        ),
      },
      cells,
    });

    // A sweep smaller than the default is a probe for cost, not a document. Refuse to overwrite the committed
    // one with it — under-sampling is precisely what the sprint's budget rule forbids. The reconciliation
    // below is skipped with it, and has to be: a probe cannot contain `agent-run.md`'s own 20 seeds, so
    // `reconcileBaseline` correctly declines to compare and there is nothing to assert.
    if (SEEDS_PER_CELL < DEFAULT_SEEDS_PER_CELL) {
      console.log(
        `KI-04-01: probe run (${SEEDS_PER_CELL} seeds/cell < ${DEFAULT_SEEDS_PER_CELL}); ` +
          `${REPORT_PATH} deliberately NOT written, reconciliation not comparable. Played ` +
          `${Math.round(playedMs / 1000)}s across ${cells.length} cells.`,
      );
      return;
    }

    // The reconciliation is the run's own correctness check, so it is asserted rather than merely reported:
    // the baseline cell *is* the shipping configuration, expressed as an override, and a baseline that does
    // not reproduce `agent-run.md` on `agent-run.md`'s own seeds means the sweep's plumbing is wrong and
    // every other cell in the document is suspect. Failing here is the honest outcome; writing the document
    // with a "differs" row and letting a design lead read the rest of it is not.
    expect(aggregated.reconciliation).toHaveLength(PAIRINGS.length);
    for (const row of aggregated.reconciliation) {
      expect(row.differences.join('; '), `baseline vs agent-run.md — ${row.pairing}`).toBe('');
    }

    writeFileSync(REPORT_PATH, renderPacingReport(aggregated));

    const totalRounds = aggregated.cells.reduce((total, cell) => total + cell.rounds, 0);
    const smallest = Math.min(...aggregated.cells.map((cell) => cell.rounds));
    console.log(
      `KI-04-01: wrote ${REPORT_PATH} — ${aggregated.cells.length} cells, ${totalRounds} rounds, ` +
        `smallest cell ${smallest} rounds, ${Math.round(playedMs / 1000)}s of play.`,
    );
    expect(smallest).toBeGreaterThanOrEqual(300);
  });
});
