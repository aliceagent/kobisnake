// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ANSWER_TYPES,
  PLAYTEST_QUESTIONS,
  QUESTION_ID_PATTERN,
  TRIGGER_KINDS,
  isTriggerDue,
  triggerRequiresLaserPhase,
} from '../../../src/qa/playtestQuestions.js';

const SCRIPT_PATH = fileURLToPath(
  new URL('../../../docs/qa/PLAYTEST-SCRIPT.md', import.meta.url),
);

/**
 * A from-scratch parse of `PLAYTEST-SCRIPT.md`'s question tables — independent of
 * `src/qa/playtestQuestions.js` — so this test verifies the data file against the document itself, not
 * against its own copy of the document. This is "the parser's contract" from the tech-lead notes on issue
 * #160: a row is a question if, and only if, its first cell starts with a capital letter and a number
 * (`QUESTION_ID_PATTERN`). Nothing here special-cases the `Q` header, the `|---|` separator rows, or the
 * `Bot stat` row under §5 — all three are excluded because none of them match that pattern.
 *
 * @typedef {object} ParsedRow
 * @property {string} id
 * @property {number} section
 * @property {string} sectionTitle
 * @property {string} question
 * @property {string | null} procedure
 * @property {string} passCondition
 */

/** @returns {ParsedRow[]} */
function parseScriptQuestions() {
  const markdown = readFileSync(SCRIPT_PATH, 'utf8');

  // KI-11-01 scope is §2–§8 only: §9 and §10 are Gate 2 and out of scope, so the parse never looks past the
  // start of §9 — adding a Gate 2 question later cannot make this test start failing or start passing on
  // the wrong data.
  const startMarker = '## 2. ';
  const endMarker = '## 9. ';
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('PLAYTEST-SCRIPT.md section markers §2/§9 not found — has the script been restructured?');
  }
  const scoped = markdown.slice(start, end);

  /** @type {ParsedRow[]} */
  const rows = [];
  let section = 0;
  let sectionTitle = '';

  for (const line of scoped.split('\n')) {
    const heading = line.match(/^## (\d+)\.\s*(.+)$/);
    if (heading) {
      section = Number(heading[1]);
      sectionTitle = heading[2].trim();
      continue;
    }
    if (!line.startsWith('|')) continue;

    // Strip the leading/trailing "|" and split on the rest — every table cell in this document is plain
    // text with no literal "|" of its own, so a straight split is exact.
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());

    const firstCell = cells[0];
    const idMatch = firstCell.match(QUESTION_ID_PATTERN);
    if (!idMatch) continue; // header row, "|---|" separator, or the non-question "Bot stat" row

    const id = idMatch[0];
    const question = firstCell.slice(id.length).trim();

    // §2–§5 tables are Q | Procedure | Pass condition (3 cells); §6–§8 are Q | Pass condition (2 cells).
    const procedure = cells.length === 3 ? cells[1] : null;
    const passCondition = cells.length === 3 ? cells[2] : cells[1];

    rows.push({ id, section, sectionTitle, question, procedure, passCondition });
  }

  return rows;
}

