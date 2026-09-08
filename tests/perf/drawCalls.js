// @ts-check

/**
 * KI-08-02 — the draw-call budget (`docs/sprints/improvement-08-performance-budgets-before-the-art.md`,
 * tracking issue #277, this ticket #279).
 *
 * `ARCHITECTURE §12` fixes the number: "Draw calls during PLAYING | ≤ 120" ({@link DRAW_CALL_BUDGET}). This
 * file measures `renderer.getDrawCalls()` (`src/game/testHooks.js`'s forward of
 * `src/render/renderer.js`'s `getDrawCalls`) at the five moments the ticket names, through the **real built
 * site** in a real browser — never a fixture — the same "real scene" discipline `tests/agent/driver.js` and
 * `tests/agent/viewports.js` already use for the identical reason.
 *
 * ## The cautionary tale this ticket names (KS-07-00, #102)
 *
 * `tests/e2e/laser.spec.js` once asserted a draw-call *difference* across two moments and found, after the
 * rng stream moved, that a power-up pedestal had spawned in the gap and been counted as a laser. The fix
 * there — and the rule this file follows for every sample — is never to trust a bare number: isolate what it
 * counts. Three things do that here, per the tech-lead ruling on this ticket:
 *
 * 1. **`powerUpsEnabled: false`** for every sample whose claim is about lasers or snakes (every scene below
 *    except the menu screens outside a live round), exactly as `laser.spec.js` does and for the same reason
 *    — a pedestal must never be free to appear between "before" and "after" and get counted as something
 *    else.
 * 2. **Composition evidence travels with every number.** {@link SceneComposition} — both snake lengths, the
 *    apple count, the pickup count, `lasers.phase` and `lasers.inset`, and the state name — is captured
 *    alongside every `drawCalls` reading, so a reader can check what a number counted without re-running
 *    anything. This is precisely the check that would have caught KS-07-00's pedestal: `pickupCount` sitting
 *    at 1 in a sample whose caption says "lasers" is a defect on its face.
 * 3. **A floor sample.** `menu-main-menu` — the empty arena, nothing on the board — is measured and reported
 *    like every other row, and every other row's delta over it is printed, so a number is always readable as
 *    "the floor plus what this scene adds" rather than a bare total.
 *
 * ## Shape, following `tests/agent/README.md`'s two rules
 *
 * Everything that runs **inside the page** is {@link sampleSceneInPage} alone: one self-contained function
 * with every helper nested inside it and no free variables — no import, no module-level constant, nothing
 * captured from this module's scope — because `drawCalls.spec.js` ships it into the page as source text
 * (`page.evaluate(sampleSceneInPage, args)` serialises it with `Function.prototype.toString()`, exactly as
 * `viewports.js`'s `measureMidRoundFrame`/`measureLaserBanner` and `driver.js`'s own `runMatchInPage` do). One
 * function covers every scene, switched on `args.scene`, rather than one function per scene, so the
 * `compile`/`composition`/`stepCountdown` helpers a policy-driven scene and a menu scene both need are
 * written once instead of duplicated per `toString()` payload the way `driver.js`'s module doc warns a
 * factory would be.
 *
 * Driving real play without duplicating policy code follows `driver.js`'s own route (tech-lead ruling 3):
 * `greedy.toString()`/`survivor.toString()` are passed in as plain source text and compiled inside the page
 * with `new Function('return (' + src + ')')()`. The two policies are imported normally on the **Node**
 * side (`drawCalls.spec.js`) to build that source text; neither is ever imported or referenced from inside
 * {@link sampleSceneInPage} itself.
 *
 * Everything else in this file — {@link checkDrawCallBudget}, {@link buildBudgetFailureMessage},
 * {@link buildDrawCallsReportTable}, {@link laserWarningOverrides}, {@link endgameOverrides} — is a plain
 * Node-side function, unit-testable in `drawCalls.test.js` against hand-built fixtures without a browser,
 * the same split `driver.js`/`report.js`/`viewports.js` all use.
 *
 * ## Rendering is the entire cost (tech-lead ruling 3)
 *
 * One `renderer.render()` is ≈124 ms under Chromium's software WebGL at 1280×720 against ≈0.04 ms for one
 * unrendered `advance` frame (`driver.js`'s `RENDER_EVERY_N_FRAMES` comment has the measurement). Every scene
 * below `advance()`s — no render — between moments and renders exactly once, with `fastForward(0)`, at the
 * instant it samples: `getDrawCalls()` reports the last rendered frame, so one render immediately before one
 * read is the whole contract. No scene here plays through a match rendering every frame.
 *
 * ## The endgame's settings overrides (tech-lead ruling 4 — reported prominently, not buried)
 *
 * `endgame-6x6` is reached with `__kobi.setSettingsOverrides` shortening `laserStartTime` and
 * `laserStepInterval` (see {@link endgameOverrides}) — the supported route (`tests/agent/README.md`'s
 * "Sweeping a setting"; `src/core/settings.js` itself is never touched). Without it, reaching the maximum
 * inset (9 steps at the shipping numbers, `src/core/lasers.js`'s `maxStepCount`) needs both snakes to survive
 * almost the entire round under the shipping schedule, which two policy-driven snakes cannot be guaranteed to
 * do inside a bounded number of seeds; shortening the schedule instead makes the squeeze land a few simulated
 * seconds into the round, which is what makes this reliable enough to gate on. That means this sample is
 * **"the endgame scene", not "the endgame reached in normal play"** — stated here and repeated in the PR.
 *
 * ## The baseline is a record, not a second gate (tech-lead ruling 6)
 *
 * {@link BASELINE_DRAW_CALLS} names today's figures (2026-09-08, Chromium software WebGL, `playwright.
 * config.js`'s 1280×720) for `drawCalls.spec.js`'s report table to compare against. Every assertion in that
 * spec is against {@link DRAW_CALL_BUDGET} alone — a scene moving from 18 to 30 draw calls is information a
 * design lead reads in the table, never a reason this suite goes red. Only crossing 120 fails anything.
 */

