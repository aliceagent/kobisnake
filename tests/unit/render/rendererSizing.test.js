import { describe, expect, it, vi } from 'vitest';
import { measureCanvas, resizeRendererToCanvas } from '../../../src/render/renderer.js';

/**
 * KI-16-02 — how the drawing buffer is sized.
 *
 * `renderer.js` is the one file `vitest.config.js` excludes from the coverage floor, because it owns
 * `THREE.WebGLRenderer` and cannot execute in Node. These two functions are the exception that proves the
 * rule: they are plain arithmetic over a canvas's measurements, they never touch a GL context, and they are
 * exactly the part of resizing that can be wrong silently. A stretched picture and a blurred one both look
 * like "the renderer is fine, the window is odd", so they are asserted here in numbers rather than left to
 * a screenshot to notice.
 *
 * The fakes are deliberately plain objects rather than three doubles: `measureCanvas` reads two integers off
 * a canvas and `resizeRendererToCanvas` calls two setters, and anything more elaborate would be testing
 * three.js.
 */

/** @param {number} clientWidth @param {number} clientHeight */
function fakeCanvas(clientWidth, clientHeight) {
  return /** @type {any} */ ({ clientWidth, clientHeight });
}

function fakeRenderer() {
  return /** @type {any} */ ({ setPixelRatio: vi.fn(), setSize: vi.fn() });
}

describe('KI-16-02 measureCanvas', () => {
  it('measures the canvas box, not the window', () => {
    // The whole point of the change: `window.innerWidth` is the window's content box, and what has to be
    // filled without stretching is the canvas element's box. They agree today only because `styles.css`
    // gives `#game` 100 % of a `body` with `overflow: hidden`.
    expect(measureCanvas(fakeCanvas(1024, 768), 1)).toEqual({
      cssWidth: 1024,
      cssHeight: 768,
      bufferWidth: 1024,
      bufferHeight: 768,
      pixelRatio: 1,
    });
  });

  it('KI-16-02: at DPR 2 a 1280×720 box gets the 2560×1440 buffer the matrix measured', () => {
    // `docs/qa/playtests/viewports.md`'s `1280x720@2` row, reproduced without a browser.
    const measured = measureCanvas(fakeCanvas(1280, 720), 2);
    expect(measured.bufferWidth).toBe(2560);
    expect(measured.bufferHeight).toBe(1440);
    expect(measured.pixelRatio).toBe(2);
  });

  it('KI-16-02: the pixel ratio stays capped at 2 (ARCHITECTURE §7, §12)', () => {
    // A 3× display costs nine times the pixels for a picture made of big flat bricks.
    const measured = measureCanvas(fakeCanvas(1280, 720), 3);
    expect(measured.pixelRatio).toBe(2);
    expect(measured.bufferWidth).toBe(2560);
  });

  it('KI-16-02: a fractional DPR rounds to the nearest whole device pixel rather than truncating', () => {
    // Browser zoom at 125 % and 150 % is DPR 1.25 and 1.5, and three's own `setSize` computes
    // `floor(css × ratio)`. At a 853-px box and 1.5 that is floor(1279.5) = 1279 — one device pixel short of
    // the 1280 the box actually occupies, which the browser then scales up, and the result is a softly
    // blurred picture with nothing to point at.
    expect(measureCanvas(fakeCanvas(853, 480), 1.5).bufferWidth).toBe(1280);
    expect(Math.floor(853 * 1.5)).toBe(1279); // what the truncating version would have produced
    expect(measureCanvas(fakeCanvas(1000, 700), 1.25)).toMatchObject({
      bufferWidth: 1250,
      bufferHeight: 875,
    });
  });

  it('KI-16-02: a nonsense device pixel ratio falls back to 1 rather than producing a nonsense buffer', () => {
    for (const ratio of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(measureCanvas(fakeCanvas(800, 600), ratio)).toMatchObject({
        bufferWidth: 800,
        bufferHeight: 600,
        pixelRatio: 1,
      });
    }
  });

  it('KI-16-02: a canvas with no area is reported faithfully rather than clamped', () => {
    // Deciding what to do about it is `resizeRendererToCanvas`'s job, not this function's.
    expect(measureCanvas(fakeCanvas(0, 0), 2)).toMatchObject({
      cssWidth: 0,
      cssHeight: 0,
      bufferWidth: 0,
      bufferHeight: 0,
    });
  });
});

describe('KI-16-02 resizeRendererToCanvas', () => {
  it('KI-16-02: sizes the buffer in device pixels and returns the CSS aspect ratio', () => {
    const renderer = fakeRenderer();

    const aspect = resizeRendererToCanvas(renderer, fakeCanvas(1280, 720), 2);

    // The aspect the camera is re-framed for is the *CSS* box's, not the buffer's — they are the same ratio
    // here, and would still be the same ratio at any DPR, which is why DPR never reaches the camera.
    expect(aspect).toBeCloseTo(16 / 9, 12);
    // Ratio 1 plus an explicit device-pixel size, so three does not multiply and truncate a number this
    // module has already computed exactly.
    expect(renderer.setPixelRatio).toHaveBeenCalledWith(1);
    expect(renderer.setSize).toHaveBeenCalledWith(2560, 1440, false);
  });

  it('KI-16-02: `false` for updateStyle — the stylesheet owns the element box', () => {
    const renderer = fakeRenderer();
    resizeRendererToCanvas(renderer, fakeCanvas(800, 600), 1);
    expect(renderer.setSize.mock.calls[0][2]).toBe(false);
  });

  it('KI-16-02: a canvas with no area is left alone entirely', () => {
    // A minimised window reports 0 × 0. Resizing the buffer to zero would mean the *restore* is what has to
    // repair it, with a blank frame in between; leaving it exactly as it was has nothing to repair.
    const renderer = fakeRenderer();

    expect(resizeRendererToCanvas(renderer, fakeCanvas(0, 0), 1)).toBeNull();

    expect(renderer.setSize).not.toHaveBeenCalled();
    expect(renderer.setPixelRatio).not.toHaveBeenCalled();
  });

  it('KI-16-02: every viewport in the matrix produces a buffer that exactly covers its box', () => {
    // The invariant behind "no stretching and no blurring", over KI-16-01's own list: whatever the size and
    // whatever the DPR, buffer ÷ ratio is the CSS box back again, to within the half-pixel that rounding to
    // whole device pixels costs.
    const viewports = [
      { width: 1280, height: 720, dpr: 1 },
      { width: 1024, height: 768, dpr: 1 },
      { width: 800, height: 600, dpr: 1 },
      { width: 1920, height: 1080, dpr: 1 },
      { width: 2560, height: 1080, dpr: 1 },
      { width: 1280, height: 720, dpr: 2 },
      { width: 640, height: 480, dpr: 1 },
      // Browser zoom, which nothing in the matrix covers.
      { width: 853, height: 480, dpr: 1.5 },
      { width: 1024, height: 576, dpr: 1.25 },
    ];

    for (const { width, height, dpr } of viewports) {
      const { bufferWidth, bufferHeight, pixelRatio } = measureCanvas(
        fakeCanvas(width, height),
        dpr,
      );
      expect(Math.abs(bufferWidth / pixelRatio - width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(bufferHeight / pixelRatio - height)).toBeLessThanOrEqual(0.5);
      expect(Number.isInteger(bufferWidth)).toBe(true);
      expect(Number.isInteger(bufferHeight)).toBe(true);
    }
  });
});
