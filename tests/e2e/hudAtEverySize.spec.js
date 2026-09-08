// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import { MIN_SIZE_NOTE_TEXT, MIN_SUPPORTED_HEIGHT, MIN_SUPPORTED_WIDTH } from '../../src/ui/hud.js';
import {
  MID_ROUND_HOLD_SECONDS,
  STATE_GUARD_CHUNK_SECONDS,
  STATE_GUARD_STEPS,
  VIEWPORTS,
  arenaCorners,
  laserWarningOverrides,
  measureLaserBanner,
  measureMidRoundFrame,
  ndcBounds,
  ndcBoundsToCssRect,
  rectOverlap,
} from '../agent/viewports.js';
import { startMatchInPage } from './helpers.js';

/**
 * KI-16-03 — the HUD (pills, timer, laser banner, power-up tags, the tuning fold) at every size the matrix
 * measured, plus the below-minimum note.
 *
 * `docs/qa/playtests/viewports.md` (KI-16-01) already found the defect this ticket fixes — a player pill
 * overlapping the arena at 1024×768, 800×600 and 640×480 — and already built the exact numeric machinery to
 * answer "does this overlap that": `tests/agent/viewports.js`'s `arenaCorners`/`measureMidRoundFrame`/
 * `rectOverlap`. This file imports that machinery rather than re-deriving it (the tech-lead notes on issue
 * #248: "the code to copy, not re-invent") and runs it as a normal `npm run test:e2e` gate, at every viewport
 * `VIEWPORTS` names, rather than only inside the opt-in `KI_VIEWPORTS=1` agent matrix.
 *
 * **Two questions, two kinds of test, on purpose.** AC1 asks for the KS-07-01 `elementFromPoint` check (the
 * *tuning overlay* vs. a pill) to pass at every viewport — that check already existed for 1280×720 only
 * (`tuning.spec.js`), and the loop below is that same check, widened. The ticket's own Spec line is broader
 * than AC1 ("Pills ... never overlap the arena or each other at any measured viewport") and KI-16-01's matrix
 * is what actually found the pill-vs-arena defect, which AC1's own check cannot see at all — so a second,
 * separately named set of tests below (`KI-16-03 Spec: ...`) asserts pill-vs-arena directly, the gap the
 * tech-lead notes on #248 flag explicitly ("satisfy the Spec, not just AC1").
 *
 * **The laser banner is asserted, not fixed.** KI-16-01 already found the banner never overlaps a pill at any
 * of the seven viewports; the tech-lead notes are explicit that this is a permanent assertion to keep, not a
 * defect to go looking for ("the laser banner never overlaps a pill anywhere — assert that, don't go fixing
 * it").
 *
 * **What this file does not assert.** The ticket's own Spec sentence also names the timer and the power-up
 * tags. KI-16-01 never measured either, and measuring the timer against the same generous arena box this file
 * uses for the pills turns up a bounding-box overlap with the timer pill's own dark background at *every*
 * viewport measured, including the confirmed 1280×720 baseline — a pre-existing condition, unrelated to any
 * CSS this ticket touches, that would have to change the confirmed picture (KI-16-02 AC2) or the grey-box
 * HUD's own sizing (Sprint 11's job, not this ticket's `Files:` list) to "fix". It is reported in this
 * ticket's PR description for the tech lead's judgment rather than silently asserted here or silently fixed —
 * asserting it here would fail the one baseline this whole improvement is forbidden to move. Power-up tags
 * have no fixed screen position at all (`hud.js`'s own doc comment: placed from a live head projection), so
 * there is no viewport-driven overlap to assert independent of gameplay.
 */

/** The tuning-enabled query every AC1/Spec test below loads with — `?tuning=1` is what AC1 needs. */
const TUNING_QUERY = '?test=1&tuning=1&seed=1&reducedFx=1';

/**
 * Opens a fresh page sized to one {@link VIEWPORTS} entry, handling the one DPR-2 row the same way
 * `tests/agent/viewports.spec.js` does — Playwright only allows `deviceScaleFactor` at context creation, not
 * on an existing page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Browser} browser
 * @param {(typeof VIEWPORTS)[number]} viewport
 * @returns {Promise<{page: import('@playwright/test').Page, close: () => Promise<void>}>}
 */
async function pageForViewport(page, browser, viewport) {
  if (viewport.dpr === 1) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    return { page, close: async () => {} };
  }
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.dpr,
  });
  const dprPage = await context.newPage();
  return { page: dprPage, close: () => context.close() };
}

