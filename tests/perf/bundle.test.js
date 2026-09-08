// @ts-check
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

/**
 * KI-08-01 — the bundle budget, `tests/perf`'s first gate (`docs/sprints/improvement-08-performance-budgets-
 * before-the-art.md`).
 *
 * `ARCHITECTURE §12` fixes the number: "Initial JS bundle (gzip) ≤ 350 kB including three.js". This file
 * reads 350 kB as **1 kB = 1000 bytes** (see {@link BUNDLE_BUDGET_BYTES}) for two reasons, both worth stating
 * so nobody re-litigates the unit later: (a) `npm run build`'s own Vite summary prints its gzip sizes in
 * 1000-byte kB, so a reader can compare this test's number against that log line with no conversion in their
 * head; (b) where §12's "kB" is ambiguous between the two readings, the 1000-byte one is the *stricter* budget
 * (350 000 bytes < 358 400 bytes), and a budget should take the tighter reading rather than hand the art
 * sprints 8 kB nobody voted for.
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
 * **Why `npx --no-install`:** plain `npx vite build` falls back to fetching `vite` from the registry if
 * `node_modules` is ever missing or out of step with `package.json`. `CLAUDE.md`'s first never-list rule is
 * that nothing here ever asks the network for anything; `--no-install` makes that refusal mechanical instead
 * of relying on `node_modules` always happening to already be there.
 *
 * **Why the total across every emitted `.js`/`.css` file, not just the entry chunk:** §12's row names "the
 * initial JS bundle", but the browser has to fetch every file the build emits at least once during a normal
 * play session — `playtestPrompt-*.js` (KI-11-05) is a dynamic import that loads on demand rather than at
 * start, so the *initial* bundle is a strict subset of this total. Gating on the (larger) total is therefore
 * strictly conservative: it can never wave through an over-budget initial bundle by only weighing the rest,
 * because the rest is included too. What it can do — and is meant to do — is give a false alarm before the
 * initial-only figure would actually cross the line, which is the safe direction for an alarm to err in.
 *
 * **Why `gzipSync` at its default level:** `gzipSync`'s default (`Z_DEFAULT_COMPRESSION`, level 6) is the
 * level Vite's own build summary uses for the gzip figure it prints next to each file, so for any given build
 * this test's byte count and that summary's byte count are the same compression of the same bytes — verified
 * on this branch's build, where the two agreed to the byte. With both now expressed in the same 1000-byte kB
 * (the unit note above), the printed figures agree too, not just the underlying bytes.
 */

/**
 * The §12 budget, in bytes, read as 1 kB = 1000 bytes — stated once, here, so the "kB" in §12's table never
 * needs re-deriving. Do not duplicate this number anywhere else in this file; every comparison and every
 * printed figure below is computed from this constant.
 */
export const BUNDLE_BUDGET_BYTES = 350_000;

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
 * Builds the site into `outDir` and returns each counted file's gzip size, largest first, with `path` already
 * relative to `outDir` — so {@link checkBundleBudget} never has to know where on disk the build happened,
 * which is what lets it also take a fabricated file list straight from a test.
 *
 * `--no-install`: see this file's module comment.
 *
 * @param {string} outDir
 * @returns {{ path: string; gzipBytes: number }[]}
 */
function buildAndMeasure(outDir) {
  const result = spawnSync(
    'npx',
    ['--no-install', 'vite', 'build', '--outDir', outDir, '--emptyOutDir'],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `KI-08-01: \`vite build\` failed with exit code ${result.status}.\n--- stderr ---\n${result.stderr}\n--- stdout ---\n${result.stdout}`,
    );
  }
  return collectAssetFiles(outDir)
    .map((path) => ({
      path: relative(outDir, path),
      gzipBytes: gzipSync(readFileSync(path)).length,
    }))
    .sort((a, b) => b.gzipBytes - a.gzipBytes);
}

/**
 * The pure comparison both AC1 and AC2 share — extracted so the message KI-08-04's own AC1 depends on is
 * proven once, by a test that can hand it an arbitrary file list, rather than only ever exercised indirectly
 * through a real build. Never duplicate this logic in a second place; a test that wants "what happens over
 * budget" calls this function with a fabricated `files` list instead.
 *
 * @param {{ path: string; gzipBytes: number }[]} files
 * @returns {{ ok: boolean; totalBytes: number; table: string; summary: string }}
 */
