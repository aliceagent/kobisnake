// @ts-check
import { STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';

/**
 * The pause screen (`PAUSE`, `DESIGN-DECISIONS §2.8`: "Esc during PLAYING opens PAUSE (Resume / Restart
 * match / Quit to menu)."). Three focusables, in that exact order.
 *
 * Esc resumes (KS-06-00, the design lead's ruling on issue #82; `DESIGN-DECISIONS §2.8` now says so
 * explicitly). `ARCHITECTURE §8` gives Esc one universal meaning — "back" — and back out of the pause screen
 * is back into the round, so `onBack` is routed to the same session handler as the RESUME item and gets the
 * same one-second READY? beat. A player who pressed Esc to pause presses it again to unpause.
 *
 * **Space resumes too** (KS-07-00, the owner's playtest, issue #103): `§2.8` now says Space behaves exactly
 * like Esc for pausing. This screen needs no code for it — `session.js` translates Space into the same
 * `BACK` before it reaches here, so both keys arrive as one action and cannot drift apart.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} PauseProps
 * @property {() => void} onResume
 * @property {() => void} onRestart
 * @property {() => void} onMenu
 * @property {() => void} onBack - Esc. Resumes, like `onResume`, but as its own callback so `session.js`
 *   can dispatch the `BACK` the player actually expressed rather than a `RESUME` they did not.
 */

/**
 * @typedef {object} PauseScreen
 * @property {(props: PauseProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * Build the pause screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {PauseScreen}
 */
export function createPauseScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--pause';
  // A stable test hook on top of the (Sprint-11-restylable) class name (tech-lead note on this ticket).
  container.dataset.screen = STATES.PAUSE;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = 'PAUSED';
  panel.appendChild(title);

  const resumeRow = doc.createElement('div');
  resumeRow.className = 'menu-item';
  resumeRow.textContent = 'RESUME';
  panel.appendChild(resumeRow);

  const restartRow = doc.createElement('div');
  restartRow.className = 'menu-item';
  restartRow.textContent = 'RESTART MATCH';
  panel.appendChild(restartRow);

  const menuRow = doc.createElement('div');
  menuRow.className = 'menu-item';
  menuRow.textContent = 'QUIT TO MENU';
  panel.appendChild(menuRow);

  container.appendChild(panel);
  root.appendChild(container);

  /** @type {PauseProps} */
  let props = { onResume: () => {}, onRestart: () => {}, onMenu: () => {}, onBack: () => {} };

  const rows = [resumeRow, restartRow, menuRow];

  // Built once (see `matchSetup.js`'s doc comment): each callback reads `props` live at call time.
  const focus = createFocusModel({
    items: [
      { onSelect: () => props.onResume() },
      { onSelect: () => props.onRestart() },
      { onSelect: () => props.onMenu() },
    ],
    onBack: () => props.onBack(),
  });

  function updateFocusClasses() {
    const focused = focus.getIndex();
    rows.forEach((row, i) => row.classList.toggle('menu-item--focused', i === focused));
  }

  rows.forEach((row, i) => {
    row.addEventListener('mouseenter', () => {
      focus.setIndex(i);
      updateFocusClasses();
    });
    row.addEventListener('click', () => {
      focus.setIndex(i);
      focus.select();
      updateFocusClasses();
    });
  });

  updateFocusClasses();

  return {
    render(nextProps) {
      props = nextProps;
      updateFocusClasses();
    },
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    handleMenuAction(action) {
      focus.handleAction(action);
      updateFocusClasses();
    },
    destroy() {
      container.remove();
    },
  };
}
