// @ts-check
import { expect, test } from '@playwright/test';
import { SETTINGS } from '../../src/core/settings.js';
import {
  HUD_LENGTH_TOLERANCE,
  HUD_TIMER_TOLERANCE_SECONDS,
  checkInvariants,
} from './invariants.js';
import {
  ACTION_KINDS,
  MONKEY_KEY_CODES,
  MONKEY_KOBI_MEMBERS,
  MONKEY_VIEWPORTS,
  describeAction,
  generateActions,
  monkeyFailureReasons,
  runMonkeySession,
  runMonkeyStepsInPage,
} from './monkey.js';

/**
 * KI-18-01's own suite (issue #311, Improvement 18, tracking issue #303).
 *
 * **What is asserted here is the monkey, not the game.** The three acceptance criteria are all statements
 * about the fuzzer — a seeded run repeats, every action lands through a real listener, and the campaign fits
 * its budget — and every test below is written so that it stays green whether or not the monkey finds
 * something. That is deliberate, and it is this sprint's own rule in test form: **findings are filed, not
 * fixed** (`docs/sprints/improvement-18-session-fuzzing.md`, "Finding a lot. Good."). A monkey test that went
 * red the day it found its first stuck state would put `npm run test:agent` in the position of demanding that
 * a defect be fixed to get the nightly green again, which is the one thing the sprint says not to do.
 *
 * So the seeds are run for what they prove about the harness: AC1 compares one run against another rather
 * than against a healthy outcome, and AC2 drives hand-written sequences down paths the game is known to
 * support. KI-18-03 is where two thousand random seeds are run for what they say about the game, and where
 * what they say becomes issues.
 *
 * AC3's run is gated behind `KI_MONKEY=1` — unset, it is discovered and instantly skipped, the same
 * arrangement `report.spec.js`, `pacing.spec.js` and `viewports.spec.js` use so a long run costs the fast
 * gate nothing. `npm run test:agent:monkey` is the script; `agent-playtest.yml` is where it runs on CI, which
 * is where AC3's ten minutes are measured because that is what AC3 says.
 */

const RUN_CAMPAIGN = /** @type {any} */ (globalThis).process?.env?.KI_MONKEY === '1';

/** AC3, verbatim: "200 seeds × 500 actions complete in under 10 minutes on CI." */
const AC3_SEEDS = 200;
const AC3_ACTIONS = 500;
const AC3_BUDGET_MS = 10 * 60 * 1000;

/**
 * The size actually run. AC3's numbers are the default; the two environment variables exist because the same
 * loop is what KI-18-03 runs two thousand seeds through, and because measuring the per-seed cost honestly
 * means being able to run twenty of them. They are knobs on the campaign, never on the criterion.
 *
 * **The budget is not scaled to fit them**, which is the correction: it used to be, and a 20-seed pilot then
 * ran 66.8 s against a 60 s scaled budget — 3.34 s a seed against the 200-seed average of 2.60 — and failed
 * for a reason that says nothing about AC3. Per-seed cost is not flat: the fixed costs of a page load and of
 * the first seed's compile are a bigger share of twenty seeds than of two hundred, and twenty seeds is a
 * small sample of a distribution whose max is four times its min. In the other direction it was worse than
 * useless: at the two thousand seeds KI-18-03 needs, a scaled hundred-minute budget would have passed while
 * meaning nothing at all.
 *
 * So the ten minutes is asserted **only when the run is exactly AC3's shape**, which is the only run AC3
 * describes. Every other size prints its per-seed cost projected to 200 seeds — the number that is actually
 * comparable — and asserts nothing about it.
 */
const env = /** @type {any} */ (globalThis).process?.env ?? {};
const CAMPAIGN_SEEDS = Number(env.KI_MONKEY_SEEDS ?? AC3_SEEDS);
const CAMPAIGN_ACTIONS = Number(env.KI_MONKEY_ACTIONS ?? AC3_ACTIONS);
const IS_AC3_SHAPE = CAMPAIGN_SEEDS === AC3_SEEDS && CAMPAIGN_ACTIONS === AC3_ACTIONS;

