// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { REPLAY_ERROR_CODES } from '../../../src/core/replay.js';
import {
  REPLAY_COPY,
  createReplayScreen,
  describeLoadError,
  formatTickReadout,
  replayTotalTick,
} from '../../../src/ui/screens/replay.js';

/**
 * KI-05-03: the REPLAY screen.
 *
 * Not on this ticket's own `Files:` list (`tests`, generically, is) — a hand-rolled fake DOM in the style of
 * `tests/unit/ui/mainMenu.test.js`'s own doc comment: `replay.js` reaches the DOM only through
 * `root.ownerDocument`, so a plain Node test with a fake root proves the screen without jsdom or any other
 * new dependency (CLAUDE.md: no dependency without Opus's approval).
 */

/** The tiny slice of `DOMTokenList` `replay.js` uses. */
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

/** The tiny slice of `Element` (plus `<textarea>`/`<input type="file">`) `replay.js` uses. */
class FakeElement {
  /** @param {FakeDocument} ownerDocument */
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.value = '';
    this.placeholder = '';
    this.type = '';
    this.accept = '';
    /** @type {{text: () => Promise<string>}[] | null} */
    this.files = null;
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
  click() {
    this.dispatchEvent('click');
  }
}

/** The tiny slice of `Document` `replay.js` uses. */
class FakeDocument {
  createElement() {
    return new FakeElement(this);
  }
}

/** @returns {HTMLElement} a fake `#ui` root, typed as `HTMLElement` to match `createReplayScreen`'s signature. */
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

/** @param {FakeElement} node @param {string} className @returns {FakeElement} */
function findByClass(node, className) {
  const [found] = findAllByClass(node, className);
  if (found === undefined) throw new Error(`no descendant with class "${className}"`);
  return found;
}

/** @param {FakeElement} node @param {string} dataKey @returns {FakeElement} */
function findByData(node, dataKey) {
  /** @param {FakeElement} n @returns {FakeElement | null} */
  function search(n) {
    if (n.dataset[dataKey] !== undefined) return n;
    for (const child of n.children) {
      const found = search(child);
      if (found !== null) return found;
    }
    return null;
  }
  const found = search(node);
  if (found === null) throw new Error(`no descendant with data-${dataKey}`);
  return found;
}

/**
 * A full `ReplayScreenProps` with every callback a no-op `vi.fn()`, so a test only has to override what it
 * cares about. Mirrors `pause.test.js`-style defaults, except there is no such file yet to copy from.
 * @param {object} [overrides]
 */
function makeProps(overrides = {}) {
  return {
    onLoad: vi.fn(),
    onPlayToggle: vi.fn(),
    onStep: vi.fn(),
    onSeekToStart: vi.fn(),
    onBack: vi.fn(),
    loaded: false,
    error: null,
    ...overrides,
  };
}

describe('formatTickReadout', () => {
  it('is empty with no tick', () => {
    expect(formatTickReadout(null, null)).toBe('');
    expect(formatTickReadout(null, 100)).toBe('');
  });

  it('drops the total when it is unknown', () => {
    expect(formatTickReadout(42, null)).toBe('TICK 42');
  });

  it('includes the total when known (#211 §3.5)', () => {
    expect(formatTickReadout(137, 380)).toBe('TICK 137 / 380');
  });
});

describe('replayTotalTick', () => {
  it('is null for an empty event log', () => {
    expect(replayTotalTick(/** @type {any} */ ({ expectedEvents: [] }))).toBeNull();
  });

  it("is the last event's tick", () => {
    const replay = /** @type {any} */ ({
      expectedEvents: [
        { type: 'FOOD_SPAWNED', tick: 0 },
        { type: 'ROUND_OVER', tick: 380 },
      ],
    });
    expect(replayTotalTick(replay)).toBe(380);
  });

  it('is null when the last event carries no numeric tick', () => {
    const replay = /** @type {any} */ ({ expectedEvents: [{ type: 'WEIRD' }] });
    expect(replayTotalTick(replay)).toBeNull();
  });
});

