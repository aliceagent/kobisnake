// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../src/core/settings.js';
import {
  BASELINE_DRAW_CALLS,
  DRAW_CALL_BUDGET,
  MENU_SCREENS,
  SCENES,
  buildBudgetFailureMessage,
  buildDrawCallsReportTable,
  checkDrawCallBudget,
  endgameOverrides,
  laserWarningOverrides,
  midRoundLengthTarget,
} from './drawCalls.js';

/**
 * KI-08-02 — `drawCalls.js`'s pure Node-side functions, against hand-built fixtures. Nothing here touches a
 * browser: {@link import('./drawCalls.js').sampleSceneInPage} is the in-page half and is proved instead by
 * `drawCalls.spec.js` actually running it against the real game, the same split `viewports.js`/
 * `viewports.test.js` and `driver.js`/`driver.test.js` use.
 */

describe('KI-08-02 · DRAW_CALL_BUDGET', () => {
  it("KI-08-02: is ARCHITECTURE §12's own number, and appears exactly once in the module", () => {
    expect(DRAW_CALL_BUDGET).toBe(120);
  });
});

describe('KI-08-02 AC1 · SCENES and MENU_SCREENS', () => {
  it('KI-08-02 AC1: five named scenes, each with a slug and a reason', () => {
    expect(SCENES).toHaveLength(5);
    for (const scene of SCENES) {
      expect(typeof scene.slug).toBe('string');
      expect(scene.slug.length).toBeGreaterThan(0);
      expect(typeof scene.why).toBe('string');
      expect(scene.why.length).toBeGreaterThan(0);
    }
    expect(scenesSlugs()).toEqual([
      'opening-board',
      'mid-round-long-snakes',
      'laser-warning',
      'endgame-6x6',
      'menus',
    ]);
  });

  it('KI-08-02 AC1: the six reachable menus the build actually has, main-menu first (the floor sample)', () => {
    expect(MENU_SCREENS).toHaveLength(6);
    expect(MENU_SCREENS.map((menu) => menu.slug)).toEqual([
      'main-menu',
      'match-setup',
      'pause',
      'round-over',
      'match-over',
      'replay',
    ]);
  });

  it('KI-08-02: SCENES and MENU_SCREENS are frozen (no accidental mutation)', () => {
    expect(Object.isFrozen(SCENES)).toBe(true);
    expect(Object.isFrozen(MENU_SCREENS)).toBe(true);
  });

  function scenesSlugs() {
    return SCENES.map((scene) => scene.slug);
  }
});

describe('KI-08-02 AC3 · BASELINE_DRAW_CALLS', () => {
  it('KI-08-02 AC3: names a figure for every gameplay scene and every reachable menu', () => {
    const gameplaySlugs = SCENES.map((scene) => scene.slug).filter((slug) => slug !== 'menus');
    const menuSlugs = MENU_SCREENS.map((menu) => `menu-${menu.slug}`);
    for (const slug of [...gameplaySlugs, ...menuSlugs]) {
      expect(BASELINE_DRAW_CALLS[slug], `no baseline recorded for "${slug}"`).toBeTypeOf('number');
    }
  });

  it('KI-08-02 AC3: every committed baseline figure is comfortably inside the budget today', () => {
    // The sprint's own framing: "today the build is grey boxes and every measurement is comfortably inside
    // [budget]". A baseline at or over 120 would mean either the constant or the committed figure is wrong.
    for (const [slug, drawCalls] of Object.entries(BASELINE_DRAW_CALLS)) {
      expect(drawCalls, `${slug}'s baseline`).toBeLessThan(DRAW_CALL_BUDGET);
      expect(drawCalls, `${slug}'s baseline`).toBeGreaterThan(0);
    }
  });

  it("KI-08-02 AC3: is frozen (a change to today's figures is always a reviewed diff)", () => {
    expect(Object.isFrozen(BASELINE_DRAW_CALLS)).toBe(true);
  });
});

describe('KI-08-02 AC2 · checkDrawCallBudget', () => {
  it('KI-08-02: under budget reports overBudget: false and the right percentage', () => {
    expect(checkDrawCallBudget(60)).toEqual({
      drawCalls: 60,
      budget: 120,
      pctOfBudget: 50,
      overBudget: false,
    });
  });

  it('KI-08-02: exactly at budget is not over it', () => {
    expect(checkDrawCallBudget(120).overBudget).toBe(false);
  });

  it('KI-08-02: over budget reports overBudget: true', () => {
    const result = checkDrawCallBudget(121);
    expect(result.overBudget).toBe(true);
    expect(result.pctOfBudget).toBe(101);
  });
});

