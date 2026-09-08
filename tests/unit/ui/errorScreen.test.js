// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_LOSS_GRACE_MS,
  createErrorScreen,
  watchContextLossForErrorScreen,
} from '../../../src/ui/screens/error.js';
import { error } from '../../../src/ui/strings.js';

/**
 * KI-06-02 (`docs/sprints/improvement-06-resilience-and-recovery.md`). AC1 and AC2 are proven end to end in
 * `tests/e2e/error-screen.spec.js` — this file's own module comment explains why a unit test cannot: AC1
 * needs a real `getContext` to actually fail, and AC2 needs `main.js`'s real boot sequence to actually throw.
 * What this file proves instead:
 *
 * - The screen itself: built hidden, shown/hidden idempotently, destroyed cleanly, and rendering the
 *   catalogue's own `error` group rather than a literal (tech-lead note: "never write a literal sentence
 *   into the screen module").
 * - RELOAD fires the injected `reload` — by click, and by the screen's own Enter/Space key listener, and
 *   *only* while the screen is actually showing (tech-lead note: "this is the one screen allowed its own
 *   listener" — proven here to be a narrow one, not a global hijack of every Enter/Space in the app).
 * - The "third path" — a lost context that never comes back — with a fake clock, exactly as the tech-lead
 *   notes ask for: "behind injectable setTimeout/clearTimeout so this file proves it with fake timers";
 *   e2e tests never sleep (`CLAUDE.md`), and there is no reason a unit test should either.
 *
 * A hand-rolled fake DOM in the style of `tests/unit/ui/matchOver.test.js`'s own doc comment: `error.js`
 * reaches the DOM only through `root.ownerDocument` (and, for its key listener, that document's own
 * `defaultView`), so a plain Node test proves the whole module without jsdom or any other new dependency
 * (`CLAUDE.md`: no dependency without Opus's approval).
 */

/** The tiny slice of `Element` `error.js` uses. */
class FakeElement {
  /** @param {FakeDocument} ownerDocument */
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.tagName = '';
    this.type = '';
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    /** @type {Record<string, string>} */
    this.dataset = {};
    /** @type {FakeElement[]} */
    this.children = [];
    /** @type {FakeElement | null} */
    this.parent = null;
    /** @type {Map<string, Set<(event?: any) => void>>} */
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
  /** @param {string} type @param {(event?: any) => void} listener */
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)?.add(listener);
  }
  /** @param {string} type @param {(event?: any) => void} listener */
  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }
  /** @param {string} type @param {any} [event] */
  dispatchEvent(type, event) {
    for (const listener of [...(this._listeners.get(type) ?? [])]) listener(event);
  }
}

/** The tiny slice of `window` `error.js`'s key listener and default `reload` use. */
class FakeWindow {
  constructor() {
    /** @type {Map<string, Set<(event?: any) => void>>} */
    this._listeners = new Map();
    this.location = { reloaded: 0, reload: () => (this.location.reloaded += 1) };
  }
  /** @param {string} type @param {(event?: any) => void} listener */
  addEventListener(type, listener) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type)?.add(listener);
  }
  /** @param {string} type @param {(event?: any) => void} listener */
  removeEventListener(type, listener) {
    this._listeners.get(type)?.delete(listener);
  }
  /** @param {any} event */
  dispatchKeydown(event) {
    for (const listener of [...(this._listeners.get('keydown') ?? [])]) listener(event);
  }
}

/** The tiny slice of `Document` `error.js` uses. */
class FakeDocument {
  /** @param {FakeWindow} defaultView */
  constructor(defaultView) {
    this.defaultView = defaultView;
  }
  /** @param {string} tagName */
  createElement(tagName) {
    const element = new FakeElement(this);
    element.tagName = tagName.toUpperCase();
    return element;
  }
}

