// @ts-check

/**
 * KI-20-01 (`docs/sprints/improvement-20-string-catalogue.md`, tracking #212, ticket #249): every user-visible
 * string the game renders, in one frozen object graph, keyed by screen and purpose — exported both as one
 * `STRINGS` aggregate and as one frozen const per screen group, for the bundling reason set out below. This module is the catalogue
 * only — **no screen imports it yet**. Wiring every screen to read from here is KI-20-02, a separate ticket;
 * until it lands, a key with no call site anywhere else in `src/ui` is expected and correct, not dead code.
 *
 * ## Approved vs. unapproved — how to tell, as a reader or as a test
 *
 * Every entry below carries one of two comment tags directly above it:
 *
 * - `// APPROVED — DESIGN-DECISIONS §3` — the design lead has ruled on this exact sentence and it is recorded,
 *   character for character, in `docs/design/DESIGN-DECISIONS.md` §3 ("Visual notes for un-illustrated
 *   screens"). {@link APPROVED_KEYS} lists the dot-path of every such entry, so a test can walk the set rather
 *   than grep comments — `tests/unit/ui/strings.test.js`'s AC1 test parses §3 itself and asserts every string
 *   it finds there is reachable through one of these keys, character for character.
 * - `// UNAPPROVED — <where it came from>` — this is **exactly what the screen renders today**, transcribed
 *   without a single character changed, re-punctuated or re-cased, and annotated with the ticket or issue that
 *   put it there (or "no ticket reference found in the source", where the screen's own comments do not name
 *   one). Most of what is on screen is unapproved by this definition — §3 covers a first pass of copy, not
 *   the whole game — and that is expected. **Nobody may improve, normalise or re-word an unapproved string in
 *   this file.** The design lead rules on wording; this ticket only collects it.
 *
 * A few entries are marked `// APPROVED — DESIGN-DECISIONS §1 row 27` instead. That is a real design-lead
 * ruling too, but it lives in a different section of the document, and this ticket's AC1 test — by its own
 * spec — parses only §3. Those entries are approved copy that {@link APPROVED_KEYS} and the AC1 test do not
 * (and are not asked to) verify; see the test file's own module comment for why.
 *
 * ## One deliberate contradiction between this file and the code (tracked on #212)
 *
 * §3's colour-safe pairing note bullet approves, verbatim: `Try TEAL for PLAYER 2.` — capital `PLAYER`,
 * because (§3's own words) "PLAYER is capitalised because the controls card on the same screen spells it so."
 * `src/ui/screens/matchSetup.js`'s `COLOUR_NOTE_COPY.suggestion` (line 255 at the time of writing) renders
 * `` `Try ${colorName.toUpperCase()} for player 2.` `` — lower-case `player`, and with the player number
 * hard-coded to `2` rather than taken as a parameter. `matchSetup.colourNote.suggestion` below transcribes
 * §3's approved form (capital `PLAYER`, and the player number computed rather than literal — §3 is explicit
 * that "the colour word and the player number are computed, never literals"), **not** what `matchSetup.js`
 * currently outputs. This is deliberate: AC1 is a parity test against §3, and `matchSetup.js` is outside this
 * ticket's `Files:` list — the discrepancy is already reported on #212 for the design lead to rule on, and
 * fixing it is not this ticket's job.
 *
 * ## Three strings approved here that no screen renders yet
 *
 * - `scoreboard.thirdDrawMatchOver` — `THIRD DRAW — MATCH OVER` (§3, issue #150). `scoreboard.js`'s
 *   `buildScoreboardLines` does not have a third-consecutive-draw branch at all yet (its own comment calls
 *   this out as a known gap, "left as is until the design lead rules on it"); wiring it is #150's job.
 * - `replay.keyHint` — `SPACE PLAY · . STEP · ← → SCRUB · ESC BACK` (§3). Approved, but `replay.js`'s own
 *   module comment explains why it is deliberately not built yet: the transport hotkeys it advertises do not
 *   exist until issue #234 adds both together, and a hint line promising keys that do nothing would be worse
 *   than none.
 * - `tutorial.skipHint` — `SKIP (Esc)` (§3, "Tutorial (image 17)"). There is no Tutorial screen module at all
 *   yet (Sprint 15's job); this is the one line of its copy the design lead has already ruled on, with nowhere
 *   to live until that screen exists.
 *
 * ## Why this is thirteen exports and not one object (KI-20-05, #258)
 *
 * Each screen group is its own top-level `export const`, annotated `/*#__PURE__*\/`, and the `STRINGS`
 * aggregate below is assembled from them. **A screen imports its group — never the aggregate.** That is not a
 * style preference; it is what keeps `KI-11-05`'s chunk split intact.
 *
 * KI-11-05 (#158) requires the playtest modules to be dynamically imported so their strings never reach the
 * entry chunk every player downloads, and `tests/e2e/playtest-bundle.spec.js` enforces it by asserting the
 * entry chunk contains none of `Find your head`, `Buffered turns`, `kobisnake-playtest-session`, `CHOOSE`.
 * `playtestPrompt.hintLine` is one of those strings and it lives here. Rollup cannot tree-shake individual
 * properties out of one object literal, so the first version of this file — a single `STRINGS` object — put
 * the entire catalogue, playtest copy included, into the entry chunk the moment any entry-reachable screen
 * imported it. Measured on the real build: one screen migrated to `import { STRINGS }` → `CHOOSE` in the
 * entry chunk; the same screen using `import { howToPlay }` → not there.
 *
 * Both halves are load-bearing, and each was measured separately:
 * - **Separate named exports**, so Rollup can drop the groups a chunk does not use. Importing the aggregate
 *   defeats this completely — it references every group, so every group is retained.
 * - **The `/*#__PURE__*\/` annotation**, because Rollup treats a bare `deepFreeze(...)` call as possibly
 *   side-effectful and keeps it regardless of whether anything reads the result.
 *
 * `tests/unit/ui/strings.test.js` guards all three facts (per-group exports, the annotation, and no `src/ui`
 * module importing the aggregate); KI-11-05's own e2e proves the bundle itself.
 *
 * ## Formatting logic
 *
 * Every parameterised entry (a function rather than a plain string) reproduces the singular/plural, casing and
 * template logic the live screen module uses today, byte for byte — `matchSetup.controlsCard` mirrors
 * `matchSetup.js`'s `controlsCardLabel`, `scoreboard.winCount`/`moreWins` mirror `scoreboard.js`'s own
 * same-named helpers, `matchOver.keysEarned` mirrors `matchOver.js`'s inline `${keys} KEY${keys === 1 ? '' :
 * 'S'} EARNED`, and so on — so that KI-20-02's later migration is provably a no-op on every rendered pixel.
 * Where a screen composes a live value (a colour name, a player number, a tick count), that stays a parameter
 * here too; it is never baked in as a literal.
 *
 * ## What this catalogue does not include, on purpose
 *
 * A few pieces of on-screen text are excluded, and are not an oversight:
 * - Values that are data, not copy, and live outside `src/ui` — the playtest question bank's own sentences
 *   (`src/qa/playtestQuestions.js`), `matchSetup.js`'s music-track labelling (depends on `MUSIC_TRACKS`'
 *   ordering in that file), and `tuning.js`'s tunable-slider labels/preset button text (`src/game/tuning.js`).
 *   Reproducing their formatting here would mean importing production logic from outside `src/ui` into a
 *   strings-only module, or re-deriving it and risking drift — worse than leaving it where it already lives.
 * - CSS custom properties and hex colours: never copy, and `CLAUDE.md`'s own never-list keeps hex colours out
 *   of every file but `src/render/materials.js` and `src/ui/styles.css` regardless.
 */

