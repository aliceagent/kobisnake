// @ts-check
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { REPLAY_COPY } from '../../src/ui/screens/replay.js';

/**
 * KI-05-03 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): the REPLAY entry point — a paste
 * box or a chosen local file, the transport, and Esc back out.
 *
 * `tests/e2e/replay.spec.js` (KI-05-02) already proves the *player* — `__kobi.loadReplay`/`stepReplay`/
 * `playReplay`/`seekReplay` reproduce a fixture tick for tick in a real browser. This file's job is the part
 * only a real page can prove about the *screen* around it: a real click reaches a real `<textarea>`, a real
 * chosen file goes through `File.text()` (never a request — `tests/e2e/offline.spec.js` proves that half),
 * and a real `Escape` keypress leaves the screen.
 */

const NO_INPUT_ROUND = readFileSync(
  new URL('../sim/replays/no-input-round.json', import.meta.url),
  'utf8',
);

/** @param {import('@playwright/test').Page} page */
async function openReplayScreen(page) {
  await page.evaluate(() => {
    /** @type {any} */ (globalThis).__kobi.stateMachine.dispatch('SELECT_REPLAY');
  });
  await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
}

test.describe('KI-05-03 the REPLAY screen', () => {
  test('KI-05-03: REPLAY is reachable from the main menu with the keyboard', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    // Default focus is 2 PLAYERS; DOWN twice passes over HOW TO PLAY and lands on REPLAY
    // (`mainMenu.js`'s own placement doc comment).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.locator('.menu-item--focused .menu-item-label', { hasText: REPLAY_COPY.menuLabel }),
    ).toBeVisible();

    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'REPLAY',
    );
  });

  test('KI-05-03 AC1: pasting a valid replay plays it', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    await page.locator('[data-replay-paste]').fill(NO_INPUT_ROUND);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();

    await expect(page.locator('.replay-player')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeHidden();
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getReplayPhase())).toBe(
      'PLAYING',
    );
  });

  test('KI-05-03 AC1: pasting rubbish shows a readable error and stays on the screen', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    await page.locator('[data-replay-paste]').fill('{not valid json');
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();

    await expect(page.locator('[data-screen="REPLAY"]')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeVisible();
    await expect(page.locator('.replay-player')).toBeHidden();
    await expect(page.locator('.replay-error-heading')).toHaveText(REPLAY_COPY.badReplayHeading);
    // AC1: "stays on the screen" — the pasted text survives the failed attempt.
    await expect(page.locator('[data-replay-paste]')).toHaveValue('{not valid json');
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'REPLAY',
    );
  });

  test('KI-05-03 AC1: choosing a local file loads it — no paste required', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    // A real file already on disk — the same committed fixture `replay.spec.js` drives — via Playwright's
    // own `setInputFiles`, never a data URI or an object URL this file would have to construct itself.
    await page
      .locator('[data-replay-file-input]')
      .setInputFiles('tests/sim/replays/no-input-round.json');

    await expect(page.locator('.replay-player')).toBeVisible();
    await expect(page.locator('.replay-load')).toBeHidden();
  });

  test('KI-05-03: the transport plays, steps, and reads out the tick', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);
    await page.locator('[data-replay-paste]').fill(NO_INPUT_ROUND);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();
    await expect(page.locator('.replay-player')).toBeVisible();

    await expect(page.locator('[data-replay-readout]')).toHaveText(/TICK 0/);

    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.stepLabel })
      .click();
    await expect(page.locator('[data-replay-readout]')).toHaveText(/TICK 1/);

    // KI-05-07 (#300): PLAY and PAUSE are exercised as **real clicks dispatched inside one synchronous
    // `page.evaluate`**, and everything asserted about them is read in that same call.
    //
    // Every earlier attempt at this test put a Playwright round trip between clicking PLAY and looking at
    // the result, and each time the fixture's own pace decided whether it passed. `main.js` runs a live
    // `requestAnimationFrame` loop, `runUpdate`'s REPLAY case advances the replay on every frame of it, and
    // this 380-tick fixture plays itself out in 3.17 s of wall time. On a loaded CI runner — the failing
    // suite took 9.8 minutes against ~5.9 here — the replay had finished before the next round trip landed,
    // so `isReplayPlaying()` read false and the toggle's label had flipped back to PLAY. KI-05-05 asked for
    // an absolute tick and got 97; KI-05-06 addressed the label but still waited; #300 caught both.
    //
    // A `page.evaluate` body cannot be interrupted by `requestAnimationFrame`, so no frame — and therefore
    // no tick — can land between the two clicks below. That is the same "one synchronous evaluate" rule
    // `determinism.spec.js` already relies on. The clicks are genuine DOM clicks on the real row, so the
    // screen's own listener is still what is under test; only the waiting is gone.
    const toggled = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;
      const toggle = /** @type {HTMLElement} */ (doc.querySelector('[data-replay-toggle]'));

      const labelBefore = (toggle.textContent ?? '').trim();

      toggle.click();
      const playingAfterFirst = kobi.isReplayPlaying();
      // The label is redrawn by `updateReplayScreenProgress` inside `runUpdate`, not synchronously by the
      // click, so one frame has to be driven before the DOM can be read back. `advance(1 / 120)` is exactly
      // one tick — bounded and identical on every machine — rather than a wait for a real frame to arrive.
      kobi.advance(1 / 120);
      const labelWhilePlaying = (toggle.textContent ?? '').trim();

      toggle.click();
      const playingAfterSecond = kobi.isReplayPlaying();
      kobi.advance(1 / 120);
      const labelAfterPause = (toggle.textContent ?? '').trim();

      return {
        labelBefore,
        playingAfterFirst,
        labelWhilePlaying,
        playingAfterSecond,
        labelAfterPause,
      };
    });

    expect(toggled.labelBefore).toBe(REPLAY_COPY.playLabel);
    expect(toggled.playingAfterFirst).toBe(true);
    expect(toggled.labelWhilePlaying).toBe(REPLAY_COPY.pauseLabel);
    expect(toggled.playingAfterSecond).toBe(false);
    expect(toggled.labelAfterPause).toBe(REPLAY_COPY.playLabel);

    // Paused, so `advanceReplayInternal` is a no-op and the live loop can no longer move the replay: from
    // here `stepReplay` gives exact whole ticks that are the same on any machine (PR #154's rule). The
    // `advance` at the end drives one `runUpdate` so the readout redraws — it cannot move a paused replay.
    const stepped = await page.evaluate((steps) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const before = kobi.getReplayTick();
      for (let i = 0; i < steps; i += 1) kobi.stepReplay();
      kobi.advance(1 / 120);
      return { before, after: kobi.getReplayTick(), playing: kobi.isReplayPlaying() };
    }, 5);

    expect(stepped.playing).toBe(false);
    expect(stepped.after).toBe(stepped.before + 5);
    // The toggle's label follows the player, and reads PLAY again now it is paused.
    await expect(page.locator('[data-replay-toggle]')).toHaveText(REPLAY_COPY.playLabel);
    await expect(page.locator('[data-replay-readout]')).toHaveText(
      new RegExp(`TICK ${stepped.after}\\b`),
    );
  });

  test('KI-05-06: the transport does not move while the replay plays, or when it ends', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);
    await page.locator('[data-replay-paste]').fill(NO_INPUT_ROUND);
    await page
      .locator('[data-screen="REPLAY"] .menu-item', { hasText: REPLAY_COPY.watchLabel })
      .click();
    await expect(page.locator('.replay-player')).toBeVisible();

    // KI-05-07 (#300): this **drives** the replay to its end instead of waiting for it to get there.
    //
    // The first version of this test sampled a live `requestAnimationFrame` loop until `END OF REPLAY`
    // appeared, with a wall-clock deadline behind it. On a loaded CI runner the replay had not reached its
    // end inside that window and the test failed on `expect(boxes.some((s) => s.endShown)).toBe(true)` —
    // never observing the one transition it exists to check. Waiting on real time to reach a *simulated*
    // event is the mistake; `CLAUDE.md` says as much ("e2e tests fast-forward time through `window.__kobi`;
    // they never sleep").
    //
    // So: pause, then step whole ticks. `advanceReplayInternal` is a no-op while paused, so the live loop
    // cannot move the replay and the tick count is entirely this test's own. `advance(1 / 120)` drives one
    // `runUpdate` — the real per-frame path that redraws the readout and toggles `END OF REPLAY` — without
    // being able to advance a paused replay. Every sample is taken inside one synchronous `page.evaluate`,
    // so no frame can land between a step and the measurement that follows it.
    const boxes = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const doc = /** @type {any} */ (globalThis).document;
      const toggle = /** @type {HTMLElement} */ (doc.querySelector('[data-replay-toggle]'));
      const endEl = /** @type {HTMLElement} */ (doc.querySelector('[data-replay-end]'));

      /** One `runUpdate`, then the transport's box and the state around it. */
      const sample = () => {
        kobi.advance(1 / 120);
        const r = toggle.getBoundingClientRect();
        return {
          box: `${r.x},${r.y},${r.width},${r.height}`,
          tick: kobi.getReplayTick(),
          phase: kobi.getReplayPhase(),
          endShown: !endEl.classList.contains('replay-end--placeholder'),
        };
      };

      kobi.pauseReplay();
      kobi.seekReplay(0);

      /** @type {ReturnType<typeof sample>[]} */
      const seen = [sample()];
      // Step to the end, sampling every tick for the first stretch and then around the transition itself —
      // the box can only move when something above it changes height, and `END OF REPLAY` appearing at the
      // last tick is the only thing that does. The guard is a tick count, not a clock.
      let guard = 0;
      while (kobi.getReplayPhase() === 'PLAYING' && guard < 5000) {
        kobi.stepReplay();
        guard += 1;
        if (guard <= 10 || kobi.getReplayPhase() !== 'PLAYING') seen.push(sample());
      }
      // A few more frames with the end line up, so the settled state is measured too.
      for (let i = 0; i < 3; i += 1) seen.push(sample());
      return seen;
    });

    // The replay really did play and really did finish inside the sampled window, so the end-of-replay
    // transition is covered rather than merely assumed — without these the test could pass by never
    // reaching the interesting frame, which is exactly how #300 caught it.
    expect(boxes.some((s) => s.phase === 'PLAYING')).toBe(true);
    expect(boxes.some((s) => s.endShown)).toBe(true);
    expect(boxes.at(-1)?.phase).toBe('ROUND_OVER');

    const distinct = [...new Set(boxes.map((s) => s.box))];
    expect(
      distinct,
      `the transport moved while playing — boxes seen: ${distinct.join(' | ')}`,
    ).toHaveLength(1);
  });

  test('KI-05-03 AC4: Esc leaves REPLAY and returns to MAIN_MENU', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);
    await openReplayScreen(page);

    // KI-05-05 (#235): this failed roughly one run in four under full-suite load and passed 3/3 alone.
    // `page.keyboard.press` delivers to whatever currently has focus, and this test never clicked or
    // focused anything — it relied on the document holding focus by default, which stops being true when
    // several browser contexts are competing. Clicking the screen's own title takes focus deterministically
    // without touching a row: `.menu-title` is a plain `<div>`, not a `.menu-item`, so it cannot activate
    // anything. The fix is focus, never a longer timeout.
    await page.locator('[data-screen="REPLAY"] .menu-title').click();
    await page.keyboard.press('Escape');

    // The machine is what Escape actually drives; the DOM follows it on the next frame. Asserting the
    // state first means a failure says "the key never arrived" rather than "a div was still hidden".
    await expect
      .poll(() => page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState()))
      .toBe('MAIN_MENU');
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();
  });
});
