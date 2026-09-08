// @ts-check
import { PHASES } from '../../core/events.js';
import { REPLAY_ERROR_CODES } from '../../core/replay.js';
import { STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';
import { replay } from '../strings.js';

/**
 * The REPLAY screen (`docs/sprints/improvement-05-replay-capture-and-playback.md` KI-05-03): a paste box or a
 * chosen local file loads a replay (KI-05-01's `parseReplay`, driven by KI-05-02's `replayPlayer.js`), and
 * once one is loaded the same screen becomes the transport — play/pause, step one tick, seek to the start —
 * with a tick readout, all drawn over the arena `session.js` renders behind it (its own "renders it with the
 * existing renderer and HUD").
 *
 * ## The copy is not this file's to write
 *
 * Every player-visible string below — the screen heading, the paste/file labels, the four transport labels,
 * the tick readout's wording and the bad-paste error — is **approved copy**, ruled by the design lead on
 * issue #211 and recorded verbatim in `DESIGN-DECISIONS §3` under "The REPLAY screen", and since KI-20-02 read
 * from the catalogue's `replay` group (`src/ui/strings.js`, imported as `{ replay }`, this screen's own group,
 * never the `STRINGS` aggregate — see that module's own doc comment on why). `REPLAY_COPY` stays exported
 * under its original name, now built from `replay.*`, because `mainMenu.js` (migrated in a later PR),
 * `tests/unit/ui/replay.test.js`, `tests/unit/ui/mainMenu.test.js`, `tests/e2e/offline.spec.js` and
 * `tests/e2e/replay-screen.spec.js` all import it from this path. The screen was built against these strings
 * while they were still proposals, which is exactly why the ruling cost one word — `WATCH IT` became `WATCH`
 * — instead of a rewrite.
 *
 * One piece of the ruling is deliberately **not** built here: the approved key-hint line
 * `SPACE PLAY · . STEP · ← → SCRUB · ESC BACK`, and the transport hotkeys it advertises. See "Keyboard
 * scope" below for why, and issue #234 for the follow-up that adds both together. A hint line promising
 * keys that do nothing would be worse than no hint at all, and splitting it this way is exactly how #182
 * handled the playtest prompt's own key hint.
 *
 * ## The error a bad paste shows is not the parser's diagnostic, verbatim
 *
 * `parseReplay`'s and `createReplayPlayer`'s own module docs are explicit that `error.message` is a
 * *developer* diagnostic, not player copy. {@link describeLoadError} maps every error code this screen can
 * see to one of two approved headings (`REPLAY_COPY.badReplayHeading` for everything ordinary,
 * `REPLAY_COPY.tooNewHeading`/`tooNewDetail` for a future-versioned file specifically) and shows the
 * parser's own message only as the quieter secondary line *beneath* that heading — which is precisely what
 * `DESIGN-DECISIONS §3` rules: "`THAT IS NOT A REPLAY` over the parser's one-sentence reason". The screen
 * stays put and keeps the pasted text, so that second line has somewhere useful to point. The diagnostic is
 * never shown as if it were the approved copy.
 *
 * ## No network, ever
 *
 * A local file is read with the file input's own `File.text()` (a `Promise` over bytes already on disk) —
 * never `fetch`, never a `URL.createObjectURL` round trip. Pasted text and a chosen file both end up as a
 * plain string handed to `parseReplay` through this screen's one `onLoad(text)` callback; nothing here ever
 * issues a request of any kind (`tests/e2e/offline.spec.js` now exercises this screen for exactly that
 * reason — see that file's own module comment).
 *
 * ## Two views sharing one screen, built once
 *
 * `render(props)` toggles which of `loadView`/`playerView` is visible by `props.loaded`, and never rebuilds
 * either — the same "built once, reads props live" discipline `matchSetup.js`/`mainMenu.js` already use, and
 * for a sharper reason here: rebuilding the paste `<textarea>` on every render would wipe out whatever a
 * player had just typed or pasted into it, on the very screen whose AC1 is "pasting rubbish… stays on the
 * screen". `render()` is called only on entering REPLAY and after every load attempt (success or failure) —
 * never once a frame. {@link ReplayScreen.updateProgress} is the separate, cheap, once-a-frame path for the
 * tick readout and the PLAY/PAUSE label while a replay is actually advancing (`ui.js`'s
 * `updateReplayProgress`, called from `session.js`'s new `REPLAY` case in `runUpdate` — this ticket's second
 * declared deviation, see the PR description): it only ever touches a couple of text nodes, never the tree
 * `render()` built.
 *
 * ## Keyboard scope, deliberately smaller than the ruling's key-hint line (issue #234)
 *
 * `input.js` owns every keystroke for the whole app (`ARCHITECTURE §8`) and already double-purposes WASD/the
 * arrow keys as both steering and menu navigation — the same reason `tuning.js`'s own `<textarea>` is
 * `readOnly` and its range/select inputs are mouse-only (that file's own doc comment: "a dedicated hotkey
 * would have to dodge every one of them or risk hijacking normal typing"). This screen's paste box is the
 * first *writable* text input the app has ever had, so the same caution applies harder: `SPACE` must type a
 * space in the paste box, not toggle playback. The ruling has since approved those hotkeys
 * (`SPACE PLAY · . STEP · ← → SCRUB`), and issue #234 adds them together with the hint line that advertises
 * them, so the guard against hijacking the paste box gets built as its own change rather than bolted onto
 * this one. What this build gives a keyboard-only player instead is the same UP/DOWN-to-move,
 * CONFIRM-to-activate, BACK-to-leave model every other grey-box screen already uses (`focus.js`) — full
 * coverage of AC4 (Esc leaves) and mouse-or-keyboard reachability of every button, at zero new risk to the
 * paste box.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */
/** @typedef {import('../../core/replay.js').ReplayError} ReplayError */
/** @typedef {import('../../game/replayPlayer.js').ReplayPlayerError} ReplayPlayerError */

/**
 * Every player-visible string this screen (and, for the main-menu row, `mainMenu.js`) can show, in one block.
 * All of it is **approved copy**, ruled on issue #211 and recorded verbatim in `DESIGN-DECISIONS §3` under
 * "The REPLAY screen". None of it is this file's own invention and none of it may be respelled here — the
 * same rule `scoreboard.js`'s `DRAW_TEXT` carries ("Never invent another spelling").
 *
 * @type {Readonly<{
 *   menuLabel: string,
 *   screenHeading: string,
 *   pasteLabel: string,
 *   pastePlaceholder: string,
 *   watchLabel: string,
 *   openFileLabel: string,
 *   playLabel: string,
 *   pauseLabel: string,
 *   stepLabel: string,
 *   startAgainLabel: string,
 *   endOfReplayText: string,
 *   badReplayHeading: string,
 *   tooNewHeading: string,
 *   tooNewDetail: string,
 * }>}
 */
export const REPLAY_COPY = Object.freeze({
  // The main-menu row this screen is reached from (`mainMenu.js` imports this one).
  menuLabel: replay.menuLabel,
  // This screen's own heading.
  screenHeading: replay.screenHeading,
  pasteLabel: replay.pasteLabel,
  pastePlaceholder: replay.pastePlaceholder,
  // The proposal offered `WATCH IT`; the ruling shortened it to `WATCH`, which also keeps it distinct from
  // the transport's own `PLAY` two rows below.
  watchLabel: replay.watchLabel,
  openFileLabel: replay.openFileLabel,
  playLabel: replay.playLabel,
  // The same button, toggled.
  pauseLabel: replay.pauseLabel,
  stepLabel: replay.stepLabel,
  // This build's concrete "seek": back to tick 0, the one seek target the proposal itself names.
  startAgainLabel: replay.startAgainLabel,
  endOfReplayText: replay.endOfReplayText,
  // Shown for every load failure except an unsupported version (below).
  badReplayHeading: replay.badReplayHeading,
  tooNewHeading: replay.tooNewHeading,
  tooNewDetail: replay.tooNewDetail,
});

/**
 * Formats the tick readout (`DESIGN-DECISIONS §3`'s approved `TICK 137 / 380`; the word "TICK" stays — the
 * ruling kept it because it is the unit the screen exists to show) — a pure function so the
 * format is unit-testable without a DOM. `totalTick` is `null` when it cannot be known yet (nothing loaded);
 * the readout then drops the `/ total` half rather than showing a misleading `/ null`. Delegates to the
 * catalogue's `replay.tickReadout` (`src/ui/strings.js`, byte-identical logic, including both branches) since
 * KI-20-02, kept as its own exported function under this name because `tests/unit/ui/replay.test.js` imports
 * it from this path.
 *
 * @param {number | null} tick
 * @param {number | null} totalTick
 * @returns {string}
 */
export function formatTickReadout(tick, totalTick) {
  return replay.tickReadout(tick, totalTick);
}

/**
 * The last tick a replay's own golden log reaches, or `null` when the log is empty. Every committed fixture's
 * `expectedEvents` carries at least the constructor's opening `FOOD_SPAWNED` events (`replayPlayer.js`'s own
 * module doc, "the event log is seeded before the first advance"), so `null` here means an unusual,
 * essentially empty replay rather than the ordinary case.
 *
 * @param {import('../../core/replay.js').Replay} replay
 * @returns {number | null}
 */
export function replayTotalTick(replay) {
  const events = replay.expectedEvents;
  if (events.length === 0) return null;
  const last = /** @type {{tick?: unknown}} */ (events[events.length - 1]);
  return typeof last.tick === 'number' ? last.tick : null;
}

/**
 * Maps a failed load's error to this screen's two approved line pairs (module doc: "not the parser's
 * diagnostic, verbatim"). `UNSUPPORTED_VERSION` gets the ruling's own friendlier pair — `THIS REPLAY IS TOO
 * NEW` over "It was made by a newer version of the game." — because a future-versioned file is the one
 * failure that is nobody's mistake. Every other code (every other `parseReplay` failure, and
 * `replayPlayer.js`'s own `NO_SEED`) gets the generic heading with the parser's message as the quieter
 * secondary line beneath it, which is what `DESIGN-DECISIONS §3` rules, not a fallback for an unruled case.
 *
 * @param {ReplayError | ReplayPlayerError} error
 * @returns {{heading: string, detail: string}}
 */
export function describeLoadError(error) {
  if (error.code === REPLAY_ERROR_CODES.UNSUPPORTED_VERSION) {
    return { heading: replay.tooNewHeading, detail: replay.tooNewDetail };
  }
  return { heading: replay.badReplayHeading, detail: error.message };
}

/**
 * @typedef {object} ReplayScreenProps
 * @property {(text: string) => void} onLoad - parse and load this raw text, from the paste box or a chosen
 *   file. Never throws (`parseReplay`'s own contract); the screen finds out what happened on the next
 *   `render()`.
 * @property {() => void} onPlayToggle
 * @property {() => void} onStep
 * @property {() => void} onSeekToStart
 * @property {() => void} onBack - Esc (AC4).
 * @property {boolean} loaded - whether a replay is currently loaded; switches the load view for the player
 *   view.
 * @property {ReplayError | ReplayPlayerError | null} error - the last load attempt's *raw* error — this
 *   screen's own `render()` maps it to approved-once-ruled copy via {@link describeLoadError}, so
 *   `session.js` (which builds this prop) never has to import anything from `src/ui/` to hand it over
 *   (`ARCHITECTURE §3`'s game/ui line — see `session.js`'s own doc comment on its `updateReplayProgress`
 *   typedef for the identical reasoning applied to the tick readout). `null` when there is nothing to show,
 *   including "the load succeeded".
 */

/**
 * What {@link ReplayScreen.updateProgress} is called with, once a frame while REPLAY is the active state
 * (`session.js`'s new `runUpdate` case; `ui.js`'s `updateReplayProgress`). Deliberately not routed through
 * `render()` — see the module doc.
 *
 * @typedef {object} ReplayProgress
 * @property {number | null} tick
 * @property {import('../../core/replay.js').Replay | null} replay - the loaded replay itself (or `null`),
 *   so this screen can derive the readout's total (via {@link replayTotalTick}) without `session.js` having
 *   to precompute a ui-shaped number — see `ReplayScreenProps.error`'s own doc comment for the identical
 *   reasoning.
 * @property {import('../../core/events.js').Phase | null} phase
 * @property {boolean} isPlaying
 */

/**
 * @typedef {object} ReplayScreen
 * @property {(props: ReplayScreenProps) => void} render
 * @property {(progress: ReplayProgress) => void} updateProgress
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * Build the REPLAY screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {ReplayScreen}
 */
export function createReplayScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--replay';
  container.dataset.screen = STATES.REPLAY;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel replay-panel';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = replay.screenHeading;
  panel.appendChild(title);

  // --- load view (paste box + local file) --------------------------------------------------------------

  const loadView = doc.createElement('div');
  loadView.className = 'replay-load';

  const pasteLabel = doc.createElement('label');
  pasteLabel.className = 'replay-paste-label';
  pasteLabel.textContent = replay.pasteLabel;
  loadView.appendChild(pasteLabel);

  const textarea = /** @type {HTMLTextAreaElement} */ (doc.createElement('textarea'));
  textarea.className = 'replay-textarea';
  textarea.placeholder = replay.pastePlaceholder;
  // A stable hook for `tests/e2e` and `tests/unit/ui/replay.test.js` — the same discipline `data-screen`
  // uses (tech-lead note on this ticket).
  textarea.dataset.replayPaste = 'true';
  loadView.appendChild(textarea);

  const errorBlock = doc.createElement('div');
  errorBlock.className = 'replay-error';
  errorBlock.hidden = true;
  const errorHeading = doc.createElement('div');
  errorHeading.className = 'replay-error-heading';
  errorBlock.appendChild(errorHeading);
  const errorDetail = doc.createElement('div');
  errorDetail.className = 'replay-error-detail';
  errorBlock.appendChild(errorDetail);
  loadView.appendChild(errorBlock);

  const watchItRow = doc.createElement('div');
  watchItRow.className = 'menu-item menu-item--action';
  watchItRow.textContent = replay.watchLabel;
  loadView.appendChild(watchItRow);

  // Never touches the network (module doc): `change` reads the chosen `File` off this input and hands its
  // own `File.text()` straight to the same `onLoad(text)` the paste box uses — no `fetch`, no object URL.
  const fileInput = /** @type {HTMLInputElement} */ (doc.createElement('input'));
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  fileInput.dataset.replayFileInput = 'true';
  loadView.appendChild(fileInput);

  const openFileRow = doc.createElement('div');
  openFileRow.className = 'menu-item menu-item--action';
  openFileRow.textContent = replay.openFileLabel;
  loadView.appendChild(openFileRow);

  panel.appendChild(loadView);

  // --- player view (transport + tick readout) -----------------------------------------------------------

  const playerView = doc.createElement('div');
  playerView.className = 'replay-player';
  playerView.hidden = true;

  const readout = doc.createElement('div');
  readout.className = 'replay-readout';
  readout.dataset.replayReadout = 'true';
  playerView.appendChild(readout);

  // KI-05-06 (#260): this line's box is **reserved whether or not it is showing**, via
  // `.replay-end--placeholder` rather than the `hidden` attribute. `END OF REPLAY` appears the instant the
  // replay finishes, and when it did so by going from `display: none` to a real box it grew the panel by its
  // own height plus the flex gap — which, in a vertically centred panel, moved every transport row below it
  // down by half that. Measured at 14 px: `PAUSE` sat at y 326.5 on the frame before the last tick and y
  // 340.5 on the frame after. A player reaching for PAUSE or STEP has the button move under the cursor at
  // exactly the moment they are most likely to be reaching for it, so this is a real defect and not only a
  // test's problem. Keeping the box always means the panel's height never changes and the rows never move.
  const endOfReplay = doc.createElement('div');
  endOfReplay.className = 'replay-end replay-end--placeholder';
  endOfReplay.textContent = replay.endOfReplayText;
  endOfReplay.dataset.replayEnd = 'true';
  playerView.appendChild(endOfReplay);

  const playRow = doc.createElement('div');
  playRow.className = 'menu-item menu-item--action';
  playRow.textContent = replay.playLabel;
  // KI-05-06 (#260): a stable handle that does not change when the label does. This row's text flips between
  // PLAY and PAUSE, and a locator written as `.menu-item` filtered by the text `PAUSE` stops matching
  // anything the moment the replay ends and the label flips back — which is how #260 burned a full 30-second
  // timeout rather than failing in a way that named the cause.
  playRow.dataset.replayToggle = 'true';
  playerView.appendChild(playRow);

  const stepRow = doc.createElement('div');
  stepRow.className = 'menu-item menu-item--action';
  stepRow.textContent = replay.stepLabel;
  playerView.appendChild(stepRow);

  const startAgainRow = doc.createElement('div');
  startAgainRow.className = 'menu-item menu-item--action';
  startAgainRow.textContent = replay.startAgainLabel;
  playerView.appendChild(startAgainRow);

  panel.appendChild(playerView);

  container.appendChild(panel);
  root.appendChild(container);

  /** @type {ReplayScreenProps} */
  let props = {
    onLoad: () => {},
    onPlayToggle: () => {},
    onStep: () => {},
    onSeekToStart: () => {},
    onBack: () => {},
    loaded: false,
    error: null,
  };

  // One shared focus model, per the module doc's keyboard-scope note — its item list is swapped between the
  // two views (`setItems`, same idiom `focus.js`'s own doc comment describes) rather than built twice, so
  // UP/DOWN/CONFIRM/BACK behave identically whichever view is up.
  const focus = createFocusModel({ onBack: () => props.onBack() });

  /** The rows {@link focus} currently holds — one of the two disjoint sets below, swapped by {@link wireRows}
   * on every `render()`. @type {HTMLElement[]} */
  let focusRows = [];

  function updateFocusClasses() {
    const focused = focus.getIndex();
    focusRows.forEach((row, i) => row.classList.toggle('menu-item--focused', i === focused));
  }

  /**
   * Swaps which rows {@link focus} navigates, without touching a single DOM listener — those are attached
   * once, below, by {@link attachRowHandlers}, and look their own row up in {@link focusRows} at the moment
   * of the event rather than capturing an index that would go stale the next time this function runs. A
   * `render()` call is not rare here the way it is on `mainMenu.js`/`pause.js` (every load attempt re-renders
   * this screen — module doc), so re-`addEventListener`-ing on every call would pile up a duplicate listener
   * per attempt; this keeps "built once" true for the *listeners* while still letting the *item list* change.
   *
   * @param {HTMLElement[]} rows
   * @param {(() => void)[]} handlers
   */
  function wireRows(rows, handlers) {
    focus.setItems(handlers.map((onSelect) => ({ onSelect })));
    focusRows = rows;
    updateFocusClasses();
  }

  /** @param {HTMLElement} row */
  function attachRowHandlers(row) {
    row.addEventListener('mouseenter', () => {
      const index = focusRows.indexOf(row);
      if (index === -1) return;
      focus.setIndex(index);
      updateFocusClasses();
    });
    row.addEventListener('click', () => {
      const index = focusRows.indexOf(row);
      if (index === -1) return;
      focus.setIndex(index);
      focus.select();
      updateFocusClasses();
    });
  }

  for (const row of [watchItRow, openFileRow, playRow, stepRow, startAgainRow]) {
    attachRowHandlers(row);
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // lets the same file be chosen again after a failed load
    if (file === undefined || file === null) return;
    file.text().then((text) => props.onLoad(text));
  });

  return {
    render(nextProps) {
      props = nextProps;

      loadView.hidden = props.loaded;
      playerView.hidden = !props.loaded;

      if (props.error !== null) {
        const described = describeLoadError(props.error);
        errorBlock.hidden = false;
        errorHeading.textContent = described.heading;
        errorDetail.textContent = described.detail;
      } else {
        errorBlock.hidden = true;
        errorHeading.textContent = '';
        errorDetail.textContent = '';
      }

      // A fresh, error-free view of the load screen (entering REPLAY for the first time, or after leaving
      // and coming back with nothing loaded) starts from a clean box — never on top of a failed attempt's
      // own text, which AC1 asks to keep exactly as pasted.
      if (!props.loaded && props.error === null) {
        textarea.value = '';
      }

      wireRows(
        props.loaded ? [playRow, stepRow, startAgainRow] : [watchItRow, openFileRow],
        props.loaded
          ? [() => props.onPlayToggle(), () => props.onStep(), () => props.onSeekToStart()]
          : [() => props.onLoad(textarea.value), () => fileInput.click()],
      );
    },
    updateProgress(progress) {
      const totalTick = progress.replay === null ? null : replayTotalTick(progress.replay);
      readout.textContent = formatTickReadout(progress.tick, totalTick);
      playRow.textContent = progress.isPlaying ? replay.pauseLabel : replay.playLabel;
      // KI-05-06 (#260): toggles *visibility*, never the box. `--placeholder` keeps the line's height and
      // leaves the text invisible and out of the accessibility tree; dropping it reveals the same box. See
      // this element's own note above for why its box must never come and go.
      endOfReplay.classList.toggle(
        'replay-end--placeholder',
        progress.phase === null || progress.phase === PHASES.PLAYING,
      );
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