/**
 * The Node-side values `checkInvariants`'s serialised body may not import for itself (ruling 3 on #122),
 * exactly as `invariants.spec.js` assembles them.
 */
const INVARIANT_CONFIG = {
  grid: { width: SETTINGS.grid.width, height: SETTINGS.grid.height },
  hudTimerToleranceSeconds: HUD_TIMER_TOLERANCE_SECONDS,
  hudLengthTolerance: HUD_LENGTH_TOLERANCE,
};

/**
 * The shortest hand-written sequence that reaches a running round through the real screens: Enter selects
 * `2 PLAYERS` (the first enabled row on the main menu since KI-10-01), ArrowUp wraps the setup screen's
 * cursor onto its last row, `START MATCH`, Enter takes it, and then four simulated seconds see the
 * countdown's four 0.8 s beats out.
 *
 * Written as actions rather than as `__kobi.startMatch()` on purpose: this is AC2's whole point, and a helper
 * that took the shortcut would prove nothing about the thing under test.
 *
 * @param {number} startIndex
 * @returns {import('./monkey.js').MonkeyAction[]}
 */
function actionsToPlaying(startIndex = 0) {
  return [
    { index: startIndex, kind: 'key', waitSeconds: 0.2, code: 'Enter' },
    { index: startIndex + 1, kind: 'key', waitSeconds: 0.2, code: 'ArrowUp' },
    { index: startIndex + 2, kind: 'key', waitSeconds: 0.2, code: 'Enter' },
    { index: startIndex + 3, kind: 'focus', waitSeconds: 4 },
  ];
}

/** The direction player one's snake is travelling in, read from the page the run left behind. */
function readPlayerOneDirection(page) {
  return page.evaluate(
    () => /** @type {any} */ (globalThis).__kobi.getSnapshot()?.snakes?.[0]?.direction ?? null,
  );
}

/** Every `from --event--> to` the run recorded, as strings, so an assertion reads like the table it checks. */
function transitionStrings(result) {
  return result.transitions.map(
    (/** @type {import('./monkey.js').MonkeyTransition} */ transition) =>
      `${transition.from} --${transition.event}--> ${transition.to}`,
  );
}

