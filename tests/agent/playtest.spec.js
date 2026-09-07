import { expect, test } from '@playwright/test';
import {
  DEFAULT_MAX_FRAMES,
  FRAME_SECONDS,
  RENDER_EVERY_N_FRAMES,
  failureReasons,
  playMatch,
} from './driver.js';

/**
 * KI-03-01 — the driver's own suite: ten seeded Best-of-3 matches of the built site, played end to end.
 *
 * This file is what `npm run test:agent` runs. KI-03-02 replaces {@link smokePolicy} below with the real
 * greedy / survivor / idle policies and adds their own scenarios; KI-03-03 hands the driver its invariants
 * module; KI-03-04 turns a run of this file into the committed report. Until they land, the ten matches are
 * driven by the smallest policy that produces a *finishing* match, because a driver with nothing to drive
 * proves nothing.
 */

/** The ten seeds AC1 names. Fixed here, and quoted by every report, so a failure is replayable (KI-03-05). */
export const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];

/** AC1's budget for the ten matches, wall clock, on CI. */
const TEN_MATCH_BUDGET_MS = 60_000;

/**
 * A placeholder policy, and deliberately the smallest one that works: head for the nearest apple, refuse a
 * cell that is off the board, inside the laser dead zone, or occupied by a living snake.
 *
 * **KI-03-02 owns the real policies** (`tests/agent/policies/`) and deletes this. It is here only so
 * KI-03-01's own acceptance criteria — ten matches that finish, deterministically, inside a budget — can be
 * proved by the ticket that adds the driver rather than by the one after it. It is not tuned, not tested and
 * not a design instrument; no statistic should ever be quoted from it.
 *
 * Self-contained by necessity: the driver ships it into the page as source text, so it may not reference
 * anything outside its own body (see `driver.js`'s header).
 *
 * @param {import('./driver.js').PolicyView} view
 * @returns {import('./driver.js').PolicyMove}
 */
export function smokePolicy(view) {
  const { snapshot, playerIndex, grid } = view;
  const me = snapshot.snakes[playerIndex];
  if (me === undefined || !me.alive) return null;
  const head = me.segments[0];
  const deltas = {
    UP: { dx: 0, dy: 1 },
    DOWN: { dx: 0, dy: -1 },
    LEFT: { dx: -1, dy: 0 },
    RIGHT: { dx: 1, dy: 0 },
  };
  const inset = snapshot.lasers.inset;
  const occupied = new Set();
  for (const snake of snapshot.snakes) {
    if (!snake.alive) continue;
    for (const cell of snake.segments) occupied.add(cell.x + ',' + cell.y);
  }
  const apples = snapshot.apples.filter((apple) => apple !== null);
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const target =
    apples.length === 0
      ? head
      : apples.reduce((best, apple) =>
          distance(apple, head) < distance(best, head) ? apple : best,
        );

  let best = null;
  for (const name of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    const delta = deltas[name];
    if (delta.dx === -me.direction.dx && delta.dy === -me.direction.dy) continue;
    const next = { x: head.x + delta.dx, y: head.y + delta.dy };
    if (next.x < inset || next.y < inset) continue;
    if (next.x > grid.width - 1 - inset || next.y > grid.height - 1 - inset) continue;
    if (occupied.has(next.x + ',' + next.y)) continue;
    const score = -distance(target, next);
    if (best === null || score > best.score) best = { score, name };
  }
  return best === null ? null : best.name;
}

/** One Best-of-3 on `seed`, both players driven by {@link smokePolicy}. */
function playSmokeMatch(page, seed) {
  return playMatch(page, { seed, bestOf: 3, policy1: smokePolicy, policy2: smokePolicy });
}