describe('describeLoadError', () => {
  it('maps UNSUPPORTED_VERSION to the #211 §4.3 pair, not the raw diagnostic', () => {
    const error = {
      code: REPLAY_ERROR_CODES.UNSUPPORTED_VERSION,
      message: 'This replay is version 2; this build understands version 1.',
    };
    expect(describeLoadError(error)).toEqual({
      heading: REPLAY_COPY.tooNewHeading,
      detail: REPLAY_COPY.tooNewDetail,
    });
  });

  it('maps every other parseReplay code to the generic heading with the parser message as detail', () => {
    const error = {
      code: REPLAY_ERROR_CODES.INVALID_JSON,
      message: 'This is not valid JSON (boom).',
    };
    expect(describeLoadError(error)).toEqual({
      heading: REPLAY_COPY.badReplayHeading,
      detail: 'This is not valid JSON (boom).',
    });
  });

  it("maps replayPlayer.js's own NO_SEED the same generic way — #211 proposed no copy for it specifically", () => {
    const error = {
      code: 'NO_SEED',
      message:
        'This replay has no seed (it was recorded before any round started) and cannot be played back.',
    };
    expect(describeLoadError(error)).toEqual({
      heading: REPLAY_COPY.badReplayHeading,
      detail: error.message,
    });
  });
});

