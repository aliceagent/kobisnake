// @ts-check
import { EVENTS } from '../core/events.js';
import { createMatch } from '../core/match.js';
import { createRng } from '../core/rng.js';
import { RoundSimulation } from '../core/round.js';
import { SETTINGS } from '../core/settings.js';
import { createGameStateMachine, GAME_EVENTS, STATES } from './gameStateMachine.js';
import { createInput } from './input.js';
import { createLoop } from './loop.js';

/**
 * Session wiring (KS-05-03): the game state machine, a best-of match, one round simulation at a time, the
 * frame loop, the keyboard and the screens, all joined up here.
 *
 * Sprint 03 left a deliberate placeholder in this file — a `phase` variable and a "press Enter for another
 * round" flow — inside a banner promising that Sprint 05 would delete it and hand the job to
 * `gameStateMachine.js`. This is that. The session now owns no flow logic of its own: the machine decides
 * which state the game is in, this file decides when to send it an event and what each state does per frame,
 * and `ui.show(state, props)` puts the matching screen up.
 *
 * ## Two clocks, deliberately kept apart
 *
 * The sprint's own Risks section names the trap: "slow-mo uses wall time while the sim uses sim time; keep
 * them separate or the timer drifts". So every frame arrives here as a *pair* of durations from `loop.js`:
 *
 * - `dt` — **simulated** seconds: the frame's real duration multiplied by `loop.timeScale`. It is 0.25×
 *   during the crash slow-mo beat and exactly 0 while paused. Only the round simulation and the laser-warning
 *   sub-state run on it, which is what makes "pausing or a slow frame never steals time"
 *   (`DESIGN-DECISIONS §2.1`) true by construction rather than by care.
 * - `unscaledDt` — **wall** seconds: the frame's real duration, untouched. The countdown, the scoreboard, the
 *   READY? beat and the slow-mo beat's own length run on it, because all four are presentation timings a
 *   player experiences in real seconds. `crashSlowMo.duration` is 0.6 s of wall time by the ticket's own
 *   wording; measuring it in simulated seconds would stretch it to 2.4 s, since the whole point of the beat
 *   is that simulated time is running at a quarter speed while it plays.
 *
 * Nothing but PAUSE stops the wall clock, and it does so by state rather than by scale: the `switch` in
 * `runUpdate` simply has nothing to do in PAUSE. `loop.timeScale` still goes to 0 there, so anything else
 * that ever reads it sees a frozen game.
 *
 * ## What this file may not do
 *
 * `src/game/` never imports three.js and never touches the DOM (`ARCHITECTURE §3`), so the renderer and the
 * UI arrive as injected objects with the shapes typed below. `main.js` builds the real ones; a unit test
 * builds fakes and drives an entire best-of match in Node. That is the same trick Sprint 03 used, and the
 * reason this rewrite is testable at all.
 */

/** @typedef {import('./input.js').Direction} Direction */
/** @typedef {import('./input.js').MenuAction} MenuAction */
/** @typedef {import('./loop.js').RequestFrame} RequestFrame */
/** @typedef {import('./loop.js').VisibilitySource} VisibilitySource */
/** @typedef {import('./gameStateMachine.js').GameState} GameState */
/** @typedef {import('./gameStateMachine.js').GameEvent} GameEvent */
/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/round.js').SimEvent} SimEvent */
/** @typedef {import('../core/match.js').MatchState} MatchState */
/** @typedef {1 | 2} PlayerNumber */

/**
 * @typedef {object} SessionRenderer
 * @property {(snapshot: object, dt?: number) => void} render
 * @property {() => void} resize
 * @property {{pulseLaserWarning: () => void}} [camera] - the gameplay camera's `LASER_WARNING` reaction
 *   (KS-04-03). Typed as only the one method this file calls, because `src/game/` cannot import three.js and
 *   so can never name the real `GameplayCamera` class.
 */

/**
 * @typedef {object} SessionHud
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 * @property {(durationSeconds: number) => void} showLaserWarning
 * @property {(dt: number) => void} tick
 * @property {() => void} resetWarning
 */

/**
 * The screen router (`ARCHITECTURE §8`; built by KS-05-04). `show` is idempotent and re-renderable: this file
 * calls it again with new props whenever the props change, which for the countdown is four times a round.
 *
 * @typedef {object} SessionUi
 * @property {SessionHud} hud
 * @property {(state: GameState, props?: object) => void} show
 * @property {(action: MenuAction) => void} handleMenuAction - routes one key action into the focus model of
 *   whichever screen is up. The screens deliberately do not listen for keys themselves: `input.js` owns the
 *   keyboard for the whole app, and a second listener would fire Enter twice.
 */

