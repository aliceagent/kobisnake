import { describe, expect, it } from 'vitest';
import {
  ciede2000,
  colourDifference,
  DICHROMAT_MATRICES,
  labOf,
  linearChannels,
  MIN_COLOUR_DIFFERENCE,
  simulateVision,
  VISION_MODELS,
  worstCaseColourDifference,
} from '../../../src/render/colourVision.js';
import {
  COLORS,
  createAppleMaterials,
  createPowerUpMaterials,
  snakeColorHex,
} from '../../../src/render/materials.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { assertContrastRule } from './contrastRule.js';

/**
 * KI-15-01 (issue #191, from #152, tracked on #184): the instrument that replaces the luminance rule for
 * player-vs-player pairs, and the 28×3 matrix it produces.
 *
 * The order of this file is the order the sprint file's own risk section demands — **"test the simulator
 * against known confusion pairs before trusting a single result"**. So nothing here measures the palette
 * until CIEDE2000 has been checked against its published test data and the dichromat simulation has been
 * checked against its published matrices, its structural invariants and the colour pairs a red-green
 * deficiency is *documented* to confuse. Only then does the matrix mean anything.
 */

/** Every colour compared as `0xRRGGBB`, so a `'#rrggbb'` catalogue entry and a `COLORS` number match. */
const hexOf = (color) =>
  `#${(typeof color === 'string' ? Number.parseInt(color.replace('#', ''), 16) : color)
    .toString(16)
    .padStart(6, '0')
    .toUpperCase()}`;

