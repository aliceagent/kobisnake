// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';
import { runRound } from '../sim/harness.js';
import { crashPlayerOneInPage, nextRoundInPage } from './helpers.js';

/**
 * KI-11-03 (`docs/sprints/improvement-11-playtest-capture-mode.md`): automatic replay capture and the
 * exported session file.
 *
 * AC2 ("each replay in the export reproduces its round tick for tick through `tests/sim`'s harness") is
 * proved *here*, against replays this file genuinely captures through a real browser session — not against a
 * pre-committed fixture. `tests/e2e/determinism.spec.js` (KI-09-01) draws the identical distinction for its
 * own `pressKey` scenario: its oracle is "a Node replay of the exact ticks the browser itself landed on"
 * (`tests/sim/harness.js`'s `runRound`), not a file nobody in this run could have influenced. `runRound`,
 * `SETTINGS` and `withOverrides` are imported directly into this file (a Playwright spec runs in Node, the
 * same way `determinism.spec.js` already does this) so the AC2 test below can feed EXPORT's own JSON back
 * through the real engine and compare full event logs — not merely check the JSON has the right *keys*.
 *
 * This is also what actually exercises tech-lead note 1 on issue #162: `session.getReplay()` returns the
 * round *currently recording*, and `startRound` resets `roundInputLog`/`roundEventLog` the moment the next
 * round begins. A snapshot taken one frame too late would still produce a well-shaped JSON document — this
 * file's AC1 assertions alone would not catch that — but its captured replay would be empty or already
 * belong to the next round, and the AC2 test's non-empty / `ROUND_OVER` / `runRound` checks below are what
 * catch exactly that.
 *
 * `tests/unit/qa/playtestSession.test.js` keeps its own, narrower fixture-based test — a genuine and useful
 * claim (`buildSessionDocument` carries a replay through unchanged) — but it is not this one: nothing in that
 * file ever drives a real playtest session, so it cannot exercise the timing bug tech-lead note 1 warns
 * about. AC2 is proved end to end only here.
 */

const PLAYTEST_QUERY = '?playtest=1&test=1&seed=1&reducedFx=1';

/**
 * A bot that never decides anything — `runRound` still needs exactly two to fix the player count, but a
 * replay's own `inputs`, not bot decisions, drive the round (`tests/sim/harness.js`, `tests/sim/replay.test
 * .js`'s own `noopBot`).
 * @returns {null}
 */
function noopBot() {
  return null;
}

/**
 * Starts a Best of 1 match and plays its countdown out. Best of 1 so round 1's decisive win ends the match
 * the instant it is recorded, which is what puts every `end-of-session` question
 * (`src/qa/playtestQuestions.js`) due in that same gap.
 * @returns {string}
 */
function startBo1MatchInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.startMatch({ bestOf: 1 });
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0);
  return kobi.getState();
}

/**
 * Leaves both snakes running straight from spawn with no input at all — exactly the scenario
 * `tests/sim/replays/no-input-round.json` fixes under the shipping default settings: both crash into their
 * own walls on the same tick, a DRAW, with no laser ever armed and no win recorded for either player. Used
 * here as round 0 precisely because it needs no keys pressed and no due question follows it (`roundsPlayed:
 * 1`, no laser, match not yet over) — a clean "this round has only a replay, no answers" case. Its own
 * captured replay legitimately has an empty `inputs` array (nothing was ever pressed) — this is why the
 * non-empty checks below are on `expectedEvents`, never on `inputs`.
 * @returns {{state: string, match: object | null}}
 */
function playNoInputRoundInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.fastForward(5);
  return { state: kobi.getState(), match: kobi.getMatch() };
}

/**
 * Plays the two rounds, answers exactly three questions, exports, and returns the parsed session document.
 * Real `page` interaction (locators, keyboard), not something serialisable into `page.evaluate` — both AC1
 * and AC2 below start from this same script so each is provable independently, at the cost of playing the
 * two rounds twice; `tests/e2e/tuning.spec.js` and `playtest-prompt.spec.js` already accept the same
 * duplication for the same reason (one test, one acceptance criterion, CLAUDE.md's own convention).
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<any>}
 */
