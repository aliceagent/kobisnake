// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';

import { catalogueOnlyCopyRule } from '../../../scripts/lint-strings.mjs';

/**
 * KI-20-03 (`docs/sprints/improvement-20-string-catalogue.md`, tracking #212, ticket #251).
 *
 * This is the committed, machine-checkable half of AC1 and AC2 — see `scripts/lint-strings.mjs`'s own module
 * doc comment for what the rule catches, why, and what it deliberately does not. Every case below runs the
 * real rule module through ESLint's own `Linter` class (bundled with the `eslint` dependency already in
 * `package.json` — no new dependency) against a committed fixture file in `./fixtures/`, so the red case this
 * ticket's AC1 demands survives as a real, re-runnable test rather than a one-time paste in a PR description.
 *
 * `RULE_NAME`'s `kobi-strings/` prefix matches the local plugin name `eslint.config.js` registers it under,
 * so a message asserted here reads exactly as it would from `npm run lint`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(HERE, 'fixtures');
const RULE_NAME = 'kobi-strings/catalogue-only-copy';

/** @param {string} fixtureName @returns {string} */
function readFixture(fixtureName) {
  return readFileSync(path.join(FIXTURES_DIR, fixtureName), 'utf8');
}

/**
 * Lints one fixture with only {@link catalogueOnlyCopyRule} enabled — isolated from every other rule in
 * `eslint.config.js`, so a fixture only has to be parseable, never lint-clean under `eslint:recommended` or
 * `eslint-plugin-import` too. `filename` defaults to a path under `src/ui/screens/` (where every real
 * offender in this codebase lives); pass a different one to exercise the playtest-vs-entry message split.
 *
 * @param {string} fixtureName @param {{ filename?: string }} [options]
 * @returns {import('eslint').Linter.LintMessage[]}
 */
function lintFixture(fixtureName, options = {}) {
  const linter = new Linter();
  const filename = options.filename ?? `src/ui/screens/${fixtureName}`;
  const code = readFixture(fixtureName);
  const messages = linter.verify(
    code,
    {
      languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
      plugins: { 'kobi-strings': { rules: { 'catalogue-only-copy': catalogueOnlyCopyRule } } },
      rules: { [RULE_NAME]: 'error' },
    },
    filename,
  );
  // Every fixture must at least parse; a parse error would otherwise show up as a single opaque message
  // with no ruleId and mask what the test below is actually trying to prove.
  expect(
    messages.some((m) => m.fatal),
    `fixture "${fixtureName}" failed to parse: ${JSON.stringify(messages)}`,
  ).toBe(false);
  return messages;
}