describe('createReplayScreen', () => {
  it('carries the REPLAY screen identity test hook, the heading, and the paste box placeholder', () => {
    const root = createFakeRoot();
    createReplayScreen(/** @type {any} */ (root));

    const container = findAllByClass(/** @type {any} */ (root), 'menu-screen')[0];
    expect(container.dataset.screen).toBe('REPLAY');
    expect(findByClass(/** @type {any} */ (root), 'menu-title').textContent).toBe(
      REPLAY_COPY.screenHeading,
    );
    const textarea = findByData(/** @type {any} */ (root), 'replayPaste');
    expect(textarea.placeholder).toBe(REPLAY_COPY.pastePlaceholder);
  });

  it('starts hidden, and the load view shows before anything is loaded', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const container = findAllByClass(/** @type {any} */ (root), 'menu-screen')[0];
    expect(container.hidden).toBe(true);

    screen.render(makeProps({ loaded: false }));
    screen.show();

    expect(container.hidden).toBe(false);
    expect(findByClass(/** @type {any} */ (root), 'replay-load').hidden).toBe(false);
    expect(findByClass(/** @type {any} */ (root), 'replay-player').hidden).toBe(true);
  });

  it('KI-05-03 AC1: choosing WATCH IT hands the pasted text to onLoad', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const onLoad = vi.fn();
    screen.render(makeProps({ onLoad }));

    const textarea = findByData(/** @type {any} */ (root), 'replayPaste');
    textarea.value = '{"seed": 1, "inputs": [], "expectedEvents": []}';
    const watchIt = findByClass(/** @type {any} */ (root), 'replay-load').children.find(
      (child) => child.textContent === REPLAY_COPY.watchLabel,
    );
    if (watchIt === undefined) throw new Error('WATCH IT row not found');
    watchIt.dispatchEvent('click');

    expect(onLoad).toHaveBeenCalledWith(textarea.value);
  });

  it('KI-05-03 AC1: choosing a local file reads it with File.text() — never fetch, never an object URL', async () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const onLoad = vi.fn();
    screen.render(makeProps({ onLoad }));

    const fileInput = findByData(/** @type {any} */ (root), 'replayFileInput');
    const fileText = '{"seed": 2, "inputs": [], "expectedEvents": []}';
    fileInput.files = [{ text: () => Promise.resolve(fileText) }];
    fileInput.dispatchEvent('change');
    // `File.text()` is a real Promise — flush the microtask queue before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(onLoad).toHaveBeenCalledWith(fileText);
    // Cleared so the same file can be chosen again after a failed load.
    expect(fileInput.value).toBe('');
  });

  it('KI-05-03 AC1: a bad-paste error shows the mapped heading/detail and keeps the pasted text', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));

    const textarea = findByData(/** @type {any} */ (root), 'replayPaste');
    textarea.value = '{not valid json';
    screen.render(
      makeProps({
        loaded: false,
        error: { code: REPLAY_ERROR_CODES.INVALID_JSON, message: 'This is not valid JSON (boom).' },
      }),
    );

    expect(findByClass(/** @type {any} */ (root), 'replay-error').hidden).toBe(false);
    expect(findByClass(/** @type {any} */ (root), 'replay-error-heading').textContent).toBe(
      REPLAY_COPY.badReplayHeading,
    );
    expect(findByClass(/** @type {any} */ (root), 'replay-error-detail').textContent).toBe(
      'This is not valid JSON (boom).',
    );
    // AC1: "stays on the screen" — the text the player pasted is not wiped out from under them.
    expect(textarea.value).toBe('{not valid json');
    expect(findByClass(/** @type {any} */ (root), 'replay-load').hidden).toBe(false);
    expect(findByClass(/** @type {any} */ (root), 'replay-player').hidden).toBe(true);
  });

  it('a fresh, error-free entry starts the paste box empty', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const textarea = findByData(/** @type {any} */ (root), 'replayPaste');
    textarea.value = 'leftover from a previous visit';

    screen.render(makeProps({ loaded: false, error: null }));

    expect(textarea.value).toBe('');
  });

  it('switches to the player view once loaded, hiding the load view', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    screen.render(makeProps({ loaded: true }));

    expect(findByClass(/** @type {any} */ (root), 'replay-load').hidden).toBe(true);
    expect(findByClass(/** @type {any} */ (root), 'replay-player').hidden).toBe(false);
  });

  it('the transport rows call onPlayToggle / onStep / onSeekToStart via keyboard navigation', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const props = makeProps({ loaded: true });
    screen.render(props);

    screen.handleMenuAction('CONFIRM'); // PLAY/PAUSE is the default-focused row
    expect(props.onPlayToggle).toHaveBeenCalledTimes(1);

    screen.handleMenuAction('DOWN');
    screen.handleMenuAction('CONFIRM'); // STEP
    expect(props.onStep).toHaveBeenCalledTimes(1);

    screen.handleMenuAction('DOWN');
    screen.handleMenuAction('CONFIRM'); // START AGAIN
    expect(props.onSeekToStart).toHaveBeenCalledTimes(1);
  });

  it('the transport rows are also clickable, without piling up duplicate listeners across renders', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const props = makeProps({ loaded: true });
    // Rendered three times, as a real load-then-toggle sequence would (module doc: `render()` is not rare
    // here) — proves `wireRows` swapping the item list does not also multiply the DOM click listener.
    screen.render(props);
    screen.render(props);
    screen.render(props);

    const stepRow = findByClass(/** @type {any} */ (root), 'replay-player').children.find(
      (child) => child.textContent === REPLAY_COPY.stepLabel,
    );
    if (stepRow === undefined) throw new Error('STEP row not found');
    stepRow.dispatchEvent('click');

    expect(props.onStep).toHaveBeenCalledTimes(1);
  });

  it('KI-05-03 AC4: Esc (BACK) calls onBack from either view', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    const props = makeProps({ loaded: false });
    screen.render(props);

    screen.handleMenuAction('BACK');
    expect(props.onBack).toHaveBeenCalledTimes(1);

    screen.render(makeProps({ ...props, loaded: true, onBack: props.onBack }));
    screen.handleMenuAction('BACK');
    expect(props.onBack).toHaveBeenCalledTimes(2);
  });

  it('updateProgress writes the tick readout and toggles the PLAY/PAUSE label and END OF REPLAY', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    screen.render(makeProps({ loaded: true }));

    const replay = /** @type {any} */ ({
      expectedEvents: [
        { type: 'FOOD_SPAWNED', tick: 0 },
        { type: 'ROUND_OVER', tick: 380 },
      ],
    });

    screen.updateProgress({ tick: 137, replay, phase: 'PLAYING', isPlaying: true });
    expect(findByData(/** @type {any} */ (root), 'replayReadout').textContent).toBe(
      'TICK 137 / 380',
    );
    expect(
      findByClass(/** @type {any} */ (root), 'replay-player').children.find(
        (c) => c.textContent === REPLAY_COPY.pauseLabel,
      ),
    ).toBeDefined();
    // KI-05-06 (#260): visibility, not the box. The end line keeps its height at all times so the transport
    // rows below it never move when it appears — see `replay.js`'s note on this element.
    expect(
      findByClass(/** @type {any} */ (root), 'replay-end').className.includes(
        'replay-end--placeholder',
      ),
    ).toBe(true);

    screen.updateProgress({ tick: 380, replay, phase: 'ROUND_OVER', isPlaying: false });
    expect(findByData(/** @type {any} */ (root), 'replayReadout').textContent).toBe(
      'TICK 380 / 380',
    );
    expect(
      findByClass(/** @type {any} */ (root), 'replay-player').children.find(
        (c) => c.textContent === REPLAY_COPY.playLabel,
      ),
    ).toBeDefined();
    expect(
      findByClass(/** @type {any} */ (root), 'replay-end').className.includes(
        'replay-end--placeholder',
      ),
    ).toBe(false);
  });

  it('destroy removes the screen from the root', () => {
    const root = createFakeRoot();
    const screen = createReplayScreen(/** @type {any} */ (root));
    expect(findAllByClass(/** @type {any} */ (root), 'menu-screen')).toHaveLength(1);
    screen.destroy();
    expect(findAllByClass(/** @type {any} */ (root), 'menu-screen')).toHaveLength(0);
  });
});
