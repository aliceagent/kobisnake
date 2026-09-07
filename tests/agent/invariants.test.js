// @ts-check
import { describe, expect, it } from 'vitest';
import { HUD_INTERVAL_SECONDS } from '../../src/game/session.js';
import { SETTINGS } from '../../src/core/settings.js';
import { HUD_LENGTH_TOLERANCE, HUD_TIMER_TOLERANCE_SECONDS, checkInvariants } from './invariants.js';

/**
 * KI-03-03 AC1 — every invariant fed a deliberately broken snapshot, seen to fail, plus one healthy snapshot
 * that stays silent. `tests/agent/README.md`/`driver.js`'s header explain why {@link checkInvariants} itself
 * may not be exercised any other way in the browser: it is proved unit-testable here (an ordinary exported
 * function of a plain object) and proved *serialisable* by `invariants.spec.js`, which actually ships it into
 * a page the way the driver does.
 */

const GRID = { width: 24, height: 24 };

/** A default config matching what `invariants.spec.js` actually hands the driver. */
function baseConfig(overrides = {}) {
  return {
    grid: GRID,
    hudTimerToleranceSeconds: HUD_TIMER_TOLERANCE_SECONDS,
    hudLengthTolerance: HUD_LENGTH_TOLERANCE,
    ...overrides,
  };
}

/**
 * @param {object} [overrides]
 * @returns {any}
 */
function healthySnake(overrides = {}) {
  return {
    id: 'p1',
    color: 'red',
    alive: true,
    length: 4,
    direction: { dx: 1, dy: 0 },
    segments: [
      { x: 5, y: 12 },
      { x: 4, y: 12 },
      { x: 3, y: 12 },
      { x: 2, y: 12 },
    ],
    previousSegments: [
      { x: 5, y: 12 },
      { x: 4, y: 12 },
      { x: 3, y: 12 },
      { x: 2, y: 12 },
    ],
    stepProgress: 0.4,
    pendingGrowth: 0,
    speedMultiplier: 1,
    effects: [],
    ...overrides,
  };
}

/** A whole-board, mid-round, healthy snapshot. Every unit test below mutates exactly one thing on top. */
function healthySnapshot() {
  return {
    seed: 1,
    mode: 'match',
    tick: 120,
    elapsed: 1,
    timeRemaining: 89,
    phase: 'PLAYING',
    result: null,
    winnerId: null,
    endReason: null,
    snakes: [
      healthySnake({ id: 'p1' }),
      healthySnake({
        id: 'p2',
        color: 'blue',
        direction: { dx: -1, dy: 0 },
        segments: [
          { x: 18, y: 11 },
          { x: 19, y: 11 },
          { x: 20, y: 11 },
          { x: 21, y: 11 },
        ],
        previousSegments: [
          { x: 18, y: 11 },
          { x: 19, y: 11 },
          { x: 20, y: 11 },
          { x: 21, y: 11 },
        ],
      }),
    ],
    apples: [
      { x: 10, y: 5 },
      { x: 2, y: 20 },
    ],
    lasers: { phase: 'PARKED', inset: 0, insetCells: 0 },
    powerUps: { pickups: [] },
  };
}

/** HUD text that exactly agrees with {@link healthySnapshot}'s numbers. */
function healthyHud() {
  return { timerText: '1:29', p1Text: 'P1 4', p2Text: 'P2 4' };
}

/** @param {object} snapshot @param {object} [hud] @param {object} [config] */
function run(snapshot, hud = healthyHud(), config = baseConfig()) {
  return checkInvariants({ snapshot, hud, state: 'PLAYING', config });
}

describe('KI-03-03 · checkInvariants stays silent on a healthy snapshot', () => {
  it('reports nothing at all', () => {
    expect(run(healthySnapshot())).toEqual([]);
  });

  it('is unaffected by null apple slots and an empty power-up list', () => {
    const snapshot = healthySnapshot();
    snapshot.apples = [null, { x: 10, y: 5 }, undefined, { x: 2, y: 20 }];
    expect(run(snapshot)).toEqual([]);
  });

  it('ignores timeRemaining=null (practice mode) rather than flagging it', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = null;
    const hud = { ...healthyHud(), timerText: '0:00' };
    expect(run(snapshot, hud)).toEqual([]);
  });
});

