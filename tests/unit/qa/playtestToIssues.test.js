// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  allAnswers,
  evidenceRound,
  isFailingAnswer,
  issuesFor,
  readSessionFile,
  render,
  renderTrailer,
  resolveQuestion,
} from '../../../scripts/playtest-to-issues.mjs';
import { runRound } from '../../sim/harness.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/**
 * KI-11-04: the formatter behind `scripts/playtest-to-issues.mjs` (the ticket's own "QA: unit (the script's
 * formatter)").
 *
 * The fixture is **not hand-written**. `tests/unit/qa/__fixtures__/playtest-session-two-rounds.json` is a
 * real export, produced by driving `?playtest=1` through a browser exactly as KI-11-03's AC1 e2e test does —
 * two rounds played, three questions answered, EXPORT clicked — and saved verbatim. That is what AC1 means by
 * "the AC1 fixture from KI-11-03": if the export's shape ever drifts from what this script reads, these tests
 * fail rather than passing against a convenient object nobody's browser ever produced.
 */

const FIXTURE = fileURLToPath(
  new URL('./__fixtures__/playtest-session-two-rounds.json', import.meta.url),
);

/** @type {any} */
const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** A bot that never decides anything: `inputLog` drives the round, but `runRound` still needs exactly two. */
function noopBot() {
  return null;
}

describe('KI-11-04 the fixture is a real export, not a hand-written object', () => {
  it('is a session document with two played rounds and three answers', () => {
    expect(doc.kind).toBe('kobisnake-playtest-session');
    expect(doc.rounds).toHaveLength(2);
    expect(allAnswers(doc)).toHaveLength(3);
    // Every round carries a real recorded log — an empty one would make the replay assertions below vacuous.
    for (const round of doc.rounds) {
      expect(round.replay.expectedEvents.length).toBeGreaterThan(0);
      expect(round.replay.expectedEvents.at(-1).type).toBe('ROUND_OVER');
    }
  });
});

describe('KI-11-04 isFailingAnswer', () => {
  it('a yes/no answer fails on "no" and passes on "yes"', () => {
    const v1 = resolveQuestion(doc, 'V1');
    expect(isFailingAnswer({ questionId: 'V1', player: 'P2', value: 'no', skipped: false }, v1)).toBe(true);
    expect(isFailingAnswer({ questionId: 'V1', player: 'P1', value: 'yes', skipped: false }, v1)).toBe(false);
  });

  it('a choice answer fails when the script\'s own pass condition does not name it', () => {
    // A4's pass condition is `≥ 4/5 rounds "exciting".` — the script names the passing word, so nothing here
    // has to decide which one it is.
    const a4 = /** @type {any} */ (resolveQuestion(doc, 'A4'));
    expect(a4.passCondition).toContain('exciting');
    expect(isFailingAnswer({ questionId: 'A4', player: 'P1', value: 'exciting', skipped: false }, a4)).toBe(false);
    expect(isFailingAnswer({ questionId: 'A4', player: 'P1', value: 'frustrating', skipped: false }, a4)).toBe(true);

    // A2's is `Majority say "about right".`
    const a2 = /** @type {any} */ (resolveQuestion(doc, 'A2'));
    expect(isFailingAnswer({ questionId: 'A2', player: 'P2', value: 'about right', skipped: false }, a2)).toBe(false);
    expect(isFailingAnswer({ questionId: 'A2', player: 'P2', value: 'too early', skipped: false }, a2)).toBe(true);
    expect(isFailingAnswer({ questionId: 'A2', player: 'P2', value: 'too late', skipped: false }, a2)).toBe(true);
  });

  it('a skipped answer is never a failure', () => {
    const v1 = resolveQuestion(doc, 'V1');
    expect(isFailingAnswer({ questionId: 'V1', player: 'P2', value: null, skipped: true }, v1)).toBe(false);
  });

  it('the yes/no rule is not the substring rule — C1 names both words in its own pass condition', () => {
    // The reason the two answer types are decided differently: a substring test cannot discriminate here.
    const c1 = /** @type {any} */ (resolveQuestion(doc, 'C1'));
    expect(c1.passCondition).toContain('yes');
    expect(c1.passCondition).toContain('no');
    expect(isFailingAnswer({ questionId: 'C1', player: 'P1', value: 'no', skipped: false }, c1)).toBe(true);
    expect(isFailingAnswer({ questionId: 'C1', player: 'P1', value: 'yes', skipped: false }, c1)).toBe(false);
  });
});

