// @ts-check
import { EVENTS } from '../core/events.js';
import { TRIGGER_KINDS, findQuestionById } from './playtestQuestions.js';

/**
 * The exported session file (Improvement 11 "Playtest capture mode",
 * `docs/sprints/improvement-11-playtest-capture-mode.md` KI-11-03). This module builds the JSON document
 * `playtestPrompt.js`'s EXPORT affordance copies/downloads and the markdown summary rendered alongside it —
 * from plain data only. No DOM, no `window`, no `import.meta` (tech-lead note 6 on issue #162): every function
 * here is a pure function of the arguments it is given, so `tests/unit/qa/playtestSession.test.js` runs it in
 * Node exactly the way `playtestQuestions.js`'s own tests do. All DOM — the EXPORT button, the clipboard
 * write, the `<textarea>` fallback, the download link — lives in `playtestPrompt.js`.
 *
 * ## Why a round's replay needs no help from `session.js` (tech-lead note 1/3 on issue #162)
 *
 * `session.getReplay()` already returns everything KS-07-01 recorded for the round that just ended:
 * `{ seed, settingsOverrides, inputs, expectedEvents }`, ending in the simulation's own `ROUND_OVER` event
 * (`src/core/round.js`'s `endRound`). That one event already carries `result` and `reason` (renamed
 * `endReason` here to match `src/core/events.js`'s own vocabulary less confusingly next to a round's
 * *replay*), and a round's laser phase is nothing more than "did a `LASER_WARNING` or `LASER_STEP` event ever
 * appear in this replay's own log" — the exact rule `session.js`'s own `laserPhaseSeen` latch uses
 * internally. So none of `result`, `endReason` or `laserPhaseSeen` needs a new field threaded out of
 * `session.js`; they are all *derived* from the replay `playtestPrompt.js` already has in hand
 * ({@link deriveRoundOutcome}).
 *
 * ## The document's shape is fixed (tech-lead note 9 on issue #162)
 *
 * `{ kind, schemaVersion, exportedAt, matchSettings, questions, rounds, sessionAnswers }`. Two rules that are
 * not arbitrary:
 * - `rounds[i].replay` is KS-07-01's object **verbatim and nothing else inside it** — `roundIndex`, `seed`,
 *   `result`, `endReason` and `laserPhaseSeen` sit *beside* it, never inside, so any `rounds[i].replay` can be
 *   written straight into `tests/sim/replays/` and pass `replay.test.js` unchanged, and I05 can adopt these
 *   files with no migration.
 * - An answer to an `end-of-session` question (`playtestQuestions.js`'s `TRIGGER_KINDS.END_OF_SESSION`)
 *   follows no particular round — it lives in the document's own `sessionAnswers`, never faked into a round's
 *   `answers`.
 */

/** The document's own `kind` tag (tech-lead note 9). */
export const SESSION_KIND = 'kobisnake-playtest-session';

/** The document's schema version (tech-lead note 9). Bump this, not the shape, if the shape ever changes. */
export const SESSION_SCHEMA_VERSION = 1;

/** @typedef {import('./playtestQuestions.js').PlaytestQuestion} PlaytestQuestion */

/**
 * The replay shape KS-07-01 / `tests/sim/replays/replay.schema.json` fixes, and nothing else — see this
 * file's own module doc for why that boundary matters.
 *
 * @typedef {object} Replay
 * @property {number | null} seed
 * @property {object} settingsOverrides
 * @property {object[]} inputs
 * @property {object[]} expectedEvents
 */

/**
 * One round this session has captured: its own replay, snapshotted the instant it ended (`playtestPrompt.js`'s
 * `offer()`, at the same moment `session.js` offers that round's due questions — before the next `startRound`
 * can reset `session.js`'s own logs out from under it).
 *
 * @typedef {object} RecordedRound
 * @property {number} roundIndex
 * @property {Replay} replay
 */

/**
 * One answer as `src/ui/screens/playtestPrompt.js`'s `createPlaytestPromptState` records it — confirmed or
 * skipped alike (`PlaytestAnswer` there, unchanged here).
 *
 * @typedef {object} RecordedAnswer
 * @property {number} roundIndex
 * @property {string} questionId
 * @property {1 | 2} player
 * @property {string | null} value
 * @property {boolean} skipped
 */

