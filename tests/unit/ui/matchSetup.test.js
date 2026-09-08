// @ts-check
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../../src/core/settings.js';
import { LEVELS } from '../../../src/game/bots/levels.js';
import {
  MIN_COLOUR_DIFFERENCE,
  worstCaseColourDifference,
} from '../../../src/render/colourVision.js';
import { snakeColorHex } from '../../../src/render/materials.js';
import {
  MUSIC_TRACKS,
  changeMatchLength,
  changeMusicTrack,
  changePlayerKind,
  checkColourSafety,
  controlsCardLabel,
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
  playerKinds: { 1: 'HUMAN', 2: 'HUMAN' },
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

/**
 * KI-12-04 · `changePlayerKind` — the switch itself. `DESIGN-DECISIONS §1` row 27 fixes the row's cycle order
 * (`HUMAN` first, then the three CPU levels) and its four approved value strings; `LEVELS` is imported from
 * `../../game/bots/levels.js` rather than retyped, so this test (and the row it proves) can never drift from
 * the level ids `session.js`'s own `policyForLevel` actually understands.
 */
describe('changePlayerKind — KI-12-04 the switch', () => {
  const CYCLE = ['HUMAN', ...Object.values(LEVELS)];

  it('KI-12-04 AC1: defaults to HUMAN for both players', () => {
    expect(BASE_SETTINGS.playerKinds).toEqual({ 1: 'HUMAN', 2: 'HUMAN' });
  });

  it('cycles player 1 forward through HUMAN -> CPU EASY -> CPU NORMAL -> CPU HARD -> HUMAN, in that order', () => {
    let settings = { ...BASE_SETTINGS, playerKinds: { 1: 'HUMAN', 2: 'HUMAN' } };
    for (const expected of [...CYCLE.slice(1), CYCLE[0]]) {
      settings = changePlayerKind(settings, 1, 1);
      expect(settings.playerKinds[1]).toBe(expected);
    }
  });

  it('cycles backward too', () => {
    const settings = { ...BASE_SETTINGS, playerKinds: { 1: 'HUMAN', 2: 'HUMAN' } };
    const prev = changePlayerKind(settings, 1, -1);
    expect(prev.playerKinds[1]).toBe(CYCLE[CYCLE.length - 1]);
  });

  it('cycling player 2 never touches player 1, and vice versa', () => {
    const settings = { ...BASE_SETTINGS, playerKinds: { 1: 'HUMAN', 2: 'HUMAN' } };
    const next = changePlayerKind(settings, 2, 1);
    expect(next.playerKinds).toEqual({ 1: 'HUMAN', 2: 'EASY' });

    const other = changePlayerKind(settings, 1, 1);
    expect(other.playerKinds).toEqual({ 1: 'EASY', 2: 'HUMAN' });
  });

  it('never touches colors, bestOf, powerUpsEnabled or musicTrack — a CPU still owns a colour', () => {
    const next = changePlayerKind(BASE_SETTINGS, 1, 1);
    expect(next.colors).toEqual(BASE_SETTINGS.colors);
    expect(next.bestOf).toBe(BASE_SETTINGS.bestOf);
    expect(next.powerUpsEnabled).toBe(BASE_SETTINGS.powerUpsEnabled);
    expect(next.musicTrack).toBe(BASE_SETTINGS.musicTrack);
  });

  it('returns a complete new matchSettings object, not a partial patch', () => {
    const next = changePlayerKind(BASE_SETTINGS, 1, 1);
    expect(next).not.toBe(BASE_SETTINGS);
    expect(next.playerKinds).not.toBe(BASE_SETTINGS.playerKinds);
  });
});

/**
 * KI-10-02: the controls card (`DESIGN-DECISIONS §3` "Controls card on match setup"). The copy is approved
 * verbatim; the colour word must come from the *live* `matchSettings.colors`, never a hardcoded literal,
 * because this card sits on the very screen that changes those colours (§2.7's swap rule).
 */
describe('controlsCardLabel — KI-10-02', () => {
  it('KI-10-02 AC1: at the shipping defaults renders the approved copy exactly, character for character', () => {
    // Verbatim strings from DESIGN-DECISIONS §3 — do not paraphrase these in the test either.
    expect(controlsCardLabel(1, 'red')).toBe('PLAYER 1 · RED — W A S D');
    expect(controlsCardLabel(2, 'blue')).toBe('PLAYER 2 · BLUE — ARROW KEYS');
  });

  it('KI-10-02: follows a colour change instead of staying on a stale literal', () => {
    // Same player, same keys — only the live colour word changes, proving the label is derived from
    // `matchSettings.colors` and not a hardcoded "RED"/"BLUE".
    expect(controlsCardLabel(1, 'green')).toBe('PLAYER 1 · GREEN — W A S D');
    expect(controlsCardLabel(2, 'red')).toBe('PLAYER 2 · RED — ARROW KEYS');
  });

  it('KI-10-02 AC2: names the player in words, not only via colour', () => {
    expect(controlsCardLabel(1, 'red')).toContain('PLAYER 1');
    expect(controlsCardLabel(2, 'blue')).toContain('PLAYER 2');
  });

  it("KI-10-02 AC1: names each player's own keys", () => {
    expect(controlsCardLabel(1, 'red')).toContain('W A S D');
    expect(controlsCardLabel(2, 'blue')).toContain('ARROW KEYS');
  });

  it('KI-12-04: a computer player reads "CPU" instead of a key list — the ticket spec, verbatim', () => {
    expect(controlsCardLabel(1, 'red', true)).toBe('PLAYER 1 · RED — CPU');
    expect(controlsCardLabel(2, 'blue', true)).toBe('PLAYER 2 · BLUE — CPU');
  });

  it('KI-12-04: `isCpu` defaults to false — every pre-existing two-argument call keeps its exact behaviour', () => {
    expect(controlsCardLabel(1, 'red')).toBe(controlsCardLabel(1, 'red', false));
    expect(controlsCardLabel(2, 'blue')).toBe(controlsCardLabel(2, 'blue', false));
  });
});

/**
 * KI-15-02 · `checkColourSafety` (issue #192, from KI-15-01/#191, tracked on #184). Pure-function proof that
 * the check and the "nearest passing alternative" computation are correct, independent of any DOM — the same
 * split `pickPlayerColor`'s own tests above already establish for this file. Every assertion here binds to
 * `failing`/`recommendedColor`, never to `COLOUR_NOTE_COPY`'s sentence, which is provisional pending #184
 * (`matchSetup.js`'s own doc comment on that constant).
 */
describe('checkColourSafety — KI-15-02 AC1', () => {
  it('KI-15-02 AC1: a passing pair (the shipping default, red/blue) reports no note', () => {
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'blue' } };
    const result = checkColourSafety(matchSettings, ['red', 'blue']);
    expect(result).toEqual({ failing: false, recommendedColor: null });
  });

  it("KI-15-02 AC1: a failing pair (red/green, KI-15-01's own recorded waiver at 9.88) reports the note", () => {
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'green' } };
    // The same instrument the note is built on, asserted directly so this test cannot silently drift from
    // what `checkColourSafety` actually measures.
    expect(
      worstCaseColourDifference(snakeColorHex('red', SETTINGS), snakeColorHex('green', SETTINGS)),
    ).toBeLessThan(MIN_COLOUR_DIFFERENCE);

    const result = checkColourSafety(matchSettings, ['red', 'blue', 'green']);
    expect(result.failing).toBe(true);
  });

  it('KI-15-02: the recommended colour is the best-separated owned alternative that actually passes, not merely the first one tried', () => {
    // Owned pool deliberately includes a colour worse than the eventual answer (`green`, which itself fails
    // against red) so "first owned colour other than mine" would get this wrong.
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'green' } };
    const result = checkColourSafety(matchSettings, ['red', 'blue', 'green']);
    expect(result.failing).toBe(true);
    expect(result.recommendedColor).toBe('blue');
  });

  it('KI-15-02: recommends nothing — not a fallback — when no owned colour clears the check', () => {
    // Only `red` and `green` owned, and `red`/`green` is itself the failing pair: there is no alternative to
    // recommend, and the ticket is explicit that this case invents none.
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'green' } };
    const result = checkColourSafety(matchSettings, ['red', 'green']);
    expect(result).toEqual({ failing: true, recommendedColor: null });
  });

  it("KI-15-02: only the *landing* colour matters — player 1's own colour is never recommended to player 2", () => {
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'red', 2: 'green' } };
    const result = checkColourSafety(matchSettings, ['red', 'blue', 'green', 'orange']);
    expect(result.recommendedColor).not.toBe('red');
  });

  it('KI-15-02: prove the check can go red — a pair just under the threshold is rejected by construction', () => {
    // `gold`/`yellow`, the worst pair unwaived at 4.29 (`colourVision.test.js`), run through this file's own
    // wrapper rather than the rule test's — proves `checkColourSafety` itself, not only `colourVision.js`,
    // can report `failing: true`.
    const matchSettings = { ...BASE_SETTINGS, colors: { 1: 'gold', 2: 'yellow' } };
    expect(checkColourSafety(matchSettings, ['gold', 'yellow']).failing).toBe(true);
  });
});
