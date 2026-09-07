// @ts-check
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { RoundSimulation } from '../../../src/core/round.js';
import { runRound } from '../../../tests/sim/harness.js';

/**
 * KI-09-03 (`docs/sprints/improvement-09-determinism-across-browsers.md`): two guards against ambient state
 * leaking into `src/core`, the pure deterministic simulation `ARCHITECTURE §4` describes.
 *
 * AC1/AC3 lint in-memory snippets through the repository's real `eslint.config.js` (`new ESLint({ cwd })`)
 * rather than a config built here — a config written inside this file would only prove the test's own
 * opinion of what the rule should do, not what `npm run lint` actually enforces over the repository.
 *
 * AC2 runs a full round with the four forbidden globals replaced by throwing stubs and checks the resulting
 * event log against the same committed golden `round.test.js` uses, so this is a proof of "never asked for
 * one", not merely "did not crash".
 */

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

const GOLDEN_NO_INPUT_ROUND = JSON.parse(
  readFileSync(new URL('./__golden__/no-input-round.json', import.meta.url), 'utf8'),
);

const TWO_PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * One snippet per forbidden form (module doc: "a rule that catches `Math.random` and misses `new Date`
 * passes a one-case test and fails at its job"), each naming the `ruleId` and exact message text the
 * `src/core/**` block in `eslint.config.js` must still be emitting for that form. Kept as a table, not four
 * separate `it`s per direction, so AC1 and AC3 exercise identically-shaped cases.
 *
 * @type {{name: string, code: string, ruleId: string, message: string}[]}
 */
const FORBIDDEN_FORMS = [
  {
    name: 'Math.random',
    code: 'export function f() { return Math.random(); }\n',
    ruleId: 'no-restricted-properties',
    message:
      "'Math.random' is restricted from being used. src/core must be deterministic: all randomness goes through the seeded Rng in src/core/rng.js, never Math.random (ARCHITECTURE §4, KI-09-03).",
  },
  {
    name: 'Date.now',
    code: 'export function f() { return Date.now(); }\n',
    ruleId: 'no-restricted-properties',
    message:
      "'Date.now' is restricted from being used. src/core must be deterministic: time is counted in whole simulation ticks, never read from Date.now (ARCHITECTURE §4, KI-09-03).",
  },
  {
    name: 'performance.now',
    code: 'export function f() { return performance.now(); }\n',
    ruleId: 'no-restricted-properties',
    message:
      "'performance.now' is restricted from being used. src/core must be deterministic: time is counted in whole simulation ticks, never read from performance.now (ARCHITECTURE §4, KI-09-03).",
  },
  {
    name: 'new Date',
    code: 'export function f() { return new Date(); }\n',
    ruleId: 'no-restricted-syntax',
    message:
      'src/core must be deterministic: time is counted in whole simulation ticks, never read from `new Date` (ARCHITECTURE §4, KI-09-03).',
  },
];

/**
 * The aliasing form each `no-restricted-globals` entry exists for: `const p = performance; p.now()` never
 * writes the member expression `performance.now`/`Date.now` the property rule matches on, so it is the one
 * form in this file that only `no-restricted-globals` reports — every `FORBIDDEN_FORMS` case above is also
 * covered (redundantly) by `no-restricted-properties` or `no-restricted-syntax`. Kept as its own table,
 * rather than folded into `FORBIDDEN_FORMS`, because these two cases exist specifically to give
 * `no-restricted-globals` a test of its own.
 *
 * @type {{name: string, code: string, ruleId: string, message: string}[]}
 */
const ALIAS_FORMS = [
  {
    name: 'aliased performance (const p = performance; p.now())',
    code: 'export function f() { const p = performance; return p.now(); }\n',
    ruleId: 'no-restricted-globals',
    message:
      "Unexpected use of 'performance'. src/core must be deterministic: do not reach for the ambient performance clock at all, not even through an alias (ARCHITECTURE §4, KI-09-03) — time is counted in whole simulation ticks.",
  },
  {
    name: 'aliased Date (const D = Date; D.now())',
    code: 'export function f() { const D = Date; return D.now(); }\n',
    ruleId: 'no-restricted-globals',
    message:
      "Unexpected use of 'Date'. src/core must be deterministic: do not reach for the ambient Date clock at all, not even through an alias (ARCHITECTURE §4, KI-09-03) — time is counted in whole simulation ticks.",
  },
];

/** Every case AC1 and AC3 exercise, in both directions — the four forbidden forms plus the two alias forms. */
const ALL_FORMS = [...FORBIDDEN_FORMS, ...ALIAS_FORMS];

/**
 * Lints `code` as though it lived at `relativePath` (a virtual file — it need not exist on disk; ESLint's
 * flat-config `files` globs match against the path alone) using the repository's real, committed
 * `eslint.config.js`.
 *
 * @param {string} code
 * @param {string} relativePath
 * @returns {Promise<import('eslint').Linter.LintMessage[]>}
 */
async function lintSnippetAt(code, relativePath) {
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, { filePath: relativePath });
  return result.messages;
}

