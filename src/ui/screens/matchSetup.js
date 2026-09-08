// @ts-check
import { SETTINGS } from '../../core/settings.js';
import { LEVELS } from '../../game/bots/levels.js';
import { STATES } from '../../game/gameStateMachine.js';
import { snakeColorHex } from '../../render/materials.js';
import { MIN_COLOUR_DIFFERENCE, worstCaseColourDifference } from '../../render/colourVision.js';
import { createFocusModel } from '../focus.js';
import { matchSetup } from '../strings.js';

/**
 * The match setup screen (`DESIGN-DECISIONS §3` "Match setup (GDD image 15)", ticket KS-05-04). Grey-box
 * only: eight rows — MATCH LENGTH, POWER-UPS, MUSIC, PLAYER 1 (kind), PLAYER 1 colour, PLAYER 2 (kind),
 * PLAYER 2 colour, START MATCH (the two "kind" rows are KI-12-04's own HUMAN/CPU switch, added right above
 * the colour row of the player they belong to) — built once on the shared focus model (`../focus.js`) and
 * kept live across re-renders by reading the *current* props out
 * of a shared mutable ref rather than rebuilding the row list every `render()` call: `session.js` calls
 * `show('MATCH_SETUP', {...})` again with a complete new `matchSettings` object every time any row changes
 * (the tech-lead contract, note A), and a rebuilt focus list would have no way to remember which row the
 * player was just on.
 *
 * The colour-swap rule (`DESIGN-DECISIONS §2.7`, AC3) lives in {@link pickPlayerColor} below as a pure
 * function of `(matchSettings, player, ownedColors, direction)` precisely so it can be unit-tested without a
 * DOM (`tests/unit/ui/matchSetup.test.js` — not on this ticket's `Files:` list, called out in the PR
 * description per CLAUDE.md, the same way `tests/unit/ui/hud.test.js` was for KS-04-03).
 *
 * **KI-10-02 controls card** (`DESIGN-DECISIONS §3` "Controls card on match setup"): two presentational rows
 * naming each player's keys, colour-matched to the snake they describe. {@link controlsCardLabel} builds the
 * approved-copy string from the *live* `matchSettings.colors` — never a literal colour word — because this
 * card sits on the very screen where a player can change that colour (§2.7's swap rule, right above); a
 * hardcoded "RED" would go stale the moment either player picks a different colour, on the screen where they
 * picked it. The key list (`W A S D` / `ARROW KEYS`) is a literal here, not read live: `src/game/input.js`'s
 * `PLAYER_ONE_KEYS`/`PLAYER_TWO_KEYS` maps are module-private (not exported) and `input.js` is not on this
 * ticket's `Files:` list to change, so there is nothing live to read yet — Improvement 07 (a real binding
 * table) has not landed. See the PR description.
 *
 * **KI-12-04 the switch.** Each player gains its own row, cycling `HUMAN` / `CPU EASY` / `CPU NORMAL`
 * (`DESIGN-DECISIONS §1` row 27 — the row's approved *value* strings). {@link changePlayerKind} is the same
 * pure-function-of-`(matchSettings, player, direction)` pattern {@link pickPlayerColor} already established
 * on this file, cycling `matchSettings.playerKinds[player]` through {@link PLAYER_KIND_VALUES} — see that
 * constant's own doc comment for why `HARD` exists in `levels.js` but is deliberately not one of the three
 * values this row offers (#217's measurement, ruled on #210). The row's own left-hand label (`PLAYER 1` /
 * `PLAYER 2`, placed directly above that player's existing `PLAYER 1 COLOUR` / `PLAYER 2 COLOUR` row) is
 * **not** copy row 27 approves — flagged as a
 * question on #210 in this ticket's own PR; nothing in this file or its tests reads that label text, only the
 * row's position, so a ruling can change it with no other edit. `controlsCardLabel` below is extended (not
 * replaced) with a third, optional `isCpu` argument so its two existing two-argument call sites keep their
 * exact behaviour.
 *
 * **KI-15-02 colour-safe pairing note.** {@link checkColourSafety} below is the same pure-function pattern as
 * {@link pickPlayerColor}: given `(matchSettings, ownedColors)` it answers whether the two chosen colours
 * clear KI-15-01's `worstCaseColourDifference`/`MIN_COLOUR_DIFFERENCE` check (`colourVision.js`,
 * `DESIGN-DECISIONS §2.7`) and, when they do not, which owned colour is the best passing alternative for
 * player 2. It never blocks START MATCH — it only decides whether the note below the colour rows is shown.
 * Issue #184 has since been answered and `DESIGN-DECISIONS §3` now carries "The colour-safe pairing note on
 * match setup" as an approved bullet, read from the catalogue (`matchSetup.colourNote.note`,
 * `src/ui/strings.js`) since KI-20-02. `COLOUR_NOTE_COPY.suggestion` (the note's second sentence, naming the
 * recommended colour) is the one exception: §3's approved form differs from what this screen has always
 * rendered — capital `PLAYER` there, lower-case `player` here, a computed player number there, a hard-coded
 * `2` here — and that discrepancy is still open on #212/#214, not this ticket's to resolve. See
 * {@link COLOUR_NOTE_COPY}'s own doc comment for why that one literal is a deliberate KI-20-02 AC3 exception.
 * Every assertion elsewhere (`tests/e2e`, `tests/unit/ui/matchSetup.test.js`) binds to structure — whether the
 * note element is present and visible, and which colour name it recommends — never to the sentence itself.
 */

