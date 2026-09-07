// @ts-check
/**
 * KI-11-04 — turn an exported playtest session into ready-to-paste GitHub issue bodies.
 *
 * `?playtest=1` (KI-11-02, KI-11-03) hands two humans back one file. This reads that file and prints one
 * issue body per **failing answer**, each carrying the question in the playtest script's own words, both
 * players' answers, the round's seed, and the round's replay in the exact shape
 * `tests/sim/replays/*.json` fixtures use — so the design lead can file a finding, and an engineer can
 * reproduce it, without either of them opening a session file by hand.
 *
 *   node scripts/playtest-to-issues.mjs <session-file.json>
 *
 * ## What counts as failing, and why it is not a judgement call
 *
 * Nothing here decides what a good answer is; `docs/qa/PLAYTEST-SCRIPT.md` already did, in each question's
 * own **Pass condition** cell, and KI-11-01 carried those cells across verbatim.
 *
 * - **yes/no questions** — `no` fails. That is KI-11-04 AC1's own wording ("one issue body per `no`"), and it
 *   matches every pass condition of that type in §2–§8: "≥ 4/5 answer yes", "Majority yes", "Nobody says…".
 * - **choice questions** (`A2`, `A4`) — an answer fails when the question's own pass condition does not name
 *   it. `A4`'s reads `≥ 4/5 rounds "exciting".`, so `exciting` passes and `frustrating` does not; `A2`'s
 *   reads `Majority say "about right".`, so `about right` passes and `too early`/`too late` do not. The rule
 *   is a substring test against the script's sentence, never a table written here — a pass condition edited
 *   in the script changes this script's behaviour with it, which is the same anti-drift property KI-11-01's
 *   parse test gives the questions themselves.
 *
 * The substring test is deliberately *not* used for yes/no: `C1`'s pass condition contains both words
 * ("≥ 4/5 answer yes; any \"no\" is reproduced with a replay and filed"), so it cannot discriminate there.
 *
 * A **skipped** answer is not a failure — it is a question the players chose not to answer, reported in the
 * trailer so it is visible without being filed.
 */

import { readFileSync } from 'node:fs';
import { PLAYTEST_QUESTIONS } from '../src/qa/playtestQuestions.js';

/** @typedef {{questionId: string, player: string, value: string | null, skipped: boolean}} Answer */
/** @typedef {{id: string, section: number, sectionTitle: string, question: string, procedure: string | null, passCondition: string, answerType: string, choices: readonly string[] | null}} Question */
/** @typedef {{seed: number, settingsOverrides: object, inputs: object[], expectedEvents: object[]}} Replay */
/** @typedef {{roundIndex: number, seed: number, result: string, endReason: string, laserPhaseSeen: boolean, replay: Replay, answers: Answer[]}} Round */
/** @typedef {{kind: string, schemaVersion: number, exportedAt: string, matchSettings: object, questions: Record<string, Question>, rounds: Round[], sessionAnswers: Answer[]}} SessionDocument */

/**
 * The full question behind an id.
 *
 * The exported document's own `questions` map is deliberately small — id, section, question, answer type and
 * trigger — because it exists to make the file readable on its own, not to duplicate the bank. The
 * `procedure` and `passCondition` cells this script needs live in `src/qa/playtestQuestions.js`, which is the
 * source of record for both (KI-11-01), and this script runs inside the repository that holds it. So the two
 * are merged, with **the export winning** on any field it carries: a session exported before a question was
 * reworded still prints the wording those players actually saw, rather than today's.
 *
 * @param {SessionDocument} doc
 * @param {string} id
 * @returns {Question | undefined}
 */
export function resolveQuestion(doc, id) {
  const fromBank = PLAYTEST_QUESTIONS.find((question) => question.id === id);
  const fromExport = doc.questions?.[id];
  if (fromBank === undefined && fromExport === undefined) return undefined;
  return /** @type {Question} */ ({ ...fromBank, ...fromExport });
}

/**
 * Whether one answer failed its question's own pass condition. See the module comment for why yes/no and
 * choice questions are decided differently.
 *
 * @param {Answer} answer
 * @param {Question | undefined} question
 * @returns {boolean}
 */
export function isFailingAnswer(answer, question) {
  if (answer.skipped || answer.value === null || question === undefined) return false;
  if (question.answerType === 'choice') return !question.passCondition.includes(answer.value);
  return answer.value === 'no';
}

/**
 * Every answer in the document, each tagged with the round it followed (`null` for an `end-of-session`
 * question, which follows no particular round).
 *
 * @param {SessionDocument} doc
 * @returns {{answer: Answer, round: Round | null}[]}
 */
export function allAnswers(doc) {
  return [
    ...doc.rounds.flatMap((round) => round.answers.map((answer) => ({ answer, round }))),
    ...doc.sessionAnswers.map((answer) => ({ answer, round: /** @type {Round | null} */ (null) })),
  ];
}

/**
 * The round a finding should be reproduced from. A round-attached answer names its own round. An
 * `end-of-session` answer names the **last round played** — the one that was in front of the players when
 * they answered — which the issue body says out loud rather than implying.
 *
 * @param {SessionDocument} doc
 * @param {Round | null} round
 * @returns {Round | undefined}
 */
export function evidenceRound(doc, round) {
  return round ?? doc.rounds.at(-1);
}

/**
 * One ready-to-paste issue body for one failing answer.
 *
 * @param {SessionDocument} doc
 * @param {Answer} answer
 * @param {Round | null} round
 * @returns {{title: string, body: string}}
 */
