// @ts-check
import { expect, test } from '@playwright/test';
import { EVENTS } from '../../src/core/events.js';
import { SETTINGS } from '../../src/core/settings.js';
import { WATCH_LAST_ROUND_LABEL } from '../../src/ui/screens/matchOver.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-05-04 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): WATCH LAST ROUND on the
 * match-over screen — the design lead's ruling on issue #211/#222 (`DESIGN-DECISIONS §3`) moving the row off
 * `scoreboard.js`, and this ticket's own declared `matchOver.js`-for-`scoreboard.js` deviation.
 *
 * `tests/unit/game/session.test.js`'s `KI-05-04` suite already proves the exact tick-for-tick reproduction in
 * Node, against `session.getReplay()`'s own snapshot as the oracle. This file's job — the ticket's own `QA:
 * e2e` line — is the part only a real, bundled browser can prove: a real click on a real match-over screen
 * reaches a real REPLAY screen showing the round that was actually just played, and Esc returns to
 * match-over rather than the main menu.
 *
 * `crashPlayerOneInPage`'s own doc comment (`./helpers.js`) names the oracle this file leans on: P1 turns UP
 * and dies on the top wall exactly 2.0 simulated seconds in (tick 240 at `SETTINGS.snakeSpeed` 6,
 * `SETTINGS.simHz` 120), P2 never reaches the far wall in that time, so the round always ends `ROUND_OVER`
 * with `winnerId: 'p2'` and a `SNAKE_DIED` for `p1` at tick 240. A WATCH LAST ROUND that merely rebuilt a
 * fresh round from the same seed — discarding the recorded UP input — would not reproduce this: P1 would
 * simply continue straight past tick 240 with nothing to turn it. Reproducing that exact death is therefore
 * proof of "exactly that round", not only proof of "a round with the same seed" (tech-lead note on issue
 * #222).
 *
 * `reachMatchOver` below inlines `crashPlayerOneInPage`'s own script into the *same* `page.evaluate()` call
 * that starts the match, rather than calling it as a second round trip — `match-flow.spec.js`'s own module
 * comment explains why this matters here specifically: "the real frame loop is running the whole time, and a
 * frame landing between two halves of a scripted step would advance the round by an uncontrolled few
 * milliseconds. A synchronous callback cannot be interrupted by requestAnimationFrame." A second
 * `page.evaluate` round trip is exactly such a gap, and the tick-240 assertion below needs the round to still
 * be at tick 0 the instant `pressKey` fires — which only one uninterrupted synchronous script can guarantee.
 */

/** A generous cap on the replay-stepping loop below, so a broken replay fails loudly, not by hanging. */
const MAX_STEPS = 20_000;

/** @param {import('@playwright/test').Page} page */
async function reachMatchOver(page) {
  const round = await page.evaluate(() => {
    const kobi = /** @type {any} */ (globalThis).__kobi;
    kobi.startMatch({ bestOf: 1 });
    for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
    kobi.fastForward(0); // one frame for the whole countdown — lands the round at tick 0 exactly
    kobi.pressKey(1, 'UP');
    kobi.fastForward(3); // covers the 2.0s crash and the 0.6s slow-mo beat, with room to spare
    return { state: kobi.getState(), match: kobi.getMatch() };
  });
  expect(round.state).toBe('ROUND_OVER');
  expect(round.match.wins).toEqual({ 1: 0, 2: 1 });
  expect(round.match.isOver).toBe(true);

  await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.fastForward(3)); // scoreboardSeconds 2.5
  await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();
  expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
    'MATCH_OVER',
  );
}

const TICKS_TO_CRASH = Math.round((12 / SETTINGS.snakeSpeed) * SETTINGS.simHz);

/** @param {import('@playwright/test').Page} page @returns {Promise<{events: object[], phase: string | null}>} */
async function playLoadedReplayToEnd(page) {
  return page.evaluate((cap) => {
    const kobi = /** @type {any} */ (globalThis).__kobi;
    let guard = 0;
    while (kobi.stepReplay()) {
      guard += 1;
      if (guard > cap) break;
    }
    return { events: kobi.getReplayEvents(), phase: kobi.getReplayPhase() };
  }, MAX_STEPS);
}

test.describe('KI-05-04 WATCH LAST ROUND', () => {
  test('KI-05-04 AC1: WATCH LAST ROUND is a row on MATCH_OVER and replays exactly the round that just ended', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await reachMatchOver(page);

    const watchRow = page.locator('[data-screen="MATCH_OVER"] .menu-item', {
      hasText: WATCH_LAST_ROUND_LABEL,
    });
    await expect(watchRow).toBeVisible();
    await watchRow.click();

    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'REPLAY',
    );
    // Loaded already — `session.js`'s `watchLastRound` loads before dispatching `SELECT_REPLAY`, so the
    // player view is up immediately, with no paste box in between.
    await expect(page.locator('.replay-player')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getReplayPhase())).toBe(
      'PLAYING',
    );

    const played = await playLoadedReplayToEnd(page);
    expect(played.phase).toBe('ROUND_OVER');

    // Exactly the round that was actually played: P1's own recorded UP turn is what kills it at tick 240, not
    // a fresh, uninstructed round built from the same seed (this file's own module doc).
    const p1Died = /** @type {any[]} */ (played.events).find(
      (event) => event.type === EVENTS.SNAKE_DIED && event.snakeId === 'p1',
    );
    expect(p1Died).toBeDefined();
    expect(p1Died.tick).toBe(TICKS_TO_CRASH);
    expect(played.events.at(-1)).toMatchObject({ type: EVENTS.ROUND_OVER, winnerId: 'p2' });
  });

  test('KI-05-04: Esc from a replay entered via WATCH LAST ROUND returns to MATCH_OVER, not MAIN_MENU', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await reachMatchOver(page);

    await page
      .locator('[data-screen="MATCH_OVER"] .menu-item', { hasText: WATCH_LAST_ROUND_LABEL })
      .click();
    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_OVER',
    );
    // Not the main menu — REPLAY's BACK row resolves to wherever it was entered from (`gameStateMachine.js`'s
    // `PREVIOUS` sentinel), which is MATCH_OVER here, not MAIN_MENU as the main-menu entry point would give.
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeHidden();
  });

  test('KI-05-04: WATCH LAST ROUND is reachable by keyboard, appended after REMATCH and MAIN MENU', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await reachMatchOver(page);

    // REMATCH is the default focus; two ArrowDowns pass over MAIN MENU and land on WATCH LAST ROUND
    // (`matchOver.js`'s own placement comment: appended last, so existing specs keying one ArrowDown to
    // MAIN MENU stay true).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('[data-screen="MATCH_OVER"] .menu-item--focused', {
        hasText: WATCH_LAST_ROUND_LABEL,
      }),
    ).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
  });
});
