// @ts-check
import { describe, expect, it } from 'vitest';
import { greedy } from './greedy.js';
import { survivor } from './survivor.js';
import { idle } from './idle.js';

/**
 * KI-03-02 AC3 — each policy proved on a fixed, hand-built snapshot for the exact move it must choose.
 *
 * These snapshots are not full `RoundSimulation.getState()` output — only the fields each policy actually
 * reads — but they use the real field names and shapes (`driver.js`'s `PolicyView` doc, `tests/agent/README.md`
 * §"state shapes"): `snapshot.powerUps` is `{pickups: [...]}` not an array, `snapshot.lasers` is
 * `{phase, inset, insetCells}` with no bounds of its own, and `snapshot.apples` may hold `null` for an
 * empty slot.
 *
 * Both policies are also exercised end to end through the real driver in `tests/agent/policies.spec.js`
 * (KI-03-02 ruling 1: "verify the constraint holds by actually running them through the driver"), which is
 * what actually proves they have no free variables — a `Function.prototype.toString()` round-trip cannot be
 * done in a plain Vitest run, only in the page.
 */

/** A living, otherwise-idle snake at `head`, facing `direction`, with a short straight body behind it. */
function makeSnake(head, direction, { alive = true, pendingGrowth = 0, tailCells = 3 } = {}) {
  const segments = [head];
  // Body trails behind the direction of travel, i.e. opposite the way it is facing — realistic enough for
  // these functions, which only ever ask "is this cell in `segments`", never "is this a legal snake shape".
  for (let i = 1; i <= tailCells; i += 1) {
    segments.push({ x: head.x - direction.dx * i, y: head.y - direction.dy * i });
  }
  return {
    alive,
    segments,
    previousSegments: segments,
    direction,
    pendingGrowth,
    speedMultiplier: 1,
    effects: [],
  };
}

const PARKED_LASERS = { phase: 'PARKED', inset: 0, insetCells: 0 };
const GRID_24 = { width: 24, height: 24 };

/** A distant, harmless opponent that never influences the scenario under test. */
function farOpponent() {
  return makeSnake({ x: 20, y: 20 }, { dx: 1, dy: 0 });
}

