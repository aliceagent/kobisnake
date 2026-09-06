// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import {
  DEFAULT_SLOW_TARGET_MODE,
  LASER_START_TIME_PRESETS,
  LASER_STEP_INTERVAL_PRESETS,
  SLOW_TARGET_MODES,
  SPEED_BOOST_PRESETS,
  TUNABLES,
  buildSettingsOverride,
  defaultTuningValues,
} from '../../../src/game/tuning.js';

/**
 * KS-07-01 tuning build: `src/game/tuning.js`'s own data and pure functions, proved in Node without a
 * browser (the module doc comment's whole reason for existing outside `src/ui/screens/tuning.js`). The
 * overlay's DOM behaviour itself is proved by `tests/e2e/tuning.spec.js` (declared in the PR description).
 */

describe('KS-07-01 tuning.js', () => {
  it('AC1: every tunable is a real, distinct SETTINGS path with min <= max', () => {
    const keys = TUNABLES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const tunable of TUNABLES) {
      expect(tunable.min).toBeLessThanOrEqual(tunable.max);
      expect(tunable.step).toBeGreaterThan(0);
      // Every path must actually resolve on the shipping SETTINGS — a typo in a path would otherwise read
      // `undefined` forever and nobody would notice until the overlay drew a broken slider.
      const value = tunable.key
        .split('.')
        .reduce(/** @param {any} node @param {string} key */ (node, key) => node[key], SETTINGS);
      expect(typeof value).toBe('number');
    }
  });

  it("AC1: the ticket's own tunable list is present verbatim", () => {
    expect(new Set(TUNABLES.map((t) => t.key))).toEqual(
      new Set([
        'snakeSpeed',
        'laserStartTime',
        'laserStepInterval',
        'laserMinArena',
        'powerUpInterval',
        'speedBoost.multiplier',
        'speedBoost.duration',
        'slow.multiplier',
        'slow.duration',
        'inputBufferSize',
        'foodCount',
        'growthPerFood',
      ]),
    );
  });

  it('AC1: defaultTuningValues() reads every tunable straight off SETTINGS, plus the default SLOW mode', () => {
    const values = defaultTuningValues();
    expect(values.snakeSpeed).toBe(SETTINGS.snakeSpeed);
    expect(values.laserStartTime).toBe(SETTINGS.laserStartTime);
    expect(values['speedBoost.multiplier']).toBe(SETTINGS.speedBoost.multiplier);
    expect(values['speedBoost.duration']).toBe(SETTINGS.speedBoost.duration);
    expect(values['slow.multiplier']).toBe(SETTINGS.slow.multiplier);
    expect(values['slow.duration']).toBe(SETTINGS.slow.duration);
    expect(values.slowTargetMode).toBe(DEFAULT_SLOW_TARGET_MODE);
  });

  it('AC1: defaultTuningValues(settings) reads off an arbitrary settings object too, not only SETTINGS', () => {
    const overridden = withOverrides({ snakeSpeed: 9, laserStartTime: 25 });
    const values = defaultTuningValues(overridden);
    expect(values.snakeSpeed).toBe(9);
    expect(values.laserStartTime).toBe(25);
  });

  it('AC1: buildSettingsOverride nests speedBoost/slow correctly and always stamps slow.targetMode', () => {
    const values = defaultTuningValues();
    values.snakeSpeed = 8;
    values['speedBoost.multiplier'] = 1.35;
    values['speedBoost.duration'] = 4;
    values.slowTargetMode = 'collector';

    const overrides = buildSettingsOverride(values);

    expect(overrides.snakeSpeed).toBe(8);
    expect(overrides.speedBoost).toEqual({ multiplier: 1.35, duration: 4 });
    expect(overrides.slow).toEqual({
      multiplier: SETTINGS.slow.multiplier,
      duration: SETTINGS.slow.duration,
      targetMode: 'collector',
    });
    expect(overrides.laserStartTime).toBe(SETTINGS.laserStartTime);
  });

  it('AC2: an override tree built from the untouched defaults, applied via withOverrides, changes nothing observable', () => {
    // The replay recorder (session.js) always stamps the *whole* tree, even when a human touched nothing —
    // this proves that round-trip is a no-op for every field but the new `slow.targetMode` key, which has no
    // shipping counterpart to compare against by construction.
    const settings = withOverrides(buildSettingsOverride(defaultTuningValues()));
    for (const tunable of TUNABLES) {
      const path = tunable.key.split('.');
      const read = /** @param {any} node */ (node) => path.reduce((n, key) => n[key], node);
      expect(read(settings)).toBe(read(SETTINGS));
    }
  });

  it("AC1: SLOW_TARGET_MODES is exactly the GDD's three options, default first", () => {
    expect(SLOW_TARGET_MODES).toEqual(['everyone-but-collector', 'opponent', 'collector']);
    expect(SLOW_TARGET_MODES).toContain(DEFAULT_SLOW_TARGET_MODE);
  });

  it("tech-lead note 2: laser start/step presets are exactly session 2's variants", () => {
    expect(LASER_START_TIME_PRESETS).toEqual([25, 30, 35]);
    expect(LASER_STEP_INTERVAL_PRESETS).toEqual([2, 2.5, 3]);
  });

  it('tech-lead note 2: the Speed Boost pair is 1.5x/5s (shipping) vs 1.35x/4s, one preset each', () => {
    expect(SPEED_BOOST_PRESETS).toHaveLength(2);
    expect(SPEED_BOOST_PRESETS[0]).toMatchObject({ multiplier: 1.5, duration: 5 });
    expect(SPEED_BOOST_PRESETS[1]).toMatchObject({ multiplier: 1.35, duration: 4 });
    // The first preset is what SETTINGS already ships, so a human hitting it back-to-back with the second
    // is really comparing shipping against the alternative, not two arbitrary numbers.
    expect(SPEED_BOOST_PRESETS[0].multiplier).toBe(SETTINGS.speedBoost.multiplier);
    expect(SPEED_BOOST_PRESETS[0].duration).toBe(SETTINGS.speedBoost.duration);
  });
});
