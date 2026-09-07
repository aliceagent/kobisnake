// @ts-check
import { describe, expect, it } from 'vitest';
import {
  aggregatePairing,
  aggregateRun,
  percentile,
  renderReport,
  REFERENCE_LASER_PHASE_RATES,
} from './report.js';

/**
 * KI-03-04 — `report.js` proved against hand-built fixtures, per the tech-lead ruling on #122 (ruling 1):
 * "test it against hand-built `MatchResult` fixtures — a p90 over a known list, a draw rate over a known
 * mix — not only against a live run." Nothing here touches a browser; `report.js` is Node-side and pure.
 */

/**
 * A minimal `RoundRecord`, filled in with the fields this module actually reads. Real `RoundRecord`s carry
 * more (`index`, `winnerId`, `lengths`, `laserPhaseAtEnd`, `maxLaserInset`) that `report.js` never looks at.
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
    ...overrides,
  });
}

/**
 * A minimal `MatchResult`.
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
    frames: 100,
    renders: 1,
    maxDrawCalls: 0,
    problemCount: 0,
    problems: [],
    pageErrors: [],
    wallMs: 100,
    ...overrides,
  });
}

describe('KI-03-04 · percentile', () => {
  it('KI-03-04: p90 of a known 20-value list is the value the nearest-rank formula predicts', () => {
    // 1..20. floor(0.9 * 20) = 18 (0-based) -> the 19th smallest value, 19.
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 0.9)).toBe(19);
  });

  it('KI-03-04: percentile is order-independent (sorts its input) and clamps at the top', () => {
    const shuffled = [30, 10, 20, 40, 50, 5, 15, 25, 35, 45];
    // floor(0.9 * 10) = 9 (0-based) -> the largest value.
    expect(percentile(shuffled, 0.9)).toBe(50);
    expect(percentile(shuffled, 0)).toBe(5);
  });

  it('KI-03-04: percentile of an empty array is null, not NaN', () => {
    expect(percentile([], 0.9)).toBeNull();
  });
});

describe('KI-03-04 · aggregatePairing', () => {
  it('KI-03-04: draw rate is computed over a known result mix', () => {
    // 10 rounds: 6 P1 wins, 3 P2 wins, 1 draw -> 10% draw rate.
    const rounds = [
      ...Array.from({ length: 6 }, () => round({ result: 'P1_WIN' })),
      ...Array.from({ length: 3 }, () => round({ result: 'P2_WIN' })),
      round({ result: 'DRAW' }),
    ];
    const stats = aggregatePairing({
      label: 'greedy vs greedy',
      seeds: [1],
      results: [match(rounds)],
      expectFinish: true,
    });
    expect(stats.rounds).toBe(10);
    expect(stats.p1Wins).toBe(6);
    expect(stats.p2Wins).toBe(3);
    expect(stats.draws).toBe(1);
    expect(stats.drawRatePct).toBeCloseTo(10, 10);
  });

  it('KI-03-04: end-reason mix and laser-phase rate are computed over a known mix', () => {
    // 4 rounds: 3 DEATH (1 of them reaching the laser phase), 1 TIMEOUT.
    const rounds = [
      round({ endReason: 'DEATH', reachedLaserPhase: false }),
      round({ endReason: 'DEATH', reachedLaserPhase: true }),
      round({ endReason: 'DEATH', reachedLaserPhase: false }),
      round({ endReason: 'TIMEOUT', reachedLaserPhase: true }),
    ];
    const stats = aggregatePairing({
      label: 'greedy vs survivor',
      seeds: [1],
      results: [match(rounds)],
      expectFinish: true,
    });
    expect(stats.deathCount).toBe(3);
    expect(stats.timeoutCount).toBe(1);
    expect(stats.deathRatePct).toBeCloseTo(75, 10);
    expect(stats.timeoutRatePct).toBeCloseTo(25, 10);
    expect(stats.laserPhaseReachedCount).toBe(2);
    expect(stats.laserPhaseReachedRatePct).toBeCloseTo(50, 10);
  });

  it('KI-03-04: round length mean/p90 over a known list of round lengths', () => {
    const seconds = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const rounds = seconds.map((s) => round({ seconds: s }));
    const stats = aggregatePairing({
      label: 'greedy vs greedy',
      seeds: [1],
      results: [match(rounds)],
      expectFinish: true,
    });
    expect(stats.roundLength).not.toBeNull();
    expect(stats.roundLength?.meanSeconds).toBeCloseTo(55, 10);
    expect(stats.roundLength?.minSeconds).toBe(10);
    expect(stats.roundLength?.maxSeconds).toBe(100);
    // floor(0.9 * 10) = 9 (0-based) -> the largest value, 100 — same nearest-rank convention as `percentile`.
    expect(stats.roundLength?.p90Seconds).toBe(100);
  });

  it('KI-03-04: rounds per match and match duration average only over finished matches', () => {
    const finishedA = match([round({ seconds: 10 }), round({ seconds: 20 })], { finished: true });
    const finishedB = match([round({ seconds: 15 })], { finished: true });
    const unfinished = match([round({ seconds: 999 })], { finished: false });
    const stats = aggregatePairing({
      label: 'greedy vs greedy',
      seeds: [1, 2, 3],
      results: [finishedA, finishedB, unfinished],
      expectFinish: true,
    });
    expect(stats.matches).toBe(3);
    expect(stats.matchesFinished).toBe(2);
    // Rounds per match: (2 + 1) / 2 = 1.5. Match duration: (30 + 15) / 2 = 22.5. The unfinished match's own
    // round (999s) must not pollute either average, even though it still counts in round-level totals below.
    expect(stats.meanRoundsPerMatch).toBeCloseTo(1.5, 10);
    expect(stats.meanMatchSeconds).toBeCloseTo(22.5, 10);
    // But the round-level stats still see all 4 rounds, unfinished match included.
    expect(stats.rounds).toBe(4);
  });

  it('KI-03-04: a pairing with zero finished matches (ruling 4, idle vs idle) reports null match-level numbers, not NaN', () => {
    const stats = aggregatePairing({
      label: 'idle vs idle',
      seeds: [1],
      results: [match([round({ result: 'DRAW', endReason: 'TIMEOUT' })], { finished: false })],
      expectFinish: false,
      maxFrames: 6000,
    });
    expect(stats.matchesFinished).toBe(0);
    expect(stats.meanRoundsPerMatch).toBeNull();
    expect(stats.meanMatchSeconds).toBeNull();
    expect(stats.p90MatchSeconds).toBeNull();
    // But round-level numbers are still real: one round played, and it was a draw.
    expect(stats.rounds).toBe(1);
    expect(stats.draws).toBe(1);
    expect(stats.drawRatePct).toBe(100);
  });

  it('KI-03-04: a pairing with zero rounds reports null rates rather than NaN', () => {
    const stats = aggregatePairing({
      label: 'empty',
      seeds: [],
      results: [],
      expectFinish: true,
    });
    expect(stats.rounds).toBe(0);
    expect(stats.drawRatePct).toBeNull();
    expect(stats.deathRatePct).toBeNull();
    expect(stats.laserPhaseReachedRatePct).toBeNull();
    expect(stats.roundLength).toBeNull();
  });
});

describe('KI-03-04 · aggregateRun', () => {
  it('KI-03-04: aggregates every pairing and carries meta through untouched', () => {
    const run = aggregateRun({
      meta: { date: '2026-09-07', command: 'npm run test:agent:report', wallSeconds: 120 },
      pairings: [
        {
          label: 'greedy vs greedy',
          seeds: [1, 2],
          results: [match([round()])],
          expectFinish: true,
        },
        {
          label: 'idle vs idle',
          seeds: [3],
          results: [match([round()], { finished: false })],
          expectFinish: false,
        },
      ],
    });
    expect(run.meta).toEqual({
      date: '2026-09-07',
      command: 'npm run test:agent:report',
      wallSeconds: 120,
    });
    expect(run.pairings).toHaveLength(2);
    expect(run.pairings[0].label).toBe('greedy vs greedy');
    expect(run.pairings[1].label).toBe('idle vs idle');
  });
});

describe('KI-03-04 · renderReport', () => {
  /** @returns {import('./report.js').AggregatedRun} */
  function sampleRun(overrides = {}) {
    return aggregateRun({
      meta: {
        date: '2026-09-07',
        command: 'KI_AGENT_REPORT=1 npm run test:agent:report',
        wallSeconds: 180,
      },
      pairings: [
        {
          label: 'greedy vs greedy',
          seeds: [1, 2, 3],
          results: [match([round({ seconds: 12 }), round({ seconds: 8 })])],
          expectFinish: true,
        },
        {
          label: 'idle vs idle',
          seeds: [1],
          results: [
            match([round({ result: 'DRAW', endReason: 'TIMEOUT', seconds: 6.3 })], {
              finished: false,
            }),
          ],
          expectFinish: false,
          maxFrames: 6000,
        },
      ],
      ...overrides,
    });
  }

  it('KI-03-04 AC1: states the command and the seeds, per pairing', () => {
    const markdown = renderReport(sampleRun());
    expect(markdown).toContain('KI_AGENT_REPORT=1 npm run test:agent:report');
    expect(markdown).toContain('**greedy vs greedy:** 1, 2, 3');
    expect(markdown).toContain('**idle vs idle:** 1');
  });

  it('KI-03-04 AC2: "reached the laser phase" is reported per policy pairing', () => {
    const markdown = renderReport(sampleRun());
    // The round-level table has one row per pairing, each naming its own laser-phase count and rate.
    expect(markdown).toMatch(/greedy vs greedy \|.*\|.*\|.*\|.*\| 0\/2 \(0\.0%\) \|/);
  });

  it('KI-03-04 ruling 4: the unfinished pairing is called out by name, with its bounded frame count', () => {
    const markdown = renderReport(sampleRun());
    expect(markdown).toContain('## Pairings that do not finish');
    expect(markdown).toContain('### idle vs idle');
    expect(markdown).toContain('bounded to 6000 frames');
    expect(markdown).toContain('#119 F1');
    expect(markdown).toContain('I01/#120');
  });

  it('KI-03-04 ruling 5: states what the numbers are not a verdict on', () => {
    const markdown = renderReport(sampleRun());
    expect(markdown).toContain('## Read this before the numbers');
    expect(markdown).toContain('Bots die more cheaply than people');
    expect(markdown).toContain('Speed Boost');
    expect(markdown).toContain('tests/sim');
    expect(markdown).toContain('does not judge whether the game is fun');
  });

  it('KI-03-04 ruling 2: two "regenerations" differing only in date/wall time produce identical output apart from those two lines', () => {
    const runA = sampleRun();
    const runB = { ...sampleRun(), meta: { ...runA.meta, date: '2026-12-25', wallSeconds: 9999 } };

    const linesA = renderReport(runA).split('\n');
    const linesB = renderReport(runB).split('\n');

    expect(linesA).toHaveLength(linesB.length);
    const differingLines = linesA
      .map((lineA, i) => [lineA, linesB[i]])
      .filter(([lineA, lineB]) => lineA !== lineB);

    // Exactly the "Date:" and "Wall time:" lines may differ — nothing else is allowed to depend on
    // wall-clock metadata (ruling 2's whole point, and directly what AC1's "re-running reproduces it" needs).
    expect(differingLines).toHaveLength(2);
    for (const [lineA, lineB] of differingLines) {
      expect(lineA).toMatch(/^- \*\*(Date|Wall time):\*\*/);
      expect(lineB).toMatch(/^- \*\*(Date|Wall time):\*\*/);
    }
  });

  it('KI-03-04: the machine-readable JSON block parses and matches the aggregated numbers', () => {
    const run = sampleRun();
    const markdown = renderReport(run);
    const jsonText = markdown.split('```json\n')[1].split('\n```')[0];
    const parsed = JSON.parse(jsonText);
    expect(parsed.pairings).toHaveLength(2);
    expect(parsed.pairings[0].label).toBe('greedy vs greedy');
    expect(parsed.pairings[0].rounds).toBe(2);
    // Neither the date nor the wall time (non-reproducible metadata) leaks into the reproducible block.
    expect(jsonText).not.toContain('2026-09-07');
    expect(jsonText).not.toContain('180');
  });

  it('KI-03-04 ruling 3: flags a laser-phase rate that disagrees materially with the historical reference', () => {
    // KI-03-02's own reference for "greedy vs greedy" is 12.0%; feed it a run where every round reaches the
    // laser phase (100%) and check the document says so instead of staying silent about the disagreement.
    const run = aggregateRun({
      meta: { date: '2026-09-07', command: 'x', wallSeconds: 1 },
      pairings: [
        {
          label: 'greedy vs greedy',
          seeds: [1],
          results: [
            match([round({ reachedLaserPhase: true }), round({ reachedLaserPhase: true })]),
          ],
          expectFinish: true,
        },
      ],
    });
    const markdown = renderReport(run);
    expect(markdown).toContain('differs from it');
  });

  it('KI-03-04 ruling 3: does not flag a laser-phase rate that agrees with the historical reference', () => {
    // Same reference (12.0%), fed a run that actually lands close to it.
    const rounds = [
      ...Array.from({ length: 88 }, () => round({ reachedLaserPhase: false })),
      ...Array.from({ length: 12 }, () => round({ reachedLaserPhase: true })),
    ];
    const run = aggregateRun({
      meta: { date: '2026-09-07', command: 'x', wallSeconds: 1 },
      pairings: [
        { label: 'greedy vs greedy', seeds: [1], results: [match(rounds)], expectFinish: true },
      ],
    });
    const markdown = renderReport(run);
    expect(markdown).toContain('agrees with it');
    expect(markdown).not.toContain('differs from it');
  });

  it("KI-03-04: F3's 14.8% belongs to greedy vs greedy, the pairing it was measured on", () => {
    // The correction this test exists to pin. `docs/qa/reports/2026-09-07-agent-qa-pass.md` §2 describes the
    // harness F3's number came from as "whole matches with a greedy bot ... **both players driven**" — that
    // is greedy vs greedy. An earlier draft attached 14.8% to greedy vs survivor, which manufactured a
    // 33-point "discrepancy" that was never real and hid the one genuine cross-instrument agreement this
    // layer exists to produce. A future edit that moves it back would pass every other test in this file.
    expect(REFERENCE_LASER_PHASE_RATES['greedy vs greedy']).toBe(14.8);
    expect(REFERENCE_LASER_PHASE_RATES['greedy vs survivor']).toBeUndefined();
    expect(REFERENCE_LASER_PHASE_RATES['survivor vs survivor']).toBeUndefined();
  });

  it('KI-03-04 ruling 3: "greedy vs survivor" is reported against the matrix, not against F3', () => {
    const run = aggregateRun({
      meta: { date: '2026-09-07', command: 'x', wallSeconds: 1 },
      pairings: [
        {
          label: 'greedy vs survivor',
          seeds: [1],
          results: [
            match([
              round({ reachedLaserPhase: true }),
              round({ reachedLaserPhase: true }),
              round({ reachedLaserPhase: false }),
            ]),
          ],
          expectFinish: true,
        },
      ],
    });
    const markdown = renderReport(run);
    // It still says its own number, and it still says what that number can honestly be read against —
    // but it does not claim to agree or disagree with a figure measured on a different pairing.
    expect(markdown).toContain('reached the laser phase in 66.7% of rounds here');
    expect(markdown).toContain('No F3 figure exists for this pairing');
    expect(markdown).toContain('gate1-bot-matrix.md');
    expect(markdown).toContain('excludes outright');
    expect(markdown).not.toContain('differs from it');
    expect(markdown).not.toContain('agrees with it');
  });
});
