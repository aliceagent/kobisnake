// @ts-check
import { describe, expect, it } from 'vitest';
import { greedy } from '../../../../src/game/bots/greedy.js';
import { survivor } from '../../../../src/game/bots/survivor.js';
import { PLAY_RULES } from '../../../../src/game/bots/policy.js';

/**
 * KI-12-01 AC2 — a policy is handed a frozen snapshot and proved unable to mutate it, and proved not to read
 * the three things `docs/sprints/improvement-12-cpu-opponent.md`'s risk register calls out: the round's RNG,
 * an opponent's `pendingGrowth`, and anything else outside the public snapshot.
 *
 * The risk this fences is not a policy that cheats on purpose. It is a policy that cheats **by accident** —
 * `getState()` publishes every snake's `pendingGrowth`, so reading the opponent's is one field access away
 * and nothing about the type would complain. A CPU that knew how much growth its opponent was still owed
 * would be reading through the table, and it would be superhuman for free.
 *
 * Three techniques, because freezing alone proves less than it looks:
 *
 * 1. **Deep freeze**, then compare against a pristine deep clone afterwards. ES modules are strict mode, so
 *    an assignment to a frozen object throws rather than failing silently — but the clone comparison also
 *    catches a mutation of anything the freeze missed.
 * 2. **A throwing getter on every field a policy may not read.** `Object.freeze` says nothing about *reads*.
 *    Defining the opponents' `pendingGrowth` as a getter that throws turns "did it read this" into a test
 *    result instead of a code review.
 * 3. **A throwing `Math.random`.** The policies take no RNG under {@link PLAY_RULES}; this proves they did
 *    not reach for the ambient one instead, the same way `tests/unit/core/purity.test.js` proves it for
 *    `src/core` (KI-09-03).
 */

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** A living snake at `head`, facing `direction`, with a short straight body trailing behind it. */
function makeSnake(head, direction, { alive = true, pendingGrowth = 0, tailCells = 3 } = {}) {
  const segments = [head];
  for (let i = 1; i <= tailCells; i += 1) {
    segments.push({ x: head.x - direction.dx * i, y: head.y - direction.dy * i });
  }
  return { alive, segments, direction, pendingGrowth };
}

const GRID = { width: 24, height: 24 };

/**
 * A spread of boards, so the assertions below run through every branch a policy has: apples and power-ups,
 * an opponent close enough to contest cells, a corner, growth owed, and each laser phase (which is what
 * turns the next-step-ring rule on).
 *
 * @returns {{name: string, snapshot: any}[]}
 */
function boards() {
  const cases = [];
  for (const phase of ['PARKED', 'WARNING', 'CLOSING', 'STOPPED']) {
    for (const inset of phase === 'PARKED' ? [0] : [0, 3, 6]) {
      cases.push({
        name: `open board, ${phase} inset ${inset}`,
        snapshot: {
          snakes: [
            makeSnake({ x: 10, y: 12 }, { dx: 1, dy: 0 }),
            makeSnake({ x: 13, y: 11 }, { dx: -1, dy: 0 }),
          ],
          apples: [
            { x: 15, y: 12 },
            { x: 8, y: 9 },
          ],
          powerUps: { pickups: [{ cell: { x: 11, y: 14 } }] },
          lasers: { phase, inset },
        },
      });
      cases.push({
        name: `corner, growth owed, ${phase} inset ${inset}`,
        snapshot: {
          snakes: [
            makeSnake({ x: inset, y: inset }, { dx: -1, dy: 0 }, { pendingGrowth: 2 }),
            makeSnake({ x: 20, y: 20 }, { dx: 1, dy: 0 }, { pendingGrowth: 5 }),
          ],
          apples: [],
          powerUps: { pickups: [] },
          lasers: { phase, inset },
        },
      });
      cases.push({
        // A dead opponent still on the board: a snake that dies leaves its segments in the snapshot until
        // the round resolves, and the survivor plays on beside them. Both policies must treat those cells
        // as scenery — solid, but contesting nothing and threatening nobody.
        name: `dead opponent, ${phase} inset ${inset}`,
        snapshot: {
          snakes: [
            makeSnake({ x: 10, y: 12 }, { dx: 1, dy: 0 }),
            makeSnake({ x: 11, y: 12 }, { dx: -1, dy: 0 }, { alive: false }),
          ],
          apples: [{ x: 14, y: 12 }],
          powerUps: { pickups: [] },
          lasers: { phase, inset },
        },
      });
      cases.push({
        name: `head to head, ${phase} inset ${inset}`,
        snapshot: {
          snakes: [
            makeSnake({ x: 11, y: 12 }, { dx: 1, dy: 0 }),
            makeSnake({ x: 13, y: 12 }, { dx: -1, dy: 0 }),
          ],
          apples: [{ x: 12, y: 12 }],
          powerUps: { pickups: [] },
          lasers: { phase, inset },
        },
      });
    }
  }
  return cases;
}

