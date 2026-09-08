// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { KNOWN_STATES } from './monkey.js';
import {
  CALIBRATION,
  TRANSITION_ROWS,
  aggregateCampaign,
  aggregateStateCoverage,
  aggregateTransitionCoverage,
  failureEntriesFor,
  failureKeysFor,
  groupFailures,
  laserWarningCoverage,
  reasonStateUnreachable,
  renderSessionFuzzReport,
  replayBudgetCoverage,
} from './sessionFuzz.js';

/**
 * KI-18-03 — two jobs, the same split `report.test.js` and `pacing.test.js` already use under the tech-lead
 * ruling on #122:
 *
 * 1. **`sessionFuzz.js`'s pure functions, against hand-built fixtures.** Nothing here touches a browser.
 * 2. **The committed document's machine-readable block, diffed** — `pacing.test.js`'s own pattern, copied per
 *    this ticket's instruction. A 2 000-seed, 500-action-a-seed campaign cannot be recomputed inside Vitest at
 *    any acceptable cost, so this file checks everything about the block that does not require re-deriving
 *    it: that it parses, that every acceptance-criterion field is present, that the rendered document agrees
 *    with the block it was rendered from, and that every failure the block names carries a filed issue link.
 */

const REPORT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'docs',
  'qa',
  'reports',
  '2026-09-08-session-fuzz.md',
);

/**
 * A minimal `MonkeyResult` carrying the fields `sessionFuzz.js` reads.
 *
 * @param {Partial<import('./monkey.js').MonkeyResult>} overrides
 * @returns {import('./monkey.js').MonkeyResult}
 */
function monkeyResult(overrides = {}) {
  return /** @type {any} */ ({
    seed: 1,
    actionCount: 500,
    actionsApplied: 500,
    simSeconds: 90,
    hiddenSeconds: 0,
    framesPumped: 0,
    expensiveSeconds: 0,
    expensiveSkippedSeconds: 0,
    statesVisited: ['MAIN_MENU'],
    transitions: [],
    problems: [],
    problemCount: 0,
    stopped: null,
    pageErrors: [],
    wallMs: 2600,
    timing: { loadMs: 400, stepsMs: 2000, resizeMs: 200, stretches: 1 },
    ...overrides,
  });
}

describe('KI-18-03 · aggregateStateCoverage', () => {
  it('KI-18-03 AC1: a state visited by any seed is reached; every other known state is not', () => {
    const results = [
      monkeyResult({ seed: 1, statesVisited: ['MAIN_MENU', 'MATCH_SETUP', 'COUNTDOWN'] }),
      monkeyResult({ seed: 2, statesVisited: ['MAIN_MENU', 'PLAYING'] }),
    ];
    const coverage = aggregateStateCoverage(results);

    expect(coverage.reached).toEqual(['COUNTDOWN', 'MAIN_MENU', 'MATCH_SETUP', 'PLAYING'].sort());
    expect(coverage.seedsThatReached.MAIN_MENU).toBe(2);
    expect(coverage.seedsThatReached.PLAYING).toBe(1);
    for (const state of coverage.notReached) expect(coverage.reached).not.toContain(state);
    expect(coverage.reached.length + coverage.notReached.length).toBe(KNOWN_STATES.length);
  });

  it('KI-18-03: the four disabled menu rows carry a reason citing mainMenu.js and focus.js', () => {
    for (const state of ['PRACTICE', 'TUTORIAL', 'SHOP', 'SETTINGS']) {
      const reason = reasonStateUnreachable(state);
      expect(reason).not.toBeNull();
      expect(reason).toContain('mainMenu.js');
      expect(reason).toContain('disabled');
      expect(reason).toContain('focus.js');
    }
  });

  it('KI-18-03: a structurally reachable state that was simply not visited carries no manufactured reason', () => {
    expect(reasonStateUnreachable('LASER_WARNING')).toBeNull();
    expect(reasonStateUnreachable('REPLAY')).toBeNull();
  });
});