describe('KI-03-02 AC3 · greedy', () => {
  it('KI-03-02 AC3: greedy turns toward the nearest apple, off its current heading', () => {
    // Head at (5,5) facing UP; the only apple is due east. Straight ahead (UP) and left both lead away from
    // it, so RIGHT is the unique closest candidate — and it differs from the current heading, so the policy
    // must actually press a key rather than returning null.
    const me = makeSnake({ x: 5, y: 5 }, { dx: 0, dy: 1 });
    const snapshot = {
      snakes: [me, farOpponent()],
      apples: [{ x: 9, y: 5 }, null],
      powerUps: { pickups: [] },
      lasers: PARKED_LASERS,
    };
    const move = greedy({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).toBe('RIGHT');
  });

  it('KI-03-02 AC3: greedy treats a power-up as a valid target, not just apples', () => {
    // Same geometry as above, but the target is a power-up pickup and the only apple is far in the opposite
    // direction — so heading for it (rather than ignoring it, or the apple) is the only way to get RIGHT.
    const me = makeSnake({ x: 5, y: 5 }, { dx: 0, dy: 1 });
    const snapshot = {
      snakes: [me, farOpponent()],
      apples: [{ x: 5, y: 23 }],
      powerUps: { pickups: [{ cell: { x: 9, y: 5 }, type: 'SPEED' }] },
      lasers: PARKED_LASERS,
    };
    const move = greedy({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).toBe('RIGHT');
  });

  it('KI-03-02 AC3: greedy refuses a cell occupied by the opponent, even toward the apple', () => {
    // Head at (10,10) facing RIGHT, apple at (14,8) — south-east of the head. RIGHT (straight toward the
    // apple's column) is blocked by the opponent's body; DOWN is the closer of the two remaining safe
    // directions (distance 5 vs UP's 7), so DOWN is the one candidate a bot that ignored the block would
    // never have preferred this strongly.
    const me = makeSnake({ x: 10, y: 10 }, { dx: 1, dy: 0 });
    const opponent = makeSnake({ x: 11, y: 10 }, { dx: -1, dy: 0 });
    const snapshot = {
      snakes: [me, opponent],
      apples: [{ x: 14, y: 8 }],
      powerUps: { pickups: [] },
      lasers: PARKED_LASERS,
    };
    const move = greedy({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).toBe('DOWN');
  });

  it('KI-03-02 AC3: greedy presses nothing when the best move is already its heading', () => {
    const me = makeSnake({ x: 5, y: 5 }, { dx: 1, dy: 0 });
    const snapshot = {
      snakes: [me, farOpponent()],
      apples: [{ x: 9, y: 5 }],
      powerUps: { pickups: [] },
      lasers: PARKED_LASERS,
    };
    const move = greedy({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).toBeNull();
  });

  it('KI-03-02 AC3: a dead snake gets no move', () => {
    const me = makeSnake({ x: 5, y: 5 }, { dx: 1, dy: 0 }, { alive: false });
    const snapshot = {
      snakes: [me, farOpponent()],
      apples: [{ x: 9, y: 5 }],
      powerUps: { pickups: [] },
      lasers: PARKED_LASERS,
    };
    expect(greedy({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 })).toBeNull();
  });
});

describe('KI-03-02 AC3 · survivor', () => {
  it('KI-03-02 AC3: survivor turns away from a corner to keep more room open', () => {
    // Head at (1,1), heading LEFT — straight into the bottom-left corner. Continuing LEFT leaves only 2
    // free neighbours next step, DOWN also 2, but UP opens onto 3 — survivor never eats, so this is decided
    // on room alone, and it must turn rather than walk into the corner it is heading for.
    const me = makeSnake({ x: 1, y: 1 }, { dx: -1, dy: 0 });
    const snapshot = {
      snakes: [me, farOpponent()],
      lasers: PARKED_LASERS,
    };
    const move = survivor({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).toBe('UP');
  });

  it("KI-03-02 AC3: survivor excludes the cell the opponent's head can also reach next step", () => {
    // Two heads on the same row, closing on each other with one empty cell between them — the mirrored
    // spawn-line scenario the ticket names. (11,10) is exactly the cell each snake's own forward move would
    // land on; a bot that only avoided *currently occupied* cells would walk straight into it and draw. Both
    // remaining directions (UP/DOWN) are equally open, so the tie is broken by candidate order (UP first),
    // which is deterministic and, either way, the result must not be RIGHT.
    const me = makeSnake({ x: 10, y: 10 }, { dx: 1, dy: 0 });
    const opponent = makeSnake({ x: 12, y: 10 }, { dx: -1, dy: 0 });
    const snapshot = {
      snakes: [me, opponent],
      lasers: PARKED_LASERS,
    };
    const move = survivor({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 });
    expect(move).not.toBe('RIGHT');
    expect(move).toBe('UP');
  });

  it('KI-03-02 AC3: survivor treats the next laser ring as deadly only while a step is imminent', () => {
    // inset 5, so the safe square is [5, 18] on both axes. Head at (7,7) facing DOWN: the cell straight
    // ahead (7,6) is not itself on the ring, but *its* southern neighbour (7,5) is — the two-step lookahead
    // `survivorBot.js` also does. While a step is imminent (WARNING/CLOSING) that neighbour counts as dead,
    // costing straight-ahead enough room that turning right wins; while PARKED the same geometry is
    // untouched by the gate and continuing straight is simply the best move, so it presses nothing. Only
    // `phase` differs between the two assertions — this is the gate the ticket calls load-bearing.
    const me = makeSnake({ x: 7, y: 7 }, { dx: 0, dy: -1 });
    const snapshot = (phase) => ({
      snakes: [me, farOpponent()],
      lasers: { phase, inset: 5, insetCells: 5 },
    });

    expect(
      survivor({ snapshot: snapshot('WARNING'), playerIndex: 0, grid: GRID_24, decisionIndex: 0 }),
    ).toBe('RIGHT');
    expect(
      survivor({ snapshot: snapshot('PARKED'), playerIndex: 0, grid: GRID_24, decisionIndex: 0 }),
    ).toBeNull();
  });

  it('KI-03-02 AC3: a dead snake gets no move', () => {
    const me = makeSnake({ x: 10, y: 10 }, { dx: 1, dy: 0 }, { alive: false });
    const snapshot = { snakes: [me, farOpponent()], lasers: PARKED_LASERS };
    expect(survivor({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 })).toBeNull();
  });
});

describe('KI-03-02 AC3 · idle', () => {
  it('KI-03-02 AC3: idle never presses a key, regardless of the snapshot', () => {
    const me = makeSnake({ x: 10, y: 10 }, { dx: 1, dy: 0 });
    const snapshot = {
      snakes: [me, farOpponent()],
      apples: [{ x: 9, y: 5 }],
      powerUps: { pickups: [{ cell: { x: 1, y: 1 }, type: 'SLOW' }] },
      lasers: PARKED_LASERS,
    };
    expect(idle({ snapshot, playerIndex: 0, grid: GRID_24, decisionIndex: 0 })).toBeNull();
    expect(idle({ snapshot, playerIndex: 1, grid: GRID_24, decisionIndex: 41 })).toBeNull();
  });
});
