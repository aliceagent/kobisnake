// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-12-04 — the switch, and the key rule (`docs/sprints/improvement-12-cpu-opponent.md`).
 *
 * `tests/unit/ui/matchSetup.test.js` and `tests/unit/game/session.test.js` already prove the row's pure
 * cycling function, the controls-card string and the key rule without a DOM or a browser; this file proves
 * the same three claims landed in the real, bundled page — real keypresses moving real focus, real text
 * nodes, and `__kobi.getMatch()` read back from the actual compiled bundle — the way this ticket's own
 * `QA: unit + e2e + visual` line asks for. `tests/e2e/cpu.spec.js` (KI-12-02) already proves a CPU plays
 * through the real input queue and replays identically; this file is narrower — it proves the *switch*
 * (`matchSettings.playerKinds`) is what turns that machinery on, not merely a label next to it.
 *
 * Every scripted moment is one `page.evaluate()` or one `page.keyboard.press()` sequence with no interleaved
 * `page.evaluate` round-trip in between a script and its assertion, the same "one script, no gaps" discipline
 * `tests/visual/screens.visual.spec.js`'s own module doc explains at length: MATCH_SETUP does not tick
 * (`session.js`'s `runUpdate` has no case for it), so nothing here needs a freeze — there is simply nothing
 * to race against.
 */

test.describe('KI-12-04 the switch — match setup row', () => {
  test('KI-12-04 AC1: both player rows default to HUMAN — the untouched row', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    const settings = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.stateMachine.dispatch('SELECT_2P');
      return kobi.getMatchSettings();
    });
    expect(settings.playerKinds).toEqual({ 1: 'HUMAN', 2: 'HUMAN' });

    // The row's own displayed text, not just the underlying settings object — row order (`matchSetup.js`):
    // MATCH LENGTH, POWER-UPS, MUSIC, PLAYER 1 (kind), PLAYER 1 COLOUR, PLAYER 2 (kind), PLAYER 2 COLOUR.
    const values = await page.locator('.menu-item-value').allTextContents();
    expect(values[3]).toBe('HUMAN');
    expect(values[5]).toBe('HUMAN');
  });

  test('KI-12-04: cycling PLAYER 1’s row visits exactly HUMAN, CPU EASY, CPU NORMAL, and wraps — CPU HARD is not offered', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    // MATCH LENGTH -> POWER-UPS -> MUSIC -> PLAYER 1 (kind row).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');

    const p1Kind = page.locator('.menu-item-value').nth(3);
    await expect(p1Kind).toHaveText('HUMAN');

    // Verbatim strings from `DESIGN-DECISIONS §1` row 27 — do not paraphrase these in the test either.
    // Exactly three steps back to HUMAN pins the cycle length itself: if a fourth value (`CPU HARD`) were
    // ever silently re-added to the menu, this third `ArrowRight` would land on it instead of wrapping,
    // and the assertion right after it would fail (#217's measurement, ruled off the menu on #210).
    await page.keyboard.press('ArrowRight');
    await expect(p1Kind).toHaveText('CPU EASY');
    await page.keyboard.press('ArrowRight');
    await expect(p1Kind).toHaveText('CPU NORMAL');
    await page.keyboard.press('ArrowRight');
    await expect(p1Kind).toHaveText('HUMAN');

    // Backward too, and player 2's own row is never touched by cycling player 1's.
    await page.keyboard.press('ArrowLeft');
    await expect(p1Kind).toHaveText('CPU NORMAL');
    await expect(page.locator('.menu-item-value').nth(5)).toHaveText('HUMAN');
  });

  test('KI-12-04: the controls card shows "CPU" for a computer player, real DOM text', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown'); // PLAYER 1 (kind) row
    await page.keyboard.press('ArrowRight'); // -> CPU EASY

    const rows = page.locator('.controls-card-row');
    await expect(rows.nth(0)).toHaveText('PLAYER 1 · RED — CPU');
    // Player 2 is untouched — still a human, still names its own keys.
    await expect(rows.nth(1)).toHaveText('PLAYER 2 · BLUE — ARROW KEYS');
  });

  test('KI-12-04: switching a player back to HUMAN restores its keys on the controls card', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_2P');
    });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown'); // PLAYER 1 (kind) row
    await page.keyboard.press('ArrowRight'); // -> CPU EASY
    await page.keyboard.press('ArrowLeft'); // back to HUMAN

    await expect(page.locator('.controls-card-row').nth(0)).toHaveText('PLAYER 1 · RED — W A S D');
  });
});

test.describe('KI-12-04 AC2 — the key rule, in the real bundled build', () => {
  test('KI-12-04 AC2: a CPU-vs-CPU match awards zero keys', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    const rewardKeys = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 3, playerKinds: { 1: 'EASY', 2: 'NORMAL' } });
      return kobi.getMatch().rewardKeys;
    });
    expect(rewardKeys).toBe(0);
  });

  test('KI-12-04 AC2: a human-vs-CPU match awards the normal amount', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    // `HARD` deliberately, not `EASY`/`NORMAL`: it is off the match-setup menu (#217, ruled on #210), but
    // `startMatch`'s `playerKinds` override never goes through the row at all, and `policyForLevel` must
    // still resolve it — this doubles as the real-browser half of "HARD keeps working when handed to the
    // session programmatically" (`tests/unit/game/session.test.js`'s own test of the same claim).
    const rewardKeys = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 3, playerKinds: { 1: 'HUMAN', 2: 'HARD' } });
      return kobi.getMatch().rewardKeys;
    });
    expect(rewardKeys).toBe(SETTINGS.rewards[3]);
  });
});

test.describe('KI-12-04: the switch actually drives a CpuPlayer', () => {
  test('KI-12-04: an EASY player 1 (set via the switch, not a manual setCpuPlayer) steers away from the wall an idle human would hit', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    const alive = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 1, playerKinds: { 1: 'EASY', 2: 'HUMAN' } });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);
      // P1 spawns heading RIGHT (`DESIGN-DECISIONS §2.3`); an unsteered snake on this seed reaches its wall
      // by ≈ 3.167 s (`tests/visual/screens.visual.spec.js`'s own recorded timing). 100 frames of 1/30 s
      // (≈ 3.33 s) is safely past that mark.
      for (let i = 0; i < 100; i += 1) kobi.advance(1 / 30);
      return kobi.sim.snakes[0].alive;
    });
    expect(alive).toBe(true);
  });
});
