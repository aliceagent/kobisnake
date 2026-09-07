// @ts-check
import { describe, expect, it } from 'vitest';
import {
  MAX_QUESTIONS_PER_GAP,
  YES_NO_CHOICES,
  createPlaytestPromptState,
  selectDueQuestions,
} from '../../../src/ui/screens/playtestPrompt.js';
import { PLAYTEST_QUESTIONS } from '../../../src/qa/playtestQuestions.js';

/**
 * KI-11-02: the pure logic behind the `?playtest=1` between-round prompt — selection, the two-question cap,
 * the turn sequence, attribution, and the re-queue rule the sprint file names by name ("turning a playtest
 * into a form"). No DOM here (`tests/e2e/playtest-prompt.spec.js` covers the rendered half and AC1's "no DOM
 * node without the flag"), matching the ticket's own "unit for the selection/re-queue/attribution logic
 * (pure, in Node)".
 */

/** M1-M4 are due at `roundsPlayed: 3` with no laser phase required — the smallest facts that make exactly
 * four questions due at once, useful for exercising the two-question cap. */
const FACTS_AFTER_3_ROUNDS = { roundsPlayed: 3, laserPhaseSeen: false, sessionOver: false };
const NOTHING_DUE = { roundsPlayed: 0, laserPhaseSeen: false, sessionOver: false };

describe('selectDueQuestions', () => {
  it('returns nothing when no trigger is satisfied', () => {
    expect(selectDueQuestions(NOTHING_DUE, new Set())).toEqual([]);
  });

  it(`never returns more than MAX_QUESTIONS_PER_GAP (${MAX_QUESTIONS_PER_GAP})`, () => {
    // M1-M4 are all due at roundsPlayed: 3 (four candidates), the sprint's own risk-mitigation cap still
    // holds it to two.
    const due = selectDueQuestions(FACTS_AFTER_3_ROUNDS, new Set());
    expect(due.length).toBe(MAX_QUESTIONS_PER_GAP);
    expect(due.map((q) => q.id)).toEqual(['M1', 'M2']);
  });

  it('skips already-answered questions and offers the next ones in bank order', () => {
    const due = selectDueQuestions(FACTS_AFTER_3_ROUNDS, new Set(['M1', 'M2']));
    expect(due.map((q) => q.id)).toEqual(['M3', 'M4']);
  });

  it('a laser-gated question is never due without the laser phase, however many rounds are played', () => {
    // A2 requires both `roundsPlayed >= 5` and `laserPhaseSeen` (KI-11-01's own fix for exactly this bug).
    const facts = { roundsPlayed: 100, laserPhaseSeen: false, sessionOver: false };
    const dueIds = selectDueQuestions(facts, new Set(PLAYTEST_QUESTIONS.map((q) => q.id).filter((id) => id !== 'A2'))).map(
      (q) => q.id,
    );
    expect(dueIds).not.toContain('A2');
  });
});

