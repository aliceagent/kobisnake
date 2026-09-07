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
    expect(() => assertContrastRule(buildRequiredPairs(SETTINGS), WAIVERS)).not.toThrow();
  });

  it('KI-02-01 AC1: a colour added to SETTINGS.colors without a matching entry fails the rule, not passes silently', () => {
    // Sprint 14 adds six more unlockable player colours. This is the guard that makes that safe. The
    // synthetic ninth colour is set to *the apple's own current body colour*, read back through
    // createAppleMaterials rather than hard-coded to today's red — so its separation from the apple is 0 by
    // construction, whatever the apple's colour is or later becomes. Pinning the synthetic colour to a
    // literal (e.g. today's red) would make this guard pass for an incidental reason: KI-02-02 (#134)
    // repaints the apple, and a colour merely equal to red would then separate from the *new* apple by a
    // real margin, clear the rule, and turn this into a red test protecting nothing. Deriving the collision
    // from the apple itself is what keeps the guard meaningful across that repaint.
    const appleHex = createAppleMaterials(SETTINGS).body.color.getHex();
    const syntheticNinth = `#${appleHex.toString(16).padStart(6, '0')}`;
    const settingsWithExtraColour = withOverrides({
      colors: { syntheticNinth },
    });

    // The unmodified palette must not throw — otherwise the throw below could be some unrelated breakage in
    // buildRequiredPairs/assertContrastRule rather than evidence that the added colour is what's rejected.
    expect(() => assertContrastRule(buildRequiredPairs(SETTINGS), WAIVERS)).not.toThrow();
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
      expect(catalogueValues.has(normalized), `${hit.match} in settings.js is not a SETTINGS.colors value`).toBe(
        true,
      );
    }
    expect(settingsHits.length).toBe(Object.keys(SETTINGS.colors).length);

    // Nothing else — any hit outside materials.js and these two named, bounded exceptions is a violation.
    const unexpected = hits.filter((hit) => hit.file !== 'src/render/snakeView.js' && hit.file !== 'src/core/settings.js');
    expect(unexpected, JSON.stringify(unexpected)).toEqual([]);
  });
});

/**
 * KI-02-03 (issue #135, tracked on #121): the GDD promises eight player colours and Sprint 14 unlocks six of
 * them, so any two can end up in the same match — not just the shipping red/blue pair KI-02-01's table
 * already covers. This block asserts every one of the C(8,2) = 28 unordered pairs among today's catalogue,
 * reusing KI-02-01's own `assertContrastRule` (defined above in this file) rather than a second copy of the
 * three-part rule, and its own separate waiver map so this ticket's diff stays additive at the end of the
 * file rather than touching the `WAIVERS` map above (that map belongs to the sibling KI-02-02 PR repainting
 * the apple, per this ticket's merge-conflict discipline).
 *
 * **On the seven-vs-nine discrepancy:** the ticket text that spawned this block states seven of the 28 pairs
 * fail — red/blue, green/orange, green/teal, orange/teal, blue/purple, red/purple, yellow/gold — and that the
 * "remaining 21 clear it." Computing every pair live against `MIN_LUMINANCE_SEPARATION` (the point of doing
 * this at runtime instead of hard-coding the ticket's numbers) finds **nine** failing pairs, not seven: the
 * same seven, plus **gold/teal** (0.1204) and **gold/green** (0.1460), both of which fall short of 0.15 by a
 * comparatively small margin but still fall short. This is reported to the design lead in the PR rather than
 * silently reconciled either direction — the waiver list below records the actual measured nine so the suite
 * asserts what is true of the shipping hexes, not what a prior count said was true of them.
 */

/**
 * Every unordered pair among the current player colour catalogue, built from `Object.keys(settings.colors)`
 * combinatorially — never a hand-written list of 28 names. That is what makes a ninth colour appended to
 * `SETTINGS.colors` (Sprint 14 adds six more; a tenth is not impossible after that) get checked automatically:
 * `n·(n−1)/2` pairs fall out of the catalogue's size on its own, and the "combinatorial count is 28" test below
 * pins today's `n = 8` so a future change to that count is visible rather than silently changing what "all
 * pairs" means.
 *
 * Pair keys are alphabetised (`player <a> vs player <b>`, `a < b`) so a given pair has exactly one key
 * regardless of `Object.keys` iteration order, which is what lets `KI_02_03_WAIVERS` below name each pair
 * once.
 *
 * @param {import('../../../src/core/settings.js').Settings} settings
 * @returns {{ key: string, a: number | string, b: number | string }[]}
 */
