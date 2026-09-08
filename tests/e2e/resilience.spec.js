// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KI-06-01 — a lost WebGL context, and the match that survives it.
 *
 * Nothing in the codebase listened for `webglcontextlost` before this ticket: a laptop waking from sleep, a
 * driver reset, or a browser reclaiming GPU memory from a background tab left the player looking at a dead
 * canvas over a match that was still running underneath it, and the only way out was a reload — which loses
 * the match. This file fabricates exactly that failure with `WEBGL_lose_context`, which is the extension's
 * whole purpose, and asserts the recovery in numbers rather than in pixels.
 *
 * **Everything is observed from inside the events themselves.** The `webglcontextlost` and
 * `webglcontextrestored` events are delivered asynchronously, and the frame loop is live in a real browser,
 * so a `page.evaluate` that reads the tick "just after" a restore is racing the READY? beat. Each test below
 * therefore registers its own one-shot listener on the canvas *before* triggering the event: `renderer.js`'s
 * watcher is registered when the renderer is built, so a listener added later runs after it — and after the
 * session has already paused or resumed — which makes "the state the moment the context came back" an exact
 * reading rather than a poll.
 *
 * The one thing that does not need that care is the frozen stretch in the middle: the match is paused, so
 * `loop.timeScale` is 0 and no amount of real or driven time moves the simulation. That is AC2, and it is
 * what makes AC1's "the same tick" a fact rather than a hope.
 */

/**
 * Reaches a running round and holds the WebGL context's loss/restore extension on `window` for the page-side
 * helpers below. Returns the simulation tick the round is standing on.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
async function startRoundAndArm(page) {
  await page.goto(DEFAULT_QUERY);
  expect(await page.evaluate(startMatchInPage)).toBe('PLAYING');

  return page.evaluate(() => {
    const w = /** @type {any} */ (globalThis);
    const canvas = /** @type {HTMLCanvasElement} */ (w.document.getElementById('game'));
    // The same context the renderer already holds: a second `getContext` call for a context type that has
    // already been created returns that context, whatever attributes are asked for.
    const gl = canvas.getContext('webgl2');
    if (gl === null) throw new Error('no webgl2 context on the game canvas');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext === null) throw new Error('WEBGL_lose_context is not available in this browser');
    w.__resilience = { canvas, ext, observed: null };
    // A few frames of round, so the tick under test is not 0 and "unchanged" means something.
    for (let i = 0; i < 30; i += 1) w.__kobi.advance(1 / 60);
    return w.__kobi.getSnapshot().tick;
  });
}

/**
 * Fires one of the two context events and reports what the game looked like the instant it was handled.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'lost' | 'restored'} which
 * @returns {Promise<{state: string, tick: number | null, timeScale: number}>}
 */
function fireContextEvent(page, which) {
  return page.evaluate((event) => {
    const w = /** @type {any} */ (globalThis);
    const { canvas, ext } = w.__resilience;
    return new Promise((resolve) => {
      canvas.addEventListener(
        event === 'lost' ? 'webglcontextlost' : 'webglcontextrestored',
        () => {
          resolve({
            state: w.__kobi.getState(),
            tick: w.__kobi.getSnapshot()?.tick ?? null,
            timeScale: w.__kobi.getTimeScale(),
          });
        },
        { once: true },
      );
      if (event === 'lost') ext.loseContext();
      else ext.restoreContext();
    });
  }, which);
}