describe('createPlaytestPromptState: offering a gap', () => {
  it('offer() returns false and opens nothing when no question is due', () => {
    const state = createPlaytestPromptState();
    expect(state.offer(NOTHING_DUE, 0)).toBe(false);
    expect(state.isOpen()).toBe(false);
    expect(state.getFields()).toEqual([]);
    expect(state.getFocusIndex()).toBe(-1);
  });

  it('offer() builds P1 then P2 fields per selected question, focused on the first', () => {
    const state = createPlaytestPromptState();
    expect(state.offer(FACTS_AFTER_3_ROUNDS, 2)).toBe(true);
    expect(state.isOpen()).toBe(true);
    const fields = state.getFields();
    expect(fields.map((f) => `${f.questionId}:${f.player}`)).toEqual(['M1:1', 'M1:2', 'M2:1', 'M2:2']);
    expect(state.getFocusIndex()).toBe(0);
    // M1/M2 are yes-no questions: no invented choices, just the two words the tech-lead ruling sanctioned.
    for (const field of fields) {
      expect(field.choices).toEqual(YES_NO_CHOICES);
      expect(field.confirmed).toBe(false);
    }
  });

  it('offer() is a no-op while a gap is already open', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    expect(state.offer(FACTS_AFTER_3_ROUNDS, 1)).toBe(false);
    // Confirming now still stamps the *first* call's round index, proving the second `offer()` changed
    // nothing about the open gap.
    state.handleAction('CONFIRM');
    expect(state.getAnswers()[0].roundIndex).toBe(0);
  });

  it('a choice question (A2) builds a field with the script-verbatim choices, not yes/no', () => {
    const facts = { roundsPlayed: 5, laserPhaseSeen: true, sessionOver: false };
    // Answer every earlier-in-bank-order due question so A2 is the next one selected.
    const answered = new Set(['M1', 'M2', 'M3', 'M4', 'V2', 'C1', 'C2', 'C3', 'A1']);
    // `selectDueQuestions` is the function `offer` itself calls to build a gap's fields, so this proves the
    // same guarantee `offer` relies on: a choice question keeps its own script-verbatim `choices`.
    const due = selectDueQuestions(facts, answered);
    expect(due.map((q) => q.id)).toEqual(['A2', 'A3']);
    expect(due[0].choices).toEqual(['too early', 'too late', 'about right']);
  });
});

describe('createPlaytestPromptState: LEFT/RIGHT cycles the focused field only', () => {
  it('wraps around a yes/no field', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    expect(state.getFields()[0].choiceIndex).toBe(0); // 'yes'
    state.handleAction('LEFT'); // wraps backward from 0
    expect(state.getFields()[0].choiceIndex).toBe(1); // 'no'
    state.handleAction('LEFT');
    expect(state.getFields()[0].choiceIndex).toBe(0); // back to 'yes'
    state.handleAction('RIGHT');
    expect(state.getFields()[0].choiceIndex).toBe(1);
  });

  it('never moves a field once it is confirmed', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    state.handleAction('CONFIRM'); // confirms M1:1 at its default choice
    state.handleAction('LEFT'); // now focused on M1:2 — should not touch the confirmed M1:1
    const [first] = state.getFields();
    expect(first.confirmed).toBe(true);
    expect(first.choiceIndex).toBe(0);
  });

  it('UP/DOWN and any other action are simply ignored (no third input scheme)', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    const before = state.getFields();
    state.handleAction('UP');
    state.handleAction('DOWN');
    expect(state.getFields()).toEqual(before);
    expect(state.getFocusIndex()).toBe(0);
  });
});

describe('createPlaytestPromptState: CONFIRM attribution and question completion (AC2)', () => {
  it('confirming every field records one answer per (question, player), tagged and round-stamped', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 4);
    state.handleAction('RIGHT'); // M1:1 -> 'no'
    state.handleAction('CONFIRM'); // commits M1:1='no', advances to M1:2
    state.handleAction('CONFIRM'); // commits M1:2='yes' (default), advances to M2:1
    state.handleAction('CONFIRM'); // commits M2:1='yes'
    state.handleAction('CONFIRM'); // commits M2:2='yes' — gap closes, all four fields done

    expect(state.isOpen()).toBe(false);
    expect(state.getAnswers()).toEqual([
      { roundIndex: 4, questionId: 'M1', player: 1, value: 'no', skipped: false },
      { roundIndex: 4, questionId: 'M1', player: 2, value: 'yes', skipped: false },
      { roundIndex: 4, questionId: 'M2', player: 1, value: 'yes', skipped: false },
      { roundIndex: 4, questionId: 'M2', player: 2, value: 'yes', skipped: false },
    ]);
  });

  it('a question fully answered by both players is never offered again', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    state.handleAction('CONFIRM'); // M1:1
    state.handleAction('CONFIRM'); // M1:2
    state.handleAction('CONFIRM'); // M2:1
    state.handleAction('CONFIRM'); // M2:2 — gap closes

    // M1 and M2 are both fully answered; M3/M4 are the next due questions in bank order.
    expect(state.offer(FACTS_AFTER_3_ROUNDS, 1)).toBe(true);
    expect(state.getFields().map((f) => f.questionId)).toEqual(['M3', 'M3', 'M4', 'M4']);
  });
});

