// @ts-check
import { expect, test } from '@playwright/test';
import { DEFAULT_QUERY } from '../../playwright.config.js';
import { crashPlayerOneInPage } from './helpers.js';

/**
 * KS-06-03: match-setup toggle and practice wiring.
 *
 * This ticket's own tech-lead notes found the wiring already real as of KS-06-01: the MATCH_SETUP POWER-UPS
 * row already calls `togglePowerUps` (`src/ui/screens/matchSetup.js`), `session.js` already defaults
 * `matchSettings.powerUpsEnabled` from `SETTINGS.powerUpsEnabled` (`true`) and already carries it — as a
 * closure variable nothing but the setup screen's own `onChange` ever reassigns — into every
 * `new RoundSimulation({ powerUpsEnabled: ... })`. So this file is proof, not plumbing: it exercises the row,
 * the persistence, and the one acceptance criterion the ticket actually asks for, through the real screens
 * and the real simulation rather than by re-reading the source.
 *
 * `tests/e2e/powerups-toggle.spec.js` is new — not on this ticket's `Files:` list — which is this ticket's
 * one declared deviation (`CLAUDE.md`: "never touch files outside your ticket's Files list without saying
 * so"); `matchSetup.js` and `session.js` are on the list.
 *
 * **Why the AC1/positive-control scenario below is not decided by polling `getSnapshot().powerUps.pickups`.**
 * `pickups` is a snapshot of *right now*; a spec that polls it can only ever prove "a pickup existed at the
 * moment I looked", never "nothing spawned in between two looks" or "exactly three spawns happened, at these
 * three ticks" — which is what AC1's "no power-up events" and the tech-lead's positive control ("spawns at
 * 75, 60 and 45s remaining, none at 30") actually ask for. `RoundSimulation.advance` already returns every
 * event it produced on that call, so {@link runPowerupTimelineScenario} reassigns the live instance's own
 * `advance` (an own-property override shadows the prototype method `session.js` would otherwise call) to
 * record what it returns before handing it back unchanged. `session.js` still calls the exact same object,
 * the exact same way — this only *observes*, it changes nothing about how the round runs. That is the
 * tech-lead's "subscribe by wrapping the sim" option.
 *
 * **Why this is a genuinely full round and not a few seconds.** Neither snake ever gets any input by
 * default, and both spawn twelve-or-so cells from a wall in their spawn direction — a real round without
 * steering crashes in about three simulated seconds. Reaching 45 s remaining, let alone 30 s remaining
 * (`DESIGN-DECISIONS §2.4`'s spawn timeline, ticket note), needs both snakes deliberately kept alive for far
 * longer than that. Rather than re-deriving a safe patrol, {@link runPowerupTimelineScenario} reuses
 * `laser.spec.js`'s own boxed patrol verbatim (same legs, same two boxes: P1 loops x:[4,11] y:[4,11], P2
 * loops x:[14,21] y:[14,21]) — that file already checked, empirically, against the real `RoundSimulation`
 * under this suite's default `?seed=1`, that both snakes survive the identical schedule through t = 66 s
 * elapsed. This file only needs t = 62 s (past the last spawn at 45 s remaining, and past the "none at 30 s
 * remaining" checkpoint at t = 60 s), comfortably inside that already-proven span.
 */

/**
 * Plays a round out from a fresh `startMatch` far enough to see the whole power-up spawn timeline, recording
 * every event `sim.advance` produces along the way (see the module doc comment above for why). Runs entirely
 * inside one `page.evaluate()` call, and is entirely self-contained (no closures over this file's scope,
 * `helpers.js`'s own convention) since Playwright serialises it into the page.
 *
 * @param {{powerUpsEnabled: boolean, targetElapsedSeconds: number}} args
 * @returns {{
 *   initialEnabled: boolean,
 *   spawnTimes: number[],
 *   powerUpEventTypes: string[],
 *   snakesAlive: boolean,
 *   finalPickupCount: number,
 * }}
 */
