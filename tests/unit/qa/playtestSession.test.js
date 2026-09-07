// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { findQuestionById } from '../../../src/qa/playtestQuestions.js';
import {
  SESSION_KIND,
  SESSION_SCHEMA_VERSION,
  buildSessionDocument,
  deriveRoundOutcome,
  playerLabel,
  renderMarkdownSummary,
} from '../../../src/qa/playtestSession.js';
import { runRound } from '../../sim/harness.js';

/**
 * KI-11-03 (`docs/sprints/improvement-11-playtest-capture-mode.md`): the pure half of the exported session
 * file — `src/qa/playtestSession.js` builds the JSON document and its markdown summary from plain data, no
 * DOM, so this whole file runs in Node exactly the way `tests/sim/replay.test.js` does (tech-lead note 6 on
 * issue #162).
 *
 * AC2 ("each replay in the export reproduces its round tick for tick through `tests/sim`'s harness") is
 * proved end to end in `tests/e2e/playtest-mode.spec.js` instead, against replays a real browser session
 * genuinely captured — not here. This file's own harness-driven test, near the bottom, uses the fixtures in
 * `tests/sim/replays/` (themselves valid KS-07-01 replay objects) only to prove `buildSessionDocument` never
 * corrupts a replay in transit; see that test's own doc comment for why that is a different, narrower claim.
 */

const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../sim/replays');

/** A bot that never decides anything — see `tests/sim/replay.test.js`'s own `noopBot` for why one is needed
 * to fix the player count when a replay's own `inputs`, not bot decisions, drive the round. */
function noopBot() {
  return null;
}

/** @returns {object} */
function loadReplay(file) {
  return JSON.parse(readFileSync(join(REPLAYS_DIR, file), 'utf8'));
}

const MATCH_SETTINGS = {
  bestOf: 3,
  powerUpsEnabled: true,
  colors: { 1: 'blue', 2: 'red' },
};

describe('KI-11-03 deriveRoundOutcome', () => {
  it('reads result/endReason off the replay\'s own ROUND_OVER event and latches laserPhaseSeen on a LASER_WARNING', () => {
    const replay = loadReplay('laser-both-heads-draw.json');
    expect(deriveRoundOutcome(replay)).toEqual({
      result: 'DRAW',
      endReason: 'DEATH',
      laserPhaseSeen: true,
    });
  });

  it('laserPhaseSeen is false for a round whose log never armed the lasers', () => {
    const replay = loadReplay('no-input-round.json');
    expect(deriveRoundOutcome(replay)).toEqual({
      result: 'DRAW',
      endReason: 'DEATH',
      laserPhaseSeen: false,
    });
  });

  it('reads a decisive win and a TIMEOUT the same way', () => {
    expect(deriveRoundOutcome(loadReplay('laser-boundary-dies.json'))).toEqual({
      result: 'P2_WIN',
      endReason: 'DEATH',
      laserPhaseSeen: true,
    });
    expect(deriveRoundOutcome(loadReplay('laser-inside-survives.json'))).toEqual({
      result: 'DRAW',
      endReason: 'TIMEOUT',
      laserPhaseSeen: true,
    });
  });

  it('reads null/null for a replay with no ROUND_OVER event, rather than throwing', () => {
    expect(deriveRoundOutcome({ seed: 1, settingsOverrides: {}, inputs: [], expectedEvents: [] })).toEqual({
      result: null,
      endReason: null,
      laserPhaseSeen: false,
    });
  });
});

describe('KI-11-03 playerLabel', () => {
  it('writes the export\'s own word for a player, not the bare number', () => {
    expect(playerLabel(1)).toBe('P1');
    expect(playerLabel(2)).toBe('P2');
  });
});