/** @returns {{root: HTMLElement, view: FakeWindow}} a fake `#ui` root and the fake `window` behind it. */
function createFakeRoot() {
  const view = new FakeWindow();
  const doc = new FakeDocument(view);
  return { root: /** @type {any} */ (new FakeElement(doc)), view };
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

describe('createErrorScreen — KI-06-02', () => {
  it('is built hidden, with the ERROR test hook, and renders the catalogue verbatim', () => {
    const { root } = createFakeRoot();
    createErrorScreen(root);

    const container = /** @type {FakeElement} */ (/** @type {any} */ (root)).children[0];
    expect(container.hidden).toBe(true);
    expect(container.dataset.screen).toBe('ERROR');
    expect(container.className).toContain('menu-screen');

    const heading = findAllByClass(/** @type {any} */ (root), 'menu-title')[0];
    const message = findAllByClass(/** @type {any} */ (root), 'menu-description')[0];
    const button = findAllByClass(/** @type {any} */ (root), 'error-reload-button')[0];
    // The screen module never writes a literal sentence — every one of these is the same string
    // `src/ui/strings.js`'s own `error` group exports, checked here for byte equality.
    expect(heading.textContent).toBe(error.heading);
    expect(message.textContent).toBe(error.message);
    expect(button.textContent).toBe(error.reloadButton);
  });

  it('show()/hide() toggle the container, idempotently', () => {
    const { root } = createFakeRoot();
    const screen = createErrorScreen(root);
    const container = /** @type {FakeElement} */ (/** @type {any} */ (root)).children[0];

    screen.show();
    expect(container.hidden).toBe(false);
    screen.show();
    expect(container.hidden).toBe(false);

    screen.hide();
    expect(container.hidden).toBe(true);
    screen.hide();
    expect(container.hidden).toBe(true);
  });

  it('RELOAD is a real button, and clicking it calls the injected reload', () => {
    const { root } = createFakeRoot();
    const reload = vi.fn();
    createErrorScreen(root, { reload });

    const button = findAllByClass(/** @type {any} */ (root), 'error-reload-button')[0];
    expect(button.tagName).toBe('BUTTON');
    button.dispatchEvent('click');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('defaults reload to window.location.reload when no override is given', () => {
    // This test environment is plain Node (`vitest.config.js`: `environment: 'node'`), so the bare global
    // `window` the default reads (`error.js`'s own `reload = () => window.location.reload()`) does not exist
    // unless supplied — `vi.stubGlobal` is that supply, scoped to this one test, rather than reaching for a
    // new jsdom dependency `CLAUDE.md` would need Opus's approval for.
    const { root, view } = createFakeRoot();
    vi.stubGlobal('window', view);
    try {
      const screen = createErrorScreen(root);
      screen.show();

      view.dispatchKeydown({ code: 'Enter', preventDefault: () => {} });
      expect(view.location.reloaded).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['Enter', 'Space'])('%s reloads while the screen is showing', (code) => {
    const { root, view } = createFakeRoot();
    const reload = vi.fn();
    const screen = createErrorScreen(root, { reload });
    screen.show();

    const preventDefault = vi.fn();
    view.dispatchKeydown({ code, preventDefault });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });

  it('a key other than Enter/Space does nothing', () => {
    const { root, view } = createFakeRoot();
    const reload = vi.fn();
    const screen = createErrorScreen(root, { reload });
    screen.show();

    view.dispatchKeydown({ code: 'Escape', preventDefault: () => {} });
    expect(reload).not.toHaveBeenCalled();
  });

  it('Enter/Space do nothing while the screen is hidden — this is not a global hijack', () => {
    const { root, view } = createFakeRoot();
    const reload = vi.fn();
    createErrorScreen(root, { reload });
    // Never shown.

    view.dispatchKeydown({ code: 'Enter', preventDefault: () => {} });
    view.dispatchKeydown({ code: 'Space', preventDefault: () => {} });
    expect(reload).not.toHaveBeenCalled();
  });

  it('destroy() removes the key listener and the DOM node', () => {
    const { root, view } = createFakeRoot();
    const reload = vi.fn();
    const screen = createErrorScreen(root, { reload });
    screen.show();
    screen.destroy();

    expect(/** @type {any} */ (root).children).toHaveLength(0);
    view.dispatchKeydown({ code: 'Enter', preventDefault: () => {} });
    expect(reload).not.toHaveBeenCalled();
  });
});

/** A fake, minimal `ContextLossSource` — exactly the two subscribe methods `error.js` reads. */
function createFakeContextLossSource() {
  /** @type {Set<() => void>} */
  const lostListeners = new Set();
  /** @type {Set<() => void>} */
  const restoredListeners = new Set();
  return {
    fireLost() {
      for (const listener of [...lostListeners]) listener();
    },
    fireRestored() {
      for (const listener of [...restoredListeners]) listener();
    },
    /** @param {() => void} listener */
    onContextLost(listener) {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    /** @param {() => void} listener */
    onContextRestored(listener) {
      restoredListeners.add(listener);
      return () => restoredListeners.delete(listener);
    },
  };
}

/** A fake clock in the shape `watchContextLossForErrorScreen` wants: `setTimeoutFn`/`clearTimeoutFn`. */
function createFakeClock() {
  let nextId = 1;
  /** @type {Map<number, {atMs: number, callback: () => void}>} */
  const pending = new Map();
  let now = 0;
  return {
    /** @param {() => void} callback @param {number} ms @returns {number} */
    setTimeoutFn(callback, ms) {
      const id = nextId;
      nextId += 1;
      pending.set(id, { atMs: now + ms, callback });
      return id;
    },
    /** @param {number} id */
    clearTimeoutFn(id) {
      pending.delete(id);
    },
    /** @param {number} ms */
    advance(ms) {
      now += ms;
      // Snapshot first: a callback that schedules nothing here (this module's own timers never re-arm
      // themselves) is fine either way, but iterating a copy is the same discipline `renderer.js`'s own
      // `notify` uses for exactly the same reason.
      for (const [id, entry] of [...pending]) {
        if (entry.atMs <= now) {
          pending.delete(id);
          entry.callback();
        }
      }
    },
    pendingCount() {
      return pending.size;
    },
  };
}

describe('watchContextLossForErrorScreen — KI-06-02, the third path', () => {
  it(`shows the screen after ${CONTEXT_LOSS_GRACE_MS}ms of an unrestored context loss`, () => {
    const renderer = createFakeContextLossSource();
    const { root } = createFakeRoot();
    const screen = createErrorScreen(root);
    const clock = createFakeClock();

    watchContextLossForErrorScreen(renderer, screen, {
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

    renderer.fireLost();
    clock.advance(CONTEXT_LOSS_GRACE_MS - 1);
    const container = /** @type {any} */ (root).children[0];
    expect(container.hidden, 'must not show a moment before the grace period ends').toBe(true);

    clock.advance(1);
    expect(container.hidden, 'must show the instant the grace period ends').toBe(false);
  });

  it('a restore before the grace period ends cancels the timer — the screen never shows', () => {
    const renderer = createFakeContextLossSource();
    const { root } = createFakeRoot();
    const screen = createErrorScreen(root);
    const clock = createFakeClock();

    watchContextLossForErrorScreen(renderer, screen, {
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

    renderer.fireLost();
    clock.advance(CONTEXT_LOSS_GRACE_MS / 2);
    renderer.fireRestored();
    expect(clock.pendingCount()).toBe(0);

    // Even letting the rest of the original window elapse must not show the screen — the timer is gone, not
    // merely not-yet-fired.
    clock.advance(CONTEXT_LOSS_GRACE_MS);
    const container = /** @type {any} */ (root).children[0];
    expect(container.hidden).toBe(true);
  });

  it('a second loss/restore cycle after a cancelled one still arms its own timer correctly', () => {
    const renderer = createFakeContextLossSource();
    const { root } = createFakeRoot();
    const screen = createErrorScreen(root);
    const clock = createFakeClock();

    watchContextLossForErrorScreen(renderer, screen, {
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

    renderer.fireLost();
    clock.advance(500);
    renderer.fireRestored();

    renderer.fireLost();
    clock.advance(CONTEXT_LOSS_GRACE_MS);
    const container = /** @type {any} */ (root).children[0];
    expect(container.hidden).toBe(false);
  });

  it('the returned unsubscribe stops a pending timer from ever showing the screen', () => {
    const renderer = createFakeContextLossSource();
    const { root } = createFakeRoot();
    const screen = createErrorScreen(root);
    const clock = createFakeClock();

    const stop = watchContextLossForErrorScreen(renderer, screen, {
      setTimeoutFn: clock.setTimeoutFn,
      clearTimeoutFn: clock.clearTimeoutFn,
    });

    renderer.fireLost();
    stop();
    clock.advance(CONTEXT_LOSS_GRACE_MS * 2);
    const container = /** @type {any} */ (root).children[0];
    expect(container.hidden).toBe(true);

    // And a loss fired after unsubscribing does nothing either — `stop()` really did remove the listeners.
    renderer.fireLost();
    clock.advance(CONTEXT_LOSS_GRACE_MS * 2);
    expect(container.hidden).toBe(true);
  });

  it(`the constant is exactly ${CONTEXT_LOSS_GRACE_MS}ms (three wall seconds, per the tech-lead notes)`, () => {
    expect(CONTEXT_LOSS_GRACE_MS).toBe(3000);
  });
});