describe('KI-15-01 CIEDE2000 against its published test data (Sharma, Wu & Dalal 2005)', () => {
  /**
   * The supplementary test data of Sharma, Wu & Dalal (2005), *Color Research & Application* 30(1) — L*a*b*
   * pair, then the ΔE₀₀ the paper reports. This is the whole reason to believe `ciede2000` at all: the
   * formula has two well-known implementation traps and this data was published to catch them.
   *
   *  - **Rows 9–12** are the hue-wraparound trap: `(50, 2.49, −0.001)` against `(50, −2.49, 0.0009)` is
   *    7.1792 and the same pair with the second b* at `+0.0011` is 7.2195. The two differ by two ten-
   *    thousandths of a b* and by 0.04 of a ΔE₀₀, because the mean hue jumps the long way round the circle
   *    between them. An implementation that averages the two hue angles arithmetically gets one of these
   *    right and the other wrong.
   *  - **Rows 13 and 18–22** exercise the R_T rotation term in the blue region, which is the other half of
   *    what CIEDE2000 adds over CIE94 and the easiest term to drop silently.
   *  - **Rows 24–27** are near-neutral and near-black, where the a*-axis stretch `G` and the L* weighting
   *    `S_L` do the work.
   *
   * A 27th pair from the same set is deliberately **not** here: its published value could not be confirmed
   * against a source, so it was dropped rather than reconciled toward whatever this implementation happened
   * to produce — which would have turned a reference test into a tautology. 26 pairs including every trap
   * above is enough to establish the formula; one unverifiable row is not worth the confusion it would
   * record.
   *
   * @type {readonly [number[], number[], number][]}
   */
  const SHARMA_TEST_DATA = [
    [[50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425],
    [[50.0, 3.1571, -77.2803], [50.0, 0.0, -82.7485], 2.8615],
    [[50.0, 2.8361, -74.02], [50.0, 0.0, -82.7485], 3.4412],
    [[50.0, -1.3802, -84.2814], [50.0, 0.0, -82.7485], 1.0],
    [[50.0, -1.1848, -84.8006], [50.0, 0.0, -82.7485], 1.0],
    [[50.0, -0.9009, -85.5211], [50.0, 0.0, -82.7485], 1.0],
    [[50.0, 0.0, 0.0], [50.0, -1.0, 2.0], 2.3669],
    [[50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669],
    [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0009], 7.1792],
    [[50.0, 2.49, -0.001], [50.0, -2.49, 0.001], 7.1792],
    [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0011], 7.2195],
    [[50.0, 2.49, -0.001], [50.0, -2.49, 0.0012], 7.2195],
    [[50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492],
    [[50.0, 2.5, 0.0], [61.0, -5.0, 29.0], 22.8977],
    [[50.0, 2.5, 0.0], [56.0, -27.0, -3.0], 31.903],
    [[50.0, 2.5, 0.0], [58.0, 24.0, 15.0], 19.4535],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[63.0109, -31.0961, -5.8663], [62.8187, -29.7946, -4.0864], 1.263],
    [[61.2901, 3.7196, -5.3901], [61.4292, 2.248, -4.962], 1.8731],
    [[35.0831, -44.1164, 3.7933], [35.0232, -40.0716, 1.5901], 1.8645],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[36.4612, 47.858, 18.3852], [36.2715, 50.5065, 21.2231], 1.4146],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[90.9257, -0.5406, -0.9208], [88.6381, -0.8985, -0.7239], 1.5381],
    [[6.7747, -0.2908, -2.4247], [5.8714, -0.0985, -2.2286], 0.6377],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];

  it('KI-15-01: reproduces all 26 reference pairs to better than 1e-4', () => {
    for (const [labA, labB, expected] of SHARMA_TEST_DATA) {
      expect(
        ciede2000(labA, labB),
        `${JSON.stringify(labA)} vs ${JSON.stringify(labB)}`,
      ).toBeCloseTo(expected, 4);
    }
  });

  it('KI-15-01: the hue-wraparound rows really do discriminate — a naive mean hue gets them wrong', () => {
    // Proves the two rows above are load-bearing rather than decorative. The pairs differ only in the fourth
    // decimal of one b*, and the published answers differ by 0.04. If this file's `ciede2000` took the
    // arithmetic mean of the two hue angles, both rows would come back with the same value and the reference
    // test above would still pass on one of them by luck.
    const below = ciede2000([50.0, 2.49, -0.001], [50.0, -2.49, 0.001]);
    const above = ciede2000([50.0, 2.49, -0.001], [50.0, -2.49, 0.0011]);
    expect(below).not.toBeCloseTo(above, 3);
    expect(above - below).toBeCloseTo(0.0403, 3);
  });

  it('KI-15-01: identical colours are zero and the measure is symmetric', () => {
    for (const name of Object.keys(SETTINGS.colors)) {
      const hex = snakeColorHex(name, SETTINGS);
      expect(colourDifference(hex, hex, 'normal')).toBe(0);
    }
    const red = snakeColorHex('red', SETTINGS);
    const blue = snakeColorHex('blue', SETTINGS);
    expect(colourDifference(red, blue, 'normal')).toBeCloseTo(
      colourDifference(blue, red, 'normal'),
      12,
    );
  });

  it('KI-15-01: L*a*b* anchors — white is L*100, black is L*0, mid grey is L*53.6', () => {
    // A cheap independent check on the sRGB -> XYZ -> Lab chain feeding CIEDE2000: if the white point or the
    // companding were wrong, these three would drift and every number in this file would be wrong with them.
    const [whiteL, whiteA, whiteB] = labOf(0xffffff);
    expect(whiteL).toBeCloseTo(100, 3);
    expect(Math.hypot(whiteA, whiteB)).toBeLessThan(0.05);
    expect(labOf(0x000000)).toEqual([0, 0, 0]);
    expect(labOf(0x808080)[0]).toBeCloseTo(53.585, 2);
  });
});

