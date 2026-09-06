// @ts-check
import { createHud } from './hud.js';

/**
 * The HTML overlay + HUD, mounted inside `root` (`#ui` in `index.html`). `ARCHITECTURE §8` describes this
 * module's eventual job as a screen router (`ui.show(screenName, props)`); Sprint 03 needs exactly one screen
 * — the "PRESS ENTER" / round-over overlay — so that is all this exposes today. Sprint 05's state machine
 * grows this into the real router without `session.js` needing to change how it talks to `ui`.
 *
 * Like `hud.js`, DOM access goes through the injected `root`'s own document, never the global `document`, so
 * this stays constructible from a test with a hand-built fake root.
 */

/**
 * @typedef {object} Ui
 * @property {import('./hud.js').Hud} hud
 * @property {(text: string) => void} showOverlay
 * @property {() => void} hideOverlay
 * @property {() => void} destroy
 */

/**
 * Build the overlay and the HUD inside `root`.
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

  return {
    hud,
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
    },
  };
}
