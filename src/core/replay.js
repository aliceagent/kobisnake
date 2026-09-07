// @ts-check
import { DIRECTIONS } from './grid.js';

/**
 * The versioned replay format (`docs/sprints/improvement-05-replay-capture-and-playback.md` KI-05-01,
 * `ARCHITECTURE §4`).
 *
 * This is not a new shape. `tests/sim/replays/*.json` (KS-07-01), `session.getReplay()`
 * (`src/game/session.js`) and Improvement 11's exported playtest session (`src/qa/playtestSession.js`'s
 * `Replay` typedef) are already, independently, exactly `{ seed, settingsOverrides, inputs, expectedEvents }`.
 * This file gives that one shape a name, an optional version tag, and a parser that turns "malformed JSON" or
 * "a future format" into a named, diagnostic result instead of an exception a caller must remember to catch.
 *
 * ## Why `version` cannot be required
 *
 * No committed fixture carries it, `getReplay()` does not write it, and `playtestSession.js` deliberately
 * rebuilds the replay object field by field so no extra key can leak into `rounds[i].replay` — adding a
 * required `version` would break all three producers at once for a field nothing downstream reads yet. So the
 * rule is: **an absent `version` means version 1.** An explicit `version: 1` parses identically. Anything else
 * — `2`, `0`, a string, a float — is rejected as an unsupported version rather than guessed at, because a
 * parser that silently reinterprets a future format is the bug this file exists to prevent.
 *
 * ## Why `seed: null` is accepted, not rejected
 *
 * `session.getReplay()` returns `seed: null` when it is called before a round exists (KS-07-01 AC2's own
 * doc comment) — the tuning overlay's "Copy replay" button can be open on the main menu, and Improvement 11's
 * exporter snapshots whatever `getReplay()` handed it at the moment a round ended. A replay with `seed: null`
 * is not malformed, it is a real (if unplayable) recording of "nothing has run yet" — and I05's later tickets
 * (playback) are the layer that decides whether *playing* a null-seed replay is refused, not the parser. This
 * parser's job is only to say whether the file is well-formed, so `null` is accepted alongside every finite
 * number.
 *
 * ## Deliberately not validated
 *
 * An `expectedEvents` entry is checked only for being a plain object — nothing about its *interior*
 * (`type`/`tick`/`t`/payload fields), matching `replay.schema.json`, which likewise leaves an event's shape
 * unconstrained: an event's own shape is `src/core/events.js`'s contract, not this file's, and this parser
 * has no simulation to check it against anyway (that is KI-05-02's job). Because the interior is never
 * inspected, an `expectedEvents` entry cannot be rebuilt field by field the way an `inputs` entry is — it is
 * copied wholesale instead, so any field a future event type carries survives the round trip unexamined.
 *
 * ## Error messages are developer diagnostics, not player-facing copy
 *
 * Every `ReplayError.message` here states a fact about the file and stops — no "try this", no imperative
 * mood, no reassurance. KI-05-03 is the screen that will show `error.message` to a player, and the copy for
 * that screen is a design decision awaiting the design lead's ruling on issue #211; a parser message that
 * reads like finished player-facing text would ship an unapproved answer to a question already out for that
 * ruling (the failure mode issues #150 and #182 exist to prevent). Do not "improve" these into friendlier
 * copy without that ruling — replace them once #211 resolves, in KI-05-03, not here.
 */

/** @typedef {import('./grid.js').Direction} Direction */

/**
 * @typedef {object} ReplayInput
 * @property {number} t - simulated seconds since round start (resolved to a tick before being applied)
 * @property {'p1' | 'p2'} player
 * @property {'UP' | 'DOWN' | 'LEFT' | 'RIGHT'} dir
 */

/**
 * The one replay shape every producer and consumer in the codebase shares (see module doc). `version` is
 * always present on a parsed result — {@link parseReplay} fills in `1` when the source omitted it — even
 * though it is optional on input.
 *
 * @typedef {object} Replay
 * @property {1} version
 * @property {number | null} seed
 * @property {object} settingsOverrides
 * @property {ReplayInput[]} inputs
 * @property {object[]} expectedEvents
 */

/**
 * @typedef {object} ReplayError
 * @property {string} code - stable identifier a caller (or a test) can switch on
 * @property {string} message - human-readable, names what is wrong with *this* file
 */

/**
 * @typedef {{ok: true, replay: Replay} | {ok: false, error: ReplayError}} ParseReplayResult
 */

/** The only replay format version this parser understands. Absent `version` is treated as this. */
export const CURRENT_REPLAY_VERSION = 1;

