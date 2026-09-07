// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KI-19-01 — the integrity gates, asserted rather than merely written down.
 *
 * The ticket's own wording for AC's first half is "CI installs with `npm ci` only (**it already does — assert
 * it**)", which is the whole reason this file exists: a property of the pipeline that nothing checks is a
 * property that survives exactly until the next person adds a job. `tests/agent/` is where this repository
 * keeps Node-side tests of its own tooling (`suiteLock.test.js` for the #86 lock, `previewPort.test.js` for
 * KI-19-00's ports), so a test of the workflows belongs here too.
 *
 * **Read as text, not parsed.** There is no YAML parser in this repository and `CLAUDE.md` forbids adding a
 * dependency for one, so these assertions are deliberately about the presence and shape of command lines
 * rather than about a parsed job graph. That is a real limitation and worth stating: this file can prove that
 * no workflow installs the wrong way and that the supply-chain job runs the three checks it is supposed to,
 * and it cannot prove anything about job ordering or `needs:` edges. It checks the thing that actually breaks.
 */

const WORKFLOW_DIR = '.github/workflows';

/** @returns {{name: string, text: string}[]} */
function workflows() {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((name) => ({ name, text: readFileSync(join(WORKFLOW_DIR, name), 'utf8') }));
}

/**
 * The lines a workflow actually executes, with comments and `echo`ed prose dropped.
 *
 * Both matter here: `ci.yml`'s own comments discuss `npm install` at length, and its failure messages `echo`
 * the exact command a developer should run to regenerate the lockfile. Neither is an install, and a check that
 * could not tell them apart from one would be a check nobody could write a helpful error message around.
 *
 * @param {string} text
 */
function commandLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => !line.startsWith('echo'));
}

describe('KI-19-01 integrity gates', () => {
  it('KI-19-01 AC1: every workflow installs with `npm ci`, never a plain `npm install`', () => {
    const offenders = [];
    for (const { name, text } of workflows()) {
      for (const line of commandLines(text)) {
        if (!/\bnpm\s+(install|i|add)\b/.test(line)) continue;
        // The one legitimate `npm install`: regenerating the lockfile from package.json to prove it is in
        // sync. It writes no node_modules and runs nothing from the registry, so it is not an install of
        // dependencies at all — it is the lockfile check itself.
        if (line.includes('--package-lock-only')) continue;
        offenders.push(`${name}: ${line}`);
      }
    }
    expect(
      offenders,
      `A workflow installs dependencies with something other than \`npm ci\`. ` +
        `\`npm ci\` installs strictly from package-lock.json and refuses when package.json disagrees with ` +
        `it, which is the property KI-19-01 AC1 rests on; \`npm install\` would silently resolve a fresh ` +
        `tree and the lockfile gate would stop meaning anything. Offending lines:\n${offenders.join('\n')}`,
    ).toEqual([]);

    // A positive control: the assertion above passes trivially if nothing installs at all.
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    expect(ciYml.match(/- run: npm ci/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('KI-19-01 AC1: the lockfile check regenerates the lockfile and fails on any diff', () => {
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    expect(ciYml).toContain('npm install --package-lock-only --ignore-scripts');
    expect(ciYml).toContain('git diff --exit-code package-lock.json');
    // Every gate fails with a message that says what to do (the sprint file's Risks section).
    expect(ciYml).toContain('npm install --package-lock-only');
    expect(ciYml).toContain('Lockfile out of date');
  });

  it('KI-19-01 AC2: the blocking audit covers what ships, at high and above', () => {
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    // `--omit=dev` is the scope decision and `--audit-level=high` is the level one; both are load-bearing and
    // both are argued in the workflow's own comment, so a change to either should have to change this line.
    expect(ciYml).toContain('npm audit --omit=dev --audit-level=high');
    expect(ciYml).toContain('Vulnerable runtime dependency');
  });

  it('KI-19-01 AC2: the dev-toolchain audit is reported and cannot fail the job', () => {
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    expect(ciYml).toContain('npm audit || true');
    expect(ciYml).toContain('advisory, never fails');
  });

  it('KI-19-01 AC3: an SBOM is generated and uploaded as an artifact', () => {
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    expect(ciYml).toContain('npm sbom --sbom-format cyclonedx');
    expect(ciYml).toContain('sbom.cyclonedx.json');
    expect(ciYml).toContain('name: sbom');
  });

  it("KI-19-01: the SBOM needs no dependency — `npm sbom` is npm's own", () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(all)) {
      expect(
        /cyclonedx|sbom|spdx/i.test(name),
        `${name} looks like an SBOM generator. KI-19-01 uses npm's built-in \`npm sbom\`, so no such ` +
          `dependency should have been needed; if one was genuinely required it needs naming and ` +
          `justifying in a pull request (CLAUDE.md: never add a dependency without approval).`,
      ).toBe(false);
    }
  });

  it('KI-19-01: .npmrc pins exact versions and enforces the Node engine', () => {
    const npmrc = readFileSync('.npmrc', 'utf8');
    expect(npmrc).toMatch(/^save-exact=true$/m);
    expect(npmrc).toMatch(/^engine-strict=true$/m);
  });

  it('KI-19-01: every dependency is pinned to an exact version', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const ranged = Object.entries(all).filter(([, range]) => !/^\d+\.\d+\.\d+/.test(String(range)));
    expect(
      ranged,
      `These dependencies are not pinned to an exact version, so what ships becomes a function of the day ` +
        `someone ran npm install: ${ranged.map(([n, r]) => `${n}@${r}`).join(', ')}`,
    ).toEqual([]);
  });

  it('KI-19-01 (#200): a failing browser suite is named by its own step', () => {
    const ciYml = readFileSync(join(WORKFLOW_DIR, 'ci.yml'), 'utf8');
    // `continue-on-error` makes both suite steps report `conclusion: success` whatever happened, and the jobs
    // API exposes only that; two separately named gate steps put the answer back in the step list, which is
    // readable from an agent session where logs and artifacts are not (#172, #200).
    expect(ciYml).toContain('name: e2e failed');
    expect(ciYml).toContain('name: visual failed');
    expect(ciYml).toContain("if: steps.e2e.outcome == 'failure'");
    expect(ciYml).toContain("if: steps.visual.outcome == 'failure'");
  });
});
