// @ts-check
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CAUSES } from '../../src/core/collisions.js';
import { EVENTS, PHASES, RESULTS } from '../../src/core/events.js';
import { DIRECTIONS } from '../../src/core/grid.js';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';
import { roundSeedFor } from '../../src/game/session.js';
import { runRound } from '../sim/harness.js';

/**
 * KI-09-01: proves the round Chromium plays is the same round Node's tests already trust
 * (`docs/sprints/improvement-09-determinism-across-browsers.md`), by comparing a browser-driven event log
 * against a committed fixture **field for field**, never by re-deriving a new "expected" log from the browser
 * itself. AC1 and AC2's two replay fixtures check the browser against the committed goldens
 * (`tests/unit/core/__golden__/no-input-round.json`, `tests/sim/replays/*.json`), the same oracle
 * `tests/unit/core/round.test.js` and `tests/sim/replay.test.js` check Node against. The `pressKey` scenario
 * is a narrower claim: its oracle is a *Node replay of the exact ticks the browser itself landed on*
 * (`tests/sim/harness.js`'s `runRound`), not a pre-committed file — it proves the keyboard path agrees with
 * this repository's own engine, not that either of them matches a golden. Both are proofs against this
 * repository's own engine; only the first kind is also a proof against a fixture nobody in this run could
 * have influenced.
 *
 * ## The seed: `?seed=N` fixes the *match*, not the round
 *
 * `session.js`'s `startRound()` builds its `RoundSimulation` on `roundSeedFor(matchSeed, roundIndex)`, not on
 * the match seed itself (`ARCHITECTURE §4`, `roundSeedFor`'s own doc comment). So `__kobi.setSeed(1)` does
 * **not** play the seed-1 round `tests/unit/core/__golden__/no-input-round.json` records — it plays
 * `roundSeedFor(1, 0)`, a different number entirely.
 *
 * An exhaustive search of the whole 32-bit match-seed space (`docs/sprints` kick-off comment on issue #159)
 * found that **`2246834427` is the one and only match seed whose first derived round seed is `1`** — mulberry32's
 * first output is not a surjection onto 32 bits, so most round seeds (including every replay fixture's: `4`,
 * `101`, `4242`) are not reachable as *anybody's* first round at all, through any match seed. That is a
 * property of `roundSeedFor`, not a defect, and it is why {@link MATCH_SEED_FOR_GOLDEN} below is the number it
 * is rather than the golden's own seed of `1` — and why AC1 is the only one of this file's scenarios that goes
 * through `startMatch`; {@link playDetachedSimInPage} is how the other seeds get played at all. Every place
 * this magic number matters is **checked, not trusted**: `roundSeedFor(MATCH_SEED_FOR_GOLDEN, 0) === 1` is
 * asserted in Node below, and `__kobi.getSeeds().roundSeeds[0] === 1` is asserted against what the browser
 * itself derived.
 *
 * ## Whole ticks, never a duration
 *
 * `__kobi.advance(seconds)` chunks internally at 0.1 s (`src/game/testHooks.js`), so a duration spanning more
 * than one chunk from an empty accumulator can deliver one tick fewer than asked (`tests/e2e/first-playable
 * .spec.js`'s module comment, issue #100). `1 / 120 * 120 === 1` exactly, so a single-tick `advance` cannot
 * drift, and every stepping loop in this file is `while (sim.phase === 'PLAYING') kobi.advance(1 / simHz)` —
 * the same shape `tests/sim/harness.js`'s `driveWithInputLog` uses, which is what a replay must reproduce.
 * Never `advance(ticks / simHz)`: that division is safe in `first-playable.spec.js` only because a real
 * fractional accumulator absorbs the float error, and this file's accumulators all start at exactly 0.
 *
 * ## Getting the event log out — no `src/` change
 *
 * `session.js` already keeps this exact log (`roundEventLog`, seeded with `[...sim.events]` so the
 * constructor's opening `FOOD_SPAWNED`s are included, exactly as `harness.js` seeds a headless run) but hands
 * it back only through `getReplay()`, which is wired to the tuning overlay, not to `__kobi`. Rather than widen
 * `__kobi` (outside this ticket's `Files:` list), every scenario below records the same log itself, from
 * inside a single `page.evaluate`, with a pass-through wrapper on the live simulation's own `advance`:
 *
 * ```js
 * const log = [...sim.events];             // the constructor's own opening apples
 * const inner = sim.advance.bind(sim);
 * sim.advance = (dt) => { const events = inner(dt); log.push(...events); return events; };
 * ```
 *
 * **Everything from `startMatch`/construction to the last tick happens inside one synchronous
 * `page.evaluate`.** `main.js` keeps a real `requestAnimationFrame` loop running for the life of the page; a
 * frame landing in a gap between two `evaluate` round-trips would tick the round out from under this file the
 * same way issue #100 describes for `first-playable.spec.js`. A synchronous callback cannot be interrupted by
 * `requestAnimationFrame`, which is what makes one `evaluate` call safe and two calls (even back to back) not.
 *
 * ## AC2's replay fixtures: a detached `RoundSimulation`, not `startMatch`
 *
 * `laser-turns-into-beam.json` (seed 101) and `laser-both-heads-draw.json` (seed 4) have seeds no match seed
 * derives (above), so they cannot be played through the session at all. They are played through the exact
 * class the session already holds — `kobi.sim.constructor`, i.e. the *bundled* `src/core/round.js` under
 * test — constructed detached from any session, the same way `tests/unit/core/round.test.js` and
 * `harness.js` construct one directly in Node. Their `settingsOverrides` trees are entirely flat, so
 * `withOverrides(overrides)` is provably (not assumed) the same as `{...SETTINGS, ...overrides}` for these two
 * files; see the assertion inside each of their tests.
 *
 * ## AC3: naming the first differing tick
 *
 * {@link firstDivergence} walks two event logs in lock-step and returns the first place they disagree —
 * extra or missing events at the end included — as `{index, tick, path, actual, expected}`. Two things prove
 * it, per the tech-lead notes: a permanent test below that corrupts a **deep copy** of the golden and asserts
 * `firstDivergence` names the tick it changed (the shared parsed fixture is never mutated — AC1 depends on
 * it); and a one-off manual demonstration recorded in this ticket's PR, where the committed golden file
 * itself was edited, this spec was run to get the real red output, and the file was restored with
 * `git checkout` before anything was committed. A green run alone does not satisfy AC3 — see the PR.
 */