const POLICIES = [
  { name: 'greedy', policy: greedy },
  { name: 'survivor', policy: survivor },
];

describe('KI-12-01 AC2 · a policy cannot mutate the snapshot it is given', () => {
  for (const { name, policy } of POLICIES) {
    it(`KI-12-01 AC2: ${name} leaves a frozen snapshot untouched on every board`, () => {
      for (const { name: board, snapshot } of boards()) {
        // A JSON round-trip rather than `structuredClone`: these boards are plain JSON data, and it
        // keeps this file free of a global the repository's test lint config does not carry.
        const pristine = JSON.parse(JSON.stringify(snapshot));
        deepFreeze(snapshot);
        for (const playerIndex of [0, 1]) {
          expect(
            () => policy({ snapshot, playerIndex, grid: GRID }),
            `${name} threw on ${board} as player ${playerIndex}`,
          ).not.toThrow();
        }
        expect(snapshot, `${name} mutated the snapshot on ${board}`).toEqual(pristine);
      }
    });

    it(`KI-12-01 AC2: ${name} never reads an opponent's pendingGrowth`, () => {
      for (const { name: board, snapshot } of boards()) {
        for (const playerIndex of [0, 1]) {
          // Every snake but the policy's own gets a `pendingGrowth` that throws when read. A policy is
          // entitled to its own — it needs it to know whether its tail cell vacates this step — and to no
          // other, because no player can see how much growth an opponent is still owed.
          const guarded = {
            ...snapshot,
            snakes: snapshot.snakes.map((snake, index) =>
              index === playerIndex
                ? { ...snake }
                : {
                    ...snake,
                    get pendingGrowth() {
                      throw new Error(`read opponent pendingGrowth (snake ${index})`);
                    },
                  },
            ),
          };
          expect(
            () => policy({ snapshot: guarded, playerIndex, grid: GRID }),
            `${name} read an opponent's pendingGrowth on ${board} as player ${playerIndex}`,
          ).not.toThrow();
        }
      }
    });
  }

  it('KI-12-01 AC2: no policy reaches for the ambient RNG', () => {
    const realRandom = Math.random;
    Math.random = () => {
      throw new Error('a policy called Math.random');
    };
    try {
      for (const { policy } of POLICIES) {
        for (const { snapshot } of boards()) {
          for (const playerIndex of [0, 1]) {
            expect(() => policy({ snapshot, playerIndex, grid: GRID })).not.toThrow();
          }
        }
      }
    } finally {
      Math.random = realRandom;
    }
  });

  it('KI-12-01 AC2: a policy under the default rules is a pure function of the snapshot', () => {
    // Determinism is KI-12-02's contract and this is where it starts: the same board must always produce
    // the same move, with no rules, no stream and no hidden state between calls.
    for (const { name, policy } of POLICIES) {
      for (const { name: board, snapshot } of boards()) {
        for (const playerIndex of [0, 1]) {
          const first = policy({ snapshot, playerIndex, grid: GRID });
          for (let repeat = 0; repeat < 5; repeat += 1) {
            expect(
              policy({ snapshot, playerIndex, grid: GRID }),
              `${name} was not deterministic on ${board}`,
            ).toBe(first);
          }
          expect(policy({ snapshot, playerIndex, grid: GRID, rules: PLAY_RULES })).toBe(first);
        }
      }
    }
  });
});
