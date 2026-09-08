// @ts-check
import { playtestPrompt } from '../strings.playtest.js';
import { PLAYTEST_QUESTIONS, findQuestionById, isTriggerDue } from '../../qa/playtestQuestions.js';
import { buildSessionDocument, renderMarkdownSummary } from '../../qa/playtestSession.js';

/**
 * The `?playtest=1` between-round prompt (Improvement 11 "Playtest capture mode",
 * `docs/sprints/improvement-11-playtest-capture-mode.md` KI-11-02). A local overlay owned entirely by this
 * module, built directly on `#ui` the same way `screens/tuning.js` is (`main.js` constructs it only under the
 * flag and hands `session.js` the finished object through {@link module:session.setPlaytestPrompt} — never
 * routed through `ui.js`'s `show()`, and `gameStateMachine.js` never hears about it: `ROUND_OVER` is the only
 * state this ever appears in, and the state stays `ROUND_OVER` for as long as it is open (KI-10-03's pattern,
 * tech-lead note 4 on issue #161).
 *
 * ## Why this file is two things in one
 *
 * {@link createPlaytestPromptState} is pure — no DOM, no `window`, no `import.meta` — so the selection and
 * re-queue rules (the sprint's own named risk: "turning a playtest into a form") are provable in Node exactly
 * the way `scoreboard.js`'s `buildScoreboardLines` is. {@link createPlaytestPrompt} is the thin DOM shell
 * around it, built the same way every other `./screens/*.js` module is (`root.ownerDocument`, never the
 * global `document`), so a test can still construct it with a hand-built fake root.
 *
 * ## The turn model (tech-lead note 6, "do not invent a third input scheme")
 *
 * The ticket names exactly three keys this screen understands: ←/→ (or A/D) to move between a field's own
 * answers, Enter to confirm, Esc to skip — no fourth. That rules out a manual "move focus between P1's and
 * P2's rows" key (there is no such key in the ticket), so the two rows a question offers — P1's, then P2's —
 * are answered in a fixed sequence instead: confirming one field's current choice both records it and moves
 * the cursor on to the next unconfirmed field by itself. Two questions at most (`MAX_QUESTIONS_PER_GAP`, the
 * sprint's own risk-mitigation number) means at most four fields a gap ever holds.
 *
 * ## Why a skipped question needs no separate queue
 *
 * A question's trigger, once satisfied, never becomes false again within the match it was asked in
 * (`roundsPlayed` only grows, `laserPhaseSeen` only latches, `sessionOver` only turns true) — see
 * `playtestQuestions.js`'s own `RoundFacts` doc. So "come back later, not lost" needs no separate skip queue:
 * {@link selectDueQuestions} always asks first for whichever due questions are not yet in `answeredIds`, in
 * the bank's own order, and a question stays out of `answeredIds` until *both* its fields have been confirmed
 * (not merely offered) — so a question interrupted by Esc, or one only one player got to before Esc, simply
 * reappears — offered fresh, both fields again — the next time its trigger is checked. Between matches
 * `roundsPlayed` resets (a fresh `MatchState` per match), so an `after-round` question interrupted late in one
 * match may not resurface until a later match reaches the same round count again; that is "later", not
 * "lost", and the sprint's QA plan already expects a Gate session to be several matches long.
 *
 * ## What a skip still records
 *
 * Every field a gap ever showed produces exactly one entry in {@link getAnswers} when the gap closes, whether
 * confirmed (`skipped: false`, `value` the chosen word) or abandoned by Esc (`skipped: true`, `value: null`)
 * — so the export KI-11-03 builds can show not just what was answered but that a question went unanswered at
 * this particular round, without inventing a fourth outcome beyond the two the ticket already describes.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */
/** @typedef {import('../../qa/playtestQuestions.js').PlaytestQuestion} PlaytestQuestion */
/** @typedef {import('../../qa/playtestQuestions.js').RoundFacts} RoundFacts */

/**
 * At most this many due questions are offered in one between-round gap (the sprint file's own risk
 * mitigation: "Two questions at most between rounds"). Exported so a test can assert against the same number
 * rather than a magic `2` of its own.
 */
export const MAX_QUESTIONS_PER_GAP = 2;

