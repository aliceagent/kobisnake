// @ts-check
import { STATES } from '../game/gameStateMachine.js';
import { createHud } from './hud.js';
import { createMainMenuScreen } from './screens/mainMenu.js';
import { createMatchSetupScreen } from './screens/matchSetup.js';
import { createCountdownScreen } from './screens/countdown.js';
import { createScoreboardScreen } from './screens/scoreboard.js';
import { createMatchOverScreen } from './screens/matchOver.js';
import { createPauseScreen } from './screens/pause.js';

/**
 * The HTML overlay + HUD + grey-box screen router, mounted inside `root` (`#ui` in `index.html`).
 * `ARCHITECTURE §8` describes this module's job as a screen router (`ui.show(screenName, props)`); ticket
 * KS-05-04 builds that router and every grey-box screen it dispatches to. `showOverlay`/`hideOverlay` and
 * `hud` are kept byte-for-byte as Sprint 03/04 left them — this PR (KS-05-04) merges *before* KS-05-03
 * (the session rewrite around the state machine), so until that lands `main.js`/`session.js` still drive the
 * placeholder "PRESS ENTER" overlay exclusively, and `show()`/`handleMenuAction()` sit unused but ready
 * (tech-lead note B). Nothing calls `show()` yet, so every new screen stays hidden and the existing
 * `first-playable-idle.png` visual baseline is unaffected.
 *
 * `show(state, props)` is idempotent and re-renderable — the ticket's own contract: hides every other screen
 * (via each screen's own `hidden` property, never an inline `display` style — `hideAll()` below) and, for a
 * state with a screen, hands it `props` via its `render(props)`. `PLAYING` and `LASER_WARNING` (and any state
 * with no grey-box screen, e.g. the S12–S15 placeholders) have no entry in `screens` at all, so `show()`
 * leaves every screen hidden and only the arena/HUD visible — exactly what those two states need.
 * `handleMenuAction(action)` (`input.js`'s `MenuAction`) is routed to whichever screen is currently showing —
 * screens never add their own `keydown` listener (`input.js` owns the keyboard for the whole app;
 * ARCHITECTURE §8, tech-lead note A), only `mouseenter`/`click` handlers of their own.
 *
 * Every screen's root element also carries `data-screen="<STATE>"` (each `./screens/*.js` module sets its
 * own), a stable identity hook for `tests/e2e/menus.spec.js` and `tests/visual/screens.visual.spec.js`
 * (KS-05-05) to address a screen by — independent of whatever CSS class Sprint 11 later renames.
 *
 * Like `hud.js`, DOM access goes through the injected `root`'s own document, never the global `document`, so
 * this stays constructible from a test with a hand-built fake root.
 */

/** @typedef {import('../game/gameStateMachine.js').GameState} GameState */
/** @typedef {import('./focus.js').MenuAction} MenuAction */

/**
 * A grey-box screen, as every `./screens/*.js` module builds one. `props` is deliberately untyped here
 * (`object`) — each screen's own module carries the real prop shape for its state; `ui.js` only ever forwards
 * whatever `show()` was called with.
 *
 * @typedef {object} Screen
 * @property {(props: any) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * @typedef {object} Ui
 * @property {import('./hud.js').Hud} hud
 * @property {(state: GameState, props?: object) => void} show
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {(text: string) => void} showOverlay
 * @property {() => void} hideOverlay
 * @property {() => void} destroy
 */

/**
 * Build the overlay, the HUD and every grey-box screen inside `root`.
 *
 * @param {HTMLElement} root - `#ui` from `index.html`.
 * @returns {Ui}
 */
export function createUi(root) {
  const doc = root.ownerDocument;

  const overlay = doc.createElement('div');
  overlay.className = 'overlay';
  overlay.hidden = true;
  root.appendChild(overlay);

  const hud = createHud(root);

  /** @type {Partial<Record<GameState, Screen>>} */
  const screens = {
    [STATES.MAIN_MENU]: createMainMenuScreen(root),
    [STATES.MATCH_SETUP]: createMatchSetupScreen(root),
    [STATES.COUNTDOWN]: createCountdownScreen(root),
    [STATES.ROUND_OVER]: createScoreboardScreen(root),
    [STATES.MATCH_OVER]: createMatchOverScreen(root),
    [STATES.PAUSE]: createPauseScreen(root),
  };

  /** The screen `show()` most recently displayed, or `null` for a state with no grey-box screen (PLAYING,
   * LASER_WARNING, and the S12–S15 placeholders TUTORIAL/PRACTICE/SHOP/SETTINGS). */
  /** @type {Screen | null} */
  let activeScreen = null;

  function hideAll() {
    for (const screen of Object.values(screens)) screen.hide();
  }

  return {
    hud,
    show(state, props = {}) {
      hideAll();
      const screen = screens[state];
      if (screen) {
        screen.render(props);
        screen.show();
        activeScreen = screen;
      } else {
        activeScreen = null;
      }
    },
    handleMenuAction(action) {
      activeScreen?.handleMenuAction(action);
    },
    showOverlay(text) {
      overlay.textContent = text;
      overlay.hidden = false;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    destroy() {
      hud.destroy();
      overlay.remove();
      for (const screen of Object.values(screens)) screen.destroy();
    },
  };
}
