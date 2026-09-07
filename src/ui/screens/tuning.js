// @ts-check
import {
  DEFAULT_SLOW_TARGET_MODE,
  LASER_START_TIME_PRESETS,
  LASER_STEP_INTERVAL_PRESETS,
  SLOW_TARGET_MODES,
  SPEED_BOOST_PRESETS,
  TUNABLES,
  buildSettingsOverride,
  defaultTuningValues,
} from '../../game/tuning.js';

/**
 * The `?tuning=1` overlay (KS-07-01, `docs/sprints/sprint-07-playtest-gate-1-and-tuning.md`): a small always-
 * on panel — not one of `ui.js`'s per-`GameState` screens, and never routed through `ui.show()` — that lets a
 * human change every tunable `src/game/tuning.js` lists, live, without a reload. `main.js` builds this only
 * when the tuning flag is on (AC3: no DOM node at all otherwise) and calls `show()` once; every other screen
 * still shows and hides underneath it exactly as before.
 *
 * This module owns no game state itself. Every value change calls `options.onChange` with the *whole*
 * override tree (`tuning.js`'s `buildSettingsOverride`) and `session.js`'s `setSettingsOverrides` is what
 * actually threads it into the next round (AC1). "Copy replay" calls `options.getReplay` and never touches
 * `session.js` directly — same reason every other screen only ever receives callbacks in its props rather
 * than importing `session.js`.
 *
 * DOM access goes through `root.ownerDocument`, matching every other `./screens/*.js` module, so this stays
 * constructible in a plain Node test with a hand-built fake root.
 *
 * **Fold/collapse (tech-lead PR review on #115).** A human measured the shipped panel at 1280×720 in
 * `PLAYING`: it covered the arena's right flank *and* sat directly on top of P2's own HUD length pill —
 * `document.elementFromPoint` at the pill's centre resolved to `tuning-overlay`, not the pill, so P2 could
 * not see their own length and a death in that column would be unreadable in session 2's own playtest data.
 * `setRoundActive(active)` (called by `ui.js`'s `show()`, one call per `GameState` — see that file's
 * `HUD_STATES`) folds the panel down to its header the instant a round goes live, matching how a human
 * actually uses this: open it between rounds to change a value, fold it away to play. It only *forces* the
 * fold on the transition into a round — leaving one never forces it back open, so whatever a human set up
 * between rounds is still visible once the round ends — and it does not lock the header: clicking it still
 * toggles the fold at any time, mid-round included, because a human (or a test) that deliberately wants the
 * panel back has made that call themselves, which is a different thing from the panel defaulting to covering
 * the game underneath it. Collapsed, the panel is a small header-only strip pinned to the *bottom*-right
 * (`.tuning-overlay--collapsed` in `styles.css`) rather than the top-right the expanded panel uses, because
 * the flank alongside the arena is exactly wide enough for the panel but not wide enough to dodge the P2 pill
 * sitting in that same flank's top corner — moving down clears the pill without needing to also narrow it.
 */

/** @typedef {import('../../game/tuning.js').SlowTargetMode} SlowTargetMode */
/** @typedef {import('../../game/tuning.js').TuningSettingsOverride} TuningSettingsOverride */

/**
 * @typedef {object} TuningReplay
 * @property {number | null} seed
 * @property {object} settingsOverrides
 * @property {object[]} inputs
 * @property {object[]} expectedEvents
 */

/**
 * @typedef {object} TuningScreenOptions
 * @property {(overrides: TuningSettingsOverride) => void} onChange - called with the complete override tree
 *   every time any control changes (AC1).
 * @property {() => TuningReplay} getReplay - the current round's replay (`session.js`'s `getReplay()`).
 * @property {{writeText: (text: string) => Promise<void>} | null} [clipboard] - defaults to
 *   `navigator.clipboard` where one exists. Injectable because a real clipboard write can be denied by the
 *   browser (tech-lead note 6) and a test needs to force that path without a real permissions prompt.
 */

/**
 * @typedef {object} TuningScreen
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(active: boolean) => void} setRoundActive - `active` is `ui.js`'s own `HUD_STATES.has(state)`,
 *   i.e. "is a round visibly under way right now" (COUNTDOWN/PLAYING/LASER_WARNING/PAUSE). Folds the panel on
 *   the transition into one of those states; see the module doc comment above.
 * @property {() => void} destroy
 */

