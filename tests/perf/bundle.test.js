// @ts-check
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * KI-08-01 — the bundle budget, `tests/perf`'s first gate (`docs/sprints/improvement-08-performance-budgets-
 * before-the-art.md`).
 *
 * `ARCHITECTURE §12` fixes the number: "Initial JS bundle (gzip) ≤ 350 kB including three.js". This file
 * reads 350 kB as **1 kB = 1024 bytes** (see {@link BUNDLE_BUDGET_BYTES}) so nobody has to guess which
 * convention a future reader should use.
 *
 * **Why this builds the site itself, into its own temp directory, instead of reading `dist/`:**
 * (a) a gate that measures a `dist/` someone else produced measures whatever branch happened to be built
 * last, and can go green on a stale build while the working tree it is supposedly gating has grown past the
 * budget; (b) `HANDOFF.md` gives every ticket its own worktree, several of them share one container
 * (`CLAUDE.md`'s KI-19-00 section), and a Playwright suite's `vite preview` serves *this* checkout's
 * `dist/` — rebuilding `dist/` out from under a running suite would corrupt it, the same neighbourhood of
 * hazard as #86's Playwright lock. Building into a `mkdtempSync` directory and cleaning it up afterwards
 * avoids both: the measurement is always of the code on disk right now, and it can never collide with
 * another checkout's `dist/`.
 *
 * **Why the total across every emitted `.js`/`.css` file, not just the entry chunk:** §12's row names "the
 * initial JS bundle", but the browser has to fetch every file the build emits at least once during a normal
 * play session — `playtestPrompt-*.js` (KI-11-05) is a dynamic import that loads on demand rather than at
 * start, so the *initial* bundle is a strict subset of this total. Gating on the (larger) total is therefore
 * strictly conservative: it can never wave through an over-budget initial bundle by only weighing the rest,
 * because the rest is included too. What it can do — and is meant to do — is give a false alarm before the
 * initial-only figure would actually cross the line, which is the safe direction for an alarm to err in.
 *
 * **Why `gzipSync` at its default level:** that is the compression real HTTP servers negotiate for gzip by
 * default (`zlib`'s default `level` is `Z_DEFAULT_COMPRESSION`, level 6), and it is what Vite's own build
 * summary reports, so this figure and the one already visible in `npm run build`'s output agree.
 */

/**
 * The §12 budget, in bytes, read as 1 kB = 1024 bytes (not 1000) — stated once, here, so the "kB" in §12's
 * table never needs re-deriving. Do not duplicate this number anywhere else in this file; every comparison
 * and every printed percentage below is computed from this constant.
 */
export const BUNDLE_BUDGET_BYTES = 350 * 1024;

/** Only these extensions count as shipped bundle weight — fonts, images and the HTML shell are not JS/CSS. */
const COUNTED_EXTENSIONS = new Set(['.js', '.css']);

/**
 * Every `.js`/`.css` file under `dir` (Vite's default flat `assets/` layout has no subdirectories to
 * recurse into today, but walking is one loop cheaper than assuming that stays true).
 * @param {string} dir
 * @returns {string[]}
 */
function collectAssetFiles(dir) {
  /** @type {string[]} */
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAssetFiles(full));
    } else if (COUNTED_EXTENSIONS.has(extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Builds the site into `outDir` and returns each counted file's gzip size, largest first.
 * @param {string} outDir
 * @returns {{ path: string; gzipBytes: number }[]}
 */
function buildAndMeasure(outDir) {
  const result = spawnSync(
    'npx',
    ['vite', 'build', '--outDir', outDir, '--emptyOutDir'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `KI-08-01: \`vite build\` failed with exit code ${result.status}.\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`,
    );
  }
  return collectAssetFiles(outDir)
    .map((path) => ({ path, gzipBytes: gzipSync(readFileSync(path)).length }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes);
}

/**
 * Renders the AC2 report: a per-file table, the total, the budget, the percentage used and the headroom —
 * built once and reused by both the passing log line and a failing assertion's own message, so a reader sees
 * the same numbers whichever way this test reports them.
 * @param {{ path: string; gzipBytes: number }[]} files
 * @param {string} outDir
 */
function formatReport(files, outDir) {
  const totalBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const totalKb = totalBytes / 1024;
  const budgetKb = BUNDLE_BUDGET_BYTES / 1024;
  const percentUsed = (totalBytes / BUNDLE_BUDGET_BYTES) * 100;
  const headroomKb = budgetKb - totalKb;

  const table = files
    .map((file) => `  ${(file.gzipBytes / 1024).toFixed(2).padStart(8)} kB  ${file.path.slice(outDir.length + 1)}`)
    .join('\n');

  const summary =
    `KI-08-01 bundle budget: ${totalKb.toFixed(2)} kB / ${budgetKb.toFixed(2)} kB budget ` +
    `(${percentUsed.toFixed(1)}% used, ${headroomKb.toFixed(2)} kB headroom).`;

  return { totalBytes, totalKb, budgetKb, percentUsed, headroomKb, table, summary };
}

describe('KI-08-01 bundle budget', () => {
  it(
    'KI-08-01 AC2: the gzipped JS+CSS total is measured, printed and asserted against ARCHITECTURE §12',
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), 'kobi-bundle-budget-'));
      try {
        const files = buildAndMeasure(outDir);
        expect(files.length, 'the build produced no .js/.css files to measure').toBeGreaterThan(0);

        const { totalBytes, table, summary } = formatReport(files, outDir);

        // AC2: name the current size, the budget, and the percentage used — logged so it lands even on a
        // passing run, where a PR that adds 40 kB is otherwise invisible in green CI output.
        console.log(`${summary}\n${table}`);

        // The assertion's own message repeats the budget, the measurement and the headroom lost, so a
        // failing run is legible from the assertion alone (KI-08-04 AC1 reads this exact message).
        expect(totalBytes, summary).toBeLessThanOrEqual(BUNDLE_BUDGET_BYTES);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
  );
});