/**
 * The word the exported document uses for a player — "P1"/"P2" (tech-lead note 9's own example), not the
 * bare number `playtestPrompt.js` stores internally. `hud.js` and `playtestPrompt.js`'s own rendered labels
 * already write exactly this word, so this is not new copy, only the export's own encoding of an existing
 * one.
 *
 * @param {1 | 2} player
 * @returns {'P1' | 'P2'}
 */
export function playerLabel(player) {
  return player === 1 ? 'P1' : 'P2';
}

/**
 * A round's outcome, derived entirely from its own captured replay (tech-lead note 1/3): `result` and
 * `endReason` come from the replay's own `ROUND_OVER` event (always the log's last entry —
 * `src/core/round.js`'s `endRound` comment), and `laserPhaseSeen` is true the instant any `LASER_WARNING` or
 * `LASER_STEP` event appears anywhere in the same log — the identical rule `session.js`'s own latch uses.
 * `result`/`endReason` read `null` for a replay with no `ROUND_OVER` event at all (should not happen for a
 * completed round, but this reads as "unknown" rather than throwing on a malformed input).
 *
 * @param {Replay} replay
 * @returns {{result: string | null, endReason: string | null, laserPhaseSeen: boolean}}
 */
export function deriveRoundOutcome(replay) {
  const events = /** @type {{type: string, [key: string]: any}[]} */ (replay.expectedEvents);
  const roundOver = events.find((event) => event.type === EVENTS.ROUND_OVER);
  const laserPhaseSeen = events.some(
    (event) => event.type === EVENTS.LASER_WARNING || event.type === EVENTS.LASER_STEP,
  );
  return {
    result: roundOver ? /** @type {any} */ (roundOver).result ?? null : null,
    endReason: roundOver ? /** @type {any} */ (roundOver).reason ?? null : null,
    laserPhaseSeen,
  };
}

/**
 * Builds the whole exported session document — tech-lead note 9's shape, exactly. Pure: every field comes
 * from `rounds`/`answers`/`matchSettings` (plain data `playtestPrompt.js`'s DOM shell already holds) plus an
 * injectable clock, so a test can assert a fixed `exportedAt` instead of racing `Date.now()`.
 *
 * @param {object} options
 * @param {RecordedRound[]} options.rounds - every round captured this session, in the order they were played.
 * @param {RecordedAnswer[]} options.answers - every answer collected this session
 *   (`createPlaytestPromptState().getAnswers()`), confirmed or skipped alike.
 * @param {{bestOf: number, powerUpsEnabled: boolean, colors: Record<string, string>}} options.matchSettings -
 *   `session.getMatchSettings()`'s own shape, copied verbatim.
 * @param {string} [options.exportedAt] - defaults to `new Date().toISOString()` (local, no network — the
 *   sprint's own "nothing is uploaded" rule).
 * @returns {object}
 */
