// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { crashPlayerOneInPage, nextRoundInPage, startMatchInPage } from './helpers.js';

/**
 * KS-05-03: the match flow, driven end to end in a real browser — the spec the ticket's `QA:` line names.
 *
 * `tests/unit/game/session.test.js` proves the same four acceptance criteria in Node, frame by frame and to
 * the hundredth of a second, which is where timing belongs. What this file adds is the half a unit test
 * cannot reach: that the whole assembled thing — `main.js`, the real renderer, the real screens, the real
 * keyboard — plays a best-of match the same way. So the assertions here are deliberately about outcomes and
 * about the DOM, not about arithmetic.
 *
 * KS-05-05 extends this file with the rest of the flow suite: Bo1 and Bo5 completion (both scripted — three
 * round wins for Bo5, not 90-second timeouts), and rematch keeping its settings. `crashPlayerOneInPage` and
 * `nextRoundInPage`, KS-05-03's own scripted moments, now live in `./helpers.js` instead of this file (moved,
 * not rewritten, once `tests/visual/screens.visual.spec.js` needed the identical script too — tech-lead note
 * B). The four original KS-05-03 tests below are otherwise untouched.
 *
 * Every scripted moment stays inside one `page.evaluate()`, for the reason `first-playable.spec.js`'s module
 * comment sets out at length: the real frame loop is running the whole time, and a frame landing between two
 * halves of a scripted step would advance the round by an uncontrolled few milliseconds. A synchronous
 * callback cannot be interrupted by `requestAnimationFrame`.
 */

