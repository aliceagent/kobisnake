// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { GAME_EVENTS, STATES } from '../../../src/game/gameStateMachine.js';
import { createMainMenuScreen, setBuildStamp } from '../../../src/ui/screens/mainMenu.js';
import { REPLAY_COPY } from '../../../src/ui/screens/replay.js';

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
 * The eight labels in `MENU_ITEMS` order. KI-10-03 added HOW TO PLAY directly after `2 PLAYERS` (design-lead
 * review on #145: it belongs with the available actions, not below five locked ones); KI-05-03 added REPLAY
 * directly after that (a declared `Files:` deviation, approved in advance — see `mainMenu.js`'s own module
 * doc). Both are enabled rows, so this list and the "only N enabled rows" assumptions below have grown twice.
 */
const ALL_LABELS = [
  '1 PLAYER',
  '2 PLAYERS',
  'HOW TO PLAY',
  REPLAY_COPY.menuLabel,
  'PRACTICE',
  'TUTORIAL',
  'SHOP',
  'SETTINGS',
];
/** Every label that is not a playable action — unchanged by KI-10-03/KI-05-03, which only added enabled rows. */
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

    // ↓/↑ can never land on a disabled row. There are three enabled rows since KI-05-03 (2 PLAYERS, HOW TO
    // PLAY and REPLAY), so this walks the cursor all the way round the list and asserts it only ever rests
    // on one of those three — a stronger check than the original "it stays put", which only held while a
    // single focusable slot existed.
    const visited = [];
    for (let i = 0; i < ALL_LABELS.length; i += 1) {
      screen.handleMenuAction('DOWN');
      const focusedRows = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
      expect(focusedRows).toHaveLength(1);
      visited.push(findByClass(focusedRows[0], 'menu-item-label').textContent);
    }
    expect([...new Set(visited)].sort()).toEqual(
      ['2 PLAYERS', 'HOW TO PLAY', REPLAY_COPY.menuLabel].sort(),
    );
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

  it('KI-05-03: the REPLAY row is enabled and fires SELECT_REPLAY', () => {
    const root = createFakeRoot();
    const onSelect = vi.fn();
    const screen = createMainMenuScreen(/** @type {any} */ (root));
    screen.render({ onSelect });

    // DOWN twice from the default focus (2 PLAYERS) passes over HOW TO PLAY and lands on REPLAY — the
    // module doc's own placement: directly after HOW TO PLAY, above the locked group.
    screen.handleMenuAction('DOWN');
    screen.handleMenuAction('DOWN');
    const focused = findAllByClass(/** @type {any} */ (root), 'menu-item--focused');
    expect(focused).toHaveLength(1);
    expect(findByClass(focused[0], 'menu-item-label').textContent).toBe(REPLAY_COPY.menuLabel);

    screen.handleMenuAction('CONFIRM');
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(GAME_EVENTS.SELECT_REPLAY);
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

/**
 * KI-19-03: the build stamp `main.js` feeds this screen through {@link setBuildStamp} — a plain-argument
 * seam rather than this module reading `import.meta` itself (see that function's own doc comment).
 */
describe('createMainMenuScreen — KI-19-03 build stamp', () => {
  it('KI-19-03: shows the "unknown" default before setBuildStamp has ever been called', async () => {
    // A fresh module instance, isolated from every other test in this file (some of which call the
    // top-level `setBuildStamp` below and would otherwise leak into this one, since it is module-level
    // state) — `vi.resetModules()` plus a dynamic re-import is what real production code never needs: a
    // page only ever has the one `mainMenu.js` instance `main.js` calls `setBuildStamp` on before anything
    // reads it (that file's own comment on the ordering).
    vi.resetModules();
    const freshMainMenu = await import('../../../src/ui/screens/mainMenu.js');
    const root = createFakeRoot();
    freshMainMenu.createMainMenuScreen(/** @type {any} */ (root));

    const stamp = findByClass(/** @type {any} */ (root), 'build-stamp');
    expect(stamp.textContent).toBe('unknown');
    expect(stamp.dataset.buildStamp).toBe('');
  });

  it('KI-19-03: setBuildStamp updates every screen built after it is called', () => {
    setBuildStamp({ commit: 'abc1234', date: '2026-09-07T12:00:00.000Z' });
    const root = createFakeRoot();
    createMainMenuScreen(/** @type {any} */ (root));

    const stamp = findByClass(/** @type {any} */ (root), 'build-stamp');
    expect(stamp.textContent).toBe('abc1234 · 2026-09-07');
  });

  it('KI-19-03: falls back to the commit alone when the date is empty', () => {
    setBuildStamp({ commit: 'abc1234', date: '' });
    const root = createFakeRoot();
    createMainMenuScreen(/** @type {any} */ (root));

    const stamp = findByClass(/** @type {any} */ (root), 'build-stamp');
    expect(stamp.textContent).toBe('abc1234');
  });
});