describe('KI-15-01 the dichromat simulation (Viénot, Brettel & Mollon 1999)', () => {
  it('KI-15-01: the matrices are the published ones', () => {
    // Typed from the paper; pinned here so a later "tidy-up" of the constants is a test failure rather than
    // a silent change to what the whole sprint measures.
    expect(DICHROMAT_MATRICES.protanopia).toEqual([
      [0.11238, 0.88762, 0.0],
      [0.11238, 0.88762, 0.0],
      [0.00401, -0.00401, 1.0],
    ]);
    expect(DICHROMAT_MATRICES.deuteranopia).toEqual([
      [0.29275, 0.70725, 0.0],
      [0.29275, 0.70725, 0.0],
      [-0.02234, 0.02234, 1.0],
    ]);
    // Each row of a dichromat transform is a weighted average of the cones that remain, so the two rows that
    // collapse must sum to 1: a matrix that did not would darken or brighten everything it touched.
    for (const matrix of Object.values(DICHROMAT_MATRICES)) {
      expect(matrix[0][0] + matrix[0][1] + matrix[0][2]).toBeCloseTo(1, 5);
      expect(matrix[1][0] + matrix[1][1] + matrix[1][2]).toBeCloseTo(1, 5);
    }
  });

  it('KI-15-01: every simulated colour lands on the dichromat plane (R′ = G′ in linear light)', () => {
    // The defining property of these two deficiencies: two cone classes, not three, so the gamut is a plane.
    // Asserted on real outputs rather than inferred from the constants above.
    for (const model of ['protanopia', 'deuteranopia']) {
      for (const name of Object.keys(SETTINGS.colors)) {
        const [r, g] = linearChannels(simulateVision(snakeColorHex(name, SETTINGS), model));
        expect(r, `${model} ${name}`).toBeCloseTo(g, 3);
      }
    }
  });

  it('KI-15-01: greys are unchanged and the projection is idempotent', () => {
    // A dichromat sees achromatic colours exactly as everyone else does, so a simulation that moved them
    // would be wrong on the easiest possible input. And projecting onto a plane twice must equal projecting
    // once — a transform that failed this would not be a projection at all.
    for (const model of ['protanopia', 'deuteranopia']) {
      for (const grey of [0x000000, 0x808080, 0xffffff]) {
        expect(simulateVision(grey, model), `${model} ${hexOf(grey)}`).toBe(grey);
      }
      for (const name of Object.keys(SETTINGS.colors)) {
        const once = simulateVision(snakeColorHex(name, SETTINGS), model);
        expect(simulateVision(once, model), `${model} ${name}`).toBe(once);
      }
    }
    // 'normal' is the identity, so it must satisfy both trivially.
    expect(simulateVision('#E3261B', 'normal')).toBe(0xe3261b);
  });

  it('KI-15-01: known red-green confusion pairs collapse, and the blue-yellow axis survives', () => {
    // The check the sprint file names as its risk mitigation, done on documented behaviour rather than on
    // this palette: red-green deficiency confuses reds against greens and leaves the blue-yellow axis alone.
    // A simulator that failed either of these would be wrong however carefully its matrices were typed.
    const midRed = '#AA0000';
    const midGreen = '#005500';
    expect(colourDifference(midRed, midGreen, 'normal')).toBeGreaterThan(50);
    expect(colourDifference(midRed, midGreen, 'protanopia')).toBeLessThan(10);
    expect(colourDifference(midRed, midGreen, 'deuteranopia')).toBeLessThan(10);

    const blue = snakeColorHex('blue', SETTINGS);
    const yellow = snakeColorHex('yellow', SETTINGS);
    for (const model of VISION_MODELS) {
      expect(colourDifference(blue, yellow, model), model).toBeGreaterThan(60);
    }
  });

  it('KI-15-01: an unknown vision model throws rather than silently measuring normal vision', () => {
    expect(() => simulateVision('#E3261B', /** @type {any} */ ('tritanopia'))).toThrow(RangeError);
  });
});

/**
 * Every unordered pair among the current player-colour catalogue, built combinatorially from
 * `Object.keys(settings.colors)` — never a hand-written list of 28 names. That is what makes a ninth colour
 * appended to the catalogue get measured automatically (AC3): `n·(n−1)/2` pairs fall out of the catalogue's
 * size on its own.
 *
 * Keys are alphabetised (`player <a> vs player <b>`, `a < b`) so a pair has exactly one key whatever order
 * `Object.keys` returns, which is what lets {@link PLAYER_PAIR_WAIVERS} name each one once. This is
 * deliberately the same key shape KI-02-03 used before its block was deleted from `materials.test.js`, so
 * the two sets of numbers on #121 and #184 can be read against each other pair for pair.
 *
 * @param {import('../../../src/core/settings.js').Settings} settings
 * @returns {{ key: string, a: string, b: string }[]}
 */
function buildAllPlayerColourPairs(settings) {
  const names = Object.keys(settings.colors);
  /** @type {{ key: string, a: string, b: string }[]} */
  const pairs = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const [nameA, nameB] = [names[i], names[j]].sort();
      pairs.push({
        key: `player ${nameA} vs player ${nameB}`,
        a: snakeColorHex(nameA, settings),
        b: snakeColorHex(nameB, settings),
      });
    }
  }
  return pairs;
}

/**
 * The measurement side of the rule for a plain two-colour pair: the worst of the three vision models, with
 * all three named in the failure message so a regression under one model is visible even when another is
 * carrying the pair.
 *
 * @param {{ a: number | string, b: number | string }} pair
 * @returns {{ value: number, detail: string }}
 */
