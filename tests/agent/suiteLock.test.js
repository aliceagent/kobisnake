// @ts-check
import { spawn, spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * KI-03-01 — the #86 suite lock, tested where it actually failed.
 *
 * Two Playwright suites at once corrupt both, and `scripts/run-playwright-suite.mjs` is what prevents it. The
 * first version of that file also treated a lock older than thirty minutes as abandoned; a `tests/e2e` run
 * then hung — alive, holding the lock, producing nothing — and at the thirty-minute mark a waiting suite
 * declared it abandoned and started anyway. **The guard rail failed open, in exactly the situation it was
 * built for.** These tests are that scenario, so it cannot come back quietly.
 *
 * `playwright test --help` is the payload: it exercises the real spawn path and exits immediately without
 * starting a browser or a web server, so these tests are fast and, more importantly, cannot themselves become
 * a second Playwright suite (#86 again — a test of the rule must not break the rule).
 */

const LOCK_PATH = join(tmpdir(), 'kobi-playwright-suite.lock');
const RUNNER = 'scripts/run-playwright-suite.mjs';

/** @type {import('node:child_process').ChildProcess | null} */
let holder = null;

afterEach(() => {
  holder?.kill('SIGKILL');
  holder = null;
  rmSync(LOCK_PATH, { force: true });
});

/**
 * Claims the lock for a real, live process, backdated by `ageMs`.
 * @param {number} ageMs
 */
function holdLock(ageMs) {
  // A live process that does nothing: the "wedged suite" this file is about.
  holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore' });
  writeFileSync(
    LOCK_PATH,
    JSON.stringify({ pid: holder.pid, label: 'e2e', startedAt: Date.now() - ageMs }),
  );
}

/** @param {number} waitMs */
function runRunner(waitMs) {
  return spawnSync(process.execPath, [RUNNER, 'agent', '--help'], {
    encoding: 'utf8',
    env: { ...process.env, KOBI_SUITE_LOCK_WAIT_MS: String(waitMs) },
  });
}

describe('KI-03-01 · the #86 Playwright suite lock', () => {
  it('KI-03-01: a live holder is never evicted, however old its lock is', () => {
    holdLock(2 * 60 * 60 * 1000); // two hours old, and still alive
    const result = runRunner(1_500);

    expect(result.status, 'the waiter must fail rather than start a second suite').toBe(1);
    expect(result.stderr).toContain('Gave up waiting');
    expect(result.stderr).toContain(String(holder?.pid));
    // The failure has to point at the process to go and look at, or it is not actionable.
    expect(result.stderr).toContain('still alive');
    // And it must not have run the suite.
    expect(result.stdout).not.toContain('Usage:');
  });

  it('KI-03-01: a lock whose process is gone is taken over', async () => {
    holdLock(0);
    const child = /** @type {import('node:child_process').ChildProcess} */ (holder);
    // Awaited rather than polled with `process.kill(pid, 0)`: until Node reaps the child it is a zombie, and
    // signal 0 still succeeds on a zombie — so polling for "gone" never finishes. The `exit` event is the
    // moment the pid is genuinely free.
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGKILL');
    await exited;

    const result = runRunner(1_500);
    expect(result.stderr).toContain('whose process is gone');
    expect(result.status).toBe(0);
  });

  it('KI-03-01: an unheld lock is taken straight away', () => {
    rmSync(LOCK_PATH, { force: true });
    const result = runRunner(1_500);
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('Gave up waiting');
  });
});