/** @typedef {import('../../src/core/settings.js').Settings} Settings */

/**
 * `ARCHITECTURE §12`'s own row: "Draw calls during PLAYING | ≤ 120". The one number this file compares
 * against — it appears exactly once, here, and every assertion and every printed percentage in this file and
 * in `drawCalls.spec.js` is computed from this constant, never restated.
 */
export const DRAW_CALL_BUDGET = 120;

/**
 * The five named scenes AC1 asks for, in the shape `viewports.js`'s own `VIEWPORTS` uses. `menus` is one
 * scene by this list but several numbers — see {@link MENU_SCREENS} — because the ticket's own acceptance
 * criterion counts it as one of the five while asking every reachable menu to carry its own recorded figure.
 *
 * @type {readonly {slug: string, why: string}[]}
 */
export const SCENES = Object.freeze([
  {
    slug: 'opening-board',
    why: 'the round at tick 0, countdown played out — both snakes at spawn length, four apples, no lasers.',
  },
  {
    slug: 'mid-round-long-snakes',
    why:
      'both snakes grown well past spawn length on real greedy play, so a regression that stops growth ' +
      'cannot quietly turn this into a second opening-board sample.',
  },
  {
    slug: 'laser-warning',
    why: 'the beams lit — lasers.phase left PARKED — at the moment WARNING fires.',
  },
  {
    slug: 'endgame-6x6',
    why: 'the lasers at maximum inset (9 steps at the shipping numbers): the safe square shrunk to 6×6.',
  },
  {
    slug: 'menus',
    why: 'every menu the build actually has (see MENU_SCREENS) — one scene, several recorded numbers.',
  },
]);

