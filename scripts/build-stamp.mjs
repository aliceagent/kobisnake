// @ts-check

/**
 * KI-19-03 — resolves the commit short-hash a build stamps itself with.
 *
 * Shared between `vite.config.js` (which bakes the result into `import.meta.env` via `define`, so it is
 * "baked in at build time" rather than read at runtime — AC2, no network request to find it out) and
 * `tests/e2e/build-stamp.spec.js` (which needs the value a build *would* have used, to assert AC1 without
 * ever hard-coding a sha — the same reason `scripts/preview-port.mjs` is shared between `vite.config.js` and
 * `playwright.config.js` rather than duplicated). Both callers run through the same `npm run test:e2e` /
 * `npm run build` process tree and so see the same environment, which is what makes the equality check in
 * the e2e spec honest rather than coincidental.
 *
 * Vercel and GitHub Actions both build from a detached or shallow checkout where `git rev-parse` may not see
 * the commit that triggered the build, or `git` may not be on `PATH` at all — so their own env vars are
 * checked first, in the order a build is more likely to be running under one: `VERCEL_GIT_COMMIT_SHA`
 * (Vercel), then `GITHUB_SHA` (GitHub Actions). Only once neither is set does this shell out to
 * `git rev-parse --short HEAD` — a plain local `npm run build` has no such env var but does have a `.git`.
 * If even that fails (no `git` binary, not a repository, a shallow clone with no reachable HEAD) the build
 * must never fail because it could not learn its own commit (the ticket's own "never a crash or an empty
 * string") — `'unknown'` is a clearly non-committal literal a bug report can still quote verbatim.
 */

import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root of *this* checkout, the same way `scripts/preview-port.mjs` resolves it — from this
 * module's own URL rather than `process.cwd()`, so the answer does not depend on where a command was run
 * from inside the tree. */
const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @returns {string} a short commit hash (as `git rev-parse --short` or a CI env var gives it, sliced to 7
 *   characters either way), or the literal string `'unknown'`.
 */
export function resolveBuildCommit() {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
  if (envSha) return envSha.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', {
      cwd: CHECKOUT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * The build date, as an ISO-8601 string, read at the moment the build runs. A function rather than a
 * constant so nothing evaluates it before it is actually needed; `vite.config.js` is the one real caller.
 *
 * @returns {string}
 */
export function resolveBuildDate() {
  return new Date().toISOString();
}
