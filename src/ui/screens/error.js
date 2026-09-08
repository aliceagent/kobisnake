// @ts-check
import { error } from '../strings.js';

/**
 * The last-resort screen (KI-06-02, `docs/sprints/improvement-06-resilience-and-recovery.md`): what a player
 * sees when there is nothing left to recover from — WebGL was never available, a lost context never comes
 * back, or something threw during startup before there was a session, a loop or a renderer to hand a normal
 * screen. Every one of those can happen *before* `ui.js` exists, which is why this module builds and mounts
 * its own DOM directly onto `#ui` (`main.js`'s job, not `ui.js`'s) rather than living in `ui.js`'s
 * `screens` map: it is not a `GameState` (`src/game/gameStateMachine.js` gains no `ERROR` row — this ticket's
 * own tech-lead note), and `createErrorScreen(root)` needs nothing but the DOM to exist.
 *
 * Copy is the catalogue's own `error` group (`src/ui/strings.js`, KI-20-01/02's convention) — imported as
 * `{ error }`, this screen's own group, never the `STRINGS` aggregate: this screen is reachable from the very
 * top of `main.js`, the entry chunk every player downloads, so importing the aggregate would drag every other
 * screen's copy (playtest copy included) in with it and reintroduce the KI-11-05 chunk-split regression
 * `strings.js`'s own module doc comment describes (#258).
 *
 * **RELOAD is a real `<button>`, plus this screen's own Enter/Space key listener.** `ARCHITECTURE §8` gives
 * `input.js` the keyboard for the whole app and says screens never listen for their own keys — but `input.js`
 * is built by `createSession`, and this screen exists precisely for the moments that never reach that point
 * (a throw during startup, before `createInput` ever runs) or for a session that is still alive but drawing
 * into a dead canvas (the context-loss grace timer below), where relying on whatever `input.js` happens to be
 * doing underneath is exactly the untested path the tech-lead notes warn against. This is the one screen
 * allowed its own listener, registered on `root.ownerDocument.defaultView` (the page's `window`) so a test can
 * supply a fake one without touching the real global, and guarded by the screen's own `hidden` flag so it never
 * reacts to a key while it is not the thing on screen.
 */

/** @typedef {(callback: () => void, ms: number) => number} SetTimeoutFn */
/** @typedef {(id: number) => void} ClearTimeoutFn */

/**
 * @typedef {object} ErrorScreenOptions
 * @property {() => void} [reload] - defaults to a real page reload; injectable so a unit test can prove the
 *   action fires without ever navigating anywhere.
 */

/**
 * @typedef {object} ErrorScreen
 * @property {() => void} show
 * @property {() => void} hide
 * @property {() => void} destroy
 */

/**
 * Build the last-resort screen inside `root`. Hidden until `show()` is called; nothing here touches a
 * session, a loop or a renderer, so it can be constructed as the very first thing `main.js` does, before any
 * of those exist to fail.
 *
 * @param {HTMLElement} root - `#ui` from `index.html`.
 * @param {ErrorScreenOptions} [options]
 * @returns {ErrorScreen}
 */
export function createErrorScreen(root, options = {}) {
  const { reload = () => window.location.reload() } = options;
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  // `.menu-screen`/`.menu-panel`/`.menu-title` (`styles.css`) are reused wholesale (tech-lead note: "this
  // screen should look like it belongs to the same game, not like a browser error page") — `.error-screen`
  // adds only the one rule those classes do not already carry (see that rule's own comment in `styles.css`).
  container.className = 'menu-screen error-screen';
  // A stable test hook, matching every other screen's own `data-screen` (`ui.js`'s module doc comment) even
  // though this one is never routed through `ui.js`'s `show()` — `tests/e2e` and the visual baseline address
  // it the same way they address every other screen.
  container.dataset.screen = 'ERROR';
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';

  const heading = doc.createElement('div');
  heading.className = 'menu-title';
  heading.textContent = error.heading;
  panel.appendChild(heading);

  const message = doc.createElement('p');
  // Reuses `.menu-description`'s existing body-text treatment (same "reuse before inventing" note above).
  message.className = 'menu-description';
  message.textContent = error.message;
  panel.appendChild(message);

  const reloadButton = doc.createElement('button');
  reloadButton.type = 'button';
  reloadButton.className = 'error-reload-button';
  reloadButton.textContent = error.reloadButton;
  panel.appendChild(reloadButton);

  container.appendChild(panel);
  root.appendChild(container);

  reloadButton.addEventListener('click', () => reload());

  // See this module's own doc comment for why this screen, alone among `src/ui/screens/*.js`, owns a key
  // listener. `defaultView` falls back to the real `window` only when a document genuinely has none (never
  // true for `#ui`'s own document in a browser) — a test's fake document supplies its own fake window instead,
  // so this line never reaches for the global in a test.
  const view =
    /** @type {{addEventListener: Function, removeEventListener: Function} | null | undefined} */ (
      /** @type {any} */ (doc).defaultView
    ) ?? (typeof window === 'undefined' ? null : window);

  /** @param {{code: string, preventDefault: () => void}} event */
  function handleKeydown(event) {
    if (container.hidden) return;
    if (event.code !== 'Enter' && event.code !== 'Space') return;
    // Matches `input.js`'s own reason for calling this on the codes it owns: without it, Space scrolls the
    // page and Enter can re-submit whatever form the browser thinks is nearby — neither of which this screen
    // wants while it is telling the player to press one specific button.
    event.preventDefault();
    reload();
  }

  view?.addEventListener('keydown', handleKeydown);

  return {
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    destroy() {
      view?.removeEventListener('keydown', handleKeydown);
      container.remove();
    },
  };
}