/**
 * Every {@link ReplayError.code} this module can produce, so a caller can reference one without typing the
 * string (and a typo in a switch/case fails at lint time instead of silently never matching).
 */
export const REPLAY_ERROR_CODES = Object.freeze({
  INVALID_JSON: 'INVALID_JSON',
  NOT_AN_OBJECT: 'NOT_AN_OBJECT',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  INVALID_SEED: 'INVALID_SEED',
  INVALID_SETTINGS_OVERRIDES: 'INVALID_SETTINGS_OVERRIDES',
  INVALID_INPUTS: 'INVALID_INPUTS',
  INVALID_INPUT_ENTRY: 'INVALID_INPUT_ENTRY',
  INVALID_EXPECTED_EVENTS: 'INVALID_EXPECTED_EVENTS',
});

/** The only legal values for a `ReplayInput`'s `player` field, matching `RoundSimulation`'s player ids. */
const VALID_PLAYERS = Object.freeze(['p1', 'p2']);

/** The only legal values for a `ReplayInput`'s `dir` field — every name `src/core/grid.js` defines. */
const VALID_DIRECTIONS = Object.freeze(Object.keys(DIRECTIONS));

/**
 * True for plain objects: not `null`, not an array. Matches `src/core/settings.js`'s own (unexported)
 * `isPlainObject` — duplicated rather than imported, since `settings.js` does not export it and this file
 * must not depend on it (`CLAUDE.md`: never edit `settings.js`).
 *
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Builds a `{ ok: false, error }` result. A tiny helper so every failure path below reads as one line.
 *
 * @param {string} code
 * @param {string} message
 * @returns {{ok: false, error: ReplayError}}
 */
function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/**
 * Describes `value`'s shape for an error message, without dumping an entire (possibly huge) input log into
 * it — just enough for a human to see what they pasted.
 *
 * @param {unknown} value
 * @returns {string}
 */
function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * Validates one entry of `inputs`. Returns an error message describing what is wrong, or `null` if the entry
 * is a well-formed {@link ReplayInput}.
 *
 * @param {unknown} entry
 * @param {number} index
 * @returns {string | null}
 */
function describeInvalidInput(entry, index) {
  if (!isPlainObject(entry)) {
    return `inputs[${index}] must be an object, got ${describe(entry)}.`;
  }
  if (typeof entry.t !== 'number') {
    return `inputs[${index}].t must be a number, got ${describe(entry.t)}.`;
  }
  if (typeof entry.player !== 'string' || !VALID_PLAYERS.includes(entry.player)) {
    return `inputs[${index}].player must be one of ${VALID_PLAYERS.join('|')}, got ${JSON.stringify(entry.player)}.`;
  }
  if (typeof entry.dir !== 'string' || !VALID_DIRECTIONS.includes(entry.dir)) {
    return `inputs[${index}].dir must be one of ${VALID_DIRECTIONS.join('|')}, got ${JSON.stringify(entry.dir)}.`;
  }
  return null;
}

/**
 * Validates an already-`JSON.parse`d value against the replay format and, on success, rebuilds a clean
 * {@link Replay}. The top level and every `inputs` entry are rebuilt field by field — the same discipline
 * `src/qa/playtestSession.js` uses — so a stray extra key on either can never leak into the result;
 * `expectedEvents` entries are copied wholesale instead, since their interior is never inspected (module doc
 * "Deliberately not validated") and so has no fixed set of fields to rebuild from.
 *
 * @param {unknown} value
 * @returns {ParseReplayResult}
 */