/** @typedef {import('../focus.js').MenuAction} MenuAction */
/** @typedef {import('../../game/bots/levels.js').Level} Level */
/** @typedef {{1: string, 2: string}} PlayerColors */
/**
 * `'HUMAN'` or one of `../../game/bots/levels.js`'s own {@link Level} ids — KI-12-04's own addition. Never a
 * fourth string: `session.js`'s `policyForLevel` throws on anything else, and row 27 names exactly these four
 * as the row's approved *values* (`'HUMAN'` displays bare; a {@link Level} displays as `CPU ${level}`).
 * @typedef {'HUMAN' | Level} PlayerKind
 */
/** @typedef {{1: PlayerKind, 2: PlayerKind}} PlayerKinds */
/**
 * @typedef {object} MatchSettings
 * @property {number} bestOf
 * @property {boolean} powerUpsEnabled
 * @property {string} musicTrack
 * @property {PlayerColors} colors
 * @property {PlayerKinds} playerKinds - KI-12-04: `{1: 'HUMAN', 2: 'HUMAN'}` is the shipping default
 *   (`DESIGN-DECISIONS §1` row 27, AC1).
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
  return {
    ...matchSettings,
    bestOf: cycleValue(SETTINGS.bestOfOptions, matchSettings.bestOf, direction),
  };
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
  return {
    ...matchSettings,
    musicTrack: cycleValue(MUSIC_TRACKS, matchSettings.musicTrack, direction),
  };
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

/**
 * The row's approved cycle order (`DESIGN-DECISIONS §1` row 27): `HUMAN` first (the shipping default), then
 * the CPU levels this row actually **offers** — `EASY` and `NORMAL` only.
 *
 * **`HARD` is deliberately absent, on purpose, permanently — do not "tidy" this back into
 * `['HUMAN', ...Object.values(LEVELS)]`.** `HARD` still exists and is fully supported in `levels.js` (it is
 * exported from `LEVELS`, `policyForLevel('HARD')` still returns its policy, and nothing downstream of this
 * row — {@link changePlayerKind}, `session.js`'s `syncCpuPlayersFromKinds`/`policyForLevel` — rejects it; a
 * caller that hands `'HARD'` straight to `session.js` (a test, `levels.js`'s own consumers) still works). This
 * is only about what a *player* is offered to choose. KI-12-03 measured the redefined `HARD` (survivor's
 * rules plus eating when it is safe) at **+3.1pp against `NORMAL`, 95% CI ±6.3pp, p = 0.32, n = 1000**
 * (`docs/qa/playtests/cpu-levels.md`, #217) — indistinguishable from zero, not an opponent a player would
 * feel as stronger. Design-lead ruling on #210: "Two honest levels beat three with one that lies." The gap
 * between the levels `levels.js` *defines* and the levels this row *offers* is the point of this constant,
 * not an oversight for a later reader to close.
 *
 * `LEVELS.EASY`/`LEVELS.NORMAL` rather than the bare string literals `'EASY'`/`'NORMAL'`, so the two values
 * this row does offer still can't drift from `levels.js`'s own spelling of them.
 *
 * @type {readonly PlayerKind[]}
 */
export const PLAYER_KIND_VALUES = Object.freeze(
  /** @type {PlayerKind[]} */ (['HUMAN', LEVELS.EASY, LEVELS.NORMAL]),
);

/**
 * KI-12-04's own row: cycles `player`'s kind through {@link PLAYER_KIND_VALUES} — `HUMAN`, then the two
 * offered CPU levels, wrapping around. Independent of {@link pickPlayerColor}: a CPU still owns a colour (its
 * snake still needs one to render), so cycling a player's kind never touches `matchSettings.colors`.
 *
 * @param {MatchSettings} matchSettings
 * @param {1 | 2} player
 * @param {1 | -1} direction
 * @returns {MatchSettings}
 */