function runPowerupTimelineScenario({ powerUpsEnabled, targetElapsedSeconds }) {
  const kobi = /** @type {any} */ (globalThis).__kobi;
  kobi.startMatch({ powerUpsEnabled });
  // KS-06-00: stepped rather than fast-forwarded a fixed duration, so the round starts at tick 0 exactly
  // (see `helpers.js`'s own `startMatchInPage`, which this mirrors for the same reason).
  for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
  kobi.fastForward(0); // one frame for the whole countdown, not one per step (KS-06-06)

  const sim = kobi.sim;
  const initialEnabled = sim.powerUps.enabled;

  /** @type {any[]} */
  const events = [];
  const originalAdvance = sim.advance.bind(sim);
  sim.advance = (/** @type {number} */ dt) => {
    const produced = originalAdvance(dt);
    if (produced.length > 0) events.push(...produced);
    return produced;
  };

  const simHz = sim.settings.simHz;
  const stepTicks = simHz / sim.settings.snakeSpeed;

  /** Builds an absolute-tick `{tick, dir}` schedule for a rectangular clockwise patrol, from tick 0. */
  function buildSchedule(/** @type {[string, number][]} */ legs) {
    const schedule = [];
    let tick = 0;
    for (const [dir, cells] of legs) {
      schedule.push({ tick, dir });
      tick += cells * stepTicks;
    }
    return schedule;
  }
  const loopLegs = (/** @type {[string, number][]} */ legs, /** @type {number} */ repeats) =>
    Array.from({ length: repeats }, () => legs).flat();

  // Identical to `laser.spec.js`'s own boxes (see this function's doc comment for why reusing them is safe):
  // P1 spawns (5, 12) heading RIGHT, into box x:[4,11] y:[4,11]; P2 spawns (18, 11) heading LEFT, into its
  // own box x:[14,21] y:[14,21], well clear of P1's.
  const p1Legs = [
    ['DOWN', 8],
    ['RIGHT', 6],
    ['UP', 7],
    ['LEFT', 7],
    ['DOWN', 7],
    ...loopLegs(
      [
        ['RIGHT', 7],
        ['UP', 7],
        ['LEFT', 7],
        ['DOWN', 7],
      ],
      14,
    ),
  ];
  const p2Legs = [
    ['UP', 3],
    ['LEFT', 4],
    ['UP', 7],
    ['RIGHT', 7],
    ['DOWN', 7],
    ...loopLegs(
      [
        ['LEFT', 7],
        ['UP', 7],
        ['RIGHT', 7],
        ['DOWN', 7],
      ],
      14,
    ),
  ];

  const schedule = [
    ...buildSchedule(/** @type {any} */ (p1Legs)).map((e) => ({ ...e, player: 1 })),
    ...buildSchedule(/** @type {any} */ (p2Legs)).map((e) => ({ ...e, player: 2 })),
  ].sort((a, b) => a.tick - b.tick);

  const targetTick = targetElapsedSeconds * simHz;
  const advanceToTick = (/** @type {number} */ tick) =>
    kobi.fastForward(Math.max(0, tick - sim.tick) / simHz);

  let eventIndex = 0;
  // Applies every scheduled turn up to and including `targetTick`, then lands exactly on it — the same
  // "advanceApplyingTurns" shape `laser.spec.js` uses, for the same reason.
  while (eventIndex < schedule.length && schedule[eventIndex].tick <= targetTick) {
    advanceToTick(schedule[eventIndex].tick);
    kobi.pressKey(schedule[eventIndex].player, schedule[eventIndex].dir);
    eventIndex += 1;
  }
  advanceToTick(targetTick);

  const powerUpEventTypeNames = new Set([
    'POWERUP_SPAWNED',
    'POWERUP_DESPAWNED',
    'POWERUP_REMOVED',
    'POWERUP_COLLECTED',
    'EFFECT_STARTED',
    'EFFECT_ENDED',
  ]);

  return {
    initialEnabled,
    spawnTimes: events.filter((e) => e.type === 'POWERUP_SPAWNED').map((e) => e.t),
    powerUpEventTypes: events.filter((e) => powerUpEventTypeNames.has(e.type)).map((e) => e.type),
    // Sanity that this really was a full, un-crashed round through the whole window under test — a dead
    // snake would freeze the round's clock and silently make every "no spawn happened" result meaningless.
    snakesAlive: kobi.getSnapshot().snakes.every((/** @type {any} */ s) => s.alive),
    finalPickupCount: kobi.getSnapshot().powerUps.pickups.length,
  };
}

