// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GAME_EVENTS, STATES } from '../../../src/game/gameStateMachine.js';
import { createMainMenuScreen } from '../../../src/ui/screens/mainMenu.js';

/**
 * KI-10-01: the main menu presents its one playable row as the primary action and groups the five
 * unavailable rows so the screen stops reading as mostly locked, without touching what any row *does*.
 *
 * Not on this ticket's own `Files:` list (`tests`, generically, is) — a hand-rolled fake DOM in the style of
 * `tests/unit/ui/hud.test.js`'s own doc comment: `mainMenu.js` reaches the DOM only through
 * `root.ownerDocument`, so a plain Node test with a fake root proves the screen without jsdom or any other
 * new dependency (CLAUDE.md: no dependency without Opus's approval). `focus.js` itself already has a
 * thorough unit test (`tests/unit/ui/focus.test.js`, untouched by this ticket); this file's job is the
 * screen built on top of it — the DOM it produces and the fact every row's selectability is exactly what it
 * was before.
 */

/** The tiny slice of `DOMTokenList` `mainMenu.js` uses. */
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

/** The tiny slice of `Element` `mainMenu.js` uses. */
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
    this.style = {};
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {Map<string, Set<() => void>>} */
    this._listeners = new Map();
  }
  /** @param {FakeElement[]} nodes */
  append(...nodes) {
    for (const node of nodes) this.appendChild(node);
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

/** The tiny slice of `Document` `mainMenu.js` uses. */
class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

/** @returns {HTMLElement} a fake `#ui` root, typed as `HTMLElement` to match `createMainMenuScreen`'s signature. */
function createFakeRoot() {
  return /** @type {any} */ (new FakeElement(new FakeDocument()));
}

/**
 * Depth-first search for every descendant carrying `className`, in document order — the only way these
 * tests can reach nodes `createMainMenuScreen` builds but does not hand back directly.
 *
 * @param {FakeElement} node
 * @param {string} className
 * @returns {FakeElement[]}
 */
function findAllByClass(node, className) {
  const found = [];
  for (const child of node.children) {
    if (child.className.split(' ').includes(className)) found.push(child);
    found.push(...findAllByClass(child, className));
  }
  return found;
}

/**
 * @param {FakeElement} node
 * @param {string} className
 * @returns {FakeElement}
 */
function findByClass(node, className) {
  const [found] = findAllByClass(node, className);
  if (found === undefined) throw new Error(`no descendant with class "${className}"`);
  return found;
}

/**
 * The seven labels in `MENU_ITEMS` order. KI-10-03 added HOW TO PLAY directly after `2 PLAYERS` (design-lead
 * review on #145: it belongs with the available actions, not below five locked ones), so this list and the
 * "only one enabled row" assumption the tests below were first written against both had to grow by one.
 */
const ALL_LABELS = [
  '1 PLAYER',
  '2 PLAYERS',
  'HOW TO PLAY',
  'PRACTICE',
  'TUTORIAL',
  'SHOP',
  'SETTINGS',
];
/** Every label that is not a playable action — unchanged by KI-10-03, which added an enabled row. */
const UNAVAILABLE_LABELS = ['1 PLAYER', 'PRACTICE', 'TUTORIAL', 'SHOP', 'SETTINGS'];

describe('createMainMenuScreen — KI-10-01', () => {
  it('KI-10-01 AC1: every previously unavailable item is still present, with COMING SOON', () => {
    const root = createFakeRoot();
    createMainMenuScreen(/** @type {any} */ (root));

    // All seven labels are on screen. Document order is no longer `MENU_ITEMS` order — KI-10-01 moves the one
    // playable row above the grouped-away unavailable ones — so this checks the *set*, not the sequence; the
    // sequence within the unavailable group is checked separately below, and `MENU_ITEMS` itself (asserted
    // via `focus.js`'s untouched behaviour in the tests around this one) never changed.
    const rows = findAllByClass(/** @type {any} */ (root), 'menu-item');
    expect(rows.map((row) => findByClass(row, 'menu-item-label').textContent).sort()).toEqual(
      [...ALL_LABELS].sort(),
    );

    const disabledRows = findAllByClass(/** @type {any} */ (root), 'menu-item--disabled');
    expect(disabledRows.map((row) => findByClass(row, 'menu-item-label').textContent)).toEqual(
      UNAVAILABLE_LABELS,
    );
    // Every disabled row still carries its "COMING SOON" tag.
    for (const row of disabledRows) {
      expect(findByClass(row, 'menu-item-tag').textContent).toBe('COMING SOON');
    }
  });

  it('KI-10-01 AC1: the five unavailable rows can never be focused or selected', () => {
    const root = createFakeRoot();
    const onSelect = vi.fn();
    const screen = createMainMenuScreen(/** @type {any} */ (root));
    screen.render({ onSelect });
    screen.show();

    const disabledRows = findAllByClass(/** @type {any} */ (root), 'menu-item--disabled');
    expect(disabledRows).toHaveLength(5);

    for (const row of disabledRows) {
      row.dispatchEvent('mouseenter');
      expect(row.classList.contains('menu-item--focused')).toBe(false);
      row.dispatchEvent('click');
    }
    // A disabled row's click handler was never even attached — clicking every one of them must never have
    // called through to onSelect.
    expect(onSelect).not.toHaveBeenCalled();

    // ↓/↑ can never land on a disabled row. There are two enabled rows since KI-10-03 (2 PLAYERS and
    // HOW TO PLAY), so this walks the cursor all the way round the list and asserts it only ever rests on
    // one of those two — a stronger check than the original "it stays put", which only held while a single
    // focusable slot existed.
    const visited = [];
    for (let i = 0; i < ALL_LABELS.length; i += 1) {
      screen.handleMenuAction('DOWN');
      const focusedRows = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
      expect(focusedRows).toHaveLength(1);
      visited.push(findByClass(focusedRows[0], 'menu-item-label').textContent);
    }
    expect([...new Set(visited)].sort()).toEqual(['2 PLAYERS', 'HOW TO PLAY']);
    for (const label of visited) expect(UNAVAILABLE_LABELS).not.toContain(label);
  });

  it('KI-10-01 AC1/regression: 2 PLAYERS stays the default-focused row and still fires SELECT_2P', () => {
    const root = createFakeRoot();
    const onSelect = vi.fn();
    const screen = createMainMenuScreen(/** @type {any} */ (root));
    screen.render({ onSelect });

    const focused = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
    expect(focused).toHaveLength(1);
    expect(findByClass(focused[0], 'menu-item-label').textContent).toBe('2 PLAYERS');

    screen.handleMenuAction('CONFIRM');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GAME_EVENTS.SELECT_2P);
  });

  it('KI-10-01 AC2: the approved description line is rendered verbatim under the title', () => {
    const root = createFakeRoot();
    createMainMenuScreen(/** @type {any} */ (root));

    const description = findByClass(/** @type {any} */ (root), 'menu-description');
    expect(description.textContent).toBe(
      'Two players, one keyboard. Eat apples, grow long, and make the other snake crash.',
    );
  });

  it('carries the MAIN_MENU screen identity test hook unchanged', () => {
    const root = createFakeRoot();
    createMainMenuScreen(/** @type {any} */ (root));
    const container = findAllByClass(/** @type {any} */ (root), 'menu-screen')[0];
    expect(container.dataset.screen).toBe(STATES.MAIN_MENU);
  });
});
