// @ts-check

/**
 * The minimal HUD: a centred timer and the two players' current lengths (`ARCHITECTURE §8`; ticket KS-03-05).
 * Grey-box only — dark rounded panels, big readable text; the toy pill/BEST-OF styling of
 * `docs/reference/images/13-gameplay-hud.png` is Sprint 11's job. The timer sits centre-top with P1's panel
 * to its left and P2's to its right, which is where both `13-gameplay-hud.png` and
 * `02-standard-gameplay-camera.png` put them.
 *
 * DOM access goes through `root.ownerDocument`, never the global `document`, so this stays constructible in
 * a plain Node test with a hand-built fake root — `src/ui/**` is not gated by the coverage config, but it
 * should still be testable (Sprint 03 tech-lead note).
 */

/**
 * @typedef {object} Hud
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 * @property {() => void} destroy
 */

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

  const p1 = doc.createElement('div');
  p1.className = 'hud-player hud-player--p1';
  p1.textContent = 'P1 0';

  const timer = doc.createElement('div');
  timer.className = 'hud-timer';
  timer.textContent = '0:00';

  const p2 = doc.createElement('div');
  p2.className = 'hud-player hud-player--p2';
  p2.textContent = 'P2 0';

  container.append(p1, timer, p2);
  root.appendChild(container);

  return {
    setTime(text) {
      timer.textContent = text;
    },
    setLengths(p1Length, p2Length) {
      p1.textContent = `P1 ${p1Length}`;
      p2.textContent = `P2 ${p2Length}`;
    },
    destroy() {
      container.remove();
    },
  };
}