/** @param {string} name @returns {string} */
function capitalize(name) {
  return name.length === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/** @param {number} n @returns {string} "1 win" | "2 wins" */
function winCount(n) {
  return `${n} win${n === 1 ? '' : 's'}`;
}

/** @param {number} n @returns {string} "1 more win" | "2 more wins" */
function moreWins(n) {
  return `${n} more win${n === 1 ? '' : 's'}`;
}

/**
 * `menu` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const menu = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — no ticket reference found in the source (`src/ui/screens/mainMenu.js`); the on-screen title.
  title: 'KOBI SNAKE',
  // APPROVED — DESIGN-DECISIONS §3, "Under the title on the main menu".
  description: 'Two players, one keyboard. Eat apples, grow long, and make the other snake crash.',
  // UNAPPROVED — KS-05-04 (`mainMenu.js`'s `MENU_ITEMS`); permanently disabled this sprint.
  item1Player: '1 PLAYER',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" bullet (`` `2 PLAYERS` `` next to `REPLAY`/`HOW TO PLAY`).
  item2Players: '2 PLAYERS',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" bullet (`` `HOW TO PLAY` ``).
  itemHowToPlay: 'HOW TO PLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" bullet (`` `REPLAY` `` as the menu row).
  itemReplay: 'REPLAY',
  // UNAPPROVED — KS-05-04 (`mainMenu.js`'s `MENU_ITEMS`); disabled until Sprint 15.
  itemPractice: 'PRACTICE',
  // UNAPPROVED — KS-05-04 (`mainMenu.js`'s `MENU_ITEMS`); disabled until Sprint 15.
  itemTutorial: 'TUTORIAL',
  // UNAPPROVED — KS-05-04 (`mainMenu.js`'s `MENU_ITEMS`); disabled until Sprint 14.
  itemShop: 'SHOP',
  // UNAPPROVED — KS-05-04 (`mainMenu.js`'s `MENU_ITEMS`); disabled until Sprint 12.
  itemSettings: 'SETTINGS',
  // APPROVED — DESIGN-DECISIONS §3, "Items that are not ready keep the existing \"COMING SOON\"."
  comingSoonTag: 'COMING SOON',
});

/**
 * `howToPlay` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const howToPlay = /*#__PURE__*/ deepFreeze({
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" bullet (`` `HOW TO PLAY` ``); same panel heading.
  title: 'HOW TO PLAY',
  // APPROVED — DESIGN-DECISIONS §3, "First-minute copy" / "HOW TO PLAY panel", all four lines, in order.
  lines: [
    'Eat apples to grow longer.',
    "Don't hit a wall, yourself, or the other snake.",
    'After 30 seconds the lasers close in.',
    'The last snake alive wins the round.',
  ],
});

/**
 * `matchSetup` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const matchSetup = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — KS-05-04 (`matchSetup.js`); the screen heading.
  title: 'MATCH SETUP',
  // UNAPPROVED — KS-05-04 (`matchSetup.js`'s `buildRow('MATCH LENGTH')`).
  matchLengthLabel: 'MATCH LENGTH',
  /**
   * UNAPPROVED — KS-05-04 (`matchSetup.js`'s `renderValues`: `` `BEST OF ${matchSettings.bestOf}` ``).
   * @param {number} bestOf @returns {string}
   */
  matchLengthValue(bestOf) {
    return `BEST OF ${bestOf}`;
  },
  // UNAPPROVED — KS-05-04 (`matchSetup.js`'s `buildRow('POWER-UPS')`).
  powerUpsLabel: 'POWER-UPS',
  /** UNAPPROVED — KS-05-04 (`matchSetup.js`'s `renderValues`). @param {boolean} on @returns {string} */
  powerUpsValue(on) {
    return on ? 'ON' : 'OFF';
  },
  // UNAPPROVED — KS-05-04 (`matchSetup.js`'s `buildRow('MUSIC')`).
  musicLabel: 'MUSIC',
  /**
   * UNAPPROVED — KI-12-04 (`matchSetup.js`'s `playerKindRowLabel`); flagged as a question on #210, not yet
   * ruled on (row 27 approves this row's *value*, not this left-hand label — see `playerKindValue` below).
   * @param {1 | 2} player @returns {string}
   */
  playerKindRowLabel(player) {
    return `PLAYER ${player}`;
  },
  /**
   * DESIGN-DECISIONS §1 row 27 (not §3; outside this ticket's AC1 parser — see the module doc comment
   * above). `matchSetup.js`'s `playerKindLabel`, byte-identical.
   * @param {'HUMAN' | string} kind @returns {string}
   */
  // APPROVED — DESIGN-DECISIONS §1 row 27
  playerKindValue(kind) {
    return kind === 'HUMAN' ? 'HUMAN' : `CPU ${kind}`;
  },
  /**
   * UNAPPROVED — KS-05-04 (`matchSetup.js`'s `buildRow('PLAYER 1 COLOUR')` / `buildRow('PLAYER 2 COLOUR')`).
   * @param {1 | 2} player @returns {string}
   */
  playerColourRowLabel(player) {
    return `PLAYER ${player} COLOUR`;
  },
  /** UNAPPROVED — KS-05-04 (`matchSetup.js`'s `renderValues`). @param {string} colorName @returns {string} */
  playerColourValue(colorName) {
    return capitalize(colorName).toUpperCase();
  },
  /**
   * The controls card, base (non-CPU) form — DESIGN-DECISIONS §3, "Controls card on match setup":
   * `controlsCard(1, 'red')` === `'PLAYER 1 · RED — W A S D'`, `controlsCard(2, 'blue')` ===
   * `'PLAYER 2 · BLUE — ARROW KEYS'`. The `isCpu` branch (the literal `'CPU'` in place of a key list) is
   * KI-12-04's own addition and is **not** itself recorded in §3 — see that ticket's own module comment in
   * `matchSetup.js`. Byte-identical to `matchSetup.js`'s `controlsCardLabel`.
   * @param {1 | 2} player @param {string} colorName @param {boolean} [isCpu] @returns {string}
   */
  // APPROVED — DESIGN-DECISIONS §3
  controlsCard(player, colorName, isCpu = false) {
    const keys = isCpu ? 'CPU' : player === 1 ? 'W A S D' : 'ARROW KEYS';
    return `PLAYER ${player} · ${colorName.toUpperCase()} — ${keys}`;
  },
  colourNote: {
    // APPROVED — DESIGN-DECISIONS §3, "The colour-safe pairing note on match setup" (KI-15-02), first line.
    note: 'These two colours look alike to some players.',
    /**
     * §3's form — DESIGN-DECISIONS §3, "The colour-safe pairing note on match setup" (KI-15-02), second
     * line: `Try TEAL for PLAYER 2.`, capital `PLAYER`, with both the colour word and the player number
     * computed. See this file's own module doc comment ("One deliberate contradiction...") for why this
     * differs from what `matchSetup.js` currently renders (lower-case `player`, hard-coded `2`) — #212.
     * @param {string} colorName @param {1 | 2} player @returns {string}
     */
    // APPROVED — DESIGN-DECISIONS §3
    suggestion(colorName, player) {
      return `Try ${colorName.toUpperCase()} for PLAYER ${player}.`;
    },
  },
  // UNAPPROVED — KS-05-04 (`matchSetup.js`'s `startRow.textContent`).
  startMatch: 'START MATCH',
});

