// @ts-check
import { STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';

/**
 * The match-over screen (`MATCH_OVER`, `DESIGN-DECISIONS §2.6`: "After MATCH_OVER: REMATCH (same settings,
 * swap nothing) or MAIN MENU."). Two focusables, in that order. `keys` is display-only this sprint — nothing
 * is persisted until Sprint 13 (the tech-lead contract's own note), so this screen must never touch
 * `localStorage`.
 *
 * `gameStateMachine.js`'s `TRANSITIONS[MATCH_OVER]` carries no `BACK` row at all (only `REMATCH` and
 * `QUIT_TO_MENU`), so Esc is deliberately wired to nothing here — there is no `onBack` prop in the tech-lead
 * contract for this screen, and inventing one would let this screen attempt an illegal transition the state
 * machine does not have.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} MatchOverProps
 * @property {1 | 2} winner
 * @property {{1: string, 2: string}} colorNames
 * @property {{1: number, 2: number}} wins
 * @property {number} bestOf
 * @property {number} keys - 0, 1 or 2 keys earned; display only (Sprint 13 persists it).
 * @property {() => void} onRematch
 * @property {() => void} onMenu
 */

/**
 * @typedef {object} MatchOverScreen
 * @property {(props: MatchOverProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/** @param {string} name @returns {string} */
function capitalize(name) {
  return name.length === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Build the match-over screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {MatchOverScreen}
 */
export function createMatchOverScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--match-over';
  // A stable test hook on top of the (Sprint-11-restylable) class name (tech-lead note on this ticket).
  container.dataset.screen = STATES.MATCH_OVER;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';

  const winnerLine = doc.createElement('div');
  winnerLine.className = 'menu-title';
  panel.appendChild(winnerLine);

  const scoreLine = doc.createElement('div');
  scoreLine.className = 'menu-line';
  panel.appendChild(scoreLine);

  const keysLine = doc.createElement('div');
  keysLine.className = 'menu-line';
  panel.appendChild(keysLine);

  const rematchRow = doc.createElement('div');
  rematchRow.className = 'menu-item';
  rematchRow.textContent = 'REMATCH';
  panel.appendChild(rematchRow);

  const menuRow = doc.createElement('div');
  menuRow.className = 'menu-item';
  menuRow.textContent = 'MAIN MENU';
  panel.appendChild(menuRow);

  container.appendChild(panel);
  root.appendChild(container);

  /** @type {MatchOverProps} */
  let props = {
    winner: 1,
    colorNames: { 1: 'red', 2: 'blue' },
    wins: { 1: 0, 2: 0 },
    bestOf: 3,
    keys: 0,
    onRematch: () => {},
    onMenu: () => {},
  };

  const rows = [rematchRow, menuRow];

  // Built once (see `matchSetup.js`'s doc comment): each callback reads `props` live at call time.
  const focus = createFocusModel({
    items: [{ onSelect: () => props.onRematch() }, { onSelect: () => props.onMenu() }],
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

  function renderText() {
    const { winner, colorNames, wins, bestOf, keys } = props;
    winnerLine.textContent = `${capitalize(colorNames[winner]).toUpperCase()} WINS THE MATCH`;
    scoreLine.textContent = `BEST OF ${bestOf} — ${wins[1]}-${wins[2]}`;
    keysLine.textContent = `${keys} KEY${keys === 1 ? '' : 'S'} EARNED`;
  }

  renderText();
  updateFocusClasses();

  return {
    render(nextProps) {
      props = nextProps;
      renderText();
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
