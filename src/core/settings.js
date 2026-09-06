// @ts-check

/**
 * The single source of truth for every tunable number and rule in the game (ARCHITECTURE §4). Every value
 * below is quoted verbatim from `docs/design/DESIGN-DECISIONS.md §4` ("The SETTINGS object (shipping
 * defaults)"). Nobody may invent, rename, round or omit a value here — a proposed change goes in a PR with
 * the `tuning-proposal` label for Fable to decide (CLAUDE.md "The never list").
 *
 * `SETTINGS` is deep-frozen below so an accidental mutation throws instead of silently drifting from the
 * design doc. Code that needs a variant (a 6x6 test grid, power-ups off, …) calls {@link withOverrides}
 * rather than editing this object.
 */

/**
 * @typedef {object} GridSettings
 * @property {number} width - arena width in cells (DESIGN-DECISIONS §2.1: 24x24, cell = 1 world unit)
 * @property {number} height - arena height in cells
 */

/**
 * @typedef {object} SpeedBoostSettings
 * @property {number} multiplier - movement speed multiplier while boosted (DESIGN-DECISIONS §1 row 4)
 * @property {number} duration - seconds the boost lasts
 */

/**
 * @typedef {object} SlowSettings
 * @property {number} multiplier - movement speed multiplier applied to everyone but the collector
 * @property {number} duration - seconds the slow lasts
 * @property {number} laserMultiplierWhenSolo - laser-step-interval multiplier used instead, in
 *   practice/single-player where there is no opponent to slow (DESIGN-DECISIONS §1 row 3/21)
 */

/**
 * @typedef {object} CrashSlowMoSettings
 * @property {number} scale - simulated-time playback rate during the crash slow-mo beat
 * @property {number} duration - real seconds the slow-mo beat lasts
 */

/**
 * Match-win key rewards, keyed by "best of" format. Object keys are numbers written as `1 | 3 | 5`, but a
 * JS object key is always a string at runtime (`Object.keys(rewards)` gives `["1", "3", "5"]`) — the index
 * signature below reflects the lookup shape (`rewards[bestOf]`), not the storage representation.
 *
 * @typedef {{[bestOf: number]: number}} RewardsSettings
 */

/**
 * Colour catalogue: lowercase colour name -> plastic base hex string, quoted from DESIGN-DECISIONS §2.7.
 * This is the one exception to "never write a hex colour outside `src/render/materials.js` / `src/ui/styles.css`"
 * (CLAUDE.md "The never list") — §4 explicitly puts the colour *catalogue* in `SETTINGS` as a design tunable,
 * distinct from `materials.js`, which turns a catalogue entry into a three.js material. This object is not
 * duplicated anywhere else; `materials.js` should eventually read from it (Sprint 03 finding).
 *
 * @typedef {object} ColorCatalogue
 * @property {string} red
 * @property {string} blue
 * @property {string} green
 * @property {string} yellow
 * @property {string} orange
 * @property {string} purple
 * @property {string} teal
 * @property {string} gold
 */

/**
 * Key prices for the six unlockable colours (DESIGN-DECISIONS §1 row 13). Red and Blue are owned from the
 * start and so have no price. Keys match {@link ColorCatalogue} minus `red` and `blue`.
 *
 * @typedef {object} ShopPrices
 * @property {number} green
 * @property {number} yellow
 * @property {number} orange
 * @property {number} purple
 * @property {number} teal
 * @property {number} gold
 */

/**
 * @typedef {object} CameraSettings
 * @property {number} fov - vertical field of view, degrees (DESIGN-DECISIONS §1 row 24)
 * @property {number} pitchDegrees - camera pitch below horizontal, degrees
 * @property {number} margin - extra world units of margin framed around the arena, in cells
 */

