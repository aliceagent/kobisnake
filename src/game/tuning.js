// @ts-check
import { SETTINGS } from '../core/settings.js';

/**
 * The tuning build's own data (KS-07-01, `docs/sprints/sprint-07-playtest-gate-1-and-tuning.md`): what a
 * human can change from the `?tuning=1` overlay, what it defaults to, and how a flat "one value per control"
 * state turns into the nested override tree `src/core/settings.js`'s `withOverrides()` expects.
 *
 * Kept out of `src/ui/screens/tuning.js` on purpose — `src/game/` may hold logic but never DOM
 * (`ARCHITECTURE §3`, CLAUDE.md), and this file has to be plain data plus pure functions so it can be
 * unit-tested (and read by a human deciding what session 2's variants should be) without a browser.
 *
 * **`src/core/settings.js` is never edited for this ticket** (tech-lead note 1: "must not change. At all.").
 * Every tunable below is one already listed in `DESIGN-DECISIONS §4`'s `SETTINGS` object, read through
 * `withOverrides()`, which already exists for exactly this. The one exception is the SLOW target mode
 * (tech-lead note 3): it is not, and must not become, a `SETTINGS` field — `SlowTargetMode` and
 * {@link DEFAULT_SLOW_TARGET_MODE} live only here and in `src/core/round.js`'s own local type, carried
 * through `withOverrides` as an extra `slow.targetMode` key that `Settings`' own `SlowSettings` typedef
 * (in `settings.js`, untouched) does not declare.
 *
 * KI-04-03 adds a second key outside {@link TUNABLES} for the same reason and by the same route:
 * `roundDuration`. Unlike the SLOW target mode it *is* an ordinary `SETTINGS` field — it simply has no
 * slider, because the design lead asked for {@link PACING_PRESETS} chips rather than another control. It is
 * still `src/core/settings.js` untouched: a preset is a `withOverrides()` tree, exactly like every other
 * value this file produces.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/settings.js').SettingsOverride} SettingsOverride */

/**
 * The three ways `round.js` can point a collected SLOW at (`DESIGN-DECISIONS §1 row 3`, GDD's open question):
 * `everyone-but-collector` is what ships; `opponent` and `collector` are the GDD's other two, wired only so
 * a human can feel them (tech-lead note 3). With the two-player roster V1 ships, `opponent` and
 * `everyone-but-collector` single out the same one snake — the distinction exists for GDD-completeness and
 * for a roster larger than two, which V1 never has.
 *
 * @typedef {'opponent' | 'collector' | 'everyone-but-collector'} SlowTargetMode
 */

/** @type {readonly SlowTargetMode[]} */
export const SLOW_TARGET_MODES = Object.freeze(['everyone-but-collector', 'opponent', 'collector']);

/** The mode `round.js` falls back to when a settings object carries no `slow.targetMode` at all — today's
 * shipped behaviour (`DESIGN-DECISIONS §1 row 3`), so a round built with no tuning overrides is unchanged. */
export const DEFAULT_SLOW_TARGET_MODE = /** @type {SlowTargetMode} */ ('everyone-but-collector');

/**
 * A `SettingsOverride` plus the one field that is not a `Settings` field at all (see the module doc comment).
 * Structurally an override tree still — `withOverrides` merges `slow.targetMode` in exactly like any other
 * nested key — but named separately so `settings.js` itself never has to know this key exists.
 *
 * @typedef {SettingsOverride & {slow?: SettingsOverride['slow'] & {targetMode?: SlowTargetMode}}} TuningSettingsOverride
 */

/**
 * One control the overlay draws: a slider/stepper reading and writing one leaf of {@link Settings} (a
 * dotted `path`, e.g. `'speedBoost.multiplier'`), the ticket's own list verbatim.
 *
 * @typedef {object} TunableSpec
 * @property {string} key - flat state key, and the dotted path into `Settings`/`SettingsOverride`
 * @property {string} label - overlay control label
 * @property {number} min
 * @property {number} max
 * @property {number} step
 * @property {string} unit - short suffix shown next to the value, `''` for none
 */

/**
 * The ticket's tunable list, verbatim: "snakeSpeed, laserStartTime, laserStepInterval, laserMinArena,
 * powerUpInterval, speedBoost.multiplier/duration, slow.multiplier/duration, inputBufferSize, foodCount,
 * growthPerFood". Ranges are this overlay's own — generous enough to break the game on purpose, since that is
 * what a tuning build is for — not a design decision (`DESIGN-DECISIONS.md` still owns the shipping numbers).
 *
 * @type {readonly TunableSpec[]}
 */
