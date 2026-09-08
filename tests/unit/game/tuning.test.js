// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import {
  DEFAULT_SLOW_TARGET_MODE,
  LASER_START_TIME_PRESETS,
  LASER_STEP_INTERVAL_PRESETS,
  PACING_PRESETS,
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

  // --- KI-04-03: the pacing presets (#229, DESIGN-DECISIONS §1 row 30) ---

  it('KI-04-03: the pacing chips are exactly the two I04 candidates plus shipping, labelled as ruled', () => {
    expect(PACING_PRESETS.map((preset) => preset.label)).toEqual([
      'round 75 s',
      'laser at 0:40',
      '90 s / 0:30 (shipping)',
    ]);
  });

  it('KI-04-03: each pacing chip moves exactly one lever off shipping', () => {
    // This is what makes the three a controlled comparison rather than three unrelated configurations: a
    // human clicking between them changes one thing at a time, which is the whole question §5 A2 asks.
    const [round75, laser40, shipping] = PACING_PRESETS;

    expect(round75).toMatchObject({ roundDuration: 75, laserStartTime: SETTINGS.laserStartTime });
    expect(laser40).toMatchObject({ roundDuration: SETTINGS.roundDuration, laserStartTime: 40 });
    expect(shipping).toMatchObject({
      roundDuration: SETTINGS.roundDuration,
      laserStartTime: SETTINGS.laserStartTime,
    });
  });

  it('KI-04-03: the shipping chip label describes the values it actually carries', () => {
    // The label is fixed text the design lead specified and `PLAYTEST-SCRIPT §5` names, but the values are
    // read from SETTINGS — so if settings.js ever changes, this fails loudly rather than the chip lying to
    // the humans running the session.
    const shipping = PACING_PRESETS[2];
    expect(shipping.label).toBe(
      `${shipping.roundDuration} s / 0:${shipping.laserStartTime} (shipping)`,
    );
  });

  it('KI-04-03: laser at 0:40 is an EARLIER warning than shipping, not a later one', () => {
    // `laserStartTime` counts seconds *remaining*, so a larger number is earlier. KI-04-01 found the ticket's
    // own 20/25 swept this backwards; the chip must not repeat that mistake.
    expect(PACING_PRESETS[1].laserStartTime).toBeGreaterThan(SETTINGS.laserStartTime);
  });

  it('KI-04-03: no chip is the ruled-out laserStartTime 20 s cliff', () => {
    // Ruled out on #229 on KI-04-01's numbers: at 20 s the lasers stall at inset 7 and 80 % of careful
    // rounds end by timeout. It must not reach a human session as a one-click option.
    for (const preset of PACING_PRESETS) expect(preset.laserStartTime).not.toBe(20);
  });

  it('KI-04-03: roundDuration reaches the override tree even though it has no slider', () => {
    const values = defaultTuningValues();
    expect(values.roundDuration).toBe(SETTINGS.roundDuration);

    values.roundDuration = 75;
    expect(buildSettingsOverride(values).roundDuration).toBe(75);
  });

  it('KI-04-03: each pacing chip, applied, produces exactly the settings it names', () => {
    // The whole path a chip travels: flat state -> override tree -> withOverrides -> the settings a round is
    // built from. Nothing else in SETTINGS may move with it.
    for (const preset of PACING_PRESETS) {
      const values = defaultTuningValues();
      values.roundDuration = preset.roundDuration;
      values.laserStartTime = preset.laserStartTime;

      const settings = withOverrides(buildSettingsOverride(values));
      expect(settings.roundDuration).toBe(preset.roundDuration);
      expect(settings.laserStartTime).toBe(preset.laserStartTime);
      expect(settings.snakeSpeed).toBe(SETTINGS.snakeSpeed);
      expect(settings.foodCount).toBe(SETTINGS.foodCount);
      expect(settings.laserStepInterval).toBe(SETTINGS.laserStepInterval);
      expect(settings.laserMinArena).toBe(SETTINGS.laserMinArena);
    }
  });

  it('KI-04-03: buildSettingsOverride falls back to shipping when values carries no roundDuration', () => {
    const values = defaultTuningValues();
    delete (/** @type {Record<string, unknown>} */ (values).roundDuration);
    expect(buildSettingsOverride(values).roundDuration).toBe(SETTINGS.roundDuration);
  });

  it('KI-04-03: the shipping chip round-trips to settings identical to SETTINGS on both levers', () => {
    const values = defaultTuningValues();
    const settings = withOverrides(buildSettingsOverride(values));
    expect(settings.roundDuration).toBe(SETTINGS.roundDuration);
    expect(settings.laserStartTime).toBe(SETTINGS.laserStartTime);
  });
});
