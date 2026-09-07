import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
import { assertContrastRule } from './contrastRule.js';

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
/**
 * KI-02-02 (issue #134): the apple separates from a colour if *either* its body or its rim clears
 * `MIN_LUMINANCE_SEPARATION` — no single red-family hue clears the whole palette on its own (see
 * `materials.js`'s comment on `COLORS.appleBody`), so `pickupView.js` draws the apple as a dark body inside a
 * light rim outline and a player only needs to make out one of the two against whatever is behind it. A pair
 * built with an `altA` is judged by the larger of `luminanceSeparation(a, b)` and `luminanceSeparation(altA,
 * b)` — both are computed and both are named in the failure message (`pairSeparation` below), so a regression
 * in the colour that *isn't* carrying a given pair still shows up rather than being silently masked by the
 * one that is.
 *
 * @param {{ key: string, a: number | string, b: number | string, altA?: number | string }} pair
 * @returns {{ value: number, detail: string }}
 */
function pairSeparation(pair) {
  const primary = luminanceSeparation(pair.a, pair.b);
  if (pair.altA === undefined) {
    return { value: primary, detail: `${primary}` };
  }
  const alt = luminanceSeparation(pair.altA, pair.b);
  return {
    value: Math.max(primary, alt),
    detail: `body ${primary.toFixed(4)}, rim ${alt.toFixed(4)}`,
  };
}

/**
 * @param {import('../../../src/core/settings.js').Settings} settings
 * @returns {{ key: string, a: number | string, b: number | string, altA?: number | string }[]}
 */
