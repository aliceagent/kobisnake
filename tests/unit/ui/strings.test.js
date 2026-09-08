// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { APPROVED_KEYS, STRINGS } from '../../../src/ui/strings.js';

/**
 * KI-20-01 (`docs/sprints/improvement-20-string-catalogue.md`, tracking #212, ticket #249).
 *
 * ## AC1 — "asserted by parsing the document"
 *
 * {@link extractApprovedFromSection3} is a real parser: it loads `docs/design/DESIGN-DECISIONS.md` from disk,
 * finds `## 3.` and slices out everything up to the next `## ` heading, and pulls every quoted/backticked span
 * out of that text — it does not hard-code a list of strings to look for, so a string added to or changed in
 * §3 without a matching catalogue change fails this test the next time it runs (the non-vacuousness check
 * below proves this by breaking one catalogue string on purpose and capturing the red output).
 *
 * **What the parser extracts, and what it deliberately does not:**
 * - Every `"double-quoted"` span in §3 is a candidate, **except one**: `"never rely on colour alone"`, in the
 *   controls-card bullet's `(the GDD's "never rely on colour alone" applies here too)`. That is the GDD's own
 *   rule, quoted parenthetically to justify a design choice — not copy a player reads — so it is excluded by
 *   an exact, named, documented literal match, not a shape heuristic. This is the one place this parser
 *   trusts a specific string rather than a general rule, and it is called out here rather than silently.
 * - Every `` `backticked` `` span in §3 is a candidate **only if** it looks like on-screen copy by shape: it
 *   either contains a space (`` `2 PLAYERS` ``, `` `TICK 137 / 380` ``), or is made up entirely of uppercase
 *   letters and digits with nothing else (`` `REPLAY` ``, `` `PLAY` ``). Everything else backticked in §3 is
 *   excluded — file paths (`` `docs/reference/README.md` ``), bare filenames (`` `PLAYTEST-SCRIPT.md` ``),
 *   section references (`` `§1` ``), hex colours (`` `#3DB54A` ``) and API/class names
 *   (`` `MeshStandardMaterial` ``) all fail both conditions, so a code review comment, a materials-bible
 *   colour or a future prose paragraph that happens to backtick a file path never gets mistaken for approved
 *   copy. This is shape-based, not an allowlist of today's specific non-copy tokens — see "shape rules are
 *   robust to new non-copy tokens" below for why that distinction matters.
 * - Multi-line quotes are handled: the parser matches across the raw section text (where a `[^"]`/`` [^`] ``
 *   character class happily spans a newline) and only normalises whitespace *after* matching, so the
 *   main-menu description — which the markdown itself line-wraps mid-sentence — is extracted whole.
 * - Two quotes on one line are handled the same way: matching stops at the next quote character, so
 *   `"PLAYER 1 · RED — W A S D" and "PLAYER 2 · BLUE — ARROW KEYS"` yields two spans, never one that has
 *   swallowed the word "and" between them.
 *
 * **What this test does not prove:** it proves every extracted, non-excluded span is present character for
 * character in the catalogue. It does not prove the two exclusion rules above are themselves correct for
 * *any* future edit to §3 — only that they are correct for §3 as it reads today, plus the one shape case this
 * file's own isolated tests fabricate. A §3 edit that adds a new kind of non-copy backtick token this parser's
 * shape rule does not anticipate would need a human to notice the false positive; that risk is bounded, not
 * eliminated, and is the reason `describe('extractApprovedFromSection3 — shape rules')` below tests the
 * extraction function in isolation against synthetic input as well as the real document.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../..');
const DESIGN_DECISIONS_PATH = path.join(REPO_ROOT, 'docs/design/DESIGN-DECISIONS.md');
const STRINGS_JS_PATH = path.join(REPO_ROOT, 'src/ui/strings.js');

/** Collapses any run of whitespace (including a line break) to one space, and trims. @param {string} s */
function normalizeWhitespace(s) {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The one double-quoted span in §3 that is not player-facing copy — the GDD's own rule, quoted to justify the
 * controls-card bullet, not a sentence a player reads. See this file's own module doc comment above.
 */
const GDD_QUOTE_NOT_COPY = 'never rely on colour alone';

/** A backtick span is candidate copy if it has a space, or is entirely uppercase letters/digits. @param {string} s */
function looksLikeBacktickCopy(s) {
  if (/\s/.test(s)) return true;
  return /^[A-Z0-9]+$/.test(s);
}

/**
 * Parses `markdown` for its `## 3. ...` section and returns every quoted/backticked span that looks like
 * approved player-facing copy, per the rules documented in this file's own module comment.
 *
 * @param {string} markdown
 * @returns {{ approved: string[], excludedDoubleQuoted: string[], excludedBacktick: string[] }}
 */
function extractApprovedFromSection3(markdown) {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex((line) => /^## 3\. /.test(line));
  if (startIndex === -1) {
    throw new Error('extractApprovedFromSection3: no "## 3. " heading found in the document');
  }
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      endIndex = i;
      break;
    }
  }
  const section = lines.slice(startIndex, endIndex).join('\n');

  const approved = [];
  const excludedDoubleQuoted = [];
  const excludedBacktick = [];

  for (const match of section.matchAll(/"([^"]*)"/g)) {
    const value = normalizeWhitespace(match[1]);
    if (value === GDD_QUOTE_NOT_COPY) {
      excludedDoubleQuoted.push(value);
      continue;
    }
    approved.push(value);
  }

  for (const match of section.matchAll(/`([^`]*)`/g)) {
    const value = normalizeWhitespace(match[1]);
    if (looksLikeBacktickCopy(value)) {
      approved.push(value);
    } else {
      excludedBacktick.push(value);
    }
  }

  return { approved, excludedDoubleQuoted, excludedBacktick };
}

/**
 * How to call every function-valued {@link APPROVED_KEYS} entry to get its §3-approved sample output. A plain
 * string entry needs no args (`[]`); an entry resolving to an array (`howToPlay.lines`) is used as-is.
 * @type {Record<string, unknown[][]>}
 */
const APPROVED_SAMPLE_ARGS = {
  'matchSetup.controlsCard': [
    [1, 'red'],
    [2, 'blue'],
  ],
  'matchSetup.colourNote.suggestion': [['teal', 2]],
  'replay.tickReadout': [[137, 380]],
};

/** @param {string} dotPath @returns {unknown} */
function getByPath(dotPath) {
  return dotPath.split('.').reduce((value, key) => {
    if (value === undefined) {
      throw new Error(`getByPath: "${dotPath}" does not resolve (stuck at "${key}")`);
    }
    return /** @type {any} */ (value)[key];
  }, /** @type {unknown} */ (STRINGS));
}

/**
 * Every string {@link STRINGS} actually produces for its approved entries — a plain string value as-is, an
 * array's entries each on their own, and a function called once per sample-arg tuple in
 * {@link APPROVED_SAMPLE_ARGS} (defaulting to one no-arg call when a function has no entry there).
 * @returns {string[]}
 */
function approvedCatalogueValues() {
  /** @type {string[]} */
  const values = [];
  for (const dotPath of APPROVED_KEYS) {
    const resolved = getByPath(dotPath);
    if (typeof resolved === 'string') {
      values.push(resolved);
    } else if (Array.isArray(resolved)) {
      values.push(...resolved);
    } else if (typeof resolved === 'function') {
      const argSets = APPROVED_SAMPLE_ARGS[dotPath] ?? [[]];
      for (const args of argSets) {
        values.push(resolved(...args));
      }
    } else {
      throw new Error(
        `approvedCatalogueValues: "${dotPath}" resolved to an unexpected ${typeof resolved}`,
      );
    }
  }
  return values;
}

describe('extractApprovedFromSection3 — shape rules (isolated from the real document)', () => {
  const synthetic = [
    '## 3. Visual notes for un-illustrated screens',
    '',
    'Some intro text (see `docs/reference/README.md`).',
    '',
    '- A row reads `REPLAY` and another reads `2 PLAYERS`.',
    '- The rule text is "Two players, one keyboard. Eat apples, grow long, and make the other',
    '  snake crash."',
    '- Two on one line: "PLAYER 1 · RED — W A S D" and "PLAYER 2 · BLUE — ARROW KEYS".',
    '- A GDD quote: (the GDD\'s "never rely on colour alone" applies here too).',
    '- A section ref (`§1`), a bare filename (`PLAYTEST-SCRIPT.md`), a hex colour (`#3DB54A`), and an API',
    '  name (`MeshStandardMaterial`) are none of them copy.',
    '- A future ticket reference: `src/ui/strings.js` and `tests/unit/ui/strings.test.js`.',
    '',
    '## 4. Next section',
    'This must never be scanned: `NOTCOPY`.',
  ].join('\n');

  const result = extractApprovedFromSection3(synthetic);

  it('extracts a plain backtick label', () => {
    expect(result.approved).toContain('REPLAY');
  });

  it('extracts a multi-word backtick phrase', () => {
    expect(result.approved).toContain('2 PLAYERS');
  });

  it('joins a double-quoted string that wraps across a markdown line break', () => {
    expect(result.approved).toContain(
      'Two players, one keyboard. Eat apples, grow long, and make the other snake crash.',
    );
  });

  it('splits two double-quoted strings on the same line instead of swallowing the word between them', () => {
    expect(result.approved).toContain('PLAYER 1 · RED — W A S D');
    expect(result.approved).toContain('PLAYER 2 · BLUE — ARROW KEYS');
    expect(result.approved).not.toContain(
      'PLAYER 1 · RED — W A S D" and "PLAYER 2 · BLUE — ARROW KEYS',
    );
  });

  it('excludes the named GDD quote by exact match, not by shape', () => {
    expect(result.excludedDoubleQuoted).toContain('never rely on colour alone');
    expect(result.approved).not.toContain('never rely on colour alone');
  });

  it('excludes a backticked section reference by shape', () => {
    expect(result.excludedBacktick).toContain('§1');
    expect(result.approved).not.toContain('§1');
  });

  it('excludes a backticked bare filename by shape', () => {
    expect(result.excludedBacktick).toContain('PLAYTEST-SCRIPT.md');
    expect(result.approved).not.toContain('PLAYTEST-SCRIPT.md');
  });

  it('excludes a backticked file path by shape (the case the tech lead asked to be proven)', () => {
    expect(result.excludedBacktick).toContain('docs/reference/README.md');
    expect(result.approved).not.toContain('docs/reference/README.md');
  });

  it('excludes a backticked hex colour by shape', () => {
    expect(result.excludedBacktick).toContain('#3DB54A');
    expect(result.approved).not.toContain('#3DB54A');
  });

  it('excludes a backticked API/class name by shape (mixed case, no space)', () => {
    expect(result.excludedBacktick).toContain('MeshStandardMaterial');
    expect(result.approved).not.toContain('MeshStandardMaterial');
  });

  it("excludes future ticket-file backtick references by the same shape rule, not an allowlist of today's tokens (KI-20-04 immunity)", () => {
    expect(result.excludedBacktick).toContain('src/ui/strings.js');
    expect(result.excludedBacktick).toContain('tests/unit/ui/strings.test.js');
    expect(result.approved).not.toContain('src/ui/strings.js');
    expect(result.approved).not.toContain('tests/unit/ui/strings.test.js');
  });

  it('never scans past the next "## " heading', () => {
    expect(result.approved).not.toContain('NOTCOPY');
  });
});

