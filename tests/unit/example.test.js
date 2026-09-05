// @ts-check
import { describe, expect, it } from 'vitest';

/**
 * KS-01-03: this file has no game logic to test yet — `src/core` is empty until Sprint 02 (ARCHITECTURE §3).
 * Its only job is to prove the Vitest runner itself works: it resolves ES modules, runs assertions, and
 * reports failures correctly. Sprint 02 replaces this file's purpose (not necessarily this file) with real
 * unit tests under `tests/unit/` that mirror `src/core` and `src/game`.
 */
describe('KS-01-03 test harness placeholder', () => {
  it('KS-01-03 AC1: npm run test:unit runs and reports a passing assertion', () => {
    // KS-01-04 AC1 verification: deliberately wrong assertion. This branch is a throwaway used only
    // to prove CI shows a red check on a failing unit test; it is never merged.
    expect(1 + 1).toBe(3);
  });

  it('KS-01-03 AC1: npm run test:unit resolves plain ES module imports', async () => {
    const module = await import('node:path');
    expect(typeof module.join).toBe('function');
  });
});