function visionMeasure(pair) {
  const perModel = VISION_MODELS.map((model) => colourDifference(pair.a, pair.b, model));
  return {
    value: Math.min(...perModel),
    detail: VISION_MODELS.map((model, i) => `${model} ${perModel[i].toFixed(2)}`).join(', '),
  };
}

/** The colour-vision half of the split rule, passed to the shared `assertContrastRule`. */
const COLOUR_VISION_RULE = {
  minimum: MIN_COLOUR_DIFFERENCE,
  measure: visionMeasure,
  name: 'MIN_COLOUR_DIFFERENCE',
};

/**
 * The nine pairs of today's eight player colours that measure below `MIN_COLOUR_DIFFERENCE`, worst first,
 * recorded as ratcheted waivers in the shape KI-02-01 established and floored to four decimal places below
 * the real value so the ratchet never trips on float noise.
 *
 * **Nothing is repainted here.** The catalogue is locked by `DESIGN-DECISIONS §2.7`, `src/core/settings.js`
 * is off-limits regardless (`CLAUDE.md`'s never list), and the sprint file is explicit that this ticket
 * reports and does not decide. All nine are blocked on #184 for the design lead, where the full 28×3 matrix
 * and the four findings below are written up.
 *
 * **The shipping game is unaffected.** Only `red` and `blue` are owned from the start, so `red`/`blue` is the
 * one reachable pair today, and it measures 47.75 — twentieth of twenty-eight, and better under both
 * deficiencies than under normal vision. Everything in this map is Sprint 14's problem arriving early, which
 * is what #152 asked this ticket to be.
 *
 *  - `blue`/`purple` **3.13** — the worst pair in the catalogue and a new finding: under deuteranopia blue
 *    becomes `#6060E5` and purple `#5D5DD0`. Luminance ranked it fifth and nobody flagged it. Blue is free
 *    and is player two's default; purple is a 3-key unlock.
 *  - `gold`/`yellow` **4.29** — fails under *normal* vision too (5.31), which is the design lead's own
 *    reading on #121 ("a genuine product problem whatever the metric") arriving as a number.
 *  - `gold`/`green` **5.69**, `gold`/`orange` **7.16** — `gold` fails three of its seven partners and is the
 *    6-key flagship of the shop.
 *  - `green`/`orange` **9.40** — the classic red-green pair, already flagged for Sprint 14 on #121.
 *  - `green`/`red` **9.88** — green is the cheapest unlock (2 keys) and red is player one's default.
 *  - `green`/`yellow` **10.39**, `orange`/`yellow` **11.29**, `orange`/`red` **11.66** — the warm cluster,
 *    which collapses onto one olive-yellow line under both deficiencies.
 */
const PLAYER_PAIR_WAIVERS = {
  'player blue vs player purple': { measured: 3.1272, blockedBy: '#184' },
  'player gold vs player yellow': { measured: 4.2894, blockedBy: '#184' },
  'player gold vs player green': { measured: 5.6941, blockedBy: '#184' },
  'player gold vs player orange': { measured: 7.1611, blockedBy: '#184' },
  'player green vs player orange': { measured: 9.397, blockedBy: '#184' },
  'player green vs player red': { measured: 9.8762, blockedBy: '#184' },
  'player green vs player yellow': { measured: 10.3923, blockedBy: '#184' },
  'player orange vs player yellow': { measured: 11.2938, blockedBy: '#184' },
  'player orange vs player red': { measured: 11.6608, blockedBy: '#184' },
};

