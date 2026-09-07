// @ts-check
import { expect, test } from '@playwright/test';
import { crashPlayerOneInPage, nextRoundInPage } from './helpers.js';

/**
 * KI-11-02: the `?playtest=1` between-round prompt.
 *
 * AC1's two halves — present with the flag, genuinely absent (not merely hidden) without it — follow the
 * exact shape `tests/e2e/tuning.spec.js`'s own AC3 cases use for `?tuning=1` (tech-lead note 1 on issue
 * #161). AC2 is proven end to end here rather than only in the pure unit tests: real keys, the real DOM, the
 * real `session.js` wiring, ending in `__kobi.getPlaytestAnswers()` — the plain-data getter `main.js` exposes
 * on `window.__kobi` for exactly this (declared in the PR: outside this ticket's `Files:` list is
 * `testHooks.js` itself, which is never touched — the getter is attached in `main.js` alone).
 *
 * `M1`-`M4` (`src/qa/playtestQuestions.js`) are due after 3 rounds and need no laser phase, so every test
 * below plays a match to Best of 5 (not the default Best of 3) — two straight P2 wins would end a Bo3 match
 * before a third round, and its own scoreboard-under-a-decided-match gap, ever happens.
 */

const PLAYTEST_QUERY = '?playtest=1&test=1&seed=1&reducedFx=1';

/**
 * Starts a Best of 5 match and plays its countdown out. A plain function (no closures) so it survives
 * `page.evaluate`'s serialisation, matching every helper in `./helpers.js`.
 * @returns {string}
 */
function startBo5MatchInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.startMatch({ bestOf: 5 });
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0);
  return kobi.getState();
}

