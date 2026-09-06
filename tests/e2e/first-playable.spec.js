// @ts-check
import { expect, test } from '@playwright/test';
import { PHASES } from '../../src/core/events.js';
import { DIRECTIONS } from '../../src/core/grid.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS } from '../../src/core/settings.js';
import { roundSeedFor } from '../../src/game/session.js';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { startMatchInPage } from './helpers.js';

/**
 * KS-03-07: the first-playable round flow, driven end to end in a real browser (`ARCHITECTURE §11`).
 *
 * Three of the ticket's five scenarios live here, all of them about what a whole round *does* rather than
 * how one frame is drawn: (a) the browser and the headless engine must agree exactly, tick for tick and
 * segment cell for segment cell; (c) a paused game must not steal simulated time; (d) a round must actually
 * end, record the right result, and hand control on to a fresh round. Scenario (b) (the reversal key) lives
 * in `input.spec.js`; the visual baselines of scenario (e) live in `gameplay.visual.spec.js`.
 *
 * **KS-05-03 rewrote how these scenarios reach a round and what they read at the end of one.** Sprint 03's
 * placeholder flow — an idle "PRESS ENTER" overlay, one round at a time, Enter for another — no longer
 * exists: the game boots into the main menu and a round is reached through match setup and the 3 · 2 · 1 · GO
 * countdown (`startMatchInPage`). Scenario (c) drives the real PAUSE state through `__kobi.pause()` /
 * `__kobi.resume()` instead of faking a `visibilitychange` with `document.hidden` overridden, and scenario
 * (d) reads the round's outcome from the machine and the match tally rather than from overlay text, because
 * the scoreboard's wording is KS-05-04's to write and KS-05-05's to assert. Nothing about *what* these
 * scenarios prove has changed.
 *
 * Every one of `__kobi`'s own calls below happens inside a single `page.evaluate()` per scripted moment
 * (never split across an `await` boundary), which is deliberate: `session.start()` keeps the real frame loop
 * running via `requestAnimationFrame` for the whole life of the page (`main.js`), and a real frame landing
 * between a `pressKey` and the `fastForward` it is meant to precede would advance the sim by a few
 * uncontrolled milliseconds — exactly the flake the tech-lead notes warn about. A synchronous callback cannot
 * be interrupted by `requestAnimationFrame`, so keeping a whole scripted step inside one `evaluate()` call
 * rules that out completely.
 *
 * What it does *not* rule out is the gap between the real `Enter` keypress that starts a round and the
 * moment our own `evaluate()` call begins running — that gap is a genuine Playwright round-trip, and the
 * background loop can tick the sim by a handful of milliseconds inside it before we ever get a chance to
 * script anything. Scenario (a) below reads `__kobi.sim.tick` as the very first thing it does inside its
 * script and replays exactly that many ticks in the Node-side sim before applying the rest of the log, so the
 * comparison holds regardless of how large that gap turns out to be on a given run — see the comment there.
 *
 * The browser side of that same catch-up, inside `pressKey`/`fastForward` scripts elsewhere in this suite
 * and in `interpolation.spec.js` and `gameplay.visual.spec.js`, is written as
 * `fastForward((targetTick - sim.tick) / simHz)` — a division that would lose a tick for the same binary-
 * float reason the Node-side comment below explains, except it is safe there: by the time any of those
 * scripts run, real frames have already left an arbitrary fraction in the *browser's* accumulator, and
 * losing a tick would need that leftover fraction to be under ~1e-13, which a real elapsed-time fraction
 * essentially never is. The Node-side replay below has no such luck — its accumulator starts at exactly 0 —
 * which is why it earns the more careful whole-tick loop instead. Keep this asymmetry in mind before
 * "fixing" one to match the other, or copying the division pattern somewhere it is not safe.
 */

/**
 * The two players in `RoundSimulation`'s own id order, with the colours the match-setup screen defaults to
 * (`session.js`). The colours change nothing about the simulation — they ride along in the snapshot for the
 * renderer — but the replay below is meant to be the same round the browser played, so it is built the same
 * way rather than nearly the same way.
 */
const PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * `__kobi.advance`'s chunking, mirrored exactly (`src/game/testHooks.js`) so the Node-side replay is fed the
 * identical sequence of `dt` values the browser feeds its own simulation.
 *
 * **This is load-bearing, and it is why issue #100 was not just a timing flake.** Since KS-06-00 the browser
 * never advances by more than `maxFrameSeconds` at a time, so `fastForward(1.9)` is not one `advance(1.9)` —
 * it is nineteen chunks whose last one is `0.09999999999999937`, because `remaining -= chunk` accumulates a
 * float residue. That leaves the chunked path a few femtoseconds short of 1.9 s, and 1.9 s at 120 Hz is
 * *exactly* 228 ticks — so one path lands a hair above the boundary and the other a hair below, and they
 * disagree by a whole tick. Reproduced deterministically:
 *
 * ```
 * one-shot   advance(1.9) + advance(0.1) -> tick 240
 * chunked at 0.1 s boundaries            -> tick 239
 * ```
 *
 * Neither is wrong. The simulation is deterministic *given a sequence of `dt`s*, which is all it ever
 * promised; what it cannot do is make two different sequences summing to nominally the same duration land on
 * the same tick when that duration sits exactly on a tick boundary. The game itself is unaffected — a real
 * browser always chunks, because `loop.js` clamps every frame — so the only thing that can see this is a test
 * comparing a chunked browser against a one-shot replay. AC2 is that test, and the fix is for it to compare
 * like with like.
 *
 * @param {RoundSimulation} sim
 * @param {number} seconds
 */
function advanceLikeTheBrowser(sim, seconds) {
  let remaining = seconds;
  while (remaining > 1e-9) {
    const chunk = Math.min(remaining, 0.1);
    sim.advance(chunk);
    remaining -= chunk;
  }
}

