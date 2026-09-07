import { afterEach, describe, expect, it } from 'vitest';
import { prefersReducedMotion } from '../../../src/render/reducedMotion.js';

/**
 * `prefersReducedMotion` (KI-15-03): the one resolver every `reducedFx`-defaulting render view now imports.
 * Its own contract is small — `?reducedFx=1` in the URL, or `prefers-reduced-motion: reduce` from
 * `matchMedia`, either one is enough — and never throwing, in Node or in a browser. The four render views
 * that call it (`camera.js`, `pickupView.js`, `snakeView.js`, `laserView.js`) each keep their own tests for
 * "my `reducedFx` reads this when nothing is passed explicitly"; this file is the one place that tests the
 * resolver's own logic directly, so those four do not have to re-prove the OR, the short-circuit and the
 * no-throw guarantees each on their own.
 */

describe('prefersReducedMotion', () => {
  afterEach(() => {
    const globals = /** @type {any} */ (globalThis);
    delete globals.location;
    delete globals.matchMedia;
  });

  it('answers false with neither `location` nor `matchMedia` present (the plain Node case)', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('reads `?reducedFx=1` from `location.search`', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '?test=1&seed=1&reducedFx=1' };
    expect(prefersReducedMotion()).toBe(true);

    globals.location = { search: '?seed=1' };
    expect(prefersReducedMotion()).toBe(false);
  });

  it("KI-15-03: answers true when `matchMedia('(prefers-reduced-motion: reduce)')` matches, with no `?reducedFx=1`", () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '?test=1' };
    globals.matchMedia = (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' });

    expect(prefersReducedMotion()).toBe(true);
  });

  it('KI-15-03: answers false when `matchMedia` is present but does not match', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '' };
    globals.matchMedia = () => ({ matches: false });

    expect(prefersReducedMotion()).toBe(false);
  });

  it('KI-15-03: `?reducedFx=1` alone is still enough with no `matchMedia` at all', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '?reducedFx=1' };

    expect(prefersReducedMotion()).toBe(true);
  });

  it('KI-15-03: `?reducedFx=1` short-circuits before `matchMedia` is ever called', () => {
    const globals = /** @type {any} */ (globalThis);
    let called = false;
    globals.location = { search: '?reducedFx=1' };
    globals.matchMedia = () => {
      called = true;
      return { matches: false };
    };

    expect(prefersReducedMotion()).toBe(true);
    expect(called).toBe(false);
  });

  it('KI-15-03: asks with exactly the `prefers-reduced-motion: reduce` query', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '' };
    let seenQuery = null;
    globals.matchMedia = (query) => {
      seenQuery = query;
      return { matches: true };
    };

    expect(prefersReducedMotion()).toBe(true);
    expect(seenQuery).toBe('(prefers-reduced-motion: reduce)');
  });

  it('KI-15-03: a throwing `matchMedia` is treated as no preference, not a crash', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '' };
    globals.matchMedia = () => {
      throw new Error('unsupported media feature');
    };

    expect(() => prefersReducedMotion()).not.toThrow();
    expect(prefersReducedMotion()).toBe(false);
  });

  it('ignores a `matchMedia` that is present but not a function', () => {
    const globals = /** @type {any} */ (globalThis);
    globals.location = { search: '' };
    globals.matchMedia = 'not a function';

    expect(prefersReducedMotion()).toBe(false);
  });
});