describe('KI-15-01 AC1: the 28×3 player-pair matrix (issue #191, from #152, tracked on #184)', () => {
  it("KI-15-01 AC1: the pair count derived from SETTINGS.colors is 28 for today's eight colours", () => {
    const names = Object.keys(SETTINGS.colors);
    expect(names.length).toBe(8);
    expect(buildAllPlayerColourPairs(SETTINGS).length).toBe(
      (names.length * (names.length - 1)) / 2,
    );
    expect(buildAllPlayerColourPairs(SETTINGS).length).toBe(28);
  });

  it('KI-15-01 AC1: every pair is measured under all three vision models — the matrix is 28×3', () => {
    // The "28×3 matrix committed" half of AC1: 84 measurements exist, each a finite non-negative number, and
    // the recorded worst case is genuinely the smallest of its row rather than whichever one was convenient.
    const pairs = buildAllPlayerColourPairs(SETTINGS);
    expect(VISION_MODELS.length).toBe(3);
    let measurements = 0;
    for (const pair of pairs) {
      const perModel = VISION_MODELS.map((model) => colourDifference(pair.a, pair.b, model));
      for (const value of perModel) {
        expect(Number.isFinite(value), pair.key).toBe(true);
        expect(value, pair.key).toBeGreaterThanOrEqual(0);
        measurements += 1;
      }
      expect(worstCaseColourDifference(pair.a, pair.b), pair.key).toBeCloseTo(
        Math.min(...perModel),
        12,
      );
    }
    expect(measurements).toBe(28 * 3);
  });

  it('KI-15-01 AC1: all 28 pairs clear MIN_COLOUR_DIFFERENCE or are an exact, ratcheted, reported waiver', () => {
    // The same three-part rule KI-02-01 wrote, from the same `assertContrastRule` — (a) every non-waived
    // pair clears the constant, (b) every waived pair still measures at least what is recorded, (c) the
    // waiver list is exactly the set that fails. Nothing may be waived that actually passes.
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(SETTINGS),
        PLAYER_PAIR_WAIVERS,
        COLOUR_VISION_RULE,
      ),
    ).not.toThrow();
    expect(Object.keys(PLAYER_PAIR_WAIVERS)).toHaveLength(9);
  });

  it('KI-15-01 AC1: red/blue — the pair every match starts with — clears the rule under all three models', () => {
    // The point of the whole sprint, as a named assertion. WCAG luminance ranked this pair *last* of 28 at
    // 0.0048 and the design lead ruled that was the instrument being wrong rather than the palette. Here it
    // is 20th of 28, and it gets better under both deficiencies rather than worse, because red moves down
    // the collapsed axis while blue does not move at all.
    const red = snakeColorHex('red', SETTINGS);
    const blue = snakeColorHex('blue', SETTINGS);
    expect(colourDifference(red, blue, 'normal')).toBeCloseTo(47.75, 1);
    expect(colourDifference(red, blue, 'protanopia')).toBeCloseTo(59.13, 1);
    expect(colourDifference(red, blue, 'deuteranopia')).toBeCloseTo(69.13, 1);
    expect(worstCaseColourDifference(red, blue)).toBeGreaterThan(3 * MIN_COLOUR_DIFFERENCE);
    expect(Object.keys(PLAYER_PAIR_WAIVERS)).not.toContain('player blue vs player red');
  });

  it('KI-15-01 AC1: the threshold sits in an empty band — 12 through 18 fail exactly the same nine pairs', () => {
    // Why `MIN_COLOUR_DIFFERENCE` is not a number fitted to the palette (#152: "propose, do not pick and
    // fit"). The sorted worst-case values jump from 11.66 to 18.71, so the ruling is insensitive across a
    // 7-wide band and 15 is its middle. If a future repaint lands a pair inside that band this test fails —
    // which is the moment the constant genuinely becomes a choice again and the design lead should hear so.
    const worst = buildAllPlayerColourPairs(SETTINGS)
      .map((pair) => worstCaseColourDifference(pair.a, pair.b))
      .sort((x, y) => x - y);
    const failingAt = (threshold) => worst.filter((value) => value < threshold).length;

    expect(MIN_COLOUR_DIFFERENCE).toBeGreaterThanOrEqual(12);
    expect(MIN_COLOUR_DIFFERENCE).toBeLessThanOrEqual(18);
    for (let threshold = 12; threshold <= 18; threshold += 1) {
      expect(failingAt(threshold), `threshold ${threshold}`).toBe(9);
    }
    expect(worst[8]).toBeCloseTo(11.66, 1);
    expect(worst[9]).toBeCloseTo(18.71, 1);
  });

  it('KI-15-01 AC1: prove the rule can go red — the worst pair unwaived fails, with its real measurement', () => {
    // KS-07-07/KI-02-01's "prove the test can go red" pattern. Not a synthetic collision: the actual worst
    // pair in the shipping catalogue, run through the actual rule with its waiver removed, has to be
    // rejected — otherwise the nine waivers above are decoration.
    const withoutWorstWaiver = { ...PLAYER_PAIR_WAIVERS };
    delete withoutWorstWaiver['player blue vs player purple'];
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(SETTINGS),
        withoutWorstWaiver,
        COLOUR_VISION_RULE,
      ),
    ).toThrow(/player blue vs player purple/);

    // And the ratchet works in the other direction too: a waiver claiming a better measurement than the
    // colours actually achieve must fail, so a waiver can never be quietly loosened to cover a regression.
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(SETTINGS),
        {
          ...PLAYER_PAIR_WAIVERS,
          'player blue vs player purple': { measured: 14, blockedBy: '#184' },
        },
        COLOUR_VISION_RULE,
      ),
    ).toThrow(/regressed below its recorded measurement/);
  });
});

