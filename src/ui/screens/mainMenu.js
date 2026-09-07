// @ts-check
import { GAME_EVENTS, STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';

/**
 * The main menu (`docs/reference/README.md` note 1: the GDD's item list is authoritative, not
 * `14-main-menu.png`'s PLAY/STATS/SKINS/SETTINGS — that image is visual language only, Sprint 11's job).
 * Ticket KS-05-04's list, in this exact order: 1 PLAYER (disabled, "COMING SOON" — Sprint 19), 2 PLAYERS,
 * PRACTICE (disabled until S15), TUTORIAL (disabled until S15), SHOP (disabled until S14), SETTINGS (disabled
 * until S12). "1 PLAYER" has no `GAME_EVENTS` entry at all — it never fires `onSelect` regardless, being
 * permanently disabled this sprint — so it is the one row below with no `event` field.
 *
 * KI-10-01: the one playable row (`2 PLAYERS`) reads as the primary action and the five unavailable rows are
 * grouped into their own box below it, so the screen stops reading as mostly locked. This is presentation
 * only: `MENU_ITEMS` keeps its order, the default-focused row is unchanged (still index 1, `2 PLAYERS` — the
 * only enabled entry `firstFocusableIndex` can land on), and every disabled row is exactly as unselectable as
 * before (`focus.js` skips disabled entries regardless of where their DOM node lives). The `rows` array below
 * still has one element per `MENU_ITEMS` entry, in `MENU_ITEMS` order — only *which parent* each row is
 * appended to changes, not the row-to-item index mapping `updateFocusClasses` and the mouse handlers rely on.
 * The one-line description under the title is `DESIGN-DECISIONS §3`'s approved copy, used verbatim.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} MainMenuProps
 * @property {(gameEvent: string) => void} onSelect - called with a `GAME_EVENTS` name; never for a disabled row.
 */

/**
 * @typedef {object} MainMenuScreen
 * @property {(props: MainMenuProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * @type {ReadonlyArray<{label: string, disabled?: boolean, event?: string}>}
 */
const MENU_ITEMS = Object.freeze([
  Object.freeze({ label: '1 PLAYER', disabled: true }),
  Object.freeze({ label: '2 PLAYERS', event: GAME_EVENTS.SELECT_2P }),
  Object.freeze({ label: 'PRACTICE', disabled: true, event: GAME_EVENTS.SELECT_PRACTICE }),
  Object.freeze({ label: 'TUTORIAL', disabled: true, event: GAME_EVENTS.SELECT_TUTORIAL }),
  Object.freeze({ label: 'SHOP', disabled: true, event: GAME_EVENTS.SELECT_SHOP }),
  Object.freeze({ label: 'SETTINGS', disabled: true, event: GAME_EVENTS.SELECT_SETTINGS }),
]);

/**
 * Build the main menu screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {MainMenuScreen}
 */
export function createMainMenuScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--main-menu';
  // A stable test hook on top of the (Sprint-11-restylable) class name — tests address a screen by state
  // identity, not by a CSS class (tech-lead note on this ticket).
  container.dataset.screen = STATES.MAIN_MENU;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = 'KOBI SNAKE';
  panel.appendChild(title);

  // KI-10-00 approved copy (`DESIGN-DECISIONS §3`), verbatim. Answers "what is this and who plays it" in its
  // first four words, which is the line's whole job — it goes right under the title.
  const description = doc.createElement('p');
  description.className = 'menu-description';
  description.textContent =
    'Two players, one keyboard. Eat apples, grow long, and make the other snake crash.';
  panel.appendChild(description);

  /** @type {MainMenuProps} */
  let props = { onSelect: () => {} };

  // A box for the unavailable rows so five "COMING SOON" items read as one locked group instead of
  // dominating the list beside the one thing a player can actually do (KI-10-01).
  const lockedGroup = doc.createElement('div');
  lockedGroup.className = 'menu-item-group menu-item-group--locked';

  const rows = MENU_ITEMS.map((item) => {
    const row = doc.createElement('div');
    row.className = item.disabled
      ? 'menu-item menu-item--disabled'
      : 'menu-item menu-item--primary';

    const label = doc.createElement('span');
    label.className = 'menu-item-label';
    label.textContent = item.label;
    row.appendChild(label);

    if (item.disabled) {
      const tag = doc.createElement('span');
      tag.className = 'menu-item-tag';
      tag.textContent = 'COMING SOON';
      row.appendChild(tag);
    }

    // The enabled row (2 PLAYERS) sits directly in the panel as the primary action; every disabled row goes
    // into the locked group, in its original relative order (AC1 keeps every item on screen either way).
    (item.disabled ? lockedGroup : panel).appendChild(row);
    return row;
  });

  panel.appendChild(lockedGroup);

  container.appendChild(panel);
  root.appendChild(container);

  // Built once (see `matchSetup.js`'s doc comment for why): each enabled item's `onSelect` reads `props`
  // live, so a fresh `onSelect` callback from a re-render is always the one actually called.
  const focus = createFocusModel({
    items: MENU_ITEMS.map((item) => ({
      disabled: item.disabled,
      onSelect: item.disabled
        ? undefined
        : () => props.onSelect(/** @type {string} */ (item.event)),
    })),
  });

  function updateFocusClasses() {
    const focused = focus.getIndex();
    rows.forEach((row, i) => row.classList.toggle('menu-item--focused', i === focused));
  }

  rows.forEach((row, i) => {
    if (MENU_ITEMS[i].disabled) return; // disabled rows can never be focused or clicked (AC2)
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