/** A tuning row's DOM, so {@link renderValue} can update the live number without rebuilding the row. */
class TuningRow {
  /**
   * @param {Document} doc
   * @param {import('../../game/tuning.js').TunableSpec} spec
   * @param {(key: string, value: number) => void} onInput
   */
  constructor(doc, spec, onInput) {
    this.spec = spec;

    this.root = doc.createElement('label');
    this.root.className = 'tuning-row';

    const labelEl = doc.createElement('span');
    labelEl.className = 'tuning-row-label';
    labelEl.textContent = spec.label;

    this.input = /** @type {HTMLInputElement} */ (doc.createElement('input'));
    this.input.type = 'range';
    this.input.min = String(spec.min);
    this.input.max = String(spec.max);
    this.input.step = String(spec.step);
    this.input.dataset.tuningKey = spec.key;

    this.valueEl = doc.createElement('span');
    this.valueEl.className = 'tuning-row-value';

    this.input.addEventListener('input', () => {
      const value = Number(this.input.value);
      this.setValue(value);
      onInput(spec.key, value);
    });

    this.root.append(labelEl, this.input, this.valueEl);
  }

  /** @param {number} value */
  setValue(value) {
    this.input.value = String(value);
    this.valueEl.textContent = `${formatNumber(value)}${this.spec.unit}`;
  }
}

/**
 * Trims a value to at most two decimals for display (`step: 0.05` etc. would otherwise print float noise
 * like `1.4500000000000002`) without rounding the value actually sent to `onChange` — only this label.
 * @param {number} value
 */
function formatNumber(value) {
  return Number(value.toFixed(2)).toString();
}

/**
 * Build the tuning overlay inside `root` (`#ui`).
 *
 * @param {HTMLElement} root
 * @param {TuningScreenOptions} options
 * @returns {TuningScreen}
 */
