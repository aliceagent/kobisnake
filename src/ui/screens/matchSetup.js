// @ts-check
import { SETTINGS } from '../../core/settings.js';
import { STATES } from '../../game/gameStateMachine.js';
import { createFocusModel } from '../focus.js';

/**
 * The match setup screen (`DESIGN-DECISIONS §3` "Match setup (GDD image 15)", ticket KS-05-04). Grey-box
 * only: six rows — MATCH LENGTH, POWER-UPS, MUSIC, PLAYER 1 colour, PLAYER 2 colour, START MATCH — built once
 * on the shared focus model (`../focus.js`) and kept live across re-renders by reading the *current* props out
 * of a shared mutable ref rather than rebuilding the row list every `render()` call: `session.js` calls
 * `show('MATCH_SETUP', {...})` again with a complete new `matchSettings` object every time any row changes
 * (the tech-lead contract, note A), and a rebuilt focus list would have no way to remember which row the
 * player was just on.
 *
 * The colour-swap rule (`DESIGN-DECISIONS §2.7`, AC3) lives in {@link pickPlayerColor} below as a pure
 * function of `(matchSettings, player, ownedColors, direction)` precisely so it can be unit-tested without a
 * DOM (`tests/unit/ui/matchSetup.test.js` — not on this ticket's `Files:` list, called out in the PR
 * description per CLAUDE.md, the same way `tests/unit/ui/hud.test.js` was for KS-04-03).
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */
/** @typedef {{1: string, 2: string}} PlayerColors */
/**
 * @typedef {object} MatchSettings
 * @property {number} bestOf
 * @property {boolean} powerUpsEnabled
 * @property {string} musicTrack
 * @property {PlayerColors} colors
 */

/**
 * @typedef {object} MatchSetupProps
 * @property {MatchSettings} matchSettings
 * @property {string[]} ownedColors
 * @property {(next: MatchSettings) => void} onChange
 * @property {() => void} onStart
 * @property {() => void} onBack
 */

/**
 * @typedef {object} MatchSetupScreen
 * @property {(props: MatchSetupProps) => void} render
 * @property {() => void} show
 * @property {() => void} hide
 * @property {(action: MenuAction) => void} handleMenuAction
 * @property {() => void} destroy
 */

/**
 * The three placeholder music tracks (`ARCHITECTURE §3`: `src/audio/tracks/track1.js` … `track3.js`; content
 * and real names arrive with Sprint 12 audio). Grey-box display only — never invented as a new mechanic, just
 * the identifiers Sprint 12's own file layout already uses.
 * @type {readonly string[]}
 */
export const MUSIC_TRACKS = Object.freeze(['track1', 'track2', 'track3']);

/**
 * Cycles `current` to its neighbour in `values`, wrapping around; falls back to the first value if `current`
 * is not present at all (defensive — every caller here passes a `current` drawn from the same list).
 *
 * @template T
 * @param {readonly T[]} values
 * @param {T} current
 * @param {1 | -1} direction
 * @returns {T}
 */
function cycleValue(values, current, direction) {
  if (values.length === 0) return current;
  const at = values.indexOf(current);
  const base = at === -1 ? 0 : at;
  return values[(base + direction + values.length) % values.length];
}

/**
 * MATCH LENGTH: cycles `matchSettings.bestOf` through `SETTINGS.bestOfOptions` (never a hand-rolled list —
 * `CLAUDE.md`/tech-lead note E: "read `bestOfOptions` … from `SETTINGS`").
 *
 * @param {MatchSettings} matchSettings
 * @param {1 | -1} direction
 * @returns {MatchSettings}
 */
export function changeMatchLength(matchSettings, direction) {
  return { ...matchSettings, bestOf: cycleValue(SETTINGS.bestOfOptions, matchSettings.bestOf, direction) };
}

/** POWER-UPS: an ON/OFF pill, so either arrow direction just flips it.
 * @param {MatchSettings} matchSettings
 * @returns {MatchSettings}
 */
export function togglePowerUps(matchSettings) {
  return { ...matchSettings, powerUpsEnabled: !matchSettings.powerUpsEnabled };
}

/** MUSIC: cycles through {@link MUSIC_TRACKS}.
 * @param {MatchSettings} matchSettings
 * @param {1 | -1} direction
 * @returns {MatchSettings}
 */
export function changeMusicTrack(matchSettings, direction) {
  return { ...matchSettings, musicTrack: cycleValue(MUSIC_TRACKS, matchSettings.musicTrack, direction) };
}

/**
 * Cycles `player`'s colour through `ownedColors`, enforcing the swap rule (`DESIGN-DECISIONS §2.7`, AC3):
 * "two players can never select the same colour; selecting the colour the other player holds swaps the
 * two." Only the *landing* colour is ever checked against the other player's current colour — with today's
 * two owned colours (`red`, `blue`) every step lands on the other player's colour, so this fires on every
 * single cycle, which is exactly the "must never leave both players on the same colour at any intermediate
 * step" tech-lead requirement (note D): there is no intermediate step where `nextMine === nextOther`.
 *
 * @param {MatchSettings} matchSettings
 * @param {1 | 2} player
 * @param {readonly string[]} ownedColors
 * @param {1 | -1} direction
 * @returns {MatchSettings}
 */