function buildRequiredPairs(settings) {
  const appleMaterials = createAppleMaterials(settings);
  const appleBody = appleMaterials.body.color.getHex();
  const appleRim = appleMaterials.rim.color.getHex();
  const powerUps = createPowerUpMaterials(settings);
  const playerNames = Object.keys(settings.colors);

  const floors = { '70%': COLORS.floorGreen, '30%': COLORS.floorGreenAlt };
  const pedestals = {
    SPEED: powerUps.speedPedestal.color.getHex(),
    SLOW: powerUps.slowPedestal.color.getHex(),
  };

  /** @type {{ key: string, a: number | string, b: number | string, altA?: number | string }[]} */
  const pairs = [];

  // Apple vs both checker shades of the floor. `altA: appleRim` is the two-colour apple rule above.
  for (const [floorName, floorHex] of Object.entries(floors)) {
    pairs.push({ key: `apple vs floor ${floorName}`, a: appleBody, b: floorHex, altA: appleRim });
  }

  // Apple vs every player colour — the length of this loop is exactly what makes AC1 automatic: it tracks
  // the catalogue, not a number written down when the catalogue had eight entries.
  for (const name of playerNames) {
    pairs.push({
      key: `apple vs player ${name}`,
      a: appleBody,
      b: snakeColorHex(name, settings),
      altA: appleRim,
    });
  }

  // **No player-vs-player pair is built here any more (KI-15-01 AC2, issue #191).** KI-02-01 added
  // `player red vs player blue` because its own sprint file named that pair, and KI-02-03 added all 28 of
  // them; the design lead's ruling on #121 took the whole family out of this rule. Luminance measures figure
  // against ground — an apple on a floor, an icon on its pedestal — and it answers "can two people tell
  // their snakes apart" badly enough to have ranked `red`/`blue` the worst pair in the catalogue (0.0048),
  // which is the pair every match starts with and one nobody has ever confused. Those pairs are now measured
  // by `colourVision.js` (CIEDE2000 under normal, protanope and deuteranope vision) in
  // `colourVision.test.js`, where `red`/`blue` scores 47.75. The nine luminance waivers went with them, and
  // #156 — the duplicated red/blue waiver across two maps here — closes as a consequence rather than as its
  // own change.

  // Each power-up pedestal vs each floor shade.
  for (const [pedestalName, pedestalHex] of Object.entries(pedestals)) {
    for (const [floorName, floorHex] of Object.entries(floors)) {
      pairs.push({
        key: `${pedestalName} pedestal vs floor ${floorName}`,
        a: pedestalHex,
        b: floorHex,
      });
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
 * - **`SLOW pedestal vs floor 70%`** (0.0072) is locked by `DESIGN-DECISIONS §1 row 20`, which fixed
 *   `#4FA9DD` three days before KI-02-01. Not this ticket's to repaint — reported on #121 for Fable, not
 *   adjusted here. (`player red vs player blue` used to head this list at 0.0048. KI-15-01 removed it with
 *   the rest of the player-vs-player family, per the #121 ruling — see `buildRequiredPairs` above.)
 * - **`SPEED pedestal vs floor 30%`** (0.0961) and **`SLOW pedestal vs floor 30%`** (0.0833) are *new*
 *   measurements this table produces: nothing in `DESIGN-DECISIONS` discusses either pedestal against the
 *   30 % floor tile, so unlike the two pairs above these were never a deliberate choice — this rule is simply
 *   the first thing to have looked. Reported on #121 alongside the two locked pairs, for the design lead to
 *   decide; not this ticket's to repaint either.
 *
 * KI-02-02 (issue #134) repainted the apple — a body plus a light rim outline, judged together by
 * `pairSeparation`'s either-clears rule above — and every apple pair now clears `MIN_LUMINANCE_SEPARATION`
 * outright. The four `apple vs *` waivers that used to live here (`floor 30%`, `player red`, `player blue`,
 * `player purple` — today's apple was `snakeColorHex('red')` outright, byte-for-byte player one's colour) are
 * deleted, not loosened: removing each one and watching the suite fail if one too many was removed is how
 * that ticket proved it met the bar (its PR captures that failing run).
 */
const WAIVERS = {
  'SLOW pedestal vs floor 70%': { measured: 0.0072, blockedBy: '#121' },
  'SPEED pedestal vs floor 30%': { measured: 0.096, blockedBy: '#121' },
  'SLOW pedestal vs floor 30%': { measured: 0.0833, blockedBy: '#121' },
};

/**
 * This file's half of the split rule: WCAG relative-luminance separation, judged by `pairSeparation` (the
 * apple's either-body-or-rim rule) against `MIN_LUMINANCE_SEPARATION`. `colourVision.test.js` passes the
 * other half — CIEDE2000 under three vision models — to the same `assertContrastRule`.
 */
const LUMINANCE_RULE = {
  minimum: MIN_LUMINANCE_SEPARATION,
  measure: pairSeparation,
  name: 'MIN_LUMINANCE_SEPARATION',
};

/**
 * Every `.js` file under a directory, recursively. Used only by the AC3 hex-literal scan below — a plain
 * `node:fs` walk rather than a glob dependency, since this is the only place in the suite that needs one.
 *
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function listJsFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(full);
    }
  }
  return files;
}

describe('KI-02-01 palette-wide contrast rule (docs/sprints/improvement-02-readability-and-contrast.md, issue #133)', () => {
  it('KI-02-01 AC1: every required pair clears the rule or is an exact, ratcheted waiver', () => {
    expect(() =>
      assertContrastRule(buildRequiredPairs(SETTINGS), WAIVERS, LUMINANCE_RULE),
    ).not.toThrow();
  });

  it('KI-02-01 AC1: a colour added to SETTINGS.colors without a matching entry fails the rule, not passes silently', () => {
    // Sprint 14 adds six more unlockable player colours. This is the guard that makes that safe, proved two
    // ways.
    //
    // (1) Structural: the pair-building loop actually tracks `SETTINGS.colors` rather than a fixed list — a
    // bug that silently dropped a newly catalogued colour from the table would not be caught by anything
    // else here.
    //
    // (2) Enforcement: `assertContrastRule` genuinely rejects an unwaived failing pair, proved directly
    // against a synthetic pair rather than through the apple. KI-02-01's original version of this test forced
    // that failure by colliding a synthetic colour with the apple's own colour — that no longer works, and
    // deliberately so: KI-02-02 (#134) gave the apple a body (luminance 0.4142) and a rim (0.9469) far enough
    // apart (0.53, wider than two MIN_LUMINANCE_SEPARATION margins) that no single hex's luminance can sit
    // within MIN_LUMINANCE_SEPARATION of both at once — the two-colour apple is provably collision-proof
    // against any one new colour, which is a property of the design in `materials.js`'s comment on
    // `COLORS.appleBody`, not a hole in this rule.
    const settingsWithExtraColour = withOverrides({
      colors: { syntheticNinth: '#123456' },
    });

    const basePairs = buildRequiredPairs(SETTINGS);
    const extendedPairs = buildRequiredPairs(settingsWithExtraColour);
    expect(extendedPairs.length).toBe(basePairs.length + 1);
    expect(extendedPairs.some((pair) => pair.key === 'apple vs player syntheticNinth')).toBe(true);

    // The unmodified palette must not throw — otherwise the throw below could be some unrelated breakage in
    // buildRequiredPairs/assertContrastRule rather than evidence of the enforcement mechanism itself.
    expect(() => assertContrastRule(basePairs, WAIVERS, LUMINANCE_RULE)).not.toThrow();
    expect(() =>
      assertContrastRule(
        [{ key: 'synthetic vs synthetic', a: 0x000000, b: 0x000001 }],
        {},
        LUMINANCE_RULE,
      ),
    ).toThrow();
  });

  it("KI-02-01 AC2: the pre-KI-02-02 apple — snakeColorHex('red') outright — would still fail the rule against player red and floor 30% unwaived", () => {
    // In the KS-07-07 "the ice-white pedestal would fail" spirit: proves the *rule* would have caught the
    // regression KI-02-02 (issue #134) fixed, not that today's apple happens to be fine. Deliberately does
    // not call createAppleMaterials — today's apple no longer is player red, so asserting that equality here
    // would just be wrong; the pre-repaint value is hardcoded the same way the KS-07-07 test above hardcodes
    // the Sprint 06 ice-white pedestal it superseded.
    const revertedApple = snakeColorHex('red', SETTINGS); // what createAppleMaterials returned before #134
    const playerRed = snakeColorHex('red', SETTINGS);
    const floor30 = COLORS.floorGreenAlt;

    expect(luminanceSeparation(revertedApple, playerRed)).toBeLessThan(MIN_LUMINANCE_SEPARATION);
    expect(luminanceSeparation(revertedApple, floor30)).toBeLessThan(MIN_LUMINANCE_SEPARATION);

    // And run through the actual rule with no waiver standing in front of it, it does reject both pairs.
    expect(() =>
      assertContrastRule(
        [
          { key: 'apple vs player red (unwaived)', a: revertedApple, b: playerRed },
          { key: 'apple vs floor 30% (unwaived)', a: revertedApple, b: floor30 },
        ],
        {},
        LUMINANCE_RULE,
      ),
    ).toThrow();
  });

  it('KI-02-01 AC3: no hex colour outside materials.js', () => {
    // CLAUDE.md's "never" list: "never write a hex colour outside src/render/materials.js (3D) or the UI
    // stylesheet src/ui/styles.css (DOM)." This walks every `.js` file under `src/` and checks it by regex
    // rather than by review, so a stray hex literal (e.g. one landing in KI-02-02's pickupView.js edits)
    // fails the suite instead of waiting for a human to spot it.
    const HEX_NUMERIC = /0x[0-9a-fA-F]{6}(?![0-9a-fA-F])/g;
    const HEX_STRING = /['"]#[0-9a-fA-F]{6}['"]/g;

    const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../src');
    const repoRoot = join(srcRoot, '..');

    /** @type {{ file: string, match: string }[]} */
    const hits = [];
    for (const absPath of listJsFiles(srcRoot)) {
      const file = relative(repoRoot, absPath).split(sep).join('/');
      if (file === 'src/render/materials.js') continue; // the one place a hex colour is allowed to live

      const content = readFileSync(absPath, 'utf8');
      for (const match of content.matchAll(HEX_NUMERIC)) hits.push({ file, match: match[0] });
      for (const match of content.matchAll(HEX_STRING)) hits.push({ file, match: match[0] });
    }

    // Exception 1: src/render/snakeView.js resets emissive to black — 0x000000 is clearing a highlight, not
    // choosing a colour, and it is the only hit this file may have.
    const snakeViewMisses = hits.filter(
      (hit) => hit.file === 'src/render/snakeView.js' && hit.match.toLowerCase() !== '0x000000',
    );
    expect(snakeViewMisses, JSON.stringify(snakeViewMisses)).toEqual([]);

    // Exception 2: src/core/settings.js's own colour catalogue (DESIGN-DECISIONS §4; materials.js's header
    // comment explains why the catalogue lives in settings rather than here). Checked by shape against the
    // live SETTINGS.colors rather than a second hardcoded list of hexes: every literal found in settings.js
    // must be a current catalogue value, and there must be exactly as many literals as catalogue entries —
    // so this exception tracks the catalogue automatically instead of becoming a second place it is written.
    const settingsHits = hits.filter((hit) => hit.file === 'src/core/settings.js');
    const catalogueValues = new Set(Object.values(SETTINGS.colors).map((hex) => hex.toLowerCase()));
    for (const hit of settingsHits) {
      const normalized = hit.match.replace(/['"]/g, '').toLowerCase();
      expect(
        catalogueValues.has(normalized),
        `${hit.match} in settings.js is not a SETTINGS.colors value`,
      ).toBe(true);
    }
    expect(settingsHits.length).toBe(Object.keys(SETTINGS.colors).length);

    // Nothing else — any hit outside materials.js and these two named, bounded exceptions is a violation.
    const unexpected = hits.filter(
      (hit) => hit.file !== 'src/render/snakeView.js' && hit.file !== 'src/core/settings.js',
    );
    expect(unexpected, JSON.stringify(unexpected)).toEqual([]);
  });
});

/**
 * KI-02-02 (issue #134, tracked on #121): the apple stops being `snakeColorHex('red')` and gets its own two
 * colours (`COLORS.appleBody`, `COLORS.appleRim`). These tests are this ticket's own — KI-02-01's table above
 * (AC1) is what actually enforces the pass/fail rule for every apple pair; these pin the specific numbers the
 * ticket's design section committed to.
 */
describe('KI-02-02 the apple reads (docs/sprints/improvement-02-readability-and-contrast.md, issue #134)', () => {
  it('KI-02-02 AC1: apple vs both floor shades and apple vs all eight player colours clear the rule unwaived', () => {
    // No `apple vs *` key may appear in WAIVERS any more — the four #134 waivers are gone (see the WAIVERS
    // comment above), so every one of these ten pairs has to clear MIN_LUMINANCE_SEPARATION outright via
    // buildRequiredPairs/assertContrastRule (already exercised by the KI-02-01 AC1 test above; this asserts
    // the narrower claim directly, by name, so a future change that reintroduces just one apple waiver fails
    // here even if some other pair's waiver budget happened to absorb it).
    const pairs = buildRequiredPairs(SETTINGS).filter((pair) => pair.key.startsWith('apple vs '));
    expect(pairs).toHaveLength(10); // 2 floor shades + 8 player colours

    for (const pair of pairs) {
      expect(Object.keys(WAIVERS)).not.toContain(pair.key);
      const { value: separation, detail } = pairSeparation(pair);
      expect(separation, `${pair.key}: ${detail}`).toBeGreaterThanOrEqual(MIN_LUMINANCE_SEPARATION);
    }
  });

  it('KI-02-02 AC1: the apple body alone clears the rule against player red — the F2 hue collision, unaided by the rim', () => {
    // The specific defect (agent QA finding F2): the apple was byte-for-byte player one's colour. The rim
    // exists to carry every pair the body can't (see `materials.js`'s comment on `COLORS.appleBody`), but
    // this one — the actual hue collision the ticket names — has to break on the body's own luminance, not
    // borrow the rim's margin, or a future rim change could silently reopen it.
    const body = createAppleMaterials(SETTINGS).body.color.getHex();
    const playerRed = snakeColorHex('red', SETTINGS);

    expect(body).not.toBe(hexFromCss(playerRed));
    expect(luminanceSeparation(body, playerRed)).toBeGreaterThanOrEqual(MIN_LUMINANCE_SEPARATION);
  });

  it('KI-02-02 AC1: the apple rim clears the rule against every player colour, both floor shades and both pedestals', () => {
    // "Whatever KI-02-01's rule demands" (the ticket's own words) turned out to be a light rim: measured here
    // against the whole set the rim was designed to carry, independent of the body.
    const { rim } = createAppleMaterials(SETTINGS);
    const rimHex = rim.color.getHex();
    const powerUps = createPowerUpMaterials(SETTINGS);

    const targets = {
      ...Object.fromEntries(
        Object.keys(SETTINGS.colors).map((name) => [
          `player ${name}`,
          snakeColorHex(name, SETTINGS),
        ]),
      ),
      'floor 70%': COLORS.floorGreen,
      'floor 30%': COLORS.floorGreenAlt,
      'SPEED pedestal': powerUps.speedPedestal.color.getHex(),
      'SLOW pedestal': powerUps.slowPedestal.color.getHex(),
    };

    for (const [name, hex] of Object.entries(targets)) {
      expect(luminanceSeparation(rimHex, hex), name).toBeGreaterThanOrEqual(
        MIN_LUMINANCE_SEPARATION,
      );
    }
  });
});

/**
 * **KI-02-03's block used to live here** (issue #135): all C(8,2) = 28 player-colour pairs asserted against
 * `MIN_LUMINANCE_SEPARATION`, with nine ratcheted waivers, plus the duplicated `red`/`blue` waiver #156 was
 * filed about. KI-15-01 (issue #191, AC2) deleted it whole, on the design lead's ruling on #121: those pairs
 * are not a luminance question, and waiving them here implied the rule applied and a failure was being
 * tolerated, which was not what was true. They are measured in `tests/unit/render/colourVision.test.js`
 * instead, by an instrument that models colour blindness — where the count of failures happens to be nine
 * again and is almost a different nine, and `red`/`blue` ranks 20th of 28 rather than last.
 *
 * What stayed behind, deliberately: the *guard* KI-02-03 existed to provide before Sprint 14 — a colour
 * added to `SETTINGS.colors` cannot ship unchecked — is not weakened by the move. It is enforced twice now,
 * by `KI-02-01 AC1`'s apple-vs-every-player-colour loop above (this file) and by the 28-pair table in
 * `colourVision.test.js` (KI-15-01 AC3).
 */