/**
 * The object the setup screen edits and a match is played from. `musicTrack` and `powerUpsEnabled` are
 * carried and honoured as far as this sprint can honour them — Sprint 06 gives power-ups behaviour and Sprint
 * 12 gives the track a tune — but they are chosen here, now, because the setup screen has to have something
 * real to change.
 *
 * @typedef {object} MatchSettings
 * @property {number} bestOf - one of `settings.bestOfOptions`
 * @property {boolean} powerUpsEnabled
 * @property {string} musicTrack - one of `matchSetup.js`'s `MUSIC_TRACKS` (`DESIGN-DECISIONS §3`, "MUSIC
 *   (three pills)"). A track *identifier* rather than a number, because `ARCHITECTURE §3` already names the
 *   modules it will select — `src/audio/tracks/track1.js` … `track3.js` — and Sprint 12 should not have to
 *   invent a mapping from 1/2/3 onto them.
 * @property {{1: string, 2: string}} colors - a colour name per player, from `SETTINGS.colors`
 */

/**
 * The pieces of `RoundSimulation.getState()` this file reads. `round.js` only promises `object`, so every
 * reader casts to the shape it actually needs.
 *
 * @typedef {object} RoundSnapshot
 * @property {number | null} timeRemaining
 * @property {{length: number}[]} snakes
 */

/**
 * Anything shaped like a window for the purpose of noticing focus loss. `window` satisfies it; a test passes
 * a plain `EventTarget`.
 *
 * @typedef {object} BlurSource
 * @property {(type: string, listener: () => void) => void} addEventListener
 * @property {(type: string, listener: () => void) => void} removeEventListener
 */

/**
 * @typedef {object} CreateSessionOptions
 * @property {SessionRenderer} renderer
 * @property {SessionUi} ui
 * @property {number | null} seed - a fixed `?seed`. It seeds the **match**, not a round: every round derives
 *   its own seed from it plus the round index (see {@link roundSeedFor}), so a `?seed` visual baseline is
 *   still exactly reproducible while five rounds in a row are not the same board five times.
 * @property {Settings} [settings] - defaults to the shipping `SETTINGS`
 * @property {Partial<MatchSettings>} [matchSettings] - overrides for the starting match setup
 * @property {string[]} [ownedColors] - colours the player may choose between. Red and Blue from the start
 *   (`DESIGN-DECISIONS §1` row 12); the other six unlock in Sprint 14's shop.
 * @property {EventTarget} [inputTarget]
 * @property {RequestFrame} [requestFrame]
 * @property {(handle: number) => void} [cancelFrame]
 * @property {() => number} [now]
 * @property {VisibilitySource | null} [visibilitySource]
 * @property {BlurSource | null} [blurSource] - where the window `blur` that triggers `AUTO_PAUSE` comes from
 *   (`DESIGN-DECISIONS §2.8`: "losing window focus pauses automatically"). Defaults to `window` where there
 *   is one; pass `null` to opt out.
 * @property {boolean} [strict] - forwarded to the state machine: throw on an illegal transition (development
 *   and tests) or ignore and log it once (production).
 * @property {() => number} [randomSeed] - draws a match seed when none is fixed; defaults to `Date.now`
 */

/** HUD timer text is throttled to 10 Hz (`ARCHITECTURE §8`). */
const HUD_INTERVAL_SECONDS = 1 / 10;

/**
 * The countdown's four beats, in order (`DESIGN-DECISIONS §2.4`). Each lasts `countdownStepSeconds`, read
 * from `SETTINGS` and never retyped here. Inputs are accepted into the snakes' queues during the last one —
 * the design says "during GO", so the index of `'GO'` is the gate rather than a hard-coded 3.
 */
const COUNTDOWN_LABELS = ['3', '2', '1', 'GO'];

/** The label the countdown screen shows for the post-pause beat (`DESIGN-DECISIONS §2.8`). */
const READY_LABEL = 'READY?';

/**
 * How long the READY? beat lasts, in wall seconds. `DESIGN-DECISIONS §2.8` fixes it at one second and
 * `SETTINGS` has no entry for it. A module constant quoting the rule is the honest way to hold a design
 * number this file needs; adding a key to `settings.js` would be changing a tunable, which this ticket may
 * not do.
 */
const READY_SECONDS = 1;

/**
 * How long the scoreboard must have been up before Enter may skip it, in wall seconds. `DESIGN-DECISIONS
 * §2.6`: "scoreboard for 2.5 s (or Enter to skip after 1 s)". The 2.5 is `settings.scoreboardSeconds`; the 1
 * has no `SETTINGS` entry, so it lives here for the same reason {@link READY_SECONDS} does.
 */
const SCOREBOARD_SKIP_AFTER_SECONDS = 1;

