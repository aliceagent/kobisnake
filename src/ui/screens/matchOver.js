// @ts-check
import { STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';

/**
 * The match-over screen (`MATCH_OVER`, `DESIGN-DECISIONS §2.6`: "After MATCH_OVER: REMATCH (same settings,
 * swap nothing) or MAIN MENU."). `keys` is display-only this sprint — nothing is persisted until Sprint 13
 * (the tech-lead contract's own note), so this screen must never touch `localStorage`.
 *
 * `gameStateMachine.js`'s `TRANSITIONS[MATCH_OVER]` carries no `BACK` row at all (only `REMATCH`,
 * `QUIT_TO_MENU` and, since KI-05-04, `SELECT_REPLAY`), so Esc is deliberately wired to nothing here — there
 * is no `onBack` prop in the tech-lead contract for this screen, and inventing one would let this screen
 * attempt an illegal transition the state machine does not have.
 *
 * KI-01-02: the draw cap (`DESIGN-DECISIONS §1` row 26) can end a match with a level score, which has no
 * winner — `winner` is `1 | 2 | null`, and `null` reads `IT'S A TIE` (`DESIGN-DECISIONS §3`'s "A match that
 * ends level" bullet, approved verbatim, no alternative copy) instead of naming a player. `renderText` must
 * branch on `winner === null` before it ever reaches `colorNames[winner]` — indexing `colorNames` with `null`
 * reads `undefined`, and `capitalize(undefined)` would throw rather than silently rendering "UNDEFINED WINS
 * THE MATCH", but either failure mode is exactly the bug this ticket exists to close.
 *
 * ## KI-05-04: WATCH LAST ROUND, a declared `Files:` deviation
 *
 * The sprint file's own `Files:` list for KI-05-04 names `src/ui/screens/scoreboard.js`; the design lead's
 * ruling on issue #211, recorded in `DESIGN-DECISIONS §3` under "The REPLAY screen" and repeated on issue
 * #222, moves the row here instead: "`WATCH LAST ROUND` is a row on the match-over screen, not the
 * scoreboard: the scoreboard is a 2.5-second passive beat and its interaction model is Sprint 11's to
 * redesign." This screen already has real, focusable rows and already waits for a person, so the new row
 * needs no new interaction model — it is a third focusable alongside `REMATCH` and `MAIN MENU`, wired through
 * the exact same `createFocusModel`/`rows` machinery those two already use. It is placed *after* both
 * existing rows rather than between them (see the row's own comment below, next to where it is built): several
 * e2e specs key a single ArrowDown from the default-focused `REMATCH` to `MAIN MENU`, and appending the new
 * row keeps every one of them true without editing a file outside this ticket's own change.
 *
 * `WATCH_LAST_ROUND_LABEL` is approved copy (same ruling), a named constant rather than an inline literal —
 * the same discipline `scoreboard.js`'s own `DRAW_TEXT` carries ("Never invent another spelling").
 * `onWatchLastRound` dispatches `gameStateMachine.js`'s `SELECT_REPLAY` event (`session.js`'s own doc comment
 * on `watchLastRound`), the same event `mainMenu.js`'s REPLAY row already uses — one event, now two rows that
 * can fire it, per that file's own table-doc note.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} MatchOverProps
 * @property {1 | 2 | null} winner - `null` on a tie: the draw cap fired with a level score
 *   (`DESIGN-DECISIONS §1` row 26). No key is awarded on a tie (`keys` is `0`); `session.js` decides that.
 * @property {{1: string, 2: string}} colorNames
 * @property {{1: number, 2: number}} wins
 * @property {number} bestOf
 * @property {number} keys - 0, 1 or 2 keys earned; display only (Sprint 13 persists it).
 * @property {() => void} onRematch
 * @property {() => void} onMenu
 * @property {() => void} onWatchLastRound - KI-05-04: the WATCH LAST ROUND row. `session.js`'s own
 *   `watchLastRound` loads the match's last round into the REPLAY screen's player and dispatches
 *   `SELECT_REPLAY` — this screen only has to call it.
 */

/**
 * @typedef {object} MatchOverScreen
 * @property {(props: MatchOverProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * The WATCH LAST ROUND row's label — approved copy, `DESIGN-DECISIONS §3` ("The REPLAY screen"), ruled on
 * issue #211 and repeated on #222. Verbatim, never respelled here (the same rule `scoreboard.js`'s own
 * `DRAW_TEXT` carries) — exported so `tests/unit/ui/matchOver.test.js` asserts against this constant rather
 * than a second copy of the literal.
 */
export const WATCH_LAST_ROUND_LABEL = 'WATCH LAST ROUND';

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

  // KI-05-04: appended after the two existing rows, not inserted between them — `tests/e2e/menus.spec.js` and
  // `tests/e2e/powerups-toggle.spec.js` both key "one ArrowDown from REMATCH" to MAIN MENU (`QUIT_TO_MENU`),
  // and putting the new row last is what keeps both true without editing either spec for a ticket that does
  // not otherwise touch them (module doc's "declared deviation" note names the one deviation this ticket
  // does make; this ordering choice avoids a second, needless one).
  const watchLastRoundRow = doc.createElement('div');
  watchLastRoundRow.className = 'menu-item';
  watchLastRoundRow.textContent = WATCH_LAST_ROUND_LABEL;
  panel.appendChild(watchLastRoundRow);

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
    onWatchLastRound: () => {},
  };

  const rows = [rematchRow, menuRow, watchLastRoundRow];

  // Built once (see `matchSetup.js`'s doc comment): each callback reads `props` live at call time.
  const focus = createFocusModel({
    items: [
      { onSelect: () => props.onRematch() },
      { onSelect: () => props.onMenu() },
      { onSelect: () => props.onWatchLastRound() },
    ],
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
    // `winner === null` must be checked before `colorNames[winner]` is ever read (module doc comment): a tie
    // has no player to name, and `IT'S A TIE` is the approved copy (`DESIGN-DECISIONS §3`), not a fallback.
    winnerLine.textContent =
      winner === null
        ? "IT'S A TIE"
        : `${capitalize(colorNames[winner]).toUpperCase()} WINS THE MATCH`;
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
