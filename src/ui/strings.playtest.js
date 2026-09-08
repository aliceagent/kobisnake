// @ts-check
import { deepFreeze } from './deepFreeze.js';

/**
 * The playtest-capture screen's copy — the second half of the string catalogue, kept in its own module for a
 * bundling reason (#317, KI-20-06). Everything else lives in `strings.js`; the approved/unapproved convention,
 * and why each group is a `/*#__PURE__*\/`-annotated export, are documented there.
 *
 * **Why this is a separate file.** `playtestPrompt.js` is the one screen that is itself a dynamic-import
 * boundary (KI-11-05, #158), so its strings must never reach the entry chunk a plain load downloads. KI-20-05
 * made each group its own tree-shakeable export, which is enough while every importer sits in one Rollup root.
 * It is not enough here: the moment the dynamic screen imports the *same file* six entry-reachable screens
 * import, that file is reachable from two roots at once, Rollup emits it as a shared chunk holding every group
 * either root touches, and Vite `modulepreload`s that chunk — so a plain load fetches the playtest copy after
 * all. Splitting the catalogue exactly where the bundle is split, and nowhere else, is what keeps both true.
 *
 * So: **`playtestPrompt.js` imports from here and never from `strings.js`, and `strings.js` never imports from
 * here.** There is deliberately no static edge between the two halves in either direction — the shared
 * `deepFreeze.js` carries no copy and is the only thing they have in common. `tests/unit/ui/strings.test.js`
 * imports both halves and checks them as one catalogue, which is where the two are held to the same rules.
 */
/**
 * `playtestPrompt` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const playtestPrompt = /*#__PURE__*/ deepFreeze({
  // APPROVED — DESIGN-DECISIONS §3, "The playtest prompt's key hint" (issue #182). Byte-identical to
  // `playtestPrompt.js`'s exported `PROMPT_HINT_LINE`.
  hintLine: '← → CHOOSE · ENTER ANSWER · ESC SKIP',
  /** UNAPPROVED — KI-11-02 (`playtestPrompt.js`'s `playerEl.textContent`). @param {1 | 2} player @returns {string} */
  playerLabel(player) {
    return `P${player}`;
  },
  // UNAPPROVED — KI-11-03 (`playtestPrompt.js`'s `exportButton.textContent`).
  exportButton: 'Export session',
  // UNAPPROVED — KI-11-03 (`playtestPrompt.js`'s clipboard-success status text).
  copied: 'Copied!',
  // UNAPPROVED — KI-11-03 (`playtestPrompt.js`'s no-clipboard status text).
  clipboardUnavailable: 'Clipboard unavailable — copy the text below',
  // UNAPPROVED — KI-11-03 (`playtestPrompt.js`'s denied-clipboard status text).
  clipboardBlocked: 'Clipboard blocked — copy the text below',
  // UNAPPROVED — KI-11-03 (`playtestPrompt.js`'s `exportDownloadLink.textContent`).
  downloadSessionFile: 'Download session file',
});

/** The playtest half of the catalogue, as one object — the counterpart to `strings.js`'s `STRINGS`. */
export const PLAYTEST_STRINGS = /*#__PURE__*/ deepFreeze({ playtestPrompt });