describe('KI-11-01 playtest question bank', () => {
  const scriptRows = parseScriptQuestions();

  it('KI-11-01 AC1: every question id in the script exists in the data, and vice versa, with matching wording', () => {
    // Two-way id equality...
    const scriptIds = scriptRows.map((row) => row.id).sort();
    const dataIds = PLAYTEST_QUESTIONS.map((question) => question.id).sort();
    expect(dataIds).toEqual(scriptIds);
    expect(new Set(dataIds).size).toBe(dataIds.length); // no duplicate ids on either side

    // ...and, because carrying the script's words across without tidying them is the whole point (CLAUDE.md
    // "never invent a mechanic, screen, option or rule"; issue #160's "no invented copy"), every field the
    // script supplies must match the data byte-for-byte in both directions, not just the id.
    for (const scriptRow of scriptRows) {
      const dataQuestion = PLAYTEST_QUESTIONS.find((question) => question.id === scriptRow.id);
      expect(dataQuestion, `data is missing question ${scriptRow.id}`).toBeDefined();
      expect(dataQuestion?.section).toBe(scriptRow.section);
      expect(dataQuestion?.sectionTitle).toBe(scriptRow.sectionTitle);
      expect(dataQuestion?.question).toBe(scriptRow.question);
      expect(dataQuestion?.procedure).toBe(scriptRow.procedure);
      expect(dataQuestion?.passCondition).toBe(scriptRow.passCondition);
    }
  });

  it('KI-11-01 AC1: the id rule alone is what excludes "Bot stat" and the table scaffolding — no name-based exception', () => {
    // §5's "Bot stat" row is a 500-round bot statistic, not a human question. It is absent from the parsed
    // rows, and it is absent because "Bot" does not match `QUESTION_ID_PATTERN` — not because the parser (or
    // the data file) knows its name. Reading the raw markdown directly proves the row exists to be excluded.
    const raw = readFileSync(SCRIPT_PATH, 'utf8');
    expect(raw).toContain('| Bot stat |');
    expect(scriptRows.some((row) => row.question === 'stat')).toBe(false);
    expect('Bot stat'.match(QUESTION_ID_PATTERN)).toBeNull();

    // The header ("Q") and separator ("---") rows fail the same pattern.
    expect('Q'.match(QUESTION_ID_PATTERN)).toBeNull();
    expect('---'.match(QUESTION_ID_PATTERN)).toBeNull();
  });

  it('KI-11-01 AC1: §9 and §10 (Gate 2 only) contribute nothing — scoping is by section marker, not by id', () => {
    // K1/S1/S2/T1/T2 exist in the document (§9) but must never appear in the data — this ticket is §2–§8.
    const gate2Ids = ['K1', 'S1', 'S2', 'T1', 'T2'];
    for (const id of gate2Ids) {
      expect(scriptRows.some((row) => row.id === id)).toBe(false);
      expect(PLAYTEST_QUESTIONS.some((question) => question.id === id)).toBe(false);
    }
    // Sanity: they really are id-shaped and really are in the document, so their absence above is the
    // section scope doing its job, not the id pattern accidentally rejecting them.
    for (const id of gate2Ids) {
      expect(id).toMatch(QUESTION_ID_PATTERN);
    }
    const raw = readFileSync(SCRIPT_PATH, 'utf8');
    expect(raw).toContain('| K1 Keys satisfying |');
  });

  it('KI-11-01: every answer type used is one the script actually supports, and the unused 1-5 type stays unused', () => {
    for (const question of PLAYTEST_QUESTIONS) {
      expect(Object.values(ANSWER_TYPES)).toContain(question.answerType);
      if (question.answerType === ANSWER_TYPES.CHOICE) {
        expect(question.choices?.length).toBeGreaterThan(1);
      } else {
        expect(question.choices).toBeNull();
      }
    }

    const a2 = PLAYTEST_QUESTIONS.find((question) => question.id === 'A2');
    expect(a2?.answerType).toBe(ANSWER_TYPES.CHOICE);
    expect(a2?.choices).toEqual(['too early', 'too late', 'about right']);

    const a4 = PLAYTEST_QUESTIONS.find((question) => question.id === 'A4');
    expect(a4?.answerType).toBe(ANSWER_TYPES.CHOICE);
    expect(a4?.choices).toEqual(['exciting', 'frustrating']);

    // No question in §2–§8 asks for a 1-5 rating (tech-lead notes on #160) — this is the correct outcome,
    // not a gap, so nothing in the bank should claim that type.
    const ratingLike = PLAYTEST_QUESTIONS.filter(
      (question) => question.answerType !== ANSWER_TYPES.YES_NO && question.answerType !== ANSWER_TYPES.CHOICE,
    );
    expect(ratingLike).toEqual([]);
  });

  it('KI-11-01 AC2: every question carries a trigger of a known kind', () => {
    for (const question of PLAYTEST_QUESTIONS) {
      expect(Object.values(TRIGGER_KINDS)).toContain(question.trigger.kind);
      if (question.trigger.kind === TRIGGER_KINDS.AFTER_ROUND) {
        expect(question.trigger.roundCount).toBeGreaterThan(0);
      }
    }
  });

  it('KI-11-01 AC2: an after-round question is not due until enough rounds have actually been played', () => {
    const m1 = PLAYTEST_QUESTIONS.find((question) => question.id === 'M1');
    expect(m1).toBeDefined();
    const trigger = /** @type {import('../../../src/qa/playtestQuestions.js').Trigger} */ (m1?.trigger);

    const before = { roundsPlayed: 2, laserPhaseSeen: false, sessionOver: false };
    const at = { roundsPlayed: 3, laserPhaseSeen: false, sessionOver: false };
    expect(isTriggerDue(trigger, before)).toBe(false);
    expect(isTriggerDue(trigger, at)).toBe(true);
  });

  it('KI-11-01 AC2: every laser-gated question is never due for a round in which the lasers never armed, however many rounds were played', () => {
    // This is the real content of AC2, per the tech-lead notes: "no question is asked before its trigger can
    // have happened" means a round count alone can never satisfy a question that is actually about the
    // lasers. The list of which questions those are is derived from the data via `triggerRequiresLaserPhase`
    // rather than hand-listed here, so a future §5 question cannot be added and quietly miss this gate the
    // way `A2` originally did (Opus review, PR #168).
    const laserGatedQuestions = PLAYTEST_QUESTIONS.filter((question) =>
      triggerRequiresLaserPhase(question.trigger),
    );
    expect(laserGatedQuestions.map((question) => question.id).sort()).toEqual([
      'A1',
      'A2',
      'A3',
      'A4',
      'V2',
    ]);

    for (const question of laserGatedQuestions) {
      const manyRoundsNoLasers = { roundsPlayed: 1000, laserPhaseSeen: false, sessionOver: false };
      expect(isTriggerDue(question.trigger, manyRoundsNoLasers)).toBe(false);

      // Whatever round count the trigger also asks for (0 for a pure laser-phase trigger; `roundCount` for
      // an after-round trigger that also requires the laser phase), meeting both halves at once is enough.
      const roundCount = question.trigger.kind === TRIGGER_KINDS.AFTER_ROUND ? question.trigger.roundCount : 0;
      const enoughRoundsWithLasers = { roundsPlayed: roundCount, laserPhaseSeen: true, sessionOver: false };
      expect(isTriggerDue(question.trigger, enoughRoundsWithLasers)).toBe(true);
    }
  });

  it('KI-11-01 AC2: A2 requires both 5 rounds and the laser phase, not either alone', () => {
    // A2's own procedure names both conditions in one sentence: "did the lasers come too early/late?" *after
    // 5 rounds*. Five short rounds that never saw a laser cannot answer a question about the lasers' timing.
    const a2 = PLAYTEST_QUESTIONS.find((question) => question.id === 'A2');
    expect(a2).toBeDefined();
    const trigger = /** @type {import('../../../src/qa/playtestQuestions.js').Trigger} */ (a2?.trigger);

    const fiveRoundsNoLasers = { roundsPlayed: 5, laserPhaseSeen: false, sessionOver: false };
    expect(isTriggerDue(trigger, fiveRoundsNoLasers)).toBe(false);

    const fiveRoundsWithLasers = { roundsPlayed: 5, laserPhaseSeen: true, sessionOver: false };
    expect(isTriggerDue(trigger, fiveRoundsWithLasers)).toBe(true);

    // Round count alone is never enough, no matter how far past 5 it goes.
    const manyRoundsNoLasers = { roundsPlayed: 50, laserPhaseSeen: false, sessionOver: false };
    expect(isTriggerDue(trigger, manyRoundsNoLasers)).toBe(false);
  });

  it('KI-11-01 AC2: an end-of-session question is not due until the session is actually over', () => {
    const r1 = PLAYTEST_QUESTIONS.find((question) => question.id === 'R1');
    expect(r1?.trigger.kind).toBe(TRIGGER_KINDS.END_OF_SESSION);

    const midSession = { roundsPlayed: 50, laserPhaseSeen: true, sessionOver: false };
    const ended = { roundsPlayed: 50, laserPhaseSeen: true, sessionOver: true };
    expect(isTriggerDue(/** @type {any} */ (r1).trigger, midSession)).toBe(false);
    expect(isTriggerDue(/** @type {any} */ (r1).trigger, ended)).toBe(true);
  });

  it('KI-11-01: the "generated from" line in the script names this file', () => {
    const raw = readFileSync(SCRIPT_PATH, 'utf8');
    expect(raw).toContain('src/qa/playtestQuestions.js');
  });
});
