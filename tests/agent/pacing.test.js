// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../src/core/settings.js';
import {
  aggregateCell,
  aggregateSweep,
  combinationsFor,
  droppedCellLines,
  pacingSeeds,
  reconcileBaseline,
  renderPacingReport,
  AGENT_RUN_REFERENCE,
  AGENT_RUN_SEEDS,
  CLIMAX_INSET,
  EARLIER_LASER_START_TIMES,
  LASER_START_TIMES,
  MAX_LASER_INSET,
  PACING_SEED_BASE,
  PAIRINGS,
  ROUND_DURATIONS,
} from './pacing.js';

/**
 * KI-04-01 — two jobs, and they are different jobs.
 *
 * 1. **`pacing.js`'s pure functions, against hand-built fixtures.** The same discipline `report.test.js`
 *    applies to `report.js` under the tech-lead ruling on #122: a median over a known list, a rate over a
 *    known mix, a reconciliation against a fixture built to disagree. Nothing here touches a browser.
 * 2. **The committed document's machine-readable block, diffed.** The ticket asks for "a machine-readable
 *    block a test diffs against", and this is that test.
 *
 * **What job 2 can and cannot do, stated plainly, because the difference matters.**
 * `tests/sim/tuningMatrix.test.js` recomputes `gate1-bot-matrix.md`'s cells from scratch on every push and
 * asserts the fresh numbers against the committed ones — it can, because that matrix is headless and costs
 * milliseconds. This document's numbers come from thousands of matches in a real Chromium and cannot be
 * recomputed inside Vitest at any acceptable cost. So this file checks everything about the block that does
 * not require re-deriving it: that it parses, that every cell carries the fields AC2 names, that no cell is
 * under-sampled below the ticket's 300-round floor unless it is declared dropped, that the rendered tables
 * agree with the block they were rendered from, that every rate is internally consistent, and that the
 * baseline reconciles with `agent-run.md`. A hand-edited document that drifts from what the harness produced
 * fails here. A document whose numbers are wrong *because the harness is wrong* does not, and cannot — that
 * is what the reconciliation inside the run itself is for.
 */

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'qa',
  'playtests',
  'round-pacing.md',
);

/**
 * A minimal `RoundRecord` carrying the fields `pacing.js` reads.
 *
 * @param {Partial<import('./driver.js').RoundRecord>} overrides
 * @returns {import('./driver.js').RoundRecord}
 */
function round(overrides = {}) {
  return /** @type {any} */ ({
    result: 'P1_WIN',
    endReason: 'DEATH',
    seconds: 10,
    reachedLaserPhase: false,
    maxLaserInset: 0,
    ...overrides,
  });
}

/**
 * A minimal `MatchResult`. `frames` matters here in a way it does not in `report.test.js`: it is the whole
 * basis of the match wall-clock figures.
 *
 * @param {import('./driver.js').RoundRecord[]} rounds
 * @param {Partial<import('./driver.js').MatchResult>} overrides
 * @returns {import('./driver.js').MatchResult}
 */
function match(rounds, overrides = {}) {
  return /** @type {any} */ ({
    seed: 1,
    bestOf: 3,
    finished: true,
    rounds,
    match: null,
    statesVisited: [],
    frames: 600,
    renders: 1,
    maxDrawCalls: 0,
    problemCount: 0,
    problems: [],
    pageErrors: [],
    wallMs: 100,
    ...overrides,
  });
}

/**
 * @param {Partial<import('./pacing.js').CellRun>} overrides
 * @returns {import('./pacing.js').CellRun}
 */
function cellRun(overrides = {}) {
  return {
    pairing: 'greedy vs greedy',
    laserStartTime: SETTINGS.laserStartTime,
    roundDuration: SETTINGS.roundDuration,
    seeds: [1],
    results: [match([round()])],
    ...overrides,
  };
}

