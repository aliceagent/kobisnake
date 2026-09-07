// @ts-check
import { GAME_EVENTS, STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';
import { createHowToPlayPanel } from './howToPlayPanel.js';
import { REPLAY_COPY } from './replay.js';

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
 *
 * **KI-05-03 adds an eighth row, REPLAY, directly after HOW TO PLAY — a declared deviation from that
 * ticket's own `Files:` list (approved in advance; see the PR description).** That ticket's `Files:` list
 * names `src/ui/screens/replay.js`, `src/ui/ui.js`, `src/game/gameStateMachine.js` and `src/ui/styles.css`
 * but not this file, which would leave the new REPLAY state and screen with no way for a player to reach
 * them at all. Placement follows KI-10-03's own reasoning immediately above, applied to a second enabled row
 * rather than a first: `1 PLAYER` is permanently disabled at the top and the locked group below holds the
 * five `COMING SOON` rows, so a new *enabled* row belongs with `2 PLAYERS` and `HOW TO PLAY` — above that
 * group, not inside it — and after HOW TO PLAY specifically because HOW TO PLAY explains the game a player
 * is about to join and REPLAY is what a player reaches for only once they already have something to review,
 * the same before/after ordering the two ideas have everywhere else this game talks about them (GDD,
 * `DESIGN-DECISIONS`). Unlike HOW TO PLAY, REPLAY *does* carry a `GAME_EVENTS` entry
 * (`GAME_EVENTS.SELECT_REPLAY`) — selecting it is a real state-machine transition, into the new `REPLAY`
 * state `gameStateMachine.js` now defines. Its label, `REPLAY_COPY.menuLabel`, is approved copy from the
 * design lead's ruling on issue #211 (`DESIGN-DECISIONS §3`, "The REPLAY screen") — see `replay.js`'s own
 * module doc for why it still lives there rather than as a literal here, the same way every other
 * player-visible string on that screen does.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * KI-19-03's stamp: `main.js`'s own seam, since this module never reads `import.meta` itself (that stays
 * confined to `main.js` — see this file's `setBuildStamp` doc comment).
 * @typedef {object} BuildStamp
 * @property {string} commit - short commit hash, or `'unknown'` (`scripts/build-stamp.mjs`'s own fallback).
 * @property {string} date - an ISO-8601 build date, or `''` before `setBuildStamp` has ever been called.
 */

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
  // KI-05-03: a declared `Files:` deviation (module doc comment above) — the entry point into the REPLAY
  // screen. `label` is approved copy from issue #211's ruling (`replay.js`'s `REPLAY_COPY.menuLabel`).
  Object.freeze({ label: REPLAY_COPY.menuLabel, event: GAME_EVENTS.SELECT_REPLAY }),
  Object.freeze({ label: 'PRACTICE', disabled: true, event: GAME_EVENTS.SELECT_PRACTICE }),
  Object.freeze({ label: 'TUTORIAL', disabled: true, event: GAME_EVENTS.SELECT_TUTORIAL }),
  Object.freeze({ label: 'SHOP', disabled: true, event: GAME_EVENTS.SELECT_SHOP }),
  Object.freeze({ label: 'SETTINGS', disabled: true, event: GAME_EVENTS.SELECT_SETTINGS }),
]);

/**
 * KI-19-03: what a screen built before `main.js` ever calls {@link setBuildStamp} shows — a plain unit test
 * that constructs this screen directly (as `tests/unit/ui/mainMenu.test.js` does) rather than through
 * `main.js`'s boot sequence. A real page never observes this: `main.js` calls `setBuildStamp` before it
 * builds the one `createUi` (and so the one `MAIN_MENU` screen) that will ever exist for the page's life.
 * @type {BuildStamp}
 */
const DEFAULT_BUILD_STAMP = Object.freeze({ commit: 'unknown', date: '' });

/** @type {BuildStamp} */
let currentBuildStamp = DEFAULT_BUILD_STAMP;

/**
 * `main.js`'s seam for KI-19-03 (`ARCHITECTURE §11`): the commit short-hash and build date `vite.config.js`'s
 * `define` bakes into `import.meta.env` at build time. This module never reads `import.meta` itself — only
 * `main.js` is allowed to (that file's own comment on `isDevOrTest`) — so `main.js` resolves the value and
 * hands it here as a plain argument instead.
 *
 * Called once, before `main.js` builds `createUi` (that file's own comment explains why the ordering is
 * safe: there is exactly one `MAIN_MENU` screen for the life of a page, and this runs before it exists), so
 * every render of that one screen already carries the real stamp.
 *
 * @param {BuildStamp} stamp
 */
export function setBuildStamp(stamp) {
  currentBuildStamp = stamp;
}

/**
 * `commit · YYYY-MM-DD` — small enough for a corner of the menu, specific enough for a bug report. The full
 * ISO timestamp is what `window.__kobi.buildStamp.date` carries for a harness that wants more precision; a
 * human reading the menu does not need the time of day.
 *
 * @param {BuildStamp} stamp
 * @returns {string}
 */
function formatBuildStamp(stamp) {
  const day = stamp.date.slice(0, 10);
  return day ? `${stamp.commit} · ${day}` : stamp.commit;
}

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

  // KI-19-03: small, in the corner of the screen, independent of the panel's own flex layout (`.build-stamp`
  // in `styles.css` positions it against this screen's `inset: 0`). Visible on every normal production load
  // — the whole point being that a bug report can name which build with no extra step, never gated behind
  // `?test=1` — unlike `window.__kobi.buildStamp` (`main.js`), which stays behind `__kobi`'s existing
  // dev/test gate. `data-build-stamp` is this element's own stable test hook, the same pattern
  // `container.dataset.screen` above uses for the screen itself.
  const buildStampEl = doc.createElement('div');
  buildStampEl.className = 'build-stamp';
  buildStampEl.dataset.buildStamp = '';
  buildStampEl.textContent = formatBuildStamp(currentBuildStamp);
  container.appendChild(buildStampEl);

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