describe('KI-11-04 resolveQuestion', () => {
  it('fills the script cells the export does not carry, from the bank', () => {
    // The export's own `questions` map is small by design (it exists to make the file readable), so the
    // procedure and pass condition come from `src/qa/playtestQuestions.js`, the source of record.
    expect(doc.questions.V1.passCondition).toBeUndefined();
    const v1 = /** @type {any} */ (resolveQuestion(doc, 'V1'));
    expect(v1.passCondition).toBe('Both players find it in < 1 s every time.');
    expect(v1.procedure).toBe('Glance away, look back, point at your head.');
    expect(v1.sectionTitle).toBe('Visibility');
  });

  it('the export wins on any field it carries, so an old session prints the words those players saw', () => {
    const stale = { ...doc, questions: { V1: { ...doc.questions.V1, question: 'Spot your head' } } };
    expect(/** @type {any} */ (resolveQuestion(stale, 'V1')).question).toBe('Spot your head');
    // ...while still gaining the cells the export never carried.
    expect(/** @type {any} */ (resolveQuestion(stale, 'V1')).passCondition).toBe(
      'Both players find it in < 1 s every time.',
    );
  });

  it('returns undefined for an id in neither the export nor the bank', () => {
    expect(resolveQuestion(doc, 'ZZ9')).toBeUndefined();
  });
});

describe('KI-11-04 AC1: one issue body per "no", each with a replay', () => {
  const issues = issuesFor(doc);

  it('KI-11-04 AC1: the fixture\'s single "no" produces exactly one issue', () => {
    const nos = allAnswers(doc).filter((entry) => entry.answer.value === 'no');
    expect(nos).toHaveLength(1);
    expect(issues).toHaveLength(nos.length);
    expect(issues[0].title).toBe('[Playtest] V1 Find your head — P2 answered "no"');
  });

  it('KI-11-04 AC1: the issue carries the question in the script\'s own words', () => {
    const { body } = issues[0];
    expect(body).toContain('## V1 Find your head');
    expect(body).toContain('Glance away, look back, point at your head.');
    expect(body).toContain('Both players find it in < 1 s every time.');
  });

  it('KI-11-04 AC1: the issue carries both players\' words, and marks which one failed', () => {
    const { body } = issues[0];
    expect(body).toContain('`P1`: **yes**');
    expect(body).toContain('`P2`: **no** ← fails the pass condition');
  });

  it('KI-11-04 AC1: the issue carries the round\'s seed and its replay', () => {
    const { body } = issues[0];
    const evidence = /** @type {any} */ (evidenceRound(doc, null));
    expect(body).toContain(`**Seed:** \`${evidence.seed}\``);
    expect(body).toContain('```json');
    // The replay is embedded whole, not summarised — parse it back out and prove it is the real one.
    const embedded = JSON.parse(body.slice(body.indexOf('```json') + 7, body.lastIndexOf('```')).trim());
    expect(embedded).toEqual(evidence.replay);
  });

  it('KI-11-04 AC1: the embedded replay reproduces its round tick for tick through the sim harness', () => {
    // The point of attaching a replay at all: whoever reads this issue can reproduce the round. If the body
    // ever carried a replay that does not replay, the issue would be evidence of nothing.
    const { body } = issues[0];
    const replay = JSON.parse(body.slice(body.indexOf('```json') + 7, body.lastIndexOf('```')).trim());
    const settings = Object.keys(replay.settingsOverrides).length
      ? withOverrides(replay.settingsOverrides)
      : SETTINGS;
    const { events } = runRound({
      seed: replay.seed,
      bots: [noopBot, noopBot],
      settings,
      inputLog: replay.inputs,
    });
    expect(events).toEqual(replay.expectedEvents);
  });

  it('says out loud that an end-of-session question follows no single round', () => {
    expect(issues[0].body).toContain('**end-of-session** question, so it follows no single round');
  });
});