function buildAllPlayerColourPairs(settings) {
  const names = Object.keys(settings.colors);
  /** @type {{ key: string, a: number | string, b: number | string }[]} */
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
 * The nine pairs among today's eight player colours that measure below `MIN_LUMINANCE_SEPARATION`, recorded
 * as ratcheted waivers in the same shape KI-02-01 established (`{ measured, blockedBy: '#121' }`), each
 * `measured` floored to four decimal places below the real value so the ratchet in `assertContrastRule` (the
 * live separation must be `>= measured`) never trips on float noise. None of these are repainted here: the
 * eight hexes are locked by `DESIGN-DECISIONS §2.7` and `src/core/settings.js` is off-limits regardless
 * (`CLAUDE.md`'s never list) — this ticket's job is to measure and report them, not adjust them. All nine are
 * blocked on #121 (the tracking issue) for Fable to decide, worst separation first:
 *  - `blue vs red` — 0.0047 (the shipping pair; KI-02-01's table already waives this one too, under its own
 *    key, for the apple/floor/pedestal table — this is the same fact restated as one of the 28 player pairs).
 *  - `green vs orange` — 0.0088
 *  - `green vs teal` — 0.0255
 *  - `orange vs teal` — 0.0344
 *  - `blue vs purple` — 0.0375
 *  - `purple vs red` — 0.0423
 *  - `gold vs yellow` — 0.0989
 *  - `gold vs teal` — 0.1204 (not named in the ticket that spawned this block; see the discrepancy note above)
 *  - `gold vs green` — 0.146 (ditto)
 */
const KI_02_03_WAIVERS = {
  'player blue vs player red': { measured: 0.0047, blockedBy: '#121' },
  'player green vs player orange': { measured: 0.0088, blockedBy: '#121' },
  'player green vs player teal': { measured: 0.0255, blockedBy: '#121' },
  'player orange vs player teal': { measured: 0.0344, blockedBy: '#121' },
  'player blue vs player purple': { measured: 0.0375, blockedBy: '#121' },
  'player purple vs player red': { measured: 0.0423, blockedBy: '#121' },
  'player gold vs player yellow': { measured: 0.0989, blockedBy: '#121' },
  'player gold vs player teal': { measured: 0.1204, blockedBy: '#121' },
  'player gold vs player green': { measured: 0.146, blockedBy: '#121' },
};

describe('KI-02-03 all eight player colours checked against each other (docs/sprints/improvement-02-readability-and-contrast.md, issue #135, tracked on #121)', () => {
  it('KI-02-03 AC1: the pair count derived from SETTINGS.colors is 28 for today\'s eight colours', () => {
    // Pins n·(n−1)/2 for n = 8 so the derivation below is proved combinatorial rather than a disguised
    // hand-written list of 28 — if a colour is ever added or removed this assertion is the first thing that
    // moves, on purpose.
    const names = Object.keys(SETTINGS.colors);
    expect(names.length).toBe(8);
    expect(buildAllPlayerColourPairs(SETTINGS).length).toBe((names.length * (names.length - 1)) / 2);
    expect(buildAllPlayerColourPairs(SETTINGS).length).toBe(28);
  });

  it('KI-02-03 AC1: all 28 pairs either clear MIN_LUMINANCE_SEPARATION or are an exact, ratcheted, reported waiver', () => {
    // Reuses KI-02-01's own assertContrastRule rather than a second copy of its three-part rule: (a) every
    // non-waived pair clears the constant, (b) every waived pair still measures at least what is recorded,
    // (c) the waiver list is exactly the set of pairs that fail — none waived that actually passes.
    expect(() => assertContrastRule(buildAllPlayerColourPairs(SETTINGS), KI_02_03_WAIVERS)).not.toThrow();
  });

  it('KI-02-03: prove the rule can go red — a synthetic ninth colour colliding with an existing one fails unwaived', () => {
    // KS-07-07/KI-02-01's "prove the test can go red" pattern, applied to this table specifically: a ninth
    // colour appended to the catalogue with no contrast entry of its own must fail this rule, not pass
    // silently, since KI_02_03_WAIVERS names nothing for it. The synthetic colour is pinned to player blue's
    // own current hex, read back through snakeColorHex rather than a literal, so the collision is 0 by
    // construction whatever blue's hex is today or becomes later.
    const blueHex = snakeColorHex('blue', SETTINGS);
    const settingsWithExtraColour = withOverrides({ colors: { syntheticNinth: blueHex } });

    // The unmodified palette must not throw, so the throw below is evidence of the added colour specifically.
    expect(() => assertContrastRule(buildAllPlayerColourPairs(SETTINGS), KI_02_03_WAIVERS)).not.toThrow();
    expect(() =>
      assertContrastRule(buildAllPlayerColourPairs(settingsWithExtraColour), KI_02_03_WAIVERS),
    ).toThrow();
  });
});
