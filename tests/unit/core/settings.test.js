// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/**
 * KS-02-01's `Files:` list did not name a settings test file, but AC4 ("SETTINGS is frozen; mutation throws
 * in strict mode") is a settings.js concern with nowhere else to live — this file is a declared deviation,
 * called out in the PR description.
 */
describe('KS-02-01 settings', () => {
  it('KS-02-01 AC4: SETTINGS is frozen; a top-level mutation throws in strict mode', () => {
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.snakeSpeed = 999)).toThrow(TypeError);
  });

  it('KS-02-01 AC4: SETTINGS is deep-frozen; nested object mutation throws too', () => {
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.grid.width = 6)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.speedBoost.multiplier = 2)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.slow.duration = 1)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.crashSlowMo.scale = 1)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.rewards[1] = 5)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.colors.red = '#000000')).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.shopPrices.gold = 1)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (SETTINGS.camera.fov = 90)).toThrow(TypeError);
    expect(() => SETTINGS.bestOfOptions.push(7)).toThrow(TypeError);
  });

  it('KS-02-01: SETTINGS matches DESIGN-DECISIONS §4 exactly, including the §2.7 colour catalogue', () => {
    expect(SETTINGS.grid).toEqual({ width: 24, height: 24 });
    expect(SETTINGS.simHz).toBe(120);
    expect(SETTINGS.roundDuration).toBe(90);
    expect(SETTINGS.snakeSpeed).toBe(6);
    expect(SETTINGS.startingSnakeLength).toBe(4);
    expect(SETTINGS.inputBufferSize).toBe(2);
    expect(SETTINGS.foodCount).toBe(4);
    expect(SETTINGS.bestOfOptions).toEqual([1, 3, 5]);
    expect(SETTINGS.rewards).toEqual({ 1: 0, 3: 1, 5: 2 });
    expect(SETTINGS.colors).toEqual({
      red: '#E3261B',
      blue: '#1F6FE5',
      green: '#2FB44B',
      yellow: '#F6C21B',
      orange: '#F27A1A',
      purple: '#8A3FD1',
      teal: '#12B5B0',
      gold: '#E8B028',
    });
    expect(SETTINGS.shopPrices).toEqual({
      green: 2,
      yellow: 2,
      orange: 3,
      purple: 3,
      teal: 3,
      gold: 6,
    });
    expect(SETTINGS.camera).toEqual({ fov: 32, pitchDegrees: 78, margin: 1.5 });
  });

  it('KS-02-01: withOverrides deep-merges a partial nested override without dropping siblings', () => {
    const scenario = withOverrides({ grid: { width: 6, height: 6 } });
    expect(scenario.grid).toEqual({ width: 6, height: 6 });
    // Every sibling top-level key is untouched.
    expect(scenario.snakeSpeed).toBe(SETTINGS.snakeSpeed);
    expect(scenario.colors).toEqual(SETTINGS.colors);
  });

  it('KS-02-01: withOverrides leaves SETTINGS itself untouched', () => {
    withOverrides({ grid: { width: 6, height: 6 } });
    expect(SETTINGS.grid).toEqual({ width: 24, height: 24 });
  });

  it('KS-02-01: withOverrides returns a new, independently frozen object', () => {
    const scenario = withOverrides({ snakeSpeed: 3 });
    expect(scenario).not.toBe(SETTINGS);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (scenario.snakeSpeed = 4)).toThrow(TypeError);
    // @ts-expect-error intentional mutation of a frozen object, to prove it throws
    expect(() => (scenario.grid.width = 4)).toThrow(TypeError);
  });

  it('KS-02-01: withOverrides on a nested key not touched by the override keeps that whole sub-object', () => {
    const scenario = withOverrides({ speedBoost: { duration: 10 } });
    expect(scenario.speedBoost).toEqual({
      multiplier: SETTINGS.speedBoost.multiplier,
      duration: 10,
    });
  });
});
