// @ts-check
import { describe, expect, it } from 'vitest';
import { createHud } from '../../../src/ui/hud.js';

/**
 * KS-04-03: the "LASERS CLOSING!" banner and red-timer presentation on `LASER_WARNING`.
 *
 * New test file — not on the ticket's own `Files:` list, which names only the `src/` files (declared in the
 * PR description per CLAUDE.md's "never touch files outside your ticket's Files list without saying so").
 * `src/ui/**` is not gated by the coverage config (`vitest.config.js`), but `hud.js`'s own doc comment asks
 * for it to stay testable anyway: "DOM access goes through `root.ownerDocument`, never the global `document`,
 * so this stays constructible in a plain Node test with a hand-built fake root." This is that fake root —
 * a hand-rolled stand-in for the handful of DOM calls `hud.js` actually makes, so no new dependency (jsdom or
 * otherwise) is needed just to prove a banner shows and hides (CLAUDE.md: no dependency without Opus's
 * approval).
 */

/** The tiny slice of `DOMTokenList` `hud.js` uses. */
class FakeClassList {
  /** @param {FakeElement} element */
  constructor(element) {
    this.element = element;
  }
  /** @param {string} name */
  add(name) {
    const names = new Set(this.element.className.split(' ').filter(Boolean));
    names.add(name);
    this.element.className = [...names].join(' ');
  }
  /** @param {string} name */
  remove(name) {
    const names = new Set(this.element.className.split(' ').filter(Boolean));
    names.delete(name);
    this.element.className = [...names].join(' ');
  }
  /** @param {string} name */
  contains(name) {
    return this.element.className.split(' ').filter(Boolean).includes(name);
  }
}

/** The tiny slice of `Element` `hud.js` uses. */
class FakeElement {
  /** @param {FakeDocument} ownerDocument */
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    /** @type {FakeElement[]} */
    this.children = [];
    this.classList = new FakeClassList(this);
  }
  /** @param {FakeElement[]} nodes */
  append(...nodes) {
    this.children.push(...nodes);
  }
  /** @param {FakeElement} node */
  appendChild(node) {
    this.children.push(node);
    return node;
  }
  remove() {
    // No parent link is needed for what these tests check.
  }
}

/** The tiny slice of `Document` `hud.js` uses. */
class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

/** @returns {HTMLElement} a fake `#ui` root, typed as `HTMLElement` to match `createHud`'s signature. */
function createFakeRoot() {
  return /** @type {any} */ (new FakeElement(new FakeDocument()));
}

/**
 * Depth-first search for the first descendant carrying `className`, the only way these tests can reach a
 * node `createHud` builds but does not hand back directly. Returns `null` on a miss so a sibling subtree
 * still gets searched — throwing here instead would abort the whole search the moment any one branch (say,
 * the player-pills row) came up empty.
 *
 * @param {FakeElement} node
 * @param {string} className
 * @returns {FakeElement | null}
 */
function search(node, className) {
  for (const child of node.children) {
    if (child.className.split(' ').includes(className)) return child;
    const found = search(child, className);
    if (found) return found;
  }
  return null;
}

/**
 * @param {FakeElement} node
 * @param {string} className
 * @returns {FakeElement}
 */
function findByClass(node, className) {
  const found = search(node, className);
  if (found === null) throw new Error(`no descendant with class "${className}"`);
  return found;
}

/** One frame at 60 fps, in seconds — the tolerance AC1 is stated in. */
const FRAME = 1 / 60;