describe('createPlaytestPromptState: BACK/Esc — the "not a form" risk (AC5/tech-lead note 5)', () => {
  it('Esc closes the whole gap immediately, recording a skipped entry for every unconfirmed field', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 7);
    state.handleAction('CONFIRM'); // M1:1 confirmed
    state.handleAction('BACK'); // Esc — bail out with M1:2, M2:1, M2:2 still unanswered

    expect(state.isOpen()).toBe(false);
    expect(state.getAnswers()).toEqual([
      { roundIndex: 7, questionId: 'M1', player: 1, value: 'yes', skipped: false },
      { roundIndex: 7, questionId: 'M1', player: 2, value: null, skipped: true },
      { roundIndex: 7, questionId: 'M2', player: 1, value: null, skipped: true },
      { roundIndex: 7, questionId: 'M2', player: 2, value: null, skipped: true },
    ]);
  });

  it('a question interrupted before both players answered is not marked answered, and comes back later', () => {
    const state = createPlaytestPromptState();
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    state.handleAction('CONFIRM'); // M1:1 only
    state.handleAction('BACK'); // Esc before M1:2

    // M1 is still due (only one of its two fields was ever confirmed) and is offered again, fresh — both
    // fields — in the very next gap this test opens. This is the sprint's own "a skipped question comes back
    // later rather than being lost", proved directly rather than only by inspecting internal state.
    expect(state.offer(FACTS_AFTER_3_ROUNDS, 1)).toBe(true);
    expect(state.getFields().map((f) => `${f.questionId}:${f.player}`)).toEqual(['M1:1', 'M1:2', 'M2:1', 'M2:2']);
  });

  it('a question fully answered earlier in the same session is not re-asked, even after a later Esc', () => {
    const state = createPlaytestPromptState();
    // First gap: fully answer M1 and M2.
    state.offer(FACTS_AFTER_3_ROUNDS, 0);
    state.handleAction('CONFIRM');
    state.handleAction('CONFIRM');
    state.handleAction('CONFIRM');
    state.handleAction('CONFIRM');

    // Second gap: M3/M4 are next up; answer M3's P1 field, then Esc before anything else.
    state.offer(FACTS_AFTER_3_ROUNDS, 1);
    state.handleAction('CONFIRM'); // M3:1
    state.handleAction('BACK');

    // Third gap: M1/M2 must not reappear (already fully answered); M3/M4 do (M3 only half-done, M4 untouched).
    state.offer(FACTS_AFTER_3_ROUNDS, 2);
    expect(state.getFields().map((f) => f.questionId)).toEqual(['M3', 'M3', 'M4', 'M4']);
  });

  it('Esc with nothing open is a harmless no-op', () => {
    const state = createPlaytestPromptState();
    state.handleAction('BACK');
    expect(state.isOpen()).toBe(false);
    expect(state.getAnswers()).toEqual([]);
  });
});

describe('createPlaytestPromptState: at most two questions, never re-offered mid-gap', () => {
  it('only ever asks the two selected questions for one gap, however many are due', () => {
    // At roundsPlayed 5 with the laser phase seen, M1-M4/C1-C3/A2/V2/A1/A3/A4 are all simultaneously due —
    // far more than two — and the cap still holds for the whole gap.
    const facts = { roundsPlayed: 5, laserPhaseSeen: true, sessionOver: false };
    const state = createPlaytestPromptState();
    state.offer(facts, 0);
    const questionIds = new Set(state.getFields().map((f) => f.questionId));
    expect(questionIds.size).toBe(MAX_QUESTIONS_PER_GAP);
    // Confirming every field must not pull in a third question mid-gap even though more are due.
    state.handleAction('CONFIRM');
    state.handleAction('CONFIRM');
    expect(new Set(state.getFields().map((f) => f.questionId))).toEqual(questionIds);
  });
});
