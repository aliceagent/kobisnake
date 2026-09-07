// @ts-check
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-11-05 (#169's sibling half): `?playtest=1`'s three modules are a **dynamic** import, so a normal load
 * does not download the capture mode it will never run.
 *
 * Improvement 11 shipped with a static `import` in `main.js`, which put `playtestPrompt.js` and the two
 * `src/qa/` modules it pulls in — about 55 kB of source — into the entry chunk of every build. The sprint's
 * own rule is that "a normal load is byte-for-byte unaffected", and that was true of the DOM, the listeners
 * and the runtime but **not of the download**; the design lead ruled on #158 that the download counts too.
 *
 * Two halves, and both are needed. Reading the built files proves the split actually happened at build time;
 * counting requests proves the browser never asks for the split-off chunk unless the flag is on. Either one
 * alone can pass while the other is broken — a chunk that exists but is eagerly preloaded still costs the
 * player the download, and a request count of zero proves nothing if the code was inlined into the entry
 * chunk instead.
 *
 * These read `dist/`, so they describe the **built** artefact the preview server is serving, which is what a
 * real player receives — not the dev server's unbundled module graph.
 */

const DIST_ASSETS = fileURLToPath(new URL('../../dist/assets/', import.meta.url));

/**
 * Strings that only the playtest modules can produce: two questions' text (`PLAYTEST-SCRIPT.md`'s own words,
 * carried verbatim by `src/qa/playtestQuestions.js`), the export document's `kind`, and the approved hint
 * line's first word. Minification renames identifiers but never rewrites string literals, so these survive
 * into whichever chunk the code landed in — which is exactly what makes them a usable probe.
 */
const PLAYTEST_ONLY_STRINGS = [
  'Find your head',
  'Buffered turns',
  'kobisnake-playtest-session',
  'CHOOSE',
];

/** @returns {{name: string, source: string}[]} */
function builtChunks() {
  const files = readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));
  expect(files.length, 'no built JS in dist/assets — run `npm run build` first').toBeGreaterThan(0);
  return files.map((name) => ({ name, source: readFileSync(DIST_ASSETS + name, 'utf8') }));
}

/** The entry chunk: the one `index.html` loads directly, which every player downloads. */
function entryChunk() {
  const html = readFileSync(fileURLToPath(new URL('../../dist/index.html', import.meta.url)), 'utf8');
  const match = html.match(/src="[^"]*?(assets\/[^"]+\.js)"/);
  expect(match, 'index.html loads no entry script').not.toBeNull();
  const name = /** @type {RegExpMatchArray} */ (match)[1].replace('assets/', '');
  return { name, source: readFileSync(DIST_ASSETS + name, 'utf8') };
}

test.describe('KI-11-05 the playtest modules are not in the entry chunk', () => {
  test('KI-11-05 AC1: the entry chunk contains none of the playtest modules, and another chunk does', () => {
    const entry = entryChunk();
    const others = builtChunks().filter((chunk) => chunk.name !== entry.name);

    for (const needle of PLAYTEST_ONLY_STRINGS) {
      expect(
        entry.source.includes(needle),
        `entry chunk ${entry.name} still contains ${JSON.stringify(needle)} — the import is not dynamic`,
      ).toBe(false);
      // ...and it has not simply vanished: it moved, rather than being tree-shaken away entirely, which
      // would mean the mode no longer works at all.
      expect(
        others.some((chunk) => chunk.source.includes(needle)),
        `no chunk contains ${JSON.stringify(needle)} — the playtest modules were dropped, not split out`,
      ).toBe(true);
    }
  });

  test('KI-11-05 AC1: a plain load requests no playtest chunk; ?playtest=1 does', async ({ page }) => {
    const entry = entryChunk();
    const playtestChunks = builtChunks()
      .filter((chunk) => chunk.name !== entry.name)
      .filter((chunk) => PLAYTEST_ONLY_STRINGS.some((needle) => chunk.source.includes(needle)))
      .map((chunk) => chunk.name);
    expect(playtestChunks.length, 'expected exactly one split-off playtest chunk').toBeGreaterThan(0);

    /** @param {string} url @returns {string[]} */
    const matching = (url) => playtestChunks.filter((name) => url.includes(name));

    /** @type {string[]} */
    const plainLoad = [];
    page.on('request', (request) => plainLoad.push(...matching(request.url())));
    await page.goto(DEFAULT_QUERY, { waitUntil: 'load' });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(plainLoad, 'a normal load downloaded the playtest chunk').toEqual([]);

    // The other half of the claim: with the flag on it *is* fetched, so the assertion above is about the
    // gate rather than about a chunk nothing ever loads.
    /** @type {string[]} */
    const flagged = [];
    page.on('request', (request) => flagged.push(...matching(request.url())));
    await page.goto('?playtest=1&test=1&seed=1&reducedFx=1', { waitUntil: 'load' });
    await expect(page.locator('[data-playtest-export]')).toHaveCount(1);
    expect(flagged.length, 'the playtest chunk was never fetched under ?playtest=1').toBeGreaterThan(0);
  });
});