describe('KI-09-03 guards against ambient state', () => {
  describe('AC1 the lint rule fires on ambient-state access in src/core', () => {
    for (const form of ALL_FORMS) {
      it(`KI-09-03 AC1: ${form.name} in src/core is reported by the real eslint.config.js`, async () => {
        const messages = await lintSnippetAt(form.code, 'src/core/__purity_check__.js');
        const match = messages.find((message) => message.ruleId === form.ruleId);
        // Asserting on both `ruleId` and the exact message text (not just "some error happened") so a rule
        // renamed, swapped for a different one, or a message emptied out is a failure here, not a silent gap.
        expect(match).toBeDefined();
        expect(match?.message).toBe(form.message);
      });
    }

    it('KI-09-03 AC1: Math.random() linted at a real src/core file path (src/core/grid.js) is reported the same way', async () => {
      // The PR's red-run evidence adds this statement to the actual src/core/grid.js and reverts it; this
      // test proves the same thing without ever leaving src/ dirty — it lints the identical statement as a
      // snippet, only *at* grid.js's path rather than inside the committed file itself.
      const messages = await lintSnippetAt(
        'export const cell = { x: 0, y: 0 };\nexport function jitter() { return Math.random(); }\n',
        'src/core/grid.js',
      );
      expect(messages.map((message) => message.ruleId)).toContain('no-restricted-properties');
    });
  });

  describe('AC3 the rule is scoped to src/core only', () => {
    for (const form of ALL_FORMS) {
      it(`KI-09-03 AC3: ${form.name} is not reported in src/game`, async () => {
        const messages = await lintSnippetAt(form.code, 'src/game/__purity_check__.js');
        expect(messages.find((message) => message.ruleId === form.ruleId)).toBeUndefined();
      });

      it(`KI-09-03 AC3: ${form.name} is not reported in src/render`, async () => {
        const messages = await lintSnippetAt(form.code, 'src/render/__purity_check__.js');
        expect(messages.find((message) => message.ruleId === form.ruleId)).toBeUndefined();
      });
    }
  });

  describe('AC2 a full round completes with every ambient-state global stubbed to throw', () => {
    /** @type {typeof Math.random} */
    let realMathRandom;
    /** @type {typeof Date.now} */
    let realDateNow;
    /** @type {typeof performance.now} */
    let realPerformanceNow;
    /** @type {DateConstructor} */
    let realDate;

    /**
     * Installs the four throwing stubs. Deliberately not `beforeEach` + a long-lived `afterEach`: the window
     * where the ambient globals are broken must be as narrow as possible and fully synchronous (tech-lead
     * note: "No `await` while the stubs are installed") so Vitest's own use of `Date.now`/`performance.now`
     * between test hooks is never caught in it. `vi.useFakeTimers()` is deliberately not used here either —
     * a fake timer hands back a value where the entire point is that `src/core` must never ask for one.
     */
    function installThrowingStubs() {
      realMathRandom = Math.random;
      realDateNow = Date.now;
      realPerformanceNow = performance.now;
      realDate = globalThis.Date;

      Math.random = () => {
        throw new Error('KI-09-03: src/core must not call Math.random');
      };
      Date.now = () => {
        throw new Error('KI-09-03: src/core must not call Date.now');
      };
      performance.now = () => {
        throw new Error('KI-09-03: src/core must not call performance.now');
      };
      /** Throws on `new Date(...)`; `Date.now` is stubbed separately above since it is a static method a
       * subclass does not override just by extending the constructor. */
      class ThrowingDate extends realDate {
        constructor(...args) {
          if (args.length === 0) {
            throw new Error('KI-09-03: src/core must not call new Date()');
          }
          // A date-valued arg would only ever be built from an ambient clock in the first place, so any
          // constructor call at all — not only the zero-arg "now" form — is disallowed here.
          throw new Error('KI-09-03: src/core must not call new Date(...)');
        }
      }
      // @ts-expect-error - intentionally replacing the global constructor by reference for the test's duration
      globalThis.Date = ThrowingDate;
    }

    /** Restores the four globals by reference, so nothing about identity (`Date === Date`) elsewhere changes. */
    function restoreRealGlobals() {
      Math.random = realMathRandom;
      Date.now = realDateNow;
      performance.now = realPerformanceNow;
      globalThis.Date = realDate;
    }

    // Belt-and-suspenders per the tech-lead notes: if an assertion inside a stubbed block throws, the
    // `finally` around it already restores the globals, but restoring again here means a mid-test failure can
    // never poison a later test in this file.
    afterEach(() => {
      if (realMathRandom) restoreRealGlobals();
    });

    it('KI-09-03 AC2: RoundSimulation reproduces the golden no-input round with Math.random, Date.now, performance.now and new Date all throwing', () => {
      installThrowingStubs();
      let events;
      try {
        const sim = new RoundSimulation({ seed: 1, players: TWO_PLAYERS, mode: 'match' });
        const dt = 1 / sim.settings.simHz;
        events = [...sim.events];
        for (let i = 0; i < 20000 && sim.phase === 'PLAYING'; i += 1) {
          events.push(...sim.advance(dt));
        }
      } finally {
        restoreRealGlobals();
      }
      // No `await` above and the assertion happens only after globals are back to real ones, so this
      // comparison itself never runs inside the throwing window.
      expect(events).toEqual(GOLDEN_NO_INPUT_ROUND);
    });

    it('KI-09-03 AC2: tests/sim/harness.js runRound reproduces the same golden with the same globals stubbed to throw', () => {
      installThrowingStubs();
      let result;
      try {
        result = runRound({
          seed: 1,
          bots: [
            () => null,
            () => null,
          ],
        });
      } finally {
        restoreRealGlobals();
      }
      expect(result.events).toEqual(GOLDEN_NO_INPUT_ROUND);
    });
  });
});