export function buildSessionDocument({ rounds, answers, matchSettings, exportedAt }) {
  /** @type {Record<string, {id: string, section: number, question: string, answerType: string, trigger: object}>} */
  const questions = {};
  /** Round index -> that round's own answers (every trigger kind except `end-of-session`). */
  const answersByRound = new Map();
  /** @type {object[]} */
  const sessionAnswers = [];

  for (const answer of answers) {
    const question = findQuestionById(answer.questionId);
    // A question the bank no longer lists (should never happen — `playtestPrompt.js` only ever asks
    // questions it found by id in the first place) is skipped rather than exported half-described: the
    // ticket's "no invented copy" rule cuts both ways, and a document entry with no question text to show a
    // design lead is worse than one entry fewer.
    if (question === undefined) continue;

    questions[question.id] = {
      id: question.id,
      section: question.section,
      question: question.question,
      answerType: question.answerType,
      trigger: question.trigger,
    };

    /** @type {any} */
    const entry = {
      questionId: answer.questionId,
      player: playerLabel(answer.player),
      value: answer.value,
      skipped: answer.skipped,
    };

    if (question.trigger.kind === TRIGGER_KINDS.END_OF_SESSION) {
      sessionAnswers.push(entry);
    } else {
      const forRound = answersByRound.get(answer.roundIndex) ?? [];
      forRound.push(entry);
      answersByRound.set(answer.roundIndex, forRound);
    }
  }

  return {
    kind: SESSION_KIND,
    schemaVersion: SESSION_SCHEMA_VERSION,
    exportedAt: exportedAt ?? new Date().toISOString(),
    matchSettings: { ...matchSettings, colors: { ...matchSettings.colors } },
    questions,
    rounds: rounds.map((round) => {
      const outcome = deriveRoundOutcome(round.replay);
      return {
        roundIndex: round.roundIndex,
        seed: round.replay.seed,
        result: outcome.result,
        endReason: outcome.endReason,
        laserPhaseSeen: outcome.laserPhaseSeen,
        // KS-07-01's object, verbatim and nothing else inside it (tech-lead note 9) — named fields rather
        // than a spread, so an extra field on `round.replay` (there never should be one) cannot leak in.
        replay: {
          seed: round.replay.seed,
          settingsOverrides: round.replay.settingsOverrides,
          inputs: round.replay.inputs,
          expectedEvents: round.replay.expectedEvents,
        },
        answers: answersByRound.get(round.roundIndex) ?? [],
      };
    }),
    sessionAnswers,
  };
}

/**
 * Renders the markdown summary the ticket asks for — "per-question tallies, every 'no' or 'unfair' with its
 * round and seed" — from exactly a {@link buildSessionDocument} result, adding no information that document
 * does not already carry (tech-lead note 7: derived text, not new copy). Every question's own words come
 * from `doc.questions` — the bank's own strings, never retyped.
 *
 * @param {ReturnType<typeof buildSessionDocument>} doc
 * @returns {string}
 */
export function renderMarkdownSummary(doc) {
  /** @type {{questionId: string, player: string, value: string | null, skipped: boolean, roundIndex: number | null, seed: number | null}[]} */
  const allAnswers = [];
  for (const round of /** @type {any} */ (doc).rounds) {
    for (const answer of round.answers) {
      allAnswers.push({ ...answer, roundIndex: round.roundIndex, seed: round.seed });
    }
  }
  for (const answer of /** @type {any} */ (doc).sessionAnswers) {
    allAnswers.push({ ...answer, roundIndex: null, seed: null });
  }

  const lines = [];
  lines.push('# KOBI Snake playtest session');
  lines.push('');
  lines.push(`Exported ${/** @type {any} */ (doc).exportedAt}`);
  lines.push('');

  const questionIds = Object.keys(/** @type {any} */ (doc).questions);
  lines.push('## Question tallies');
  lines.push('');
  if (questionIds.length === 0) {
    lines.push('_No questions were answered this session._');
  }
  for (const id of questionIds) {
    const question = /** @type {any} */ (doc).questions[id];
    const forQuestion = allAnswers.filter((answer) => answer.questionId === id);
    lines.push(`### ${id} — ${question.question}`);
    /** @type {Map<string, number>} */
    const tally = new Map();
    for (const answer of forQuestion) {
      const key = answer.skipped ? 'skipped' : String(answer.value);
      tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    if (tally.size === 0) {
      lines.push('_No answers recorded._');
    } else {
      for (const [value, count] of tally) {
        lines.push(`- ${value}: ${count}`);
      }
    }
    lines.push('');
  }

  lines.push('## Every "no" or "unfair" answer');
  lines.push('');
  const flagged = allAnswers.filter((answer) => answer.value === 'no' || answer.value === 'unfair');
  if (flagged.length === 0) {
    lines.push('_None._');
  } else {
    for (const answer of flagged) {
      const question = /** @type {any} */ (doc).questions[answer.questionId];
      const where =
        answer.roundIndex === null
          ? 'end of session'
          : `round ${answer.roundIndex}, seed ${answer.seed}`;
      const questionText = question ? question.question : answer.questionId;
      lines.push(`- **${answer.questionId}** (${answer.player}) — ${questionText} — ${where}`);
    }
  }
  lines.push('');

  return lines.join('\n');
}