test.describe('KI-06-01 surviving a lost WebGL context', () => {
  test('KI-06-01 AC2: no simulated time passes while the context is gone', async ({ page }) => {
    const tickBefore = await startRoundAndArm(page);

    const atLoss = await fireContextEvent(page, 'lost');

    // The pause is the ordinary one: the same state Esc reaches, with the wall clock multiplied by zero.
    expect(atLoss.state).toBe('PAUSE');
    expect(atLoss.timeScale).toBe(0);
    // The live frame loop keeps running the round right up to the pause, so the tick the loss lands on is
    // this round's, later than the one read a round-trip ago — never earlier, and never a fresh round.
    expect(atLoss.tick).toBeGreaterThanOrEqual(tickBefore);
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    // Ten simulated seconds of driven frames — more than a whole short round — plus whatever real frames the
    // live loop ran in the meantime. A paused match owes none of it any ticks.
    const tickAfterFrames = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      for (let i = 0; i < 600; i += 1) w.__kobi.advance(1 / 60);
      return w.__kobi.getSnapshot().tick;
    });
    expect(tickAfterFrames).toBe(atLoss.tick);
  });

  test('KI-06-01 AC1: the context comes back and the match continues from the same tick', async ({
    page,
  }) => {
    const tickBefore = await startRoundAndArm(page);
    const roundBefore = await page.evaluate(
      () => /** @type {any} */ (globalThis).__kobi.getSeeds().roundIndex,
    );

    const atLoss = await fireContextEvent(page, 'lost');
    expect(atLoss.state).toBe('PAUSE');
    await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      for (let i = 0; i < 300; i += 1) w.__kobi.advance(1 / 60);
    });

    const atRestore = await fireContextEvent(page, 'restored');

    // Back in the round the instant the context returns — and still frozen, because the resume goes through
    // the same one-second READY? beat a player's own RESUME plays (`DESIGN-DECISIONS §2.8`).
    //
    // **The same tick, exactly**: both readings are taken inside the event handlers themselves, so the only
    // thing between them is a paused match. `tickBefore` is the loose bound (the live loop was still running
    // when it was read, a round-trip earlier); `atLoss.tick` is the exact one.
    expect(atRestore.state).toBe('PLAYING');
    expect(atRestore.timeScale).toBe(0);
    expect(atRestore.tick).toBe(atLoss.tick);
    expect(atRestore.tick).toBeGreaterThanOrEqual(tickBefore);
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');

    // The beat ends and the round runs on — the same round, from the tick it stopped on, not a new one.
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toBeHidden();
    const after = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      for (let i = 0; i < 60; i += 1) w.__kobi.advance(1 / 60);
      return {
        state: w.__kobi.getState(),
        tick: w.__kobi.getSnapshot().tick,
        roundIndex: w.__kobi.getSeeds().roundIndex,
      };
    });
    expect(after.state).toBe('PLAYING');
    expect(after.roundIndex).toBe(roundBefore);
    expect(after.tick).toBeGreaterThan(atLoss.tick);
  });

  test('KI-06-01: the picture comes back — a frame is drawn again after the restore', async ({
    page,
  }) => {
    // The renderer declines to draw into a lost context and repairs its drawing buffer on the way back
    // (`renderer.js`'s restore listener). `getDrawCalls()` is three's own counter for the last frame, so a
    // non-zero reading after a restored context is the honest "it is drawing again".
    await startRoundAndArm(page);
    await fireContextEvent(page, 'lost');
    await fireContextEvent(page, 'restored');

    const drawCalls = await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      w.__kobi.fastForward(1 / 60);
      return w.__kobi.getDrawCalls();
    });
    expect(drawCalls).toBeGreaterThan(0);
  });

  test('KI-06-01: a context lost on the main menu pauses nothing and restores cleanly', async ({
    page,
  }) => {
    // `?test=1` runs the state machine in `strict` mode, where an illegal transition throws. A menu has no
    // `AUTO_PAUSE` row and nothing to resume, so this is the test that the guards are really guards.
    await page.goto(DEFAULT_QUERY);
    const errors = /** @type {string[]} */ ([]);
    page.on('pageerror', (error) => errors.push(error.message));

    await page.evaluate(() => {
      const w = /** @type {any} */ (globalThis);
      const canvas = /** @type {HTMLCanvasElement} */ (w.document.getElementById('game'));
      const gl = /** @type {WebGL2RenderingContext} */ (canvas.getContext('webgl2'));
      w.__resilience = { canvas, ext: gl.getExtension('WEBGL_lose_context') };
    });

    const atLoss = await fireContextEvent(page, 'lost');
    const atRestore = await fireContextEvent(page, 'restored');

    expect(atLoss.state).toBe('MAIN_MENU');
    expect(atRestore.state).toBe('MAIN_MENU');
    expect(errors).toEqual([]);
  });
});
