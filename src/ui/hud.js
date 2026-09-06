// @ts-check

/**
 * The minimal HUD: a centred timer and the two players' current lengths (`ARCHITECTURE §8`; ticket KS-03-05),
 * plus the `LASER_WARNING` presentation (ticket KS-04-03). Grey-box only — dark rounded panels, big readable
 * text; the toy pill/BEST-OF styling of `docs/reference/images/13-gameplay-hud.png` is Sprint 11's job. The
 * timer sits centre-top with P1's panel to its left and P2's to its right, which is where both
 * `13-gameplay-hud.png` and `02-standard-gameplay-camera.png` put them.
 *
 * `showLaserWarning` puts up a plain "LASERS CLOSING!" banner (`05-laser-closing-phase.png`'s hazard-striped
 * banner, grey-boxed per this sprint's spec — the real toy-brick treatment is Sprint 11's) and reddens the
 * timer. Neither knows *when* to fire or for how long the round has left — that is `session.js`'s job, which
 * calls `showLaserWarning(SETTINGS.laserWarningDuration)` on the sim's `LASER_WARNING` event and calls
 * `tick(dt)` every frame so the banner's countdown is driven by the same frame `dt` the rest of the game
 * loop runs on (`ARCHITECTURE §5`), not a wall-clock `setTimeout` a paused or hidden tab would keep running
 * regardless. The timer stays red until `resetWarning()` is called, which `session.js` does when the next
 * round starts — "for the rest of the round" (the ticket's own wording) means exactly that round, not the
 * banner's own 5 s.
 *
 * DOM access goes through `root.ownerDocument`, never the global `document`, so this stays constructible in
 * a plain Node test with a hand-built fake root — `src/ui/**` is not gated by the coverage config, but it
 * should still be testable (Sprint 03 tech-lead note).
 */

/**
 * @typedef {object} Hud
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 * @property {(durationSeconds: number) => void} showLaserWarning
 * @property {(dt: number) => void} tick
 * @property {() => void} resetWarning
 * @property {() => void} destroy
 */

/** The banner's exact text (ticket KS-04-03; image `05-laser-closing-phase.png`). Never invent other copy. */
const LASER_WARNING_TEXT = 'LASERS CLOSING!';

/** CSS class that reddens the timer text for the rest of the round (`src/ui/styles.css`). */
const TIMER_WARNING_CLASS = 'hud-timer--warning';

/**
 * Build the HUD inside `root` (typically `#ui`).
 *
 * @param {HTMLElement} root
 * @returns {Hud}
 */
export function createHud(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'hud';

  const row = doc.createElement('div');
  row.className = 'hud-row';

  const p1 = doc.createElement('div');
  p1.className = 'hud-player hud-player--p1';
  p1.textContent = 'P1 0';

  const timer = doc.createElement('div');
  timer.className = 'hud-timer';
  timer.textContent = '0:00';

  const p2 = doc.createElement('div');
  p2.className = 'hud-player hud-player--p2';
  p2.textContent = 'P2 0';

  row.append(p1, timer, p2);

  const banner = doc.createElement('div');
  banner.className = 'hud-laser-banner';
  banner.textContent = LASER_WARNING_TEXT;
  banner.hidden = true;

  container.append(row, banner);
  root.appendChild(container);

  /** Seconds left before the banner hides itself; only meaningful while `banner.hidden` is `false`. */
  let bannerRemaining = 0;

  return {
    setTime(text) {
      timer.textContent = text;
    },
    setLengths(p1Length, p2Length) {
      p1.textContent = `P1 ${p1Length}`;
      p2.textContent = `P2 ${p2Length}`;
    },
    showLaserWarning(durationSeconds) {
      banner.hidden = false;
      bannerRemaining = durationSeconds;
      timer.classList.add(TIMER_WARNING_CLASS);
    },
    tick(dt) {
      if (banner.hidden) return;
      bannerRemaining -= dt;
      if (bannerRemaining <= 0) {
        banner.hidden = true;
        bannerRemaining = 0;
      }
    },
    resetWarning() {
      banner.hidden = true;
      bannerRemaining = 0;
      timer.classList.remove(TIMER_WARNING_CLASS);
    },
    destroy() {
      container.remove();
    },
  };
}