/**
 * `matchOver` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const matchOver = /*#__PURE__*/ deepFreeze({
  // APPROVED — DESIGN-DECISIONS §3, "A match that ends level".
  tie: "IT'S A TIE",
  /** UNAPPROVED — KS-05-04 (`matchOver.js`'s `renderText`). @param {string} colorName @returns {string} */
  winner(colorName) {
    return `${capitalize(colorName).toUpperCase()} WINS THE MATCH`;
  },
  /**
   * UNAPPROVED — KS-05-04 (`matchOver.js`'s `renderText`: `` `BEST OF ${bestOf} — ${wins[1]}-${wins[2]}` ``).
   * @param {number} bestOf @param {number} p1Wins @param {number} p2Wins @returns {string}
   */
  scoreLine(bestOf, p1Wins, p2Wins) {
    return `BEST OF ${bestOf} — ${p1Wins}-${p2Wins}`;
  },
  /**
   * UNAPPROVED — KS-05-04 (`matchOver.js`'s `renderText`: `` `${keys} KEY${keys === 1 ? '' : 'S'} EARNED` ``).
   * @param {number} n @returns {string}
   */
  keysEarned(n) {
    return `${n} KEY${n === 1 ? '' : 'S'} EARNED`;
  },
  // UNAPPROVED — KS-05-04 (`matchOver.js`'s `rematchRow.textContent`).
  rematch: 'REMATCH',
  // UNAPPROVED — KS-05-04 (`matchOver.js`'s `menuRow.textContent`).
  mainMenu: 'MAIN MENU',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" bullet (`` `WATCH LAST ROUND` ``), issue #211/#222.
  watchLastRound: 'WATCH LAST ROUND',
});