/**
 * The reachable menu screens (tech-lead ruling 4): `MAIN_MENU`, `MATCH_SETUP`, `PAUSE`, `ROUND_OVER` (the
 * scoreboard), `MATCH_OVER` and `REPLAY`. `TUTORIAL`, `PRACTICE`, `SHOP` and `SETTINGS` are excluded — they
 * are COMING SOON rows in `src/ui/screens/mainMenu.js` with no screen behind them yet
 * (`docs/design/DESIGN-DECISIONS §1` row 27's own build list), so there is nothing for `getDrawCalls()` to
 * measure that would mean anything.
 *
 * `main-menu` doubles as AC2's floor sample (tech-lead ruling 5: "the empty arena, nothing on the board") —
 * it is both a reachable menu in its own right and the emptiest scene this file measures, so one number
 * serves both jobs rather than being computed twice.
 *
 * @type {readonly {slug: string, why: string}[]}
 */
export const MENU_SCREENS = Object.freeze([
  {
    slug: 'main-menu',
    why: 'the idle title screen — nothing on the board. Doubles as this run\'s floor sample (ruling 5).',
  },
  { slug: 'match-setup', why: 'reached from MAIN_MENU via SELECT_2P; still nothing on the board.' },
  {
    slug: 'pause',
    why: 'a live round frozen mid-play (`__kobi.pause()`) — the arena and both snakes keep drawing behind the panel.',
  },
  {
    slug: 'round-over',
    why: 'the between-round scoreboard, reached by steering P1 into a wall so P2 takes the round.',
  },
  {
    slug: 'match-over',
    why: 'a Bo1 decided by the same scripted crash — the match-over panel over the frozen arena.',
  },
  {
    slug: 'replay',
    why: 'the REPLAY screen\'s load view, reached from MAIN_MENU via SELECT_REPLAY with nothing loaded.',
  },
]);

/**
 * Today's committed figures (tech-lead ruling 6): Chromium software WebGL (SwiftShader), `playwright.
 * config.js`'s default 1280×720 viewport, `npm run test:perf:drawcalls`. **A record, not a second gate** —
 * `drawCalls.spec.js` asserts every scene against {@link DRAW_CALL_BUDGET} alone; this object only feeds the
 * spec's own report table so drift away from these figures is visible in a green log rather than silent.
 *
 * Regenerate by reading the "measured" column `drawCalls.spec.js` prints and pasting it in here — this file
 * is not self-updating on purpose, so a change to this object is always a reviewed diff.
 *
 * Keyed by the scene slug for the four gameplay scenes and by `menu-<slug>` for each {@link MENU_SCREENS}
 * entry, so every one of the several numbers AC1's "menus" scene carries has its own baseline row.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const BASELINE_DRAW_CALLS = Object.freeze({
  'opening-board': 15,
  'mid-round-long-snakes': 15,
  'laser-warning': 19,
  'endgame-6x6': 18,
  'menu-main-menu': 3,
  'menu-match-setup': 7,
  'menu-pause': 15,
  'menu-round-over': 15,
  'menu-match-over': 15,
  'menu-replay': 3,
});

/**
 * How many frames a policy-driven scene ({@link sampleSceneInPage}'s `mid-round-long-snakes` and
 * `endgame-6x6` cases) gets before giving up on this seed. 5400 frames at {@link FRAME_SECONDS} is 90
 * simulated seconds — one whole round (`SETTINGS.roundDuration`) — so a seed that has not reached its target
 * by then genuinely will not on this seed, rather than merely being slow; `drawCalls.spec.js` tries the next
 * seed in that case (see this file's module doc, "the endgame's settings overrides").
 */
export const SCENE_MAX_FRAMES = 5400;

/** Simulated seconds per driven frame — `driver.js`'s own `FRAME_SECONDS`, restated here so this in-page
 * function stays self-contained (the value is passed in as `args.frameSeconds`, never imported by it). */
export const FRAME_SECONDS = 1 / 60;