describe('KI-18-03 · aggregateTransitionCoverage', () => {
  it('KI-18-03: a row is exercised the moment any seed’s transitions take it, by (from, event) only', () => {
    const results = [
      monkeyResult({
        transitions: [
          {
            event: 'SELECT_2P',
            from: 'MAIN_MENU',
            to: 'MATCH_SETUP',
            actionIndex: 0,
            simSeconds: 0.1,
          },
        ],
      }),
    ];
    const coverage = aggregateTransitionCoverage(results);
    expect(coverage.exercised).toContain('MAIN_MENU --SELECT_2P-->');
    expect(coverage.notExercised).not.toContain('MAIN_MENU --SELECT_2P-->');
    expect(coverage.exercised.length + coverage.notExercised.length).toBe(TRANSITION_ROWS.length);
  });

  it('KI-18-03: a transition outside the table is never counted as an exercised row', () => {
    const coverage = aggregateTransitionCoverage([
      monkeyResult({
        transitions: [
          { event: 'MADE_UP', from: 'MAIN_MENU', to: 'MAIN_MENU', actionIndex: 0, simSeconds: 0 },
        ],
      }),
    ]);
    expect(coverage.exercised).not.toContain('MAIN_MENU --MADE_UP-->');
  });
});

describe('KI-18-03 · laserWarningCoverage and replayBudgetCoverage', () => {
  it('KI-18-03: LASER_WARNING is measured, not assumed — a known count over a known total', () => {
    const stats = laserWarningCoverage([
      monkeyResult({ seed: 1, statesVisited: ['MAIN_MENU', 'LASER_WARNING'] }),
      monkeyResult({ seed: 2, statesVisited: ['MAIN_MENU'] }),
      monkeyResult({ seed: 3, statesVisited: ['MAIN_MENU'] }),
      monkeyResult({ seed: 4, statesVisited: ['MAIN_MENU'] }),
    ]);
    expect(stats.seedsThatReachedIt).toBe(1);
    expect(stats.totalSeeds).toBe(4);
    expect(stats.ratePct).toBe(25);
  });

  it('KI-18-03: an empty run reports a 0% laser-warning rate, never NaN', () => {
    expect(laserWarningCoverage([]).ratePct).toBe(0);
  });

  it('KI-18-03: the REPLAY budget totals sum expensiveSeconds/expensiveSkippedSeconds across the run', () => {
    const stats = replayBudgetCoverage([
      monkeyResult({
        statesVisited: ['MAIN_MENU', 'REPLAY'],
        expensiveSeconds: 0.25,
        expensiveSkippedSeconds: 1.1,
      }),
      monkeyResult({
        statesVisited: ['MAIN_MENU'],
        expensiveSeconds: 0,
        expensiveSkippedSeconds: 0,
      }),
    ]);
    expect(stats.seedsThatEnteredIt).toBe(1);
    expect(stats.expensiveSeconds).toBeCloseTo(0.25, 9);
    expect(stats.expensiveSkippedSeconds).toBeCloseTo(1.1, 9);
    expect(stats.budgetSecondsPerSeed).toBe(0.25);
  });
});