function validateParsedReplay(value) {
  if (!isPlainObject(value)) {
    return fail(
      REPLAY_ERROR_CODES.NOT_AN_OBJECT,
      `A replay must be a JSON object with seed, inputs and expectedEvents fields; got ${describe(value)}.`,
    );
  }

  // Absent version means version 1 (module doc). A present version must be exactly the integer this parser
  // understands - anything else (a future version, or a value that was never a version at all) is rejected
  // before any other field is checked, since a different version may not mean the same thing by "seed" or
  // "inputs".
  const version = 'version' in value ? value.version : CURRENT_REPLAY_VERSION;
  if (version !== CURRENT_REPLAY_VERSION) {
    const found =
      typeof version === 'number' && Number.isInteger(version)
        ? String(version)
        : describe(version);
    return fail(
      REPLAY_ERROR_CODES.UNSUPPORTED_VERSION,
      `This replay is version ${found}; this build understands version ${CURRENT_REPLAY_VERSION}.`,
    );
  }

  // seed: null is a legitimate "no round yet" recording (module doc), so null passes alongside an integer.
  // NaN, Infinity and non-integers must not: `typeof` alone lets all three through (they are all `number`),
  // and RoundSimulation/mulberry32 do not throw on any of them - a NaN or fractional seed silently produces a
  // different round instead of failing loudly, which is worse than rejecting it here.
  if (value.seed !== null && !Number.isInteger(value.seed)) {
    // A number that fails Number.isInteger (NaN, Infinity, 1.5, ...) is more useful reported as its own
    // value than as just "number" - that is what distinguishes this from every other INVALID_* message,
    // which only needs the type.
    const seedDescription =
      typeof value.seed === 'number' ? String(value.seed) : describe(value.seed);
    return fail(
      REPLAY_ERROR_CODES.INVALID_SEED,
      `seed must be an integer (or null for a replay recorded before any round started), got ${seedDescription}.`,
    );
  }

  // settingsOverrides is optional (replay.schema.json); absent or {} both mean "shipping defaults".
  if ('settingsOverrides' in value && !isPlainObject(value.settingsOverrides)) {
    return fail(
      REPLAY_ERROR_CODES.INVALID_SETTINGS_OVERRIDES,
      `settingsOverrides must be a plain object when present, got ${describe(value.settingsOverrides)}.`,
    );
  }

  if (!Array.isArray(value.inputs)) {
    return fail(
      REPLAY_ERROR_CODES.INVALID_INPUTS,
      `inputs must be an array, got ${describe(value.inputs)}.`,
    );
  }
  for (let i = 0; i < value.inputs.length; i += 1) {
    const problem = describeInvalidInput(value.inputs[i], i);
    if (problem !== null) {
      return fail(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY, problem);
    }
  }

  if (!Array.isArray(value.expectedEvents)) {
    return fail(
      REPLAY_ERROR_CODES.INVALID_EXPECTED_EVENTS,
      `expectedEvents must be an array, got ${describe(value.expectedEvents)}.`,
    );
  }
  // Only "is this a plain object" is checked (module doc "Deliberately not validated") - but that much has
  // to be checked, or a non-object entry (42, null, "x") silently spreads into `{}` / `{}` / `{"0":"x"}`
  // below: a fabricated, plausible-looking event standing in for a malformed file, which then fails
  // KI-05-02 AC1's log comparison with a diff pointing at the simulation instead of at the replay.
  for (let i = 0; i < value.expectedEvents.length; i += 1) {
    if (!isPlainObject(value.expectedEvents[i])) {
      return fail(
        REPLAY_ERROR_CODES.INVALID_EXPECTED_EVENTS,
        `expectedEvents[${i}] must be an object, got ${describe(value.expectedEvents[i])}.`,
      );
    }
  }

  return {
    ok: true,
    replay: {
      version: CURRENT_REPLAY_VERSION,
      seed: /** @type {number | null} */ (value.seed),
      settingsOverrides: isPlainObject(value.settingsOverrides)
        ? { ...value.settingsOverrides }
        : {},
      // Rebuilt as exactly {t, player, dir} - not spread - so a stray extra key on an input entry
      // (replay.schema.json's additionalProperties: false applies to an entry too) can never leak through;
      // describeInvalidInput above already proved each of these three fields has the right type and value.
      inputs: value.inputs.map((entry) => {
        const validated = /** @type {ReplayInput} */ (entry);
        return { t: validated.t, player: validated.player, dir: validated.dir };
      }),
      // Copied wholesale, not rebuilt field by field: an event's interior is deliberately unchecked (module
      // doc), so there are no known field names to rebuild from - only "is a plain object" is this file's
      // business here.
      expectedEvents: value.expectedEvents.map((event) => ({
        .../** @type {Record<string, unknown>} */ (event),
      })),
    },
  };
}

/**
 * Parses and validates a replay. Accepts either the raw JSON text a paste box or a file read hands over, or
 * an already-parsed value (e.g. the plain object `session.getReplay()` returns) — a UI only ever has the
 * former, but the latter lets code that already holds a parsed value validate it without a
 * stringify/parse round trip.
 *
 * Never throws: every failure — truncated or invalid JSON, a wrong-typed field, an unsupported version —
 * comes back as `{ ok: false, error: { code, message } }` so a caller (KI-05-03's paste box, among others)
 * can display `error.message` directly with no `try`/`catch` of its own.
 *
 * @param {string | unknown} input
 * @returns {ParseReplayResult}
 */
export function parseReplay(input) {
  if (typeof input !== 'string') {
    return validateParsedReplay(input);
  }

  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return fail(REPLAY_ERROR_CODES.INVALID_JSON, `This is not valid JSON (${reason}).`);
  }

  return validateParsedReplay(parsed);
}
