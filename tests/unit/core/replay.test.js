// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CURRENT_REPLAY_VERSION,
  REPLAY_ERROR_CODES,
  parseReplay,
} from '../../../src/core/replay.js';

/**
 * KI-05-01 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): the versioned replay format's
 * parser. AC1 proves the format is backward-compatible with every producer that already exists
 * (`tests/sim/replays/*.json`, `session.getReplay()`); AC2 proves malformed or future input is reported, not
 * thrown.
 */

const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../sim/replays');
const ARCHITECTURE_MD = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../docs/design/ARCHITECTURE.md',
);

/**
 * Loads every committed replay fixture as raw text, exactly as a file-read or clipboard paste would hand it
 * to `parseReplay` — not pre-parsed here, so AC1 also exercises the JSON-parsing half of the parser, not only
 * the shape validation. Reads from disk with `readdirSync` (not a hard-coded list) so a fixture added later
 * is covered automatically, same as `tests/sim/replay.test.js`.
 *
 * @returns {{file: string, text: string}[]}
 */
function loadFixtureFiles() {
  return readdirSync(REPLAYS_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'replay.schema.json')
    .map((file) => ({ file, text: readFileSync(join(REPLAYS_DIR, file), 'utf8') }));
}

/** A minimal, otherwise-valid replay object, cloned and tweaked per test so each case changes exactly one thing. */
function validReplay() {
  return {
    seed: 42,
    settingsOverrides: {},
    inputs: [{ t: 0.5, player: 'p1', dir: 'UP' }],
    expectedEvents: [{ type: 'FOOD_SPAWNED', tick: 0, t: 0 }],
  };
}

