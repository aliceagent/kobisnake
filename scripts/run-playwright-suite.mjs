// @ts-check

/**
 * KI-03-01 — the runner every Playwright script in this repository goes through, so that **no two Playwright
 * suites ever run at once in one container** (#86, found in Sprint 06: two concurrent suites corrupt both).
 *
 * The sprint file asks the npm script itself to serialise, not just the CI job. A lock that only one of the
 * three suites takes would be decoration, so `test:e2e`, `test:visual` and `test:agent` all run through here
 * and share one lock. It is held in the **OS temp directory**, not in the repository: the contention #86 is
 * about is one machine's GPU-less browser stack, which two checkouts on the same machine share just as
 * surely as two runs of one checkout. Separate CI runners are separate containers and never see each
 * other's lock.
 *
 * It refuses rather than queues. A suite that waits behind another suite for six minutes looks like a hang,
 * and the honest answer to "you started two suites" is to say so.
 *
 * Failing to *create* a lock (no temp directory, no permission) is not a reason to fail a test run: the lock
 * is a guard rail, not a feature under test, so anything other than "somebody else holds it" warns and
 * proceeds.
 *
 * Usage: `node scripts/run-playwright-suite.mjs <label> <playwright args...>`
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LOCK_PATH = join(tmpdir(), 'kobi-playwright-suite.lock');

/**
 * A lock older than this is treated as abandoned even if its process id happens to be alive again. The
 * longest suite in the repository is `tests/e2e` at ≈ 3 min locally and 4 min on CI, and Playwright's own
 * `webServer` timeout is 2 min on top of that.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** @returns {{pid: number, label: string, startedAt: number} | null} */
function readLock() {
  try {
    if (!existsSync(LOCK_PATH)) return null;
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    // An unreadable or half-written lock is not a lock.
    return null;
  }
}

/** @param {number} pid */
function processIsAlive(pid) {
  try {
    // Signal 0 checks for existence and permission without delivering anything.
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/** @param {string} label */
function acquire(label) {
  const held = readLock();
  if (held !== null) {
    const stale = !processIsAlive(held.pid) || Date.now() - held.startedAt > STALE_AFTER_MS;
    if (!stale) {
      process.stderr.write(
        `\nRefusing to start the "${label}" Playwright suite: "${held.label}" is already running in this ` +
          `container (pid ${held.pid}).\n` +
          `Two Playwright suites at once corrupt both — see issue #86. Run them one after the other.\n` +
          `Lock: ${LOCK_PATH}\n\n`,
      );
      process.exit(1);
    }
    process.stderr.write(
      `Ignoring a stale Playwright suite lock from "${held.label}" (pid ${held.pid}).\n`,
    );
  }
  try {
    writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, label, startedAt: Date.now() }));
    return true;
  } catch (error) {
    process.stderr.write(
      `Could not write the Playwright suite lock (${String(error)}); continuing without it.\n`,
    );
    return false;
  }
}

function release() {
  const held = readLock();
  if (held !== null && held.pid !== process.pid) return; // not ours to remove
  try {
    rmSync(LOCK_PATH, { force: true });
  } catch {
    // Nothing useful to do; the staleness check above covers it for the next run.
  }
}

const [label, ...playwrightArgs] = process.argv.slice(2);
if (label === undefined || playwrightArgs.length === 0) {
  process.stderr.write(
    'usage: node scripts/run-playwright-suite.mjs <label> <playwright args...>\n',
  );
  process.exit(2);
}

const locked = acquire(label);
try {
  const result = spawnSync('npx', ['playwright', 'test', ...playwrightArgs], { stdio: 'inherit' });
  if (result.error !== undefined && result.error !== null) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} finally {
  if (locked) release();
}