describe('KI-15-01 AC3: a ninth colour cannot ship unmeasured', () => {
  it('KI-15-01 AC3: a colour added to SETTINGS.colors is measured automatically, not skipped', () => {
    // Structural half: the table tracks the catalogue rather than a fixed list of 28 names. Sprint 14 adds
    // six colours; this is what makes that safe.
    const extended = withOverrides({ colors: { syntheticNinth: '#123456' } });
    const basePairs = buildAllPlayerColourPairs(SETTINGS);
    const extendedPairs = buildAllPlayerColourPairs(extended);

    expect(extendedPairs.length).toBe(basePairs.length + 8); // one new pair against each existing colour
    expect(extendedPairs.length).toBe((9 * 8) / 2);
    for (const name of Object.keys(SETTINGS.colors)) {
      const [a, b] = [name, 'syntheticNinth'].sort();
      expect(extendedPairs.some((pair) => pair.key === `player ${a} vs player ${b}`)).toBe(true);
    }
  });

  it('KI-15-01 AC3: a ninth colour that collides with an existing one fails the rule, not passes silently', () => {
    // Enforcement half. The synthetic colour is player blue's own hex read back through `snakeColorHex`, so
    // the collision is 0 by construction whatever blue is today or becomes later — and no waiver names it.
    const extended = withOverrides({ colors: { syntheticNinth: snakeColorHex('blue', SETTINGS) } });

    // The unmodified palette must not throw, so the throw below is evidence of the added colour specifically
    // rather than of some unrelated breakage in the table or the rule.
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(SETTINGS),
        PLAYER_PAIR_WAIVERS,
        COLOUR_VISION_RULE,
      ),
    ).not.toThrow();
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(extended),
        PLAYER_PAIR_WAIVERS,
        COLOUR_VISION_RULE,
      ),
    ).toThrow(/syntheticNinth/);
  });

  it('KI-15-01 AC3: a ninth colour that is merely *similar* fails too, not only an exact duplicate', () => {
    // A duplicate hex is the easy case, and it is not the one Sprint 14 will actually hit. The real risk is
    // a colour chosen by eye, by someone with ordinary vision, that looks obviously distinct to them and
    // collapses for somebody else — which is the entire reason this instrument exists and something the
    // luminance rule could never have caught.
    //
    // `#444422`, a dark olive, is **41 ΔE₀₀ or more from every one of the eight** under normal vision: not
    // marginal, not a near-miss, a colour nobody would look at twice. Under protanopia player red becomes
    // `#5B5B1F` and the two land 9.6 apart. The guard has to reject it anyway.
    const darkOlive = '#444422';
    for (const name of Object.keys(SETTINGS.colors)) {
      expect(
        colourDifference(darkOlive, snakeColorHex(name, SETTINGS), 'normal'),
        `${name} under normal vision`,
      ).toBeGreaterThan(40);
    }
    expect(worstCaseColourDifference(darkOlive, snakeColorHex('red', SETTINGS))).toBeLessThan(
      MIN_COLOUR_DIFFERENCE,
    );

    const extended = withOverrides({ colors: { syntheticNinth: darkOlive } });
    expect(() =>
      assertContrastRule(
        buildAllPlayerColourPairs(extended),
        PLAYER_PAIR_WAIVERS,
        COLOUR_VISION_RULE,
      ),
    ).toThrow(/syntheticNinth/);
  });
});

/**
 * #152 asks for two more families beyond the 28: the apple against each player colour, and each power-up
 * pedestal against each player colour. Both are measured here.
 *
 * The apple is *bound* by the rule — it is a thing on the floor that a player must tell from their own
 * snake, and every pair clears `MIN_COLOUR_DIFFERENCE` today.
 *
 * The pedestals are **measured and recorded but the bar is not yet the design lead's ruling**: SPEED's
 * pedestal *is* `snakeColorHex('blue')` by `DESIGN-DECISIONS §1 row 20`, so it measures 0 against player blue
 * by construction, and a rule there would be asserting against a design decision rather than against a
 * defect. Row 20's own answer is that the two power-ups differ in silhouette, icon *and* pedestal — the GDD's
 * "never rely on colour alone". Asked on #184; until it is answered the three failing pedestal pairs are
 * recorded as waivers so the numbers are pinned and cannot drift either way.
 */