describe('KI-05-01 replay format', () => {
  describe('AC1: every committed fixture parses and reports version 1', () => {
    const fixtures = loadFixtureFiles();

    it('KI-05-01 AC1: at least one fixture exists to prove this against', () => {
      // Without this, an empty (or misconfigured) fixture directory would make every `it.each` below vanish
      // silently instead of failing — exactly the "a test that cannot fail is worse than no test" trap.
      expect(fixtures.length).toBeGreaterThan(0);
    });

    it.each(fixtures)('KI-05-01 AC1: $file parses ok and reports version 1', ({ text }) => {
      const result = parseReplay(text);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.replay.version).toBe(1);
        expect(result.replay.version).toBe(CURRENT_REPLAY_VERSION);
      }
    });

    it.each(fixtures)(
      'KI-05-01 AC1: $file round-trips its own seed/inputs/expectedEvents unchanged',
      ({ text }) => {
        const source = JSON.parse(text);
        const result = parseReplay(text);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.replay.seed).toEqual(source.seed);
          expect(result.replay.inputs).toEqual(source.inputs);
          expect(result.replay.expectedEvents).toEqual(source.expectedEvents);
          expect(result.replay.settingsOverrides).toEqual(source.settingsOverrides ?? {});
        }
      },
    );

    // `session.getReplay()` (src/game/session.js) is the second producer of this shape. It is built here from
    // the `Replay` fields directly rather than by importing session.js, which drags in the game loop, input
    // and rendering seams `src/core` tests must not depend on (CLAUDE.md: no DOM in src/core).
    it('KI-05-01 AC1: the shape session.getReplay() returns parses ok', () => {
      const getReplayShape = {
        seed: 7,
        settingsOverrides: { snakeSpeed: 9 },
        inputs: [{ t: 1.2, player: 'p2', dir: 'LEFT' }],
        expectedEvents: [{ type: 'ROUND_OVER', tick: 100, t: 10, result: 'WIN', reason: 'DEATH' }],
      };
      const result = parseReplay(JSON.stringify(getReplayShape));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.replay.version).toBe(1);
    });

    // KS-07-01 AC2 / this file's own module doc: `getReplay()` returns `seed: null` before any round has run.
    // That is a legitimate recording, not a malformed one, and this is the decision's test either way.
    it('KI-05-01: seed: null (getReplay() before any round exists) is accepted, not rejected', () => {
      const result = parseReplay(
        JSON.stringify({ seed: null, settingsOverrides: {}, inputs: [], expectedEvents: [] }),
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.replay.seed).toBeNull();
    });

    it('KI-05-01 AC1: an explicit version: 1 parses identically to an absent version', () => {
      const withVersion = parseReplay(JSON.stringify({ ...validReplay(), version: 1 }));
      const without = parseReplay(JSON.stringify(validReplay()));
      expect(withVersion).toEqual(without);
    });

    it('KI-05-01 AC1: settingsOverrides omitted entirely defaults to {}', () => {
      const replay = validReplay();
      delete replay.settingsOverrides;
      const result = parseReplay(JSON.stringify(replay));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.replay.settingsOverrides).toEqual({});
    });
  });

  describe('AC2: a truncated file, a wrong-typed field, and a version-2 file each produce a named error', () => {
    it('KI-05-01 AC2: a truncated file is INVALID_JSON, not an exception', () => {
      const text = JSON.stringify(validReplay());
      const truncated = text.slice(0, Math.floor(text.length / 2));
      let result;
      expect(() => {
        result = parseReplay(truncated);
      }).not.toThrow();
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_JSON);
      expect(result.error.message.length).toBeGreaterThan(0);
    });

    it('KI-05-01 AC2: a version-2 file is UNSUPPORTED_VERSION, not an exception', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), version: 2 }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(REPLAY_ERROR_CODES.UNSUPPORTED_VERSION);
        expect(result.error.message).toContain('2');
      }
    });

    it('KI-05-01 AC2: an unknown/non-integer version is also UNSUPPORTED_VERSION, not an exception', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), version: 1.5 }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.UNSUPPORTED_VERSION);
    });

    it('KI-05-01 AC2: JSON that is null is NOT_AN_OBJECT', () => {
      const result = parseReplay('null');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.NOT_AN_OBJECT);
    });

    it('KI-05-01 AC2: JSON that is an array is NOT_AN_OBJECT', () => {
      const result = parseReplay('[1, 2, 3]');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.NOT_AN_OBJECT);
    });

    it('KI-05-01 AC2: JSON that is a bare string is NOT_AN_OBJECT', () => {
      const result = parseReplay('"hello"');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.NOT_AN_OBJECT);
    });

    it('KI-05-01 AC2: seed as a string is INVALID_SEED, not an exception', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), seed: 'not a number' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_SEED);
    });

    it('KI-05-01 AC2: settingsOverrides present but an array is INVALID_SETTINGS_OVERRIDES', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), settingsOverrides: [] }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_SETTINGS_OVERRIDES);
    });

    it('KI-05-01 AC2: settingsOverrides present but a string is INVALID_SETTINGS_OVERRIDES', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), settingsOverrides: 'nope' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_SETTINGS_OVERRIDES);
    });

    it('KI-05-01 AC2: inputs not an array is INVALID_INPUTS', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), inputs: {} }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUTS);
    });

    it('KI-05-01 AC2: an inputs entry that is not an object is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), inputs: ['nope'] }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
    });

    it('KI-05-01 AC2: an inputs entry missing t is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(
        JSON.stringify({ ...validReplay(), inputs: [{ player: 'p1', dir: 'UP' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
        expect(result.error.message).toContain('.t');
      }
    });

    it('KI-05-01 AC2: an inputs entry missing player is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(
        JSON.stringify({ ...validReplay(), inputs: [{ t: 0, dir: 'UP' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
        expect(result.error.message).toContain('.player');
      }
    });

    it('KI-05-01 AC2: an inputs entry missing dir is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(
        JSON.stringify({ ...validReplay(), inputs: [{ t: 0, player: 'p1' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
        expect(result.error.message).toContain('.dir');
      }
    });

    it('KI-05-01 AC2: an inputs entry with player outside p1|p2 is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(
        JSON.stringify({ ...validReplay(), inputs: [{ t: 0, player: 'p3', dir: 'UP' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
    });

    it('KI-05-01 AC2: an inputs entry with dir outside UP|DOWN|LEFT|RIGHT is INVALID_INPUT_ENTRY', () => {
      const result = parseReplay(
        JSON.stringify({ ...validReplay(), inputs: [{ t: 0, player: 'p1', dir: 'SIDEWAYS' }] }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_INPUT_ENTRY);
    });

    it('KI-05-01 AC2: expectedEvents not an array is INVALID_EXPECTED_EVENTS', () => {
      const result = parseReplay(JSON.stringify({ ...validReplay(), expectedEvents: 'nope' }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_EXPECTED_EVENTS);
    });

    it('KI-05-01 AC2: INVALID_JSON still reports a useful message when the underlying failure is not an Error instance', () => {
      // JSON.parse always throws a real Error in every engine this game targets; this only exists to prove
      // the non-Error fallback in parseReplay's catch block also produces a readable message rather than
      // "[object Object]" or similar, for whatever JSON implementation someday doesn't follow that norm.
      const spy = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
        throw 'not an Error instance';
      });
      try {
        const result = parseReplay('{}');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe(REPLAY_ERROR_CODES.INVALID_JSON);
          expect(result.error.message).toContain('not an Error instance');
        }
      } finally {
        spy.mockRestore();
      }
    });

    it('KI-05-01 AC2: none of the above ever throw, they all return ok: false', () => {
      const badInputs = [
        '',
        '{',
        'null',
        '[]',
        '"x"',
        JSON.stringify({ ...validReplay(), version: 2 }),
        JSON.stringify({ ...validReplay(), seed: {} }),
        JSON.stringify({ ...validReplay(), inputs: null }),
        JSON.stringify({ ...validReplay(), expectedEvents: null }),
        undefined,
        123,
        true,
      ];
      for (const input of badInputs) {
        let result;
        expect(() => {
          result = parseReplay(input);
        }).not.toThrow();
        expect(result.ok).toBe(false);
      }
    });
  });

  describe('AC3: ARCHITECTURE.md documents the format', () => {
    const doc = readFileSync(ARCHITECTURE_MD, 'utf8');

    it('KI-05-01 AC3: ARCHITECTURE.md has a section documenting the replay format', () => {
      expect(doc).toMatch(/replay/i);
      // The four fields and the version rule are the substance of the section (tech-lead notes on #219);
      // asserting each is present, not just the word "replay", is what stops this test passing on a stray
      // mention elsewhere in the file.
      for (const field of ['seed', 'settingsOverrides', 'inputs', 'expectedEvents', 'version']) {
        expect(doc).toContain(field);
      }
    });

    it('KI-05-01 AC3: ARCHITECTURE.md states that an absent version means version 1', () => {
      expect(doc).toMatch(/absent.{0,40}version.{0,10}1|version.{0,10}absent.{0,40}1/is);
    });

    it('KI-05-01 AC3: ARCHITECTURE.md names all three producers of the shape', () => {
      expect(doc).toContain('tests/sim/replays');
      expect(doc).toMatch(/getReplay/);
      expect(doc).toMatch(/playtestSession/);
    });
  });
});