/**
 * The one line on this screen that is not the playtest script's own words. `?playtest=1` exists so that two
 * people can run a Gate session with no facilitator, which means nothing is there to tell them which keys
 * answer a question — and `PLAYTEST-SCRIPT.md` has no such sentence to lift, so KI-11-02 shipped without one
 * rather than invent it (`CLAUDE.md`: copy is the design lead's). This is the design lead's ruling on #182,
 * verbatim and character for character; `DESIGN-DECISIONS §3` carries it with the rest of the approved
 * first-minute copy. A named constant, and asserted against a literal in the unit test, so it cannot drift.
 */
export const PROMPT_HINT_LINE = playtestPrompt.hintLine;

/**
 * The two answers almost every question in the bank is written against — "answer yes", "Majority yes",
 * "Nobody says…" (`ANSWER_TYPES.YES_NO`). Not invented copy: the tech-lead kickoff comment on issue #158
 * ruled "yes/no by default" for exactly this answer type, and every pass condition that type is used for
 * already contains one of these two words. `ANSWER_TYPES.CHOICE` questions (`A2`, `A4`) never reach this
 * constant — they carry their own `choices` array instead (already the script's own words).
 * @type {readonly ['yes', 'no']}
 */
export const YES_NO_CHOICES = ['yes', 'no'];

/**
 * One (question, player) slot in the current gap. `choices`/`choiceIndex` mirror `focus.js`'s left/right
 * model but scoped to one field rather than a whole screen, since two fields can be mid-answer at once (one
 * confirmed, the next not yet) inside the same gap.
 *
 * @typedef {object} PromptField
 * @property {string} questionId
 * @property {1 | 2} player
 * @property {readonly string[]} choices
 * @property {number} choiceIndex - index into `choices`; the field's currently highlighted answer
 * @property {boolean} confirmed
 */

/**
 * One collected answer, in exactly the shape KI-11-03's session document takes unchanged (tech-lead note 7 on
 * issue #161): `questionId`/`player`/`value`/`skipped` verbatim, plus `roundIndex` so KI-11-03 can join it to
 * the round it follows without this module knowing anything about replays.
 *
 * @typedef {object} PlaytestAnswer
 * @property {number} roundIndex
 * @property {string} questionId
 * @property {1 | 2} player
 * @property {string | null} value - the chosen word, or `null` when `skipped`
 * @property {boolean} skipped
 */

/**
 * @typedef {object} Gap
 * @property {number} roundIndex
 * @property {PromptField[]} fields
 * @property {number} focusIndex
 */

/**
 * Which due, unanswered questions to offer next, in the bank's own order, capped at
 * {@link MAX_QUESTIONS_PER_GAP}. Pure and cheap so a test (and {@link createPlaytestPromptState}) can call it
 * without any DOM or session machinery.
 *
 * @param {RoundFacts} facts
 * @param {ReadonlySet<string>} answeredIds - questions both of whose fields have already been confirmed;
 *   never offered again
 * @returns {PlaytestQuestion[]}
 */
export function selectDueQuestions(facts, answeredIds) {
  /** @type {PlaytestQuestion[]} */
  const due = [];
  for (const question of PLAYTEST_QUESTIONS) {
    if (answeredIds.has(question.id)) continue;
    if (!isTriggerDue(question.trigger, facts)) continue;
    due.push(question);
    if (due.length >= MAX_QUESTIONS_PER_GAP) break;
  }
  return due;
}

/**
 * Builds one gap's fields from its selected questions: P1's field then P2's, per question, in the order the
 * questions were selected. `choices` is the question's own `choices` array for `ANSWER_TYPES.CHOICE`, or
 * {@link YES_NO_CHOICES} otherwise — never invented per-field.
 *
 * @param {PlaytestQuestion[]} questions
 * @returns {PromptField[]}
 */
function buildFields(questions) {
  /** @type {PromptField[]} */
  const fields = [];
  for (const question of questions) {
    const choices = question.choices ?? YES_NO_CHOICES;
    for (const player of /** @type {const} */ ([1, 2])) {
      fields.push({ questionId: question.id, player, choices, choiceIndex: 0, confirmed: false });
    }
  }
  return fields;
}

/**
 * The pure state machine behind the prompt: which questions are due, the current gap's fields and focus, and
 * every answer collected so far. No DOM, no `window` — provable in Node (`ARCHITECTURE §3`'s discipline for
 * `src/core/`, applied here for the same reason: the risk this ticket names is a logic risk, not a rendering
 * one, and it deserves a logic-only test).
 *
 * @returns {PlaytestPromptState}
 */