describe('KI-15-01: the apple and the pedestals against every player colour (#152)', () => {
  /**
   * The apple separates from a colour if *either* its body or its light rim does — the same two-colour rule
   * KI-02-02 established for luminance (`materials.test.js`'s `pairSeparation`), applied to this instrument.
   *
   * @param {{ a: number | string, altA: number | string, b: number | string }} pair
   * @returns {{ value: number, detail: string }}
   */
  function appleMeasure(pair) {
    const body = worstCaseColourDifference(pair.a, pair.b);
    const rim = worstCaseColourDifference(pair.altA, pair.b);
    return {
      value: Math.max(body, rim),
      detail: `body ${body.toFixed(2)}, rim ${rim.toFixed(2)}`,
    };
  }

  it('KI-15-01: the apple clears the rule against all eight player colours, under all three models', () => {
    // The same finding the luminance rule reached, on a different instrument: the body alone does not carry
    // it (8.57 against green, 11.69 against gold, 11.71 against orange — all below the bar), and the rim
    // does, at worst 19.33 against teal. KI-02-02's rim earns its keep twice over.
    const { body, rim } = createAppleMaterials(SETTINGS);
    const pairs = Object.keys(SETTINGS.colors).map((name) => ({
      key: `apple vs player ${name}`,
      a: body.color.getHex(),
      altA: rim.color.getHex(),
      b: snakeColorHex(name, SETTINGS),
    }));
    expect(pairs).toHaveLength(8);
    expect(() =>
      assertContrastRule(pairs, {}, { ...COLOUR_VISION_RULE, measure: appleMeasure }),
    ).not.toThrow();

    // And name the specific claim: the body alone would *not* pass, so the rim is load-bearing here and a
    // future change that drops it has to fail rather than coast on the body's margin.
    const bodyOnly = worstCaseColourDifference(
      body.color.getHex(),
      snakeColorHex('green', SETTINGS),
    );
    expect(bodyOnly).toBeLessThan(MIN_COLOUR_DIFFERENCE);
    expect(bodyOnly).toBeCloseTo(8.57, 1);
  });

  it('KI-15-01: every pedestal is measured against every player colour, with row 20’s own collisions recorded', () => {
    const powerUps = createPowerUpMaterials(SETTINGS);
    const pedestals = {
      SPEED: powerUps.speedPedestal.color.getHex(),
      SLOW: powerUps.slowPedestal.color.getHex(),
    };
    const pairs = Object.entries(pedestals).flatMap(([pedestal, hex]) =>
      Object.keys(SETTINGS.colors).map((name) => ({
        key: `${pedestal} pedestal vs player ${name}`,
        a: hex,
        b: snakeColorHex(name, SETTINGS),
      })),
    );
    expect(pairs).toHaveLength(16); // 2 pedestals × 8 colours, tracking the catalogue like everything else

    /**
     * Three recorded collisions, none of them a defect this ticket may fix:
     *  - `SPEED pedestal vs player blue` is **exactly 0** because row 20 says the SPEED pedestal *is* player
     *    blue. Recorded at 0 rather than waived away, so the day somebody repaints one of the two this test
     *    notices.
     *  - `SPEED pedestal vs player purple` **3.13** is `blue`/`purple` restated — the same fact, reached from
     *    the other direction.
     *  - `SLOW pedestal vs player teal` **12.22**: row 20's `#4FA9DD`, locked three days before I02.
     */
    const pedestalWaivers = {
      'SPEED pedestal vs player blue': { measured: 0, blockedBy: '#184' },
      'SPEED pedestal vs player purple': { measured: 3.1272, blockedBy: '#184' },
      'SLOW pedestal vs player teal': { measured: 12.2233, blockedBy: '#184' },
    };
    expect(() => assertContrastRule(pairs, pedestalWaivers, COLOUR_VISION_RULE)).not.toThrow();

    // The SPEED pedestal being player blue is a design decision, not a coincidence this test should tolerate
    // drifting into: assert it directly, so "0" above stays explained.
    expect(hexOf(pedestals.SPEED)).toBe(hexOf(snakeColorHex('blue', SETTINGS)));
    expect(hexOf(pedestals.SLOW)).toBe(hexOf(COLORS.powerUpSlowPedestal));
  });
});
