// @ts-check
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CHECKOUT_ROOT,
  PORT_RANGE_END,
  PORT_RANGE_START,
  previewBaseUrl,
  previewPort,
  previewPortForCheckout,
} from '../../scripts/preview-port.mjs';

/**
 * KI-19-00 AC1 — the per-checkout preview port, tested where it actually failed (#170).
 *
 * `HANDOFF.md` gives every ticket its own worktree and several of them share one container. On a fixed port
 * that produced two failures, both recorded on #170: a suite from worktree B adopting worktree A's
 * `vite preview` and going green about **A's** `dist/`, and — worse to meet — B adopting A's server, A tearing
 * it down when its own suite finished, and B then burning 57 × 30 s of test timeouts against a dead port with
 * no output at all.
 *
 * AC1 asks for "a test that starts a server from one checkout and shows the other refuses to reuse it", and
 * that is literally what {@link module:previewPort~reuse} below does: it binds the port worktree A would
 * derive, then dials the port worktree B would derive and shows nothing answers there. "Refuses to reuse it"
 * is exactly that — Playwright's `reuseExistingServer` reuses whatever answers on **its own** `baseURL`, so a
 * dead dial from B's port is the mechanism by which B starts its own server instead of adopting A's.
 *
 * These tests never bind the *real* checkout's port. `npm run test:unit` is routinely run while a real
 * Playwright suite holds this checkout's preview server, and binding that port would fight it — the same
 * mistake `suiteLock.test.js` records having been caught making with the real lock file. The two paths below
 * are fictional worktrees under a real-looking root, which is all the derivation needs, since it is a pure
 * function of the string.
 */

/** Two checkouts that do not exist, so nothing here can collide with a live suite's real preview server. */
const WORKTREE_A = '/home/user/wt/ki-19-00';
const WORKTREE_B = '/home/user/wt/ki-19-01';

/** @type {import('node:http').Server | null} */
let server = null;

afterEach(async () => {
  if (server !== null) {
    await new Promise((resolve) => server?.close(() => resolve(undefined)));
    server = null;
  }
});

/**
 * Binds a trivial HTTP server on `port`, standing in for the `vite preview` a worktree leaves behind.
 * @param {number} port
 */
function startPreviewLikeServerOn(port) {
  server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>worktree A</title>');
  });
  return new Promise((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(port, '127.0.0.1', () => resolve(undefined));
  });
}

/**
 * Whether anything is listening on `port` — the question `reuseExistingServer` asks before deciding whether
 * to adopt a server or start one of its own.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function somethingIsListeningOn(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.setTimeout(2_000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

describe('KI-19-00 per-checkout preview port', () => {
  it('KI-19-00 AC1: a server started from one checkout is not on the port another checkout would reuse', async () => {
    const portA = previewPortForCheckout(WORKTREE_A);
    const portB = previewPortForCheckout(WORKTREE_B);
    expect(portB).not.toBe(portA);

    // Worktree A leaves a preview server behind — the orphan of #170, or simply a suite still running.
    await startPreviewLikeServerOn(portA);

    // A's own port answers: reuse *within* a checkout, which is what `reuseExistingServer` is for, still works.
    expect(await somethingIsListeningOn(portA)).toBe(true);

    // B's port does not. This is the whole finding: a suite launched from worktree B looks at B's `baseURL`,
    // finds nothing, and starts its own server against its own `dist/` — instead of silently testing A's
    // build, and instead of being torn down mid-run when A's suite finishes.
    expect(await somethingIsListeningOn(portB)).toBe(false);
  });

  it('KI-19-00 AC1: every checkout path gets its own port, and the same path always gets the same one', () => {
    // Stable, because reuse within a checkout depends on the port not moving between two commands.
    expect(previewPortForCheckout(WORKTREE_A)).toBe(previewPortForCheckout(WORKTREE_A));
    // Insensitive to how the path was written, so `.../ki-19-00` and `.../ki-19-00/` are one checkout.
    expect(previewPortForCheckout(`${WORKTREE_A}/`)).toBe(previewPortForCheckout(WORKTREE_A));
    expect(previewPortForCheckout(`${WORKTREE_A}/tests/..`)).toBe(
      previewPortForCheckout(WORKTREE_A),
    );

    // Distinct, across the shape of worktree names this repository actually uses (`iNN/ki-NN-TT-slug`).
    const roots = [
      '/home/user/kobisnake',
      '/home/user/wt/ki-19-00',
      '/home/user/wt/ki-19-01',
      '/home/user/wt/ki-19-02',
      '/home/user/wt/ki-19-03',
      '/home/user/wt/ki-19-04',
      '/home/user/wt/ki-19-05',
      '/home/runner/work/kobisnake/kobisnake',
    ];
    expect(new Set(roots.map(previewPortForCheckout)).size).toBe(roots.length);
  });

  it('KI-19-00 AC1: derived ports sit above the kernel ephemeral range', () => {
    // Linux hands out 32768-60999 for ephemeral sockets by default. A derived port inside that window would
    // occasionally be taken by an unrelated connection, and `--strictPort` would refuse to start for a reason
    // that looks exactly like the orphaned-server problem this replaces.
    expect(PORT_RANGE_START).toBeGreaterThan(60_999);
    expect(PORT_RANGE_END).toBeLessThanOrEqual(65_536);
    for (const root of ['/a', '/home/user/kobisnake', CHECKOUT_ROOT, '/very/deep/'.repeat(20)]) {
      const port = previewPortForCheckout(root);
      expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START);
      expect(port).toBeLessThan(PORT_RANGE_END);
      expect(Number.isInteger(port)).toBe(true);
    }
  });

  it('KI-19-00 AC1: baseURL follows the port, so the tests dial the server that was bound', () => {
    expect(previewBaseUrl()).toBe(`http://localhost:${previewPort()}`);
    expect(previewPort()).toBe(previewPortForCheckout(CHECKOUT_ROOT));
  });

  it('KI-19-00 AC1: a nonsense KOBI_PREVIEW_PORT says what to do instead of binding something absurd', () => {
    const previous = process.env.KOBI_PREVIEW_PORT;
    try {
      process.env.KOBI_PREVIEW_PORT = 'the-usual-one';
      expect(() => previewPort()).toThrow(/not a port number between 1 and 65535/);
      process.env.KOBI_PREVIEW_PORT = '4173';
      expect(previewPort()).toBe(4173);
    } finally {
      if (previous === undefined) delete process.env.KOBI_PREVIEW_PORT;
      else process.env.KOBI_PREVIEW_PORT = previous;
    }
  });
});