for (const viewport of VIEWPORTS) {
  test(`KI-16-03 AC1: the tuning overlay never covers a HUD pill at ${viewport.slug}`, async ({
    page,
    browser,
  }) => {
    const { page: target, close } = await pageForViewport(page, browser, viewport);
    try {
      await target.goto(TUNING_QUERY);
      expect(await target.evaluate(startMatchInPage)).toBe('PLAYING');

      // The exact KS-07-01 measurement (`tuning.spec.js`), widened from 1280×720 alone to every viewport.
      const results = await target.evaluate(() => {
        const global = /** @type {any} */ (globalThis);
        const pills = /** @type {HTMLElement[]} */ (
          Array.from(global.document.querySelectorAll('.hud-player'))
        );
        return pills.map((pill) => {
          const rect = pill.getBoundingClientRect();
          const hit = global.document.elementFromPoint(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
          );
          return hit !== null && hit.closest('[data-tuning-overlay]') !== null;
        });
      });

      expect(results).toHaveLength(2);
      for (const hitsOverlay of results) {
        expect(hitsOverlay).toBe(false);
      }
    } finally {
      await close();
    }
  });

  test(`KI-16-03 Spec: neither player pill overlaps the arena at ${viewport.slug}`, async ({
    page,
    browser,
  }) => {
    const { page: target, close } = await pageForViewport(page, browser, viewport);
    try {
      await target.goto(TUNING_QUERY);
      await target.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));

      const corners = arenaCorners(SETTINGS);
      const midRound = await target.evaluate(measureMidRoundFrame, {
        corners,
        bestOf: 3,
        holdSeconds: MID_ROUND_HOLD_SECONDS,
        guardSteps: STATE_GUARD_STEPS,
        guardChunkSeconds: STATE_GUARD_CHUNK_SECONDS,
      });

      const bounds = ndcBounds(midRound.ndcPoints);
      const arenaRect = ndcBoundsToCssRect(bounds, midRound.canvasRect);
      const p1 = rectOverlap(arenaRect, midRound.p1Rect);
      const p2 = rectOverlap(arenaRect, midRound.p2Rect);

      expect(
        p1.overlaps,
        `P1 pill overlaps the arena by ${p1.areaPx2}px² at ${viewport.slug}`,
      ).toBe(false);
      expect(
        p2.overlaps,
        `P2 pill overlaps the arena by ${p2.areaPx2}px² at ${viewport.slug}`,
      ).toBe(false);
    } finally {
      await close();
    }
  });

  test(`KI-16-03 Spec: the laser banner never overlaps a pill at ${viewport.slug}`, async ({
    page,
    browser,
  }) => {
    const { page: target, close } = await pageForViewport(page, browser, viewport);
    try {
      await target.goto(TUNING_QUERY);
      await target.waitForFunction(() => Boolean(/** @type {any} */ (globalThis).__kobi));

      const { laserStartTime } = laserWarningOverrides(SETTINGS);
      const laser = await target.evaluate(measureLaserBanner, {
        bestOf: 3,
        laserStartTime,
        guardSteps: STATE_GUARD_STEPS,
        guardChunkSeconds: STATE_GUARD_CHUNK_SECONDS,
      });

      expect(laser.reached, `${viewport.slug}: LASER_WARNING was not reached`).toBe(true);
      const bannerVsP1 = rectOverlap(laser.bannerRect, laser.p1Rect);
      const bannerVsP2 = rectOverlap(laser.bannerRect, laser.p2Rect);
      expect(bannerVsP1.overlaps, `banner overlaps P1 at ${viewport.slug}`).toBe(false);
      expect(bannerVsP2.overlaps, `banner overlaps P2 at ${viewport.slug}`).toBe(false);
    } finally {
      await close();
    }
  });
}

test.describe('KI-16-03 AC2: below the minimum, a note replaces the HUD', () => {
  /**
   * Starts a match, plays it into `PLAYING`, and reads back whether the note is showing, what it says, and
   * whether the round HUD itself is visible — everything one test needs, in one round-trip.
   */
  function measureBelowMinimum() {
    const kobi = /** @type {any} */ (globalThis).__kobi;
    const doc = /** @type {any} */ (globalThis).document;
    kobi.startMatch();
    for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
    kobi.fastForward(0);

    const note = doc.querySelector('.hud-min-size-note');
    const hud = doc.querySelector('.hud');
    const noteRect = note.getBoundingClientRect();
    const hudRect = hud.getBoundingClientRect();
    return {
      state: kobi.getState(),
      tick: kobi.sim.tick,
      noteHidden: note.hidden,
      noteVisible: noteRect.width > 0 && noteRect.height > 0,
      noteText: note.textContent,
      hudVisible: hudRect.width > 0 && hudRect.height > 0,
    };
  }

  test('AC2: at 639×480 (one pixel under the minimum width) the note shows and the game still runs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH - 1, height: MIN_SUPPORTED_HEIGHT });
    await page.goto('?test=1&seed=1&reducedFx=1');

    const before = await page.evaluate(measureBelowMinimum);
    expect(before.state).toBe('PLAYING');
    expect(before.noteHidden).toBe(false);
    expect(before.noteVisible).toBe(true);
    expect(before.noteText).toBe(MIN_SIZE_NOTE_TEXT);
    // "Replaces the HUD" (the ticket's own wording): the pills/timer must not also be on screen underneath.
    expect(before.hudVisible).toBe(false);

    // AC2's second assertion: the game itself is still running under the note, not paused by it.
    const tickBefore = before.tick;
    const after = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(1);
      return { tick: kobi.sim.tick, state: kobi.getState() };
    });
    expect(after.tick).toBeGreaterThan(tickBefore);
    expect(after.state).toBe('PLAYING');
  });

  test('AC2: at 640×479 (one pixel under the minimum height) the note shows and the game still runs', async ({
    page,
  }) => {
    await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: MIN_SUPPORTED_HEIGHT - 1 });
    await page.goto('?test=1&seed=1&reducedFx=1');

    const before = await page.evaluate(measureBelowMinimum);
    expect(before.state).toBe('PLAYING');
    expect(before.noteVisible).toBe(true);
    expect(before.noteText).toBe(MIN_SIZE_NOTE_TEXT);
    expect(before.hudVisible).toBe(false);

    const tickBefore = before.tick;
    const after = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(1);
      return { tick: kobi.sim.tick, state: kobi.getState() };
    });
    expect(after.tick).toBeGreaterThan(tickBefore);
    expect(after.state).toBe('PLAYING');
  });

  test('AC2: at exactly 640×480 (the minimum) the full HUD shows, never the note', async ({
    page,
  }) => {
    await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: MIN_SUPPORTED_HEIGHT });
    await page.goto('?test=1&seed=1&reducedFx=1');

    const measured = await page.evaluate(measureBelowMinimum);
    expect(measured.state).toBe('PLAYING');
    expect(measured.noteVisible).toBe(false);
    expect(measured.hudVisible).toBe(true);
  });
});