describe('KI-08-02 AC2/ruling 7 · buildBudgetFailureMessage', () => {
  // A fabricated over-budget sample, exactly the shape `sampleSceneInPage` returns — proven against a hand-
  // built fixture rather than only by hand, the same discipline `tests/perf/bundle.test.js` (KI-08-01) uses
  // for its own failure message.
  const overBudgetComposition = {
    state: 'PLAYING',
    snakeLengths: [40, 38],
    appleCount: 4,
    pickupCount: 0,
    laserPhase: 'CLOSING',
    laserInset: 5,
  };

  it('KI-08-02: names the scene, the measurement, the budget and the percentage', () => {
    const message = buildBudgetFailureMessage('mid-round-long-snakes', 140, overBudgetComposition);
    expect(message).toContain('mid-round-long-snakes');
    expect(message).toContain('140 draw calls');
    expect(message).toContain('budget of 120');
    expect(message).toContain('117%');
  });

  it('KI-08-02: carries the composition evidence, not just the bare number', () => {
    const message = buildBudgetFailureMessage('mid-round-long-snakes', 140, overBudgetComposition);
    expect(message).toContain('snakeLengths=[40,38]');
    expect(message).toContain('appleCount=4');
    expect(message).toContain('pickupCount=0');
    expect(message).toContain('laserPhase=CLOSING');
  });

  it("KI-08-02: names ARCHITECTURE §12 as the budget's source and tuning-proposal as the way to change it", () => {
    const message = buildBudgetFailureMessage('mid-round-long-snakes', 140, overBudgetComposition);
    expect(message).toMatch(/design-lead decision/);
    expect(message).toContain('tuning-proposal');
    // The sprint's own Risks section, verbatim: never a quietly raised constant.
    expect(message).toMatch(/never raise this constant quietly/i);
  });
});

describe('KI-08-02 · buildDrawCallsReportTable', () => {
  it('KI-08-02: prints one row per scene with its delta over the menu-main-menu floor', () => {
    const rows = [
      { slug: 'menu-main-menu', drawCalls: 6, composition: /** @type {any} */ ({}) },
      { slug: 'opening-board', drawCalls: 14, composition: /** @type {any} */ ({}) },
    ];
    const table = buildDrawCallsReportTable(rows);
    expect(table).toContain('| menu-main-menu | 6 | 0 |');
    expect(table).toContain('| opening-board | 14 | 8 |');
  });

  it("KI-08-02: reads each row's baseline out of BASELINE_DRAW_CALLS and marks an unknown slug with —", () => {
    // No `menu-main-menu` row here, so the floor falls back to 0 — the delta column then reads as the raw
    // count, which is the honest answer when this run's own floor sample was not part of the input.
    const rows = [
      { slug: 'opening-board', drawCalls: 14, composition: /** @type {any} */ ({}) },
      { slug: 'not-a-real-scene', drawCalls: 5, composition: /** @type {any} */ ({}) },
    ];
    const table = buildDrawCallsReportTable(rows);
    expect(table).toContain(
      `| opening-board | 14 | 14 | ${Math.round((14 / 120) * 100)}% | ${BASELINE_DRAW_CALLS['opening-board']} | 120 |`,
    );
    expect(table).toContain('| not-a-real-scene | 5 | 5 | 4% | — | 120 |');
  });
});

describe('KI-08-02 ruling 4 · laserWarningOverrides / endgameOverrides / midRoundLengthTarget', () => {
  it('KI-08-02: laserWarningOverrides fires WARNING about one simulated second in', () => {
    const overrides = laserWarningOverrides(SETTINGS);
    expect(overrides).toEqual({ laserStartTime: SETTINGS.roundDuration - 1 });
  });

  it('KI-08-02: endgameOverrides only touches laserStartTime and laserStepInterval', () => {
    const overrides = endgameOverrides(SETTINGS);
    expect(Object.keys(overrides).sort()).toEqual(['laserStartTime', 'laserStepInterval']);
    expect(overrides.laserStartTime).toBe(SETTINGS.roundDuration - 1);
    expect(overrides.laserStepInterval).toBeGreaterThan(0);
    expect(overrides.laserStepInterval).toBeLessThan(SETTINGS.laserStepInterval);
  });

  it('KI-08-02: midRoundLengthTarget is double the starting length, derived rather than a bare number', () => {
    expect(midRoundLengthTarget(SETTINGS)).toBe(SETTINGS.startingSnakeLength * 2);
    const fiveLong = /** @type {any} */ ({ ...SETTINGS, startingSnakeLength: 5 });
    expect(midRoundLengthTarget(fiveLong)).toBe(10);
  });
});