test.describe('KS-05-03 match flow', () => {
  test('KS-05-03 AC1: a Bo3 with two scripted crashes reaches MATCH_OVER with a winner and one key', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Best of 3 rather than the default, chosen the way the setup screen would choose it.
    const started = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 3 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return { state: kobi.getState(), bestOf: kobi.getMatch().bestOf };
    });
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

    const first = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.setSeed(20260906);
      kobi.startMatch({ bestOf: 3 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3);
      kobi.fastForward(3);
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return kobi.getSeeds();
    });

    expect(first.matchSeed).toBe(20260906);
    expect(first.roundSeeds).toHaveLength(2);
    // Different boards from round to round: that is what deriving a seed per round buys.
    expect(first.roundSeeds[0]).not.toBe(first.roundSeeds[1]);

    // Reproducible: the same match seed, played again from a fresh page, derives the same round seeds.
    await page.goto(DEFAULT_QUERY);
    const second = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.setSeed(20260906);
      kobi.startMatch({ bestOf: 3 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3);
      kobi.fastForward(3);
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return kobi.getSeeds();
    });

    expect(second.roundSeeds).toEqual(first.roundSeeds);
  });

  test('KS-05-05 AC: a Bo1 match ends after a single scripted crash, with zero keys awarded', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const started = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 1 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return { state: kobi.getState(), bestOf: kobi.getMatch().bestOf };
    });
    expect(started.state).toBe('PLAYING');
    expect(started.bestOf).toBe(1);

    // Bo1's target is one win (`createMatch`: `Math.ceil(1 / 2)`), so P2's single scripted win already
    // decides the match — there is no second round to play.
    const round = await page.evaluate(crashPlayerOneInPage);
    expect(round.state).toBe('ROUND_OVER');
    expect(round.match.wins).toEqual({ 1: 0, 2: 1 });
    expect(round.match.isOver).toBe(true);

    const over = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(3); // scoreboardSeconds is 2.5 (`DESIGN-DECISIONS §2.6`)
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(over.state).toBe('MATCH_OVER');
    expect(over.match.winner).toBe(2);
    // Bo1 rewards no keys (`DESIGN-DECISIONS §2.6`: "Bo1 0 keys"), read from `SETTINGS.rewards`.
    expect(over.match.rewardKeys).toBe(SETTINGS.rewards[1]);
    await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();
  });

  test('KS-05-05 AC: a Bo5 match ends after three scripted round wins for the same player', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Bo5's target is three wins (`Math.ceil(5 / 2)`). Scripted here with the same crash three rounds
    // running, rather than played out to a 90 s timeout each round — the ticket's own instruction ("Bo5
    // needs three round wins — script them, do not play 90-second rounds").
    const started = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 5 });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return { state: kobi.getState(), bestOf: kobi.getMatch().bestOf };
    });
    expect(started.state).toBe('PLAYING');
    expect(started.bestOf).toBe(5);

    let round = await page.evaluate(crashPlayerOneInPage);
    expect(round.match.wins).toEqual({ 1: 0, 2: 1 });
    expect(round.match.isOver).toBe(false);
    expect(await page.evaluate(nextRoundInPage)).toBe('PLAYING');

    round = await page.evaluate(crashPlayerOneInPage);
    expect(round.match.wins).toEqual({ 1: 0, 2: 2 });
    expect(round.match.isOver).toBe(false);
    expect(await page.evaluate(nextRoundInPage)).toBe('PLAYING');

    round = await page.evaluate(crashPlayerOneInPage);
    expect(round.match.wins).toEqual({ 1: 0, 2: 3 });
    expect(round.match.isOver).toBe(true);

    const over = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(3);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(over.state).toBe('MATCH_OVER');
    expect(over.match.winner).toBe(2);
    // Bo5 rewards two keys (`DESIGN-DECISIONS §2.6`: "Bo5 2 keys").
    expect(over.match.rewardKeys).toBe(SETTINGS.rewards[5]);
    await expect(page.locator('[data-screen="MATCH_OVER"]')).toBeVisible();
  });

  test('KS-05-05 AC: REMATCH keeps the same bestOf and colours, with the score reset to zero', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // Bo1 (not the setup screen's Bo3 default) and both players' colours swapped from the setup screen's own
    // defaults (red/blue) — exactly the shape `matchSetup.js`'s `changeMatchLength`/`pickPlayerColor` would
    // leave `matchSettings` in after real key presses, applied here as `startMatch`'s own override argument
    // the same way the setup-screen flow itself does (`session.js`'s `showMatchSetup` → `onChange`).
    const started = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 1, colors: { 1: 'blue', 2: 'red' } });
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return { state: kobi.getState(), settings: kobi.getMatchSettings() };
    });
    expect(started.state).toBe('PLAYING');
    expect(started.settings.bestOf).toBe(1);
    expect(started.settings.colors).toEqual({ 1: 'blue', 2: 'red' });

    // Bo1, so this one scripted crash already decides the match.
    const round = await page.evaluate(crashPlayerOneInPage);
    expect(round.match.isOver).toBe(true);

    const over = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(3); // scoreboardSeconds
      return kobi.getState();
    });
    expect(over).toBe('MATCH_OVER');

    // REMATCH is pressed as a real `Enter` keydown on `window` — the same event `input.js` listens for and
    // the same one `matchOver.js`'s default-focused REMATCH row responds to (`ARCHITECTURE §8`) — rather than
    // dispatching the state machine's `REMATCH` event directly, so this proves the real UI wiring
    // (`matchOver.js`'s `onRematch` → `session.js`'s `machine.dispatch(GAME_EVENTS.REMATCH)`), not just the
    // machine's own transition table. It happens inside the same `page.evaluate()` call as the countdown
    // fast-forward that follows it (module doc comment: no real frame may land between the two, or the
    // countdown's own real-time clock could run ahead of this script before `fastForward` ever gets to it).
    const rematch = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const win = /** @type {any} */ (globalThis).window;
      win.dispatchEvent(
        new win.KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }),
      );
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.fastForward(0.1);
      return { state: kobi.getState(), settings: kobi.getMatchSettings(), match: kobi.getMatch() };
    });

    expect(rematch.state).toBe('PLAYING');
    // Same settings ("REMATCH (same settings, swap nothing)", `DESIGN-DECISIONS §2.6`) …
    expect(rematch.settings.bestOf).toBe(1);
    expect(rematch.settings.colors).toEqual({ 1: 'blue', 2: 'red' });
    // … and a fresh match: the score is back to zero, not carried over from the last one.
    expect(rematch.match.wins).toEqual({ 1: 0, 2: 0 });
    expect(rematch.match.isOver).toBe(false);
    expect(rematch.match.roundsPlayed).toBe(0);
  });
});
