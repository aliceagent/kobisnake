// @ts-check
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  isOpposite,
  addDir,
  inBounds,
  cellKey,
  chebyshev,
} from '../../../src/core/grid.js';

describe('KS-02-01 grid', () => {
  it('KS-02-01: DIRECTIONS has the four cardinal {dx, dy} vectors', () => {
    expect(DIRECTIONS.UP).toEqual({ dx: 0, dy: 1 });
    expect(DIRECTIONS.DOWN).toEqual({ dx: 0, dy: -1 });
    expect(DIRECTIONS.LEFT).toEqual({ dx: -1, dy: 0 });
    expect(DIRECTIONS.RIGHT).toEqual({ dx: 1, dy: 0 });
  });

  it('KS-02-01 AC3: isOpposite is true only for UP/DOWN and LEFT/RIGHT pairs', () => {
    const opposingPairs = [
      [DIRECTIONS.UP, DIRECTIONS.DOWN],
      [DIRECTIONS.DOWN, DIRECTIONS.UP],
      [DIRECTIONS.LEFT, DIRECTIONS.RIGHT],
      [DIRECTIONS.RIGHT, DIRECTIONS.LEFT],
    ];
    for (const [a, b] of opposingPairs) {
      expect(isOpposite(a, b)).toBe(true);
    }

    const all = [DIRECTIONS.UP, DIRECTIONS.DOWN, DIRECTIONS.LEFT, DIRECTIONS.RIGHT];
    for (const a of all) {
      for (const b of all) {
        const isOpposingPair = opposingPairs.some((pair) => pair[0] === a && pair[1] === b);
        expect(isOpposite(a, b)).toBe(isOpposingPair);
      }
    }
  });

  it('KS-02-01: addDir steps a cell one unit in a direction', () => {
    expect(addDir({ x: 5, y: 5 }, DIRECTIONS.UP)).toEqual({ x: 5, y: 6 });
    expect(addDir({ x: 5, y: 5 }, DIRECTIONS.DOWN)).toEqual({ x: 5, y: 4 });
    expect(addDir({ x: 5, y: 5 }, DIRECTIONS.LEFT)).toEqual({ x: 4, y: 5 });
    expect(addDir({ x: 5, y: 5 }, DIRECTIONS.RIGHT)).toEqual({ x: 6, y: 5 });
  });

  it('KS-02-01: inBounds is true inside a grid and false at/beyond its edges', () => {
    const grid = { width: 24, height: 24 };
    expect(inBounds({ x: 0, y: 0 }, grid)).toBe(true);
    expect(inBounds({ x: 23, y: 23 }, grid)).toBe(true);
    expect(inBounds({ x: -1, y: 0 }, grid)).toBe(false);
    expect(inBounds({ x: 0, y: -1 }, grid)).toBe(false);
    expect(inBounds({ x: 24, y: 0 }, grid)).toBe(false);
    expect(inBounds({ x: 0, y: 24 }, grid)).toBe(false);
  });

  it('KS-02-01: cellKey gives a stable, distinct key per cell', () => {
    expect(cellKey({ x: 5, y: 12 })).toBe('5,12');
    expect(cellKey({ x: 5, y: 12 })).toBe(cellKey({ x: 5, y: 12 }));
    expect(cellKey({ x: 12, y: 5 })).not.toBe(cellKey({ x: 5, y: 12 }));
  });

  it('KS-02-01: chebyshev is the max of the axis distances, diagonals included', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 1, y: 3 })).toBe(3);
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});