export function createPlaytestPromptState() {
  /** Questions both of whose fields have been confirmed; never offered again. @type {Set<string>} */
  const answeredIds = new Set();
  /** @type {PlaytestAnswer[]} */
  const answers = [];
  /** @type {Gap | null} */
  let gap = null;

  /** @returns {PromptField | null} */
  function currentField() {
    return gap === null ? null : (gap.fields[gap.focusIndex] ?? null);
  }

  /**
   * A question is done — never offered again — once every field it contributed to this gap has been
   * confirmed (not merely offered; see the module doc comment on why a skip does not count).
   * @param {string} questionId
   */
  function maybeCommitQuestion(questionId) {
    const current = /** @type {Gap} */ (gap);
    const fieldsForQuestion = current.fields.filter((field) => field.questionId === questionId);
    if (fieldsForQuestion.every((field) => field.confirmed)) {
      answeredIds.add(questionId);
    }
  }

  function closeGap() {
    gap = null;
  }

  return {
    isOpen() {
      return gap !== null;
    },
    offer(facts, roundIndex) {
      if (gap !== null) return false;
      const due = selectDueQuestions(facts, answeredIds);
      if (due.length === 0) return false;
      gap = { roundIndex, fields: buildFields(due), focusIndex: 0 };
      return true;
    },
    getFields() {
      return gap === null ? [] : gap.fields.map((field) => ({ ...field }));
    },
    getFocusIndex() {
      return gap === null ? -1 : gap.focusIndex;
    },
    handleAction(action) {
      if (gap === null) return;
      switch (action) {
        case 'LEFT': {
          const field = currentField();
          if (field !== null && !field.confirmed) {
            field.choiceIndex =
              (field.choiceIndex - 1 + field.choices.length) % field.choices.length;
          }
          break;
        }
        case 'RIGHT': {
          const field = currentField();
          if (field !== null && !field.confirmed) {
            field.choiceIndex = (field.choiceIndex + 1) % field.choices.length;
          }
          break;
        }
        case 'CONFIRM': {
          const field = currentField();
          if (field === null || field.confirmed) break;
          field.confirmed = true;
          answers.push({
            roundIndex: gap.roundIndex,
            questionId: field.questionId,
            player: field.player,
            value: field.choices[field.choiceIndex],
            skipped: false,
          });
          maybeCommitQuestion(field.questionId);
          const nextIndex = gap.fields.findIndex((candidate) => !candidate.confirmed);
          if (nextIndex === -1) {
            closeGap();
          } else {
            gap.focusIndex = nextIndex;
          }
          break;
        }
        case 'BACK': {
          const current = /** @type {Gap} */ (gap);
          for (const field of current.fields) {
            if (field.confirmed) continue;
            answers.push({
              roundIndex: current.roundIndex,
              questionId: field.questionId,
              player: field.player,
              value: null,
              skipped: true,
            });
          }
          closeGap();
          break;
        }
        default:
          // UP/DOWN and anything else input.js could send: no meaning on this screen (tech-lead note 6, "do
          // not invent a third input scheme" — there is no key here for moving between P1's and P2's rows).
          break;
      }
    },
    getAnswers() {
      return answers.map((answer) => ({ ...answer }));
    },
  };
}

/**
 * @typedef {object} PlaytestPromptState
 * @property {() => boolean} isOpen
 * @property {(facts: RoundFacts, roundIndex: number) => boolean} offer - true if a gap was opened (there was
 *   at least one due, unanswered question); false leaves nothing open and the caller proceeds as if this
 *   prompt did not exist.
 * @property {() => PromptField[]} getFields - a snapshot copy of the open gap's fields, `[]` when closed.
 * @property {() => number} getFocusIndex - `-1` when closed.
 * @property {(action: MenuAction) => void} handleAction
 * @property {() => PlaytestAnswer[]} getAnswers - every answer collected this session so far (across every
 *   gap), plain data, for KI-11-03 to fold into its exported session document.
 */

/**
 * @typedef {object} PlaytestPromptScreen
 * @property {() => boolean} isOpen
 * @property {(facts: RoundFacts, roundIndex: number) => boolean} offer
 * @property {(action: MenuAction) => void} handleAction
 * @property {() => PlaytestAnswer[]} getAnswers
 * @property {() => void} destroy
 */