describe('KI-11-04 the trailer and the empty case', () => {
  it('counts what passed and what was skipped, without filing either', () => {
    const trailer = renderTrailer(doc);
    expect(trailer).toContain('2 round(s), 3 answer(s)');
    expect(trailer).toContain('2 within the pass condition');
    expect(trailer).toContain('0 skipped');
  });

  it('lists skipped answers so they are visible without being filed', () => {
    const withSkip = {
      ...doc,
      sessionAnswers: [
        ...doc.sessionAnswers,
        { questionId: 'V3', player: 'P2', value: null, skipped: true },
      ],
    };
    expect(issuesFor(withSkip)).toHaveLength(1); // a skip is still not a finding
    expect(renderTrailer(withSkip)).toContain('V3 P2');
    expect(renderTrailer(withSkip)).toContain('1 skipped');
  });

  it('a session with nothing failing says so rather than printing nothing at all', () => {
    const allPassing = {
      ...doc,
      sessionAnswers: doc.sessionAnswers.map((/** @type {any} */ a) => ({ ...a, value: 'yes' })),
    };
    expect(issuesFor(allPassing)).toHaveLength(0);
    expect(render(allPassing)).toContain('No answer in this session failed its pass condition');
  });

  it('a session with no rounds at all still formats, saying there is no replay to attach', () => {
    const noRounds = { ...doc, rounds: [] };
    const issues = issuesFor(noRounds);
    expect(issues).toHaveLength(1);
    expect(issues[0].body).toContain('no rounds, so there is no replay to attach');
  });
});

describe('KI-11-04 readSessionFile', () => {
  it('reads the fixture', () => {
    expect(readSessionFile(FIXTURE).kind).toBe('kobisnake-playtest-session');
  });

  it('refuses a JSON file that is not a session export, naming what it wanted', () => {
    const notASession = fileURLToPath(
      new URL('../../sim/replays/no-input-round.json', import.meta.url),
    );
    expect(() => readSessionFile(notASession)).toThrow(/kobisnake-playtest-session/);
  });
});

describe('KI-11-04 render', () => {
  it('numbers each issue and prints its title and body', () => {
    const out = render(doc);
    expect(out).toContain('ISSUE 1 of 1');
    expect(out).toContain('TITLE: [Playtest] V1 Find your head — P2 answered "no"');
    expect(out).toContain('Both players find it in < 1 s every time.');
  });
});

describe('KI-11-04 formatIssue', () => {
  it('notes when only one player answered before the gap closed', () => {
    const oneOnly = {
      ...doc,
      sessionAnswers: [{ questionId: 'V1', player: 'P2', value: 'no', skipped: false }],
    };
    const [issue] = issuesFor(oneOnly);
    expect(issue.body).toContain('Only one player answered this question');
  });

  it('a round-attached answer names its own round, not the last one', () => {
    const attached = {
      ...doc,
      sessionAnswers: [],
      rounds: doc.rounds.map((/** @type {any} */ round, /** @type {number} */ index) =>
        index === 0
          ? { ...round, answers: [{ questionId: 'V1', player: 'P1', value: 'no', skipped: false }] }
          : round,
      ),
    };
    const [issue] = issuesFor(attached);
    expect(issue.body).toContain('Round 0 — the round this question followed.');
    expect(issue.body).toContain(`**Seed:** \`${doc.rounds[0].seed}\``);
  });
});
