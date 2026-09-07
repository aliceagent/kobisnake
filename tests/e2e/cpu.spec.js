// @ts-check
import { expect, test } from '@playwright/test';
import { greedy } from '../../src/game/bots/greedy.js';
import { survivor } from '../../src/game/bots/survivor.js';

/**
 * KI-12-02 — driving a CPU player through the input queue, proved against the real, bundled browser build.
 *
 * `tests/unit/game/cpuPlayer.test.js` already proves this ticket's three acceptance criteria in Node, in
 * detail — this file's job is narrower and different in kind: it proves the *same* three claims hold when
 * the CPU is driven through `window.__kobi` (`src/game/testHooks.js`) against the actual compiled bundle,
 * the same way `tests/e2e/determinism.spec.js` proves the core simulation itself in a browser rather than
 * only in Node.
 *
 * ## `__kobi.setCpuPlayer` — a declared, minimal addition outside this ticket's `Files:` list
 *
 * `session.js`'s own `setCpuPlayer` had no way to reach the page before this file needed one: KI-12-04 (the
 * match-setup switch) is the ticket that will eventually call it from a screen, but it has not landed, and
 * nothing else in `main.js` wires a CPU in yet. `src/game/testHooks.js` gained a two-line passthrough (see
 * its own doc comment on `setCpuPlayer`) — the same shape as every other `session.js` method it already
 * forwards (`pause`, `resume`, `setSeed`, ...) — because that is the one, and only, way an e2e spec can reach
 * a real `session.js` at all. Declared here, and in this ticket's PR description, per `CLAUDE.md`'s "never
 * touch files outside your ticket's `Files:` list without saying so".
 *
 * ## Shipping a policy into the page
 *
 * `src/game/bots/policy.js`'s module doc lays out the constraint this file leans on: a policy is a single
 * self-contained function with no free variables, precisely so `tests/agent/driver.js` can ship one into a
 * page as source text. `greedy` and `survivor` are imported here on the **Node** side purely to read their
 * `.toString()` — neither ever runs in Node — and `page.evaluate` compiles the source inside the browser with
 * `new Function`, the identical trick `driver.js` uses for the same reason.
 *
 * ## One `page.evaluate` per scenario
 *
 * Exactly `determinism.spec.js`'s own reasoning: `main.js` keeps a real `requestAnimationFrame` loop running
 * for the life of the page, so a frame landing between two `evaluate` round-trips could advance (or even
 * pause) the round out from under a script split across two calls. Every scenario below starts a match,
 * drives it, and reads back everything it needs inside one synchronous callback.
 */

/** Wall seconds a driven frame advances by — small enough that a grid step (≈ 0.167 s at the shipping speed) is never skipped over, matching `tests/agent/driver.js`'s own reasoning for its `FRAME_SECONDS`. */
const FRAME_SECONDS = 1 / 30;

/** A generous cap on driven frames before a scenario below gives up, rather than hangs, on a stuck round. */
const FRAME_CAP = 6000;

/**
 * Plays one whole CPU-vs-CPU round (bestOf 1, so the match ends the moment the round is decided) inside a
 * fresh page load, and hands back its full event log plus how the round ended.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{seed: number, policy1Source: string, policy2Source: string}} args
 */
async function playCpuRoundInPage(page, { seed, policy1Source, policy2Source }) {
  await page.goto('?test=1&reducedFx=1');
  return page.evaluate(
    ({ seed, policy1Source, policy2Source, frameSeconds, cap }) => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      const compile = (/** @type {string} */ src) => new Function('return (' + src + ')')();

      kobi.setCpuPlayer(1, compile(policy1Source));
      kobi.setCpuPlayer(2, compile(policy2Source));
      kobi.setSeed(seed);
      kobi.startMatch({ bestOf: 1 });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);

      const sim = kobi.sim;
      // The constructor's own opening `FOOD_SPAWNED`s, captured first — `session.js`'s own `roundEventLog`
      // and `tests/sim/harness.js`'s `runRound` both seed their logs the same way.
      const log = [...sim.events];
      const innerAdvance = sim.advance.bind(sim);
      sim.advance = (/** @type {number} */ dt) => {
        const events = innerAdvance(dt);
        log.push(...events);
        return events;
      };

      let guard = 0;
      while (sim.phase === 'PLAYING' && guard < cap) {
        kobi.advance(frameSeconds);
        guard += 1;
      }

      return {
        log,
        guardHit: guard >= cap,
        phase: sim.phase,
        result: sim.result,
        state: kobi.getState(),
        match: kobi.getMatch(),
      };
    },
    { seed, policy1Source, policy2Source, frameSeconds: FRAME_SECONDS, cap: FRAME_CAP },
  );
}