/**
 * @typedef {object} PlaytestPromptOptions
 * @property {() => import('../../qa/playtestSession.js').Replay} getReplay - `session.js`'s `getReplay()`.
 *   Called from inside `offer()`, at the exact moment `session.js` calls it (`enterRoundOver`, before the
 *   next `startRound()` can reset `roundInputLog`/`roundEventLog`) — KI-11-03 tech-lead note 1 on issue #162:
 *   "a replay captured a frame too late is empty". This is the only reason `offer()` needs a callback at all;
 *   everything else this file does with the captured replay is pure (`../../qa/playtestSession.js`).
 * @property {() => {bestOf: number, powerUpsEnabled: boolean, colors: Record<string, string>}} getMatchSettings
 *   - `session.js`'s own `getMatchSettings()`. Read fresh on every EXPORT click, not cached, so a session that
 *   changes its match setup between matches still exports the settings that were actually live.
 * @property {{writeText: (text: string) => Promise<void>} | null} [clipboard] - defaults to
 *   `navigator.clipboard` where one exists, exactly like `screens/tuning.js`'s own `TuningScreenOptions`
 *   (KI-11-03 reuses that file's proven copy pattern — tech-lead note 4 on issue #162).
 */

/**
 * Build the between-round prompt inside `root` (`#ui`). Constructed by `main.js` only under `?playtest=1`
 * (tech-lead note 1 on issue #161) — this module itself never reads `window.location` or `import.meta`, so
 * the flag's gate stays entirely at the call site, the same discipline `screens/tuning.js` uses for `?tuning=1`.
 *
 * KI-11-03 adds two things to what was otherwise KI-11-02's file: `offer()` now also snapshots the round that
 * just ended (`options.getReplay()`) into this module's own `capturedRounds`, and an EXPORT affordance —
 * reachable at any time, not only while a gap is open (the ticket's own "a session abandoned mid-match must
 * still hand back its file") — copies/downloads the session document `../../qa/playtestSession.js` builds
 * from `capturedRounds` and `state.getAnswers()`.
 *
 * @param {HTMLElement} root
 * @param {PlaytestPromptOptions} options
 * @returns {PlaytestPromptScreen}
 */