describe('KI-20-03 AC1 — a deliberately added literal fails lint, with a message naming the catalogue', () => {
  it('a literal handed to .textContent is flagged', () => {
    const messages = lintFixture('violation-textcontent-literal.js');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
    expect(messages[0].message).toContain('src/ui/strings.js');
    expect(messages[0].message).toContain('catalogue diff the design lead approves');
    expect(messages[0].message).toContain('AGENT-ROLES-AND-WORKFLOW §3.1');
  });

  it('a literal handed to .innerText is flagged', () => {
    const messages = lintFixture('violation-innertext-literal.js');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
    expect(messages[0].message).toContain('src/ui/strings.js');
  });

  it("a raw literal in an object literal's `label` property is flagged", () => {
    const messages = lintFixture('violation-label-property-literal.js');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
    expect(messages[0].message).toContain('label');
  });

  it('a raw literal assigned to `.label` is flagged', () => {
    const messages = lintFixture('violation-label-assignment-literal.js');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
  });

  it('a label-building function whose body is directly a hardcoded literal is flagged — the matchSetup.js COLOUR_NOTE_COPY.suggestion shape, one hop from its eventual .textContent write', () => {
    const messages = lintFixture('violation-label-building-function.js', {
      // Linted under matchSetup.js's own real path so the suggested key exercises the real group mapping
      // (GROUP_BY_BASENAME), not the generic `<group>.` fallback the next test covers.
      filename: 'src/ui/screens/matchSetup.js',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
    expect(messages[0].message).toContain('src/ui/strings.js');
    expect(messages[0].message).toContain('matchSetup.suggestion');
  });

  it("the message suggests a key under the offending screen's own catalogue group", () => {
    const messages = lintFixture('violation-textcontent-literal.js');
    // fixtures/violation-textcontent-literal.js is linted under filename
    // src/ui/screens/violation-textcontent-literal.js by default, so there is no known GROUP_BY_BASENAME
    // entry — the message should still name a key shape (falling back to `<group>.<fragment>`), not omit
    // one. matchSetup.js is used elsewhere in this file for the case where the file *is* recognised.
    expect(messages[0].message).toMatch(/try `.+\..+`/);
  });
});

describe('KI-20-03 — playtestPrompt.js is pointed at strings.playtest.js, never strings.js (#317)', () => {
  it('a violation filed under src/ui/screens/playtestPrompt.js names strings.playtest.js', () => {
    const messages = lintFixture('violation-label-building-function-playtest.js', {
      filename: 'src/ui/screens/playtestPrompt.js',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('src/ui/strings.playtest.js');
    expect(messages[0].message).not.toContain('src/ui/strings.js`');
    // Never suggest the exact import #317 exists to forbid.
    expect(messages[0].message).not.toContain("'../strings.js'");
  });

  it('the very same fixture, linted as an ordinary screen, names strings.js instead — proving the split is per-file, not a fixed string', () => {
    const messages = lintFixture('violation-label-building-function-playtest.js', {
      filename: 'src/ui/screens/someOtherScreen.js',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('src/ui/strings.js');
    expect(messages[0].message).not.toContain('strings.playtest.js');
  });
});

describe('KI-20-03 — expected false positives are handled by a narrow rule, not a broadened one', () => {
  it("textContent = '' (a clear) is not flagged", () => {
    expect(lintFixture('clean-empty-clear.js')).toHaveLength(0);
  });

  it('dataset, className and data-* attribute values are not flagged', () => {
    expect(lintFixture('clean-dataset-classname-data-attrs.js')).toHaveLength(0);
  });

  it('aria-* attribute values are not flagged', () => {
    expect(lintFixture('clean-aria-attribute.js')).toHaveLength(0);
  });

  it('STATES/GAME_EVENTS-shaped comparison literals (switch/case, ===) are not flagged', () => {
    expect(lintFixture('clean-states-game-events-comparison.js')).toHaveLength(0);
  });

  it('a template literal assigned to textContent, built entirely from catalogue lookups, is not flagged', () => {
    expect(lintFixture('clean-template-built-from-catalogue.js')).toHaveLength(0);
  });

  it('a plain catalogue-lookup .textContent assignment is not flagged', () => {
    expect(lintFixture('clean-catalogue-lookup.js')).toHaveLength(0);
  });
});

describe('KI-20-03 — an eslint-disable-next-line exemption is narrow: one commented line, not the whole file', () => {
  // Fixture shape only — not a live case. matchSetup.js's COLOUR_NOTE_COPY.suggestion needed exactly this
  // exemption, naming #214, while this ticket was being built; #214 (#328) landed on main first and removed
  // the literal it covered, so the real file needs no exemption at all today (see the AC2 describe block
  // above). This pair of tests proves the *mechanism* still works correctly, independent of whether the
  // tree currently has any real case that needs it.
  it('a disable comment placed directly above the violating line silences it', () => {
    expect(lintFixture('clean-exemption-comment.js')).toHaveLength(0);
  });

  it('the same code with the disable comment removed fails — the exemption is not a rewrite of the rule', () => {
    const messages = lintFixture('violation-exemption-comment-removed.js');
    expect(messages).toHaveLength(1);
    expect(messages[0].ruleId).toBe(RULE_NAME);
  });
});

describe('KI-20-03 AC2 — the real matchSetup.js source passes this rule with zero exemptions', () => {
  // A tighter regression net than the fixture above: the actual production file, read from disk, not a
  // fixture reconstruction of its shape.
  //
  // matchSetup.js's colour-note suggestion (`COLOUR_NOTE_COPY.suggestion`) was this rule's one real hit in
  // the tree while this ticket was being built — a hand-written literal, tracked on #214 as a known,
  // deliberate discrepancy against the catalogue's approved form, and it needed a narrow
  // `eslint-disable-next-line` naming #214 to let it through. #214 (#328) landed on `main` and closed that
  // gap before this PR merged: `COLOUR_NOTE_COPY.suggestion` now reads `matchSetup.colourNote.suggestion`
  // straight from the catalogue, so the literal — and the exemption this ticket would otherwise have needed
  // to add — are both gone. This test asserts that plainly: no `eslint-disable` of any kind for this rule
  // appears anywhere in the real file, and the rule still reports nothing.
  const REPO_ROOT = path.resolve(HERE, '../../..');
  const matchSetupSource = readFileSync(
    path.join(REPO_ROOT, 'src/ui/screens/matchSetup.js'),
    'utf8',
  );

  it('src/ui/screens/matchSetup.js has zero violations', () => {
    const linter = new Linter();
    const messages = linter.verify(
      matchSetupSource,
      {
        languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
        plugins: { 'kobi-strings': { rules: { 'catalogue-only-copy': catalogueOnlyCopyRule } } },
        rules: { [RULE_NAME]: 'error' },
      },
      'src/ui/screens/matchSetup.js',
    );
    expect(messages.filter((m) => m.ruleId === RULE_NAME)).toEqual([]);
  });

  it('carries no eslint-disable for this rule — the tree needs none, not even one', () => {
    expect(matchSetupSource).not.toMatch(/eslint-disable.*kobi-strings\/catalogue-only-copy/);
  });
});