export const TUNABLES = Object.freeze([
  { key: 'snakeSpeed', label: 'Snake speed', min: 2, max: 12, step: 0.5, unit: ' cells/s' },
  { key: 'laserStartTime', label: 'Laser start time', min: 10, max: 60, step: 1, unit: 's left' },
  {
    key: 'laserStepInterval',
    label: 'Laser step interval',
    min: 0.5,
    max: 5,
    step: 0.25,
    unit: 's',
  },
  { key: 'laserMinArena', label: 'Laser min arena', min: 4, max: 20, step: 1, unit: ' cells' },
  { key: 'powerUpInterval', label: 'Power-up interval', min: 5, max: 30, step: 1, unit: 's' },
  {
    key: 'speedBoost.multiplier',
    label: 'Speed Boost multiplier',
    min: 1,
    max: 3,
    step: 0.05,
    unit: '×',
  },
  {
    key: 'speedBoost.duration',
    label: 'Speed Boost duration',
    min: 1,
    max: 10,
    step: 0.5,
    unit: 's',
  },
  { key: 'slow.multiplier', label: 'Slow multiplier', min: 0.1, max: 1, step: 0.05, unit: '×' },
  { key: 'slow.duration', label: 'Slow duration', min: 1, max: 10, step: 0.5, unit: 's' },
  { key: 'inputBufferSize', label: 'Input buffer size', min: 1, max: 5, step: 1, unit: '' },
  { key: 'foodCount', label: 'Food count', min: 1, max: 10, step: 1, unit: '' },
  { key: 'growthPerFood', label: 'Growth per food', min: 0, max: 5, step: 1, unit: '' },
]);

/**
 * Session 2's laser-start-time variants (tech-lead note 2 / sprint file: "laser start 25 / 30 / 35 s"), quick
 * buttons so a human on a keyboard with a stopwatch reaches them without hunting the slider.
 * @type {readonly number[]}
 */
export const LASER_START_TIME_PRESETS = Object.freeze([25, 30, 35]);

/**
 * Session 2's laser-step-interval variants ("laser step interval 2 / 2.5 / 3 s").
 * @type {readonly number[]}
 */
export const LASER_STEP_INTERVAL_PRESETS = Object.freeze([2, 2.5, 3]);

/**
 * The sprint's sharpest open question (tech-lead note 2): Speed Boost 1.5×/5 s (shipping) versus 1.35×/4 s,
 * one button each so the pair is "quick and unambiguous to reach" rather than four slider drags a human could
 * get wrong under a stopwatch.
 *
 * @typedef {object} SpeedBoostPreset
 * @property {string} id
 * @property {string} label
 * @property {number} multiplier
 * @property {number} duration
 */

/** @type {readonly SpeedBoostPreset[]} */
export const SPEED_BOOST_PRESETS = Object.freeze([
  Object.freeze({ id: 'a', label: '1.5× / 5s (shipping)', multiplier: 1.5, duration: 5 }),
  Object.freeze({ id: 'b', label: '1.35× / 4s', multiplier: 1.35, duration: 4 }),
]);

/**
 * KI-04-03 — the two pacing candidates I04 measured, plus the shipping pair, as one-click chips.
 *
 * `docs/qa/playtests/round-pacing.md` swept `roundDuration` and `laserStartTime` over 33 cells and found
 * both able to move how often a round reaches the laser warning, by different mechanisms: a shorter round
 * raises the fraction by removing round, an earlier warning raises it by converting play into climax. The
 * design lead's ruling (#229, `DESIGN-DECISIONS §1` row 30) is that **the matrix answers "which lever" and
 * cannot answer "which value"** — humans die less cheaply than bots, so a permanent number chosen against
 * bots would be chosen against the wrong population. So neither lands in `settings.js`. Both land here, and
 * Gate 1 session 2 plays all three in one sitting (`PLAYTEST-SCRIPT §5`).
 *
 * Each preset moves **one** lever off shipping and leaves the other at it, which is what makes the three
 * chips a controlled comparison rather than three unrelated configurations. The shipping chip reads its
 * numbers from {@link SETTINGS} rather than repeating them, so if `settings.js` ever does change, the chip
 * follows it instead of quietly lying; `tests/unit/game/tuning.test.js` asserts its label still describes
 * the values it carries.
 *
 * @typedef {object} PacingPreset
 * @property {string} id
 * @property {string} label - exactly the text the chip shows, and the name `PLAYTEST-SCRIPT §5` uses.
 * @property {number} roundDuration
 * @property {number} laserStartTime
 */