test.describe('KS-06-03 power-up spawn timeline vs the match-setup toggle', () => {
  test('KS-06-03 AC1: powerUpsEnabled OFF produces no power-up events across a full round', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(runPowerupTimelineScenario, {
      powerUpsEnabled: false,
      // Past the last spawn threshold (45 s remaining) and past the "none at 30 s remaining" checkpoint —
      // comfortably inside the patrol's proven-safe span (see the module doc comment).
      targetElapsedSeconds: 62,
    });

    expect(result.initialEnabled).toBe(false);
    expect(result.snakesAlive).toBe(true);
    expect(result.powerUpEventTypes).toEqual([]);
    expect(result.finalPickupCount).toBe(0);
  });

  test('KS-06-03 positive control: powerUpsEnabled ON spawns at 75, 60 and 45s remaining, and none at 30', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    const result = await page.evaluate(runPowerupTimelineScenario, {
      powerUpsEnabled: true,
      targetElapsedSeconds: 62,
    });

    expect(result.initialEnabled).toBe(true);
    expect(result.snakesAlive).toBe(true);
    // 90 - 75, 90 - 60, 90 - 45 (`DESIGN-DECISIONS §2.4`, `SETTINGS.powerUpFirstSpawnAt`/`powerUpInterval`):
    // elapsed seconds since round start, not seconds remaining. Exactly three, and nothing past 45 through
    // t = 62 — which covers the "none at 30 s remaining" (t = 60) checkpoint with margin either side of it.
    expect(result.spawnTimes).toEqual([15, 30, 45]);
  });
});

test.describe('KS-06-03 match-setup toggle and its persistence', () => {
  test('KS-06-03: the POWER-UPS row defaults to ON and flips powerUpsEnabled', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    // '2 PLAYERS' is the default-focused row on a fresh MAIN_MENU (`menus.spec.js`'s own note).
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MATCH_SETUP"]')).toBeVisible();

    const powerUpsValue = page
      .locator('.menu-item', { hasText: 'POWER-UPS' })
      .locator('.menu-item-value');

    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings().powerUpsEnabled),
    ).toBe(true);
    await expect(powerUpsValue).toHaveText('ON');

    // MATCH LENGTH is the default-focused row (`matchSetup.js`'s row order); one ArrowDown reaches POWER-UPS.
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight'); // an ON/OFF pill flips on either arrow direction

    await expect(powerUpsValue).toHaveText('OFF');
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings().powerUpsEnabled),
    ).toBe(false);
  });

  test('KS-06-03: powerUpsEnabled persists across quitting to the main menu and starting another match', async ({
    page,
  }) => {
    await page.goto(DEFAULT_QUERY);

    await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      // Bo1 with a scripted crash reaches MATCH_OVER in a couple of simulated seconds — this test is about
      // the setting surviving the trip, not about a full round, so it stays deliberately cheap.
      kobi.startMatch({ bestOf: 1, powerUpsEnabled: false });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);
    });

    const crashed = await page.evaluate(crashPlayerOneInPage);
    expect(crashed.state).toBe('ROUND_OVER');

    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.fastForward(3)); // scoreboardSeconds is 2.5
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_OVER',
    );

    // QUIT TO MENU is the second (and last) row on MATCH_OVER, below the default-focused REMATCH
    // (`menus.spec.js`'s own note).
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-screen="MAIN_MENU"]')).toBeVisible();

    // The setting must have survived leaving the match entirely — `session.js`'s `showMainMenu` resets the
    // round and the match, but never touches `matchSettings`.
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings().powerUpsEnabled),
    ).toBe(false);

    // And it must still be what a freshly started match uses, with no override this time.
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.startMatch());
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings().powerUpsEnabled),
    ).toBe(false);
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.powerUps.enabled)).toBe(
      false,
    );
  });

  test('KS-06-03: powerUpsEnabled persists across REMATCH', async ({ page }) => {
    await page.goto(DEFAULT_QUERY);

    await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      kobi.startMatch({ bestOf: 1, powerUpsEnabled: false });
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);
    });

    await page.evaluate(crashPlayerOneInPage);
    await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.fastForward(3));
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe(
      'MATCH_OVER',
    );

    // REMATCH is the default-focused row on MATCH_OVER.
    await page.keyboard.press('Enter');

    await page.evaluate(() => {
      const kobi = /** @type {any} */ (globalThis).__kobi;
      for (let i = 0; i < 60 && kobi.getState() === 'COUNTDOWN'; i += 1) kobi.advance(0.1);
      kobi.fastForward(0);
    });

    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getState())).toBe('PLAYING');
    expect(
      await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.getMatchSettings().powerUpsEnabled),
    ).toBe(false);
    // The fresh round REMATCH built used the carried-over setting, not just the session's own bookkeeping.
    expect(await page.evaluate(() => /** @type {any} */ (globalThis).__kobi.sim.powerUps.enabled)).toBe(
      false,
    );
  });
});