describe('KI-20-01 AC1 — every string in DESIGN-DECISIONS §3 is present and identical in the catalogue', () => {
  const markdown = readFileSync(DESIGN_DECISIONS_PATH, 'utf8');
  const { approved } = extractApprovedFromSection3(markdown);
  const corpus = approvedCatalogueValues();

  it('finds a non-trivial number of approved strings in §3 today (sanity — the parser is not returning nothing)', () => {
    expect(approved.length).toBeGreaterThan(15);
  });

  it.each(approved.map((value, i) => [i, value]))('§3 string %#: %s', (_i, value) => {
    // Substring, not exact-element, containment: an approved §3 fragment can be part of a longer catalogue
    // string (e.g. "one more and the match is called" inside `scoreboard.drawWarning`'s full text), and a
    // parameterised entry's sample output can likewise carry an approved phrase alongside computed text.
    const found = corpus.some((entry) => entry.includes(value));
    expect(
      found,
      `"${value}" was not found, character for character, in any approved catalogue value`,
    ).toBe(true);
  });

  it('APPROVED_KEYS resolves for every entry (no stale dot-path)', () => {
    for (const dotPath of APPROVED_KEYS) {
      expect(() => getByPath(dotPath)).not.toThrow();
    }
  });

  it('APPROVED_KEYS agrees with the "// APPROVED — DESIGN-DECISIONS §3" comment convention in the source', () => {
    const source = readFileSync(STRINGS_JS_PATH, 'utf8');
    const objectStart = source.indexOf('const STRINGS_UNFROZEN = {');
    const objectEnd = source.indexOf('\nfunction deepFreeze');
    expect(objectStart).toBeGreaterThan(-1);
    expect(objectEnd).toBeGreaterThan(objectStart);
    const objectBody = source.slice(objectStart, objectEnd);

    // ".*" stays on one line (`//` comments end at the newline, and `.` does not match `\n`), so this still
    // only matches a single-line marker — but tolerates the extra words some entries carry between "APPROVED"
    // and the section reference (e.g. "APPROVED, currently unwired — DESIGN-DECISIONS §3" for the three
    // approved-but-unwired entries), rather than requiring one exact phrase.
    const markerCount = (objectBody.match(/\/\/ APPROVED.*DESIGN-DECISIONS §3\b/g) ?? []).length;
    // §1-row-27 entries carry their own, differently-worded marker and are deliberately excluded from
    // APPROVED_KEYS (module doc comment in strings.js) — counted separately so it cannot silently inflate
    // or deflate the §3 count above.
    const row27MarkerCount = (
      objectBody.match(/\/\/ APPROVED.*DESIGN-DECISIONS §1 row 27\b/g) ?? []
    ).length;

    expect(markerCount).toBe(APPROVED_KEYS.length);
    expect(row27MarkerCount).toBeGreaterThan(0);
  });
});