/**
 * `RoundSimulation` player ids, in player-number order. `input.js` reports the plain numbers 1 and 2;
 * `applyInput` wants the string ids the round was built with.
 * @type {string[]}
 */
const PLAYER_IDS = ['p1', 'p2'];

/** Colours a player may pick between before the shop exists (`DESIGN-DECISIONS §1` row 12). */
const DEFAULT_OWNED_COLORS = ['red', 'blue'];

/** What the renderer draws when there is no round: an empty arena. */
const EMPTY_SNAPSHOT = { snakes: [], apples: [] };

/**
 * The starting match setup. Player 1 is red and player 2 is blue because that is what
 * `render/renderer.js`'s `DEFAULT_PLAYER_COLORS` has drawn since Sprint 03 — the setup screen now chooses
 * explicitly what used to be a renderer default, and choosing the same two keeps every existing visual
 * baseline valid.
 *
 * `bestOf` starts at the middle of `settings.bestOfOptions`. `DESIGN-DECISIONS` fixes the three formats but
 * never says which one a player lands on first; Best of 3 is the least committal of the three, and it is
 * flagged in the PR for the design lead rather than presented as a rule.
 *
 * @param {Settings} settings
 * @returns {MatchSettings}
 */
function defaultMatchSettings(settings) {
  return {
    bestOf: settings.bestOfOptions[Math.floor(settings.bestOfOptions.length / 2)],
    powerUpsEnabled: settings.powerUpsEnabled,
    // The first of `matchSetup.js`'s `MUSIC_TRACKS`. Not imported from there: `src/game/` must not depend on
    // `src/ui/` (`ARCHITECTURE §3` runs the dependency the other way), and this is a default the session
    // owns, not a catalogue — the setup screen owns the catalogue and cycles through it.
    musicTrack: 'track1',
    colors: { 1: 'red', 2: 'blue' },
  };
}

/**
 * Format simulated seconds remaining as `m:ss` (`ARCHITECTURE §8`): 90 → `"1:30"`. Floors rather than rounds,
 * so the timer never reads a number a moment before the clock actually reaches it.
 *
 * @param {number} secondsRemaining
 * @returns {string}
 */