describe('KI-03-03 AC1 · each invariant fails on a deliberately broken snapshot', () => {
  it('segments-in-bounds: a segment off the grid', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].segments[0] = { x: -1, y: 12 };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('segments-in-bounds');
    expect(problems.find((p) => p.rule === 'segments-in-bounds').detail).toMatch(/-1/);
  });

  it('segments-integral: a non-integer segment cell', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].segments[0] = { x: 5.5, y: 12 };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('segments-integral');
  });

  it('no-self-overlap: an alive snake revisiting one of its own cells', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].segments[3] = { ...snapshot.snakes[0].segments[0] };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('no-self-overlap');
  });

  it('no-self-overlap does not fire for a dead snake’s frozen, coincidentally-equal segments', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].alive = false;
    snapshot.snakes[0].segments[3] = { ...snapshot.snakes[0].segments[0] };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).not.toContain('no-self-overlap');
  });

  it('length-matches-segments: length disagrees with segments.length', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].length = 99;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('length-matches-segments');
  });

  it('step-progress-range: stepProgress above 1', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].stepProgress = 1.5;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('step-progress-range');
  });

  it('step-progress-range: stepProgress below 0', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].stepProgress = -0.2;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('step-progress-range');
  });

  it('speed-multiplier-positive-finite: zero', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].speedMultiplier = 0;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('speed-multiplier-positive-finite');
  });

  it('speed-multiplier-positive-finite: Infinity', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].speedMultiplier = Infinity;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('speed-multiplier-positive-finite');
  });

  it('pending-growth-non-negative: negative pendingGrowth', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].pendingGrowth = -1;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('pending-growth-non-negative');
  });

  it('time-remaining-finite-non-negative: negative timeRemaining', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = -5;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('time-remaining-finite-non-negative');
  });

  it('time-remaining-finite-non-negative: NaN timeRemaining', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = NaN;
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('time-remaining-finite-non-negative');
  });

  it('no-head-in-dead-zone: a living head inside a shrunk safe square', () => {
    const snapshot = healthySnapshot();
    snapshot.lasers = { phase: 'CLOSING', inset: 5, insetCells: 5 };
    // Safe square is [5, 18] on both axes; (2, 12) is outside it.
    snapshot.snakes[0].segments[0] = { x: 2, y: 12 };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('no-head-in-dead-zone');
  });

  it('no-head-in-dead-zone does not fire for a dead snake’s head', () => {
    const snapshot = healthySnapshot();
    snapshot.lasers = { phase: 'CLOSING', inset: 5, insetCells: 5 };
    snapshot.snakes[0].alive = false;
    snapshot.snakes[0].segments[0] = { x: 2, y: 12 };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).not.toContain('no-head-in-dead-zone');
  });

  it('no-apple-under-snake: an apple on a living snake’s segment', () => {
    const snapshot = healthySnapshot();
    snapshot.apples[0] = { ...snapshot.snakes[0].segments[0] };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('no-apple-under-snake');
  });

  it('no-apple-under-snake does not fire for a dead snake’s corpse (core/round.js occupiedCells() excludes it)', () => {
    const snapshot = healthySnapshot();
    snapshot.snakes[0].alive = false;
    snapshot.apples[0] = { ...snapshot.snakes[0].segments[0] };
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).not.toContain('no-apple-under-snake');
  });

  it('apples-no-shared-row-or-column: two apples sharing a column, full-size arena', () => {
    const snapshot = healthySnapshot();
    snapshot.apples = [
      { x: 10, y: 5 },
      { x: 10, y: 9 },
    ];
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).toContain('apples-no-shared-row-or-column');
  });

  it('apples-no-shared-row-or-column is not checked once the lasers have moved in (#102’s own fallback ladder)', () => {
    const snapshot = healthySnapshot();
    snapshot.lasers = { phase: 'CLOSING', inset: 1, insetCells: 1 };
    snapshot.apples = [
      { x: 10, y: 5 },
      { x: 10, y: 9 },
    ];
    const problems = run(snapshot);
    expect(problems.map((p) => p.rule)).not.toContain('apples-no-shared-row-or-column');
  });

  it('hud-timer-agrees: the HUD is stale by more than the derived tolerance', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = 50; // floors to 50
    const hud = { ...healthyHud(), timerText: '0:53' }; // 3 s ahead of the truth
    const problems = run(snapshot, hud);
    expect(problems.map((p) => p.rule)).toContain('hud-timer-agrees');
  });

  it('hud-timer-agrees: the HUD shows less time than is actually left (wrong direction, always a defect)', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = 50;
    const hud = { ...healthyHud(), timerText: '0:40' };
    const problems = run(snapshot, hud);
    expect(problems.map((p) => p.rule)).toContain('hud-timer-agrees');
  });

  it('hud-timer-agrees allows exactly the derived tolerance (the throttle plus the floor, not more)', () => {
    const snapshot = healthySnapshot();
    snapshot.timeRemaining = 50;
    const hud = {
      ...healthyHud(),
      timerText: `0:${String(50 + HUD_TIMER_TOLERANCE_SECONDS).padStart(2, '0')}`,
    };
    expect(run(snapshot, hud).map((p) => p.rule)).not.toContain('hud-timer-agrees');
  });

  it('hud-lengths-agree: the HUD is behind by more than the derived tolerance', () => {
    const snapshot = healthySnapshot();
    const grown = 4 + HUD_LENGTH_TOLERANCE + 1;
    // Extend the tail so segments.length actually matches the new length — otherwise this would also (and
    // separately) trip length-matches-segments, which is not what this test is isolating.
    for (let x = 1; snapshot.snakes[0].segments.length < grown; x -= 1) {
      snapshot.snakes[0].segments.push({ x, y: 12 });
    }
    snapshot.snakes[0].length = grown;
    const problems = run(snapshot, { ...healthyHud(), p1Text: 'P1 4' });
    expect(problems.map((p) => p.rule)).toContain('hud-lengths-agree');
    expect(problems.map((p) => p.rule)).not.toContain('length-matches-segments');
  });

  it('hud-lengths-agree: the HUD shows more than the true length (wrong direction, always a defect)', () => {
    const snapshot = healthySnapshot();
    const hud = { ...healthyHud(), p1Text: 'P1 9' };
    const problems = run(snapshot, hud);
    expect(problems.map((p) => p.rule)).toContain('hud-lengths-agree');
  });

  it('hud-lengths-agree allows exactly the derived tolerance', () => {
    const snapshot = healthySnapshot();
    const hud = { ...healthyHud(), p1Text: `P1 ${4 - HUD_LENGTH_TOLERANCE}` };
    expect(run(snapshot, hud).map((p) => p.rule)).not.toContain('hud-lengths-agree');
  });
});