export function pickPlayerColor(matchSettings, player, ownedColors, direction) {
  const other = player === 1 ? 2 : 1;
  const currentMine = matchSettings.colors[player];
  const currentOther = matchSettings.colors[other];
  const nextMine = cycleValue(ownedColors, currentMine, direction);
  const nextOther = nextMine === currentOther ? currentMine : currentOther;
  return {
    ...matchSettings,
    colors: { ...matchSettings.colors, [player]: nextMine, [other]: nextOther },
  };
}

/** @param {string} name @returns {string} */
function capitalize(name) {
  return name.length === 0 ? name : name.charAt(0).toUpperCase() + name.slice(1);
}

/** @param {string} track @returns {string} */
function musicLabel(track) {
  const index = MUSIC_TRACKS.indexOf(track);
  return index === -1 ? track.toUpperCase() : `TRACK ${index + 1}`;
}

/**
 * Build the match setup screen inside `root`.
 *
 * @param {HTMLElement} root
 * @returns {MatchSetupScreen}
 */
export function createMatchSetupScreen(root) {
  const doc = root.ownerDocument;

  const container = doc.createElement('div');
  container.className = 'menu-screen menu-screen--match-setup';
  // A stable test hook on top of the (Sprint-11-restylable) class name (tech-lead note on this ticket).
  container.dataset.screen = STATES.MATCH_SETUP;
  container.hidden = true;

  const panel = doc.createElement('div');
  panel.className = 'menu-panel';

  const title = doc.createElement('div');
  title.className = 'menu-title';
  title.textContent = 'MATCH SETUP';
  panel.appendChild(title);

  /** @type {MatchSetupProps} */
  let props = {
    matchSettings: { bestOf: 3, powerUpsEnabled: true, musicTrack: MUSIC_TRACKS[0], colors: { 1: 'red', 2: 'blue' } },
    ownedColors: ['red', 'blue'],
    onChange: () => {},
    onStart: () => {},
    onBack: () => {},
  };

  /**
   * @param {string} label
   * @returns {{ row: HTMLElement, value: HTMLElement }}
   */
  function buildRow(label) {
    const row = doc.createElement('div');
    row.className = 'menu-item';
    const labelEl = doc.createElement('span');
    labelEl.className = 'menu-item-label';
    labelEl.textContent = label;
    const value = doc.createElement('span');
    value.className = 'menu-item-value';
    row.append(labelEl, value);
    panel.appendChild(row);
    return { row, value };
  }

  const matchLength = buildRow('MATCH LENGTH');
  const powerUps = buildRow('POWER-UPS');
  const music = buildRow('MUSIC');
  const p1Color = buildRow('PLAYER 1 COLOUR');
  const p2Color = buildRow('PLAYER 2 COLOUR');

  const startRow = doc.createElement('div');
  startRow.className = 'menu-item menu-item--action';
  startRow.textContent = 'START MATCH';
  panel.appendChild(startRow);

  container.appendChild(panel);
  root.appendChild(container);

  const rows = [matchLength.row, powerUps.row, music.row, p1Color.row, p2Color.row, startRow];

  // Built once, never rebuilt: each callback reads `props` live at call time, so a re-render (a fresh
  // `matchSettings` object from `session.js`) never has to rebuild the focus list or lose the cursor.
  const focus = createFocusModel({
    items: [
      { onChange: (dir) => props.onChange(changeMatchLength(props.matchSettings, dir)) },
      { onChange: () => props.onChange(togglePowerUps(props.matchSettings)) },
      { onChange: (dir) => props.onChange(changeMusicTrack(props.matchSettings, dir)) },
      { onChange: (dir) => props.onChange(pickPlayerColor(props.matchSettings, 1, props.ownedColors, dir)) },
      { onChange: (dir) => props.onChange(pickPlayerColor(props.matchSettings, 2, props.ownedColors, dir)) },
      { onSelect: () => props.onStart() },
    ],
    onBack: () => props.onBack(),
  });

  function updateFocusClasses() {
    const focused = focus.getIndex();
    rows.forEach((row, i) => row.classList.toggle('menu-item--focused', i === focused));
  }

  rows.forEach((row, i) => {
    row.addEventListener('mouseenter', () => {
      focus.setIndex(i);
      updateFocusClasses();
    });
    row.addEventListener('click', () => {
      focus.setIndex(i);
      focus.select();
      updateFocusClasses();
    });
  });

  function renderValues() {
    const { matchSettings } = props;
    matchLength.value.textContent = `BEST OF ${matchSettings.bestOf}`;
    powerUps.value.textContent = matchSettings.powerUpsEnabled ? 'ON' : 'OFF';
    music.value.textContent = musicLabel(matchSettings.musicTrack);
    p1Color.value.textContent = capitalize(matchSettings.colors[1]).toUpperCase();
    p2Color.value.textContent = capitalize(matchSettings.colors[2]).toUpperCase();
  }

  renderValues();
  updateFocusClasses();

  return {
    render(nextProps) {
      props = nextProps;
      renderValues();
      updateFocusClasses();
    },
    show() {
      container.hidden = false;
    },
    hide() {
      container.hidden = true;
    },
    handleMenuAction(action) {
      focus.handleAction(action);
      updateFocusClasses();
    },
    destroy() {
      container.remove();
    },
  };
}
