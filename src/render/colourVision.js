// @ts-check

/**
 * How far apart two colours look — to everyone, including the roughly one in twelve boys who cannot tell
 * some of them apart (KI-15-01, issue #191, from #152, tracked on #184).
 *
 * **Why this file exists, given `materials.js` already measures contrast.** Improvement 02 judged every pair
 * in the game by one number: WCAG relative-luminance separation (`MIN_LUMINANCE_SEPARATION`). That is the
 * right instrument for *figure against ground* — a white snowflake on an ice-blue pedestal, an apple on the
 * arena floor — and it is what KS-07-07 proved it does well. Applied to two large, saturated, differently
 * hued snake bodies it answers badly: it ranked `red`/`blue` the worst pair in the whole catalogue (0.0048),
 * and `red`/`blue` is the pair every match starts with and one nobody has ever confused, because the two
 * differ across the blue-yellow axis — precisely the difference luminance cannot see. The design lead's
 * ruling on #121 split the rule in two: luminance keeps figure/ground, and player-vs-player pairs get this.
 *
 * The question this file answers is "can two people tell their snakes apart", and it answers it three times:
 * under normal vision, and under simulated protanopia and deuteranopia. A pair is only as good as its worst
 * showing, so {@link worstCaseColourDifference} is what any rule binds.
 *
 * **Sources, because a wrong simulation is worse than no simulation** (the sprint file's named risk):
 *
 * 1. **CIEDE2000** — Sharma, G., Wu, W. & Dalal, E. N. (2005), "The CIEDE2000 color-difference formula:
 *    implementation notes, supplementary test data, and mathematical observations", *Color Research &
 *    Application* 30(1), 21–30. {@link ciede2000} follows that paper's equations (6)–(23) with
 *    k_L = k_C = k_H = 1, including the two details it exists to warn about: the arctangent is taken with
 *    `atan2` and wrapped into [0°, 360°), and the mean hue is chosen by the ±180° cases rather than by a
 *    naive average. `tests/unit/render/colourVision.test.js` reproduces 26 pairs of that paper's
 *    supplementary test data to better than 1e-4, and those include the rows written specifically to catch
 *    both mistakes.
 * 2. **Dichromat simulation** — Viénot, F., Brettel, H. & Mollon, J. D. (1999), "Digital video colourimetry
 *    for simulating colours of dichromats", *Color Research & Application* 24(4), 243–252. Its single-plane
 *    reduction of Brettel, Viénot & Mollon (1997) collapses to one 3×3 matrix per deficiency, applied in
 *    **linear** RGB — {@link DICHROMAT_MATRICES}.
 *
 * **Tritanopia is deliberately absent.** #152 asks for it "if it costs nothing"; it costs something. Viénot
 * et al.'s single-plane reduction is stated for protanopia and deuteranopia, and tritanopia needs the full
 * two-plane 1997 algorithm through LMS. Two numbers that can be cited beat three where the third is quietly
 * wrong, and #152's own judgement is that the two red-green forms are what matter at this palette's scale.
 * If the design lead wants tritanopia it is its own ticket, not a third row bolted on here.
 *
 * **This module imports nothing.** It is pure arithmetic over hex colours: `src/ui/` needs it (KI-15-02 puts
 * the check on the match-setup screen) and must not drag three.js in through it, and `materials.js` needs
 * its gamma decoding, so the dependency runs materials → colourVision and never the other way.
 */

/** The three vision models every player pair is measured under. @type {readonly VisionModel[]} */
export const VISION_MODELS = /** @type {const} */ (['normal', 'protanopia', 'deuteranopia']);

/** @typedef {'normal' | 'protanopia' | 'deuteranopia'} VisionModel */