test.describe('KI-12-02 AC1', () => {
  test('KI-12-02 AC1: a CPU-vs-CPU match on a fixed seed produces an identical event log on two runs, in the real browser build', async ({
    page,
  }) => {
    const args = {
      seed: 913_047,
      policy1Source: greedy.toString(),
      policy2Source: survivor.toString(),
    };

    const runA = await playCpuRoundInPage(page, args);
    expect(runA.guardHit).toBe(false);
    expect(runA.log.length).toBeGreaterThan(0);

    const runB = await playCpuRoundInPage(page, args);

    expect(runB.log).toEqual(runA.log);
    expect(runB.result).toBe(runA.result);
    expect(runB.match).toEqual(runA.match);
  });
});

test.describe('KI-12-02 AC2', () => {
  test('KI-12-02 AC2: a reversal is rejected for a CPU exactly as it is for a human, through the real keyboard-fed queue', async ({
    page,
  }) => {
    // P1 spawns at (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); LEFT is its exact reverse.
    const alwaysReverse = () => 'LEFT';

    await page.goto('?test=1&reducedFx=1');
    const cpuQueue = await page.evaluate(
      ({ policySource }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        kobi.setCpuPlayer(1, new Function('return (' + policySource + ')')());
        kobi.startMatch();
        for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
        kobi.fastForward(0);
        // A few grid steps: however many decisions the CPU is asked for, every one of them attempts the
        // same rejected reversal, so the queue must stay empty throughout.
        for (let i = 0; i < 30; i += 1) kobi.advance(1 / 30);
        return kobi.sim.snakes[0].queue;
      },
      { policySource: alwaysReverse.toString() },
    );

    await page.goto('?test=1&reducedFx=1');
    const humanQueue = await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch();
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);
      kobi.pressKey(1, 'LEFT'); // player 1's LEFT key: the identical reversal, from `input.js` itself.
      return kobi.sim.snakes[0].queue;
    });

    expect(cpuQueue).toEqual([]);
    expect(humanQueue).toEqual([]);
    expect(cpuQueue).toEqual(humanQueue);
  });
});

test.describe('KI-12-02 AC3', () => {
  test('KI-12-02 AC3: PAUSE stops the CPU — its policy is never even consulted, and nothing is enqueued', async ({
    page,
  }) => {
    await page.goto('?test=1&reducedFx=1');
    const result = await page.evaluate(
      ({ policySource, frameSeconds }) => {
        const kobi = /** @type {any} */ (globalThis).__kobi;
        const compiled = new Function('return (' + policySource + ')')();
        let calls = 0;
        // Wrapped rather than passed straight through: this is the only way to count "was the policy asked
        // at all" from inside one synchronous script, without adding anything to `__kobi` for it.
        kobi.setCpuPlayer(1, (/** @type {any} */ view) => {
          calls += 1;
          return compiled(view);
        });
        kobi.startMatch();
        for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
        kobi.fastForward(0);

        for (let i = 0; i < 30; i += 1) kobi.advance(frameSeconds);
        const callsBeforePause = calls;

        kobi.pause();
        const stateAfterPause = kobi.getState();
        const tickAtPause = kobi.sim.tick;

        // Plenty of wall time, all of it frozen.
        for (let i = 0; i < 150; i += 1) kobi.advance(frameSeconds);

        return {
          callsBeforePause,
          callsWhilePaused: calls,
          stateAfterPause,
          tickAtPause,
          tickAfterIdle: kobi.sim.tick,
          stateAfterIdle: kobi.getState(),
        };
      },
      { policySource: greedy.toString(), frameSeconds: FRAME_SECONDS },
    );

    expect(result.callsBeforePause).toBeGreaterThan(0);
    expect(result.stateAfterPause).toBe('PAUSE');
    // Not merely ignored: never asked again while paused.
    expect(result.callsWhilePaused).toBe(result.callsBeforePause);
    expect(result.tickAfterIdle).toBe(result.tickAtPause);
    expect(result.stateAfterIdle).toBe('PAUSE');
  });
});