/**
 * `scoreboard` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const scoreboard = /*#__PURE__*/ deepFreeze({
  /**
   * UNAPPROVED — KS-05-04 (`scoreboard.js`'s `buildScoreboardLines`). @param {number} bestOf @returns {string}
   */
  bestOfLine(bestOf) {
    return `BEST OF ${bestOf}`;
  },
  /** UNAPPROVED — KS-05-04 (`scoreboard.js`'s own `winCount`, byte-identical). @param {number} n @returns {string} */
  winCount,
  /** UNAPPROVED — KS-05-04 (`scoreboard.js`'s own `moreWins`, byte-identical). @param {number} n @returns {string} */
  moreWins,
  /**
   * UNAPPROVED — KS-05-04 (`scoreboard.js`'s `buildScoreboardLines`: `` `${capitalize(colorNames[n])}: ${winCount(wins[n])}` ``).
   * @param {string} colorName @param {number} n @returns {string}
   */
  colorWinLine(colorName, n) {
    return `${capitalize(colorName)}: ${winCount(n)}`;
  },
  /**
   * UNAPPROVED — KS-05-04 (`scoreboard.js`'s `buildScoreboardLines`, the winner-needs line).
   * @param {string} colorName @param {number} n @returns {string}
   */
  decisiveLine(colorName, n) {
    return `${capitalize(colorName)} needs ${moreWins(n)}`;
  },
  // APPROVED — DESIGN-DECISIONS §3, "The scoreboard on the third consecutive draw" ("the ordinary draw keeps
  // \"DRAW — REPLAY\""). Byte-identical to `scoreboard.js`'s exported `DRAW_TEXT`.
  drawReplay: 'DRAW — REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, same bullet, contains the approved fragment "one more and the match is
  // called" verbatim. Byte-identical to `scoreboard.js`'s exported `DRAW_WARNING_TEXT`.
  drawWarning: 'DRAW — REPLAY · one more and the match is called',
  // APPROVED, currently unwired — DESIGN-DECISIONS §3, "The scoreboard on the third consecutive draw"
  // (issue #150). `scoreboard.js`'s `buildScoreboardLines` has no third-draw branch yet (its own comment
  // calls this a known gap); this string has nowhere to be rendered from until #150 lands.
  thirdDrawMatchOver: 'THIRD DRAW — MATCH OVER',
});