describe('KI-18-03 · groupFailures', () => {
  it('KI-18-03: several seeds hitting the same rule in the same state is one finding', () => {
    const results = [
      monkeyResult({
        seed: 1,
        problems: [
          { rule: 'stuck', detail: 'B', actionIndex: 20, state: 'MAIN_MENU', fatal: true },
        ],
      }),
      monkeyResult({
        seed: 2,
        problems: [{ rule: 'stuck', detail: 'C', actionIndex: 5, state: 'PAUSE', fatal: true }],
      }),
      monkeyResult({
        seed: 3,
        problems: [
          { rule: 'stuck', detail: 'A', actionIndex: 10, state: 'MAIN_MENU', fatal: true },
        ],
      }),
    ];
    const failures = groupFailures(results);

    expect(failures).toHaveLength(2);
    const mainMenuFailure = /** @type {any} */ (failures.find((f) => f.state === 'MAIN_MENU'));
    expect(mainMenuFailure.rule).toBe('stuck');
    expect(mainMenuFailure.seeds).toEqual([1, 3]); // seeds sorted ascending regardless of processing order
    expect(mainMenuFailure.firstSeen.seed).toBe(1); // seed 1's occurrence was processed first
    expect(mainMenuFailure.occurrences).toBe(2);
    // Grouping is per (rule, state): the PAUSE occurrence is a separate finding despite the same rule.
    expect(failures.map((f) => f.state).sort()).toEqual(['MAIN_MENU', 'PAUSE']);
  });

  it('KI-18-03: the same seed hitting the same finding twice counts once in `seeds`, twice in `occurrences`', () => {
    const failures = groupFailures([
      monkeyResult({
        problems: [
          { rule: 'state outside the machine table', detail: 'x', actionIndex: 1, state: 'GHOST' },
          { rule: 'state outside the machine table', detail: 'x', actionIndex: 9, state: 'GHOST' },
        ],
      }),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].seeds).toEqual([1]);
    expect(failures[0].occurrences).toBe(2);
  });

  it('KI-18-03: a page error groups by its own message text, and carries no state', () => {
    const failures = groupFailures([
      monkeyResult({
        seed: 5,
        pageErrors: [
          'pageerror: gameStateMachine: illegal transition MATCH_OVER --QUIT_TO_MENU-->',
        ],
      }),
      monkeyResult({
        seed: 9,
        pageErrors: [
          'pageerror: gameStateMachine: illegal transition MATCH_OVER --QUIT_TO_MENU-->',
        ],
      }),
    ]);
    expect(failures).toHaveLength(1);
    expect(failures[0].rule).toBe('pageerror');
    expect(failures[0].state).toBeNull();
    expect(failures[0].detail).toBe(
      'gameStateMachine: illegal transition MATCH_OVER --QUIT_TO_MENU-->',
    );
    expect(failures[0].seeds).toEqual([5, 9]);
  });

  it('KI-18-03: a clean run groups to no failures at all', () => {
    expect(groupFailures([monkeyResult(), monkeyResult({ seed: 2 })])).toEqual([]);
  });

  it('KI-18-03: failureKeysFor agrees with groupFailures’ own key for the same result', () => {
    const result = monkeyResult({
      problems: [{ rule: 'stuck', detail: 'x', actionIndex: 1, state: 'PAUSE', fatal: true }],
    });
    const [failure] = groupFailures([result]);
    expect(failureKeysFor(result).has(failure.key)).toBe(true);
    expect(failureEntriesFor(result)).toHaveLength(1);
  });
});