test.describe('KI-18-01 · the monkey', () => {
  test('KI-18-01 AC1: the action list is a pure function of the seed', async () => {
    // The half that needs no browser: the list is data, generated on the Node side, which is what lets
    // KI-18-02 shrink it by deleting entries.
    expect(generateActions(7, 200)).toEqual(generateActions(7, 200));
    expect(generateActions(7, 200)).not.toEqual(generateActions(8, 200));
    // A prefix of a longer run is the same prefix, so a shrunk 20-action list replays the first 20 actions
    // of the 2 000-action run it came from.
    expect(generateActions(7, 20)).toEqual(generateActions(7, 200).slice(0, 20));

    const actions = generateActions(7, 500);
    expect(actions).toHaveLength(500);
    for (const action of actions) {
      expect(ACTION_KINDS).toContain(action.kind);
      expect(action.waitSeconds).toBeGreaterThanOrEqual(0);
      // The ticket's own range: "random intervals from 0 to 2 s of simulated time".
      expect(action.waitSeconds).toBeLessThanOrEqual(2);
      if (action.kind === 'key') expect(MONKEY_KEY_CODES).toContain(action.code);
      if (action.kind === 'resize') expect(MONKEY_VIEWPORTS).toContainEqual(action.viewport);
      expect(describeAction(action)).toMatch(/^wait \d+\.\d{3} s, /);
    }
    // A resize that did not change the size would fire no event at all — the shape of #291's defect, an
    // option that reports success and does nothing.
    const resizes = actions.filter((action) => action.kind === 'resize');
    for (let i = 1; i < resizes.length; i += 1) {
      expect(resizes[i].viewport).not.toEqual(resizes[i - 1].viewport);
    }
  });

  test('KI-18-01 AC1: a seeded run is reproducible action for action', async ({ page }) => {
    test.setTimeout(180_000);
    // Two hundred actions is long enough to cover several rounds, at least one resize and several visibility
    // changes — the three things that make a run more than one `page.evaluate` and therefore the three ways
    // wall time could have leaked in.
    const first = await runMonkeySession(page, {
      seed: 4242,
      actionCount: 200,
      invariants: checkInvariants,
      invariantConfig: INVARIANT_CONFIG,
    });
    const second = await runMonkeySession(page, {
      seed: 4242,
      actionCount: 200,
      invariants: checkInvariants,
      invariantConfig: INVARIANT_CONFIG,
    });

    // Action for action: the same actions applied, the same simulated clock, the same machine transitions in
    // the same order at the same simulated instants, and the same problems (however many that is — see this
    // file's header on why the count is not asserted to be zero).
    expect(second.actionsApplied).toBe(first.actionsApplied);
    expect(second.simSeconds).toBeCloseTo(first.simSeconds, 9);
    expect(second.hiddenSeconds).toBeCloseTo(first.hiddenSeconds, 9);
    expect(second.framesPumped).toBe(first.framesPumped);
    expect(second.transitions).toEqual(first.transitions);
    expect(second.statesVisited).toEqual(first.statesVisited);
    expect(second.problems).toEqual(first.problems);
    expect(second.problemCount).toBe(first.problemCount);
    expect(second.stopped).toEqual(first.stopped);

    console.log(
      `KI-18-01 AC1: seed 4242 × 200 actions replayed identically — ` +
        `${first.transitions.length} transitions, ${first.simSeconds.toFixed(2)} simulated seconds ` +
        `(+${first.hiddenSeconds.toFixed(2)} s hidden), states ${first.statesVisited.join(', ')}, ` +
        `${first.problemCount} problem(s), ${first.wallMs} ms + ${second.wallMs} ms.`,
    );
  });

  test('KI-18-01 AC2: the monkey never reaches for a `__kobi` member that makes the game do something', async () => {
    // `runMonkeyStepsInPage` is the only code the monkey runs inside the page. Reading its own source is the
    // machine-checkable half of "every action reaches the game through the same listeners a person's would":
    // an action applied by calling `__kobi.startMatch` or `__kobi.pause` would be a shortcut around the very
    // listeners this ticket exists to exercise.
    const source = runMonkeyStepsInPage.toString();
    const touched = new Set([...source.matchAll(/\bkobi\.(\w+)/g)].map((match) => match[1]));
    expect([...touched].sort()).toEqual([...MONKEY_KOBI_MEMBERS].sort());
    for (const forbidden of ['startMatch', 'pause', 'resume', 'pressKey', 'setSettingsOverrides']) {
      expect(source).not.toContain(`kobi.${forbidden}`);
    }
    // …and it never dispatches into the machine either. It wraps `stateMachine.dispatch` to *record*
    // transitions (this module's header says why the recorder is exact where sampling would not be), which is
    // an assignment and a call-through, never a call of its own.
    expect(source).not.toMatch(/machine\.dispatch\(/);
  });

  test('KI-18-01 AC2: a key press reaches the real keydown listener, on menus and in a round', async ({
    page,
  }) => {
    test.setTimeout(180_000);

    // Enter, ArrowUp, Enter, and the countdown — every one of them a real `KeyboardEvent` at `window`, the
    // target `src/game/input.js` listens on. Reaching COUNTDOWN at all is proof the menu half landed: the
    // focus model moved, `2 PLAYERS` was selected and `START MATCH` was taken.
    const steered = await runMonkeySession(page, {
      seed: 1,
      actions: [
        ...actionsToPlaying(),
        { index: 4, kind: 'key', waitSeconds: 0.3, code: 'KeyA' },
        { index: 5, kind: 'key', waitSeconds: 0.3, code: 'KeyW' },
        { index: 6, kind: 'key', waitSeconds: 0.3, code: 'KeyD' },
      ],
    });
    const steeredDirection = await readPlayerOneDirection(page);

    expect(steered.pageErrors).toEqual([]);
    expect(transitionStrings(steered)).toEqual([
      'MAIN_MENU --SELECT_2P--> MATCH_SETUP',
      'MATCH_SETUP --START_MATCH--> COUNTDOWN',
      'COUNTDOWN --COUNTDOWN_DONE--> PLAYING',
    ]);

    // The control: the identical run with the three steering keys replaced by an action that presses
    // nothing. Same seed, same waits, same simulated clock — so a different heading afterwards can only be
    // the keys.
    const control = await runMonkeySession(page, {
      seed: 1,
      actions: [
        ...actionsToPlaying(),
        { index: 4, kind: 'focus', waitSeconds: 0.3 },
        { index: 5, kind: 'focus', waitSeconds: 0.3 },
        { index: 6, kind: 'focus', waitSeconds: 0.3 },
      ],
    });
    const controlDirection = await readPlayerOneDirection(page);

    expect(control.pageErrors).toEqual([]);
    expect(controlDirection).not.toBeNull();
    expect(steeredDirection).not.toEqual(controlDirection);
    console.log(
      `KI-18-01 AC2: WASD steered player one to ${JSON.stringify(steeredDirection)}; ` +
        `the same run without the keys ended at ${JSON.stringify(controlDirection)}.`,
    );
  });

  test('KI-18-01 AC2: Escape reaches the real listener and backs out of a screen', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const result = await runMonkeySession(page, {
      seed: 1,
      actions: [
        { index: 0, kind: 'key', waitSeconds: 0.2, code: 'Enter' },
        { index: 1, kind: 'key', waitSeconds: 0.2, code: 'Escape' },
      ],
    });
    expect(result.pageErrors).toEqual([]);
    expect(transitionStrings(result)).toEqual([
      'MAIN_MENU --SELECT_2P--> MATCH_SETUP',
      'MATCH_SETUP --BACK--> MAIN_MENU',
    ]);
  });

  test('KI-18-01 AC2: blur reaches the window listener and auto-pauses the round', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // `DESIGN-DECISIONS §2.8`: "losing window focus pauses automatically". `session.js` subscribes `blur` on
    // `window` for exactly this, and a real `blur` event is what the monkey dispatches.
    const result = await runMonkeySession(page, {
      seed: 1,
      actions: [...actionsToPlaying(), { index: 4, kind: 'blur', waitSeconds: 0.5 }],
    });
    expect(result.pageErrors).toEqual([]);
    expect(transitionStrings(result)).toContain('PLAYING --AUTO_PAUSE--> PAUSE');
  });

  test('KI-18-01 AC2: hiding and returning to the tab reaches loop.js and auto-pauses on the way back', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // KI-06-03's path, and the one that needs the frame pump: hiding sets `loop.js`'s own `hidden`, and the
    // return only *arms* `autoPausePending`, which `loop.advance` consumes on the next frame — a frame
    // `__kobi.advance` never produces, because it calls `runUpdate` directly. `monkey.js`'s header has the
    // whole story.
    const result = await runMonkeySession(page, {
      seed: 1,
      actions: [
        ...actionsToPlaying(),
        { index: 4, kind: 'visibilitychange', waitSeconds: 0.5, hidden: true },
        { index: 5, kind: 'visibilitychange', waitSeconds: 1.5, hidden: false },
      ],
    });
    expect(result.pageErrors).toEqual([]);
    expect(result.framesPumped).toBe(1);
    expect(transitionStrings(result)).toContain('PLAYING --AUTO_PAUSE--> PAUSE');
    // A hidden tab gets no frames, so it gets no simulated time either — the 1.5 s waited while hidden is
    // counted, not played (`monkey.js`, "A hidden tab is not advanced").
    expect(result.hiddenSeconds).toBeCloseTo(1.5, 6);
  });

  test('KI-18-01 AC2: a resize is a real viewport change, not an event dispatched at a window that did not move', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const target = MONKEY_VIEWPORTS[3];
    const result = await runMonkeySession(page, {
      seed: 1,
      actions: [
        ...actionsToPlaying(),
        { index: 4, kind: 'resize', waitSeconds: 0.5, viewport: target },
        { index: 5, kind: 'focus', waitSeconds: 0.5 },
      ],
    });
    expect(result.pageErrors).toEqual([]);
    const inner = await page.evaluate(() => ({
      width: /** @type {any} */ (globalThis).innerWidth,
      height: /** @type {any} */ (globalThis).innerHeight,
      resizes: /** @type {any} */ (globalThis).__kobiMonkeyFrames.resizes(),
    }));
    // The window really moved — which is the whole reason a resize costs a Node-side round trip instead of
    // being dispatched in-page like every other action.
    expect(inner.width).toBe(target.width);
    expect(inner.height).toBe(target.height);
    // …and the page's own `resize` listeners ran for it, `main.js`'s `session.resize()` among them.
    expect(inner.resizes).toBeGreaterThan(0);
    // The round survived it and kept running.
    expect(result.statesVisited).toContain('PLAYING');
  });

  test('KI-18-01 AC3: 200 seeds × 500 actions inside ten minutes', async ({ page }) => {
    test.skip(!RUN_CAMPAIGN, 'Set KI_MONKEY=1 (npm run test:agent:monkey) to run the campaign.');
    // Twice AC3's budget per 200 seeds, plus a minute: a run that is over budget should still finish and
    // *report its number* rather than be killed by Playwright, because the number is the thing AC3 is about.
    // This one does scale with the size actually run — it is a deadline, not a criterion, and KI-18-03's two
    // thousand seeds need a deadline that fits them.
    test.setTimeout((AC3_BUDGET_MS * 2 * CAMPAIGN_SEEDS) / AC3_SEEDS + 60_000);

    const startedAt = Date.now();
    /** @type {import('./monkey.js').MonkeyResult[]} */
    const results = [];
    for (let seed = 1; seed <= CAMPAIGN_SEEDS; seed += 1) {
      results.push(
        await runMonkeySession(page, {
          seed,
          actionCount: CAMPAIGN_ACTIONS,
          invariants: checkInvariants,
          invariantConfig: INVARIANT_CONFIG,
        }),
      );
    }
    const totalMs = Date.now() - startedAt;

    /** @type {Set<string>} */
    const states = new Set();
    for (const result of results) for (const state of result.statesVisited) states.add(state);
    const stopped = results.filter((result) => result.stopped !== null);
    const reasons = monkeyFailureReasons(results);
    const perSeed = results.map((result) => result.wallMs).sort((a, b) => a - b);

    console.log(
      `KI-18-01 AC3: ${CAMPAIGN_SEEDS} seeds × ${CAMPAIGN_ACTIONS} actions in ${totalMs} ms ` +
        `(${(totalMs / CAMPAIGN_SEEDS).toFixed(0)} ms/seed). ` +
        `${results.reduce((sum, r) => sum + r.simSeconds, 0).toFixed(0)} simulated seconds, ` +
        `${results.reduce((sum, r) => sum + r.transitions.length, 0)} transitions, ` +
        `states reached: ${[...states].sort().join(', ')}. ` +
        `${stopped.length} run(s) stopped early; ${reasons.length} finding(s). ` +
        `Per seed: min ${perSeed[0]} ms, median ${perSeed[Math.floor(perSeed.length / 2)]} ms, ` +
        `max ${perSeed[perSeed.length - 1]} ms. Where it went: ` +
        `${results.reduce((sum, r) => sum + r.timing.loadMs, 0)} ms loading, ` +
        `${results.reduce((sum, r) => sum + r.timing.stepsMs, 0)} ms in the page, ` +
        `${results.reduce((sum, r) => sum + r.timing.resizeMs, 0)} ms resizing over ` +
        `${results.reduce((sum, r) => sum + r.timing.stretches - 1, 0)} resize(s), ` +
        `${results.reduce((sum, r) => sum + r.framesPumped, 0)} frame(s) pumped.`,
    );
    /** @type {Record<string, {frames: number, wallMs: number}>} */
    const byState = {};
    for (const result of results) {
      for (const [state, cost] of Object.entries(result.stateCost)) {
        const total = byState[state] ?? { frames: 0, wallMs: 0 };
        total.frames += cost.frames;
        total.wallMs += cost.wallMs;
        byState[state] = total;
      }
    }
    /** @type {Record<string, {count: number, wallMs: number}>} */
    const byOp = {};
    for (const result of results) {
      for (const [op, cost] of Object.entries(result.opCost)) {
        const total = byOp[op] ?? { count: 0, wallMs: 0 };
        total.count += cost.count;
        total.wallMs += cost.wallMs;
        byOp[op] = total;
      }
    }
    console.log(
      'KI-18-01 AC3 cost by step: ' +
        Object.entries(byOp)
          .sort((a, b) => b[1].wallMs - a[1].wallMs)
          .map(
            ([op, cost]) =>
              `${op} ×${cost.count} ${cost.wallMs.toFixed(0)} ms ` +
              `(${(cost.wallMs / Math.max(cost.count, 1)).toFixed(2)} ms each)`,
          )
          .join(', '),
    );
    console.log(
      'KI-18-01 AC3 cost by state: ' +
        Object.entries(byState)
          .sort((a, b) => b[1].wallMs - a[1].wallMs)
          .map(
            ([state, cost]) =>
              `${state} ${cost.frames} frames ${cost.wallMs.toFixed(0)} ms ` +
              `(${(cost.wallMs / Math.max(cost.frames, 1)).toFixed(2)} ms/frame)`,
          )
          .join(', '),
    );
    // The findings themselves are KI-18-03's to shrink and file, not this test's to fail on — see this
    // file's header. They are printed so a CI run is a campaign log even before that ticket lands.
    for (const reason of reasons.slice(0, 20)) console.log(`KI-18-01 finding: ${reason}`);

    // Every seed ran to its end or stopped for a *reported* reason. A run that stopped with no reason would
    // mean the harness gave up silently, which is the one outcome that makes the numbers above meaningless.
    for (const result of results) {
      if (result.stopped !== null) continue;
      expect(result.actionsApplied, `seed ${result.seed}`).toBe(CAMPAIGN_ACTIONS);
    }
    // Ten minutes is stated for AC3's own shape and asserted for that shape alone. Any other size prints
    // the only number that is comparable — its per-seed cost projected to 200 seeds — and asserts nothing.
    if (IS_AC3_SHAPE) expect(totalMs).toBeLessThan(AC3_BUDGET_MS);
    else
      console.log(
        `KI-18-01: ${CAMPAIGN_SEEDS} × ${CAMPAIGN_ACTIONS} is not AC3's shape (${AC3_SEEDS} × ` +
          `${AC3_ACTIONS}), so the ten-minute budget is not asserted. At this run's ` +
          `${Math.round(totalMs / CAMPAIGN_SEEDS)} ms/seed, ${AC3_SEEDS} seeds would be ` +
          `${Math.round((totalMs / CAMPAIGN_SEEDS) * AC3_SEEDS)} ms against ${AC3_BUDGET_MS} ms.`,
      );
  });
});