/** @type {readonly PacingPreset[]} */
export const PACING_PRESETS = Object.freeze([
  Object.freeze({
    id: 'round-75',
    label: 'round 75 s',
    roundDuration: 75,
    laserStartTime: SETTINGS.laserStartTime,
  }),
  Object.freeze({
    id: 'laser-40',
    label: 'laser at 0:40',
    roundDuration: SETTINGS.roundDuration,
    laserStartTime: 40,
  }),
  Object.freeze({
    id: 'shipping',
    label: '90 s / 0:30 (shipping)',
    roundDuration: SETTINGS.roundDuration,
    laserStartTime: SETTINGS.laserStartTime,
  }),
]);

/**
 * Reads a dotted `path` (`TunableSpec.key`) off a nested object, e.g. `'speedBoost.multiplier'` off
 * `{speedBoost: {multiplier: 1.5}}`.
 *
 * @param {Record<string, unknown>} source
 * @param {string} path
 * @returns {number}
 */
function readPath(source, path) {
  return /** @type {number} */ (
    path
      .split('.')
      .reduce(/** @param {any} node @param {string} key */ (node, key) => node?.[key], source)
  );
}

/**
 * The flat overlay state read off `settings` (defaults to the shipping `SETTINGS`): one entry per
 * {@link TUNABLES} key, plus `slowTargetMode`. This is what the overlay's sliders start at.
 *
 * @param {Settings} [settings]
 * @returns {Record<string, number> & {slowTargetMode: SlowTargetMode}}
 */
export function defaultTuningValues(settings = SETTINGS) {
  /** @type {Record<string, number>} */
  const values = {};
  for (const tunable of TUNABLES) {
    values[tunable.key] = readPath(/** @type {any} */ (settings), tunable.key);
  }
  // `roundDuration` is a real `SETTINGS` field but deliberately **not** a {@link TUNABLES} entry: KI-04-03
  // needs it settable by {@link PACING_PRESETS} and the design lead asked for chips, not another slider. It
  // rides in the flat state and is stamped into the tree by {@link buildSettingsOverride}, exactly the way
  // `slowTargetMode` already does — one established pattern rather than a second new one. Set on `values`
  // rather than in the literal below so the returned object keeps its `Record<string, number>` shape; an
  // explicit numeric property there narrows the inferred type and the cast stops type-checking.
  values.roundDuration = settings.roundDuration;
  return /** @type {Record<string, number> & {slowTargetMode: SlowTargetMode}} */ ({
    ...values,
    slowTargetMode: DEFAULT_SLOW_TARGET_MODE,
  });
}

/**
 * Turns the overlay's flat state (one number per {@link TUNABLES} key, plus `slowTargetMode`) into the
 * nested override tree `withOverrides()` takes. Always the *whole* tree — every tunable, every time a value
 * changes — rather than only the ones a human actually touched: the overlay is the single source of truth for
 * "what is different from shipping" while it is open, so there is exactly one place a value can drift from
 * what the sliders show, and a `slow.targetMode` equal to {@link DEFAULT_SLOW_TARGET_MODE} still overrides
 * explicitly rather than relying on `round.js`'s own fallback (AC2: a replay must carry the whole story).
 *
 * @param {Record<string, number> & {slowTargetMode: SlowTargetMode}} values
 * @returns {TuningSettingsOverride}
 */
export function buildSettingsOverride(values) {
  /** @type {any} */
  const overrides = {};
  for (const tunable of TUNABLES) {
    const [head, ...rest] = tunable.key.split('.');
    if (rest.length === 0) {
      overrides[head] = values[tunable.key];
    } else {
      overrides[head] = overrides[head] ?? {};
      overrides[head][rest[0]] = values[tunable.key];
    }
  }
  overrides.slow = { ...(overrides.slow ?? {}), targetMode: values.slowTargetMode };
  // Stamped like `slow.targetMode` and for the same reason (see {@link defaultTuningValues}). Falls back to
  // the shipping value rather than emitting `undefined`, so a hand-built `values` missing the key produces a
  // tree that changes nothing instead of one `withOverrides()` would merge a hole into.
  overrides.roundDuration = values.roundDuration ?? SETTINGS.roundDuration;
  return /** @type {TuningSettingsOverride} */ (overrides);
}
