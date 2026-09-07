// @ts-check
import { describe, expect, it } from 'vitest';
import { greedy } from '../../../../src/game/bots/greedy.js';
import { survivor } from '../../../../src/game/bots/survivor.js';
import { MEASUREMENT_RULES, PLAY_RULES } from '../../../../src/game/bots/policy.js';

/**
 * KI-12-01 — the three {@link MEASUREMENT_RULES} knobs are live, and each one is the ruled difference it
 * claims to be.
 *
 * Configuration that no test exercises is configuration that quietly stops working. These knobs exist for
 * one reason — so `tests/sim` reproduces `docs/qa/playtests/gate1-bot-matrix.md` to the number while the CPU
 * plays by the newer rules — and the sim suite proves the *aggregate*. What it cannot show is which knob did
 * what, or that a knob still does anything at all: a `laserAware` that had silently become a no-op would
 * leave the matrix intact only if nothing else had changed either, and would fail as a puzzle rather than as
 * a message. Each test below is one board where exactly one knob flips the answer.
 *
 * The fourth knob, `jitter`, is proved by construction instead: it is a function the caller supplies, and
 * `purity.test.js` proves the default path never calls one.
 */

const GRID = { width: 24, height: 24 };

function makeSnake(head, direction, { alive = true, pendingGrowth = 0, tailCells = 3 } = {}) {
  const segments = [head];
  for (let i = 1; i <= tailCells; i += 1) {
    segments.push({ x: head.x - direction.dx * i, y: head.y - direction.dy * i });
  }
  return { alive, segments, direction, pendingGrowth };
}

describe('KI-12-01 · the measurement rules are live', () => {
  it('KI-12-01: laserAware decides whether greedy will step into the dead zone', () => {
    // Inset 6, so the safe square is [6, 17]. The head sits on the inner edge at x = 6 facing LEFT, with the
    // only apple further out at x = 2 — inside the dead zone. A dead-zone-aware greedy refuses to continue
    // and turns; the wall-only greedy the matrix was recorded with walks straight on toward the apple.
    const snapshot = {
      snakes: [
        makeSnake({ x: 6, y: 12 }, { dx: -1, dy: 0 }),
        makeSnake({ x: 16, y: 16 }, { dx: 1, dy: 0 }),
      ],
      apples: [{ x: 2, y: 12 }],
      powerUps: { pickups: [] },
      lasers: { phase: 'CLOSING', inset: 6 },
    };
    const aware = greedy({ snapshot, playerIndex: 0, grid: GRID, rules: PLAY_RULES });
    const wallOnly = greedy({ snapshot, playerIndex: 0, grid: GRID, rules: MEASUREMENT_RULES });

    // The wall-only bot keeps its heading (`null` is "press nothing"), which walks it into the beams.
    expect(wallOnly).toBeNull();
    // The dead-zone-aware bot turns away along the safe edge rather than continuing.
    expect(aware).not.toBeNull();
    expect(['UP', 'DOWN']).toContain(aware);
  });

  it('KI-12-01: contested decides whether survivor refuses a cell the opponent can also reach', () => {
    // P1 runs east along y=13 with a long body behind it; P2 sits directly below its head, facing north,
    // during the closing phase (safe square [6, 17]). P2's three legal next cells are (11,13) — P1's own
    // head — (10,12) and (12,12), so the cell P1 would reach by continuing straight, (12,13), is *not* one
    // the opponent could step into. What separates the two rules here is the second half of the exclusion:
    // under `'exclude'` a contested cell is also discounted when counting a candidate's free neighbours, so
    // (12,13) loses the room it appears to have (its neighbour (12,12) is contested) and drops behind
    // turning north. Under `'penalise'` nothing is contested, (12,13) keeps all three neighbours, and the
    // straight bonus carries it — so this bot drives on across the opponent's nose.
    const snapshot = {
      snakes: [
        makeSnake({ x: 11, y: 13 }, { dx: 1, dy: 0 }, { tailCells: 8 }),
        makeSnake({ x: 11, y: 12 }, { dx: 0, dy: 1 }, { tailCells: 2 }),
      ],
      apples: [],
      powerUps: { pickups: [] },
      lasers: { phase: 'CLOSING', inset: 6 },
    };
    expect(survivor({ snapshot, playerIndex: 0, grid: GRID, rules: PLAY_RULES })).toBe('UP');
    // `null` is "press nothing", i.e. keep heading east into the cell the exclusion rule steers away from.
    expect(survivor({ snapshot, playerIndex: 0, grid: GRID, rules: MEASUREMENT_RULES })).toBeNull();
  });

  it('KI-12-01: straightBonus is what breaks greedy ties without a stream', () => {
    // Heading east at (5,5) with the apple at (6,6): continuing east to (6,5) and turning north to (5,6)
    // are exactly the same Manhattan distance from it, so nothing but the tie-break separates them. The
    // heading is deliberately east rather than north, because candidates are evaluated in the fixed order
    // UP, DOWN, LEFT, RIGHT and `best` only changes on a *strictly* higher score — so with the bonus at 0
    // the tie falls to whichever comes first, which must not also be the straight one or the two rules
    // would agree by accident. With the bonus, straight wins and the policy presses nothing; with the
    // bonus at 0 — the matrix's rules, where a seeded stream broke this tie — UP wins instead.
    const snapshot = {
      snakes: [
        makeSnake({ x: 5, y: 5 }, { dx: 1, dy: 0 }),
        makeSnake({ x: 20, y: 20 }, { dx: 1, dy: 0 }),
      ],
      apples: [{ x: 6, y: 6 }],
      powerUps: { pickups: [] },
      lasers: { phase: 'PARKED', inset: 0 },
    };
    expect(greedy({ snapshot, playerIndex: 0, grid: GRID, rules: PLAY_RULES })).toBeNull();
    expect(
      greedy({ snapshot, playerIndex: 0, grid: GRID, rules: { ...PLAY_RULES, straightBonus: 0 } }),
    ).toBe('UP');
  });

  it('KI-12-01: a jitter is drawn once per candidate that clears the safety guards', () => {
    // The draw *count* and *order* are what make `gate1-bot-matrix.md` reproduce: the sim bots have always
    // drawn inside the candidate loop, after both guards, so a policy that drew once per call, or drew for
    // a candidate it had already rejected, would consume the stream differently and every downstream round
    // would diverge. Here all three non-reversing candidates are safe and open, so three draws are due.
    const snapshot = {
      snakes: [
        makeSnake({ x: 12, y: 12 }, { dx: 1, dy: 0 }),
        makeSnake({ x: 20, y: 20 }, { dx: 1, dy: 0 }),
      ],
      apples: [{ x: 15, y: 12 }],
      powerUps: { pickups: [] },
      lasers: { phase: 'PARKED', inset: 0 },
    };
    let draws = 0;
    const jitter = () => {
      draws += 1;
      return 0;
    };
    greedy({ snapshot, playerIndex: 0, grid: GRID, rules: { ...MEASUREMENT_RULES, jitter } });
    expect(draws).toBe(3);

    draws = 0;
    survivor({ snapshot, playerIndex: 0, grid: GRID, rules: { ...MEASUREMENT_RULES, jitter } });
    expect(draws).toBe(3);
  });
});