describe('KI-18-03 · aggregateCampaign and renderSessionFuzzReport', () => {
  /** @returns {import('./sessionFuzz.js').AggregatedCampaign} */
  function sampleCampaign() {
    return aggregateCampaign({
      meta: {
        date: '2026-09-08',
        command: 'KI_SESSION_FUZZ=1 npm run test:agent:sessionfuzz',
        wallSeconds: 5200,
        actionsPerSeed: 500,
        batchCount: 8,
      },
      results: [
        monkeyResult({
          seed: 1,
          statesVisited: ['MAIN_MENU', 'MATCH_SETUP', 'COUNTDOWN', 'PLAYING'],
        }),
        monkeyResult({
          seed: 2,
          statesVisited: ['MAIN_MENU'],
          problems: [
            {
              rule: 'stuck',
              detail: 'stuck detail',
              actionIndex: 3,
              state: 'MAIN_MENU',
              fatal: true,
            },
          ],
        }),
      ],
    });
  }

  it('KI-18-03 AC1: totals actions, simulated seconds and transitions across every seed', () => {
    const aggregated = sampleCampaign();
    expect(aggregated.seedsRun).toBe(2);
    expect(aggregated.actionsApplied).toBe(1000);
    expect(aggregated.simSeconds).toBe(180);
    expect(aggregated.failures).toHaveLength(1);
    expect(aggregated.seedsWithAFailure).toBe(1);
  });

  it('KI-18-03 AC1: renders the calibration figures verbatim from CALIBRATION, not restated numbers', () => {
    const markdown = renderSessionFuzzReport(sampleCampaign());
    expect(markdown).toContain(`${CALIBRATION.seedsThatFoundIt} of ${CALIBRATION.seedsRun} seeds`);
    expect(markdown).toContain(`seed ${CALIBRATION.firstSeedThatFoundIt}`);
    expect(markdown).toContain(`${CALIBRATION.pilotSeeds}-seed pilot`);
  });

  it('KI-18-03 AC2: an unfiled failure reads "not yet filed"; a filed one carries its issue link', () => {
    const aggregated = sampleCampaign();
    const key = aggregated.failures[0].key;
    const unfiled = renderSessionFuzzReport(aggregated);
    expect(unfiled).toContain('_not yet filed_');

    const filed = renderSessionFuzzReport(aggregated, { [key]: '#999' });
    expect(filed).toContain('#999');
    expect(filed).not.toContain('_not yet filed_');
  });

  it('KI-18-03: a clean run says so plainly rather than manufacturing a finding', () => {
    const clean = aggregateCampaign({
      meta: {
        date: '2026-09-08',
        command: 'x',
        wallSeconds: 1,
        actionsPerSeed: 500,
        batchCount: 1,
      },
      results: [monkeyResult()],
    });
    const markdown = renderSessionFuzzReport(clean);
    expect(markdown).toContain('No distinct failure was found');
    expect(markdown).toContain('2% hit rate');
  });

  it('KI-18-03: two renders differing only in date and wall time differ only in those lines', () => {
    const a = sampleCampaign();
    const b = { ...a, meta: { ...a.meta, date: '2026-12-25', wallSeconds: 1 } };
    const linesA = renderSessionFuzzReport(a).split('\n');
    const linesB = renderSessionFuzzReport(b).split('\n');
    expect(linesA).toHaveLength(linesB.length);
    const differing = linesA.map((line, i) => [line, linesB[i]]).filter(([x, y]) => x !== y);
    for (const [x, y] of differing) {
      expect(x).toMatch(/\*\*Date:\*\*|\*\*Wall time:\*\*/);
      expect(y).toMatch(/\*\*Date:\*\*|\*\*Wall time:\*\*/);
    }
  });

  it('KI-18-03: the JSON block parses and carries neither the date nor the wall time', () => {
    const markdown = renderSessionFuzzReport(sampleCampaign());
    const jsonText = markdown.split('```json\n')[1].split('\n```')[0];
    const parsed = JSON.parse(jsonText);
    expect(parsed.seedsRun).toBe(2);
    expect(jsonText).not.toContain('2026-09-08');
    expect(jsonText).not.toContain('5200');
  });
});

