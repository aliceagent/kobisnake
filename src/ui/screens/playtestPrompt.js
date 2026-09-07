// @ts-check
import {
  PLAYTEST_QUESTIONS,
  findQuestionById,
  isTriggerDue,
} from '../../qa/playtestQuestions.js';

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
            field.choiceIndex = (field.choiceIndex - 1 + field.choices.length) % field.choices.length;
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
 * Build the between-round prompt inside `root` (`#ui`). Constructed by `main.js` only under `?playtest=1`
 * (tech-lead note 1 on issue #161) — this module itself never reads `window.location` or `import.meta`, so
 * the flag's gate stays entirely at the call site, the same discipline `screens/tuning.js` uses for `?tuning=1`.
 *
 * @param {HTMLElement} root
 * @returns {PlaytestPromptScreen}
 */
export function createPlaytestPrompt(root) {
  const doc = root.ownerDocument;
  const state = createPlaytestPromptState();

  const container = doc.createElement('div');
  container.className = 'playtest-prompt';
  container.dataset.playtestPrompt = 'true';
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'playtest-prompt-panel';
  container.appendChild(panel);

  root.appendChild(container);

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
      playerEl.textContent = `P${field.player}`;
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
  }

  return {
    isOpen: state.isOpen,
    offer(facts, roundIndex) {
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
    },
  };
}