/** @typedef {{index: number, tick: number, path: string, actual: unknown, expected: unknown}} Divergence */

/**
 * The one and only 32-bit match seed whose first derived round seed is `1` — the seed
 * `tests/unit/core/__golden__/no-input-round.json` was recorded at. See the module comment's "The seed"
 * section above.
 */
const MATCH_SEED_FOR_GOLDEN = 2246834427;

/**
 * A generous cap on how many whole-tick `advance` calls a stepping loop below may make before giving up. A
 * real round always ends (`RoundSimulation` AC2/AC4 of KS-02-05); this only turns a bug that broke that
 * guarantee into a failed assertion instead of a hung test. `90 * 120 = 10800` is a full-length round's own
 * tick count (`SETTINGS.roundDuration` at `SETTINGS.simHz`), so this comfortably covers every scenario here,
 * including {@link MATCH_SEED_FOR_GOLDEN}'s round, which — like the golden it is being checked against —
 * actually ends at tick 380.
 */
const TICK_CAP = 12_000;

/**
 * The two AC2 replay fixtures both override `roundDuration` down to 2 simulated seconds (240 ticks at
 * `simHz`), so their own cap can be far smaller than {@link TICK_CAP} while still leaving headroom.
 */
const FIXTURE_TICK_CAP = 1_000;

/**
 * The two players every scenario below plays with, in `RoundSimulation`'s own id order and the match-setup
 * screen's default colours (`tests/e2e/first-playable.spec.js`'s own `PLAYERS`) — colours change nothing
 * about the simulation, but the round played here is meant to be built the same way the real one is, not
 * nearly the same way.
 */
const PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

const GOLDEN_NO_INPUT_ROUND = JSON.parse(
  readFileSync(
    new URL('../unit/core/__golden__/no-input-round.json', import.meta.url),
    'utf8',
  ),
);

const LASER_TURNS_INTO_BEAM = JSON.parse(
  readFileSync(new URL('../sim/replays/laser-turns-into-beam.json', import.meta.url), 'utf8'),
);

