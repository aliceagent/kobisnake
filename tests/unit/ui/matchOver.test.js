// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  createMatchOverScreen,
  WATCH_LAST_ROUND_LABEL,
} from '../../../src/ui/screens/matchOver.js';

/**
 * KI-05-04: WATCH LAST ROUND on the match-over screen — a declared `Files:` deviation from the sprint file's
 * own `src/ui/screens/scoreboard.js` (the design lead's ruling on issue #211/#222, `DESIGN-DECISIONS §3`; see
 * `matchOver.js`'s own module doc for the full reasoning). This file did not exist before this ticket — the
 * screen's pre-existing REMATCH/MAIN MENU rows had no dedicated unit test of their own, only the indirect
 * coverage `tests/unit/game/session.test.js` gives them through a fake `ui` — so this file both proves the new
 * row and, as a side effect, gives the two existing ones their first direct DOM-level test.
 *
 * A hand-rolled fake DOM in the style of `tests/unit/ui/mainMenu.test.js`'s own doc comment: `matchOver.js`
 * reaches the DOM only through `root.ownerDocument`, so a plain Node test with a fake root proves the screen
 * without jsdom or any other new dependency (CLAUDE.md: no dependency without Opus's approval).
 */

/** The tiny slice of `DOMTokenList` `matchOver.js` uses. */
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
  /** @param {string} name @param {boolean} [force] */
  toggle(name, force) {
    const shouldHave = force === undefined ? !this.contains(name) : force;
    if (shouldHave) this.add(name);
    else this.remove(name);
    return shouldHave;
  }
}

/** The tiny slice of `Element` `matchOver.js` uses. */
class FakeElement {
  /** @param {FakeDocument} ownerDocument */
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    /** @type {FakeElement[]} */
    this.children = [];
    /** @type {FakeElement | null} */
    this.parent = null;
    this.classList = new FakeClassList(this);
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Map<string, Set<() => void>>} */
    this._listeners = new Map();
  }
  /** @param {FakeElement} node */
  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    return node;
  }
  remove() {
    if (this.parent === null) return;
    const siblings = this.parent.children;
    const index = siblings.indexOf(this);
    if (index !== -1) siblings.splice(index, 1);
    this.parent = null;
  }
  /** @param {string} type @param {() => void} listener */
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)?.add(listener);
  }
  /** @param {string} type */
  dispatchEvent(type) {
    for (const listener of [...(this._listeners.get(type) ?? [])]) listener();
  }
}

/** The tiny slice of `Document` `matchOver.js` uses. */
class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

/** @returns {HTMLElement} a fake `#ui` root, typed as `HTMLElement` to match `createMatchOverScreen`'s signature. */
function createFakeRoot() {
  return /** @type {any} */ (new FakeElement(new FakeDocument()));
}

/**
 * Depth-first search for every descendant carrying `className`, in document order.
 * @param {FakeElement} node @param {string} className @returns {FakeElement[]}
 */
function findAllByClass(node, className) {
  const found = [];
  for (const child of node.children) {
    if (child.className.split(' ').includes(className)) found.push(child);
    found.push(...findAllByClass(child, className));
  }
  return found;
}

/** @returns {{winner: 1, colorNames: {1: string, 2: string}, wins: {1: number, 2: number}, bestOf: number, keys: number, onRematch: () => void, onMenu: () => void, onWatchLastRound: () => void}} */
function baseProps(overrides = {}) {
  return {
    winner: 1,
    colorNames: { 1: 'red', 2: 'blue' },
    wins: { 1: 2, 2: 1 },
    bestOf: 3,
    keys: 1,
    onRematch: () => {},
    onMenu: () => {},
    onWatchLastRound: () => {},
    ...overrides,
  };
}

describe('createMatchOverScreen — KI-05-04', () => {
  it('KI-05-04: WATCH LAST ROUND is a third row, appended after REMATCH and MAIN MENU', () => {
    const root = createFakeRoot();
    const screen = createMatchOverScreen(/** @type {any} */ (root));
    screen.render(baseProps());

    // Appended, not inserted between the existing two — `matchOver.js`'s own comment explains why: several
    // e2e specs key a single ArrowDown from REMATCH straight to MAIN MENU, and this ordering keeps them true.
    const rows = findAllByClass(/** @type {any} */ (root), 'menu-item');
    expect(rows.map((row) => row.textContent)).toEqual([
      'REMATCH',
      'MAIN MENU',
      WATCH_LAST_ROUND_LABEL,
    ]);
  });

  it('KI-05-04: WATCH LAST ROUND is reachable by keyboard and calls onWatchLastRound on Enter', () => {
    const root = createFakeRoot();
    const onWatchLastRound = vi.fn();
    const onRematch = vi.fn();
    const onMenu = vi.fn();
    const screen = createMatchOverScreen(/** @type {any} */ (root));
    screen.render(baseProps({ onWatchLastRound, onRematch, onMenu }));

    // REMATCH is the default focus (regression: unchanged by adding a row after MAIN MENU).
    let focused = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toBe('REMATCH');

    screen.handleMenuAction('DOWN'); // MAIN MENU
    screen.handleMenuAction('DOWN'); // WATCH LAST ROUND
    focused = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
    expect(focused).toHaveLength(1);
    expect(focused[0].textContent).toBe(WATCH_LAST_ROUND_LABEL);

    screen.handleMenuAction('CONFIRM');
    expect(onWatchLastRound).toHaveBeenCalledTimes(1);
    expect(onRematch).not.toHaveBeenCalled();
    expect(onMenu).not.toHaveBeenCalled();
  });

  it('KI-05-04: clicking WATCH LAST ROUND calls onWatchLastRound', () => {
    const root = createFakeRoot();
    const onWatchLastRound = vi.fn();
    const screen = createMatchOverScreen(/** @type {any} */ (root));
    screen.render(baseProps({ onWatchLastRound }));

    const row = findAllByClass(/** @type {any} */ (root), 'menu-item').find(
      (candidate) => candidate.textContent === WATCH_LAST_ROUND_LABEL,
    );
    if (row === undefined) throw new Error('WATCH LAST ROUND row not found');
    row.dispatchEvent('click');

    expect(onWatchLastRound).toHaveBeenCalledTimes(1);
  });

  it('regression: REMATCH and MAIN MENU still fire their own callbacks, not WATCH LAST ROUND', () => {
    const root = createFakeRoot();
    const onRematch = vi.fn();
    const onMenu = vi.fn();
    const onWatchLastRound = vi.fn();
    const screen = createMatchOverScreen(/** @type {any} */ (root));
    screen.render(baseProps({ onRematch, onMenu, onWatchLastRound }));

    screen.handleMenuAction('CONFIRM'); // REMATCH, the default focus
    expect(onRematch).toHaveBeenCalledTimes(1);

    screen.handleMenuAction('DOWN'); // MAIN MENU
    screen.handleMenuAction('CONFIRM');
    expect(onMenu).toHaveBeenCalledTimes(1);
    expect(onWatchLastRound).not.toHaveBeenCalled();
  });
});