/**
 * `pause` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const pause = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — KS-06-00 (`pause.js`'s `title.textContent`).
  title: 'PAUSED',
  // UNAPPROVED — KS-06-00 (`pause.js`'s `resumeRow.textContent`).
  resume: 'RESUME',
  // UNAPPROVED — KS-06-00 (`pause.js`'s `restartRow.textContent`).
  restartMatch: 'RESTART MATCH',
  // UNAPPROVED — KS-06-00 (`pause.js`'s `menuRow.textContent`).
  quitToMenu: 'QUIT TO MENU',
});

/**
 * `countdown` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const countdown = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — KS-05-04 (`countdown.js`'s `CountdownProps.label`); the four round-start values, in order.
  numbers: ['3', '2', '1', 'GO'],
  // UNAPPROVED — DESIGN-DECISIONS §2.8 (`countdown.js`'s own doc comment); the post-pause beat.
  ready: 'READY?',
});

/**
 * `replay` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const replay = /*#__PURE__*/ deepFreeze({
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" (issue #211); the main-menu row this screen is
  // reached from. Byte-identical to `replay.js`'s exported `REPLAY_COPY.menuLabel`.
  menuLabel: 'REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen"; this screen's own heading.
  screenHeading: 'REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  pasteLabel: 'PASTE A REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  pastePlaceholder: 'Paste the replay text here.',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen" (the ruling shortened the proposal's `WATCH IT` to
  // `WATCH` — `replay.js`'s own module comment).
  watchLabel: 'WATCH',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  openFileLabel: 'OPEN A FILE',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  playLabel: 'PLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen"; the same transport button, toggled.
  pauseLabel: 'PAUSE',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  stepLabel: 'STEP',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen"; the concrete "seek" — back to tick 0.
  startAgainLabel: 'START AGAIN',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  endOfReplayText: 'END OF REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen"; shown for every load failure except an
  // unsupported version.
  badReplayHeading: 'THAT IS NOT A REPLAY',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen"; an unsupported (future) replay version.
  tooNewHeading: 'THIS REPLAY IS TOO NEW',
  // APPROVED — DESIGN-DECISIONS §3, "The REPLAY screen".
  tooNewDetail: 'It was made by a newer version of the game.',
  // APPROVED, currently unwired — DESIGN-DECISIONS §3, "The REPLAY screen" (issue #234). `replay.js`'s own
  // module comment: the hotkeys this hint advertises do not exist yet, and #234 adds both together.
  keyHint: 'SPACE PLAY · . STEP · ← → SCRUB · ESC BACK',
  /**
   * DESIGN-DECISIONS §3, "The REPLAY screen": `` `TICK 137 / 380` ``, "the word stays — it is the unit the
   * screen exists to show". Byte-identical to `replay.js`'s exported `formatTickReadout`, including its
   * `totalTick === null` branch (dropping the `/ total` half) — that branch's *output* is not itself quoted
   * in §3, only the two-number form is (marked unapproved in that one branch, below).
   * @param {number | null} tick @param {number | null} totalTick @returns {string}
   */
  // APPROVED — DESIGN-DECISIONS §3
  tickReadout(tick, totalTick) {
    if (tick === null) return ''; // UNAPPROVED branch — not covered by §3's quoted example.
    const prefix = `TICK ${tick}`;
    // UNAPPROVED branch (`totalTick === null`) — not covered by §3's quoted example; the two-number form
    // below (`totalTick` known) is the one §3 quotes.
    return totalTick === null ? prefix : `${prefix} / ${totalTick}`;
  },
});

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