const LASER_BOTH_HEADS_DRAW = JSON.parse(
  readFileSync(new URL('../sim/replays/laser-both-heads-draw.json', import.meta.url), 'utf8'),
);

/**
 * A bot that never decides anything — `inputLog` drives the round instead of bot decisions, but `runRound`
 * still needs exactly two of these to fix the player count (`tests/sim/harness.js`, mirroring
 * `tests/sim/replay.test.js`'s own `noopBot`).
 * @returns {null}
 */
function noopBot() {
  return null;
}

/**
 * Structural equality good enough for the plain, JSON-shaped events this file compares — no functions, no
 * `Date`, nothing `JSON.parse(JSON.stringify(...))` would not already round-trip. **Not a general-purpose
 * deep-equal**: comparing by `Object.keys` alone means an array and a plain object with the same numeric
 * keys (`[4, 4]` vs `{0: 4, 1: 4}`) would read as equal, which is fine for a real event log — nothing here
 * ever emits the latter shape — but would be a bug anywhere that could.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual(/** @type {any} */ (a)[key], /** @type {any} */ (b)[key]),
  );
}

/**
 * The first key on which two same-index events disagree, or `null` when they agree on every field. Checked
 * in the order `round.js`'s `emit` always builds an event (`{type, tick, t, ...payload}`), so a `type`
 * mismatch is reported before a payload mismatch and a `tick`/`t` mismatch before a `cause` or `cell` one —
 * `Set` preserves the insertion order of whichever array first contributed a given key.
 *
 * @param {Record<string, unknown>} actualEvent
 * @param {Record<string, unknown>} expectedEvent
 * @returns {string | null}
 */
function fieldDivergence(actualEvent, expectedEvent) {
  const keys = new Set([...Object.keys(expectedEvent), ...Object.keys(actualEvent)]);
  for (const key of keys) {
    if (!deepEqual(actualEvent[key], expectedEvent[key])) return key;
  }
  return null;
}

/**
 * Walks two event logs in order and returns the first place they disagree, or `null` when they are identical
 * field for field (KI-09-01 AC3). A log that runs short or long at the end is a divergence too, named at the
 * tick the other log's corresponding event carries, rather than an out-of-bounds crash in this helper.
 *
 * @param {Record<string, unknown>[]} actual
 * @param {Record<string, unknown>[]} expected
 * @returns {Divergence | null}
 */
function firstDivergence(actual, expected) {
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    const actualEvent = actual[index];
    const expectedEvent = expected[index];
    if (actualEvent === undefined) {
      return {
        index,
        tick: /** @type {number} */ (expectedEvent.tick),
        path: '(missing event)',
        actual: undefined,
        expected: expectedEvent,
      };
    }
    if (expectedEvent === undefined) {
      return {
        index,
        tick: /** @type {number} */ (actualEvent.tick),
        path: '(extra event)',
        actual: actualEvent,
        expected: undefined,
      };
    }
    const path = fieldDivergence(actualEvent, expectedEvent);
    if (path !== null) {
      return {
        index,
        tick: /** @type {number} */ (expectedEvent.tick),
        path,
        actual: actualEvent[path],
        expected: expectedEvent[path],
      };
    }
  }
  return null;
}

/**
 * Renders a {@link Divergence} as the one-line failure message AC3 asks for — naming the first differing
 * tick rather than leaving a reader to find it in a wall of diffed JSON.
 *
 * @param {Divergence} divergence
 * @returns {string}
 */
function formatDivergence({ index, tick, path, actual, expected }) {
  return `Browser and golden diverge at event ${index} (tick ${tick}): ${path} — browser ${JSON.stringify(actual)}, golden ${JSON.stringify(expected)}`;
}

/**
 * Fails the current test with AC3's own message shape when `actual` and `expected` disagree anywhere.
 *
 * @param {Record<string, unknown>[]} actual
 * @param {Record<string, unknown>[]} expected
 */
function assertEventLogsEqual(actual, expected) {
  const divergence = firstDivergence(actual, expected);
  if (divergence !== null) throw new Error(formatDivergence(divergence));
}

