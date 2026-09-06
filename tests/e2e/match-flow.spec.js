// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { COUNTDOWN_SECONDS, startMatchInPage } from './helpers.js';

/**
 * KS-05-03: the match flow, driven end to end in a real browser — the spec the ticket's `QA:` line names.
 *
 * `tests/unit/game/session.test.js` proves the same four acceptance criteria in Node, frame by frame and to
 * the hundredth of a second, which is where timing belongs. What this file adds is the half a unit test
 * cannot reach: that the whole assembled thing — `main.js`, the real renderer, the real screens, the real
 * keyboard — plays a best-of match the same way. So the assertions here are deliberately about outcomes and
 * about the DOM, not about arithmetic.
 *
 * KS-05-05 extends this file with the rest of the flow suite (Bo1/Bo5 completion, rematch keeping its
 * settings, back navigation from every screen). It is a starting point, not a finished suite.
 *
 * Every scripted moment stays inside one `page.evaluate()`, for the reason `first-playable.spec.js`'s module
 * comment sets out at length: the real frame loop is running the whole time, and a frame landing between two
 * halves of a scripted step would advance the round by an uncontrolled few milliseconds. A synchronous
 * callback cannot be interrupted by `requestAnimationFrame`.
 */

/**
 * Steers player 1 into the top wall and runs past the crash and the slow-mo beat that follows it, leaving
 * the game on the scoreboard.
 *
 * P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); UP is a legal turn and, left uncorrected,
 * kills it twelve grid steps later — exactly 2.0 simulated seconds at 6 cells/s. P2 gets no input and does
 * not reach the opposite wall until ≈ 3.167 s, so P1 dies alone and P2 takes the round. Three seconds covers
 * the crash and the 0.6 s crash slow-mo beat (`§2.5`) with room to spare.
 *
 * Serialised into the page by `page.evaluate`, so it cannot reference anything outside itself.
 */
function crashPlayerOneInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.pressKey(1, 'UP');
  kobi.fastForward(3);
  return { state: kobi.getState(), match: kobi.getMatch() };
}

/** Leaves the scoreboard and plays the next round's countdown out, landing back in PLAYING. */
function nextRoundInPage() {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.fastForward(3); // scoreboardSeconds is 2.5 (`DESIGN-DECISIONS §2.6`)
  kobi.fastForward(3.21); // 3 · 2 · 1 · GO
  return kobi.getState();
}

test.describe('KS-05-03 match flow', () => {
  test('KS-05-03 AC1: a Bo3 with two scripted crashes reaches MATCH_OVER with a winner and one key', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Best of 3 rather than the default, chosen the way the setup screen would choose it.
    const started = await page.evaluate((countdown) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 3 });
      kobi.fastForward(countdown);
      return { state: kobi.getState(), bestOf: kobi.getMatch().bestOf };
    }, COUNTDOWN_SECONDS);
    expect(started.state).toBe('PLAYING');
    expect(started.bestOf).toBe(3);

    const firstRound = await page.evaluate(crashPlayerOneInPage);
    expect(firstRound.state).toBe('ROUND_OVER');
    expect(firstRound.match.wins).toEqual({ 1: 0, 2: 1 });
    expect(firstRound.match.isOver).toBe(false);

    expect(await page.evaluate(nextRoundInPage)).toBe('PLAYING');

    const secondRound = await page.evaluate(crashPlayerOneInPage);
    expect(secondRound.match.wins).toEqual({ 1: 0, 2: 2 });
    expect(secondRound.match.isOver).toBe(true);

    const over = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(3);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(over.state).toBe('MATCH_OVER');
    expect(over.match.winner).toBe(2);
    // Bo3 rewards one key (`DESIGN-DECISIONS §2.6`), read from `SETTINGS.rewards`. Display only this sprint:
    // nothing is persisted until Sprint 13.
    expect(over.match.rewardKeys).toBe(SETTINGS.rewards[3]);
    await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();
  });

  test('KS-05-03 AC2: a draw shows DRAW — REPLAY and changes no wins', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    // The golden no-input round: neither snake is steered, both reach opposite walls on the same tick at
    // t ≈ 3.167 s, and the round is a DRAW (`tests/unit/core/round.test.js`'s golden log).
    const drawn = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(4);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(drawn.state).toBe('ROUND_OVER');
    expect(drawn.match.wins).toEqual({ 1: 0, 2: 0 });
    expect(drawn.match.roundsPlayed).toBe(1);
    await expect(page.locator('[data-screen="ROUND_OVER"]')).toContainText('DRAW — REPLAY');

    // "Draws never count; the match simply replays the round" (`DESIGN-DECISIONS §2.5` row 7).
    expect(await page.evaluate(nextRoundInPage)).toBe('PLAYING');
    const replayed = await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatch());
    expect(replayed.wins).toEqual({ 1: 0, 2: 0 });
    expect(replayed.isOver).toBe(false);
  });

  test('KS-05-03 AC3: pause freezes the timer, READY? plays for a second, the timer carries on', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);
    await expect(page.locator('.hud-timer')).toBeVisible();

    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.pause();
    });
    await expect(page.locator('[data-screen="PAUSE"]')).toBeVisible();

    const frozenText = await page.locator('.hud-timer').textContent();

    // Nothing to poll for — the point is that nothing happens — so this waits on the wall clock, which is
    // safe precisely because a paused game runs at `timeScale` 0.
    await page.waitForTimeout(400);
    await expect(page.locator('.hud-timer')).toHaveText(/** @type {string} */ (frozenText));

    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.resume();
    });

    // The READY? beat is a second of wall time, on the countdown screen (`DESIGN-DECISIONS §2.8`).
    await expect(page.locator('[data-screen="COUNTDOWN"]')).toContainText('READY?');
    await expect(page.locator('[data-screen="PAUSE"]')).toBeHidden();

    // And then the round carries on from the value it froze at, rather than from wherever wall time has got
    // to in the meantime — which is the half of AC3 that matters.
    await expect(page.locator('.hud-timer')).not.toHaveText(/** @type {string} */ (frozenText));
  });

  test('KS-05-03 AC4: round seeds differ per round and are reproducible from the match seed', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const first = await page.evaluate((countdown) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.setSeed(20260906);
      kobi.startMatch({ bestOf: 3 });
      kobi.fastForward(countdown);
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3);
      kobi.fastForward(3);
      kobi.fastForward(countdown);
      return kobi.getSeeds();
    }, COUNTDOWN_SECONDS);

    expect(first.matchSeed).toBe(20260906);
    expect(first.roundSeeds).toHaveLength(2);
    // Different boards from round to round: that is what deriving a seed per round buys.
    expect(first.roundSeeds[0]).not.toBe(first.roundSeeds[1]);

    // Reproducible: the same match seed, played again from a fresh page, derives the same round seeds.
    await page.goto(DEFAULT_QUERY);
    const second = await page.evaluate((countdown) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.setSeed(20260906);
      kobi.startMatch({ bestOf: 3 });
      kobi.fastForward(countdown);
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3);
      kobi.fastForward(3);
      kobi.fastForward(countdown);
      return kobi.getSeeds();
    }, COUNTDOWN_SECONDS);

    expect(second.roundSeeds).toEqual(first.roundSeeds);
  });
});