describe('KI-03-03 AC2 · the HUD tolerance is derived, not a magic number', () => {
  it('the timer tolerance is Math.ceil of the real HUD_INTERVAL_SECONDS, not a retyped literal', () => {
    expect(HUD_TIMER_TOLERANCE_SECONDS).toBe(Math.ceil(HUD_INTERVAL_SECONDS));
    // Pinned to what it evaluates to today so a silent change in either constant is visible here.
    expect(HUD_TIMER_TOLERANCE_SECONDS).toBe(1);
  });

  it('the length tolerance is derived from HUD_INTERVAL_SECONDS and the fastest possible grid step', () => {
    const fastestStepSeconds = 1 / (SETTINGS.snakeSpeed * SETTINGS.speedBoost.multiplier);
    expect(HUD_LENGTH_TOLERANCE).toBe(Math.max(1, Math.ceil(HUD_INTERVAL_SECONDS / fastestStepSeconds)));
    expect(HUD_LENGTH_TOLERANCE).toBe(1);
  });
});

describe('KI-03-03 (ruling 3) · checkInvariants has no free variables', () => {
  it('still works after being round-tripped through Function.prototype.toString(), exactly as the driver ships it into the page', () => {
    // `new Function` rather than `eval`, mirroring driver.js's own `compile` exactly — that is the point.
    const rehydrated = new Function('return (' + checkInvariants.toString() + ')')();
    const problems = rehydrated({
      snapshot: healthySnapshot(),
      hud: healthyHud(),
      state: 'PLAYING',
      config: baseConfig(),
    });
    expect(problems).toEqual([]);

    const brokenSnapshot = healthySnapshot();
    brokenSnapshot.snakes[0].pendingGrowth = -1;
    const brokenProblems = rehydrated({
      snapshot: brokenSnapshot,
      hud: healthyHud(),
      state: 'PLAYING',
      config: baseConfig(),
    });
    expect(brokenProblems.map((p) => p.rule)).toContain('pending-growth-non-negative');
  });
});