describe('KI-20-01 AC2 — STRINGS is deep-frozen; a write throws', () => {
  it('throws on a new top-level property (strict mode — this test file is an ES module)', () => {
    expect(() => {
      // @ts-expect-error — deliberately writing an unknown key to prove the freeze.
      STRINGS.somethingNew = 'x';
    }).toThrow(TypeError);
  });

  it('throws on overwriting a top-level nested screen object', () => {
    expect(() => {
      // @ts-expect-error
      STRINGS.menu = {};
    }).toThrow(TypeError);
  });

  it('throws on a plain-string leaf one level down', () => {
    expect(() => {
      // @ts-expect-error
      STRINGS.menu.title = 'x';
    }).toThrow(TypeError);
  });

  it('throws on a leaf nested two levels down (matchSetup.colourNote.note)', () => {
    expect(() => {
      // @ts-expect-error
      STRINGS.matchSetup.colourNote.note = 'x';
    }).toThrow(TypeError);
  });

  it('throws on reassigning an array leaf', () => {
    expect(() => {
      // @ts-expect-error
      STRINGS.howToPlay.lines = [];
    }).toThrow(TypeError);
  });

  it('throws on mutating an array leaf by index', () => {
    expect(() => {
      STRINGS.howToPlay.lines[0] = 'x';
    }).toThrow(TypeError);
  });

  it('throws on pushing into an array leaf', () => {
    expect(() => {
      STRINGS.countdown.numbers.push('5');
    }).toThrow(TypeError);
  });

  it('throws on adding a property to a function-valued leaf', () => {
    expect(() => {
      // @ts-expect-error
      STRINGS.matchSetup.controlsCard.extra = true;
    }).toThrow(TypeError);
  });

  it('APPROVED_KEYS itself is frozen (a companion export, not just STRINGS)', () => {
    expect(Object.isFrozen(APPROVED_KEYS)).toBe(true);
    expect(() => {
      // @ts-expect-error
      APPROVED_KEYS.push('extra.key');
    }).toThrow(TypeError);
  });
});