/**
 * How many `advance(chunkSeconds)` steps a guard loop gets before giving up on a state transition it
 * expected — the countdown wait and the laser-warning wait both use this. `chunkSeconds` 0.1 × 60 is 6
 * simulated seconds, comfortably more than the 3.2 s countdown (`DESIGN-DECISIONS §2.4`) with room to spare —
 * the same bound `viewports.js`'s `STATE_GUARD_STEPS` uses for the identical wait.
 */
export const STATE_GUARD_STEPS = 60;

/** The chunk size {@link STATE_GUARD_STEPS}'s guard loops advance in. */
export const STATE_GUARD_CHUNK_SECONDS = 0.1;

/**
 * "Meaningfully longer than spawn" for `mid-round-long-snakes` (AC1): both snakes at or past double their
 * starting length. Derived from `settings.startingSnakeLength` rather than a bare number, so a tuning change
 * to that value moves this target with it instead of silently becoming an easier (or impossible) bar.
 *
 * @param {Settings} settings
 * @returns {number}
 */
export function midRoundLengthTarget(settings) {
  return settings.startingSnakeLength * 2;
}

/**
 * The `withOverrides()`-shaped tree {@link sampleSceneInPage}'s `laser-warning` case applies through
 * `__kobi.setSettingsOverrides` before `startMatch`, so `LASER_WARNING` fires almost immediately — the
 * supported route (`tests/agent/README.md`'s "Sweeping a setting"). Identical in spirit to `viewports.js`'s
 * own `laserWarningOverrides`, restated here rather than imported so this file's `Files:` list stays the one
 * this ticket names plus its own declared deviations, not a dependency on a different ticket's file.
 *
 * @param {Settings} settings
 * @returns {{laserStartTime: number}}
 */
export function laserWarningOverrides(settings) {
  return { laserStartTime: settings.roundDuration - 1 };
}

/**
 * The `withOverrides()`-shaped tree {@link sampleSceneInPage}'s `endgame-6x6` case applies — see this file's
 * module doc, "The endgame's settings overrides", for why this exists and what it costs in honesty about what
 * the sample is.
 *
 * `laserStartTime: settings.roundDuration - 1` fires `WARNING` about one simulated second in, and
 * `laserStepInterval: 0.2` lands the nine steps `src/core/lasers.js`'s `maxStepCount` computes for the
 * shipping 24-cell arena and 6-cell minimum in 1.8 s once `WARNING`'s own `laserWarningDuration` (left at its
 * shipping 5 s — only the two fields named here are overridden) elapses — a few simulated seconds of survival
 * needed in total, instead of most of a 90 s round.
 *
 * @param {Settings} settings
 * @returns {{laserStartTime: number, laserStepInterval: number}}
 */
export function endgameOverrides(settings) {
  return {
    laserStartTime: settings.roundDuration - 1,
    laserStepInterval: 0.2,
  };
}

/**
 * One scene's measurement, exactly as {@link sampleSceneInPage} returns it and `drawCalls.spec.js` reports
 * it.
 *
 * @typedef {object} SceneComposition
 * @property {string} state - the game-state machine's current state name at the moment sampled.
 * @property {number[] | null} snakeLengths - both snakes' `length`, player order; `null` when no round is
 *   live (a menu screen outside a match, or `MATCH_OVER`, where `__kobi.getSnapshot()` itself is `null` —
 *   `tests/agent/README.md`'s own documented shape, KI-03-06 / #119 F5).
 * @property {number | null} appleCount
 * @property {number | null} pickupCount
 * @property {string | null} laserPhase
 * @property {number | null} laserInset
 */

/**
 * @typedef {object} SceneSample
 * @property {number} drawCalls
 * @property {SceneComposition} composition
 * @property {boolean} reached - whether this scene's target condition was actually met (both policy-driven
 *   scenes can fail a given seed — a death, or running out of {@link SCENE_MAX_FRAMES} — in which case
 *   `drawCalls.spec.js` retries with the next seed rather than trusting a sample that never arrived).
 */