export function changePlayerKind(matchSettings, player, direction) {
  return {
    ...matchSettings,
    playerKinds: {
      ...matchSettings.playerKinds,
      [player]: cycleValue(PLAYER_KIND_VALUES, matchSettings.playerKinds[player], direction),
    },
  };
}

/**
 * KI-15-02: the colour-pairing note's two sentences.
 *
 * `note` is approved copy since KI-20-02 (`DESIGN-DECISIONS §3`, "The colour-safe pairing note on match
 * setup") and reads from the catalogue below (`matchSetup.colourNote.note`).
 *
 * `suggestion` is a **deliberate exception to this ticket's AC3** — tracked on #214, not #184 (#184 is
 * answered; §3 now carries the note). §3's approved form is `matchSetup.colourNote.suggestion` in the
 * catalogue: capital `PLAYER`, with the player number computed rather than hard-coded — but that is not what
 * this screen has ever rendered. This screen has always rendered lower-case `player 2`, hard-coded, and the
 * design lead has not yet ruled on which one is right (#212/#214). KI-20-02 is a refactor whose guarantee is
 * that no rendered pixel moves, so this one literal stays exactly as it is — not read from the catalogue —
 * until that ruling lands and a follow-up PR (outside KI-20-02) re-records whichever form is correct, with a
 * new baseline. Do not "fix" this by pointing it at `matchSetup.colourNote.suggestion`.
 *
 * @type {{ note: string, suggestion: (colorName: string) => string }}
 */
const COLOUR_NOTE_COPY = {
  note: matchSetup.colourNote.note,
  // #214 exception (see above) — left exactly as this screen has always rendered it.
  suggestion: (colorName) => `Try ${colorName.toUpperCase()} for player 2.`,
};

/**
 * @typedef {object} ColourSafetyResult
 * @property {boolean} failing - whether the two chosen colours fail KI-15-01's check.
 * @property {string | null} recommendedColor - the nearest owned alternative for player 2, or `null` when
 *   `failing` is `false`, or when it is `true` but nothing owned clears the check either.
 */

/**
 * KI-15-02: whether `matchSettings.colors[1]`/`[2]` pass KI-15-01's colour-vision check
 * (`worstCaseColourDifference(...) >= MIN_COLOUR_DIFFERENCE`, `colourVision.js`, `DESIGN-DECISIONS §2.7`)
 * and, when they do not, the nearest passing alternative for player 2.
 *
 * "Nearest passing alternative" (the ticket's own spec): among `ownedColors`, excluding player 1's colour,
 * the one with the *highest* `worstCaseColourDifference` against player 1's colour that still clears
 * `MIN_COLOUR_DIFFERENCE` — the best-separated owned colour that actually passes, not merely the first one
 * tried. `recommendedColor` is `null` when none clears it: **no fallback is invented** — the ticket is
 * explicit that this case says nothing about an alternative.
 *
 * Pure and exported for the same reason {@link pickPlayerColor} is: unit-testable without a DOM
 * (`tests/unit/ui/matchSetup.test.js`), and the one source of truth both `renderColourNote` below and every
 * e2e/unit assertion read.
 *
 * @param {MatchSettings} matchSettings
 * @param {readonly string[]} ownedColors
 * @param {import('../../core/settings.js').Settings} [settings] - defaults to the shipping `SETTINGS`
 * @returns {ColourSafetyResult}
 */
export function checkColourSafety(matchSettings, ownedColors, settings = SETTINGS) {
  const colorOne = matchSettings.colors[1];
  const colorTwo = matchSettings.colors[2];
  const hexOne = snakeColorHex(colorOne, settings);
  const failing =
    worstCaseColourDifference(hexOne, snakeColorHex(colorTwo, settings)) < MIN_COLOUR_DIFFERENCE;
  if (!failing) return { failing: false, recommendedColor: null };

  let recommendedColor = /** @type {string | null} */ (null);
  let bestDifference = -Infinity;
  for (const candidate of ownedColors) {
    if (candidate === colorOne) continue;
    const difference = worstCaseColourDifference(hexOne, snakeColorHex(candidate, settings));
    if (difference >= MIN_COLOUR_DIFFERENCE && difference > bestDifference) {
      bestDifference = difference;
      recommendedColor = candidate;
    }
  }
  return { failing: true, recommendedColor };
}

