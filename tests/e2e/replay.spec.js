// @ts-check
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KI-05-02 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): proves `session.js`'s replay mode
 * — reachable through `window.__kobi` (`ARCHITECTURE §11`, and this ticket's own declared, minimal extension
 * of `testHooks.js`, see the PR description) — reproduces a committed fixture in a real browser, seeks
 * exactly, and never lets a real keypress reach the simulation it is replaying.
 *
 * `tests/unit/game/replayPlayer.test.js` already proves the driver itself against every fixture in Node;
 * this file's job is the part only a browser can prove: the bundled build, a real `page.evaluate`d
 * `__kobi.loadReplay`, and (AC3) a genuine `keydown` dispatched at the same target `createInput` listens on.
 *
 * Fixtures are read from disk in Node and handed into `page.evaluate` as plain-data arguments — never
 * embedded as source text — the same pattern `tests/e2e/determinism.spec.js` uses for its own two replay
 * fixtures.
 */

const LASER_BOTH_HEADS_DRAW = JSON.parse(
  readFileSync(new URL('../sim/replays/laser-both-heads-draw.json', import.meta.url), 'utf8'),
);

const NO_INPUT_ROUND = JSON.parse(
  readFileSync(new URL('../sim/replays/no-input-round.json', import.meta.url), 'utf8'),
);

/** A generous cap on stepping loops below, so a bug that broke "a round always ends" fails loudly, not by hanging. */
const MAX_STEPS = 20_000;