async function playTwoRoundsAnswerThreeQuestionsAndExport(page) {
  await page.goto(PLAYTEST_QUERY);
  await page.evaluate(startBo1MatchInPage);

  // Round 0: no input at all — both snakes crash into their own walls on the same tick, a DRAW. Nothing is
  // due yet, so the prompt stays hidden; this round contributes only its replay, no answers.
  await page.evaluate(playNoInputRoundInPage);
  await expect(page.locator('[data-playtest-prompt]')).toBeHidden();
  await page.evaluate(nextRoundInPage);

  // Round 1: P1 crashes into the top wall — P2's only win, and Best of 1 ends the match the instant this
  // round is recorded. Every `end-of-session` question becomes due in the same gap; V1 and R1 are the first
  // two in the bank's own order (`src/qa/playtestQuestions.js`). Not V1 and V3: KI-11-05 (#169) gates `V3`
  // and `G2` on practice mode existing, which it does not until Sprint 15, so they are skipped over here.
  await page.evaluate(crashPlayerOneInPage);
  await expect(page.locator('[data-playtest-prompt]')).toBeVisible();
  // Tech-lead note 4 on issue #161 (carried over from KI-11-02): the state machine itself never leaves
  // ROUND_OVER while the gap is open, match-over included.
  expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('ROUND_OVER');
  await expect(page.locator('[data-playtest-question="V1"]')).toBeVisible();
  await expect(page.locator('[data-playtest-question="R1"]')).toBeVisible();

  // Answer exactly three fields — V1:P1, V1:P2, R1:P1 — and leave R1:P2 untouched, on purpose: EXPORT must
  // be reachable "at any time" (the ticket's own words), including with a gap still open, and this proves
  // both halves of that claim in the same run.
  await expect(page.locator('[data-playtest-field="V1:1"]')).toHaveClass(/--focused/);
  await page.keyboard.press('Enter'); // V1:P1 = 'yes' (the default)
  await expect(page.locator('[data-playtest-field="V1:2"]')).toHaveClass(/--focused/);
  await page.keyboard.press('ArrowLeft'); // P2's LEFT: 'yes' -> 'no'
  await page.keyboard.press('Enter'); // V1:P2 = 'no'
  await expect(page.locator('[data-playtest-field="R1:1"]')).toHaveClass(/--focused/);
  await page.keyboard.press('Enter'); // R1:P1 = 'yes' (the default)
  await expect(page.locator('[data-playtest-field="R1:2"]')).toHaveClass(/--focused/); // left unconfirmed

  await page.locator('[data-playtest-export-button]').click();

  // Reachable "another way too" regardless of clipboard permission (tuning.js's own tech-lead note 6) — the
  // fallback textarea is what an e2e spec reads, with no clipboard permission granted at all.
  const json = await page.locator('[data-playtest-export-json]').inputValue();
  return JSON.parse(json);
}