export function formatTime(secondsRemaining) {
  const wholeSeconds = Math.floor(Math.max(0, secondsRemaining));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The seed for round `index` of a match, derived from the match seed (`AC4`: "round seeds differ per round
 * but are reproducible from the match seed").
 *
 * It walks a fresh `mulberry32` stream from the match seed and takes the `index`-th draw, rather than keeping
 * one long-lived generator. Restarting the stream each time is what makes the function *pure*: the seed of
 * round 3 is the same number whether it is asked for during round 3, during a replay, or by a test that never
 * played rounds 0 to 2. A match is at most five rounds, so walking the stream costs nothing.
 *
 * @param {number} matchSeed
 * @param {number} index - 0 for the first round
 * @returns {number}
 */
export function roundSeedFor(matchSeed, index) {
  const rng = createRng(matchSeed);
  let seed = 0;
  for (let round = 0; round <= index; round += 1) {
    // `next()` is a float in [0, 1); scaling it to the full 32-bit range gives back the kind of integer seed
    // `createRng` itself takes, and keeps consecutive rounds far apart rather than adjacent.
    seed = Math.floor(rng.next() * 0x1_0000_0000);
  }
  return seed;
}

/**
 * Wire a session together and hand back its lifecycle controls.
 *
 * @param {CreateSessionOptions} options
 */
export function createSession({
  renderer,
  ui,
  seed,
  settings = SETTINGS,
  matchSettings: matchSettingsOverrides,
  ownedColors = DEFAULT_OWNED_COLORS,
  inputTarget,
  requestFrame,
  cancelFrame,
  now,
  visibilitySource,
  blurSource,
  strict = true,
  randomSeed = Date.now,
}) {
  /** @type {MatchSettings} */
  let matchSettings = { ...defaultMatchSettings(settings), ...matchSettingsOverrides };

  /** The seed the *next* match is built from; `null` means "draw a fresh one". @type {number | null} */
  let fixedSeed = seed;
  /** The seed the match in progress was built from. */
  let matchSeed = 0;
  /** @type {MatchState | null} */
  let match = null;
  /** @type {RoundSimulation | null} */
  let sim = null;
  /** Which round of the match is being played, from 0. */
  let roundIndex = 0;
  /** Every round seed this match has used, in order — `__kobi` exposes it for replays. @type {number[]} */
  let roundSeeds = [];
  /** Set by the pause screen's "Restart match", consumed by the countdown that follows it. */
  let restartRequested = false;

  /** Wall seconds elapsed inside the current countdown. */
  let countdownElapsed = 0;
  /** Which of {@link COUNTDOWN_LABELS} is currently on screen; -1 outside a countdown. */
  let countdownStep = -1;
  /** Simulated seconds left of the laser-warning sub-state; 0 when it is not showing. */
  let warningRemaining = 0;
  /** Wall seconds left of the crash slow-mo beat; 0 when it is not playing. */
  let slowMoRemaining = 0;
  /** Wall seconds left of the post-pause READY? beat; 0 when it is not showing. */
  let readyRemaining = 0;
  /** Wall seconds the scoreboard has been up. */
  let scoreboardElapsed = 0;
  /** The simulation's own `ROUND_OVER` event, held while the slow-mo beat plays. @type {SimEvent | null} */
  let pendingRoundOver = null;
  /** `loop.timeScale` as it was when PAUSE was entered, so RESUME can put slow-mo back mid-beat. */
  let timeScaleBeforePause = 1;
  /** Seconds since the HUD text was last written; flushed at {@link HUD_INTERVAL_SECONDS}. */
  let hudAccumulator = 0;
  /** The frame's real duration, remembered for the renderer, which wants wall dt for its own decay. */
  let lastDt = 0;

  // --- screens ------------------------------------------------------------------------------------------

  function showMainMenu() {
    // Leaving a match, however it is left, must not leave its round running underneath the menu.
    sim = null;
    match = null;
    loop.timeScale = 1;
    resetRoundTimers();
    ui.hud.resetWarning();
    ui.show(STATES.MAIN_MENU, {
      /** @param {string} event */
      onSelect(event) {
        if (machine.can(/** @type {any} */ (event))) machine.dispatch(/** @type {any} */ (event));
      },
    });
  }

  function showMatchSetup() {
    ui.show(STATES.MATCH_SETUP, {
      matchSettings,
      ownedColors,
      /** @param {MatchSettings} next */
      onChange(next) {
        matchSettings = next;
        // Re-rendered from the session's copy rather than the screen's, so there is exactly one authority on
        // what the match settings are and the screen cannot drift from it.
        showMatchSetup();
      },
      onStart: () => machine.dispatch(GAME_EVENTS.START_MATCH),
      onBack: () => machine.dispatch(GAME_EVENTS.BACK),
    });
  }

  function enterCountdown() {
    // A countdown is reached three ways: START_MATCH (a new match), NEXT_ROUND (the next round of the match
    // in progress) and REMATCH (a fresh match on the same settings, from MATCH_OVER or from the pause
    // screen's "Restart match"). Only the first and the last need a new match built.
    if (match === null || match.isOver() || restartRequested) startMatchState();
    startRound();
  }

  function enterPlaying() {
    ui.show(STATES.PLAYING);
  }

  function enterLaserWarning() {
    warningRemaining = settings.laserWarningDuration;
    // KS-04-03's banner, red timer and camera pulse, on the simulation's own event rather than on a timer of
    // this file's own — and `laserWarningDuration` is the same number `lasers.js` scheduled the warning from.
    ui.hud.showLaserWarning(settings.laserWarningDuration);
    renderer.camera?.pulseLaserWarning();
    ui.show(STATES.LASER_WARNING);
  }

  function enterRoundOver() {
    const result = /** @type {string | null} */ (pendingRoundOver?.result ?? null);
    pendingRoundOver = null;
    scoreboardElapsed = 0;
    match?.recordRound(/** @type {any} */ (result));
    ui.show(STATES.ROUND_OVER, scoreboardProps(result));
  }

  function enterMatchOver() {
    const current = /** @type {MatchState} */ (match);
    ui.show(STATES.MATCH_OVER, {
      winner: current.winner,
      colorNames: matchSettings.colors,
      wins: current.wins,
      bestOf: current.bestOf,
      // Display only this sprint: keys are persisted in Sprint 13, and nothing here writes storage.
      keys: current.rewardKeys,
      onRematch: () => machine.dispatch(GAME_EVENTS.REMATCH),
      onMenu: () => machine.dispatch(GAME_EVENTS.QUIT_TO_MENU),
    });
  }

  function enterPause() {
    // Remembered rather than assumed to be 1: Esc during the crash slow-mo beat must resume into the same
    // slow-mo it interrupted rather than snapping the game back to full speed.
    timeScaleBeforePause = loop.timeScale;
    loop.timeScale = 0;
    ui.show(STATES.PAUSE, {
      onResume: resume,
      // Esc on the pause screen resumes (`§2.8`, issue #82), through the same handler and therefore the same
      // READY? beat — but carrying the event the player actually expressed, so the machine's `BACK` row is
      // the one that fires and the transition table stays an honest record of what the UI does.
      onBack: () => resume(GAME_EVENTS.BACK),
      onRestart() {
        restartRequested = true;
        machine.dispatch(GAME_EVENTS.REMATCH);
      },
      onMenu: () => machine.dispatch(GAME_EVENTS.QUIT_TO_MENU),
    });
  }

  /**
   * The scoreboard's props (`DESIGN-DECISIONS §2.6`, GDD "Between-round scoreboard"). A draw carries no
   * winner and changes no wins — the screen shows "DRAW — REPLAY" and the match replays the round.
   *
   * @param {string | null} result
   */
  function scoreboardProps(result) {
    const current = /** @type {MatchState} */ (match);
    return {
      bestOf: current.bestOf,
      result,
      wins: current.wins,
      winsNeeded: { 1: current.winsNeeded(1), 2: current.winsNeeded(2) },
      colorNames: matchSettings.colors,
    };
  }

  /** Puts the screen for the current state back up — used when the READY? beat ends. */
  function showStateScreen() {
    ui.show(machine.getState());
  }

  // --- match and round lifecycle ------------------------------------------------------------------------

  /** Builds the match whose first round the countdown is counting into. */
  function startMatchState() {
    matchSeed = fixedSeed ?? randomSeed();
    match = createMatch({ bestOf: matchSettings.bestOf, players: playersForMatch(), settings });
    roundIndex = 0;
    roundSeeds = [];
    restartRequested = false;
  }

  /** The two players, carrying the colours chosen on the setup screen into the simulation's snapshot. */
  function playersForMatch() {
    return PLAYER_IDS.map((id, index) => ({
      id,
      color: matchSettings.colors[/** @type {PlayerNumber} */ (index + 1)],
    }));
  }

  /**
   * Creates the round the countdown is counting into: a fresh simulation, frozen — nothing advances it until
   * PLAYING — on this round's own derived seed.
   */
  function startRound() {
    const roundSeed = roundSeedFor(matchSeed, roundIndex);
    roundSeeds[roundIndex] = roundSeed;
    sim = new RoundSimulation({
      settings,
      seed: roundSeed,
      players: playersForMatch(),
      powerUpsEnabled: matchSettings.powerUpsEnabled,
      mode: 'match',
    });

    resetRoundTimers();
    loop.timeScale = 1;
    // Last round's banner and red timer must not carry into a fresh one (KS-04-03).
    ui.hud.resetWarning();
    hudAccumulator = 0;
    writeHud();
    setCountdownStep(0);
  }

  function resetRoundTimers() {
    countdownElapsed = 0;
    countdownStep = -1;
    warningRemaining = 0;
    slowMoRemaining = 0;
    readyRemaining = 0;
    scoreboardElapsed = 0;
    pendingRoundOver = null;
  }

  /** @param {number} step */
  function setCountdownStep(step) {
    countdownStep = step;
    ui.show(STATES.COUNTDOWN, { label: COUNTDOWN_LABELS[step] });
  }

  /** True while the countdown is on its "GO" beat, when inputs start being queued (`§2.4`). */
  function countdownAcceptsInput() {
    return countdownStep === COUNTDOWN_LABELS.indexOf('GO');
  }

  /** Ends the round: the scoreboard is next, whether the round ended on a crash or on the clock. */
  function finishRound() {
    loop.timeScale = 1;
    machine.dispatch(GAME_EVENTS.ROUND_OVER);
  }

  /**
   * Leaves the scoreboard for the next round, or for the match-over screen when the match is decided.
   *
   * A draw advances `roundIndex` like any other round, so the replay gets a *new* board rather than the same
   * one again. `DESIGN-DECISIONS §2.5` says only "the match simply replays the round", and either reading is
   * defensible — but replaying the identical seed would make a drawn round that nobody steers draw forever,
   * which is a real state a bot run or an idle keyboard can reach. A fresh board cannot deadlock.
   */
  function leaveScoreboard() {
    const current = /** @type {MatchState} */ (match);
    if (current.isOver()) {
      machine.dispatch(GAME_EVENTS.MATCH_OVER);
      return;
    }
    roundIndex += 1;
    machine.dispatch(GAME_EVENTS.NEXT_ROUND);
  }

  // --- per-frame ----------------------------------------------------------------------------------------

  /**
   * One frame. `dt` is simulated seconds (already scaled by `loop.timeScale`); `unscaledDt` is the frame's
   * real duration. Which of the two a given timer uses is the subject of this file's header comment.
   *
   * @param {number} dt
   * @param {number} unscaledDt
   */
  function runUpdate(dt, unscaledDt) {
    lastDt = unscaledDt;

    switch (machine.getState()) {
      case STATES.COUNTDOWN:
        advanceCountdown(unscaledDt);
        break;
      case STATES.PLAYING:
      case STATES.LASER_WARNING:
        if (readyRemaining > 0) advanceReady(unscaledDt);
        else advanceRound(dt, unscaledDt);
        break;
      case STATES.ROUND_OVER:
        advanceScoreboard(unscaledDt);
        break;
      default:
        // Menus and PAUSE: nothing ticks. The frame still renders, which is what a pause screen over a frozen
        // arena needs (`ARCHITECTURE §5`).
        break;
    }

    ui.hud.tick(dt);
    hudAccumulator += unscaledDt;
    if (hudAccumulator >= HUD_INTERVAL_SECONDS) {
      hudAccumulator = 0;
      writeHud();
    }
  }

  /**
   * The frame that ends the countdown gives the round nothing: it dispatches `COUNTDOWN_DONE` and returns,
   * and the next frame is the round's first. So a round always begins at tick 0 exactly, rather than at
   * whatever fraction of a frame happened to be left over when "GO" ran out — which is worth more than the
   * few milliseconds it costs, once a round, both to a player (the snakes start when GO clears) and to every
   * visual baseline, which can now name an absolute tick and get it.
   *
   * @param {number} unscaledDt
   */
  function advanceCountdown(unscaledDt) {
    countdownElapsed += unscaledDt;
    const step = Math.floor(countdownElapsed / settings.countdownStepSeconds);
    if (step >= COUNTDOWN_LABELS.length) {
      machine.dispatch(GAME_EVENTS.COUNTDOWN_DONE);
      return;
    }
    if (step !== countdownStep) setCountdownStep(step);
  }

  /** @param {number} unscaledDt */
  function advanceReady(unscaledDt) {
    readyRemaining -= unscaledDt;
    if (readyRemaining > 0) return;
    readyRemaining = 0;
    loop.timeScale = timeScaleBeforePause;
    showStateScreen();
  }

  /**
   * @param {number} dt - simulated seconds
   * @param {number} unscaledDt - wall seconds
   */
  function advanceRound(dt, unscaledDt) {
    if (sim !== null) handleSimEvents(sim.advance(dt));

    // The laser warning is five seconds of the *round's* timeline (`§2.4`), so it runs on simulated time and
    // freezes with everything else when the game is paused.
    if (warningRemaining > 0 && machine.is(STATES.LASER_WARNING)) {
      warningRemaining -= dt;
      if (warningRemaining <= 0) {
        warningRemaining = 0;
        machine.dispatch(GAME_EVENTS.LASER_WARNING_DONE);
      }
    }

    if (slowMoRemaining > 0) {
      slowMoRemaining -= unscaledDt;
      if (slowMoRemaining <= 0) {
        slowMoRemaining = 0;
        finishRound();
      }
    }
  }

  /** @param {number} unscaledDt */
  function advanceScoreboard(unscaledDt) {
    scoreboardElapsed += unscaledDt;
    if (scoreboardElapsed >= settings.scoreboardSeconds) leaveScoreboard();
  }

  /**
   * Turns the simulation's announcements into state-machine events.
   *
   * The order matters. `round.js` ends a round the instant a snake dies, so a crash produces `SNAKE_DIED`
   * *and* `ROUND_OVER` inside the same `advance()` call. The scoreboard must not appear on that frame: the
   * crash gets `crashSlowMo.duration` of wall time first (`DESIGN-DECISIONS §2.5`). So the round-over event
   * is *held* while the beat plays, and the transition happens when the beat ends. A round that ends on the
   * clock emits no `SNAKE_DIED`, so there is no beat to wait for and it goes straight to the scoreboard.
   *
   * @param {SimEvent[]} events
   */
  function handleSimEvents(events) {
    for (const event of events) {
      if (event.type === EVENTS.LASER_WARNING) {
        if (machine.can(GAME_EVENTS.LASER_WARNING)) machine.dispatch(GAME_EVENTS.LASER_WARNING);
      } else if (event.type === EVENTS.SNAKE_DIED) {
        // Two snakes dying in the same step (a draw) is one beat, not two.
        if (slowMoRemaining <= 0) {
          slowMoRemaining = settings.crashSlowMo.duration;
          loop.timeScale = settings.crashSlowMo.scale;
        }
      } else if (event.type === EVENTS.ROUND_OVER) {
        pendingRoundOver = event;
      }
    }
    if (pendingRoundOver !== null && slowMoRemaining <= 0) finishRound();
  }

  /** Writes the timer and both lengths to the HUD right now, bypassing the 10 Hz throttle. */
  function writeHud() {
    if (sim === null) return;
    const state = /** @type {RoundSnapshot} */ (sim.getState());
    ui.hud.setTime(formatTime(state.timeRemaining ?? 0));
    const [p1, p2] = state.snakes;
    ui.hud.setLengths(p1?.length ?? 0, p2?.length ?? 0);
  }

  /** Draws one frame of whatever the sim currently looks like, without advancing anything. */
  function drawFrame() {
    renderer.render(sim === null ? EMPTY_SNAPSHOT : sim.getState(), lastDt);
  }

  // --- input --------------------------------------------------------------------------------------------

  /**
   * A steering key. Ignored unless a round is actually taking input: during PLAYING and LASER_WARNING, and
   * during the countdown's "GO" beat, where `DESIGN-DECISIONS §2.4` says inputs are queued so a player can
   * commit to a first turn before the snakes start moving.
   *
   * @param {number} playerNumber
   * @param {Direction} dir
   */
  function handleDirection(playerNumber, dir) {
    if (sim === null) return;
    const state = machine.getState();
    const playing = state === STATES.PLAYING || state === STATES.LASER_WARNING;
    if (!playing && !(state === STATES.COUNTDOWN && countdownAcceptsInput())) return;
    if (playing && readyRemaining > 0) return;
    const playerId = PLAYER_IDS[playerNumber - 1];
    if (playerId === undefined) return;
    sim.applyInput(playerId, dir);
  }

  /**
   * A menu key. Most states hand it straight to the active screen's focus model; the three that do not are
   * the three with no focusable screen of their own:
   *
   * - **PLAYING / LASER_WARNING** — Esc opens the pause screen (`DESIGN-DECISIONS §2.8`), and nothing else.
   * - **COUNTDOWN** — nothing at all. Mashing Enter through the countdown is a thing players do and a thing
   *   this sprint's QA plan explicitly tries; it must not skip the countdown or start anything twice.
   * - **ROUND_OVER** — Enter skips the scoreboard, but only once it has been up for
   *   {@link SCOREBOARD_SKIP_AFTER_SECONDS} (`§2.6`), so the Enter that was still held from the round cannot
   *   also skip the scoreboard that round produced.
   *
   * @param {MenuAction} action
   */
  function handleMenuAction(action) {
    switch (machine.getState()) {
      case STATES.PLAYING:
      case STATES.LASER_WARNING:
        if (action === 'BACK' && readyRemaining === 0) machine.dispatch(GAME_EVENTS.PAUSE);
        return;
      case STATES.COUNTDOWN:
        return;
      case STATES.ROUND_OVER:
        if (action === 'CONFIRM' && scoreboardElapsed >= SCOREBOARD_SKIP_AFTER_SECONDS) {
          leaveScoreboard();
        }
        return;
      default:
        ui.handleMenuAction(action);
    }
  }

  /**
   * The tab came back, or the window lost focus: pause automatically (`DESIGN-DECISIONS §2.8`). Guarded by
   * `can()` rather than dispatched blind, because focus is lost from menus too, and an illegal transition
   * would throw in development over something the player did nothing wrong to cause.
   */
  function autoPause() {
    if (machine.can(GAME_EVENTS.AUTO_PAUSE)) machine.dispatch(GAME_EVENTS.AUTO_PAUSE);
  }

  /**
   * Resume from pause: back to the state pause came from, after a one-second READY? (`§2.8`).
   *
   * `event` is which of the two ways out of the pause screen the player took. Both rows in
   * `TRANSITIONS[PAUSE]` resolve to `PREVIOUS`, so the destination is identical; what differs is only the
   * intention recorded in the transition — the RESUME item, or Esc (`BACK`, issue #82). Everything after the
   * dispatch is shared, which is the whole point of routing both through one function.
   *
   * @param {GameEvent} [event]
   */
  function resume(event = GAME_EVENTS.RESUME) {
    if (!machine.can(event)) return;
    machine.dispatch(event);
    readyRemaining = READY_SECONDS;
    // Still frozen through the beat — "resuming from pause shows a 1-second READY? then continues".
    loop.timeScale = 0;
    ui.show(STATES.COUNTDOWN, { label: READY_LABEL });
  }

  const machine = createGameStateMachine({
    strict,
    onEnter: {
      [STATES.MAIN_MENU]: showMainMenu,
      [STATES.MATCH_SETUP]: showMatchSetup,
      [STATES.COUNTDOWN]: enterCountdown,
      [STATES.PLAYING]: enterPlaying,
      [STATES.LASER_WARNING]: enterLaserWarning,
      [STATES.ROUND_OVER]: enterRoundOver,
      [STATES.MATCH_OVER]: enterMatchOver,
      [STATES.PAUSE]: enterPause,
    },
  });

  const input = createInput({
    onDirection: handleDirection,
    onMenu: handleMenuAction,
    // 'both' for the session's whole life: the same key means steering in one state and navigation in
    // another, and the two handlers above already know which state they are in. Switching `input.js`'s mode
    // on every transition would put the same knowledge in two places.
    mode: 'both',
    target: inputTarget,
  });

  const loop = createLoop({
    update: runUpdate,
    render: drawFrame,
    onAutoPause: autoPause,
    requestFrame,
    cancelFrame,
    now,
    visibilitySource,
  });

  // `DESIGN-DECISIONS §2.8`: "losing window focus pauses automatically". `loop.js`'s own `onAutoPause` covers
  // the tab being backgrounded and coming back; a window that merely loses focus — another window clicked, an
  // alt-tab that does not hide the page — fires `blur` and nothing else. That is the case Sprint 03 carried
  // forward to this ticket.
  const blurTarget =
    blurSource === undefined
      ? /** @type {BlurSource | null} */ (/** @type {any} */ (globalThis).window ?? null)
      : blurSource;
  blurTarget?.addEventListener('blur', autoPause);

  showMainMenu();

  return {
    /** The underlying `loop.js` handle — `.start()` / `.stop()` / `.step(dt)`. */
    loop,
    /** The state machine, for `__kobi` (`ARCHITECTURE §11`) and for tests. */
    machine,
    start() {
      loop.start();
    },
    stop() {
      loop.stop();
    },
    dispose() {
      loop.dispose();
      input.destroy();
      blurTarget?.removeEventListener('blur', autoPause);
    },
    /** @returns {GameState} */
    getState() {
      return machine.getState();
    },
    /** The live `RoundSimulation`, or `null` outside a round. */
    getSim() {
      return sim;
    },
    /** The live `MatchState`, or `null` outside a match. */
    getMatch() {
      return match;
    },
    /** The match settings the setup screen edits — a copy, so a caller cannot edit them behind the screen. */
    getMatchSettings() {
      return { ...matchSettings, colors: { ...matchSettings.colors } };
    },
    /**
     * The seeds this match has used and the match seed they derive from (`AC4`, and the ticket's "round seeds
     * are exposed via `__kobi` for replays").
     */
    getSeeds() {
      return { matchSeed, roundIndex, roundSeeds: [...roundSeeds] };
    },
    /**
     * Runs one update by hand for `unscaledSeconds` of wall time, with no render. `testHooks.js`'s
     * `fastForward` is the caller. The simulated half is scaled by the current `loop.timeScale`, exactly as a
     * real frame would be, so fast-forwarding through a pause advances nothing and fast-forwarding through
     * the slow-mo beat advances the round at a quarter speed: a fast-forward is the normal path run faster,
     * never a way around it.
     *
     * @param {number} unscaledSeconds
     */
    advanceSimulation(unscaledSeconds) {
      runUpdate(unscaledSeconds * loop.timeScale, unscaledSeconds);
    },
    /**
     * The game loop's current `timeScale` — 1 in ordinary play, 0.25 through the crash slow-mo beat
     * (`DESIGN-DECISIONS §2.5`), 0 while paused. Exposed for `__kobi` (KS-06-00 AC3): a spec that wants to
     * assert the game is *inside* the slow-mo beat rather than past it has no other way to see it, and
     * reading `loop.timeScale` through a getter keeps `loop` itself out of the test-hook contract.
     *
     * @returns {number}
     */
    getTimeScale() {
      return loop.timeScale;
    },
    /** Draws one frame of the sim's current state, without advancing it. */
    renderFrame() {
      drawFrame();
    },
    /**
     * Fixes the seed the **next match** is built from; a match already in progress keeps its own.
     * @param {number | null} nextSeed
     */
    setSeed(nextSeed) {
      fixedSeed = nextSeed;
    },
    /**
     * Drives the machine from the main menu into a countdown, applying `overrides` to the match settings on
     * the way — the two Enter presses a player makes, without the two screens in between. This is what lets
     * an e2e spec reach a round in one call, and every spec in `tests/e2e` and `tests/visual` uses it.
     *
     * @param {Partial<MatchSettings>} [overrides]
     */
    startMatch(overrides) {
      if (!machine.is(STATES.MAIN_MENU)) {
        throw new Error(`startMatch: only from MAIN_MENU, not ${machine.getState()}`);
      }
      machine.dispatch(GAME_EVENTS.SELECT_2P);
      if (overrides !== undefined) {
        matchSettings = { ...matchSettings, ...overrides };
        showMatchSetup();
      }
      machine.dispatch(GAME_EVENTS.START_MATCH);
    },
    /** Opens the pause screen, exactly as Esc does. */
    pause() {
      if (machine.can(GAME_EVENTS.PAUSE)) machine.dispatch(GAME_EVENTS.PAUSE);
    },
    /** Resumes from the pause screen, exactly as its RESUME item does — READY? beat included. */
    resume,
  };
}