/**
 * `hud` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const hud = /*#__PURE__*/ deepFreeze({
  /**
   * UNAPPROVED — KS-03-05 (`hud.js`'s `setLengths`: `` `P1 ${p1Length}` `` / `` `P2 ${p2Length}` ``).
   * The ticket's own example name (`hud.length(n)`) generalises here to a `player` parameter too — the HUD
   * shows one length pill per player, and the `P1`/`P2` prefix is part of the same computed text, not a
   * separate label the panel carries on its own.
   * @param {1 | 2} player @param {number} n @returns {string}
   */
  length(player, n) {
    return `P${player} ${n}`;
  },
  // UNAPPROVED — KS-03-05 (`hud.js`'s `timer.textContent`, before the first `setTime` call).
  timerInitial: '0:00',
  // UNAPPROVED — KS-04-03 (`hud.js`'s exported `LASER_WARNING_TEXT`; image `05-laser-closing-phase.png`).
  laserWarning: 'LASERS CLOSING!',
  // UNAPPROVED — KS-06-02 (`hud.js`'s `POWERUP_TAG_COPY.SPEED.label`; built from `13-gameplay-hud.png`).
  powerUpSpeedLabel: 'SPEED BOOST',
  // UNAPPROVED — KS-06-02 (`hud.js`'s `POWERUP_TAG_COPY.SLOW.label`; the ticket's own wording).
  powerUpSlowLabel: 'SLOWED',
  /** UNAPPROVED — KS-06-02 (`hud.js`'s `element.seconds.textContent`). @param {number} n @returns {string} */
  powerUpSeconds(n) {
    return `${n}s`;
  },
  // UNAPPROVED — KS-06-02 (`hud.js`'s `POWERUP_TAG_COPY.SPEED.icon`).
  powerUpIconSpeed: '⚡',
  // UNAPPROVED — KS-06-02 (`hud.js`'s `POWERUP_TAG_COPY.SLOW.icon`).
  powerUpIconSlow: '❄',
  // APPROVED — DESIGN-DECISIONS §3, "Below-minimum note" (KI-16-03, issue #248). Byte-identical to
  // `hud.js`'s exported `MIN_SIZE_NOTE_TEXT`.
  minSizeNote: 'MAKE THE WINDOW BIGGER',
});