describe('KI-04-01 · the sweep shape', () => {
  it("KI-04-01: the grid is the ticket's full cross-product plus the earlier-start extension", () => {
    const grid = combinationsFor('grid');
    const ticketCells = grid.filter((c) => !EARLIER_LASER_START_TIMES.includes(c.laserStartTime));
    expect(ticketCells).toHaveLength(LASER_START_TIMES.length * ROUND_DURATIONS.length);
    for (const laserStartTime of LASER_START_TIMES) {
      for (const roundDuration of ROUND_DURATIONS) {
        expect(ticketCells).toContainEqual({ laserStartTime, roundDuration });
      }
    }
    expect(grid).toHaveLength(ticketCells.length + EARLIER_LASER_START_TIMES.length);
  });

  it('KI-04-01: the extension is earlier starts only, at the shipping round duration', () => {
    // "Earlier" is the whole point: laserStartTime counts seconds *remaining*, so every extension value must
    // be larger than the shipping one, or it is not testing the direction the ticket's own three miss.
    const extension = combinationsFor('grid').filter((c) =>
      EARLIER_LASER_START_TIMES.includes(c.laserStartTime),
    );
    expect(extension).toHaveLength(EARLIER_LASER_START_TIMES.length);
    for (const combination of extension) {
      expect(combination.laserStartTime).toBeGreaterThan(SETTINGS.laserStartTime);
      expect(combination.roundDuration).toBe(SETTINGS.roundDuration);
    }
  });

  it('KI-04-01: the cross keeps one lever at its shipping value in every combination', () => {
    const cross = combinationsFor('cross');
    expect(cross).toHaveLength(
      LASER_START_TIMES.length + ROUND_DURATIONS.length - 1 + EARLIER_LASER_START_TIMES.length,
    );
    // That is what makes it a one-at-a-time sweep, and what makes it able to answer "which *single* lever".
    for (const combination of cross) {
      expect(
        combination.laserStartTime === SETTINGS.laserStartTime ||
          combination.roundDuration === SETTINGS.roundDuration,
      ).toBe(true);
    }
  });

  it('KI-04-01: both shapes start at the shipping baseline, so the reconciliation cell is played first', () => {
    for (const shape of /** @type {const} */ (['grid', 'cross'])) {
      expect(combinationsFor(shape)[0]).toEqual({
        laserStartTime: SETTINGS.laserStartTime,
        roundDuration: SETTINGS.roundDuration,
      });
    }
  });

  it('KI-04-01: the grid drops nothing; the cross names every combination it drops', () => {
    expect(droppedCellLines('grid', 'unused')).toEqual([]);

    const lines = droppedCellLines('cross', 'BUDGET REASON.');
    expect(lines[0]).toBe('BUDGET REASON.');
    const dropped = combinationsFor('grid')
      .filter((c) => !EARLIER_LASER_START_TIMES.includes(c.laserStartTime))
      .filter(
        (c) =>
          !combinationsFor('cross').some(
            (k) => k.laserStartTime === c.laserStartTime && k.roundDuration === c.roundDuration,
          ),
      );
    expect(dropped).toHaveLength(4);
    for (const combination of dropped) {
      expect(lines.join(' ')).toContain(
        `laser ${combination.laserStartTime}s / round ${combination.roundDuration}s`,
      );
    }
  });

  it('KI-04-01: the seed list starts with agent-run.md’s own seeds, in its own order', () => {
    const seeds = pacingSeeds(150);
    expect(seeds.slice(0, AGENT_RUN_SEEDS.length)).toEqual([...AGENT_RUN_SEEDS]);
    expect(seeds).toHaveLength(150);
    expect(seeds[AGENT_RUN_SEEDS.length]).toBe(PACING_SEED_BASE + 1);
    // No duplicates: a repeated seed would be a match counted twice.
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('KI-04-01: a seed count below the agent-run list is that list truncated, never padded', () => {
    expect(pacingSeeds(3)).toEqual([1, 2, 3]);
  });
});

describe('KI-04-01 · aggregateCell', () => {
  it('KI-04-01 AC2: reports "reached the warning" and "reached inset >= 3" over a known mix', () => {
    const stats = aggregateCell(
      cellRun({
        results: [
          match([
            round({ reachedLaserPhase: false, maxLaserInset: 0 }),
            round({ reachedLaserPhase: true, maxLaserInset: 1 }),
          ]),
          match([
            round({ reachedLaserPhase: true, maxLaserInset: 3 }),
            round({ reachedLaserPhase: true, maxLaserInset: 7 }),
          ]),
        ],
      }),
    );

    expect(stats.rounds).toBe(4);
    expect(stats.reachedWarningCount).toBe(3);
    expect(stats.reachedWarningRatePct).toBe(75);
    // Insets 3 and 7 clear the bar; inset 1 does not.
    expect(stats.reachedClimaxInsetCount).toBe(2);
    expect(stats.reachedClimaxInsetRatePct).toBe(50);
  });

  it('KI-04-01: the per-inset histogram is monotonically non-increasing and starts at 100%', () => {
    const stats = aggregateCell(
      cellRun({
        results: [
          match([
            round({ maxLaserInset: 0 }),
            round({ maxLaserInset: 2 }),
            round({ maxLaserInset: 5 }),
            round({ maxLaserInset: 9 }),
          ]),
        ],
      }),
    );

    expect(stats.reachedInsetAtLeastRatePct).toHaveLength(MAX_LASER_INSET + 1);
    expect(stats.reachedInsetAtLeastRatePct[0]).toBe(100);
    expect(stats.reachedInsetAtLeastRatePct[CLIMAX_INSET]).toBe(50); // insets 5 and 9
    expect(stats.reachedInsetAtLeastRatePct[MAX_LASER_INSET]).toBe(25); // inset 9 alone
    for (let inset = 1; inset <= MAX_LASER_INSET; inset += 1) {
      expect(stats.reachedInsetAtLeastRatePct[inset]).toBeLessThanOrEqual(
        /** @type {number} */ (stats.reachedInsetAtLeastRatePct[inset - 1]),
      );
    }
  });

  it('KI-04-01: round length reports the median and p90 of a known list', () => {
    const seconds = [4, 8, 15, 16, 23, 42, 1, 2, 3, 5];
    const stats = aggregateCell(
      cellRun({ results: [match(seconds.map((value) => round({ seconds: value })))] }),
    );

    // Sorted: 1 2 3 4 5 8 15 16 23 42. floor(0.5*10) = 5 -> 8; floor(0.9*10) = 9 -> 42.
    expect(stats.roundLength?.medianSeconds).toBe(8);
    expect(stats.roundLength?.p90Seconds).toBe(42);
    expect(stats.roundLength?.minSeconds).toBe(1);
    expect(stats.roundLength?.maxSeconds).toBe(42);
  });

  it('KI-04-01: the match wall clock comes from frames, so it includes countdown and scoreboard', () => {
    // Two rounds of 10 simulated seconds is 20 s of round time, but the match drove 1 800 frames — 30 s at
    // 60 fps. The extra 10 s is exactly what the ticket means by "including countdown and scoreboard", and
    // it is why this figure is read off `frames` rather than summed from round lengths.
    const stats = aggregateCell(
      cellRun({
        results: [match([round({ seconds: 10 }), round({ seconds: 10 })], { frames: 1800 })],
      }),
    );

    expect(stats.matchWallClock?.meanSeconds).toBeCloseTo(30, 9);
    expect(stats.roundLength?.meanSeconds).toBe(10);
  });

  it('KI-04-01: rounds of an unfinished match still count; its wall clock does not', () => {
    // `report.js`'s split, for its reason: a round that reached a real ROUND_OVER happened, but "how long
    // did an unfinished match run before its budget expired" is not "how long does a match take".
    const stats = aggregateCell(
      cellRun({
        results: [
          match([round(), round()], { finished: true, frames: 600 }),
          match([round()], { finished: false, frames: 30_000 }),
        ],
      }),
    );

    expect(stats.rounds).toBe(3);
    expect(stats.matches).toBe(2);
    expect(stats.matchesFinished).toBe(1);
    expect(stats.matchWallClock?.meanSeconds).toBeCloseTo(10, 9);
  });

  it('KI-04-01: draw, death and timeout rates come out of a known result mix', () => {
    const stats = aggregateCell(
      cellRun({
        results: [
          match([
            round({ result: 'P1_WIN', endReason: 'DEATH' }),
            round({ result: 'P2_WIN', endReason: 'DEATH' }),
            round({ result: 'DRAW', endReason: 'TIMEOUT' }),
            round({ result: 'P1_WIN', endReason: 'TIMEOUT' }),
          ]),
        ],
      }),
    );

    expect(stats.p1Wins).toBe(2);
    expect(stats.p2Wins).toBe(1);
    expect(stats.draws).toBe(1);
    expect(stats.drawRatePct).toBe(25);
    expect(stats.deathRatePct).toBe(50);
    expect(stats.timeoutRatePct).toBe(50);
  });

  it('KI-04-01: the baseline flag is exactly the shipping pair, and nothing else is', () => {
    expect(aggregateCell(cellRun()).isBaseline).toBe(true);
    expect(aggregateCell(cellRun({ laserStartTime: 25 })).isBaseline).toBe(false);
    expect(aggregateCell(cellRun({ roundDuration: 60 })).isBaseline).toBe(false);
  });

  it('KI-04-01: the extension flag marks exactly the cells beyond the ticket’s own grid', () => {
    expect(aggregateCell(cellRun()).isEarlierStartExtension).toBe(false);
    for (const laserStartTime of LASER_START_TIMES) {
      expect(aggregateCell(cellRun({ laserStartTime })).isEarlierStartExtension).toBe(false);
    }
    for (const laserStartTime of EARLIER_LASER_START_TIMES) {
      expect(aggregateCell(cellRun({ laserStartTime })).isEarlierStartExtension).toBe(true);
    }
  });

  it('KI-04-01: an empty cell reports nulls rather than NaN', () => {
    const stats = aggregateCell(cellRun({ results: [] }));
    expect(stats.rounds).toBe(0);
    expect(stats.roundLength).toBeNull();
    expect(stats.matchWallClock).toBeNull();
    expect(stats.drawRatePct).toBeNull();
    expect(stats.reachedWarningRatePct).toBeNull();
  });
});

describe('KI-04-01 · reconcileBaseline', () => {
  /**
   * Builds a baseline cell that reproduces `agent-run.md` for one pairing exactly, by construction: one
   * one-round match per reference seed, with the rounds carrying whatever the reference says they should.
   *
   * @param {string} pairing
   * @param {{reachedWarningCount?: number, seconds?: number}} [tweaks]
   */
  function baselineMatching(pairing, tweaks = {}) {
    const reference = AGENT_RUN_REFERENCE[pairing];
    const seeds = AGENT_RUN_SEEDS.slice(0, reference.seedCount);
    const warnings = tweaks.reachedWarningCount ?? reference.reachedWarningCount;
    // `reference.rounds` rounds spread across `seeds.length` matches, so the seed set is complete.
    const rounds = Array.from({ length: reference.rounds }, (_, i) =>
      round({
        reachedLaserPhase: i < warnings,
        seconds: tweaks.seconds ?? reference.meanRoundSeconds,
      }),
    );
    const results = seeds.map((seed, i) =>
      match(i === 0 ? rounds : [], { seed, rounds: i === 0 ? rounds : [] }),
    );
    return cellRun({ pairing, seeds, results });
  }

  it('KI-04-01: a baseline that reproduces the reference agrees, field by field', () => {
    // Every round the same length, so mean and p90 both equal it — which lets the fixture hit the reference
    // exactly without reconstructing agent-run.md's real distribution.
    const pairing = 'greedy vs greedy';
    const reference = AGENT_RUN_REFERENCE[pairing];
    const cell = baselineMatching(pairing, { seconds: reference.meanRoundSeconds });
    const rows = reconcileBaseline([cell]);

    expect(rows).toHaveLength(1);
    expect(rows[0].pairing).toBe(pairing);
    expect(rows[0].actual.rounds).toBe(reference.rounds);
    expect(rows[0].actual.reachedWarningCount).toBe(reference.reachedWarningCount);
    // p90 of a constant list is that constant, so only the mean/p90 pair can disagree here; both match.
    expect(rows[0].differences.filter((line) => !line.startsWith('p90RoundSeconds'))).toEqual([]);
  });

  it('KI-04-01: a baseline that disagrees reports the field, the expectation and what it got', () => {
    const pairing = 'greedy vs greedy';
    const reference = AGENT_RUN_REFERENCE[pairing];
    const cell = baselineMatching(pairing, {
      reachedWarningCount: reference.reachedWarningCount + 1,
      seconds: reference.meanRoundSeconds,
    });
    const rows = reconcileBaseline([cell]);

    expect(rows[0].agrees).toBe(false);
    expect(rows[0].differences.join(' ')).toContain('reachedWarningCount');
    expect(rows[0].differences.join(' ')).toContain(
      `agent-run.md ${reference.reachedWarningCount}`,
    );
    expect(rows[0].differences.join(' ')).toContain(
      `this run ${reference.reachedWarningCount + 1}`,
    );
  });

  it('KI-04-01: a cell missing any reference seed produces no row rather than a false "differs"', () => {
    // The probe case. A short run cannot be compared with agent-run.md at all, and manufacturing a
    // disagreement out of a smaller sample would read as a real conflict between two instruments.
    const pairing = 'greedy vs greedy';
    const full = baselineMatching(pairing);
    const short = cellRun({ pairing, seeds: full.seeds, results: full.results.slice(0, 3) });
    expect(reconcileBaseline([short])).toEqual([]);
  });

  it('KI-04-01: a swept cell is never mistaken for the baseline', () => {
    const cell = baselineMatching('greedy vs greedy');
    expect(reconcileBaseline([{ ...cell, laserStartTime: 25 }])).toEqual([]);
    expect(reconcileBaseline([{ ...cell, roundDuration: 60 }])).toEqual([]);
  });
});

describe('KI-04-01 · renderPacingReport', () => {
  /** @returns {import('./pacing.js').AggregatedSweep} */
  function sampleSweep() {
    return aggregateSweep({
      meta: {
        date: '2026-09-08',
        command: 'KI_PACING=1 npm run test:agent:pacing',
        wallSeconds: 1234,
        seedsPerCell: 150,
        renderEveryNFrames: 1200,
        droppedCells: [],
      },
      cells: [
        cellRun(),
        cellRun({ laserStartTime: 25, results: [match([round({ reachedLaserPhase: true })])] }),
      ],
    });
  }

  it('KI-04-01 AC3: says plainly that bots die more cheaply than people and that these are directional', () => {
    const markdown = renderPacingReport(sampleSweep());
    expect(markdown).toContain('Bots die more cheaply than people');
    expect(markdown).toContain('directional');
    expect(markdown).toContain('does not judge whether the game is fun');
  });

  it('KI-04-01 AC1: names its regenerating command and its seeds', () => {
    const markdown = renderPacingReport(sampleSweep());
    expect(markdown).toContain('KI_PACING=1 npm run test:agent:pacing');
    expect(markdown).toContain(String(AGENT_RUN_SEEDS[0]));
    expect(markdown).toContain(String(PACING_SEED_BASE + 1));
  });

  it('KI-04-01: two regenerations differing only in date and wall time differ in exactly two lines', () => {
    const runA = sampleSweep();
    const runB = {
      ...sampleSweep(),
      meta: { ...runA.meta, date: '2026-12-25', wallSeconds: 9999 },
    };

    const linesA = renderPacingReport(runA).split('\n');
    const linesB = renderPacingReport(runB).split('\n');
    expect(linesA).toHaveLength(linesB.length);

    const differing = linesA.map((line, i) => [line, linesB[i]]).filter(([a, b]) => a !== b);
    expect(differing).toHaveLength(2);
    for (const [a, b] of differing) {
      expect(a).toMatch(/^- \*\*(Date|Wall time):\*\*/);
      expect(b).toMatch(/^- \*\*(Date|Wall time):\*\*/);
    }
  });

  it('KI-04-01: the JSON block parses and carries neither the date nor the wall time', () => {
    const markdown = renderPacingReport(sampleSweep());
    const jsonText = markdown.split('```json\n')[1].split('\n```')[0];
    const parsed = JSON.parse(jsonText);

    expect(parsed.cells).toHaveLength(2);
    expect(parsed.cells[0].isBaseline).toBe(true);
    expect(jsonText).not.toContain('2026-09-08');
    expect(jsonText).not.toContain('1234');
  });

  it('KI-04-01: a reduced sweep says so, and a full grid says it dropped nothing', () => {
    const full = renderPacingReport(sampleSweep());
    expect(full).toContain('No cell was dropped');

    const reduced = sampleSweep();
    reduced.meta.droppedCells = droppedCellLines('cross', 'BUDGET REASON.');
    expect(renderPacingReport(reduced)).toContain('BUDGET REASON.');
  });
});

describe('KI-04-01 · the committed document', () => {
  // Reading the committed document is the point of this block, so a missing one is a failure rather than a
  // skip: `docs/qa/playtests/round-pacing.md` is this ticket's deliverable and it is committed alongside
  // this file.
  it('KI-04-01 AC1: the committed document exists and its machine-readable block parses', () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const block = doc.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(block).not.toBeNull();
    const recorded = JSON.parse(/** @type {RegExpMatchArray} */ (block)[1]);
    expect(Array.isArray(recorded.cells)).toBe(true);
    expect(recorded.cells.length).toBeGreaterThan(0);
  });

  /** @returns {any} the committed JSON block. */
  function recordedBlock() {
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const block = /** @type {RegExpMatchArray} */ (doc.match(/```json\r?\n([\s\S]*?)\r?\n```/));
    return JSON.parse(block[1]);
  }

  it('KI-04-01: every pairing is present, and every cell is one of the swept combinations', () => {
    const recorded = recordedBlock();
    const combinations = combinationsFor(recorded.droppedCells.length === 0 ? 'grid' : 'cross');

    for (const pairing of PAIRINGS) {
      expect(recorded.cells.some((/** @type {any} */ cell) => cell.pairing === pairing)).toBe(true);
    }
    expect(recorded.cells).toHaveLength(PAIRINGS.length * combinations.length);
    for (const cell of recorded.cells) {
      expect(PAIRINGS).toContain(cell.pairing);
      expect(
        combinations.some(
          (c) => c.laserStartTime === cell.laserStartTime && c.roundDuration === cell.roundDuration,
        ),
      ).toBe(true);
    }
  });

  it('KI-04-01 AC2: every cell reports "reached the warning" and "reached inset >= 3"', () => {
    for (const cell of recordedBlock().cells) {
      expect(typeof cell.reachedWarningCount).toBe('number');
      expect(typeof cell.reachedWarningRatePct).toBe('number');
      expect(typeof cell.reachedClimaxInsetCount).toBe('number');
      expect(typeof cell.reachedClimaxInsetRatePct).toBe('number');
      expect(cell.reachedInsetAtLeastRatePct).toHaveLength(MAX_LASER_INSET + 1);
    }
  });

  it('KI-04-01: no cell is under-sampled below the ticket floor of 300 rounds', () => {
    // The sprint's budget rule: cells may be dropped and named, never quietly shrunk. Dropping is checked by
    // the cell-count assertion above; this is the other half.
    for (const cell of recordedBlock().cells) {
      expect(
        cell.rounds,
        `${cell.pairing} @ laser ${cell.laserStartTime}s / round ${cell.roundDuration}s`,
      ).toBeGreaterThanOrEqual(300);
    }
  });

  it('KI-04-01: every rate in the block is internally consistent with its own counts', () => {
    for (const cell of recordedBlock().cells) {
      expect(cell.p1Wins + cell.p2Wins + cell.draws).toBe(cell.rounds);
      expect(cell.deathCount + cell.timeoutCount).toBe(cell.rounds);
      expect(cell.deathRatePct + cell.timeoutRatePct).toBeCloseTo(100, 6);
      expect(cell.drawRatePct).toBeCloseTo((cell.draws / cell.rounds) * 100, 6);
      expect(cell.reachedWarningRatePct).toBeCloseTo(
        (cell.reachedWarningCount / cell.rounds) * 100,
        6,
      );
      expect(cell.reachedClimaxInsetRatePct).toBeCloseTo(
        (cell.reachedClimaxInsetCount / cell.rounds) * 100,
        6,
      );
      // Reaching inset >= 3 implies the beams left PARKED, so the climax count can never exceed the warning
      // count — a cell where it did would mean the two figures were computed from different rounds.
      expect(cell.reachedClimaxInsetCount).toBeLessThanOrEqual(cell.reachedWarningCount);
      expect(cell.roundLength.medianSeconds).toBeLessThanOrEqual(cell.roundLength.p90Seconds);
      expect(cell.matchWallClock.medianSeconds).toBeLessThanOrEqual(cell.matchWallClock.p90Seconds);
      // A round can never outlast its own cell's roundDuration by more than the crash slow-mo beat.
      expect(cell.roundLength.maxSeconds).toBeLessThanOrEqual(cell.roundDuration + 1);
    }
  });

  it('KI-04-01: the baseline cells are the shipping settings and reconcile with agent-run.md', () => {
    const recorded = recordedBlock();
    const baselines = recorded.cells.filter((/** @type {any} */ cell) => cell.isBaseline);
    expect(baselines).toHaveLength(PAIRINGS.length);
    for (const cell of baselines) {
      expect(cell.laserStartTime).toBe(SETTINGS.laserStartTime);
      expect(cell.roundDuration).toBe(SETTINGS.roundDuration);
    }

    expect(recorded.reconciliation).toHaveLength(PAIRINGS.length);
    for (const row of recorded.reconciliation) {
      expect(row.differences, `${row.pairing} vs agent-run.md`).toEqual([]);
      expect(row.agrees).toBe(true);
      expect(row.expected).toEqual({
        rounds: AGENT_RUN_REFERENCE[row.pairing].rounds,
        reachedWarningCount: AGENT_RUN_REFERENCE[row.pairing].reachedWarningCount,
        draws: AGENT_RUN_REFERENCE[row.pairing].draws,
        timeoutCount: AGENT_RUN_REFERENCE[row.pairing].timeoutCount,
        meanRoundSeconds: AGENT_RUN_REFERENCE[row.pairing].meanRoundSeconds,
        p90RoundSeconds: AGENT_RUN_REFERENCE[row.pairing].p90RoundSeconds,
      });
    }
  });

  it('KI-04-01: the document’s prose tables were rendered from the block they are committed beside', () => {
    // The actual diff: re-render the document from its own machine-readable block and require the tables to
    // come out identical. A hand-edited percentage in a table fails here, which is the drift this test
    // exists to catch (`tests/sim/tuningMatrix.test.js` guards `gate1-bot-matrix.md` the same way, with the
    // difference this file's own header explains).
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const recorded = recordedBlock();
    const dateLine = /** @type {RegExpMatchArray} */ (doc.match(/^- \*\*Date:\*\* (\S+?)\./m));
    const wallLine = /** @type {RegExpMatchArray} */ (doc.match(/^- \*\*Wall time:\*\* ~(\d+)s/m));
    const commandLine = /** @type {RegExpMatchArray} */ (
      doc.match(/^- \*\*Command:\*\* `(.+?)`$/m)
    );

    const rerendered = renderPacingReport({
      meta: {
        date: dateLine[1],
        command: commandLine[1],
        wallSeconds: Number(wallLine[1]),
        seedsPerCell: recorded.seedsPerCell,
        renderEveryNFrames: recorded.renderEveryNFrames,
        droppedCells: recorded.droppedCells,
      },
      cells: recorded.cells,
      reconciliation: recorded.reconciliation,
    });

    expect(rerendered).toBe(doc);
  });
});