describe('KI-18-03 · the committed document', () => {
  // A missing report is a failure rather than a skip, per `pacing.test.js`'s own precedent: this ticket's
  // deliverable is committed alongside this file.
  it('KI-18-03 AC1: the committed report exists and its machine-readable block parses', () => {
    expect(existsSync(REPORT_PATH)).toBe(true);
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const block = doc.match(/```json\r?\n([\s\S]*?)\r?\n```/);
    expect(block).not.toBeNull();
    const recorded = JSON.parse(/** @type {RegExpMatchArray} */ (block)[1]);
    expect(typeof recorded.seedsRun).toBe('number');
    expect(Array.isArray(recorded.stateCoverage.reached)).toBe(true);
  });

  /** @returns {any} the committed JSON block. */
  function recordedBlock() {
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const block = /** @type {RegExpMatchArray} */ (doc.match(/```json\r?\n([\s\S]*?)\r?\n```/));
    return JSON.parse(block[1]);
  }

  it('KI-18-03 AC1: the ticket’s own scale — 2 000 seeds — was actually run', () => {
    const recorded = recordedBlock();
    expect(recorded.seedsRun).toBe(2000);
    expect(recorded.actionsPerSeed).toBe(500);
  });

  it('KI-18-03 AC1: every state in the machine’s table is accounted for, reached or with a reason', () => {
    const recorded = recordedBlock();
    expect(recorded.stateCoverage.reached.length + recorded.stateCoverage.notReached.length).toBe(
      KNOWN_STATES.length,
    );
    for (const state of KNOWN_STATES) {
      expect(
        recorded.stateCoverage.reached.includes(state) ||
          recorded.stateCoverage.notReached.includes(state),
      ).toBe(true);
    }
  });

  it('KI-18-03: LASER_WARNING’s coverage is a measured count, present whichever way it came out', () => {
    const recorded = recordedBlock();
    expect(typeof recorded.laserWarning.seedsThatReachedIt).toBe('number');
    expect(recorded.laserWarning.totalSeeds).toBe(2000);
  });

  it('KI-18-03: the REPLAY budget figures are present and cite the #317 budget', () => {
    const recorded = recordedBlock();
    expect(typeof recorded.replayBudget.seedsThatEnteredIt).toBe('number');
    expect(recorded.replayBudget.budgetSecondsPerSeed).toBe(0.25);
    const doc = readFileSync(REPORT_PATH, 'utf8');
    expect(doc).toContain('#317');
  });

  it('KI-18-03: the calibration block matches CALIBRATION exactly', () => {
    expect(recordedBlock().calibration).toEqual(CALIBRATION);
  });

  it('KI-18-03 AC2: every failure the block names carries a filed issue link', () => {
    const recorded = recordedBlock();
    for (const failure of recorded.failures) {
      expect(failure.issue, `failure ${failure.key} has no issue link`).not.toBeNull();
      expect(failure.issue).toMatch(/^#\d+$/);
    }
  });

  it('KI-18-03: the document’s prose was rendered from the block it is committed beside', () => {
    // The actual diff, byte for byte — `pacing.test.js`'s own pattern, copied per this ticket's instruction:
    // re-render the document from its own machine-readable block (every field the renderer needs is in that
    // block, including each failure's `detail` and `firstSeen`) and require the result to match exactly. A
    // hand-edited number in the prose fails here.
    const doc = readFileSync(REPORT_PATH, 'utf8');
    const recorded = recordedBlock();
    const dateLine = /** @type {RegExpMatchArray} */ (doc.match(/^- \*\*Date:\*\* (\S+)\./m));
    const wallLine = /** @type {RegExpMatchArray} */ (doc.match(/~(\d+)s, summed across/));
    const commandLine = /** @type {RegExpMatchArray} */ (doc.match(/^- \*\*Command:\*\* (.+)$/m));

    /** @type {Record<string, string>} */
    const issueLinks = {};
    for (const failure of recorded.failures) {
      if (failure.issue !== null) issueLinks[failure.key] = failure.issue;
    }

    /** @type {import('./sessionFuzz.js').AggregatedCampaign} */
    const rebuilt = {
      meta: {
        date: dateLine[1],
        command: commandLine[1],
        wallSeconds: Number(wallLine[1]),
        actionsPerSeed: recorded.actionsPerSeed,
        batchCount: recorded.batchCount,
      },
      seedsRun: recorded.seedsRun,
      actionsApplied: recorded.actionsApplied,
      simSeconds: recorded.simSeconds,
      hiddenSeconds: recorded.hiddenSeconds,
      transitionsRecorded: recorded.transitionsRecorded,
      stateCoverage: {
        reached: recorded.stateCoverage.reached,
        notReached: recorded.stateCoverage.notReached,
        unreachedReasons: Object.fromEntries(
          recorded.stateCoverage.notReached.map((/** @type {string} */ state) => [
            state,
            reasonStateUnreachable(state),
          ]),
        ),
        seedsThatReached: recorded.stateCoverage.seedsThatReached,
      },
      transitionCoverage: {
        exercised: TRANSITION_ROWS.filter(
          (row) => !recorded.transitionCoverage.notExercised.includes(row),
        ),
        notExercised: recorded.transitionCoverage.notExercised,
      },
      laserWarning: recorded.laserWarning,
      replayBudget: recorded.replayBudget,
      failures: recorded.failures,
      seedsWithAFailure: new Set(recorded.failures.flatMap((/** @type {any} */ f) => f.seeds)).size,
    };

    expect(renderSessionFuzzReport(rebuilt, issueLinks)).toBe(doc);
  });
});
