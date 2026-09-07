// @ts-check

/**
 * KI-19-00 — the preview server's port, derived from **which checkout is asking** (#170).
 *
 * `HANDOFF.md` gives every ticket its own `git worktree`, and several of them live in one container. A fixed
 * preview port (4173, as it was) turns that into two distinct failures, both seen and both recorded on #170:
 *
 * 1. **Silently green about the wrong build.** `playwright.config.js` sets `reuseExistingServer: !CI`, so a
 *    suite started from worktree B adopts a `vite preview` that worktree A left on 4173 and tests **A's
 *    `dist/`** while reporting on B's branch.
 * 2. **Half an hour of timeouts.** B adopts A's server, A's own suite finishes and tears that server down,
 *    and every remaining test in B burns its full 30 s timeout against a dead port — 57 × 30 s ≈ 28 minutes,
 *    with no output, presenting as a hung container rather than as a failure with a cause.
 *
 * The #86 suite lock (`run-playwright-suite.mjs`) does not and cannot cover either one: it serialises
 * *suites*, and the hazard here is a *server that outlives the suite that started it*.
 *
 * The design lead's ruling on #170 is option 1 of the three offered there — derive the port from the checkout
 * root. Both halves then close at once: a survivor from another worktree is on another port and can never be
 * adopted, and an orphan on another worktree's port can never make this one's `--strictPort` fail. Reuse
 * *within* a checkout, which is what `reuseExistingServer` is actually for, keeps working: every tool in this
 * repository that binds or dials the preview server asks this module, so they all agree.
 *
 * Option 2 (ask the server which build it is serving) was ruled out on #170 by failure 2: the server was the
 * right one at start-up and vanished later, so no start-up check could have caught it. Option 3
 * (`reuseExistingServer: false`) would have fixed failure 1 only — an orphaned server still holds a fixed
 * port, and `--strictPort` still refuses to start beside it.
 *
 * **CI is unaffected in substance.** A GitHub Actions runner is one container with one checkout, so it has no
 * second worktree to collide with; it simply gets a derived port instead of 4173, which is as free there as
 * 4173 was. The derivation runs the same way everywhere on purpose — a rule that only applies locally is a
 * rule with an untested branch in it.
 */

import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The repository root of *this* checkout: the directory holding `scripts/`, resolved from this module's own
 * URL rather than from `process.cwd()`, so the port does not change depending on where a command was run
 * from inside the tree.
 */
export const CHECKOUT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Lowest port the derivation may return, and one past the highest.
 *
 * IANA's dynamic/private range starts at 49152, but Linux hands out **32768–60999** for kernel-assigned
 * ephemeral ports by default (`/proc/sys/net/ipv4/ip_local_port_range`, and that is this container's value).
 * A derived port inside that window would occasionally be taken by an unrelated outbound socket, and the
 * symptom — `--strictPort` refusing to start, for one run in a few hundred — would look exactly like the
 * orphaned-server problem this module exists to remove. So the band is the part of the private range that
 * sits **above** the ephemeral one: 61000–65535, 4536 ports wide.
 */
export const PORT_RANGE_START = 61_000;
export const PORT_RANGE_END = 65_536;

/**
 * `KOBI_PREVIEW_PORT` pins the port explicitly. It exists for a human who wants a predictable URL to open in
 * their own browser, and for `previewPort()`'s own test; nothing in this repository sets it, and setting it in
 * two worktrees at once re-creates exactly the collision this module removes.
 */
const PORT_OVERRIDE_ENV = 'KOBI_PREVIEW_PORT';

/**
 * The preview port for a given checkout root.
 *
 * SHA-256 rather than a hand-rolled string hash: the property that matters is that two worktree paths that
 * differ by one character land far apart, and a real digest gives that without anyone having to reason about
 * it. The first four bytes are plenty for a 4536-wide band, and the whole thing is a pure function of the
 * path — the same checkout gets the same port on every run, which is what makes reuse within a checkout work.
 *
 * @param {string} checkoutRoot absolute path to a repository root.
 * @returns {number} a port in `[PORT_RANGE_START, PORT_RANGE_END)`.
 */
export function previewPortForCheckout(checkoutRoot) {
  const digest = createHash('sha256').update(resolve(checkoutRoot)).digest();
  return PORT_RANGE_START + (digest.readUInt32BE(0) % (PORT_RANGE_END - PORT_RANGE_START));
}

/**
 * The preview port this checkout binds and dials, honouring {@link PORT_OVERRIDE_ENV}.
 *
 * Read through a function rather than exported as a constant so the override is read when it is used, which
 * is what lets a test set it, call this, and see the effect.
 *
 * @returns {number}
 */
export function previewPort() {
  const override = process.env[PORT_OVERRIDE_ENV];
  if (override !== undefined && override !== '') {
    const parsed = Number(override);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error(
        `${PORT_OVERRIDE_ENV} is "${override}", which is not a port number between 1 and 65535. ` +
          `Unset it to let this checkout derive its own port, or set it to a free port.`,
      );
    }
    return parsed;
  }
  return previewPortForCheckout(CHECKOUT_ROOT);
}

/**
 * The base URL of this checkout's preview server — the single place `playwright.config.js`'s `baseURL` and
 * anything else that dials the preview get it from, so `baseURL` can never drift from the port the server was
 * actually told to bind.
 *
 * @returns {string}
 */
export function previewBaseUrl() {
  return `http://localhost:${previewPort()}`;
}