/** @param {string} track @returns {string} */
function musicLabel(track) {
  const index = MUSIC_TRACKS.indexOf(track);
  return index === -1 ? track.toUpperCase() : `TRACK ${index + 1}`;
}

/**
 * The controls-card copy for one player (`DESIGN-DECISIONS §3`, approved verbatim at the shipping defaults:
 * `controlsCardLabel(1, 'red')` === `'PLAYER 1 · RED — W A S D'`, `controlsCardLabel(2, 'blue')` ===
 * `'PLAYER 2 · BLUE — ARROW KEYS'`). `colorName` is always the *live* colour word — see the module doc
 * comment for why a literal would go stale on this particular screen. Delegates to the catalogue's
 * `matchSetup.controlsCard` (byte-identical logic) since KI-20-02, kept as its own exported function under
 * this name because `tests/unit/ui/matchSetup.test.js` and `tests/e2e/controls-card.spec.js` import it from
 * this path.
 *
 * **KI-12-04:** `isCpu` swaps the key list for the literal `'CPU'` (`DESIGN-DECISIONS` row 27's own wording,
 * quoted in this ticket's spec: `The controls card ... shows "CPU" instead of keys for a computer player.`).
 * Optional and defaulting to `false` so both of this function's pre-existing two-argument call sites
 * (`tests/unit/ui/matchSetup.test.js`, `tests/e2e/controls-card.spec.js`) keep their exact behaviour.
 *
 * @param {1 | 2} player
 * @param {string} colorName
 * @param {boolean} [isCpu]
 * @returns {string}
 */
