// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../../src/core/settings.js';
import {
  MUSIC_TRACKS,
  changeMatchLength,
  changeMusicTrack,
  pickPlayerColor,
  togglePowerUps,
} from '../../../src/ui/screens/matchSetup.js';

/**
 * KS-05-04 AC3 ("Choosing the same colour for both players swaps them", `DESIGN-DECISIONS §2.7`) and the row
 * value-cycling behind it. Not on this ticket's own `Files:` list — a deviation called out in the PR
 * description, same as `tests/unit/ui/hud.test.js` was for KS-04-03 — because the tech-lead contract asks for
 * the swap rule to be "proven with a test" (note D), and these functions are exported specifically so that
 * proof does not need a DOM.
 */

/** @type {import('../../../src/ui/screens/matchSetup.js').MatchSettings} */
const BASE_SETTINGS = {
  bestOf: 3,
  powerUpsEnabled: true,
  musicTrack: MUSIC_TRACKS[0],
  colors: { 1: 'red', 2: 'blue' },
};

describe('pickPlayerColor — KS-05-04 AC3 colour swap rule', () => {
  it('picking the colour the other player holds swaps the two', () => {
    const next = pickPlayerColor(BASE_SETTINGS, 1, ['red', 'blue'], 1);
    // P1 cycles from red to the only other owned colour, blue — which P2 already holds — so they swap.
    expect(next.colors).toEqual({ 1: 'blue', 2: 'red' });
  });

  it('the two players are never left on the same colour, in either direction', () => {
    const forward = pickPlayerColor(BASE_SETTINGS, 1, ['red', 'blue'], 1);
    expect(forward.colors[1]).not.toBe(forward.colors[2]);
    const backward = pickPlayerColor(BASE_SETTINGS, 1, ['red', 'blue'], -1);
    expect(backward.colors[1]).not.toBe(backward.colors[2]);
  });

  it('cycling player 2 instead swaps the two the same way', () => {
    const next = pickPlayerColor(BASE_SETTINGS, 2, ['red', 'blue'], 1);
    expect(next.colors).toEqual({ 1: 'blue', 2: 'red' });
  });

  it('cycling P1 through every owned colour never produces a duplicate at any intermediate step', () => {
    const ownedColors = ['red', 'blue', 'green', 'yellow'];
    let settings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'blue' } };
    for (let i = 0; i < ownedColors.length * 3; i += 1) {
      settings = pickPlayerColor(settings, 1, ownedColors, 1);
      expect(settings.colors[1]).not.toBe(settings.colors[2]);
    }
  });

  it('cycling to a colour nobody else holds does not touch the other player', () => {
    const ownedColors = ['red', 'blue', 'green'];
    const settings = { ...BASE_SETTINGS, colors: { 1: 'blue', 2: 'red' } };
    const next = pickPlayerColor(settings, 1, ownedColors, 1);
    // blue -> green (the next owned colour after blue), which nobody else holds: P2 unaffected.
    expect(next.colors[1]).toBe('green');
    expect(next.colors[2]).toBe('red');
  });

  it('returns a complete new matchSettings object, not a partial patch', () => {
    const next = pickPlayerColor(BASE_SETTINGS, 1, ['red', 'blue'], 1);
    expect(next.bestOf).toBe(BASE_SETTINGS.bestOf);
    expect(next.powerUpsEnabled).toBe(BASE_SETTINGS.powerUpsEnabled);
    expect(next.musicTrack).toBe(BASE_SETTINGS.musicTrack);
  });
});

describe('changeMatchLength', () => {
  it('cycles through SETTINGS.bestOfOptions, never a hand-rolled list', () => {
    let settings = { ...BASE_SETTINGS, bestOf: SETTINGS.bestOfOptions[0] };
    for (const expected of SETTINGS.bestOfOptions.slice(1)) {
      settings = changeMatchLength(settings, 1);
      expect(settings.bestOf).toBe(expected);
    }
    // One more step wraps back to the first option.
    settings = changeMatchLength(settings, 1);
    expect(settings.bestOf).toBe(SETTINGS.bestOfOptions[0]);
  });

  it('cycles backward too', () => {
    const settings = { ...BASE_SETTINGS, bestOf: SETTINGS.bestOfOptions[0] };
    const prev = changeMatchLength(settings, -1);
    expect(prev.bestOf).toBe(SETTINGS.bestOfOptions[SETTINGS.bestOfOptions.length - 1]);
  });
});

describe('togglePowerUps', () => {
  it('flips the boolean regardless of direction', () => {
    expect(togglePowerUps({ ...BASE_SETTINGS, powerUpsEnabled: true }).powerUpsEnabled).toBe(false);
    expect(togglePowerUps({ ...BASE_SETTINGS, powerUpsEnabled: false }).powerUpsEnabled).toBe(true);
  });
});

describe('changeMusicTrack', () => {
  it('cycles through all three tracks and wraps around', () => {
    let settings = { ...BASE_SETTINGS, musicTrack: MUSIC_TRACKS[0] };
    for (const expected of MUSIC_TRACKS.slice(1)) {
      settings = changeMusicTrack(settings, 1);
      expect(settings.musicTrack).toBe(expected);
    }
    settings = changeMusicTrack(settings, 1);
    expect(settings.musicTrack).toBe(MUSIC_TRACKS[0]);
  });
});