export function createTuningScreen(root, { onChange, getReplay, clipboard }) {
  const doc = root.ownerDocument;
  const resolvedClipboard =
    clipboard !== undefined
      ? clipboard
      : /** @type {any} */ ((globalThis).navigator?.clipboard ?? null);

  /** @type {Record<string, number> & {slowTargetMode: SlowTargetMode}} */
  const values = defaultTuningValues();

  const container = doc.createElement('div');
  container.className = 'tuning-overlay';
  // A stable hook for AC3's e2e spec (`present with ?tuning=1`, `absent otherwise`) and for a human QA
  // engineer, the same discipline `ui.js`'s `data-screen` uses.
  container.dataset.tuningOverlay = 'true';

  let collapsed = false;

  const header = doc.createElement('div');
  header.className = 'tuning-overlay-header';
  header.dataset.tuningFoldToggle = 'true';
  container.appendChild(header);

  /** Reflects `collapsed` onto the container's class and the header's own text/affordance. */
  function renderCollapsed() {
    container.classList.toggle('tuning-overlay--collapsed', collapsed);
    header.textContent = collapsed ? '▸ TUNING' : '▾ TUNING';
  }

  // A click is the fold toggle, not a key: this panel already owns `<input type="range">`, `<select>` and a
  // `<textarea>` (the replay JSON), so a dedicated hotkey would have to dodge every one of them or risk
  // hijacking normal typing/typeahead inside those controls, and `input.js` (the one place this app's other
  // keyboard handling lives, ARCHITECTURE §8) has no notion of this dev-only overlay at all. A click has
  // neither problem and is exactly what a header visually invites.
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    renderCollapsed();
  });
  renderCollapsed();

  const body = doc.createElement('div');
  body.className = 'tuning-overlay-body';
  container.appendChild(body);

  function emitChange() {
    onChange(buildSettingsOverride(values));
  }

  /** @type {TuningRow[]} */
  const rows = TUNABLES.map((spec) => {
    const row = new TuningRow(doc, spec, (key, value) => {
      values[key] = value;
      emitChange();
    });
    row.setValue(values[spec.key]);
    body.appendChild(row.root);
    return row;
  });

  /**
   * Sets one or more flat values at once (a preset button) and refreshes the matching sliders — the same
   * update `TuningRow`'s own `input` listener makes, done for every key a preset touches in one call so
   * `emitChange` fires once, not once per field.
   * @param {Record<string, number>} patch
   */
  function applyPatch(patch) {
    for (const [key, value] of Object.entries(patch)) {
      values[key] = value;
      const row = rows.find((candidate) => candidate.spec.key === key);
      row?.setValue(value);
    }
    emitChange();
  }

  // --- SLOW target mode (tech-lead note 3: the one genuinely new behaviour, wired only so it can be felt) --

  const slowModeRow = doc.createElement('label');
  slowModeRow.className = 'tuning-row';
  const slowModeLabel = doc.createElement('span');
  slowModeLabel.className = 'tuning-row-label';
  slowModeLabel.textContent = 'SLOW target';
  const slowModeSelect = /** @type {HTMLSelectElement} */ (doc.createElement('select'));
  slowModeSelect.dataset.tuningSlowMode = 'true';
  for (const mode of SLOW_TARGET_MODES) {
    const option = doc.createElement('option');
    option.value = mode;
    option.textContent = mode;
    slowModeSelect.appendChild(option);
  }
  slowModeSelect.value = DEFAULT_SLOW_TARGET_MODE;
  slowModeSelect.addEventListener('change', () => {
    values.slowTargetMode = /** @type {SlowTargetMode} */ (slowModeSelect.value);
    emitChange();
  });
  slowModeRow.append(slowModeLabel, slowModeSelect);
  body.appendChild(slowModeRow);

  // --- quick-access presets (tech-lead note 2: session 2's variants, reachable without hunting a slider) ---

  const presets = doc.createElement('div');
  presets.className = 'tuning-presets';
  body.appendChild(presets);

  /**
   * One row of preset buttons.
   * @param {string} label
   * @param {{text: string, patch: Record<string, number>}[]} buttons
   */
  function presetGroup(label, buttons) {
    const group = doc.createElement('div');
    group.className = 'tuning-preset-group';
    const groupLabel = doc.createElement('span');
    groupLabel.className = 'tuning-preset-group-label';
    groupLabel.textContent = label;
    group.appendChild(groupLabel);
    for (const { text, patch } of buttons) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'tuning-preset-button';
      button.textContent = text;
      button.addEventListener('click', () => applyPatch(patch));
      group.appendChild(button);
    }
    presets.appendChild(group);
  }

  // Session 2's laser variants (`docs/sprints/sprint-07-playtest-gate-1-and-tuning.md` KS-07-02): "laser
  // start 25 / 30 / 35 s" and "step interval 2 / 2.5 / 3 s".
  presetGroup(
    'Laser start',
    LASER_START_TIME_PRESETS.map((seconds) => ({
      text: `${seconds}s`,
      patch: { laserStartTime: seconds },
    })),
  );
  presetGroup(
    'Laser step',
    LASER_STEP_INTERVAL_PRESETS.map((seconds) => ({
      text: `${seconds}s`,
      patch: { laserStepInterval: seconds },
    })),
  );
  // The sprint's sharpest open question (tech-lead note 2): one button per side of the pair, so it needs no
  // slider dragging under a stopwatch.
  presetGroup(
    'Speed Boost',
    SPEED_BOOST_PRESETS.map((preset) => ({
      text: preset.label,
      patch: { 'speedBoost.multiplier': preset.multiplier, 'speedBoost.duration': preset.duration },
    })),
  );

  // --- copy replay (tech-lead note 6: failure must be visible, and the JSON reachable another way too) ----

  const footer = doc.createElement('div');
  footer.className = 'tuning-overlay-footer';
  container.appendChild(footer);

  const copyButton = doc.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'tuning-copy-button';
  copyButton.textContent = 'Copy replay';
  copyButton.dataset.tuningCopyReplay = 'true';
  footer.appendChild(copyButton);

  const status = doc.createElement('span');
  status.className = 'tuning-copy-status';
  status.dataset.tuningCopyStatus = 'true';
  footer.appendChild(status);

  // Always populated on every copy attempt, clipboard or not — "the JSON reachable another way too" (tech-
  // lead note 6): a human whose browser blocks `navigator.clipboard` can still select-all and copy this by
  // hand, and an e2e spec can read it without needing clipboard permissions granted at all.
  const replayJsonEl = /** @type {HTMLTextAreaElement} */ (doc.createElement('textarea'));
  replayJsonEl.className = 'tuning-replay-json';
  replayJsonEl.readOnly = true;
  replayJsonEl.dataset.tuningReplayJson = 'true';
  footer.appendChild(replayJsonEl);

  copyButton.addEventListener('click', () => {
    const json = JSON.stringify(getReplay(), null, 2);
    replayJsonEl.value = json;
    if (resolvedClipboard === null || typeof resolvedClipboard.writeText !== 'function') {
      status.textContent = 'Clipboard unavailable — copy the text below';
      return;
    }
    resolvedClipboard.writeText(json).then(
      () => {
        status.textContent = 'Copied!';
      },
      () => {
        // A denied clipboard permission must not fail silently (tech-lead note 6) — the JSON is already in
        // `replayJsonEl` above regardless of which branch this callback takes.
        status.textContent = 'Clipboard blocked — copy the text below';
      },
    );
  });

  root.appendChild(container);

  return {
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    setRoundActive(active) {
      // Only the *entering* edge forces a fold (see the module doc comment) — leaving a round never forces
      // it back open, and this never fights a fold the human has already made for themselves.
      if (active && !collapsed) {
        collapsed = true;
        renderCollapsed();
      }
    },
    destroy() {
      container.remove();
    },
  };
}