/**
 * `tuning` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const tuning = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — KS-07-01 (`tuning.js`'s `slowModeLabel.textContent`); dev-only, `?tuning=1`.
  slowTargetLabel: 'SLOW target',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s `presetGroup('Laser start', ...)`); dev-only, `?tuning=1`.
  presetLaserStart: 'Laser start',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s `presetGroup('Laser step', ...)`); dev-only, `?tuning=1`.
  presetLaserStep: 'Laser step',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s `presetGroup('Speed Boost', ...)`); dev-only, `?tuning=1`.
  presetSpeedBoost: 'Speed Boost',
  // UNAPPROVED — KI-04-03 (`tuning.js`'s `presetGroup('Pacing', ...)`); dev-only, `?tuning=1`.
  presetPacing: 'Pacing',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s `copyButton.textContent`); dev-only, `?tuning=1`.
  copyReplayButton: 'Copy replay',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s clipboard-success status text); dev-only, `?tuning=1`.
  copied: 'Copied!',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s no-clipboard status text); dev-only, `?tuning=1`.
  clipboardUnavailable: 'Clipboard unavailable — copy the text below',
  // UNAPPROVED — KS-07-01 (`tuning.js`'s denied-clipboard status text); dev-only, `?tuning=1`.
  clipboardBlocked: 'Clipboard blocked — copy the text below',
  /**
   * UNAPPROVED — KS-07-01 (`tuning.js`'s `renderCollapsed`); dev-only, `?tuning=1`.
   * @param {boolean} collapsed @returns {string}
   */
  foldHeader(collapsed) {
    return collapsed ? '▸ TUNING' : '▾ TUNING';
  },
  /** UNAPPROVED — KS-07-01 (`tuning.js`'s preset button text, laser presets); dev-only, `?tuning=1`.
   * @param {number} seconds @returns {string} */
  presetSeconds(seconds) {
    return `${seconds}s`;
  },
});

/**
 * `tutorial` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 */
export const tutorial = /*#__PURE__*/ deepFreeze({
  // APPROVED, currently unwired — DESIGN-DECISIONS §3, "Tutorial (image 17)": `"SKIP (Esc)" bottom-right at
  // 60 % opacity.` There is no Tutorial screen module yet (Sprint 15's job); this is the one ruled line of
  // its copy, with nowhere to live until that screen exists.
  skipHint: 'SKIP (Esc)',
});

/**
 * `error` — see this module's doc comment for the approved/unapproved convention, and for why each group
 * is its own `/*#__PURE__*\/`-annotated export rather than a property of one object.
 *
 * KI-06-02 (`docs/sprints/improvement-06-resilience-and-recovery.md`): the last-resort screen
 * (`src/ui/screens/error.js`), shown when WebGL was never available, a lost context never comes back, or
 * something threw during startup. Every entry is a first draft transcribed for the design lead to rule on —
 * see this module's own doc comment's "Approved vs. unapproved" section — written to the ticket's own spec:
 * "in words an eleven-year-old can act on, not a stack trace", with no `WebGL`, `context`, `GPU`, `Error`,
 * stack or error code anywhere in it. `tests/unit/ui/strings.test.js`'s "KI-06-02 AC3" describe block is the
 * machine-checkable half of that rule: a list of forbidden substrings run against every string this group
 * renders.
 */