/**
 * @typedef {object} Settings
 * @property {GridSettings} grid
 * @property {number} simHz - fixed simulation rate (DESIGN-DECISIONS §2.1)
 * @property {number} roundDuration - seconds of simulated round time
 * @property {number} countdownStepSeconds - seconds per countdown step (3 . 2 . 1 . GO)
 * @property {number} snakeSpeed - base cells per second
 * @property {number} startingSnakeLength - segments at round start, head included
 * @property {number} growthPerFood - segments added per apple eaten
 * @property {number} inputBufferSize - max queued directions per snake
 * @property {number} foodCount - apples present at all times during PLAYING
 * @property {number} foodMinDistanceFromHead - min Chebyshev distance from any head, in cells
 * @property {boolean} powerUpsEnabled - default power-ups toggle
 * @property {number} powerUpFirstSpawnAt - seconds remaining when the first power-up spawns
 * @property {number} powerUpInterval - seconds between power-up spawn/respawn cycles
 * @property {number} powerUpMinDistanceFromHead - min Chebyshev distance from any head, in cells
 * @property {SpeedBoostSettings} speedBoost
 * @property {SlowSettings} slow
 * @property {number} laserStartTime - seconds remaining when LASER_WARNING begins
 * @property {number} laserWarningDuration - seconds of warning before the first laser step
 * @property {number} laserStepInterval - seconds between laser steps
 * @property {number} laserMinArena - smallest square, in cells, the lasers shrink to
 * @property {CrashSlowMoSettings} crashSlowMo
 * @property {number} scoreboardSeconds - seconds the between-round scoreboard is shown
 * @property {number[]} bestOfOptions - selectable match lengths
 * @property {RewardsSettings} rewards - key rewards to the match winner, by best-of format
 * @property {ColorCatalogue} colors
 * @property {ShopPrices} shopPrices
 * @property {CameraSettings} camera
 * @property {boolean} [godMode] - **test-only, and absent from the shipping defaults on purpose.** Snakes
 *   that would die refuse the fatal step and stay put instead, so a round runs its full clock — which is
 *   what lets a golden log cover the whole laser timeline, since a real no-input round is over in 3.167 s
 *   (`docs/sprints/sprint-04-closing-laser-arena.md` KS-04-01 QA). It exists only in the type, never in
 *   {@link SETTINGS}: a test opts in with `withOverrides({ godMode: true })`, and `round.js` additionally
 *   ignores it unless `import.meta.env.TEST` is set, so a hand-crafted settings object cannot switch it on
 *   in a shipped game. It is not a tunable and `DESIGN-DECISIONS §4` neither has it nor should.
 */

/**
 * Shipping defaults, quoted verbatim from `docs/design/DESIGN-DECISIONS.md §4`. See the module doc comment
 * above for why this file, and only this file, may hold these numbers and this one colour catalogue.
 *
 * @type {Settings}
 */
const SETTINGS_SOURCE = {
  grid: { width: 24, height: 24 },
  simHz: 120,
  roundDuration: 90,
  countdownStepSeconds: 0.8,

  snakeSpeed: 6, // cells per second
  startingSnakeLength: 4,
  growthPerFood: 1,
  inputBufferSize: 2,

  foodCount: 4,
  foodMinDistanceFromHead: 2,

  powerUpsEnabled: true,
  powerUpFirstSpawnAt: 75, // seconds remaining
  powerUpInterval: 15,
  powerUpMinDistanceFromHead: 3,
  speedBoost: { multiplier: 1.5, duration: 5 },
  slow: { multiplier: 0.6, duration: 4, laserMultiplierWhenSolo: 2 },

  laserStartTime: 30, // seconds remaining
  laserWarningDuration: 5,
  laserStepInterval: 2.5,
  laserMinArena: 6,

  crashSlowMo: { scale: 0.25, duration: 0.6 },
  scoreboardSeconds: 2.5,

  bestOfOptions: [1, 3, 5],
  rewards: { 1: 0, 3: 1, 5: 2 },

  // Colour catalogue, DESIGN-DECISIONS §2.7 ("plastic base colour" hex values). See the ColorCatalogue
  // typedef above for why this lives here instead of src/render/materials.js.
  colors: {
    red: '#E3261B',
    blue: '#1F6FE5',
    green: '#2FB44B',
    yellow: '#F6C21B',
    orange: '#F27A1A',
    purple: '#8A3FD1',
    teal: '#12B5B0',
    gold: '#E8B028',
  },
  shopPrices: { green: 2, yellow: 2, orange: 3, purple: 3, teal: 3, gold: 6 },

  camera: { fov: 32, pitchDegrees: 78, margin: 1.5 },
};