export function formatIssue(doc, answer, round) {
  const question = resolveQuestion(doc, answer.questionId);
  const evidence = evidenceRound(doc, round);
  const bothPlayers = allAnswers(doc)
    .filter((entry) => entry.answer.questionId === answer.questionId && entry.round === round)
    .map((entry) => entry.answer);

  const lines = [];
  lines.push(
    `Filed from a \`?playtest=1\` session exported on ${doc.exportedAt} (KI-11-03). ` +
      `\`${answer.player}\` answered **${answer.value}**, which its own pass condition in ` +
      `\`docs/qa/PLAYTEST-SCRIPT.md\` §${question.section} does not accept.`,
    '',
    `## ${question.id} ${question.question}`,
    '',
    `The question, in the script's own words (§${question.section} ${question.sectionTitle}):`,
    '',
  );
  if (question.procedure) lines.push(`- **Procedure:** ${question.procedure}`);
  lines.push(`- **Pass condition:** ${question.passCondition}`, '', '## What the players answered', '');
  for (const entry of bothPlayers) {
    const verdict = entry.skipped
      ? '_skipped_'
      : `**${entry.value}**${isFailingAnswer(entry, question) ? ' ← fails the pass condition' : ''}`;
    lines.push(`- \`${entry.player}\`: ${verdict}`);
  }
  if (bothPlayers.length === 1) {
    lines.push('', '_Only one player answered this question before the gap was closed._');
  }

  lines.push('', '## The round it came from', '');
  if (evidence === undefined) {
    lines.push('_This session recorded no rounds, so there is no replay to attach._');
  } else {
    lines.push(
      round === null
        ? `This is an **end-of-session** question, so it follows no single round. The round below is the ` +
            `last one played — what the players had just seen when they answered.`
        : `Round ${evidence.roundIndex} — the round this question followed.`,
      '',
      `- **Seed:** \`${evidence.seed}\``,
      `- **Result:** ${evidence.result} (${evidence.endReason})`,
      `- **Laser phase reached:** ${evidence.laserPhaseSeen ? 'yes' : 'no'}`,
      '',
      'The replay below is already in the shape `tests/sim/replays/*.json` uses. Save it into that ',
      'directory and `tests/sim/replay.test.js` picks it up with no code change, replaying this exact ',
      'round tick for tick.',
      '',
      '<details><summary>replay JSON</summary>',
      '',
      '```json',
      JSON.stringify(evidence.replay, null, 2),
      '```',
      '',
      '</details>',
    );
  }

  return {
    title: `[Playtest] ${question.id} ${question.question} — ${answer.player} answered "${answer.value}"`,
    body: lines.join('\n'),
  };
}

/**
 * Every issue this session produces, in the order the answers were given.
 *
 * @param {SessionDocument} doc
 * @returns {{title: string, body: string}[]}
 */
export function issuesFor(doc) {
  return allAnswers(doc)
    .filter((entry) => isFailingAnswer(entry.answer, resolveQuestion(doc, entry.answer.questionId)))
    .map((entry) => formatIssue(doc, entry.answer, entry.round));
}

/**
 * The trailer printed after the issues: what was answered and passed, and what was skipped. Not findings —
 * context, so the design lead can see the session was actually played rather than abandoned.
 *
 * @param {SessionDocument} doc
 * @returns {string}
 */
export function renderTrailer(doc) {
  const answers = allAnswers(doc);
  const skipped = answers.filter((entry) => entry.answer.skipped);
  const passed = answers.filter(
    (entry) =>
      !entry.answer.skipped &&
      !isFailingAnswer(entry.answer, resolveQuestion(doc, entry.answer.questionId)),
  );
  const lines = [
    `Session: ${doc.rounds.length} round(s), ${answers.length} answer(s) — ` +
      `${passed.length} within the pass condition, ${skipped.length} skipped.`,
  ];
  if (skipped.length > 0) {
    lines.push(
      'Skipped (not filed — the players chose not to answer these):',
      ...skipped.map((entry) => `  - ${entry.answer.questionId} ${entry.answer.player}`),
    );
  }
  return lines.join('\n');
}

/**
 * @param {SessionDocument} doc
 * @returns {string}
 */
export function render(doc) {
  const issues = issuesFor(doc);
  const out = [];
  if (issues.length === 0) {
    out.push('No answer in this session failed its pass condition — nothing to file.', '');
  }
  issues.forEach((issue, index) => {
    out.push(
      `${'='.repeat(96)}`,
      `ISSUE ${index + 1} of ${issues.length}`,
      `${'='.repeat(96)}`,
      '',
      `TITLE: ${issue.title}`,
      '',
      'BODY:',
      issue.body,
      '',
    );
  });
  out.push(`${'-'.repeat(96)}`, renderTrailer(doc));
  return out.join('\n');
}

/**
 * Reads a session file and returns it, failing loudly on anything that is not one — a wrong path is the
 * likeliest mistake here, and a stack trace about `undefined.rounds` would not say so.
 *
 * @param {string} path
 * @returns {SessionDocument}
 */
export function readSessionFile(path) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (doc?.kind !== 'kobisnake-playtest-session') {
    throw new Error(
      `${path} is not a playtest session export (expected kind "kobisnake-playtest-session", got ${JSON.stringify(doc?.kind)}). ` +
        'Export one from a `?playtest=1` session with the EXPORT button.',
    );
  }
  return doc;
}

// Run only when invoked directly, so the formatter above stays importable by its unit test.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*?(?=scripts\/)/, ''))) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node scripts/playtest-to-issues.mjs <session-file.json>');
    process.exit(2);
  }
  console.log(render(readSessionFile(path)));
}