export const error = /*#__PURE__*/ deepFreeze({
  // UNAPPROVED — KI-06-02 (`error.js`'s `heading.textContent`). "What happened", without naming the cause:
  // an eleven-year-old has no use for "WebGL context lost", and the ticket rules that word choice out anyway.
  heading: 'SOMETHING WENT WRONG',
  // UNAPPROVED — KI-06-02 (`error.js`'s `message.textContent`). "What to do about it", plus one reassurance a
  // player looking at a dead screen needs before anything else: this was not something they did.
  message: "The game got stuck. It isn't anything you did — click RELOAD to start it again.",
  // UNAPPROVED — KI-06-02 (`error.js`'s `reloadButton.textContent`); the ticket's own name for the control.
  reloadButton: 'RELOAD',
});

/**
 * Recursively freezes `value` and everything reachable from it (nested plain objects, arrays and — since a
 * `Set` iterates its own values but freezing does not touch what a `Set` holds indirectly — every own property
 * of every object, function included). AC2's "a write throws" needs this to go all the way down: freezing only
 * the top-level `STRINGS` object would still let `STRINGS.menu.title = 'x'` or
 * `STRINGS.howToPlay.lines.push('x')` succeed silently.
 *
 * @template T
 * @param {T} value
 * @returns {T}
 */
function deepFreeze(value) {
  if (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    !Object.isFrozen(value)
  ) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(/** @type {any} */ (value)[key]);
    }
  }
  return value;
}

/**
 * Every user-visible string the game renders, deep-frozen (AC2) — see this module's own doc comment above for
 * the approved/unapproved convention every entry carries.
 */
export const STRINGS = /*#__PURE__*/ deepFreeze({
  menu,
  howToPlay,
  matchSetup,
  matchOver,
  scoreboard,
  pause,
  countdown,
  replay,
  playtestPrompt,
  hud,
  tuning,
  tutorial,
  error,
});

/**
 * The dot-path of every entry in {@link STRINGS} that is approved copy per `DESIGN-DECISIONS §3` (AC1) — a
 * function entry's path names the function itself, called with its approved sample arguments by
 * `tests/unit/ui/strings.test.js` (see that file's own `APPROVED_SAMPLE_ARGS`). This is the companion a test
 * can walk without grepping comments; the `// APPROVED — DESIGN-DECISIONS §3` comment above each entry is the
 * same fact written for a human reader. The two are asserted to agree with each other in
 * `tests/unit/ui/strings.test.js` ("APPROVED_KEYS matches the // APPROVED comments").
 *
 * Deliberately excludes the two `// APPROVED — DESIGN-DECISIONS §1 row 27` entries
 * (`matchSetup.playerKindValue`) — real design-lead-approved copy, but from a different section than this
 * ticket's AC1 parses; see the module doc comment above.
 *
 * A frozen array, not a `Set` — freezing a `Set` does not actually stop `.add()`/`.delete()` (its entries live
 * behind an internal slot, not a normal own property, so `Object.freeze` never sees them); AC2 needs a
 * structure where a write genuinely throws, and only a frozen array (or plain object) gives that.
 *
 * @type {ReadonlyArray<string>}
 */
export const APPROVED_KEYS = deepFreeze([
  'menu.description',
  'menu.item2Players',
  'menu.itemHowToPlay',
  'menu.itemReplay',
  'menu.comingSoonTag',
  'howToPlay.title',
  'howToPlay.lines',
  'matchSetup.controlsCard',
  'matchSetup.colourNote.note',
  'matchSetup.colourNote.suggestion',
  'matchOver.tie',
  'matchOver.watchLastRound',
  'scoreboard.drawReplay',
  'scoreboard.drawWarning',
  'scoreboard.thirdDrawMatchOver',
  'replay.menuLabel',
  'replay.screenHeading',
  'replay.pasteLabel',
  'replay.pastePlaceholder',
  'replay.watchLabel',
  'replay.openFileLabel',
  'replay.playLabel',
  'replay.pauseLabel',
  'replay.stepLabel',
  'replay.startAgainLabel',
  'replay.endOfReplayText',
  'replay.badReplayHeading',
  'replay.tooNewHeading',
  'replay.tooNewDetail',
  'replay.keyHint',
  'replay.tickReadout',
  'playtestPrompt.hintLine',
  'hud.minSizeNote',
  'tutorial.skipHint',
]);