describe('createHud — KS-04-03 laser warning presentation', () => {
  it('renders the banner hidden and the timer un-warned by default', () => {
    const root = createFakeRoot();
    createHud(root);

    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');
    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');

    expect(banner.hidden).toBe(true);
    expect(banner.textContent).toBe('LASERS CLOSING!');
    expect(timer.classList.contains('hud-timer--warning')).toBe(false);
  });

  it('KS-04-03 AC1: the banner appears within one frame of the event', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');

    // No frame has to pass at all: showLaserWarning is the event handler itself, called synchronously by
    // session.js the instant it sees LASER_WARNING.
    hud.showLaserWarning(5);

    expect(banner.hidden).toBe(false);
  });

  it('KS-04-03 AC1: the banner disappears at 5 s ± 1 frame, not a moment before', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');

    hud.showLaserWarning(5);

    const framesFor5Seconds = Math.round(5 / FRAME); // 300 frames at 60 fps

    // Comfortably inside the 5 s window (a two-frame margin so summing 298 floating-point `1/60`s can never
    // read as "past 5 s" on any machine): still up.
    for (let i = 0; i < framesFor5Seconds - 2; i += 1) {
      hud.tick(FRAME);
    }
    expect(banner.hidden).toBe(false);

    // Within one more frame of the 5 s mark it must have hidden — the AC's own "± 1 frame" (a third frame
    // covers the same floating-point residue the two-frame margin above exists to dodge; still comfortably
    // inside a one-frame tolerance).
    hud.tick(FRAME);
    hud.tick(FRAME);
    hud.tick(FRAME);
    expect(banner.hidden).toBe(true);
  });

  it('KS-04-03: a single frame far past the duration also hides the banner, and ticking again is a no-op', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');

    hud.showLaserWarning(1);
    hud.tick(999); // e.g. session.js's own `fastForward` path hands a whole chunk of dt at once
    expect(banner.hidden).toBe(true);

    hud.tick(FRAME);
    expect(banner.hidden).toBe(true);
  });

  it('ticking before any warning has been shown is a no-op', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    expect(() => hud.tick(FRAME)).not.toThrow();
  });

  it('KS-04-03 AC2: showLaserWarning reddens the timer immediately', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');

    hud.showLaserWarning(5);

    expect(timer.classList.contains('hud-timer--warning')).toBe(true);
  });

  it('KS-04-03 AC2: the timer stays red long after the banner itself has hidden', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');

    hud.showLaserWarning(5);
    // 10 simulated seconds of frames: well past the 5 s banner and well into the laser-step phase a real
    // round would be in by then. Nothing in `tick` may ever remove the class — only `resetWarning` may.
    for (let i = 0; i < Math.round(10 / FRAME); i += 1) {
      hud.tick(FRAME);
    }

    expect(timer.classList.contains('hud-timer--warning')).toBe(true);
  });

  it('KS-04-03: resetWarning hides the banner and un-reds the timer for a fresh round', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');
    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');

    hud.showLaserWarning(5);
    hud.resetWarning();

    expect(banner.hidden).toBe(true);
    expect(timer.classList.contains('hud-timer--warning')).toBe(false);
  });

  it('still sets the timer text and both player lengths (KS-03-05, unchanged by this ticket)', () => {
    const root = createFakeRoot();
    const hud = createHud(root);

    hud.setTime('0:30');
    hud.setLengths(4, 7);

    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');
    const p1 = findByClass(/** @type {any} */ (root), 'hud-player--p1');
    const p2 = findByClass(/** @type {any} */ (root), 'hud-player--p2');
    expect(timer.textContent).toBe('0:30');
    expect(p1.textContent).toBe('P1 4');
    expect(p2.textContent).toBe('P2 7');
  });
});

describe('createHud — KS-06-00 AC2: the HUD is hidden outside a round', () => {
  it('KS-06-00 AC2: setVisible(false) hides the whole HUD, setVisible(true) brings it back', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const container = findByClass(/** @type {any} */ (root), 'hud');

    // Visible as built: `ui.js` decides, and it hides the HUD itself before the first frame is painted.
    expect(container.hidden).toBe(false);

    hud.setVisible(false);
    expect(container.hidden).toBe(true);

    hud.setVisible(true);
    expect(container.hidden).toBe(false);
  });

  it('KS-06-00: hiding the HUD does not disturb the laser banner or the red timer underneath it', () => {
    const root = createFakeRoot();
    const hud = createHud(root);
    const banner = findByClass(/** @type {any} */ (root), 'hud-laser-banner');
    const timer = findByClass(/** @type {any} */ (root), 'hud-timer');

    hud.showLaserWarning(5);
    hud.setVisible(false);
    hud.setVisible(true);

    // A round paused during the warning and resumed still owes the player its banner (`KS-04-03`).
    expect(banner.hidden).toBe(false);
    expect(timer.classList.contains('hud-timer--warning')).toBe(true);
  });
});