/**
 * The measurement, as it runs **inside the page** — every scene this file names, switched on `args.scene`.
 * One self-contained function with no free variables (this file's module doc, "Shape"): every helper is
 * nested inside it, nothing is imported or referenced from `drawCalls.js`'s own scope, and `args` carries
 * everything a Node-side caller derived (settings overrides, policy source text, frame/guard budgets).
 *
 * @param {{
 *   scene: 'opening-board' | 'mid-round-long-snakes' | 'laser-warning' | 'endgame-6x6' |
 *     'menu-main-menu' | 'menu-match-setup' | 'menu-pause' | 'menu-round-over' | 'menu-match-over' | 'menu-replay',
 *   bestOf: number,
 *   powerUpsEnabled: boolean | null,
 *   settingsOverrides: object | null,
 *   frameSeconds: number,
 *   maxFrames: number,
 *   guardSteps: number,
 *   guardChunkSeconds: number,
 *   lengthTarget: number,
 *   policySources: [string | null, string | null] | null,
 * }} args
 * @returns {SceneSample}
 */
export function sampleSceneInPage(args) {
  const {
    scene,
    bestOf,
    powerUpsEnabled,
    settingsOverrides,
    frameSeconds,
    maxFrames,
    guardSteps,
    guardChunkSeconds,
    lengthTarget,
    policySources,
  } = args;

  const kobi = /** @type {any} */ (globalThis).__kobi;
  const grid = { width: 24, height: 24 };

  /** `new Function` rather than `eval`, matching `driver.js`'s own comment on the identical line. */
  const compile = (/** @type {string | null} */ src) =>
    src === null ? null : new Function('return (' + src + ')')();

  /** @param {string} state */
  function composition(state) {
    const snapshot = kobi.getSnapshot();
    if (snapshot === null) {
      return {
        state,
        snakeLengths: null,
        appleCount: null,
        pickupCount: null,
        laserPhase: null,
        laserInset: null,
      };
    }
    return {
      state,
      snakeLengths: snapshot.snakes.map((/** @type {any} */ snake) => snake.length),
      appleCount: snapshot.apples.length,
      pickupCount: snapshot.powerUps.pickups.length,
      laserPhase: snapshot.lasers.phase,
      laserInset: snapshot.lasers.inset,
    };
  }

  /** One render, at exactly the moment being sampled — see this file's module doc, "Rendering is the entire
   * cost". Returns the finished {@link SceneSample}. */
  function sampleNow(/** @type {boolean} */ reached) {
    kobi.fastForward(0);
    return { drawCalls: kobi.getDrawCalls(), composition: composition(kobi.getState()), reached };
  }

  function stepPastCountdown() {
    for (let i = 0; i < guardSteps && kobi.getState() === 'COUNTDOWN'; i += 1) {
      kobi.advance(guardChunkSeconds);
    }
  }

  /** True while `state` is one a policy-driven scene can still be steering through — a round that has left
   * this set has ended (death or timeout) before the scene's target condition was met. */
  function isLivePlayState(/** @type {string} */ state) {
    return state === 'COUNTDOWN' || state === 'PLAYING' || state === 'LASER_WARNING';
  }

  /** Asks each policy once per grid step and dispatches its move — `driver.js`'s own `runMatchInPage` loop,
   * inlined because this in-page function may not reference that module. */
  function drivePolicies(
    /** @type {((view: object) => string | null)[]} */ policies,
    /** @type {(string | null)[]} */ lastHeadKeys,
  ) {
    const snapshot = kobi.getSnapshot();
    if (snapshot === null) return;
    for (let i = 0; i < 2; i += 1) {
      const policy = policies[i];
      const snake = snapshot.snakes[i];
      if (policy === null || snake === undefined || !snake.alive) continue;
      const head = snake.segments[0];
      const headKey = head.x + ',' + head.y;
      if (headKey === lastHeadKeys[i]) continue;
      lastHeadKeys[i] = headKey;
      const move = policy({ snapshot, playerIndex: i, grid, decisionIndex: 0 });
      if (move !== null && move !== undefined) kobi.pressKey(i + 1, move);
    }
  }

  if (settingsOverrides !== null) kobi.setSettingsOverrides(settingsOverrides);

  switch (scene) {
    case 'menu-main-menu': {
      return sampleNow(true);
    }
    case 'menu-match-setup': {
      kobi.stateMachine.dispatch('SELECT_2P');
      return sampleNow(kobi.getState() === 'MATCH_SETUP');
    }
    case 'menu-replay': {
      kobi.stateMachine.dispatch('SELECT_REPLAY');
      return sampleNow(kobi.getState() === 'REPLAY');
    }
    case 'menu-pause': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      kobi.pause();
      return sampleNow(kobi.getState() === 'PAUSE');
    }
    case 'menu-round-over': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      // P1 spawns (5, 12) heading RIGHT (`DESIGN-DECISIONS §2.3`); UP kills it on the top wall at 2.0 s.
      // P2 is unsteered and does not reach its own wall until ≈3.167 s, so P1 dies alone and P2 takes the
      // round — the identical script `tests/visual/screens.visual.spec.js`'s ROUND_OVER baseline uses.
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3); // crash + the 0.6 s slow-mo beat -> ROUND_OVER
      return sampleNow(kobi.getState() === 'ROUND_OVER');
    }
    case 'menu-match-over': {
      kobi.startMatch({ bestOf, powerUpsEnabled }); // bestOf: 1 — one scripted crash decides the match.
      stepPastCountdown();
      kobi.pressKey(1, 'UP');
      kobi.fastForward(3); // crash + slow-mo -> ROUND_OVER
      kobi.fastForward(3); // scoreboardSeconds (2.5 s) -> MATCH_OVER
      return sampleNow(kobi.getState() === 'MATCH_OVER');
    }
    case 'opening-board': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      return sampleNow(kobi.getState() === 'PLAYING');
    }
    case 'laser-warning': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      for (
        let i = 0;
        i < guardSteps && (kobi.getSnapshot()?.lasers.phase ?? 'PARKED') === 'PARKED';
        i += 1
      ) {
        kobi.advance(guardChunkSeconds);
      }
      const reached = (kobi.getSnapshot()?.lasers.phase ?? 'PARKED') !== 'PARKED';
      return sampleNow(reached);
    }
    case 'mid-round-long-snakes': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      const policies = [compile(policySources[0]), compile(policySources[1])];
      const lastHeadKeys = [null, null];
      let frames = 0;
      let reached = false;
      while (frames < maxFrames) {
        const state = kobi.getState();
        if (!isLivePlayState(state)) break; // a death or a timeout ended the round on this seed.
        const snapshot = kobi.getSnapshot();
        if (snapshot !== null) {
          drivePolicies(policies, lastHeadKeys);
          if (
            snapshot.snakes.length === 2 &&
            snapshot.snakes.every((/** @type {any} */ snake) => snake.alive) &&
            snapshot.snakes.every((/** @type {any} */ snake) => snake.length >= lengthTarget)
          ) {
            reached = true;
            break;
          }
        }
        kobi.advance(frameSeconds);
        frames += 1;
      }
      return sampleNow(reached);
    }
    case 'endgame-6x6': {
      kobi.startMatch({ bestOf, powerUpsEnabled });
      stepPastCountdown();
      const policies = [compile(policySources[0]), compile(policySources[1])];
      const lastHeadKeys = [null, null];
      let frames = 0;
      let reached = false;
      while (frames < maxFrames) {
        const state = kobi.getState();
        if (!isLivePlayState(state)) break; // a death ended the round before the squeeze finished.
        const snapshot = kobi.getSnapshot();
        if (snapshot !== null) {
          drivePolicies(policies, lastHeadKeys);
          if (snapshot.lasers.phase === 'STOPPED') {
            reached = true;
            break;
          }
        }
        kobi.advance(frameSeconds);
        frames += 1;
      }
      return sampleNow(reached);
    }
    default:
      throw new Error('sampleSceneInPage: unknown scene "' + scene + '"');
  }
}