/**
 * Builds a detached `RoundSimulation` inside the page — from `kobi.sim.constructor`, the class the session
 * already holds, so this needs no `src/` import of its own and exercises the exact bundled code a real round
 * runs on — and drives it with a tick-resolved input log, exactly like `harness.js`'s `driveWithInputLog`:
 * every entry is resolved to a tick once up front, everything due at `tick <= sim.tick` is applied before
 * that tick's `advance`, and the simulation always steps one whole tick at a time.
 *
 * A live session has to exist first purely so `kobi.sim.constructor` is reachable at all — the seeds this
 * function plays are not reachable through `startMatch` (module comment above), so nothing about *that*
 * session's own round matters and nothing below reads it again. That session's real `requestAnimationFrame`
 * loop (`main.js`) keeps running in the background regardless, ticking the *ignored* session round it left
 * behind — harmless only because every line below that touches the detached `sim` runs inside this one
 * synchronous `page.evaluate`, so no such frame can land in the middle of it and nothing it does can reach
 * `sim` at all: the two simulations share nothing but the class that builds them.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   seed: number,
 *   settings: object,
 *   players: {id: string, color?: string}[],
 *   directions: Record<string, {dx: number, dy: number}>,
 *   inputs: {t: number, player: string, dir: string}[],
 *   cap: number,
 * }} args
 * @returns {Promise<{log: object[], guardHit: boolean, phase: string}>}
 */
async function playDetachedSimInPage(page, { seed, settings, players, directions, inputs, cap }) {
  return page.evaluate(
    ({ seed, settings, players, directions, inputs, cap }) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch();
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);

      const RoundSim = kobi.sim.constructor;
      const sim = new RoundSim({ settings, seed, players, mode: 'match' });
      const log = [...sim.events];

      const pending = inputs
        .map((/** @type {any} */ entry) => ({
          ...entry,
          tick: Math.round(entry.t * settings.simHz),
        }))
        .sort((/** @type {any} */ a, /** @type {any} */ b) => a.tick - b.tick);
      const dt = 1 / settings.simHz;

      let guard = 0;
      while (sim.phase === 'PLAYING' && guard < cap) {
        while (pending.length > 0 && pending[0].tick <= sim.tick) {
          const input = pending.shift();
          sim.applyInput(input.player, directions[input.dir]);
        }
        log.push(...sim.advance(dt));
        guard += 1;
      }
      return { log, guardHit: guard >= cap, phase: sim.phase };
    },
    { seed, settings, players, directions, inputs, cap },
  );
}