export function controlsCardLabel(player, colorName, isCpu = false) {
  return matchSetup.controlsCard(player, colorName, isCpu);
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
  title.textContent = matchSetup.title;
  panel.appendChild(title);

  // KI-10-02: the controls card. Purely presentational — no `FocusableItem`, so it adds no row to `rows`/
  // `focus` below and cannot change focus order (the ticket's own constraint). Sits right under the title so
  // "which one am I?" is answered the instant this screen opens, before either colour row is even reached.
  const controlsCard = doc.createElement('div');
  controlsCard.className = 'controls-card';
  const controlsP1Row = doc.createElement('div');
  const controlsP2Row = doc.createElement('div');
  controlsCard.append(controlsP1Row, controlsP2Row);
  panel.appendChild(controlsCard);

  /** @type {MatchSetupProps} */
  let props = {
    matchSettings: {
      bestOf: 3,
      powerUpsEnabled: true,
      musicTrack: MUSIC_TRACKS[0],
      colors: { 1: 'red', 2: 'blue' },
      // KI-12-04 (`DESIGN-DECISIONS §1` row 27, AC1): HUMAN/HUMAN before `session.js` ever hands this screen
      // a real `matchSettings` — the same "harmless placeholder" role this object's other fields already
      // play (`session.js`'s own `defaultMatchSettings` is the one a real session actually starts from).
      playerKinds: { 1: 'HUMAN', 2: 'HUMAN' },
    },
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

  const matchLength = buildRow(matchSetup.matchLengthLabel);
  const powerUps = buildRow(matchSetup.powerUpsLabel);
  const music = buildRow(matchSetup.musicLabel);
  // KI-12-04: the row label itself (as opposed to its HUMAN/CPU EASY/CPU NORMAL/CPU HARD *value*, which row
  // 27 approves verbatim) is not approved copy — flagged as a question on #210 in this ticket's own PR.
  // `matchSetup.playerKindRowLabel` (`src/ui/strings.js`) is the one place that ruling needs to land.
  const p1Kind = buildRow(matchSetup.playerKindRowLabel(1));
  const p1Color = buildRow(matchSetup.playerColourRowLabel(1));
  const p2Kind = buildRow(matchSetup.playerKindRowLabel(2));
  const p2Color = buildRow(matchSetup.playerColourRowLabel(2));

  // KI-15-02: the colour-safety note. Presentational only, like the KI-10-02 controls card above — no
  // `FocusableItem`, so it adds no row to `rows`/`focus` below and can never take focus or block START MATCH
  // ("never blocks starting; informs", the ticket's own spec). Sits directly under the colour rows it is
  // about and above START MATCH. `hidden` (not a CSS class) drives visibility, matching every other screen's
  // own `container.hidden` pattern; `data-colour-note` and `data-recommended-color` are the stable hooks an
  // e2e/visual spec reads instead of the note's own (provisional, unruled) sentence — see
  // `checkColourSafety`'s doc comment above.
  const colourNote = doc.createElement('div');
  colourNote.className = 'colour-safety-note';
  colourNote.dataset.colourNote = 'true';
  colourNote.hidden = true;
  panel.appendChild(colourNote);

  const startRow = doc.createElement('div');
  startRow.className = 'menu-item menu-item--action';
  startRow.textContent = matchSetup.startMatch;
  panel.appendChild(startRow);

  container.appendChild(panel);
  root.appendChild(container);

  const rows = [
    matchLength.row,
    powerUps.row,
    music.row,
    p1Kind.row,
    p1Color.row,
    p2Kind.row,
    p2Color.row,
    startRow,
  ];

  // Built once, never rebuilt: each callback reads `props` live at call time, so a re-render (a fresh
  // `matchSettings` object from `session.js`) never has to rebuild the focus list or lose the cursor.
  const focus = createFocusModel({
    items: [
      { onChange: (dir) => props.onChange(changeMatchLength(props.matchSettings, dir)) },
      { onChange: () => props.onChange(togglePowerUps(props.matchSettings)) },
      { onChange: (dir) => props.onChange(changeMusicTrack(props.matchSettings, dir)) },
      { onChange: (dir) => props.onChange(changePlayerKind(props.matchSettings, 1, dir)) },
      {
        onChange: (dir) =>
          props.onChange(pickPlayerColor(props.matchSettings, 1, props.ownedColors, dir)),
      },
      { onChange: (dir) => props.onChange(changePlayerKind(props.matchSettings, 2, dir)) },
      {
        onChange: (dir) =>
          props.onChange(pickPlayerColor(props.matchSettings, 2, props.ownedColors, dir)),
      },
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

  /**
   * Refreshes one controls-card row: its text (AC2 — real DOM text, never colour-only) and the CSS class that
   * drives its colour match (AC1). Hex values live only in `styles.css` (`CLAUDE.md` never list) — this only
   * ever sets a class name built from the colour's own catalogue key (`red`, `blue`, …), never a hex literal.
   *
   * @param {HTMLElement} el
   * @param {1 | 2} player
   * @param {string} colorName
   * @param {boolean} isCpu
   */
  function renderControlsRow(el, player, colorName, isCpu) {
    el.textContent = controlsCardLabel(player, colorName, isCpu);
    el.className = `controls-card-row controls-card-row--${colorName}`;
  }

  /**
   * KI-15-02 AC1: shows or hides {@link colourNote} from {@link checkColourSafety}'s verdict on the *current*
   * `matchSettings`/`ownedColors`. `hidden` is the only thing that ever changes for a passing pair — nothing
   * else on the screen reacts, and START MATCH stays enabled either way (never blocks starting; informs).
   */
  function renderColourNote() {
    const { matchSettings, ownedColors } = props;
    const { failing, recommendedColor } = checkColourSafety(matchSettings, ownedColors);
    colourNote.hidden = !failing;
    if (!failing) {
      colourNote.textContent = '';
      delete colourNote.dataset.recommendedColor;
      return;
    }
    if (recommendedColor === null) {
      // No owned colour clears the check either — say the note, invent no alternative (ticket spec).
      colourNote.textContent = COLOUR_NOTE_COPY.note;
      delete colourNote.dataset.recommendedColor;
    } else {
      colourNote.textContent = `${COLOUR_NOTE_COPY.note} ${COLOUR_NOTE_COPY.suggestion(recommendedColor)}`;
      colourNote.dataset.recommendedColor = recommendedColor;
    }
  }

  function renderValues() {
    const { matchSettings } = props;
    const p1IsCpu = matchSettings.playerKinds[1] !== 'HUMAN';
    const p2IsCpu = matchSettings.playerKinds[2] !== 'HUMAN';
    matchLength.value.textContent = matchSetup.matchLengthValue(matchSettings.bestOf);
    powerUps.value.textContent = matchSetup.powerUpsValue(matchSettings.powerUpsEnabled);
    music.value.textContent = musicLabel(matchSettings.musicTrack);
    p1Kind.value.textContent = matchSetup.playerKindValue(matchSettings.playerKinds[1]);
    p2Kind.value.textContent = matchSetup.playerKindValue(matchSettings.playerKinds[2]);
    p1Color.value.textContent = matchSetup.playerColourValue(matchSettings.colors[1]);
    p2Color.value.textContent = matchSetup.playerColourValue(matchSettings.colors[2]);
    renderControlsRow(controlsP1Row, 1, matchSettings.colors[1], p1IsCpu);
    renderControlsRow(controlsP2Row, 2, matchSettings.colors[2], p2IsCpu);
    renderColourNote();
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