test.describe('KI-11-02 the between-round prompt', () => {
  test('AC1: a round played under ?playtest=1 is followed by a prompt; the same play without the flag, and a plain load, have no prompt node at all', async ({
    page,
  }) => {
    await page.goto(PLAYTEST_QUERY);
    await page.evaluate(startBo5MatchInPage);

    // Rounds 1 and 2: M1-M4 are not due yet (`afterRound(3)`) — the node exists (the flag is on) but stays
    // hidden, since there is nothing to offer this gap.
    await page.evaluate(crashPlayerOneInPage);
    await expect(page.locator('[data-playtest-prompt]')).toBeHidden();
    await page.evaluate(nextRoundInPage);
    await page.evaluate(crashPlayerOneInPage);
    await expect(page.locator('[data-playtest-prompt]')).toBeHidden();
    await page.evaluate(nextRoundInPage);

    // Round 3: M1 and M2 become due the instant this round is recorded.
    await page.evaluate(crashPlayerOneInPage);
    await expect(page.locator('[data-playtest-prompt]')).toHaveCount(1);
    await expect(page.locator('[data-playtest-prompt]')).toBeVisible();
    await expect(page.locator('[data-playtest-question="M1"]')).toBeVisible();
    // The script's own words, verbatim — no invented copy.
    await expect(page.locator('[data-playtest-question="M1"]')).toContainText('Responsive');
    // Tech-lead note 4: the state machine itself never leaves ROUND_OVER while the prompt is up.
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'ROUND_OVER',
    );

    // Absent with `?test=1` alone (no `?playtest=1`) — a fresh load, no gap to reach.
    await page.goto('?test=1&seed=1&reducedFx=1');
    expect(await page.locator('[data-playtest-prompt]').count()).toBe(0);

    // Absent from a plain production load — not merely hidden but genuinely never built, the same discipline
    // `tuning.spec.js`'s own AC3 applies to `[data-tuning-overlay]` and `test-hooks.spec.js` applies to
    // `window.__kobi` itself.
    await page.goto('/');
    expect(await page.locator('[data-playtest-prompt]').count()).toBe(0);
    expect(await page.evaluate(() => typeof (/** @type {any} */ (globalThis).__kobi))).toBe(
      'undefined',
    );
  });

  test('AC2: answers are attributed to a player and stored with the round they follow', async ({
    page,
  }) => {
    await page.goto(PLAYTEST_QUERY);
    await page.evaluate(startBo5MatchInPage);

    await page.evaluate(crashPlayerOneInPage); // round 0
    await page.evaluate(nextRoundInPage);
    await page.evaluate(crashPlayerOneInPage); // round 1
    await page.evaluate(nextRoundInPage);
    await page.evaluate(crashPlayerOneInPage); // round 2: M1 then M2 become due

    await expect(page.locator('[data-playtest-prompt]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'ROUND_OVER',
    );

    // M1:1 (P1's field) is focused first. Move it off the default 'yes' with P1's own key (`DESIGN-DECISIONS
    // §3`: WASD), then confirm with Enter.
    await expect(page.locator('[data-playtest-field="M1:1"]')).toHaveClass(/--focused/);
    await page.keyboard.press('d'); // P1's RIGHT
    await expect(
      page.locator('[data-playtest-field="M1:1"] .playtest-prompt-choice--selected'),
    ).toHaveText('no');
    await page.keyboard.press('Enter');

    // Still ROUND_OVER — confirming a field never leaves the state (AC3).
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'ROUND_OVER',
    );
    await expect(page.locator('[data-playtest-field="M1:1"]')).toHaveClass(/--answered/);

    // M1:2 (P2's field): accept the default 'yes' with a bare Enter.
    await expect(page.locator('[data-playtest-field="M1:2"]')).toHaveClass(/--focused/);
    await page.keyboard.press('Enter');

    // M2:1 (P1's field): accept the default 'yes'.
    await expect(page.locator('[data-playtest-field="M2:1"]')).toHaveClass(/--focused/);
    await page.keyboard.press('Enter');

    // M2:2 (P2's field): move it with P2's own arrow key, then confirm — the two-choice wrap takes 'yes' at
    // index 0 to 'no' at index 1 either direction; this uses LEFT to exercise the other one from M1:1's RIGHT.
    await expect(page.locator('[data-playtest-field="M2:2"]')).toHaveClass(/--focused/);
    await page.keyboard.press('ArrowLeft'); // P2's LEFT
    await expect(
      page.locator('[data-playtest-field="M2:2"] .playtest-prompt-choice--selected'),
    ).toHaveText('no');
    await page.keyboard.press('Enter');

    // All four fields confirmed: the gap closes on its own.
    await expect(page.locator('[data-playtest-prompt]')).toBeHidden();

    const answers = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.getPlaytestAnswers(),
    );
    expect(answers).toEqual([
      { roundIndex: 2, questionId: 'M1', player: 1, value: 'no', skipped: false },
      { roundIndex: 2, questionId: 'M1', player: 2, value: 'yes', skipped: false },
      { roundIndex: 2, questionId: 'M2', player: 1, value: 'yes', skipped: false },
      { roundIndex: 2, questionId: 'M2', player: 2, value: 'no', skipped: false },
    ]);
  });

  test('Esc closes the whole gap at once and releases the scoreboard hold; the skipped question is not lost', async ({
    page,
  }) => {
    await page.goto(PLAYTEST_QUERY);
    await page.evaluate(startBo5MatchInPage);
    await page.evaluate(crashPlayerOneInPage);
    await page.evaluate(nextRoundInPage);
    await page.evaluate(crashPlayerOneInPage);
    await page.evaluate(nextRoundInPage);
    await page.evaluate(crashPlayerOneInPage); // round 2: M1/M2 due

    await expect(page.locator('[data-playtest-prompt]')).toBeVisible();
    await page.keyboard.press('Enter'); // confirm only M1:1, leave the other three fields untouched
    await page.keyboard.press('Escape'); // bail out of the rest of the gap

    await expect(page.locator('[data-playtest-prompt]')).toBeHidden();

    const answers = await page.evaluate(() =>
      /** @type {any} */ (globalThis).__kobi.getPlaytestAnswers(),
    );
    expect(answers).toEqual([
      { roundIndex: 2, questionId: 'M1', player: 1, value: 'yes', skipped: false },
      { roundIndex: 2, questionId: 'M1', player: 2, value: null, skipped: true },
      { roundIndex: 2, questionId: 'M2', player: 1, value: null, skipped: true },
      { roundIndex: 2, questionId: 'M2', player: 2, value: null, skipped: true },
    ]);

    // The hold releases the instant the gap closes — the scoreboard's own timer, driven by `__kobi.advance`
    // like every other `ROUND_OVER` -> `COUNTDOWN`/`MATCH_OVER` step in this suite, is free to run again.
    const state = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      for (let i = 0; i < 60 && kobi.getState() === 'ROUND_OVER'; i += 1) kobi.advance(0.1);
      return kobi.getState();
    });
    expect(state).not.toBe('ROUND_OVER');
  });
});