describe('KI-11-03 buildSessionDocument', () => {
  const round0Replay = loadReplay('laser-boundary-dies.json'); // P2_WIN, laserPhaseSeen: true
  const round1Replay = loadReplay('no-input-round.json'); // DRAW, laserPhaseSeen: false

  it('builds exactly tech-lead note 9\'s shape: kind, schemaVersion, exportedAt, matchSettings, questions, rounds, sessionAnswers', () => {
    const doc = buildSessionDocument({
      rounds: [
        { roundIndex: 0, replay: round0Replay },
        { roundIndex: 1, replay: round1Replay },
      ],
      answers: [
        { roundIndex: 0, questionId: 'V2', player: 1, value: 'yes', skipped: false },
        { roundIndex: 1, questionId: 'R1', player: 2, value: 'no', skipped: false },
      ],
      matchSettings: MATCH_SETTINGS,
      exportedAt: '2026-09-07T18:00:00.000Z',
    });

    expect(doc.kind).toBe(SESSION_KIND);
    expect(doc.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(doc.exportedAt).toBe('2026-09-07T18:00:00.000Z');
    expect(doc.matchSettings).toEqual(MATCH_SETTINGS);
    expect(Object.keys(doc).sort()).toEqual(
      ['exportedAt', 'kind', 'matchSettings', 'questions', 'rounds', 'schemaVersion', 'sessionAnswers'].sort(),
    );
  });

  it('defaults exportedAt to the current time (ISO 8601, no network) when not given', () => {
    const before = Date.now();
    const doc = buildSessionDocument({ rounds: [], answers: [], matchSettings: MATCH_SETTINGS });
    const after = Date.now();
    const parsed = Date.parse(/** @type {any} */ (doc).exportedAt);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it('matchSettings is copied, not aliased — mutating the input after the call changes nothing in the document', () => {
    const settings = { bestOf: 5, powerUpsEnabled: false, colors: { 1: 'green', 2: 'yellow' } };
    const doc = /** @type {any} */ (
      buildSessionDocument({ rounds: [], answers: [], matchSettings: settings })
    );
    settings.colors[1] = 'mutated';
    expect(doc.matchSettings.colors[1]).toBe('green');
  });

  it('rounds[i].replay is KS-07-01\'s object verbatim and nothing else — an extra field on the input replay does not leak in', () => {
    const poisoned = { ...round0Replay, notPartOfTheSchema: 'drop me' };
    const doc = /** @type {any} */ (
      buildSessionDocument({ rounds: [{ roundIndex: 0, replay: poisoned }], answers: [], matchSettings: MATCH_SETTINGS })
    );
    expect(Object.keys(doc.rounds[0].replay).sort()).toEqual(
      ['expectedEvents', 'inputs', 'seed', 'settingsOverrides'].sort(),
    );
    expect(doc.rounds[0].replay).toEqual({
      seed: round0Replay.seed,
      settingsOverrides: round0Replay.settingsOverrides,
      inputs: round0Replay.inputs,
      expectedEvents: round0Replay.expectedEvents,
    });
  });

  it('hangs roundIndex, seed, result, endReason and laserPhaseSeen beside the replay, derived from its own log', () => {
    const doc = /** @type {any} */ (
      buildSessionDocument({
        rounds: [{ roundIndex: 0, replay: round0Replay }],
        answers: [],
        matchSettings: MATCH_SETTINGS,
      })
    );
    expect(doc.rounds[0]).toMatchObject({
      roundIndex: 0,
      seed: round0Replay.seed,
      result: 'P2_WIN',
      endReason: 'DEATH',
      laserPhaseSeen: true,
    });
  });

  it('splits answers: an after-round-triggered question\'s answer lives beside its round; an end-of-session one lives in sessionAnswers, tied to no round', () => {
    // V2 is laser-phase-seen (not end-of-session); R1 is end-of-session (`src/qa/playtestQuestions.js`).
    const doc = /** @type {any} */ (
      buildSessionDocument({
        rounds: [{ roundIndex: 0, replay: round0Replay }],
        answers: [
          { roundIndex: 0, questionId: 'V2', player: 1, value: 'yes', skipped: false },
          { roundIndex: 0, questionId: 'R1', player: 2, value: 'no', skipped: false },
        ],
        matchSettings: MATCH_SETTINGS,
      })
    );
    expect(doc.rounds[0].answers).toEqual([
      { questionId: 'V2', player: 'P1', value: 'yes', skipped: false },
    ]);
    expect(doc.sessionAnswers).toEqual([
      { questionId: 'R1', player: 'P2', value: 'no', skipped: false },
    ]);
  });

  it('a skipped answer is recorded as skipped:true with value:null, never dropped', () => {
    const doc = /** @type {any} */ (
      buildSessionDocument({
        rounds: [{ roundIndex: 0, replay: round0Replay }],
        answers: [{ roundIndex: 0, questionId: 'V2', player: 2, value: null, skipped: true }],
        matchSettings: MATCH_SETTINGS,
      })
    );
    expect(doc.rounds[0].answers).toEqual([
      { questionId: 'V2', player: 'P2', value: null, skipped: true },
    ]);
  });

  it('questions is a map of only the bank entries actually offered this session, with the script\'s own words verbatim', () => {
    const doc = /** @type {any} */ (
      buildSessionDocument({
        rounds: [{ roundIndex: 0, replay: round0Replay }],
        answers: [{ roundIndex: 0, questionId: 'V2', player: 1, value: 'yes', skipped: false }],
        matchSettings: MATCH_SETTINGS,
      })
    );
    expect(Object.keys(doc.questions)).toEqual(['V2']);
    const v2 = findQuestionById('V2');
    expect(doc.questions.V2).toEqual({
      id: 'V2',
      section: v2?.section,
      question: v2?.question,
      answerType: v2?.answerType,
      trigger: v2?.trigger,
    });
  });

  it('a round with no answers gets an empty answers array, not a missing one', () => {
    const doc = /** @type {any} */ (
      buildSessionDocument({ rounds: [{ roundIndex: 0, replay: round0Replay }], answers: [], matchSettings: MATCH_SETTINGS })
    );
    expect(doc.rounds[0].answers).toEqual([]);
  });
});

describe('KI-11-03 renderMarkdownSummary', () => {
  const replay = loadReplay('laser-boundary-dies.json');

  it('tallies every answer to a question, and prints its own question text (the bank\'s own words)', () => {
    const doc = buildSessionDocument({
      rounds: [{ roundIndex: 0, replay }],
      answers: [
        { roundIndex: 0, questionId: 'V2', player: 1, value: 'yes', skipped: false },
        { roundIndex: 0, questionId: 'V2', player: 2, value: 'no', skipped: false },
      ],
      matchSettings: MATCH_SETTINGS,
    });
    const markdown = renderMarkdownSummary(doc);
    expect(markdown).toContain(findQuestionById('V2')?.question ?? '');
    expect(markdown).toContain('yes: 1');
    expect(markdown).toContain('no: 1');
  });

  it('lists every "no" answer with the round and seed it followed', () => {
    const doc = buildSessionDocument({
      rounds: [{ roundIndex: 0, replay }],
      answers: [{ roundIndex: 0, questionId: 'V2', player: 1, value: 'no', skipped: false }],
      matchSettings: MATCH_SETTINGS,
    });
    const markdown = renderMarkdownSummary(doc);
    expect(markdown).toContain(`round 0, seed ${replay.seed}`);
    expect(markdown).toContain('V2');
  });

  it('an end-of-session "no" is flagged with no round to name, not faked into one', () => {
    const doc = buildSessionDocument({
      rounds: [],
      answers: [{ roundIndex: 0, questionId: 'R1', player: 1, value: 'no', skipped: false }],
      matchSettings: MATCH_SETTINGS,
    });
    const markdown = renderMarkdownSummary(doc);
    expect(markdown).toContain('end of session');
  });

  it('says so plainly when nothing was flagged, and when no question was ever asked', () => {
    const emptyDoc = buildSessionDocument({ rounds: [], answers: [], matchSettings: MATCH_SETTINGS });
    const markdown = renderMarkdownSummary(emptyDoc);
    expect(markdown).toContain('_None._');
    expect(markdown).toContain('No questions were answered');
  });
});

// NOT the AC2 test — AC2 ("each replay in the export reproduces its round tick for tick through
// `tests/sim`'s harness") is proved end to end in `tests/e2e/playtest-mode.spec.js` instead, against replays
// a real browser session genuinely captured. The fixtures below were never captured by anything: they are
// pre-committed files `tests/sim/replay.test.js` already asserts replay correctly on their own, so feeding
// them through `buildSessionDocument` here proves a narrower, still useful claim — the document wrapper
// carries a replay through byte-identical, with nothing added or dropped inside it — not that this module's
// capture timing (tech-lead note 1 on issue #162) is correct. A test built only from these fixtures could
// stay green even if `offer()` snapshotted a round's replay one frame too late, because nothing here ever
// drives a real playtest session in the first place.
describe('KI-11-03: the session document carries a replay through byte-identical', () => {
  // Every fixture doubles as a "round this session captured" — each is already a valid KS-07-01 replay
  // object, the exact shape `buildSessionDocument` hangs inside `rounds[i].replay` unchanged.
  const files = [
    'laser-both-heads-draw.json',
    'laser-boundary-dies.json',
    'laser-inside-survives.json',
    'laser-turns-into-beam.json',
    'no-input-round.json',
    'tuning-overrides-no-input.json',
  ];
  const rounds = files.map((file, index) => ({ roundIndex: index, replay: loadReplay(file) }));

  const doc = /** @type {any} */ (buildSessionDocument({ rounds, answers: [], matchSettings: MATCH_SETTINGS }));

  it.each(doc.rounds)('round $roundIndex ($seed) replays to exactly its own expectedEvents', (round) => {
    const settings = round.replay.settingsOverrides
      ? withOverrides(round.replay.settingsOverrides)
      : SETTINGS;

    const { events } = runRound({
      seed: round.replay.seed,
      bots: [noopBot, noopBot],
      settings,
      inputLog: round.replay.inputs,
    });

    expect(events).toEqual(round.replay.expectedEvents);
  });
});
