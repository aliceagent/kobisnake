// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-03-06: test hooks (`window.__kobi`, `ARCHITECTURE §11`).
 *
 * These specs are this ticket's own — KS-03-07 owns `first-playable.spec.js`, `interpolation.spec.js` and
 * `input.spec.js`, and none of them prove the hooks' own two acceptance criteria, so this is a new file
 * (declared in the PR description, per this ticket's tech-lead notes).
 *
 * AC1 needs both halves proved together: `?test=1` present must expose `window.__kobi`, *and* the very same
 * production build loaded without it must genuinely lack it — a hook that is merely unused would still pass
 * a test that only checked the first half. That is why this spec loads the bare `/` for the second half
 * instead of `DEFAULT_QUERY`, which always carries `?test=1`.
 */
test.describe('KS-03-06 test hooks', () => {
  test('KS-03-06 AC1: window.__kobi is absent from the production build unless ?test=1', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'object',
    );

    await page.goto('/');
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'undefined',
    );
  });

  test('KS-03-06 AC2: fastForward(90) completes in under 500 ms', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    // Enter starts a round (the placeholder round flow, KS-03-05), so fastForward has a live sim to advance
    // — the same round-flow path (ROUND_OVER handling, HUD write) a real 90 s of play would take, not just
    // an idle no-op.
    // KS-05-03: main menu -> match setup -> countdown -> PLAYING, in one synchronous script.
    await page.evaluate(startMatchInPage);

    const elapsedMs = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const start = performance.now();
      kobi.fastForward(90);
      return performance.now() - start;
    });

    expect(elapsedMs).toBeLessThan(500);
  });

  test('KS-06-00 AC3: fastForward(0.3) after a crash lands *inside* the slow-mo beat (#84)', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    const observed = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      // P1 into the top wall: twelve grid steps at 6 cells/s, so the crash lands at 2.0 s exactly
      // (`tests/e2e/helpers.js`'s `crashPlayerOneInPage` explains the geometry). Stop 0.1 s past it.
      kobi.pressKey(1, 'UP');
      kobi.fastForward(2.1);
      const atCrash = { state: kobi.getState(), timeScale: kobi.getTimeScale() };

      // 0.3 s is half of `crashSlowMo.duration` (0.6 s, `DESIGN-DECISIONS §2.5`). Before KS-06-00 this one
      // call was a single 0.3 s frame, which consumed the rest of the beat whole and left the game past it;
      // chunked into frame-sized pieces it does what 0.3 s of real time does, and stops in the middle.
      kobi.fastForward(0.3);
      const midBeat = { state: kobi.getState(), timeScale: kobi.getTimeScale() };

      // The rest of the beat, and out the other side onto the scoreboard.
      kobi.fastForward(0.5);
      const afterBeat = { state: kobi.getState(), timeScale: kobi.getTimeScale() };

      return { atCrash, midBeat, afterBeat };
    });

    expect(observed.atCrash.state).toBe('PLAYING');
    expect(observed.atCrash.timeScale).toBe(0.25);
    // The assertion this ticket exists for: a frame genuinely observed the game inside the beat.
    expect(observed.midBeat.state).toBe('PLAYING');
    expect(observed.midBeat.timeScale).toBe(0.25);
    expect(observed.afterBeat.state).toBe('ROUND_OVER');
    expect(observed.afterBeat.timeScale).toBe(1);
  });

  test('KS-06-00 AC3: the countdown is observable beat by beat, not swallowed whole', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const labels = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;
      kobi.startMatch();
      /** @type {string[]} */
      const seen = [];
      // Sampled once per frame-sized chunk and de-duplicated, rather than once per 0.8 s beat: the beat
      // boundaries do not fall on exact multiples of 0.1 s in binary float, so counting beats would be
      // testing the sampler's arithmetic rather than the game's. What matters is that all four labels are
      // *observable*, in order — which one 3.2 s call could never show, because it would skip to the last.
      for (let i = 0; i < 40 && kobi.getState() === 'COUNTDOWN'; i += 1) {
        const label = doc.querySelector('[data-screen="COUNTDOWN"]').textContent.trim();
        if (seen[seen.length - 1] !== label) seen.push(label);
        kobi.fastForward(0.1);
      }
      return seen;
    });

    expect(labels).toEqual(['3', '2', '1', 'GO']);
  });
});