export function createPlaytestPrompt(root, { getReplay, getMatchSettings, clipboard }) {
  const doc = root.ownerDocument;
  const state = createPlaytestPromptState();
  const resolvedClipboard =
    clipboard !== undefined
      ? clipboard
      : /** @type {any} */ ((globalThis).navigator?.clipboard ?? null);

  /** Every round captured this session, in the order it was played (KI-11-03 tech-lead note 1/2 on #162: the
   * replay object inside each entry stays KS-07-01's shape verbatim — `../../qa/playtestSession.js` is what
   * hangs `result`/`endReason`/`laserPhaseSeen` beside it, never inside it).
   * @type {{roundIndex: number, replay: import('../../qa/playtestSession.js').Replay}[]} */
  const capturedRounds = [];

  const container = doc.createElement('div');
  container.className = 'playtest-prompt';
  container.dataset.playtestPrompt = 'true';
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'playtest-prompt-panel';
  container.appendChild(panel);

  root.appendChild(container);

  // --- EXPORT (KI-11-03): a separate, always-visible sibling of the gap panel above — never hidden by
  // `render()`, since the ticket needs this reachable "at any time", including while a gap is open and a
  // session abandoned with no gap ever open. Reuses `screens/tuning.js`'s "copy replay" pattern verbatim
  // (tech-lead note 4 on #162): the `<textarea>` is always populated first, *then* the clipboard is
  // attempted, and both failure branches are visible rather than silent.
  //
  // `src/ui/styles.css` is outside this ticket's `Files:` list (declared in the PR), so the handful of rules
  // this needs to actually be clickable are set inline instead of adding a stylesheet class: `#ui` itself is
  // `pointer-events: none` (every screen re-enables it on its own root the same way — `.playtest-prompt`,
  // `.tuning-overlay` — and this is no different), and `.playtest-prompt` is a full-screen `position:
  // absolute` panel while a gap is open, so this also needs its own stacking context above it. Pinned to the
  // bottom-left corner — `.tuning-overlay` already owns the bottom-right (its own module doc comment) — so a
  // dev build with both flags on never overlaps the two.
  const exportContainer = doc.createElement('div');
  exportContainer.className = 'playtest-export';
  exportContainer.dataset.playtestExport = 'true';
  Object.assign(exportContainer.style, {
    position: 'fixed',
    left: '0',
    bottom: '0',
    zIndex: '1000',
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.25rem',
    padding: '0.5rem',
    maxWidth: '20rem',
    background: 'rgba(10, 12, 16, 0.85)',
    color: 'rgb(255, 255, 255)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: '0.8rem',
  });

  const exportButton = doc.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'playtest-export-button';
  exportButton.textContent = playtestPrompt.exportButton;
  exportButton.dataset.playtestExportButton = 'true';
  exportContainer.appendChild(exportButton);

  const exportStatus = doc.createElement('span');
  exportStatus.className = 'playtest-export-status';
  exportStatus.dataset.playtestExportStatus = 'true';
  exportContainer.appendChild(exportStatus);

  // The JSON document, reachable "another way too" (tuning.js's own phrase) whether or not the clipboard
  // write succeeds — an e2e spec reads this rather than needing clipboard permissions granted at all.
  const exportJsonEl = /** @type {HTMLTextAreaElement} */ (doc.createElement('textarea'));
  exportJsonEl.className = 'playtest-export-json';
  exportJsonEl.readOnly = true;
  exportJsonEl.dataset.playtestExportJson = 'true';
  exportContainer.appendChild(exportJsonEl);

  // The rendered markdown summary, alongside the JSON (the ticket's own "a markdown summary is rendered
  // alongside"). Also a plain `<textarea>`, for the same select-all-and-copy reason as the JSON one above.
  const exportMarkdownEl = /** @type {HTMLTextAreaElement} */ (doc.createElement('textarea'));
  exportMarkdownEl.className = 'playtest-export-markdown';
  exportMarkdownEl.readOnly = true;
  exportMarkdownEl.dataset.playtestExportMarkdown = 'true';
  exportContainer.appendChild(exportMarkdownEl);

  // The download offer (tech-lead note 4): an object-URL `<a download>` built from a `Blob` — same-origin, no
  // network, so `tests/e2e/offline.spec.js` (AC3) never sees a request from this. A fresh URL replaces the
  // previous one on every export so a long session never leaks one object URL per click.
  const exportDownloadLink = /** @type {HTMLAnchorElement} */ (doc.createElement('a'));
  exportDownloadLink.className = 'playtest-export-download';
  exportDownloadLink.textContent = playtestPrompt.downloadSessionFile;
  exportDownloadLink.dataset.playtestExportDownload = 'true';
  exportDownloadLink.download = 'kobisnake-playtest-session.json';
  exportContainer.appendChild(exportDownloadLink);

  root.appendChild(exportContainer);

  /** The `Blob`/`URL` this export's download link was last built from, revoked before a new one replaces it. */
  let lastObjectUrl = /** @type {string | null} */ (null);

  exportButton.addEventListener('click', () => {
    const document_ = buildSessionDocument({
      rounds: capturedRounds.map((round) => ({
        roundIndex: round.roundIndex,
        replay: round.replay,
      })),
      answers: state.getAnswers(),
      matchSettings: getMatchSettings(),
    });
    const json = JSON.stringify(document_, null, 2);
    exportJsonEl.value = json;
    exportMarkdownEl.value = renderMarkdownSummary(/** @type {any} */ (document_));

    const view = /** @type {any} */ (root.ownerDocument.defaultView ?? globalThis);
    if (lastObjectUrl !== null) view.URL.revokeObjectURL(lastObjectUrl);
    const blob = new view.Blob([json], { type: 'application/json' });
    lastObjectUrl = view.URL.createObjectURL(blob);
    exportDownloadLink.href = /** @type {string} */ (lastObjectUrl);

    if (resolvedClipboard === null || typeof resolvedClipboard.writeText !== 'function') {
      exportStatus.textContent = playtestPrompt.clipboardUnavailable;
      return;
    }
    resolvedClipboard.writeText(json).then(
      () => {
        exportStatus.textContent = playtestPrompt.copied;
      },
      () => {
        // A denied clipboard permission must not fail silently (tuning.js's own tech-lead note 6) — the JSON
        // is already in `exportJsonEl` regardless of which branch this callback takes.
        exportStatus.textContent = playtestPrompt.clipboardBlocked;
      },
    );
  });

  /** Redraws the whole panel from `state`'s current fields — cheap enough (at most four fields) to rebuild on
   * every action rather than patch, the same choice `screens/scoreboard.js`'s `render` makes. */
  function render() {
    if (!state.isOpen()) {
      container.hidden = true;
      panel.textContent = '';
      return;
    }
    container.hidden = false;
    panel.textContent = '';

    const fields = state.getFields();
    const focusIndex = state.getFocusIndex();

    /** One `.playtest-prompt-question` block per distinct question, in first-seen order. @type {Map<string, HTMLElement>} */
    const questionEls = new Map();

    fields.forEach((field, index) => {
      let questionEl = questionEls.get(field.questionId);
      if (questionEl === undefined) {
        const question = findQuestionById(field.questionId);
        questionEl = doc.createElement('div');
        questionEl.className = 'playtest-prompt-question';
        questionEl.dataset.playtestQuestion = field.questionId;

        const textEl = doc.createElement('div');
        textEl.className = 'playtest-prompt-question-text';
        // The script's own words, verbatim (`PlaytestQuestion.question`) — no copy invented here.
        textEl.textContent = question?.question ?? '';
        questionEl.appendChild(textEl);

        questionEls.set(field.questionId, questionEl);
        panel.appendChild(questionEl);
      }

      const fieldEl = doc.createElement('div');
      fieldEl.className = 'playtest-prompt-field';
      fieldEl.dataset.playtestField = `${field.questionId}:${field.player}`;
      if (index === focusIndex) fieldEl.classList.add('playtest-prompt-field--focused');
      if (field.confirmed) fieldEl.classList.add('playtest-prompt-field--answered');

      const playerEl = doc.createElement('span');
      playerEl.className = 'playtest-prompt-field-player';
      // `hud.js`'s own words — the HUD already writes exactly `P1`/`P2` (`createHud`'s `setLengths`).
      playerEl.textContent = playtestPrompt.playerLabel(field.player);
      fieldEl.appendChild(playerEl);

      const choicesEl = doc.createElement('span');
      choicesEl.className = 'playtest-prompt-field-choices';
      field.choices.forEach((choice, choiceIndex) => {
        const choiceEl = doc.createElement('span');
        choiceEl.className = 'playtest-prompt-choice';
        if (choiceIndex === field.choiceIndex) {
          choiceEl.classList.add('playtest-prompt-choice--selected');
        }
        choiceEl.textContent = choice;
        choicesEl.appendChild(choiceEl);
      });
      fieldEl.appendChild(choicesEl);

      questionEl.appendChild(fieldEl);
    });

    // #182, the design lead's ruling: "under the answers, small, on every prompt". Appended to the panel
    // rather than to a question block, so one gap showing two questions still carries exactly one hint.
    const hintEl = doc.createElement('div');
    hintEl.className = 'playtest-prompt-hint';
    hintEl.dataset.playtestHint = 'true';
    hintEl.textContent = PROMPT_HINT_LINE;
    panel.appendChild(hintEl);
  }

  return {
    isOpen: state.isOpen,
    offer(facts, roundIndex) {
      // KI-11-03 tech-lead note 1 on #162: snapshotted *before* `state.offer` (which only ever reads
      // `facts`/`roundIndex`, never `session.js`), and unconditionally — a round with nothing due still gets
      // captured, since AC1's export must contain every round played, not only the ones that carried a
      // question. `session.js` calls this once per `enterRoundOver`, before its own next `startRound()` can
      // reset the logs `getReplay()` reads.
      capturedRounds.push({ roundIndex, replay: getReplay() });
      const opened = state.offer(facts, roundIndex);
      if (opened) render();
      return opened;
    },
    handleAction(action) {
      if (!state.isOpen()) return;
      state.handleAction(action);
      render();
    },
    getAnswers: state.getAnswers,
    destroy() {
      container.remove();
      exportContainer.remove();
      if (lastObjectUrl !== null) {
        const view = /** @type {any} */ (root.ownerDocument.defaultView ?? globalThis);
        view.URL.revokeObjectURL(lastObjectUrl);
        lastObjectUrl = null;
      }
    },
  };
}
