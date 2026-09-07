// @ts-check

/**
 * The HOW TO PLAY panel (KI-10-03, `docs/sprints/improvement-10-first-minute.md`). Four lines, text only —
 * the illustrated version is Sprint 15's tutorial.
 *
 * This is a small overlay `mainMenu.js` owns and shows/hides directly, **not** a `gameStateMachine.js` state:
 * the tech-lead ruling on issue #138 is that a new `STATES` entry would cost a new transition-table row *and*
 * a new entry in `gameStateMachine.test.js`'s shortest-path map for a panel that is just text, so
 * `mainMenu.js` intercepts `BACK` itself while this is open and never dispatches anything for it. See that
 * file's own doc comment for how Esc, and the menu underneath, are kept from double-handling input while the
 * panel is up.
 *
 * Copy is `DESIGN-DECISIONS §3` ("First-minute copy", KI-10-00), approved and frozen — used verbatim below,
 * in order. Do not paraphrase; if a layout will not hold a line, that is a question for the design lead, not
 * a rewrite here.
 */

/** The four approved lines, in order. @type {ReadonlyArray<string>} */
const HOW_TO_PLAY_LINES = Object.freeze([
  'Eat apples to grow longer.',
  "Don't hit a wall, yourself, or the other snake.",
  'After 30 seconds the lasers close in.',
  'The last snake alive wins the round.',
]);

/**
 * @typedef {object} HowToPlayPanel
 * @property {() => void} show
 * @property {() => void} hide
 * @property {() => boolean} isOpen
 * @property {() => void} destroy
 */

/**
 * Build the panel as a hidden overlay appended to `root`. `root` is `mainMenu.js`'s own screen container, so
 * the panel shares its stacking context and is torn down along with it.
 *
 * @param {HTMLElement} root
 * @returns {HowToPlayPanel}
 */
export function createHowToPlayPanel(root) {
  const doc = root.ownerDocument;

  const overlay = doc.createElement('div');
  overlay.className = 'how-to-play-overlay';
  overlay.hidden = true;
  // A stable test hook, same convention as `screens/tuning.js`'s `dataset.tuning*` attributes — this panel
  // has no `gameStateMachine` state of its own to key off (see module doc comment), so it needs its own.
  overlay.dataset.howToPlayPanel = 'true';

  const panel = doc.createElement('div');
  panel.className = 'menu-panel how-to-play-panel';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = 'HOW TO PLAY';
  panel.appendChild(title);

  for (const line of HOW_TO_PLAY_LINES) {
    const lineEl = doc.createElement('div');
    lineEl.className = 'how-to-play-line';
    lineEl.textContent = line;
    panel.appendChild(lineEl);
  }

  overlay.appendChild(panel);
  root.appendChild(overlay);

  return {
    show() {
      overlay.hidden = false;
    },
    hide() {
      overlay.hidden = true;
    },
    isOpen: () => !overlay.hidden,
    destroy() {
      overlay.remove();
    },
  };
}