test.describe('KI-03-01 · the agent playtest driver', () => {
  test('KI-03-01 AC1: ten seeded Best-of-3 matches all finish, inside the budget', async ({
    page,
  }) => {
    test.setTimeout(TEN_MATCH_BUDGET_MS * 3);
    const startedAt = Date.now();
    /** @type {import('./driver.js').MatchResult[]} */
    const results = [];
    for (const seed of SEEDS) results.push(await playSmokeMatch(page, seed));
    const totalMs = Date.now() - startedAt;

    // AC3's three clauses in one assertion, so a failure reads as the reason rather than as `false !== true`.
    expect(failureReasons(results).join('\n')).toBe('');
    expect(results.every((result) => result.finished)).toBe(true);
    expect(results.every((result) => result.rounds.length >= 2)).toBe(true);

    // `ARCHITECTURE §12`: ≤ 120 draw calls during PLAYING. Free to check while we are here, and it is the
    // budget #119 measured at 14–22.
    expect(Math.max(...results.map((result) => result.maxDrawCalls))).toBeLessThanOrEqual(120);

    // Every match walks the real flow, not a shortcut into a round.
    for (const result of results) {
      expect(result.statesVisited).toEqual(
        expect.arrayContaining(['COUNTDOWN', 'PLAYING', 'ROUND_OVER', 'MATCH_OVER']),
      );
    }

    console.log(
      `KI-03-01 AC1: ${SEEDS.length} Best-of-3 matches in ${totalMs} ms ` +
        `(${results.reduce((sum, r) => sum + r.rounds.length, 0)} rounds, ` +
        `${results.reduce((sum, r) => sum + r.frames, 0)} frames, ` +
        `${results.reduce((sum, r) => sum + r.renders, 0)} renders)`,
    );
    expect(totalMs).toBeLessThan(TEN_MATCH_BUDGET_MS);
  });

  test('KI-03-01 AC1: the same seed replays identically', async ({ page }) => {
    test.setTimeout(120_000);
    const first = await playSmokeMatch(page, 4242);
    const second = await playSmokeMatch(page, 4242);
    expect(second.rounds).toEqual(first.rounds);
    expect(second.match).toEqual(first.match);
    expect(second.frames).toBe(first.frames);
  });

  test('KI-03-01 AC2: the simulation, input and HUD run on every frame, rendered or not', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // The constant is named and exported, and one render every 240 frames at 1/60 s is one every four
    // simulated seconds — the cadence, stated as a fact the test can check rather than as a comment.
    expect(RENDER_EVERY_N_FRAMES).toBe(240);
    expect(RENDER_EVERY_N_FRAMES * FRAME_SECONDS).toBeCloseTo(4, 10);

    await page.goto('/?test=1&seed=1');
    await page.waitForFunction(() => Boolean(globalThis.__kobi));
    const observed = await page.evaluate(() => {
      const kobi = globalThis.__kobi;
      const doc = globalThis.document;
      const readHud = () => ({
        timer: doc.querySelector('.hud-timer')?.textContent ?? null,
        p1: doc.querySelector('.hud-player--p1')?.textContent ?? null,
      });
      kobi.startMatch({ bestOf: 1 });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      const before = { tick: kobi.getSnapshot().tick, hud: readHud(), draws: kobi.getDrawCalls() };
      // Two simulated seconds of *unrendered* frames, and a turn pressed in the middle of them.
      for (let i = 0; i < 60; i += 1) kobi.advance(1 / 60);
      kobi.pressKey(1, 'UP');
      for (let i = 0; i < 60; i += 1) kobi.advance(1 / 60);
      const after = { tick: kobi.getSnapshot().tick, hud: readHud(), draws: kobi.getDrawCalls() };
      return { before, after, direction: kobi.getSnapshot().snakes[0].direction };
    });

    // Simulation ran: 2 s at 120 Hz.
    expect(observed.after.tick - observed.before.tick).toBe(240);
    // The HUD was written, with no render in between (`ARCHITECTURE §8`'s 10 Hz throttle is wall time, and
    // `runUpdate` accumulates it whether or not a frame is drawn).
    expect(observed.after.hud.timer).not.toBe(observed.before.hud.timer);
    // Input was accepted through the real `keydown` listener.
    expect(observed.direction).toEqual({ dx: 0, dy: 1 });
    // And nothing was drawn: three's counter is per-render, so an unrendered stretch cannot move it.
    expect(observed.after.draws).toBe(observed.before.draws);
  });

  test('KI-03-01 AC3: a match that does not finish is reported, not hung', async ({ page }) => {
    test.setTimeout(120_000);
    // The frame budget is what makes an unfinishable match a *failure* rather than a hang — which is not
    // hypothetical: two idle players draw every round and the match never ends on this build (#119 F1,
    // `DESIGN-DECISIONS §1 row 26`, I01/#120). 600 frames is ten simulated seconds: not enough for a match.
    const result = await playMatch(page, {
      seed: 1,
      bestOf: 3,
      policy1: smokePolicy,
      policy2: smokePolicy,
      maxFrames: 600,
    });
    expect(result.finished).toBe(false);
    expect(result.frames).toBe(600);
    expect(failureReasons([result]).join('\n')).toContain('did not finish');
    expect(failureReasons([result]).join('\n')).toContain('seed 1');
    expect(DEFAULT_MAX_FRAMES).toBeGreaterThan(600);
  });
});
