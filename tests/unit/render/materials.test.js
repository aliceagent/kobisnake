import { describe, expect, it } from 'vitest';
import {
  COLORS,
  createAppleMaterials,
  createPowerUpMaterials,
  luminanceSeparation,
  MIN_LUMINANCE_SEPARATION,
  relativeLuminance,
  snakeColorHex,
} from '../../../src/render/materials.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/**
 * KS-07-07 (issue #105): `DESIGN-DECISIONS §1 row 20` locks the SLOW pedestal at mid ice-blue `#4FA9DD` and
 * states the rule the colour exists to satisfy — "the icon must contrast with its pedestal as strongly as
 * the bolt does". Sprint 06 shipped an ice-white pedestal under a white snowflake, which satisfied row 20's
 * older wording and was still unreadable at gameplay scale; the review that caught it was somebody looking
 * at pixels. This file exists so the *rule* is what the suite checks, not the hex — a future palette change
 * that keeps `#4FA9DD` but lightens it, or one that swaps the icon, has to keep the contrast or fail here.
 *
 * `relativeLuminance` used to be a private copy in this file; KI-02-01 (issue #133) lifted it into
 * `materials.js` so the whole-palette rule below and this pedestal-only rule share one implementation.
 */

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

/**
 * KI-02-01 (issue #133, tracked on #121): every pair a player has to tell apart, in one table, generalising
 * the pedestal-only rule above. `docs/sprints/improvement-02-readability-and-contrast.md` names the required
 * pairs; this builds them by reading the same public functions the renderer calls, so the test checks what
 * gets drawn rather than what the palette happens to declare (the KS-07-07 pattern above, extended).
 *
 * Built from `Object.keys(settings.colors)` rather than a fixed list of eight names — Sprint 14 adds six more
 * unlockable player colours, and a colour appended to the catalogue without a matching contrast entry must
 * fail this test, not pass it silently (AC1, and the whole reason this ticket exists before Sprint 14 lands).
 *
 * @param {import('../../../src/core/settings.js').Settings} settings
 * @returns {{ key: string, a: number | string, b: number | string }[]}
 */
function buildRequiredPairs(settings) {
  const apple = createAppleMaterials(settings).body.color.getHex();
  const powerUps = createPowerUpMaterials(settings);
  const playerNames = Object.keys(settings.colors);

  const floors = { '70%': COLORS.floorGreen, '30%': COLORS.floorGreenAlt };
  const pedestals = {
    SPEED: powerUps.speedPedestal.color.getHex(),
    SLOW: powerUps.slowPedestal.color.getHex(),
  };

  /** @type {{ key: string, a: number | string, b: number | string }[]} */
  const pairs = [];

  // Apple vs both checker shades of the floor.
  for (const [floorName, floorHex] of Object.entries(floors)) {
    pairs.push({ key: `apple vs floor ${floorName}`, a: apple, b: floorHex });
  }

  // Apple vs every player colour — the length of this loop is exactly what makes AC1 automatic: it tracks
  // the catalogue, not a number written down when the catalogue had eight entries.
  for (const name of playerNames) {
    pairs.push({ key: `apple vs player ${name}`, a: apple, b: snakeColorHex(name, settings) });
  }

  // The two shipping players against each other (the sprint doc names this exact pair; every pair among all
  // eight/fourteen colours is KI-02-03's job, not this ticket's).
  if (playerNames.includes('red') && playerNames.includes('blue')) {
    pairs.push({
      key: 'player red vs player blue',
      a: snakeColorHex('red', settings),
      b: snakeColorHex('blue', settings),
    });
  }

  // Each power-up pedestal vs each floor shade.
  for (const [pedestalName, pedestalHex] of Object.entries(pedestals)) {
    for (const [floorName, floorHex] of Object.entries(floors)) {
      pairs.push({ key: `${pedestalName} pedestal vs floor ${floorName}`, a: pedestalHex, b: floorHex });
    }
  }

  // Each icon vs its own pedestal (the pairing KS-07-07 already covers above, folded into the same table).
  pairs.push({
    key: 'SPEED icon vs SPEED pedestal',
    a: powerUps.speedIconColor,
    b: pedestals.SPEED,
  });
  pairs.push({
    key: 'SLOW icon vs SLOW pedestal',
    a: powerUps.slowIconColor,
    b: pedestals.SLOW,
  });

  return pairs;
}

/**
 * Known-failing pairs, recorded rather than hidden. Every key here names a pair `buildRequiredPairs` also
 * produces (checked below); every pair `buildRequiredPairs` produces that is *not* named here must clear
 * `MIN_LUMINANCE_SEPARATION` outright.
 *
 * `measured` is floored to four decimal places below the real value, so the ratchet in `assertContrastRule`
 * (the live separation must be `>= measured`) has a safety margin against floating-point noise and never
 * trips on a rounding artefact of the value it is itself supposed to protect.
 *
 * - **`player red vs player blue`** (0.0048) and **`SLOW pedestal vs floor 70%`** (0.0072) are locked by
 *   `DESIGN-DECISIONS`: §2.7's two shipping player colours are isoluminant on purpose, and §1 row 20 locked
 *   `#4FA9DD` three days before this ticket. Neither is this ticket's to repaint — reported on #121 for
 *   Fable, not adjusted here.
 * - **`SPEED pedestal vs floor 30%`** (0.0961) and **`SLOW pedestal vs floor 30%`** (0.0833) are *new*
 *   measurements this table produces: nothing in `DESIGN-DECISIONS` discusses either pedestal against the
 *   30 % floor tile, so unlike the two pairs above these were never a deliberate choice — this rule is simply
 *   the first thing to have looked. Reported on #121 alongside the two locked pairs, for the design lead to
 *   decide; not this ticket's to repaint either.
 * - **`apple vs floor 30%`** (0.0912), **`apple vs player red`** (0), **`apple vs player blue`** (0.0047)
 *   and **`apple vs player purple`** (0.0423) are today's apple, which is `snakeColorHex('red')` outright
 *   (`createAppleMaterials`) — byte-for-byte player one's colour. KI-02-02 (issue #134) is the ticket that
 *   repaints it; this ticket does not touch the apple's colour. The other four apple-vs-player pairs and
 *   apple-vs-floor-70% already clear the rule even with today's apple, so only these four are waived. Once
 *   KI-02-02 lands, deleting these four entries (and watching the suite fail if it deleted one too many) is
 *   how that ticket proves it met the bar.
 */
const WAIVERS = {
  'player red vs player blue': { measured: 0.0047, blockedBy: '#121' },
  'SLOW pedestal vs floor 70%': { measured: 0.0072, blockedBy: '#121' },
  'SPEED pedestal vs floor 30%': { measured: 0.096, blockedBy: '#121' },
  'SLOW pedestal vs floor 30%': { measured: 0.0833, blockedBy: '#121' },
  'apple vs floor 30%': { measured: 0.0912, blockedBy: '#134' },
  'apple vs player red': { measured: 0, blockedBy: '#134' },
  'apple vs player blue': { measured: 0.0047, blockedBy: '#134' },
  'apple vs player purple': { measured: 0.0423, blockedBy: '#134' },
};

/**
 * The whole KI-02-01 rule, in one place: every pair either clears `MIN_LUMINANCE_SEPARATION` or is named in
 * `waivers` at no less than its recorded measurement, and `waivers` names nothing that is not an actual pair
 * in `pairs` or that would have passed unwaived (AC1's "(a) every non-waived pair meets the minimum",
 * "(b) every waived pair still measures at least what is recorded", "(c) the waiver list is exactly the set
 * of pairs that fail", all three at once).
 *
 * Factored out of the `it()` blocks below so the "adding a colour without a pair entry" test can run it
 * against a synthetic palette and watch it throw, instead of duplicating the inequality by hand in a way that
 * could quietly drift from the real rule.
 *
 * @param {{ key: string, a: number | string, b: number | string }[]} pairs
 * @param {Record<string, { measured: number, blockedBy: string }>} waivers
 */
function assertContrastRule(pairs, waivers) {
  const pairsByKey = new Map(pairs.map((pair) => [pair.key, pair]));

  for (const key of Object.keys(waivers)) {
    expect(pairsByKey.has(key), `waiver "${key}" does not match any pair the table builds`).toBe(true);
  }

  for (const { key, a, b } of pairs) {
    const separation = luminanceSeparation(a, b);
    const waiver = waivers[key];

    if (waiver) {
      // (c): a waiver on a pair that actually passes would be hiding it from scrutiny rather than recording
      // a known failure, so the waived pair must still genuinely fail unwaived.
      expect(separation, `${key}: waived but clears MIN_LUMINANCE_SEPARATION — drop the waiver`).toBeLessThan(
        MIN_LUMINANCE_SEPARATION,
      );
      // (b): the ratchet. May improve, must never worsen.
      expect(
        separation,
        `${key}: regressed below its recorded measurement of ${waiver.measured} (blocked by ${waiver.blockedBy})`,
      ).toBeGreaterThanOrEqual(waiver.measured);
    } else {
      // (a): every pair not named as a waiver must clear the minimum outright.
      expect(
        separation,
        `${key}: separation ${separation} is below MIN_LUMINANCE_SEPARATION and is not a recorded waiver`,
      ).toBeGreaterThanOrEqual(MIN_LUMINANCE_SEPARATION);
    }
  }
}

describe('KI-02-01 palette-wide contrast rule (docs/sprints/improvement-02-readability-and-contrast.md, issue #133)', () => {
  it('KI-02-01 AC1: every required pair clears the rule or is an exact, ratcheted waiver', () => {
    expect(() => assertContrastRule(buildRequiredPairs(SETTINGS), WAIVERS)).not.toThrow();
  });

  it('KI-02-01 AC1: a colour added to SETTINGS.colors without a matching entry fails the rule, not passes silently', () => {
    // Sprint 14 adds six more unlockable player colours. This is the guard that makes that safe: a ninth
    // colour that happens to collide with the apple (reusing red's hex, so its separation from the apple is
    // 0) produces an "apple vs player syntheticNinth" pair that neither clears MIN_LUMINANCE_SEPARATION nor
    // has a matching entry in WAIVERS, so buildRequiredPairs + assertContrastRule together must reject it —
    // the same machinery the green test above runs, not a hand-copied inequality that could drift from it.
    const settingsWithExtraColour = withOverrides({
      colors: { syntheticNinth: snakeColorHex('red', SETTINGS) },
    });

    expect(() => assertContrastRule(buildRequiredPairs(settingsWithExtraColour), WAIVERS)).toThrow();
  });

  it('KI-02-01 AC2: today\'s apple — snakeColorHex(\'red\') — fails the rule against player red and floor 30% unwaived', () => {
    // In the KS-07-07 "the ice-white pedestal would fail" spirit: proves the rule can go red, not just that
    // it currently stays green. KI-02-02 (issue #134) is the ticket that repaints the apple; this one only
    // records today's failure under the #134 waiver above so the suite stays green until that lands. The PR
    // additionally captures `npm run test:unit` run with the #134 waivers removed, verbatim, as the real
    // failing output this assertion predicts.
    const apple = createAppleMaterials(SETTINGS).body.color.getHex();
    const playerRed = snakeColorHex('red', SETTINGS);
    const floor30 = COLORS.floorGreenAlt;

    expect(apple).toBe(hexFromCss(playerRed));
    expect(luminanceSeparation(apple, playerRed)).toBeLessThan(MIN_LUMINANCE_SEPARATION);
    expect(luminanceSeparation(apple, floor30)).toBeLessThan(MIN_LUMINANCE_SEPARATION);

    // And run through the actual rule with no waiver standing in front of it, it does reject both pairs.
    expect(() =>
      assertContrastRule(
        [
          { key: 'apple vs player red (unwaived)', a: apple, b: playerRed },
          { key: 'apple vs floor 30% (unwaived)', a: apple, b: floor30 },
        ],
        {},
      ),
    ).toThrow();
  });
});
