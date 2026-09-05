// @ts-check
import { describe, expect, it } from 'vitest';
import { createRng } from '../../../src/core/rng.js';

describe('KS-02-01 rng', () => {
  it('KS-02-01 AC1: same seed produces the same first 1000 numbers', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('KS-02-01 AC1: different seeds produce different sequences', () => {
    const a = createRng(1234);
    const b = createRng(5678);
    const seqA = Array.from({ length: 1000 }, () => a.next());
    const seqB = Array.from({ length: 1000 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('KS-02-01 AC1: exposes the seed it was created with', () => {
    expect(createRng(42).seed).toBe(42);
  });

  it('KS-02-01: next() always returns a value in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 10000; i += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('KS-02-01 AC2: int(4) is uniform enough over 100000 draws', () => {
    // "±2 % of 25 %" is read as within 2 *percentage points* of 25 % (i.e. each bucket lands in
    // [23 %, 27 %]) — a fair generator clears this comfortably at 100 000 draws, and it is what a fixed
    // seed can be asserted against deterministically (no flake).
    const rng = createRng(99);
    const draws = 100000;
    const buckets = [0, 0, 0, 0];
    for (let i = 0; i < draws; i += 1) {
      buckets[rng.int(4)] += 1;
    }
    for (const count of buckets) {
      const fraction = count / draws;
      expect(fraction).toBeGreaterThanOrEqual(0.23);
      expect(fraction).toBeLessThanOrEqual(0.27);
    }
  });

  it('KS-02-01: int(maxExclusive) only returns integers below maxExclusive', () => {
    const rng = createRng(7);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.int(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
    }
  });

  it('KS-02-01: int() consumes exactly one next() call', () => {
    const withInt = createRng(3);
    const withNext = createRng(3);
    withInt.int(4);
    withNext.next();
    // Having consumed the same number of underlying draws, both generators must now be in lockstep.
    expect(withInt.next()).toBe(withNext.next());
  });

  it('KS-02-01: pick() consumes exactly one next() call and is deterministic for a seed', () => {
    const withPick = createRng(11);
    const withNext = createRng(11);
    const options = ['a', 'b', 'c', 'd', 'e'];
    const picked = withPick.pick(options);
    withNext.next();
    expect(options).toContain(picked);
    expect(withPick.next()).toBe(withNext.next());
  });

  it('KS-02-01: pick() on an empty array throws (documented caller error)', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
  });
});
