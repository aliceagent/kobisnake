// @ts-check
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_FRAMES,
  FRAME_SECONDS,
  RENDER_EVERY_N_FRAMES,
  failureReasons,
} from './driver.js';

/**
 * KI-03-01 — the parts of the driver that are pure functions, proved in Node without a browser.
 *
 * `failureReasons` is the whole of AC3 ("`npm run test:agent` fails on a non-zero problem count, a page
 * error, or a match that does not finish"), so the three clauses are tested against fabricated results here
 * rather than by trying to *cause* each failure in a real browser — one of the three (an unfinishable match)
 * is caused for real in `playtest.spec.js` as well, because that one is reachable on this build.
 */

/** @returns {any} a healthy result with everything AC3 looks at set to its good value. */
function healthyResult(overrides = {}) {
  return {
    seed: 7,
    bestOf: 3,
    finished: true,
    rounds: [{ index: 0 }, { index: 1 }],
    match: null,
    statesVisited: ['COUNTDOWN', 'PLAYING', 'ROUND_OVER', 'MATCH_OVER'],
    frames: 1728,
    renders: 15,
    maxDrawCalls: 22,
    problemCount: 0,
    problems: [],
    pageErrors: [],
    wallMs: 3400,
    ...overrides,
  };
}

describe('KI-03-01 · driver constants', () => {
  it('KI-03-01 AC2: the render cadence is a named constant, one render per four simulated seconds', () => {
    expect(RENDER_EVERY_N_FRAMES).toBe(240);
    expect(FRAME_SECONDS).toBeCloseTo(1 / 60, 12);
    expect(RENDER_EVERY_N_FRAMES * FRAME_SECONDS).toBeCloseTo(4, 10);
  });

  it('KI-03-01: the default frame budget covers a Best-of-3 of three full-length rounds', () => {
    // Three 90 s rounds, four countdown beats of 0.8 s and a 2.5 s scoreboard each, at 60 frames a second.
    const worstCaseFrames = 3 * (90 + 3.2 + 2.5) * 60;
    expect(DEFAULT_MAX_FRAMES).toBeGreaterThan(worstCaseFrames);
  });
});

describe('KI-03-01 AC3 · failureReasons', () => {
  it('KI-03-01 AC3: a healthy run has no failure reasons', () => {
    expect(failureReasons([healthyResult(), healthyResult({ seed: 9 })])).toEqual([]);
  });

  it('KI-03-01 AC3: a match that did not finish fails, naming its seed', () => {
    const reasons = failureReasons([healthyResult({ seed: 55, finished: false, frames: 30000 })]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('seed 55');
    expect(reasons[0]).toContain('did not finish');
    expect(reasons[0]).toContain('30000 frames');
  });

  it('KI-03-01 AC3: a page error fails, naming its seed', () => {
    const reasons = failureReasons([
      healthyResult({ seed: 3, pageErrors: ['pageerror: boom', 'console.error: bad'] }),
    ]);
    expect(reasons).toEqual(['seed 3: pageerror: boom', 'seed 3: console.error: bad']);
  });

  it('KI-03-01 AC3: a non-zero problem count fails, naming the rule and the frame', () => {
    const reasons = failureReasons([
      healthyResult({
        seed: 8,
        problemCount: 1,
        problems: [{ rule: 'segments-in-bounds', detail: 'x=-1', frame: 412, round: 1 }],
      }),
    ]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('seed 8');
    expect(reasons[0]).toContain('1 invariant problem');
    expect(reasons[0]).toContain('segments-in-bounds');
    expect(reasons[0]).toContain('@frame 412');
  });

  it('KI-03-01 AC3: a flood of problems reports the first few and counts the rest', () => {
    const problems = Array.from({ length: 5 }, (_, index) => ({
      rule: `rule-${index}`,
      detail: 'detail',
      frame: index,
      round: 0,
    }));
    const reasons = failureReasons([healthyResult({ problemCount: 135, problems })]);
    expect(reasons[0]).toContain('135 invariant problem');
    expect(reasons[0]).toContain('rule-4');
    expect(reasons[0]).toContain('…and 130 more');
  });

  it('KI-03-01 AC3: every failing match contributes its own reasons', () => {
    const reasons = failureReasons([
      healthyResult({ seed: 1 }),
      healthyResult({ seed: 2, finished: false }),
      healthyResult({ seed: 3, pageErrors: ['pageerror: nope'] }),
    ]);
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain('seed 2');
    expect(reasons[1]).toContain('seed 3');
  });
});
