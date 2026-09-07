// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * KI-12-01 AC3 — `src/game/bots` imports nothing from `src/render`, `src/ui` or `tests/`.
 *
 * There is a lint rule for this too (`eslint.config.js`, `no-restricted-imports` scoped to
 * `src/game/bots/**`), and it is the one that fires while you type. This test is the backstop that the lint
 * rule cannot be, for two reasons:
 *
 * 1. **It follows the graph.** `no-restricted-imports` matches the specifier written in the file in front of
 *    it. A policy that imported a blameless-looking `src/game/foo.js` which itself imported `src/ui/…` would
 *    pass the lint rule and still drag the DOM into the CPU. This walks the whole reachable graph.
 * 2. **It also proves the reason the boundary exists.** `src/game/bots` has to run in three places — a plain
 *    Node unit test, the headless `tests/sim` harness, and inside a browser page as source text — and the
 *    thing that would break all three is a dependency on a renderer, a stylesheet or a test helper.
 *
 * The `tests/` half of the rule is the one that actually changed today: before KI-12-01 the policies *were*
 * test files. Nothing may point back the way they came.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const BOTS_DIR = path.join(REPO_ROOT, 'src/game/bots');

/** Forbidden import targets, as repository-relative directory prefixes. */
const FORBIDDEN = ['src/render/', 'src/ui/', 'tests/'];

/** Every `import ... from '<specifier>'` / `export ... from '<specifier>'` in a module. */
function specifiersOf(file) {
  const source = readFileSync(file, 'utf8');
  const found = [];
  const pattern = /(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g;
  let match = pattern.exec(source);
  while (match !== null) {
    found.push(match[1]);
    match = pattern.exec(source);
  }
  // A bare side-effect import (`import 'x'`) has no `from` clause, so it needs its own pass.
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  match = bare.exec(source);
  while (match !== null) {
    found.push(match[1]);
    match = bare.exec(source);
  }
  return found;
}

/**
 * Every module reachable from `src/game/bots/*.js`, as repository-relative paths, with the edge that led to
 * each one so a failure names the path rather than just the destination.
 *
 * @returns {{module: string, via: string[]}[]}
 */
function reachableModules() {
  const entries = readdirSync(BOTS_DIR)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(BOTS_DIR, name));

  /** @type {Map<string, string[]>} */
  const seen = new Map();
  const queue = entries.map((file) => ({ file, via: [path.relative(REPO_ROOT, file)] }));

  while (queue.length > 0) {
    const { file, via } = /** @type {{file: string, via: string[]}} */ (queue.shift());
    const relative = path.relative(REPO_ROOT, file);
    if (seen.has(relative)) continue;
    seen.set(relative, via);
    for (const specifier of specifiersOf(file)) {
      // Only relative specifiers can reach back into the repository; a bare specifier is a package, which
      // this boundary has nothing to say about (`CLAUDE.md`'s never list owns dependencies).
      if (!specifier.startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(file), specifier);
      queue.push({ file: resolved, via: [...via, path.relative(REPO_ROOT, resolved)] });
    }
  }
  return [...seen].map(([module, via]) => ({ module, via }));
}

describe('KI-12-01 AC3 · src/game/bots stays importable everywhere', () => {
  it('KI-12-01 AC3: nothing reachable from src/game/bots lives in src/render, src/ui or tests/', () => {
    const offenders = reachableModules()
      .filter(({ module }) => FORBIDDEN.some((prefix) => module.startsWith(prefix)))
      .map(({ via }) => via.join(' -> '));
    expect(offenders, `forbidden import path(s):\n${offenders.join('\n')}`).toEqual([]);
  });

  it('KI-12-01 AC3: the walk actually reaches the policies and their imports', () => {
    // Guards the test itself: an assertion over an empty set passes for the wrong reason, and this file's
    // whole value is the graph it walks. `policy.js` imports `src/core/grid.js`, so a correct walk finds a
    // module outside `src/game/bots` and finds every policy.
    const modules = reachableModules().map(({ module }) => module);
    expect(modules).toContain('src/game/bots/greedy.js');
    expect(modules).toContain('src/game/bots/survivor.js');
    expect(modules).toContain('src/game/bots/policy.js');
    expect(modules).toContain('src/core/grid.js');
  });
});