/**
 * Viénot, Brettel & Mollon (1999), table 1: the single-plane dichromat transforms, as 3×3 matrices in
 * **linear** RGB (row-major, each row the new R', G', B' as a combination of the old R, G, B).
 *
 * Both matrices have identical first and second rows, which is not a typo and is the whole geometry of the
 * thing: a protanope and a deuteranope have two cone classes, not three, so every colour they can see lies
 * on a plane, and R' = G' in linear light is that plane. `colourVision.test.js` asserts it holds for real
 * outputs rather than trusting the constants below to have been typed correctly.
 *
 * @type {Record<Exclude<VisionModel, 'normal'>, readonly (readonly number[])[]>}
 */
export const DICHROMAT_MATRICES = Object.freeze({
  protanopia: Object.freeze([
    Object.freeze([0.11238, 0.88762, 0.0]),
    Object.freeze([0.11238, 0.88762, 0.0]),
    Object.freeze([0.00401, -0.00401, 1.0]),
  ]),
  deuteranopia: Object.freeze([
    Object.freeze([0.29275, 0.70725, 0.0]),
    Object.freeze([0.29275, 0.70725, 0.0]),
    Object.freeze([-0.02234, 0.02234, 1.0]),
  ]),
});

/**
 * Either colour representation the codebase uses, as a plain `0xRRGGBB` number: `COLORS` entries are numbers
 * and `SETTINGS.colors` entries are `'#rrggbb'` strings, and every function here takes both so a pedestal
 * read back through `createPowerUpMaterials` and a player colour read back through `snakeColorHex` can be
 * compared without either call site converting first.
 *
 * @param {number | string} color
 * @returns {number}
 */
export function parseColour(color) {
  return typeof color === 'string' ? Number.parseInt(color.replace('#', ''), 16) : color;
}

/**
 * The three sRGB channels of a colour as **linear** light, 0..1 — gamma removed by the sRGB electro-optical
 * transfer function (IEC 61966-2-1). The single implementation of that decode in the repository:
 * `materials.js`'s `relativeLuminance` weights these channels, and everything below converts them to XYZ.
 *
 * @param {number | string} color
 * @returns {[number, number, number]}
 */
export function linearChannels(color) {
  const hex = parseColour(color);
  return /** @type {[number, number, number]} */ (
    [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff].map((byte) => {
      const c = byte / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    })
  );
}

/**
 * The inverse of {@link linearChannels}: linear light back to an `0xRRGGBB` colour, clamped into gamut. Only
 * {@link simulateVision} needs it — the simulated colour is a real colour a person could be shown, and
 * `colourVision.test.js` prints them so the design lead can look at what a dichromat sees rather than only
 * at a distance number.
 *
 * @param {readonly number[]} channels - linear R, G, B in 0..1 (values outside are clamped)
 * @returns {number} `0xRRGGBB`
 */
function fromLinearChannels(channels) {
  const bytes = channels.map((value) => {
    const clamped = Math.min(1, Math.max(0, value));
    const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.min(255, Math.max(0, Math.round(encoded * 255)));
  });
  return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
}

/**
 * sRGB (IEC 61966-2-1) primaries to CIE XYZ, D65 white, row-major. The middle row is the same
 * `0.2126 / 0.7152 / 0.0722` weighting `materials.js`'s `relativeLuminance` applies — Y *is* relative
 * luminance, which is why the two instruments in this codebase agree about brightness and disagree only
 * about whether brightness was ever the right question.
 */
const SRGB_TO_XYZ = Object.freeze([
  Object.freeze([0.4124564, 0.3575761, 0.1804375]),
  Object.freeze([0.2126729, 0.7151522, 0.072175]),
  Object.freeze([0.0193339, 0.119192, 0.9503041]),
]);

/** CIE D65 white point, 2° standard observer — the reference white L\*a\*b\* is measured against. */
const D65_WHITE = Object.freeze([0.9504559, 1.0, 1.0890578]);

/** CIE 1976 L\*a\*b\* companding constants: (6/29)³ and the linear segment's slope and offset. */
const LAB_EPSILON = 216 / 24389;
const LAB_KAPPA_OVER_116 = 841 / 108;
const LAB_OFFSET = 4 / 29;