/**
 * The grace period a lost WebGL context gets before this screen decides it is never coming back (tech-lead
 * notes on this ticket; the design question was posted on tracking issue #276 with this default applied — see
 * the PR description for that comment).
 *
 * **Three wall seconds.** A real driver reset or a tab regaining GPU memory restores the context within a
 * frame or two, so this grace period never fires on a loss that was always going to recover — `KI-06-01`'s own
 * recovery path (`session.js`'s `handleContextRestored`) wins that race by a wide margin. Three seconds is
 * also short enough that a child left looking at a dead canvas is not made to wait much past the point a
 * reasonable adult would already have decided something is wrong. Not a `src/core/settings.js` key — that
 * file is untouched by this ticket, and a tunable this narrow (one screen, one failure mode) does not belong
 * in the shared settings object the design lead rules on separately — so it is a named constant here instead,
 * which keeps a future ruling a one-line change rather than a hunt for an inline literal.
 */
export const CONTEXT_LOSS_GRACE_MS = 3000;

/**
 * The renderer seam this screen watches — {@link import('../../render/renderer.js').GameplayRenderer}'s own
 * `onContextLost`/`onContextRestored` (KI-06-01), typed structurally and narrower than the real renderer so a
 * unit test can supply a fake one with nothing else on it.
 *
 * @typedef {object} ContextLossSource
 * @property {(listener: () => void) => () => void} onContextLost
 * @property {(listener: () => void) => () => void} onContextRestored
 */

/**
 * Wire this screen to a renderer's context-loss seam: a loss starts a {@link CONTEXT_LOSS_GRACE_MS} timer, a
 * restore before it fires cancels the timer, and letting it run out shows the screen. This is "the third
 * path" this ticket adds beyond a startup failure — the spec's "if the context does not come back" — and it
 * needs no dedicated `GameState` or `session.js` change: `session.js` already pauses the match on the same
 * two events (KI-06-01), so this only ever decides whether to put the last-resort screen on top of that
 * already-paused, already-frozen picture.
 *
 * `setTimeoutFn`/`clearTimeoutFn` default to `window`'s own (never the bare global — `window` is the only
 * timer-owning object `eslint.config.js` declares for `src/**\/*.js`) and are injectable so
 * `tests/unit/ui/errorScreen.test.js` can prove the whole grace period with a fake clock instead of a real
 * three-second wait (`CLAUDE.md`: e2e tests never sleep, and there is no reason a unit test should either).
 *
 * @param {ContextLossSource} renderer
 * @param {ErrorScreen} screen
 * @param {object} [options]
 * @param {SetTimeoutFn} [options.setTimeoutFn]
 * @param {ClearTimeoutFn} [options.clearTimeoutFn]
 * @returns {() => void} stop watching — unsubscribes from both events and cancels any timer still pending.
 */
export function watchContextLossForErrorScreen(renderer, screen, options = {}) {
  const {
    setTimeoutFn = (callback, ms) => window.setTimeout(callback, ms),
    clearTimeoutFn = (id) => window.clearTimeout(id),
  } = options;

  /** @type {number | null} */
  let timer = null;

  const offLost = renderer.onContextLost(() => {
    // A loss while a previous timer is still running is not a thing the browser does without an intervening
    // restore (`renderer.js`'s own `createContextLossWatcher` de-dupes it already), but guarding here too
    // costs nothing and keeps this function correct even if that ever changes.
    if (timer !== null) clearTimeoutFn(timer);
    timer = setTimeoutFn(() => {
      timer = null;
      screen.show();
    }, CONTEXT_LOSS_GRACE_MS);
  });

  const offRestored = renderer.onContextRestored(() => {
    if (timer === null) return;
    clearTimeoutFn(timer);
    timer = null;
  });

  return () => {
    offLost();
    offRestored();
    if (timer !== null) {
      clearTimeoutFn(timer);
      timer = null;
    }
  };
}