test.describe('KI-09-01 the same round, in Node and in Chromium', () => {
  test('KI-09-01 AC1: the browser reproduces the no-input golden round tick for tick, including the tick-380 DRAW', async ({
    page,
  }) => {
    // Checked, not trusted (module comment "The seed"): the one and only 32-bit match seed whose first
    // derived round seed is the golden's own seed of 1.
    expect(roundSeedFor(MATCH_SEED_FOR_GOLDEN, 0)).toBe(1);

    await page.goto('?test=1&reducedFx=1');
    const browserResult = await page.evaluate(
      ({ matchSeed, cap }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        kobi.setSeed(matchSeed);
        kobi.startMatch();
        for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
        kobi.fastForward(0);

        const sim = kobi.sim;
        const startTick = sim.tick;
        const seeds = kobi.getSeeds();

        // Load-bearing (module comment): the constructor's own opening `FOOD_SPAWNED`s must be captured
        // first, exactly as `session.js`'s own `roundEventLog` and `harness.js`'s `runRound` both do.
        const log = [...sim.events];
        const innerAdvance = sim.advance.bind(sim);
        sim.advance = (/** @type {number} */ dt) => {
          const events = innerAdvance(dt);
          log.push(...events);
          return events;
        };

        const dt = 1 / sim.settings.simHz;
        let guard = 0;
        while (sim.phase === 'PLAYING' && guard < cap) {
          kobi.advance(dt);
          guard += 1;
        }

        return { startTick, seeds, log, phase: sim.phase, guardHit: guard >= cap };
      },
      { matchSeed: MATCH_SEED_FOR_GOLDEN, cap: TICK_CAP },
    );

    // No frame sneaked into the gap between `startMatch` and this script beginning (single `page.evaluate`,
    // module comment) — a round that did not start at tick 0 would silently be a different round.
    expect(browserResult.startTick).toBe(0);
    expect(browserResult.seeds.matchSeed).toBe(MATCH_SEED_FOR_GOLDEN);
    expect(browserResult.seeds.roundSeeds[0]).toBe(1);
    expect(browserResult.guardHit).toBe(false);

    assertEventLogsEqual(browserResult.log, GOLDEN_NO_INPUT_ROUND);

    // A log that matched but ended somewhere else would be a broken test, not a pass.
    expect(browserResult.phase).toBe(PHASES.ROUND_OVER);
    const last = /** @type {any} */ (browserResult.log[browserResult.log.length - 1]);
    expect(last.tick).toBe(380);
    expect(last.type).toBe(EVENTS.ROUND_OVER);
    expect(last.result).toBe(RESULTS.DRAW);
  });

  test('KI-09-01 AC2: laser-turns-into-beam.json (seed 101) reproduces identically in the browser', async ({
    page,
  }) => {
    // This fixture's overrides are entirely flat (README, module comment "AC2's replay fixtures") — proved
    // here, not assumed, so a future nested override added to this file fails loudly instead of silently
    // comparing the browser against the wrong settings.
    const settings = withOverrides(LASER_TURNS_INTO_BEAM.settingsOverrides);
    expect(settings).toEqual({ ...SETTINGS, ...LASER_TURNS_INTO_BEAM.settingsOverrides });

    await page.goto('?test=1&reducedFx=1');
    const result = await playDetachedSimInPage(page, {
      seed: LASER_TURNS_INTO_BEAM.seed,
      settings,
      players: PLAYERS,
      directions: DIRECTIONS,
      inputs: LASER_TURNS_INTO_BEAM.inputs,
      cap: FIXTURE_TICK_CAP,
    });

    expect(result.guardHit).toBe(false);
    expect(result.phase).toBe(PHASES.ROUND_OVER);
    assertEventLogsEqual(result.log, LASER_TURNS_INTO_BEAM.expectedEvents);
  });

  test('KI-09-01 AC2: laser-both-heads-draw.json (seed 4) reproduces identically in the browser', async ({
    page,
  }) => {
    const settings = withOverrides(LASER_BOTH_HEADS_DRAW.settingsOverrides);
    expect(settings).toEqual({ ...SETTINGS, ...LASER_BOTH_HEADS_DRAW.settingsOverrides });

    await page.goto('?test=1&reducedFx=1');
    const result = await playDetachedSimInPage(page, {
      seed: LASER_BOTH_HEADS_DRAW.seed,
      settings,
      players: PLAYERS,
      directions: DIRECTIONS,
      inputs: LASER_BOTH_HEADS_DRAW.inputs,
      cap: FIXTURE_TICK_CAP,
    });

    expect(result.guardHit).toBe(false);
    expect(result.phase).toBe(PHASES.ROUND_OVER);
    assertEventLogsEqual(result.log, LASER_BOTH_HEADS_DRAW.expectedEvents);
  });

  test('KI-09-01 AC2: a pressKey-driven round lands its inputs on the intended ticks and matches the Node replay', async ({
    page,
  }) => {
    // The ticket names `pressKey` explicitly, and a detached `RoundSimulation` fed a pre-resolved input log
    // (the two tests above) never exercises it: `pressKey` dispatches a real `keydown` on the same target
    // `createInput` listens on, which is what proves a keyboard input lands on the tick the browser thinks
    // it is on, not merely that the engine replays a tick-exact log correctly (already proven above).
    await page.goto('?test=1&reducedFx=1');
    const browserResult = await page.evaluate(
      ({ matchSeed, cap }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        kobi.setSeed(matchSeed);
        kobi.startMatch();
        for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
        kobi.fastForward(0);

        const sim = kobi.sim;
        const startTick = sim.tick;
        const seeds = kobi.getSeeds();
        const log = [...sim.events];
        const innerAdvance = sim.advance.bind(sim);
        sim.advance = (/** @type {number} */ dt) => {
          const events = innerAdvance(dt);
          log.push(...events);
          return events;
        };
        const dt = 1 / sim.settings.simHz;

        // P1 spawns at (5,12) heading RIGHT, P2 at (18,11) heading LEFT (`round.js` `SPAWNS`); UP and DOWN
        // are legal turns for each (neither is a reversal), chosen only so the round keeps playing rather
        // than for any particular outcome — this scenario proves *when* an input lands, not what happens
        // to it afterwards.
        const landed = [];
        kobi.pressKey(1, 'UP');
        landed.push({ tick: sim.tick, player: 'p1', dir: 'UP' });
        for (let i = 0; i < 30; i += 1) kobi.advance(dt);

        kobi.pressKey(1, 'LEFT');
        landed.push({ tick: sim.tick, player: 'p1', dir: 'LEFT' });
        for (let i = 0; i < 15; i += 1) kobi.advance(dt);

        kobi.pressKey(2, 'DOWN');
        landed.push({ tick: sim.tick, player: 'p2', dir: 'DOWN' });

        let guard = 0;
        while (sim.phase === 'PLAYING' && guard < cap) {
          kobi.advance(dt);
          guard += 1;
        }

        return { startTick, seeds, log, landed, phase: sim.phase, guardHit: guard >= cap };
      },
      { matchSeed: MATCH_SEED_FOR_GOLDEN, cap: TICK_CAP },
    );

    expect(browserResult.startTick).toBe(0);
    expect(browserResult.seeds.roundSeeds[0]).toBe(1);
    expect(browserResult.guardHit).toBe(false);

    // The ticks the script intended, named up front rather than only read back — a `pressKey` landing one
    // tick early or late would still "work" in the sense of being replayable, but it would not be proof that
    // the keyboard path lands where the browser thinks it does, which is this test's whole point.
    expect(browserResult.landed).toEqual([
      { tick: 0, player: 'p1', dir: 'UP' },
      { tick: 30, player: 'p1', dir: 'LEFT' },
      { tick: 45, player: 'p2', dir: 'DOWN' },
    ]);

    // The oracle is still this repository's own engine (module comment): replay the exact ticks the browser
    // landed on through `harness.js`'s `runRound`, on the same seed 1 the golden itself plays at.
    const inputLog = browserResult.landed.map(({ tick, player, dir }) => ({
      t: tick / SETTINGS.simHz,
      player,
      dir,
    }));
    const replay = runRound({ seed: 1, bots: [noopBot, noopBot], inputLog });

    assertEventLogsEqual(browserResult.log, replay.events);
  });

  test('KI-09-01 AC3: firstDivergence names the first differing tick when the golden is corrupted', () => {
    // A deep copy — the shared parsed fixture backing AC1 above must never be mutated.
    const corruptedGolden = JSON.parse(JSON.stringify(GOLDEN_NO_INPUT_ROUND));
    const tick380P1Died = corruptedGolden.findIndex(
      (/** @type {any} */ event) =>
        event.tick === 380 && event.type === EVENTS.SNAKE_DIED && event.snakeId === 'p1',
    );
    expect(tick380P1Died).toBeGreaterThanOrEqual(0);

    // Read the real value rather than assuming `CAUSES.WALL` (the committed file's own value): this test
    // must stay independent of what is actually on disk right now, because the AC3 *demonstration* — editing
    // the real golden file, per this ticket's PR — briefly puts a different value there, and a hard-coded
    // expectation here would fail a second, unrelated way while that demonstration is in progress.
    const originalCause = corruptedGolden[tick380P1Died].cause;
    const corruptedCause = originalCause === CAUSES.WALL ? CAUSES.LASER : CAUSES.WALL;
    corruptedGolden[tick380P1Died] = {
      ...corruptedGolden[tick380P1Died],
      cause: corruptedCause,
    };

    // `GOLDEN_NO_INPUT_ROUND` stands in for a correct engine's output (AC1 already proves the browser
    // produces exactly this log); `corruptedGolden` stands in for a golden file someone broke.
    const divergence = firstDivergence(GOLDEN_NO_INPUT_ROUND, corruptedGolden);
    expect(divergence).not.toBeNull();
    const found = /** @type {Divergence} */ (divergence);
    expect(found.index).toBe(tick380P1Died);
    expect(found.tick).toBe(380);
    expect(found.path).toBe('cause');
    expect(found.actual).toBe(originalCause);
    expect(found.expected).toBe(corruptedCause);
    expect(formatDivergence(found)).toBe(
      `Browser and golden diverge at event ${tick380P1Died} (tick 380): cause — browser ${JSON.stringify(originalCause)}, golden ${JSON.stringify(corruptedCause)}`,
    );
  });
});