export function checkBundleBudget(files) {
  const totalBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const totalKb = totalBytes / 1000;
  const budgetKb = BUNDLE_BUDGET_BYTES / 1000;
  const percentUsed = (totalBytes / BUNDLE_BUDGET_BYTES) * 100;
  const ok = totalBytes <= BUNDLE_BUDGET_BYTES;

  const table = files
    .map((file) => `  ${(file.gzipBytes / 1000).toFixed(2).padStart(8)} kB  ${file.path}`)
    .join('\n');

  // AC3 (the sprint's own QA plan): a failing gate names the budget, the measurement, and what to do about
  // it. Under budget that "what to do" has nothing to say, so only the over-budget message carries the
  // instruction — and it reads as an overage ("X kB over budget"), not a negative headroom, which is a
  // number a reader has to do arithmetic on to understand.
  const summary = ok
    ? `KI-08-01 bundle budget: ${totalKb.toFixed(2)} kB / ${budgetKb.toFixed(2)} kB budget ` +
      `(${percentUsed.toFixed(1)}% used, ${(budgetKb - totalKb).toFixed(2)} kB headroom).`
    : `KI-08-01 bundle budget: ${totalKb.toFixed(2)} kB / ${budgetKb.toFixed(2)} kB budget ` +
      `(${percentUsed.toFixed(1)}% used, ${(totalKb - budgetKb).toFixed(2)} kB over budget). ` +
      `Reduce what ships. If the art genuinely needs more than ${budgetKb.toFixed(2)} kB, that is a change ` +
      'to ARCHITECTURE §12 for the design lead to make — propose it in a PR labelled tuning-proposal, never ' +
      'by raising this constant.';

  return { ok, totalBytes, table, summary };
}

describe('KI-08-01 bundle budget', () => {
  it('KI-08-01 AC1: an over-budget build fails with a message naming the budget, the measurement and what to do', () => {
    // Fabricated, not a real build — this proves the comparison and message on their own, so KI-08-04's own
    // AC1 (which reads this exact message) is proven once here rather than only ever inferred from a log
    // pasted into a PR description.
    const files = [
      { path: 'assets/index-fake.js', gzipBytes: BUNDLE_BUDGET_BYTES - 10_000 },
      { path: 'assets/extra-fake.js', gzipBytes: 60_000 },
    ];
    const result = checkBundleBudget(files);

    expect(result.ok).toBe(false);
    // Names the measurement.
    expect(result.summary).toContain(`${(result.totalBytes / 1000).toFixed(2)} kB`);
    // Names the budget.
    expect(result.summary).toContain(`${(BUNDLE_BUDGET_BYTES / 1000).toFixed(2)} kB budget`);
    // Reads as an overage, not a riddle of negative headroom.
    expect(result.summary).toContain('kB over budget');
    expect(result.summary).not.toContain('headroom');
    // Says what to do, and says it is a design-lead decision, never a quietly raised constant (the sprint's
    // own Risks section).
    expect(result.summary).toContain('Reduce what ships');
    expect(result.summary).toContain('ARCHITECTURE §12');
    expect(result.summary).toContain('tuning-proposal');
  });

  it(
    'KI-08-01 AC2: the gzipped JS+CSS total is measured, printed and asserted against ARCHITECTURE §12',
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), 'kobi-bundle-budget-'));
      try {
        const files = buildAndMeasure(outDir);
        expect(files.length, 'the build produced no .js/.css files to measure').toBeGreaterThan(0);

        const { ok, table, summary } = checkBundleBudget(files);

        // AC2: name the current size, the budget, and the percentage used — logged so it lands even on a
        // passing run, where a PR that adds 40 kB is otherwise invisible in green CI output.
        console.log(`${summary}\n${table}`);

        // The assertion's own message is the same `summary` checkBundleBudget builds for AC1's fabricated
        // case, so the two can never drift apart.
        expect(ok, summary).toBe(true);
      } finally {
        rmSync(outDir, { recursive: true, force: true });
      }
    },
  );
});