/**
 * CIE L\*a\*b\* (D65) of a colour: lightness, green–red, blue–yellow. The space CIEDE2000 is defined in.
 *
 * @param {number | string} color
 * @returns {[number, number, number]} `[L*, a*, b*]`
 */
export function labOf(color) {
  const linear = linearChannels(color);
  const xyz = SRGB_TO_XYZ.map(
    (row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2],
  );
  const [fx, fy, fz] = xyz.map((value, index) => {
    const ratio = value / D65_WHITE[index];
    return ratio > LAB_EPSILON ? Math.cbrt(ratio) : LAB_KAPPA_OVER_116 * ratio + LAB_OFFSET;
  });
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @param {number} radians @returns {number} */
const toDegrees = (radians) => (radians * 180) / Math.PI;
/** @param {number} degrees @returns {number} */
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * CIEDE2000 colour difference between two L\*a\*b\* colours, with k_L = k_C = k_H = 1 (Sharma, Wu & Dalal
 * 2005, equations 6–23). Roughly: 1 is a just-noticeable difference under ideal side-by-side viewing, 2–3 is
 * the difference a careful eye reports, and a value in the tens is "obviously two different colours".
 *
 * Two implementation details this formula is notorious for, both of which the test file's reference data
 * catches if they are got wrong:
 *  - the hue angles come from `atan2` wrapped into [0°, 360°), not from `atan(b/a)`;
 *  - the *mean* hue is not the arithmetic mean. When the two hues are more than 180° apart the mean has to
 *    be taken the short way round the circle, and when either chroma is zero the hue is undefined and the
 *    terms that use it must fall out rather than contribute a wrong angle.
 *
 * @param {readonly number[]} labA - `[L*, a*, b*]`
 * @param {readonly number[]} labB - `[L*, a*, b*]`
 * @returns {number} ΔE₀₀, 0 for identical colours
 */
export function ciede2000(labA, labB) {
  const [l1, a1, b1] = labA;
  const [l2, a2, b2] = labB;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  // G stretches the a* axis for near-neutral colours, which is what fixes CIE94's blue-region behaviour.
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));

  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.hypot(a1p, b1);
  const c2p = Math.hypot(a2p, b2);
  const h1p = a1p === 0 && b1 === 0 ? 0 : (toDegrees(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = a2p === 0 && b2 === 0 ? 0 : (toDegrees(Math.atan2(b2, a2p)) + 360) % 360;

  const deltaLp = l2 - l1;
  const deltaCp = c2p - c1p;

  let deltahp;
  if (c1p * c2p === 0) deltahp = 0;
  else if (Math.abs(h2p - h1p) <= 180) deltahp = h2p - h1p;
  else if (h2p - h1p > 180) deltahp = h2p - h1p - 360;
  else deltahp = h2p - h1p + 360;
  const deltaHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(toRadians(deltahp) / 2);

  const meanLp = (l1 + l2) / 2;
  const meanCp = (c1p + c2p) / 2;

  let meanHp;
  if (c1p * c2p === 0) meanHp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) meanHp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) meanHp = (h1p + h2p + 360) / 2;
  else meanHp = (h1p + h2p - 360) / 2;

  const t =
    1 -
    0.17 * Math.cos(toRadians(meanHp - 30)) +
    0.24 * Math.cos(toRadians(2 * meanHp)) +
    0.32 * Math.cos(toRadians(3 * meanHp + 6)) -
    0.2 * Math.cos(toRadians(4 * meanHp - 63));

  const sL = 1 + (0.015 * (meanLp - 50) ** 2) / Math.sqrt(20 + (meanLp - 50) ** 2);
  const sC = 1 + 0.045 * meanCp;
  const sH = 1 + 0.015 * meanCp * t;

  // The rotation term: it exists for the blue region, where chroma and hue errors trade off.
  const deltaTheta = 30 * Math.exp(-(((meanHp - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const rT = -Math.sin(toRadians(2 * deltaTheta)) * rC;

  const lTerm = deltaLp / sL;
  const cTerm = deltaCp / sC;
  const hTerm = deltaHp / sH;
  return Math.sqrt(lTerm ** 2 + cTerm ** 2 + hTerm ** 2 + rT * cTerm * hTerm);
}

/**
 * A colour as someone with the given vision sees it. `'normal'` hands the colour straight back; the two
 * dichromacies project it onto their plane through {@link DICHROMAT_MATRICES}, in linear light, and re-encode
 * to sRGB.
 *
 * The projection is idempotent by construction — simulating an already-simulated colour changes nothing,
 * because it is already on the plane — and leaves greys untouched, both asserted in the test file.
 *
 * @param {number | string} color
 * @param {VisionModel} model
 * @returns {number} `0xRRGGBB`
 */
export function simulateVision(color, model) {
  if (model === 'normal') return parseColour(color);
  const matrix = DICHROMAT_MATRICES[model];
  if (matrix === undefined) {
    throw new RangeError(`colourVision: "${model}" is not a vision model`);
  }
  const linear = linearChannels(color);
  return fromLinearChannels(
    matrix.map((row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2]),
  );
}

/**
 * How different two colours look to someone with the given vision: CIEDE2000 between them, both passed
 * through {@link simulateVision} first.
 *
 * @param {number | string} a
 * @param {number | string} b
 * @param {VisionModel} model
 * @returns {number} ΔE₀₀
 */
export function colourDifference(a, b, model) {
  return ciede2000(labOf(simulateVision(a, model)), labOf(simulateVision(b, model)));
}

/**
 * The number any rule binds: the *smallest* of the three {@link VISION_MODELS} differences, because a pair of
 * player colours has to work for whoever is holding the keyboard, not on average.
 *
 * @param {number | string} a
 * @param {number | string} b
 * @returns {number} ΔE₀₀ under the vision model that separates the two least
 */
export function worstCaseColourDifference(a, b) {
  return Math.min(...VISION_MODELS.map((model) => colourDifference(a, b, model)));
}

/**
 * Minimum {@link worstCaseColourDifference} required between two players' snake colours (KI-15-01, issue
 * #191, proposed on #184 with the whole 28×3 matrix as evidence, ruled on by the design lead).
 *
 * **Why 15, and why the exact number matters less than it looks.** The 28 pairs of today's catalogue, sorted
 * by their worst-case difference, are
 * `3.1 4.3 5.7 7.2 9.4 9.9 10.4 11.3 11.7 │ 18.7 22.8 24.4 …` — a 7.0-wide empty band between 11.7 and 18.7,
 * the largest gap anywhere in the lower two-thirds of the distribution. **Every threshold from 12 through 18
 * fails exactly the same nine pairs**, so this constant was not fitted to the palette: the palette decides
 * which pairs fail, and the constant only has to land in the band. 15 is its middle, which is what buys the
 * robustness — a colour retinted slightly in Sprint 14 cannot flip the rule by nudging a pair across a line.
 *
 * That it is roughly six times the ≈2.3 ΔE₀₀ usually quoted as a just-noticeable difference is the sanity
 * check, not the derivation: a JND is measured on adjacent patches under ideal viewing, and two snakes at
 * gameplay scale, in motion, across a 24×24 arena, glanced at rather than studied, is the opposite of that.
 *
 * For scale, `red`/`blue` — the pair every match starts with, and the pair WCAG luminance called the worst in
 * the catalogue at 0.0048 — measures **47.75 normal, 59.13 protanope, 69.13 deuteranope**. It clears this
 * constant more than threefold and it gets *better* under both deficiencies.
 */
export const MIN_COLOUR_DIFFERENCE = 15;
