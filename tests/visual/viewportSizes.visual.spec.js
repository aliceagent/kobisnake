// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';

/**
 * KI-16-03 AC3 — two extra baselines, 1024×768 and 1920×1080, "alongside the 1280×720 set" already recorded
 * by `gameplay.visual.spec.js`/`smoke.visual.spec.js` and the rest of `tests/visual/` — not instead of it,
 * and not all seven `docs/qa/playtests/viewports.md` (KI-16-01) viewports, per the sprint file's own
 * "baseline explosion" risk (`docs/sprints/improvement-16-viewport-and-resize.md`).
 *
 * These two, and only these two, because they bracket what this ticket actually changed: 1024×768 is the
 * narrowest 4:3 shape `styles.css`'s new breakpoints target (KI-16-01's matrix found 80px² of P1/P2-pill-vs-
 * arena overlap there before this PR — the smallest of the three defects, so the one a screenshot most needs
 * to prove rather than merely assert); 1920×1080 is `ARCHITECTURE §12`'s own resolution, already clear
 * before this PR (0px² in the same matrix) and kept as a widescreen record precisely so a reviewer can see
 * that fixing the narrow end changed nothing at the wide one.
 *
 * `startRoundAndFreeze` is `tests/visual/gameplay.visual.spec.js`'s own trick, copied rather than imported
 * (that file does not export it) for the identical reason its own module doc comment gives in full: starting
 * the round and pausing it inside one synchronous `page.evaluate` leaves the frame at tick 0 on every
 * machine, every run, because JavaScript is single-threaded and no `requestAnimationFrame` callback can land
 * in the middle of one script. `page.setViewportSize` is called *before* `page.goto`, not after (unlike
 * `resize.spec.js`'s own resize-event tests), so the very first frame this page ever renders is already at
 * the target size — there is no resize to react to and nothing here is testing `session.resize()` a second
 * time (`resize.spec.js` already does, at more sizes than these two).
 */
function startRoundAndFreeze() {
  const doc = /** @type {any} */ (globalThis).document;
  const kobi = /** @type {any} */ (globalThis).__kobi;

  kobi.startMatch();
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)

  kobi.pause();
  kobi.fastForward(0);

  const pausePanel = doc.querySelector('[data-screen="PAUSE"]');
  if (pausePanel !== null) pausePanel.hidden = true;

  return kobi.sim.tick;
}

/** @type {readonly {slug: string, width: number, height: number}[]} */
const SIZES = Object.freeze([
  { slug: '1024x768', width: 1024, height: 768 },
  { slug: '1920x1080', width: 1920, height: 1080 },
]);

test.describe('KI-16-03 AC3 visual', () => {
  for (const size of SIZES) {
    test(`KI-16-03 AC3: gameplay HUD baseline at ${size.slug}, clear of the arena`, async ({
      page,
    }) => {
      // Before goto, not after: the page's very first render is already at this size.
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(DEFAULT_QUERY);

      const tick = await page.evaluate(startRoundAndFreeze);
      expect(tick).toBe(0);

      await expect(page).toHaveScreenshot(`gameplay-${size.slug}-t0.png`);
    });
  }
});
