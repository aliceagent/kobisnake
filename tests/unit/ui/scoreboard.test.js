// @ts-check
import { describe, expect, it } from 'vitest';
import { DRAW_TEXT, DRAW_WARNING_TEXT, buildScoreboardLines } from '../../../src/ui/screens/scoreboard.js';

/**
 * The between-round scoreboard's exact text format (`DESIGN-DECISIONS §3`: "BEST OF 5 / Blue: 2 wins /
 * Red: 1 win / Blue needs 1 more win"). Not on this ticket's `Files:` list — a deviation called out in the
 * PR description, same as `tests/unit/ui/hud.test.js` was for KS-04-03 — because the tech-lead contract asks
 * specifically for the singular/plural wording and the exact draw text to be right, and `buildScoreboardLines`
 * is exported precisely so that can be proven without a DOM.
 *
 * KI-01-02 extends this file the same way, and for the same reason: the warning that fires on the last replay
 * before the draw cap (`DESIGN-DECISIONS §1` row 26) is copy on the exact same pure, DOM-free function, so it
 * belongs beside the tests already here rather than in a new file.
 */

describe('buildScoreboardLines', () => {
  it('matches the GDD example format exactly', () => {
    const lines = buildScoreboardLines({
      bestOf: 5,
      result: 'P1_WIN',
      wins: { 1: 2, 2: 1 },
      winsNeeded: { 1: 1, 2: 2 },
      colorNames: { 1: 'blue', 2: 'red' },
    });
    expect(lines).toEqual(['BEST OF 5', 'Blue: 2 wins', 'Red: 1 win', 'Blue needs 1 more win']);
  });

  it('singular win / plural wins is right on both the tally and the needs line', () => {
    const lines = buildScoreboardLines({
      bestOf: 3,
      result: 'P2_WIN',
      wins: { 1: 1, 2: 1 },
      winsNeeded: { 1: 1, 2: 1 },
      colorNames: { 1: 'red', 2: 'blue' },
    });
    expect(lines).toEqual(['BEST OF 3', 'Red: 1 win', 'Blue: 1 win', 'Blue needs 1 more win']);
  });

  it('pluralises "2 more wins" correctly', () => {
    const lines = buildScoreboardLines({
      bestOf: 5,
      result: 'P2_WIN',
      wins: { 1: 0, 2: 1 },
      winsNeeded: { 1: 3, 2: 2 },
      colorNames: { 1: 'red', 2: 'blue' },
    });
    expect(lines[3]).toBe('Blue needs 2 more wins');
  });

  it('a P1 win names player 1 on the needs line, not player 2', () => {
    const lines = buildScoreboardLines({
      bestOf: 3,
      result: 'P1_WIN',
      wins: { 1: 2, 2: 0 },
      winsNeeded: { 1: 0, 2: 2 },
      colorNames: { 1: 'green', 2: 'yellow' },
    });
    expect(lines[3]).toBe('Green needs 0 more wins');
  });

  it('a DRAW shows the exact text "DRAW — REPLAY" instead of a winner line', () => {
    const lines = buildScoreboardLines({
      bestOf: 5,
      result: 'DRAW',
      wins: { 1: 1, 2: 1 },
      winsNeeded: { 1: 2, 2: 2 },
      colorNames: { 1: 'blue', 2: 'red' },
    });
    expect(lines).toEqual(['BEST OF 5', 'Blue: 1 win', 'Red: 1 win', DRAW_TEXT]);
    expect(DRAW_TEXT).toBe('DRAW — REPLAY');
  });

  it('a draw never invents a winner line: exactly 4 lines, the 4th being the draw text', () => {
    const lines = buildScoreboardLines({
      bestOf: 1,
      result: 'DRAW',
      wins: { 1: 0, 2: 0 },
      winsNeeded: { 1: 1, 2: 1 },
      colorNames: { 1: 'red', 2: 'blue' },
    });
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe(DRAW_TEXT);
  });

  it('KI-01-02: the last replay before the draw cap shows the warning, not the plain draw text', () => {
    // consecutiveDraws === maxConsecutiveDraws - 1: the second consecutive draw against a cap of 3 — one
    // more draw ends the match (`DESIGN-DECISIONS §1` row 26).
    const lines = buildScoreboardLines({
      bestOf: 3,
      result: 'DRAW',
      wins: { 1: 1, 2: 1 },
      winsNeeded: { 1: 1, 2: 1 },
      colorNames: { 1: 'red', 2: 'blue' },
      consecutiveDraws: 2,
      maxConsecutiveDraws: 3,
    });
    expect(lines).toEqual(['BEST OF 3', 'Red: 1 win', 'Blue: 1 win', DRAW_WARNING_TEXT]);
    expect(DRAW_WARNING_TEXT).toBe('DRAW — REPLAY · one more and the match is called');
  });

  it('KI-01-02: an ordinary (non-final) draw still shows the plain draw text, not the warning', () => {
    const lines = buildScoreboardLines({
      bestOf: 3,
      result: 'DRAW',
      wins: { 1: 0, 2: 0 },
      winsNeeded: { 1: 2, 2: 2 },
      colorNames: { 1: 'red', 2: 'blue' },
      consecutiveDraws: 1,
      maxConsecutiveDraws: 3,
    });
    expect(lines[3]).toBe(DRAW_TEXT);
  });

  it('KI-01-02: a decisive round never shows the warning even at the same consecutiveDraws count', () => {
    // The warning is gated on `result === 'DRAW'` first — a P1/P2 win at consecutiveDraws 2 (carried over
    // from before this round reset it) must still show the ordinary needs-N-more-wins line.
    const lines = buildScoreboardLines({
      bestOf: 3,
      result: 'P1_WIN',
      wins: { 1: 1, 2: 0 },
      winsNeeded: { 1: 1, 2: 2 },
      colorNames: { 1: 'red', 2: 'blue' },
      consecutiveDraws: 0,
      maxConsecutiveDraws: 3,
    });
    expect(lines[3]).toBe('Red needs 1 more win');
  });
});
