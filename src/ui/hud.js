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
 *
 * `setPowerUpTags` (KS-06-02) is the same idea applied to the pill of `13-gameplay-hud.png` — "SPEED BOOST
 * 5s" / "SLOWED 4s" floating near the boosted snake's head. `session.js`'s `writeHud` is the only place that
 * holds both a round snapshot and the renderer (tech-lead note on this ticket), so it is the one that works
 * out *where* a tag goes — projecting the head's world position through the gameplay camera — and hands this
 * module only the finished fractions (0..1 of the viewport) plus what to say and how long is left; this file
 * only turns that into DOM. The tags live in their own full-viewport overlay, sibling to `.hud` rather than a
 * child of it, because `.hud` is only as tall as its own row/banner — nesting the tags inside it would
 * resolve their percentage `left`/`top` against that short box instead of the viewport the projection assumed
 * — and `setVisible` below shows or hides both together, so the HUD-visibility rule (`ARCHITECTURE §8`)
 * still applies to the tags without a second rule anywhere.
 */

/**
 * One power-up tag, as `session.js`'s `writeHud` builds it: everything this module needs to draw one pill
 * and nothing it would have to look up itself.
 *
 * @typedef {object} PowerUpTagState
 * @property {string} key - stable identity across frames (player + type), so the same DOM element is reused
 *   rather than torn down and rebuilt every write
 * @property {'SPEED' | 'SLOW'} type
 * @property {number} seconds - remaining duration, already `Math.ceil`'d (AC2) — this module never rounds
 * @property {number} xFraction - 0..1 across the viewport width, the projected head position's X
 * @property {number} yFraction - 0..1 down the viewport height, the projected head position's Y
 * @property {number} [stackIndex] - 0 for the first tag anchored at this position, 1 for a second one on the
 *   same head (a snake can hold both a SPEED and a SLOW effect at once — `core/snake.js`'s own doc comment)
 *   so the two do not draw on top of each other; defaults to 0
 */

/**
 * @typedef {object} Hud
 * @property {(visible: boolean) => void} setVisible
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 * @property {(durationSeconds: number) => void} showLaserWarning
 * @property {(dt: number) => void} tick
 * @property {() => void} resetWarning
 * @property {(tags: PowerUpTagState[]) => void} setPowerUpTags
 * @property {() => void} destroy
 */

/** The banner's exact text (ticket KS-04-03; image `05-laser-closing-phase.png`). Never invent other copy. */
const LASER_WARNING_TEXT = 'LASERS CLOSING!';

/** CSS class that reddens the timer text for the rest of the round (`src/ui/styles.css`). */
const TIMER_WARNING_CLASS = 'hud-timer--warning';

/**
 * The tag's copy, per `13-gameplay-hud.png` and the tech-lead note on this ticket: the image shows two lines
 * — a small caps label, then a bigger bold "5s" — where the ticket text writes one string ("SPEED BOOST
 * 5s"). Built from the image, as instructed; the discrepancy is noted in the PR for the design lead. SLOW's
 * wording ("SLOWED") is the ticket's own, since no image contradicts it.
 *
 * @type {Record<'SPEED' | 'SLOW', {icon: string, label: string, iconClass: string}>}
 */
const POWERUP_TAG_COPY = {
  SPEED: { icon: '⚡', label: 'SPEED BOOST', iconClass: 'hud-powerup-tag-icon--speed' },
  SLOW: { icon: '❄', label: 'SLOWED', iconClass: 'hud-powerup-tag-icon--slow' },
};

/**
 * Fixed pixel offset from the projected head position to the tag's own anchor corner — "floating just above
 * and to the right" (tech-lead note quoting `13-gameplay-hud.png`). Grey-box numbers, not a locked design
 * value: Sprint 11 restyles the tag entirely. Exported so a spec can compute "projected position + offset"
 * for itself (AC1) without duplicating the numbers.
 *
 * @type {{x: number, y: number}}
 */
export const POWERUP_TAG_OFFSET = { x: 22, y: -58 };

/** Extra vertical offset (px) applied per {@link PowerUpTagState.stackIndex}, so two tags anchored at the
 * same head do not draw on top of each other. */
const POWERUP_TAG_STACK_OFFSET_Y = -46;

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

  // The power-up tags' own full-viewport overlay (see the module doc comment for why this is a sibling of
  // `container` rather than nested inside it).
  const tagsLayer = doc.createElement('div');
  tagsLayer.className = 'hud-powerup-tags';
  root.appendChild(tagsLayer);

  /** Seconds left before the banner hides itself; only meaningful while `banner.hidden` is `false`. */
  let bannerRemaining = 0;

  /** One DOM element per tag `key`, reused frame to frame so a still-active tag never flickers. @type {Map<string, {root: HTMLElement, icon: HTMLElement, label: HTMLElement, seconds: HTMLElement}>} */
  const tagElements = new Map();

  /** Builds one tag's DOM once; `setPowerUpTags` only ever updates its content and position after this. */
  function buildTagElement() {
    const tagRoot = doc.createElement('div');
    tagRoot.className = 'hud-powerup-tag';

    const icon = doc.createElement('span');
    icon.className = 'hud-powerup-tag-icon';

    const text = doc.createElement('span');
    text.className = 'hud-powerup-tag-text';

    const label = doc.createElement('span');
    label.className = 'hud-powerup-tag-label';

    const seconds = doc.createElement('span');
    seconds.className = 'hud-powerup-tag-seconds';

    text.append(label, seconds);
    tagRoot.append(icon, text);
    tagsLayer.appendChild(tagRoot);
    return { root: tagRoot, icon, label, seconds };
  }

  return {
    /**
     * Shows or hides the whole HUD. `ARCHITECTURE §8`: "The HUD is visible only in COUNTDOWN, PLAYING,
     * LASER_WARNING and PAUSE; menus, the scoreboard and MATCH_OVER hide it" — the design lead's ruling
     * during the Sprint 05 review, where the timer and both length panels were drawn over the main menu.
     * `ui.js` owns *which* states those are; this only does as it is told.
     *
     * @param {boolean} visible
     */
    setVisible(visible) {
      container.hidden = !visible;
      tagsLayer.hidden = !visible;
    },
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
    /**
     * Redraws every power-up tag from `session.js`'s own list (AC1–AC3). A tag not present this call is
     * removed rather than merely hidden — the DOM never accumulates elements for effects long since ended.
     *
     * @param {PowerUpTagState[]} tags
     */
    setPowerUpTags(tags) {
      const seen = new Set();
      for (const tag of tags) {
        seen.add(tag.key);
        let element = tagElements.get(tag.key);
        if (element === undefined) {
          element = buildTagElement();
          tagElements.set(tag.key, element);
        }

        const copy = POWERUP_TAG_COPY[tag.type];
        element.icon.textContent = copy.icon;
        element.icon.className = `hud-powerup-tag-icon ${copy.iconClass}`;
        element.label.textContent = copy.label;
        element.seconds.textContent = `${tag.seconds}s`;

        const stackY = POWERUP_TAG_OFFSET.y + (tag.stackIndex ?? 0) * POWERUP_TAG_STACK_OFFSET_Y;
        element.root.style.left = `${tag.xFraction * 100}%`;
        element.root.style.top = `${tag.yFraction * 100}%`;
        element.root.style.transform = `translate(${POWERUP_TAG_OFFSET.x}px, ${stackY}px)`;
      }
      for (const [key, element] of tagElements) {
        if (seen.has(key)) continue;
        element.root.remove();
        tagElements.delete(key);
      }
    },
    destroy() {
      container.remove();
      tagsLayer.remove();
    },
  };
}
