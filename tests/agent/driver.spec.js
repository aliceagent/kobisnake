// @ts-check
import { expect, test } from '@playwright/test';
import { playMatch } from './driver.js';
import { survivor } from './policies/survivor.js';

/**
 * The driver's **browser-side** seams — the half of `driver.js` that `driver.test.js` cannot reach.
 *
 * `driver.test.js` covers this module's pure functions in Node. `runMatchInPage` is not one of them: it is
 * shipped into the page as source text (`driver.js`'s header explains why) and only ever executes inside a
 * real match, so nothing in Node can assert what it builds or what it hands `__kobi`. That gap is exactly
 * what let **#291** through — `playMatch({ powerUpsEnabled })` wrote `overrides.powerUps`, a key
 * `session.js` merges into `matchSettings` and nobody ever reads, so the documented way to turn power-ups
 * off for a measurement played with them on and reported success.
 *
 * This file is where a claim about the driver that can only be proved by playing a match goes.
 */

/** The one round each arm below plays is a Best-of-1, so the match ends when it does. */
const BEST_OF = 1;

/**
 * One render every 40 simulated seconds, the same sparse cadence `playtest.spec.js`'s ten-match run uses and
 * for the same reason: rendering is the entire wall-clock cost of this layer and nothing here is about
 * pixels. Two arms at this cadence add a couple of seconds to `npm run test:agent`.
 */
const RENDER_EVERY_N_FRAMES = 2400;

/**
 * A per-frame observer in the shape `playMatch`'s `invariants` option takes — **one self-contained function
 * with no free variables**, because the driver serialises it into the page (`driver.js`'s header, ruling 3
 * on #122).
 *
 * It reports one "problem" per frame on which a power-up pickup is on the board, which makes
 * `MatchResult.problemCount` a count of pickup sightings. That is not an invariant in `invariants.js`'s
 * sense — nothing here derives from a design rule — it is the cheapest honest way to get a per-frame
 * observation back out of a driven match, and it is deliberately local to this file so
 * `invariants.js` keeps meaning "the checks a real run fails on".
 *
 * `snapshot.powerUps` is `{pickups: [{cell, type}]}`, not an array (`tests/agent/README.md`).
 *
 * @param {{snapshot: object}} input
 * @returns {{rule: string, detail: string}[]}
 */
function sightPickups(input) {
  const snapshot = /** @type {any} */ (input.snapshot);
  const pickups = snapshot.powerUps?.pickups ?? [];
  if (pickups.length === 0) return [];
  return [
    {
      rule: 'power-up pickup on the board',
      detail: `${pickups.length} pickup(s) at tick ${snapshot.tick}`,
    },
  ];
}

/** One Best-of-1 of survivor vs survivor on `seed`, counting the frames a pickup was on the board. */
function playCountingPickups(page, seed, powerUpsEnabled) {
  return playMatch(page, {
    seed,
    bestOf: BEST_OF,
    powerUpsEnabled,
    policy1: survivor,
    policy2: survivor,
    invariants: sightPickups,
    renderEveryNFrames: RENDER_EVERY_N_FRAMES,
  });
}

test.describe('tests/agent/driver.js · the in-page half', () => {
  test('#291: playMatch({powerUpsEnabled}) reaches the simulation, in both directions', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Two survivors keep a round alive well past `powerUpFirstSpawnAt` (75 s remaining of a 90 s round, so
    // 15 s in) — KI-03-02 AC2 measured survivor past 0:30 on 100 % of its sample. The seed is fixed, so
    // both arms play the identical round up to the point the setting changes it.
    const withPowerUps = await playCountingPickups(page, 1, true);
    const withoutPowerUps = await playCountingPickups(page, 1, false);

    // The positive arm first, because it is what makes the negative arm's zero mean anything: without it,
    // "no pickup was ever seen" is equally well explained by a round that ended before the first spawn.
    expect(withPowerUps.pageErrors).toEqual([]);
    expect(withPowerUps.finished).toBe(true);
    expect(withPowerUps.problemCount).toBeGreaterThan(0);

    // And the negative arm: not one frame of the round had a pickup on the board. Before the fix this was
    // the arm that failed — the stray `powerUps` key changed nothing and the round played with the
    // match-setup default, which ships on.
    expect(withoutPowerUps.pageErrors).toEqual([]);
    expect(withoutPowerUps.finished).toBe(true);
    expect(withoutPowerUps.problemCount).toBe(0);

    console.log(
      `#291: powerUpsEnabled true → ${withPowerUps.problemCount} pickup-frames over ` +
        `${withPowerUps.frames} frames; false → ${withoutPowerUps.problemCount} over ` +
        `${withoutPowerUps.frames}`,
    );
  });
});