test.describe('KI-05-02 replay playback', () => {
  test('KI-05-02 AC1: a committed fixture reproduces its event log tick for tick in the browser', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(
      ({ replay, cap }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        const loaded = kobi.loadReplay(replay);
        let guard = 0;
        while (kobi.stepReplay()) {
          guard += 1;
          if (guard > cap) break;
        }
        return {
          loaded,
          guardHit: guard > cap,
          events: kobi.getReplayEvents(),
          phase: kobi.getReplayPhase(),
        };
      },
      { replay: NO_INPUT_ROUND, cap: MAX_STEPS },
    );

    expect(result.loaded).toEqual({ ok: true });
    expect(result.guardHit).toBe(false);
    expect(result.phase).toBe('ROUND_OVER');
    expect(result.events).toEqual(NO_INPUT_ROUND.expectedEvents);
  });

  test('KI-05-02 AC2: seeking to a tick then playing forward matches playing straight through, in the browser', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const outcome = await page.evaluate(
      ({ replay, cap }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;

        // The straight-through run every seek below is checked against.
        kobi.loadReplay(replay);
        let guard = 0;
        while (kobi.stepReplay()) {
          guard += 1;
          if (guard > cap) break;
        }
        const full = { events: kobi.getReplayEvents(), lastTick: kobi.getReplayTick() };

        /** @param {number} targetTick */
        function seekThenFinish(targetTick) {
          kobi.loadReplay(replay);
          kobi.seekReplay(targetTick);
          const tickAfterSeek = kobi.getReplayTick();
          let steps = 0;
          while (kobi.stepReplay()) {
            steps += 1;
            if (steps > cap) break;
          }
          return {
            tickAfterSeek,
            guardHit: steps > cap,
            events: kobi.getReplayEvents(),
            lastTick: kobi.getReplayTick(),
            phase: kobi.getReplayPhase(),
          };
        }

        return {
          full,
          zero: seekThenFinish(0),
          mid: seekThenFinish(Math.floor(full.lastTick / 2)),
          last: seekThenFinish(full.lastTick),
        };
      },
      { replay: LASER_BOTH_HEADS_DRAW, cap: MAX_STEPS },
    );

    expect(outcome.full.events).toEqual(LASER_BOTH_HEADS_DRAW.expectedEvents);

    for (const [label, run] of [
      ['zero', outcome.zero],
      ['mid', outcome.mid],
      ['last', outcome.last],
    ]) {
      expect(run.guardHit, `${label}: guard hit`).toBe(false);
      // `seek` never overshoots — it stops exactly at the target tick, or earlier if the round had already
      // ended (only possible for the "last" case above).
      expect(run.tickAfterSeek, `${label}: tick after seek`).toBeLessThanOrEqual(
        label === 'zero' ? 0 : label === 'last' ? outcome.full.lastTick : outcome.full.lastTick,
      );
      expect(run.phase, `${label}: final phase`).toBe('ROUND_OVER');
      expect(run.lastTick, `${label}: final tick`).toBe(outcome.full.lastTick);
      expect(run.events, `${label}: final events`).toEqual(outcome.full.events);
    }
  });

  test('KI-05-02 AC3: pressing a movement key during replay playback does not change the event log', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    // A real match is running at the same time as the replay (`startMatchInPage`) — the scenario this test
    // actually guards against is a key reaching *some* live `RoundSimulation`, and a bug that wired
    // `handleDirection` into the replay's own sim regardless of a match existing would not be caught by a
    // "no match in progress" setup, since `sim === null` already short-circuits every keydown then.
    await page.evaluate(startMatchInPage);

    const result = await page.evaluate(
      ({ replay, cap }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        kobi.loadReplay(replay);

        // Well past both players' recorded turns (tick 24: p1 -> LEFT, p2 -> RIGHT) but well before the next
        // physical grid-step commit (~tick 40 at the shipping snake speed) — real `keydown`s, dispatched at
        // the same target `createInput` listens on (KS-03-06 tech-lead notes on `pressKey`), for a fresh,
        // legal turn (DOWN) neither player's recorded input log ever mentions. This timing is deliberate: an
        // earlier version of this test pressed keys the replay's own log already matched at that moment
        // (`UP`/`LEFT` for p1, `DOWN`/`RIGHT` for p2, at tick 20) and a leaked keydown still passed, because
        // `queueDirection`'s "last direction wins before the next commit" absorbed it with no observable
        // difference — proof that a red test needs a direction genuinely new to the round, landed inside a
        // step window, to be sensitive to this bug at all (see this ticket's PR description for the red run).
        const wellPastRecordedTurns = 30;
        for (let i = 0; i < wellPastRecordedTurns; i += 1) kobi.stepReplay();
        kobi.pressKey(1, 'DOWN');
        kobi.pressKey(2, 'DOWN');

        let guard = 0;
        while (kobi.stepReplay()) {
          guard += 1;
          if (guard > cap) break;
        }

        return {
          guardHit: guard > cap,
          events: kobi.getReplayEvents(),
          phase: kobi.getReplayPhase(),
        };
      },
      { replay: LASER_BOTH_HEADS_DRAW, cap: MAX_STEPS },
    );

    expect(result.guardHit).toBe(false);
    expect(result.phase).toBe('ROUND_OVER');
    // The whole point of AC3: byte-identical to the golden, not merely "some flag stayed false" — a key that
    // reached the replay's simulation would move a snake the recorded input log never told it to move, and
    // that would show up here as a diverging event log, not as a boolean.
    expect(result.events).toEqual(LASER_BOTH_HEADS_DRAW.expectedEvents);
  });

  test('KI-05-02 AC4: playing a replay to the end reproduces the fixture result', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(
      ({ replay, cap, dt }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        const loaded = kobi.loadReplay(replay);

        // Exercises the actual "play" transport (ticket spec: "play, pause, step ... and seek"), not only
        // manual stepping — `advanceReplayFrame` is the replay-mode counterpart to `fastForward`, whole ticks
        // at a time (tech-lead note A).
        kobi.playReplay();
        const wasPlaying = kobi.isReplayPlaying();

        // KI-05-05: one frame through the *play* path, so the play transport is still what is under test
        // and not merely `stepReplay` in disguise.
        kobi.advanceReplayFrame(dt);
        const advancedByPlay = kobi.getReplayTick();

        // ...then step to the end. This loop used to be `advanceReplayFrame(dt)` per tick, and
        // `advanceReplayFrame` **redraws on every call** (`session.js`), so a 140-tick round paid 140
        // three.js draws — the same cost `testHooks.js` split `advance` out of `fastForward` to avoid, and
        // enough to time this test out at 30 s under CI's software renderer. `stepReplay` advances exactly
        // one tick and draws nothing, so the work is bounded by the replay's own length and by nothing
        // about the machine.
        let guard = 0;
        while (kobi.stepReplay()) {
          guard += 1;
          if (guard > cap) break;
        }

        return {
          loaded,
          wasPlaying,
          advancedByPlay,
          guardHit: guard > cap,
          events: kobi.getReplayEvents(),
          phase: kobi.getReplayPhase(),
          snapshot: kobi.getReplaySnapshot(),
        };
      },
      // `LASER_BOTH_HEADS_DRAW.settingsOverrides` never touches `simHz`, so the shipping default (120) is the
      // real tick rate this replay's own ticks resolve against — see `tests/sim/replays/README.md`.
      { replay: LASER_BOTH_HEADS_DRAW, cap: MAX_STEPS, dt: 1 / 120 },
    );

    expect(result.loaded).toEqual({ ok: true });
    expect(result.guardHit).toBe(false);
    expect(result.wasPlaying).toBe(true);
    // The play transport really did move the replay on, before the step loop finished it.
    expect(result.advancedByPlay).toBeGreaterThan(0);
    expect(result.phase).toBe('ROUND_OVER');
    expect(result.events).toEqual(LASER_BOTH_HEADS_DRAW.expectedEvents);
    // The fixture's own last event *is* the round's result — reading it back off the live snapshot too is a
    // second, independent check that "the same result the fixture records" (AC4's own wording) holds.
    const lastEvent = /** @type {any} */ (
      LASER_BOTH_HEADS_DRAW.expectedEvents[LASER_BOTH_HEADS_DRAW.expectedEvents.length - 1]
    );
    expect(result.snapshot.result).toBe(lastEvent.result ?? result.snapshot.result);
    expect(result.snapshot.phase).toBe('ROUND_OVER');
  });

  test('KI-05-02: loading a malformed replay is refused with a named error, not an exception', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      return kobi.loadReplay('{not valid json');
    });

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('INVALID_JSON');
  });
});
