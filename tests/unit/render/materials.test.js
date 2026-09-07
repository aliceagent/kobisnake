import { describe, expect, it } from 'vitest';
import { COLORS, createPowerUpMaterials } from '../../../src/render/materials.js';
import { SETTINGS } from '../../../src/core/settings.js';

/**
 * KS-07-07 (issue #105): `DESIGN-DECISIONS §1 row 20` locks the SLOW pedestal at mid ice-blue `#4FA9DD` and
 * states the rule the colour exists to satisfy — "the icon must contrast with its pedestal as strongly as
 * the bolt does". Sprint 06 shipped an ice-white pedestal under a white snowflake, which satisfied row 20's
 * older wording and was still unreadable at gameplay scale; the review that caught it was somebody looking
 * at pixels. This file exists so the *rule* is what the suite checks, not the hex — a future palette change
 * that keeps `#4FA9DD` but lightens it, or one that swaps the icon, has to keep the contrast or fail here.
 *
 * Relative luminance is the WCAG 2.x definition (`0.2126R + 0.7152G + 0.0722B` over sRGB channels
 * linearised individually). It is used rather than a naive channel average because that is the standard
 * every accessibility tool agrees on, and because a naive average would call white-on-ice-white acceptable.
 */

/**
 * WCAG relative luminance of an sRGB colour.
 *
 * @param {number} hex - `0xRRGGBB`
 * @returns {number} 0 (black) to 1 (white)
 */
function relativeLuminance(hex) {
  const channels = [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff].map((byte) => {
    const c = byte / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * `createPowerUpMaterials` hands back CSS strings for the icon colours and `THREE` materials for the
 * pedestals, so both sides are read back through it rather than from `COLORS` directly — the point is to
 * test what the renderer actually draws, not what the palette happens to declare.
 *
 * @param {string} css - `#rrggbb`
 * @returns {number}
 */
function hexFromCss(css) {
  return Number.parseInt(css.replace('#', ''), 16);
}

describe('KS-07-07 power-up pedestal contrast (DESIGN-DECISIONS §1 row 20, issue #105)', () => {
  it('KS-07-07: the SLOW pedestal is the mid ice-blue row 20 locks', () => {
    expect(COLORS.powerUpSlowPedestal).toBe(0x4fa9dd);
  });

  it('KS-07-07: the snowflake contrasts with its pedestal at least as strongly as the bolt does with its own', () => {
    const materials = createPowerUpMaterials(SETTINGS);

    const slowIcon = relativeLuminance(hexFromCss(materials.slowIconColor));
    const slowPedestal = relativeLuminance(materials.slowPedestal.color.getHex());
    const speedIcon = relativeLuminance(hexFromCss(materials.speedIconColor));
    const speedPedestal = relativeLuminance(materials.speedPedestal.color.getHex());

    const slowDifference = Math.abs(slowIcon - slowPedestal);
    const speedDifference = Math.abs(speedIcon - speedPedestal);

    // Row 20's rule, verbatim: "the icon must contrast with its pedestal as strongly as the bolt does".
    expect(slowDifference).toBeGreaterThanOrEqual(speedDifference);
  });

  it('KS-07-07: the Sprint 06 ice-white pedestal would fail that rule — the assertion above can go red', () => {
    // Without this, the test above is only as good as its ability to fail. `#EAF4FB` under a white snowflake
    // is what shipped in Sprint 06 and what the design review rejected; it must not pass the same check.
    const white = relativeLuminance(0xffffff);
    const iceWhite = relativeLuminance(0xeaf4fb);
    const bolt = relativeLuminance(0xf6c21b);
    const blue = relativeLuminance(0x1f6fe5);

    expect(Math.abs(white - iceWhite)).toBeLessThan(Math.abs(bolt - blue));
  });
});