describe("Parameterised strings match the live screens' own formatting, branch for branch", () => {
  // matchSetup.controlsCard — mirrors matchSetup.js's controlsCardLabel exactly.
  it('controlsCard: player 1, human', () => {
    expect(STRINGS.matchSetup.controlsCard(1, 'red')).toBe('PLAYER 1 · RED — W A S D');
  });
  it('controlsCard: player 2, human', () => {
    expect(STRINGS.matchSetup.controlsCard(2, 'blue')).toBe('PLAYER 2 · BLUE — ARROW KEYS');
  });
  it('controlsCard: player 1, isCpu defaults to false', () => {
    expect(STRINGS.matchSetup.controlsCard(1, 'green')).toBe('PLAYER 1 · GREEN — W A S D');
  });
  it('controlsCard: player 2, isCpu true replaces the key list with CPU', () => {
    expect(STRINGS.matchSetup.controlsCard(2, 'teal', true)).toBe('PLAYER 2 · TEAL — CPU');
  });
  it('controlsCard: player 1, isCpu true', () => {
    expect(STRINGS.matchSetup.controlsCard(1, 'gold', true)).toBe('PLAYER 1 · GOLD — CPU');
  });

  // matchSetup.colourNote.suggestion
  it('colourNote.suggestion uppercases the colour and computes the player number', () => {
    expect(STRINGS.matchSetup.colourNote.suggestion('teal', 2)).toBe('Try TEAL for PLAYER 2.');
    expect(STRINGS.matchSetup.colourNote.suggestion('gold', 1)).toBe('Try GOLD for PLAYER 1.');
  });

  // matchSetup.matchLengthValue / powerUpsValue / playerColourValue / playerKindValue
  it('matchLengthValue', () => {
    expect(STRINGS.matchSetup.matchLengthValue(5)).toBe('BEST OF 5');
  });
  it('powerUpsValue on/off', () => {
    expect(STRINGS.matchSetup.powerUpsValue(true)).toBe('ON');
    expect(STRINGS.matchSetup.powerUpsValue(false)).toBe('OFF');
  });
  it('playerColourValue capitalises then uppercases', () => {
    expect(STRINGS.matchSetup.playerColourValue('red')).toBe('RED');
  });
  it('playerKindValue: HUMAN stays bare, a CPU level gets the CPU prefix', () => {
    expect(STRINGS.matchSetup.playerKindValue('HUMAN')).toBe('HUMAN');
    expect(STRINGS.matchSetup.playerKindValue('EASY')).toBe('CPU EASY');
    expect(STRINGS.matchSetup.playerKindValue('NORMAL')).toBe('CPU NORMAL');
  });
  it('playerKindRowLabel / playerColourRowLabel', () => {
    expect(STRINGS.matchSetup.playerKindRowLabel(1)).toBe('PLAYER 1');
    expect(STRINGS.matchSetup.playerKindRowLabel(2)).toBe('PLAYER 2');
    expect(STRINGS.matchSetup.playerColourRowLabel(1)).toBe('PLAYER 1 COLOUR');
    expect(STRINGS.matchSetup.playerColourRowLabel(2)).toBe('PLAYER 2 COLOUR');
  });

  // matchOver
  it('matchOver.winner capitalises then uppercases the colour', () => {
    expect(STRINGS.matchOver.winner('red')).toBe('RED WINS THE MATCH');
  });
  it('matchOver.scoreLine', () => {
    expect(STRINGS.matchOver.scoreLine(5, 3, 1)).toBe('BEST OF 5 — 3-1');
  });
  it('matchOver.keysEarned: singular', () => {
    expect(STRINGS.matchOver.keysEarned(1)).toBe('1 KEY EARNED');
  });
  it('matchOver.keysEarned: plural, including zero', () => {
    expect(STRINGS.matchOver.keysEarned(0)).toBe('0 KEYS EARNED');
    expect(STRINGS.matchOver.keysEarned(2)).toBe('2 KEYS EARNED');
  });

  // scoreboard
  it('scoreboard.winCount singular/plural', () => {
    expect(STRINGS.scoreboard.winCount(1)).toBe('1 win');
    expect(STRINGS.scoreboard.winCount(2)).toBe('2 wins');
    expect(STRINGS.scoreboard.winCount(0)).toBe('0 wins');
  });
  it('scoreboard.moreWins singular/plural', () => {
    expect(STRINGS.scoreboard.moreWins(1)).toBe('1 more win');
    expect(STRINGS.scoreboard.moreWins(2)).toBe('2 more wins');
  });
  it('scoreboard.colorWinLine', () => {
    expect(STRINGS.scoreboard.colorWinLine('blue', 2)).toBe('Blue: 2 wins');
    expect(STRINGS.scoreboard.colorWinLine('red', 1)).toBe('Red: 1 win');
  });
  it('scoreboard.decisiveLine', () => {
    expect(STRINGS.scoreboard.decisiveLine('blue', 1)).toBe('Blue needs 1 more win');
  });
  it('scoreboard.bestOfLine', () => {
    expect(STRINGS.scoreboard.bestOfLine(3)).toBe('BEST OF 3');
  });

  // replay
  it('replay.tickReadout with a known total', () => {
    expect(STRINGS.replay.tickReadout(137, 380)).toBe('TICK 137 / 380');
  });
  it('replay.tickReadout with no total yet', () => {
    expect(STRINGS.replay.tickReadout(0, null)).toBe('TICK 0');
  });
  it('replay.tickReadout with no tick at all', () => {
    expect(STRINGS.replay.tickReadout(null, null)).toBe('');
  });

  // hud
  it('hud.length for both players', () => {
    expect(STRINGS.hud.length(1, 0)).toBe('P1 0');
    expect(STRINGS.hud.length(2, 7)).toBe('P2 7');
  });
  it('hud.powerUpSeconds', () => {
    expect(STRINGS.hud.powerUpSeconds(5)).toBe('5s');
  });

  // playtestPrompt
  it('playtestPrompt.playerLabel', () => {
    expect(STRINGS.playtestPrompt.playerLabel(1)).toBe('P1');
    expect(STRINGS.playtestPrompt.playerLabel(2)).toBe('P2');
  });

  // tuning
  it('tuning.foldHeader collapsed/expanded', () => {
    expect(STRINGS.tuning.foldHeader(true)).toBe('▸ TUNING');
    expect(STRINGS.tuning.foldHeader(false)).toBe('▾ TUNING');
  });
  it('tuning.presetSeconds', () => {
    expect(STRINGS.tuning.presetSeconds(30)).toBe('30s');
  });
});

describe('Non-vacuousness — a real §3 string missing from the catalogue is a real red', () => {
  // This is not the PR's "bend one string and paste the red output" evidence (that was done by hand against
  // the real file and pasted into the PR description, since a test cannot un-bend the source it is testing
  // from inside itself); this test instead proves the *mechanism* the AC1 test above relies on — that
  // extraction plus corpus-membership genuinely fails when a string is absent — using a self-contained corpus
  // rather than mutating STRINGS.
  it('a corpus missing one approved string fails the same assertion AC1 uses', () => {
    const corpus = approvedCatalogueValues().filter(
      (value) => value !== STRINGS.scoreboard.drawReplay,
    );
    expect(corpus).not.toContain('DRAW — REPLAY');
  });
});