test.describe('KI-11-03 automatic replay capture and the session file', () => {
  test('AC1: two rounds played under the flag, three questions answered, EXPORT\'s JSON carries both replays and all three answers', async ({
    page,
  }) => {
    const doc = await playTwoRoundsAnswerThreeQuestionsAndExport(page);

    expect(doc.kind).toBe('kobisnake-playtest-session');
    expect(doc.rounds).toHaveLength(2);
    expect(doc.rounds[0].result).toBe('DRAW');
    expect(doc.rounds[0].replay.expectedEvents.length).toBeGreaterThan(0);
    expect(doc.rounds[0].answers).toEqual([]);
    expect(doc.rounds[1].result).toBe('P2_WIN');
    expect(doc.rounds[1].endReason).toBe('DEATH');
    expect(doc.rounds[1].replay.expectedEvents.length).toBeGreaterThan(0);
    expect(doc.rounds[1].answers).toEqual([]);

    // V1 and R1 are both `end-of-session` questions (`playtestQuestions.js`) — they follow no particular
    // round, so all three answers land in `sessionAnswers`, never faked into a round's own `answers`.
    expect(doc.sessionAnswers).toHaveLength(3);
    expect(doc.sessionAnswers).toEqual(
      expect.arrayContaining([
        { questionId: 'V1', player: 'P1', value: 'yes', skipped: false },
        { questionId: 'V1', player: 'P2', value: 'no', skipped: false },
        { questionId: 'R1', player: 'P1', value: 'yes', skipped: false },
      ]),
    );
    expect(doc.questions.V1.question).toBe('Find your head'); // the script's own words, verbatim
    expect(doc.questions.R1.question).toBe('"Does 90 s feel right?"');

    // The status message must be visible, never silent, whichever branch the clipboard write took.
    const status = await page.locator('[data-playtest-export-status]').textContent();
    expect(status?.trim().length).toBeGreaterThan(0);

    // The markdown summary is rendered alongside the JSON from the same document.
    const markdown = await page.locator('[data-playtest-export-markdown]').inputValue();
    expect(markdown).toContain('Find your head');
    expect(markdown).toContain('no: 1');

    // The download offer: a same-origin object URL, never a network address.
    const downloadHref = await page.locator('[data-playtest-export-download]').getAttribute('href');
    expect(downloadHref).toMatch(/^blob:/);
  });

  test('AC2: each replay in the export reproduces its round tick for tick through tests/sim\'s harness', async ({
    page,
  }) => {
    const doc = await playTwoRoundsAnswerThreeQuestionsAndExport(page);
    expect(doc.rounds).toHaveLength(2);

    for (const round of doc.rounds) {
      // Non-empty and ending in `ROUND_OVER` on every captured round: the check that actually catches tech-
      // lead note 1's timing bug (a snapshot taken one frame too late reads back the *next* round's already-
      // reset, still-in-progress logs, not this one's). `inputs` is not checked here — round 0's own is
      // legitimately `[]` (no key was ever pressed that round); round 1's crash still gives at least one
      // recorded input, asserted separately below.
      expect(round.replay.expectedEvents.length).toBeGreaterThan(0);
      expect(round.replay.expectedEvents.at(-1).type).toBe('ROUND_OVER');

      const settings = Object.keys(round.replay.settingsOverrides).length
        ? withOverrides(round.replay.settingsOverrides)
        : SETTINGS;
      const { events } = runRound({
        seed: round.replay.seed,
        bots: [noopBot, noopBot],
        settings,
        inputLog: round.replay.inputs,
      });
      expect(events).toEqual(round.replay.expectedEvents);
    }

    // Round 1's scripted crash leaves at least one recorded input — proof this replay is a real capture, not
    // an empty shell that merely "reproduces" itself trivially.
    expect(doc.rounds[1].replay.inputs.length).toBeGreaterThan(0);
  });

  test('AC3: EXPORT (clipboard, textarea, and the download link) fires no network request', async ({
    page,
  }) => {
    await page.goto(PLAYTEST_QUERY);
    await page.evaluate(startBo1MatchInPage);
    await page.evaluate(playNoInputRoundInPage);

    /** @type {string[]} */
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));

    await page.locator('[data-playtest-export-button]').click();
    await expect(page.locator('[data-playtest-export-status]')).not.toHaveText('');

    expect(requests, `requests fired by EXPORT: ${requests.join(', ')}`).toEqual([]);
  });

  test('without ?playtest=1 there is no prompt and no export affordance at all', async ({ page }) => {
    await page.goto('?test=1&seed=1&reducedFx=1');
    expect(await page.locator('[data-playtest-prompt]').count()).toBe(0);
    expect(await page.locator('[data-playtest-export]').count()).toBe(0);
  });
});
