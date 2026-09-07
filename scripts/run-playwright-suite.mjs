// @ts-check

/**
 * KI-03-01 — the runner every Playwright script in this repository goes through, so that **no two Playwright
 * suites ever run at once in one container** (#86, found in Sprint 06: two concurrent suites corrupt both).
 *
 * The sprint file asks the npm script itself to serialise, not just the CI job, and a lock only one of the
 * three suites took would be decoration — so `test:e2e`, `test:visual` and `test:agent` all run through here
 * and share one lock. It is held in the **OS temp directory**, not in the repository: the contention #86 is
 * about is one machine's GPU-less browser stack, which two checkouts on that machine share just as surely as
 * two runs of one checkout. Separate CI runners are separate containers and never see each other's lock.
 *
 * **It queues rather than refuses.** "Serialise" means "one after the other", and this repository is built by
 * several agents working in parallel in one container: a sprint that adds a suite would otherwise turn every
 * concurrent verification run into a spurious failure, which is a worse outcome than waiting. So a second
 * suite waits for the first, says so while it waits, and only gives up after {@link WAIT_TIMEOUT_MS} — long
 * enough for the longest suite in the repository (`tests/e2e`, ≈ 4 min on CI) plus its `webServer` start-up,
 * and short enough that a genuinely wedged lock does not look like a hang forever.
 *
 * Acquiring is `open(..., 'wx')` — create-if-absent, atomically — rather than a check followed by a write, so
 * two waiters released at the same moment cannot both think they won.
 *
 * Failing to *create* a lock (no temp directory, no permission) is not a reason to fail a test run: the lock
 * is a guard rail, not a feature under test, so anything other than "somebody else holds it" warns and
 * proceeds.
 *
 * Usage: `node scripts/run-playwright-suite.mjs <label> <playwright args...>`
 */

import { spawnSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const LOCK_PATH = join(tmpdir(), 'kobi-playwright-suite.lock');

/**
 * A lock older than this is treated as abandoned even if its process id happens to belong to something else
 * by now. The longest suite here is `tests/e2e` at ≈ 4 min on CI, and Playwright's own `webServer` timeout is
 * 2 min on top of that.
 */
const STALE_AFTER_MS = 30 * 60 * 1000;

/** How long a second suite waits for the first before giving up. */
const WAIT_TIMEOUT_MS = 20 * 60 * 1000;

/** How often it re-checks, and how often it says out loud that it is still waiting. */
const POLL_MS = 2_000;
const ANNOUNCE_EVERY_MS = 30_000;

/** @returns {{pid: number, label: string, startedAt: number} | null} */
function readLock() {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8'));
  } catch {
    // Absent, unreadable or half-written: not a lock.
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

/** @param {{pid: number, startedAt: number}} held */
function isAbandoned(held) {
  return !processIsAlive(held.pid) || Date.now() - held.startedAt > STALE_AFTER_MS;
}

/**
 * Creates the lock file if and only if nobody else holds one.
 *
 * @param {string} label
 * @returns {'acquired' | 'held' | 'unavailable'}
 */
function tryAcquire(label) {
  let fd;
  try {
    fd = openSync(LOCK_PATH, 'wx');
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code !== 'EEXIST') {
      process.stderr.write(
        `Could not write the Playwright suite lock (${String(error)}); continuing without it.\n`,
      );
      return 'unavailable';
    }
    const held = readLock();
    if (held !== null && !isAbandoned(held)) return 'held';
    process.stderr.write(
      held === null
        ? 'Removing an unreadable Playwright suite lock.\n'
        : `Removing an abandoned Playwright suite lock from "${held.label}" (pid ${held.pid}).\n`,
    );
    rmSync(LOCK_PATH, { force: true });
    return tryAcquire(label);
  }
  writeSync(fd, JSON.stringify({ pid: process.pid, label, startedAt: Date.now() }));
  closeSync(fd);
  return 'acquired';
}

/**
 * Blocks until the lock is ours, or until {@link WAIT_TIMEOUT_MS} passes.
 *
 * The wait is a synchronous `Atomics.wait` on a throwaway buffer rather than an `await` on a timer, because
 * everything else in this file is synchronous and a blocking sleep is exactly what is wanted here: this
 * process has nothing else to do.
 *
 * @param {string} label
 * @returns {boolean} whether the lock is held by us
 */
function acquire(label) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  let announcedAt = 0;
  for (;;) {
    const outcome = tryAcquire(label);
    if (outcome === 'acquired') return true;
    if (outcome === 'unavailable') return false;
    const held = /** @type {{pid: number, label: string}} */ (readLock() ?? { pid: 0, label: '?' });
    if (Date.now() >= deadline) {
      process.stderr.write(
        `\nGave up waiting for the "${held.label}" Playwright suite (pid ${held.pid}) after ` +
          `${Math.round(WAIT_TIMEOUT_MS / 60000)} minutes.\n` +
          `Two Playwright suites at once corrupt both (#86), so this run did not start.\n` +
          `If nothing is really running, delete ${LOCK_PATH} and try again.\n\n`,
      );
      process.exit(1);
    }
    if (Date.now() - announcedAt >= ANNOUNCE_EVERY_MS) {
      announcedAt = Date.now();
      process.stderr.write(
        `Waiting for the "${held.label}" Playwright suite to finish before starting "${label}" ` +
          `— two at once corrupt both (#86).\n`,
      );
    }
    Atomics.wait(sleeper, 0, 0, POLL_MS);
  }
}

function release() {
  const held = readLock();
  if (held !== null && held.pid !== process.pid) return; // not ours to remove
  try {
    rmSync(LOCK_PATH, { force: true });
  } catch {
    // Nothing useful to do; the abandonment check covers it for the next run.
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
// A suite killed with Ctrl-C must not leave its lock behind for the next twenty minutes.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    if (locked) release();
    process.exit(130);
  });
}
try {
  const result = spawnSync('npx', ['playwright', 'test', ...playwrightArgs], { stdio: 'inherit' });
  if (result.error !== undefined && result.error !== null) throw result.error;
  process.exitCode = result.status === null ? 1 : result.status;
} finally {
  if (locked) release();
}
