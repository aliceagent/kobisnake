// @ts-check
import { STATES } from '../../game/gameStateMachine.js';

/**
 * The 3·2·1·GO countdown screen (`DESIGN-DECISIONS §2.4`, ticket KS-05-04) — one big centred label, nothing
 * interactive. `session.js` re-renders it with a new `label` up to four times a round (KS-05-03) and reuses
 * the same screen for the 1-second "READY?" beat after a pause resumes (`DESIGN-DECISIONS §2.8`), which is
 * why `label` accepts `'READY?'` as well as the four round-start values — there is deliberately no separate
 * "resume" screen to build.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */

/**
 * @typedef {object} CountdownProps
 * @property {'3' | '2' | '1' | 'GO' | 'READY?'} label
 */

/**
 * @typedef {object} CountdownScreen
 * @property {(props: CountdownProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * Build the countdown screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {CountdownScreen}
 */
export function createCountdownScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--countdown';
  // A stable test hook on top of the (Sprint-11-restylable) class name (tech-lead note on this ticket).
  container.dataset.screen = STATES.COUNTDOWN;
  container.hidden = true;

  const label = doc.createElement('div');
  label.className = 'countdown-label';
  container.appendChild(label);

  root.appendChild(container);

  return {
    render(props) {
      label.textContent = props.label;
    },
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    // Nothing on this screen is focusable — it exists only to display a label — so every menu action is a
    // deliberate no-op rather than an omission (still satisfies AC1: there is nothing to operate).
    handleMenuAction() {},
    destroy() {
      container.remove();
    },
  };
}