test.describe('KS-03-07 first playable', () => {
  test('KS-03-07 AC2: the browser and the headless sim agree exactly on segment cells', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    // **Reaching the round and playing the scripted log happen in ONE `page.evaluate` (KS-06-07, issue
    // #100).** They used to be two, and the gap between them was a real number of live `requestAnimationFrame`
    // frames — however many fitted into one Playwright round-trip. The test compensated by reading a
    // `startTick` and replaying the Node side from there, which is exact arithmetic and was still not enough,
    // because *which* tick the round starts from changes what the scripted log does:
    //
    // P1 turns UP from (5, 12) and travels eleven cells to y = 23 — the top row, **one step from the wall** —
    // and the LEFT at 1.9 s is what turns it away in time. Whether that step lands before or after the LEFT
    // depends on the gap. Measured over the plausible range, **P1 dies in 16 of the 41 gaps from 0 to 40
    // ticks**: the scenario was a coin toss weighted by how fast the machine happened to be, and on a loaded
    // two-worker CI run it came up tails.
    //
    // `startMatchInPage` leaves the round at tick 0 exactly, and JavaScript is single-threaded, so no frame
    // can run in the middle of one script. Doing both here pins the gap at zero and makes the comparison the
    // thing it was always meant to be: the browser's engine against the headless one, on an identical log,
    // with no timing left in it. (The same reasoning `gameplay.visual.spec.js`'s module comment gives for its
    // own single-script setup.)
    const browserResult = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch();
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);

      // The scripted log itself: P1 turns UP, then LEFT; P2 turns DOWN; the round is fast-forwarded a total
      // of 2 simulated seconds (the ticket's scenario (a), verbatim).
      const startTick = kobi.sim.tick;
      kobi.pressKey(1, 'UP');
      kobi.fastForward(1.9);
      kobi.pressKey(1, 'LEFT');
      kobi.pressKey(2, 'DOWN');
      kobi.fastForward(0.1);
      return { startTick, seeds: kobi.getSeeds(), snapshot: kobi.getSnapshot() };
    });

    // The gap is now zero by construction, and this says so out loud: if a frame ever does sneak in again,
    // this fails with a clear reason instead of the scenario quietly becoming a coin toss once more.
    expect(browserResult.startTick).toBe(0);

    // KS-05-03: `?seed=1` now seeds the *match*, and each round derives its own seed from it plus the round
    // index. So the replay below must be built on the round's seed, not the match's — and this asserts the
    // browser really did derive it the documented way rather than taking the test's word for it.
    expect(browserResult.seeds.matchSeed).toBe(1);
    const roundSeed = roundSeedFor(1, 0);
    expect(browserResult.seeds.roundSeeds[0]).toBe(roundSeed);

    // The Node-side replay: the same seed and players `session.js` uses, brought up to the exact same tick
    // the browser's sim was at when the script began — which is now always 0 (KS-06-07), so the catch-up loop
    // below is a no-op. It is kept rather than deleted because it is what makes the replay *say* it starts
    // where the browser started, and it costs nothing.
    //
    // Advanced one whole tick at a time rather than `advance(startTick / SETTINGS.simHz)` — that division is
    // safe on the browser side below (a real fractional accumulator absorbs the float error), but not here:
    // this sim's accumulator starts at exactly 0, so `(startTick / simHz) * simHz` landing a hair under
    // `startTick` in binary float (true for ~2% of tick counts) loses a whole tick with nothing to carry it,
    // and every later comparison is one tick out of step. `advance(sim.tickDuration)` adds ~1.0 to an
    // accumulator already below 1, so it can never overshoot the tick it is asking for.
    const sim = new RoundSimulation({ seed: roundSeed, players: PLAYERS });
    while (sim.tick < browserResult.startTick) sim.advance(sim.tickDuration);
    // A mismatch here is a broken setup, not a real disagreement — worth its own assertion so a failure says
    // that plainly instead of surfacing as a wall of unrelated segment diffs below.
    expect(sim.tick).toBe(browserResult.startTick);
    sim.applyInput('p1', DIRECTIONS.UP);
    advanceLikeTheBrowser(sim, 1.9);
    sim.applyInput('p1', DIRECTIONS.LEFT);
    sim.applyInput('p2', DIRECTIONS.DOWN);
    advanceLikeTheBrowser(sim, 0.1);
    const nodeState = sim.getState();

    const browserSnapshot = /** @type {any} */ (browserResult.snapshot);

    // The tick count itself, first: if this does not match, nothing else can either, and a mismatch here is
    // the clearest possible signal of *why* (a missed or extra tick), rather than a wall of segment diffs.
    expect(browserSnapshot.tick).toBe(nodeState.tick);
    expect(browserSnapshot.phase).toBe(nodeState.phase);
    expect(browserSnapshot.apples).toEqual(nodeState.apples);

    // Every snake's whole segment list — not just the head — is the ticket's own wording for AC2.
    expect(browserSnapshot.snakes.map((/** @type {any} */ s) => s.segments)).toEqual(
      nodeState.snakes.map((s) => s.segments),
    );
    // Direction and aliveness too: if the browser and the sim ever disagreed on these while still agreeing
    // on segments (e.g. a queued turn applied on the wrong tick but not yet visible in the cells), that would
    // be exactly the kind of near-miss AC2 exists to catch.
    expect(browserSnapshot.snakes.map((/** @type {any} */ s) => s.direction)).toEqual(
      nodeState.snakes.map((s) => s.direction),
    );
    expect(browserSnapshot.snakes.map((/** @type {any} */ s) => s.alive)).toEqual(
      nodeState.snakes.map((s) => s.alive),
    );
  });

  test('KS-03-07 scenario (c): pausing freezes the timer; resuming carries it on', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);
    // Not asserted against a fixed '1:30' here: the round clock runs in real wall-clock time from the moment
    // PLAYING starts (`timeScale` is 1, `ARCHITECTURE §5`), so exactly what it reads an instant later depends
    // on how long page load happened to take on this run. What this scenario tests is the freeze/resume
    // behaviour below, not the starting value.
    await expect(page.locator('.hud-timer')).toBeVisible();

    // KS-05-03 replaces Sprint 03's trick here. This test used to fake a `visibilitychange` with
    // `document.hidden` overridden to `true`, which leaned on `loop.js`'s hidden-tab behaviour to stop the
    // clock. The game now has a real PAUSE state that means exactly this, and `__kobi.pause()` is the
    // supported way to reach it — so the scenario tests the thing the design actually promises
    // (`DESIGN-DECISIONS §2.8`) rather than a side effect of the frame scheduler.
    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.pause();
    });
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'PAUSE',
    );

    const frozenText = await page.locator('.hud-timer').textContent();

    // There is no *thing* to poll for here — the whole point is that nothing happens — so this is the one
    // place in the suite that waits on the wall clock rather than on `__kobi.fastForward` or a locator
    // assertion. A paused game runs at `timeScale` 0, so nothing real-time-driven can advance the sim during
    // this wait; a flake here would mean that guarantee broke.
    await page.waitForTimeout(400);
    await expect(page.locator('.hud-timer')).toHaveText(/** @type {string} */ (frozenText));

    await page.evaluate(() => {
      /** @type {any} */ (globalThis).__kobi.resume();
    });

    // Now the *thing* to wait for is real: the timer text changing away from its frozen value. Playwright's
    // own polling drives this, not a fixed sleep — it resolves the moment real time has moved the timer on,
    // which is one READY? beat (`DESIGN-DECISIONS §2.8`) plus a frame or two after the resume.
    await expect(page.locator('.hud-timer')).not.toHaveText(/** @type {string} */ (frozenText));
  });

  test('KS-03-07 scenario (d): a directed wall crash ends the round, and the next one counts in', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    // P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`). Turning UP is legal (not a reversal) and,
    // left uncorrected, drives the head straight into the top wall: 12 steps from y=12 reaches y=24, one past
    // the last legal cell (`grid.height` is 24). At 6 cells/s that is exactly 2.0 simulated seconds — well
    // before P2, who gets no input at all and does not reach the opposite wall until ~3.167 s (the golden
    // no-input log's own DRAW timing, `tests/unit/core/round.test.js`). P1 dies alone, so P2 wins.
    const ended = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.pressKey(1, 'UP');
      // Three seconds carries the round past the crash at 2.0 s and past the 0.6 s crash slow-mo beat that
      // follows it (`DESIGN-DECISIONS §2.5`), which is what stands between the crash and the scoreboard.
      kobi.fastForward(3);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    // KS-05-03: the outcome is read from the machine and the match tally, not from overlay text. The
    // scoreboard's wording is KS-05-04's to write and KS-05-05's to assert; what this scenario has always
    // been about is that the round ends, and ends the right way.
    expect(ended.state).toBe('ROUND_OVER');
    expect(ended.match.wins).toEqual({ 1: 0, 2: 1 });
    expect(ended.match.roundsPlayed).toBe(1);

    // The scoreboard stands for `scoreboardSeconds` and then the next round counts itself in (`§2.6`).
    const fresh = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(3);
      const afterScoreboard = kobi.getState();
      // KS-06-00: `fastForward` advances in frame-sized chunks now (#84), so the countdown is played out
      // by stepping until it hands the round over, rather than by one fixed 3.21 s call — which would spill
      // its last hundredth of a second into the round and start it at tick 1 instead of tick 0. The bound is
      // nearly twice the countdown's own 3.2 s, so it can only be reached if the countdown is truly stuck.
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)
      return { afterScoreboard, state: kobi.getState(), snapshot: kobi.getSnapshot() };
    });

    expect(fresh.afterScoreboard).toBe('COUNTDOWN');
    expect(fresh.state).toBe('PLAYING');
    // "Fresh round" is checked through the sim's own state rather than the HUD's `m:ss` text: the clock runs
    // in real wall-clock time from the instant PLAYING starts (see the note above), so the *displayed* text a
    // moment later is not reliably '1:30' — but the fresh `RoundSimulation` starts every snake back at
    // `startingSnakeLength`, which is what "a new round" actually means and does not depend on how fast this
    // test happened to run.
    expect(fresh.snapshot.phase).toBe(PHASES.PLAYING);
    for (const snake of fresh.snapshot.snakes) {
      expect(snake.length).toBe(SETTINGS.startingSnakeLength);
    }
  });

  test('KS-03-07 scenario (d): the no-input round still lands on the golden DRAW at t ≈ 3.167 s', async ({
    page,
  }) => {
    // The second, un-directed case the tech-lead notes ask to keep alongside the crash above: with no input
    // at all, both snakes charge straight into opposite walls on the same tick (the golden log in
    // `tests/unit/core/round.test.js`), which is a DRAW. Proving this in the browser too pins the golden
    // log's timing end-to-end, not just inside the headless engine.
    await page.goto(DEFAULT_QUERY);
    await page.evaluate(startMatchInPage);

    const ended = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.fastForward(4);
      return { state: kobi.getState(), match: kobi.getMatch() };
    });

    expect(ended.state).toBe('ROUND_OVER');
    // A draw is played but never scored, and the match replays the round (`DESIGN-DECISIONS §2.5` row 7).
    expect(ended.match.roundsPlayed).toBe(1);
    expect(ended.match.wins).toEqual({ 1: 0, 2: 0 });
    expect(ended.match.isOver).toBe(false);
  });
});