/**
 * One row of the report {@link buildDrawCallsReportTable} renders — a scene's measured figure next to its
 * budget comparison and its committed baseline.
 *
 * @typedef {object} DrawCallRow
 * @property {string} slug
 * @property {number} drawCalls
 * @property {SceneComposition} composition
 */

/**
 * Compares one measured figure against {@link DRAW_CALL_BUDGET} — the pure arithmetic behind every assertion
 * this ticket makes, unit-tested in `drawCalls.test.js` against a fabricated over-budget row (tech-lead
 * ruling 7) rather than proved only by hand.
 *
 * @param {number} drawCalls
 * @returns {{drawCalls: number, budget: number, pctOfBudget: number, overBudget: boolean}}
 */
export function checkDrawCallBudget(drawCalls) {
  return {
    drawCalls,
    budget: DRAW_CALL_BUDGET,
    pctOfBudget: Math.round((drawCalls / DRAW_CALL_BUDGET) * 100),
    overBudget: drawCalls > DRAW_CALL_BUDGET,
  };
}

/**
 * The message a failed gate shows (the sprint's own design constraint, restated by tech-lead ruling 7): names
 * the budget, the measurement, and what to do. "What to do" is deliberately not "lower a constant" — if the
 * art genuinely needs more than {@link DRAW_CALL_BUDGET} draw calls, `CLAUDE.md`'s never list and this
 * sprint's own Risks section agree that is a design-lead decision, proposed in a PR labelled
 * `tuning-proposal`, never a quietly raised number in this file.
 *
 * @param {string} slug
 * @param {number} drawCalls
 * @param {SceneComposition} composition
 * @returns {string}
 */
