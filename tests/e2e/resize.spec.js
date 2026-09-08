// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KI-16-02 — resizing the window, in a real browser.
 *
 * `tests/unit/game/session.test.js` proves what `session.resize()` does with fakes; this proves that the
 * real listener `main.js` registers is wired to it, that the real camera re-frames, and that the real
 * drawing buffer follows the real canvas box. The three viewports here are the ones
 * `docs/qa/playtests/viewports.md` measured at the extremes of its own list, not a new list.
 *
 * **On measuring "advances no simulated time".** The page runs a live `requestAnimationFrame` loop, and it
 * advances the round in the gaps between Playwright round-trips — `tests/e2e/replay-screen.spec.js` and
 * `determinism.spec.js` both carry the scar. So the tick comparison below happens **inside one synchronous
 * `page.evaluate`**, where no frame callback can interleave, and drives the resize by dispatching the real
 * `resize` event rather than by asking Playwright to change the window. That measures exactly the thing AC3
 * claims — the resize handler itself moves no time — instead of measuring how fast the machine is.
 * Re-framing, which genuinely needs the window to change shape, is a separate test below.
 */

/** The arena's own corners plus one wall thickness of camera margin, projected through the live camera. */
function measureArenaInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  const settings = kobi.sim.settings;
  const margin = settings.camera.margin;
  const { width, height } = settings.grid;

  let worst = 0;
  for (const x of [-margin, width + margin]) {
    for (const z of [-margin, height + margin]) {
      const projected = kobi.projectToNdc(x, 0, z);
      worst = Math.max(worst, Math.abs(projected.x), Math.abs(projected.y));
    }
  }

  const canvas = /** @type {any} */ (globalThis).document.querySelector('#game');
  const box = canvas.getBoundingClientRect();
  return {
    worstNdc: worst,
    bufferWidth: canvas.width,
    bufferHeight: canvas.height,
    cssWidth: Math.round(box.width),
    cssHeight: Math.round(box.height),
    devicePixelRatio: /** @type {any} */ (globalThis).devicePixelRatio,
  };
}

test.describe('KI-16-02 viewport and resize', () => {
  test('KI-16-02 AC3: a resize during PLAYING advances no simulated time', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    expect(await page.evaluate(startMatchInPage)).toBe('PLAYING');

    // Everything inside one synchronous script — see this file's own note on why.
    const result = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const global = /** @type {any} */ (globalThis);

      const before = { tick: kobi.sim.tick, state: kobi.getState() };
      // A player dragging a window edge produces a stream of these, so one is not the interesting case.
      for (let i = 0; i < 25; i += 1) {
        global.dispatchEvent(new global.Event('resize'));
      }
      return { before, after: { tick: kobi.sim.tick, state: kobi.getState() } };
    });

    expect(result.after.tick).toBe(result.before.tick);
    expect(result.after.state).toBe('PLAYING');
    expect(result.after.state).toBe(result.before.state);
  });

  test('KI-16-02 AC1/AC3: the frame after a resize is correctly framed at every shape', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    expect(await page.evaluate(startMatchInPage)).toBe('PLAYING');

    // 1280×720 is the confirmed picture; 1024×768 is the squarest shape in the matrix and 2560×1080 the
    // widest, so between them they cover both ends of the aspect range the framing rule has to hold over.
    for (const [width, height] of [
      [1280, 720],
      [1024, 768],
      [2560, 1080],
      [800, 600],
      [1280, 720],
    ]) {
      await page.setViewportSize({ width, height });

      const measured = await page.evaluate(measureArenaInPage);

      // `DESIGN-DECISIONS §1 row 31`: the whole arena plus one wall thickness is inside the frame, at any
      // aspect ratio. The fit is exact by construction, so the tolerance is float noise and nothing more —
      // a camera that had not re-framed at all would miss this by whole percentage points, not by 1e-6.
      expect(measured.worstNdc).toBeLessThanOrEqual(1 + 1e-6);
      expect(measured.worstNdc).toBeGreaterThan(0.99);

      // The drawing buffer follows the canvas's own box, in whole device pixels: neither stretched (a buffer
      // that kept the old shape) nor blurred (one that is short of the box it is scaled into).
      expect(measured.cssWidth).toBe(width);
      expect(measured.cssHeight).toBe(height);
      expect(measured.bufferWidth).toBe(Math.round(width * measured.devicePixelRatio));
      expect(measured.bufferHeight).toBe(Math.round(height * measured.devicePixelRatio));
    }
  });

  test('KI-16-02 AC2: at 1280×720 the camera is exactly where it has always been', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    expect(await page.evaluate(startMatchInPage)).toBe('PLAYING');

    // Round-tripped through a resize to another shape and back, because "unchanged at 16:9" has to survive
    // the journey, not merely hold on a page that was never resized.
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.setViewportSize({ width: 1280, height: 720 });

    const projected = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      // The near-left corner of the framed box, whose NDC y is the tightest number in the picture.
      return kobi.projectToNdc(-1.5, 0, 25.5);
    });

    // The confirmed picture's own value, from `docs/qa/playtests/viewports.md`: the near edge lands on the
    // bottom of the frame, to within a float ULP.
    expect(projected.y).toBeCloseTo(-1, 9);
    expect(projected.x).toBeCloseTo(-0.5751, 3);
  });
});