/**
 * Recursion worker for {@link deepFreeze}, untyped so the recursive call on an arbitrary nested value (whose
 * static type is unknown to the caller) does not need an unsound cast back to the top-level generic `T`.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function deepFreezeAny(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  for (const key of Object.keys(record)) {
    deepFreezeAny(record[key]);
  }
  return Object.freeze(value);
}

/**
 * Recursively freezes an object (including array values), so mutating any nested field throws — ES modules
 * are always strict, so a plain assignment is the check (AC4). `Object.freeze` alone is shallow; a naive
 * caller could still do `SETTINGS.grid.width = 6`, silently detuning the game.
 *
 * @template {object} T
 * @param {T} value
 * @returns {Readonly<T>}
 */
export function deepFreeze(value) {
  deepFreezeAny(value);
  return value;
}

/** Deep-frozen shipping defaults. Never mutate; use {@link withOverrides} to build a variant. */
export const SETTINGS = deepFreeze(SETTINGS_SOURCE);

/**
 * True for plain objects (not arrays, not null) — the only shape {@link mergeSettings} recurses into.
 * Arrays (e.g. `bestOfOptions`) are replaced wholesale by an override rather than merged element-by-element,
 * since "override the list of best-of options" always means "use this list", never "splice this in".
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Deep-merges `override` onto `base` one level of nesting at a time, returning a new plain object tree.
 * Neither input is read after the call finishes, and neither is mutated.
 *
 * @param {Record<string, unknown>} base
 * @param {Record<string, unknown>} override
 * @returns {Record<string, unknown>}
 */
function mergeSettings(base, override) {
  /** @type {Record<string, unknown>} */
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const overrideValue = override[key];
    const baseValue = base[key];
    result[key] =
      isPlainObject(overrideValue) && isPlainObject(baseValue)
        ? mergeSettings(baseValue, overrideValue)
        : overrideValue;
  }
  return result;
}

/**
 * A settings override tree: every top-level key is optional, and any key whose {@link Settings} value is a
 * settings object (`grid`, `speedBoost`, `slow`, `crashSlowMo`, `rewards`, `colors`, `shopPrices`, `camera`)
 * may be partially overridden without dropping its sibling fields — none of those objects nest a further
 * object inside them, so a one-level-deep `Partial` on each exactly covers every override shape a test needs
 * (e.g. `{ grid: { width: 6, height: 6 } }`). Array-valued keys (`bestOfOptions`) and plain scalars are
 * replaced wholesale, matching {@link mergeSettings}.
 *
 * @typedef {{[K in keyof Settings]?: Settings[K] extends unknown[] ? Settings[K] : Settings[K] extends object ? Partial<Settings[K]> : Settings[K]}} SettingsOverride
 */

/**
 * Builds a new, independently frozen settings object by deep-merging `partial` over {@link SETTINGS}.
 * `SETTINGS` itself is never mutated, and the object returned here is frozen the same way `SETTINGS` is, so
 * tests can hand it to code that expects the real thing. Every later ticket uses this to build test
 * scenarios, e.g. `withOverrides({ grid: { width: 6, height: 6 } })` for a 6x6 grid.
 *
 * @param {SettingsOverride} partial
 * @returns {Settings}
 */
export function withOverrides(partial) {
  const merged = mergeSettings(
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (SETTINGS_SOURCE)),
    /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (partial)),
  );
  return /** @type {Settings} */ (deepFreeze(merged));
}