export function buildBudgetFailureMessage(slug, drawCalls, composition) {
  const { pctOfBudget } = checkDrawCallBudget(drawCalls);
  return (
    `KI-08-02: "${slug}" measured ${drawCalls} draw calls, over ARCHITECTURE §12's budget of ` +
    `${DRAW_CALL_BUDGET} (${pctOfBudget}% used). Composition at the sampled frame: state=${composition.state}, ` +
    `snakeLengths=${JSON.stringify(composition.snakeLengths)}, appleCount=${composition.appleCount}, ` +
    `pickupCount=${composition.pickupCount}, laserPhase=${composition.laserPhase}, ` +
    `laserInset=${composition.laserInset}. If the art genuinely needs more than ${DRAW_CALL_BUDGET} draw ` +
    'calls for this scene, that is a design-lead decision — propose it in a PR labelled `tuning-proposal` ' +
    '(CLAUDE.md\'s never list); never raise this constant quietly.'
  );
}

/**
 * The markdown table `drawCalls.spec.js` prints on every run (tech-lead ruling 6: "so drift is visible in a
 * green log"). Measured vs. baseline vs. budget, plus the delta over the `menu-main-menu` floor sample —
 * information, not a second gate: nothing here is asserted on.
 *
 * @param {DrawCallRow[]} rows
 * @returns {string}
 */
export function buildDrawCallsReportTable(rows) {
  const floorRow = rows.find((row) => row.slug === 'menu-main-menu');
  const floor = floorRow === undefined ? 0 : floorRow.drawCalls;
  const header =
    '| Scene | Draw calls | Δ over floor | % of budget | Baseline | Budget |\n' +
    '|---|---|---|---|---|---|';
  const lines = rows.map((row) => {
    const { pctOfBudget } = checkDrawCallBudget(row.drawCalls);
    const baseline = BASELINE_DRAW_CALLS[row.slug];
    const baselineText = baseline === undefined ? '—' : String(baseline);
    return (
      `| ${row.slug} | ${row.drawCalls} | ${row.drawCalls - floor} | ${pctOfBudget}% | ${baselineText} | ` +
      `${DRAW_CALL_BUDGET} |`
    );
  });
  return [header, ...lines].join('\n');
}
