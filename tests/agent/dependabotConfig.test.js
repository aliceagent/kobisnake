// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KI-19-02 — the automated-update config, asserted rather than merely written down.
 *
 * Same limitation as `tests/agent/supplyChain.test.js` and for the same reason: there is no YAML parser in
 * this repository and `CLAUDE.md` forbids adding a dependency for one, so this reads `.github/dependabot.yml`
 * as text and reasons about it with indentation, the same way YAML itself scopes a block. That is provably
 * enough for what AC2 actually asks — whether the string `three` appears inside a `groups:` block's
 * `patterns:` list versus its `exclude-patterns:` list — without a real parser.
 *
 * The file's own schema-correctness (does GitHub Dependabot accept this document at all — field names, enum
 * values, required properties) was checked once by hand against GitHub's published JSON Schema
 * (`https://json.schemastore.org/dependabot-2.0.json`) using `js-yaml`/`ajv`, both already present in
 * `node_modules` transitively (via `eslint`) but not a declared dependency of this repository, which is
 * exactly why that check is not committed as a test: a test that only passes because an *undeclared*
 * transitive package happens to still be there is not a property of this repository, it is a property of
 * today's `npm ls`. This file checks the properties that are ours to keep true.
 */

const CONFIG_PATH = '.github/dependabot.yml';

/** @returns {string} */
function config() {
  return readFileSync(CONFIG_PATH, 'utf8');
}

/** Non-comment, non-blank lines, original indentation kept — comments would otherwise confuse the
 * indentation-based block search below (a comment can sit at any indentation for readability).
 * @param {string} text
 */
function codeLines(text) {
  return text.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
}

/**
 * The indented block that follows a `key:` line, YAML-block-scoped by indentation: every subsequent line more
 * indented than the key belongs to it; the first line at the same or lower indentation ends it.
 *
 * @param {string[]} lines code-only lines, e.g. from {@link codeLines}
 * @param {string} key the exact key name, e.g. `dev-dependencies`
 * @returns {string} the block's lines, joined, not including the `key:` line itself
 */
function block(lines, key) {
  const keyRe = new RegExp(`^(\\s*)${key}:\\s*$`);
  const startIndex = lines.findIndex((line) => keyRe.test(line));
  if (startIndex === -1) {
    throw new Error(`No \`${key}:\` key found in ${CONFIG_PATH}`);
  }
  const indent = /** @type {RegExpMatchArray} */ (lines[startIndex].match(keyRe))[1].length;
  const body = [];
  for (let i = startIndex + 1; i < lines.length; i++) {
    const lineIndent = lines[i].match(/^\s*/)?.[0].length ?? 0;
    if (lineIndent <= indent) break;
    body.push(lines[i]);
  }
  return body.join('\n');
}

/** Every `patterns:` block in the document (not `exclude-patterns:` — the regex anchors on the trimmed line
 * starting with `patterns:`, which `exclude-patterns:` does not).
 * @param {string[]} lines
 */
function allPatternsBlocks(lines) {
  const found = [];
  lines.forEach((line, i) => {
    if (!/^\s*patterns:\s*$/.test(line)) return;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const lineIndent = lines[j].match(/^\s*/)?.[0].length ?? 0;
      if (lineIndent <= indent) break;
      body.push(lines[j]);
    }
    found.push(body.join('\n'));
  });
  return found;
}

describe('KI-19-02 automated updates', () => {
  it('KI-19-02 AC1: the config exists and targets npm, weekly', () => {
    const text = config();
    expect(text).toContain("package-ecosystem: 'npm'");
    expect(text).toContain("interval: 'weekly'");
  });

  it("KI-19-02 AC1: package.json's exact pins are respected (versioning-strategy: increase)", () => {
    // .npmrc's save-exact=true (KI-19-01) means every version is an exact pin; `increase` is the setting
    // that keeps Dependabot rewriting the manifest to a new exact version rather than widening it to a range.
    const lines = codeLines(config());
    const npmUpdate = lines.slice(0, lines.findIndex((l) => /github-actions/.test(l)));
    expect(npmUpdate.join('\n')).toContain('versioning-strategy: increase');
  });

  it('KI-19-02 AC2: three and its type definitions are excluded from the dev-dependencies group', () => {
    const lines = codeLines(config());
    const devGroup = block(lines, 'dev-dependencies');
    const excludePatterns = block(devGroup.split('\n'), 'exclude-patterns');
    expect(excludePatterns).toContain("'three'");
    expect(excludePatterns).toContain("'@types/three'");
  });

  it('KI-19-02 AC2: three never appears inside any group\'s `patterns:` (only ever `exclude-patterns:`)', () => {
    // This is the literal claim of AC2: `three` is not a member of any group. `dependency-type: development`
    // already keeps it out of dev-dependencies (three ships to the player, it is not a devDependency), and
    // this asserts the stronger property directly — that no group anywhere lists it as an *included* pattern.
    const lines = codeLines(config());
    for (const patternsBlock of allPatternsBlocks(lines)) {
      expect(patternsBlock).not.toMatch(/three/);
    }
  });

  it('KI-19-02 AC2: the dev-dependencies group is minor/patch only — a major dev update matches no group', () => {
    // "A renderer update needs the visual suite and the design lead" governs `three` specifically, but the
    // ticket's other stated goal is that a major never rides in with a group at all (the Vite 5 -> 8 fix is
    // exactly this case) — asserted by requiring `minor`/`patch` and forbidding `major` in the same block.
    const lines = codeLines(config());
    const devGroup = block(lines, 'dev-dependencies');
    const updateTypes = block(devGroup.split('\n'), 'update-types');
    expect(updateTypes).toContain("'minor'");
    expect(updateTypes).toContain("'patch'");
    expect(updateTypes).not.toMatch(/major/);
  });

  it('KI-19-02: nothing here auto-merges — no auto-merge workflow exists for Dependabot to be exempted from', () => {
    // "three.js ... never auto-merged" is true today because nothing in this repository auto-merges anything.
    // If that ever changes, the new workflow is what has to exclude `three`, not this file — recorded here so
    // a future auto-merge workflow trips this test and has to look at why.
    const workflowsDir = '.github/workflows';
    const allWorkflowText = readdirSync(workflowsDir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => readFileSync(join(workflowsDir, f), 'utf8'))
      .join('\n')
      .toLowerCase();
    expect(allWorkflowText).not.toContain('automerge');
    expect(allWorkflowText).not.toContain('auto-merge');
  });
});
