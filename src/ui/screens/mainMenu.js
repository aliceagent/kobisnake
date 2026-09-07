// @ts-check
import { GAME_EVENTS, STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';
import { createHowToPlayPanel } from './howToPlayPanel.js';

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
 * first enabled entry `firstFocusableIndex` can land on), and every disabled row is exactly as unselectable as
 * before (`focus.js` skips disabled entries regardless of where their DOM node lives). The `rows` array below
 * still has one element per `MENU_ITEMS` entry, in `MENU_ITEMS` order — only *which parent* each row is
 * appended to changes, not the row-to-item index mapping `updateFocusClasses` and the mouse handlers rely on.
 * The one-line description under the title is `DESIGN-DECISIONS §3`'s approved copy, used verbatim.
 *
 * **KI-10-03 adds a seventh row, HOW TO PLAY, directly after `2 PLAYERS`** — with the available actions and
 * above KI-10-01's locked group, per the design lead's review on #145. It was first written last in the list;
 * that put the one row explaining the game at the bottom of a screen whose middle is five locked doors, which
 * is the complaint this sprint exists to answer (#119 F6). Because KI-10-01 routes enabled rows into the panel
 * and disabled ones into the locked group, being enabled is what places it there — the order here and the
 * order on screen agree.
 *
 * `2 PLAYERS` is still the default-focused row: `firstFocusableIndex` finds the first *enabled* entry, and
 * `1 PLAYER` above it is permanently disabled, so inserting HOW TO PLAY *below* `2 PLAYERS` cannot take the
 * default focus off it — which `tests/e2e/menus.spec.js` and `first-playable.spec.js` assume when they press
 * Enter on boot. HOW TO PLAY is enabled (never `COMING SOON`) but has no `GAME_EVENTS` entry, for the opposite
 * reason "1 PLAYER" has none: selecting it does not move the state machine at all — it opens
 * `howToPlayPanel.js`'s overlay locally, via the `isHowToPlay` marker below rather than an `event`. See that
 * panel module's own doc comment for why this is not a new `gameStateMachine.js` state.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} MainMenuProps
 * @property {(gameEvent: string) => void} onSelect - called with a `GAME_EVENTS` name; never for a disabled
 *   row, and never for HOW TO PLAY (KI-10-03), which opens its overlay locally instead of firing an event.
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
 * @type {ReadonlyArray<{label: string, disabled?: boolean, event?: string, isHowToPlay?: boolean}>}
 */
const MENU_ITEMS = Object.freeze([
  Object.freeze({ label: '1 PLAYER', disabled: true }),
  Object.freeze({ label: '2 PLAYERS', event: GAME_EVENTS.SELECT_2P }),
  // KI-10-03: not disabled, but no `event` — selecting it opens the HOW TO PLAY overlay locally rather than
  // firing a `GAME_EVENTS` transition (see the module doc comment above).
  Object.freeze({ label: 'HOW TO PLAY', isHowToPlay: true }),
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

  // KI-10-03: the HOW TO PLAY overlay, appended after the menu panel so it stacks above it. Built inside
  // `container` (not `root`) so it hides and is torn down with this screen, same as `panel` above.
  const howToPlay = createHowToPlayPanel(container);

  // Built once (see `matchSetup.js`'s doc comment for why): each enabled item's `onSelect` reads `props`
  // live, so a fresh `onSelect` callback from a re-render is always the one actually called.
  const focus = createFocusModel({
    items: MENU_ITEMS.map((item) => ({
      disabled: item.disabled,
      onSelect: item.disabled
        ? undefined
        : item.isHowToPlay
          ? () => howToPlay.show()
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
      // Belt-and-braces: nothing in this screen leaves it open across a hide (Esc closes it, and it is the
      // only way off this screen while it is up — see `handleMenuAction` below), but a re-`show()` should
      // never inherit a stale open panel from whatever state this screen was last left in.
      howToPlay.hide();
    },
    handleMenuAction(action) {
      // KI-10-03: while the panel is open it owns input completely — Esc closes it without reaching the
      // menu underneath (`MAIN_MENU`'s own `BACK`-to-itself row in `gameStateMachine.js` is never touched),
      // and every other action (UP/DOWN/CONFIRM) is swallowed rather than driving the menu behind it.
      if (howToPlay.isOpen()) {
        if (action === 'BACK') howToPlay.hide();
        return;
      }
      focus.handleAction(action);
      updateFocusClasses();
    },
    destroy() {
      howToPlay.destroy();
      container.remove();
    },
  };
}
