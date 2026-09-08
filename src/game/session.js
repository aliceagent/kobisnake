// @ts-check
import { EVENTS } from '../core/events.js';
import { DIRECTIONS } from '../core/grid.js';
import { createMatch } from '../core/match.js';
import { createRng } from '../core/rng.js';
import { RoundSimulation } from '../core/round.js';
import { SETTINGS, withOverrides } from '../core/settings.js';
import { policyForLevel } from './bots/levels.js';
import { createCpuPlayer } from './cpuPlayer.js';
import { createGameStateMachine, GAME_EVENTS, STATES } from './gameStateMachine.js';
import { createInput } from './input.js';
import { createInputLatencyTracker, disabledInputLatencyStats } from './inputLatency.js';
import { createLoop } from './loop.js';
import { createReplayPlayer } from './replayPlayer.js';

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
 * ## Tuning overrides and the replay recorder (KS-07-01)
 *
 * The `?tuning=1` overlay (`src/ui/screens/tuning.js`) never touches a `RoundSimulation` or `SETTINGS`
 * itself — it hands this file a `withOverrides()`-shaped tree through {@link setSettingsOverrides}, and this
 * file is what turns that into the `settings` the *next* `startRound()` builds its `RoundSimulation` from
 * (AC1: "applies at the next round", never the one in progress, because a running round already captured its
 * own `settings` at construction and never reads this file's variable again).
 *
 * The same override tree is stamped into every round's replay ({@link getReplay}, AC2) alongside a log of
 * every input actually applied and the full event log the round has produced so far — the exact shape
 * `tests/sim/replays/*.json` fixtures use, so a human can save `getReplay()`'s JSON straight into one and it
 * replays identically through `tests/sim/harness.js`'s `runRound`.
 *
 * ## What this file may not do
 *
 * `src/game/` never imports three.js and never touches the DOM (`ARCHITECTURE §3`), so the renderer and the
 * UI arrive as injected objects with the shapes typed below. `main.js` builds the real ones; a unit test
 * builds fakes and drives an entire best-of match in Node. That is the same trick Sprint 03 used, and the
 * reason this rewrite is testable at all.
 *
 * ## KS-07-06 deviation, declared per its own tech-lead notes
 *
 * KS-07-06's `Files:` list is `src/game/input.js`, `src/game/testHooks.js` and its own e2e spec — not this
 * file. Its tech lead anticipated exactly this gap: "queued" is `sim.applyInput` (this file's own
 * `handleDirection`), and "committed step" / "first rendered frame" are only ever visible here, between
 * `sim.advance()` and `renderer.render()` — nowhere in `input.js` can see either. The changes are the
 * smallest that make both observable: a `handleDirectionTimed` counterpart to `handleDirection` (records a
 * keydown's clock reading), one extra argument threaded through `handleDirection` into the new
 * `inputLatency.js` tracker, two calls bracketing the existing `renderer.render()` in `drawFrame`, and a
 * `resetForRound()` call in `startRound`. Nothing here observes `RoundSimulation` any way `getState()`
 * itself does not already offer (`ARCHITECTURE §4`'s "never poll internal fields" survives intact), and the
 * whole tracker is `null` — costing nothing beyond one extra `if` per keydown and one per frame — unless
 * `enableInputStats` is on, which only `main.js`'s `?test=1`/DEV gate ever turns on.
 *
 * ## KI-11-02: the playtest prompt's seam
 *
 * Exactly the same shape as `enableInputStats` above, per tech-lead note 2 on issue #161: `setPlaytestPrompt`
 * assigns a nullable `playtestPrompt` collaborator (`null` on every build without `?playtest=1`, since
 * `main.js` only ever calls it then), and the three call sites that read it —
 * {@link enterRoundOver} (offer the round's due questions), {@link advanceScoreboard} (do not auto-advance
 * while a gap is open) and {@link handleMenuAction}'s `ROUND_OVER` case (Enter answers the prompt, not the
 * scoreboard) — all short-circuit on `null` first, so a normal load pays for one extra `if` per frame in
 * `advanceScoreboard` and nothing at all in the other two (they already run at most once per round-over).
 * `gameStateMachine.js` hears about none of this: opening or closing a gap dispatches no `GAME_EVENTS`, and
 * the state stays `ROUND_OVER` throughout (AC3; `git diff --stat -- src/game/gameStateMachine.js` stays
 * empty), the same discipline KI-10-03 (#145) uses for its own local overlay.
 *
 * `laserPhaseSeen` and `sessionRoundsPlayed` (`playtestQuestions.js`'s `RoundFacts`) are separate, simpler
 * additions: two sticky module-scope facts, neither ever reset by a new round or a new match, because both
 * are read as "this session", not "this match" or "this round". `laserPhaseSeen` latches true once in
 * {@link handleSimEvents} the first time a round actually emits `LASER_WARNING` or `LASER_STEP`.
 * `sessionRoundsPlayed` counts up once per {@link enterRoundOver} call, deliberately *not* read off
 * `MatchState.roundsPlayed` (`core/match.js`) — that counter restarts at `0` on every `createMatch()` call in
 * {@link startMatchState}, so an `after-round` trigger built from it could only ever see the rounds of
 * whichever match happens to be in progress (PR #176 review: this stranded every §4 question and `A2` behind
 * a Best of 3 match boundary they could never cross, since `PLAYTEST-SCRIPT.md` §1 pins the session to Bo3
 * while §4 needs 5 rounds *played*, which only a session, not a single match, can promise). Both facts cost
 * at most one extra comparison or increment on a path that already runs at most once per event or once per
 * round-over, which is cheap enough not to gate behind `playtestPrompt !== null` — neither is a new
 * collaborator, just one more thing this file already has everything it needs to track.
 *
 * ## KI-12-02: a CPU player is a seam, not a second input path
 *
 * `cpuPlayers` is a nullable collaborator *per player number*, the same idiom `inputLatency` and
 * `playtestPrompt` already use above: `[null, null]` on every session until {@link setCpuPlayer} is called —
 * directly (a test, or `__kobi`), or (KI-12-04) indirectly through {@link syncCpuPlayersFromKinds} whenever
 * `matchSettings.playerKinds` actually changes, from the match-setup row's own `onChange` or a `startMatch`
 * override. A normal HUMAN/HUMAN load touches neither path at all, so it still allocates nothing here and
 * still pays exactly one boolean check (`hasCpuPlayer`) per frame, in {@link driveCpuPlayers}, which is
 * `runUpdate`'s very first line.
 *
 * `driveCpuPlayers` is a peer of `handleDirection`'s own keyboard callers, not a bypass of it: it asks each
 * configured `CpuPlayer` (`cpuPlayer.js`) to `decide()` from the same `sim.getState()` snapshot the HUD
 * already reads, and feeds a non-`null` answer straight into {@link handleDirection} — the exact function a
 * keydown feeds — so `inputBufferSize`, the no-reversal rule and the replay's `roundInputLog` all apply to a
 * CPU's inputs for free (AC1, AC2). `{@link acceptsSteeringInput}` is the state gate `handleDirection` has
 * always used, pulled out so `driveCpuPlayers` can check it *before* calling `decide()` rather than after:
 * PAUSE (and the READY? beat, and every menu state) fail that gate, so the policy is never even asked while
 * the game is paused (AC3) — the decision is not merely discarded, it is never spent.
 *
 * This does not contradict KS-07-06's own care above about avoiding a `getState()` clone on every frame:
 * that snapshot is read only when a CPU is actually configured (`hasCpuPlayer` gates it, same as the boolean
 * check above), and it is cheap enough not to matter even then — **measured** (PR #226 review) at ≈ 0.5 µs
 * per call, ≈ 0.003 % of a 16.6 ms frame at 60 fps, independently reproduced on this ticket's own machine.
 * KS-07-06's own `sim.getState()` read, by contrast, is gated behind an *accepted* human input (a handful of
 * times a second at most); this one runs every frame a CPU is configured, which is exactly why it was worth
 * measuring rather than assuming.
 *
 * `startRound` resets every configured `CpuPlayer` alongside `inputLatency`, for the same reason: a fresh
 * round's snakes spawn at fixed cells, and without clearing `cpuPlayer.js`'s own head-cell memory a spawn
 * cell that happened to match the previous round's final head cell would silently swallow this round's first
 * decision.
 *
 * ## KI-05-02: a replay mode that never touches match state
 *
 * `docs/sprints/improvement-05-replay-capture-and-playback.md` KI-05-02 asks this file to grow "a replay mode
 * that renders it with the existing renderer and HUD". Per that ticket's own tech-lead notes, the transport
 * (play/pause/step/seek) and every rule about *how* a replay reproduces a round belong entirely in
 * `replayPlayer.js` — this file's job is only to hold one `replayPlayer.js` instance, render whatever it says
 * to look like right now, and never let anything else touch it.
 *
 * "Never let anything else touch it" is what makes AC3 ("replay mode accepts no player input into the
 * simulation") true by construction rather than by a runtime check: {@link replayPlayer} is a variable this
 * section alone reads and writes, `handleDirection` (the one function a real keydown ever reaches) knows
 * nothing about it and only ever calls `sim.applyInput` on the *match* simulation, and nothing below ever
 * assigns a replay's `RoundSimulation` to `sim`. A movement key pressed while a replay is loaded therefore
 * cannot reach it regardless of what state the game machine happens to be in — there is no code path from a
 * keydown to `replayPlayer` at all.
 *
 * Deliberately **not** wired into `runUpdate`'s state-machine switch, `GAME_EVENTS`, or the frame loop: doing
 * that is KI-05-03's "new state in the machine with its generated transition tests", and adding one here would
 * both duplicate that ticket's work and widen this file's diff into the match-setup code Improvement 12 is
 * editing concurrently (tech-lead note H). `advanceReplayFrame` below is called by hand — today, by
 * `tests/e2e/replay.spec.js` through `__kobi`, and later by whatever loop KI-05-03's screen drives — rather
 * than from a state-machine `onEnter`.
 *
 * ## KI-05-03: the per-frame call site, and why it still cannot touch input
 *
 * This ticket is the "later" the paragraph above refers to: `gameStateMachine.js` grows a `REPLAY` state, and
 * this file's own `runUpdate` switch grows a `case STATES.REPLAY` that calls {@link advanceReplayInternal}
 * every frame the machine is in it — the declared `session.js`/loop deviation the ticket's tech-lead notes
 * call out (the PR description explains the "why here" half; this comment is the "why it is still safe"
 * half). It preserves KI-05-02's own property exactly rather than merely not regressing it:
 *
 * - **The new case is the only new thing.** No new branch is added to `handleDirection`, `handleMenuAction`
 *   forwards to `ui.handleMenuAction` for `REPLAY` exactly as it already did for every other screen (its
 *   `default` branch — `REPLAY` needed no new arm there), and `driveCpuPlayers` still runs first in
 *   `runUpdate` and still bails out on its own `sim === null`/`acceptsSteeringInput()` guards, which `REPLAY`
 *   fails the same way every non-round state does. Nothing about *reading* a keydown changed.
 * - **`replayPlayer` is still the one variable only this section reads and writes.** `advanceReplayInternal`
 *   is `replayPlayer?.advance(wallSeconds); renderReplayFrame();` — unchanged from what KI-05-02 already
 *   built as `advanceReplayFrame`'s body, just given a name `runUpdate` can call alongside the public method
 *   that now forwards to it. A movement key still has no code path to `replayPlayer` at all, `REPLAY` state
 *   or not — KI-12-02's `driveCpuPlayers` is a second caller of `handleDirection`, not a second caller of
 *   anything in this section, so it is not entangled with this deviation either.
 * - **`REPLAY` carries no `PAUSE`/`AUTO_PAUSE` row** (`gameStateMachine.js`'s own table), so a replay's
 *   play/pause state is owned entirely by `replayPlayer.js`'s own `play()`/`pause()` — never by
 *   `loop.timeScale`, which stays exactly what it already was (usually `1`, from whatever screen was up
 *   before `REPLAY`) for the whole time a replay is loaded. `advanceReplayInternal` is therefore called
 *   unconditionally, every frame, and is safe to: `replayPlayer.advance()` is already a documented no-op
 *   while paused, and `renderReplayFrame()` already draws the frozen frame (or the empty arena, with nothing
 *   loaded) exactly as `runUpdate`'s own `default` case does for every menu and for `PAUSE` ("the frame
 *   still renders").
 *
 * ## KI-05-04: WATCH LAST ROUND, the match-over screen's own entry point
 *
 * Per the design lead's ruling on issue #211/#222 (`DESIGN-DECISIONS §3`), WATCH LAST ROUND is a row on
 * `matchOver.js`, not `scoreboard.js` — a declared deviation from the sprint file's own `Files:` list,
 * explained in the PR description. This section is the other half of KI-05-03's own prediction
 * (`gameStateMachine.js`'s `STATES.REPLAY`/`GAME_EVENTS.SELECT_REPLAY` doc notes): `MATCH_OVER` grows its own
 * `SELECT_REPLAY` row, landing on the identical `REPLAY` state `MAIN_MENU`'s row already does, so no new
 * state-machine shape is needed — only this file's own entry point and the capture that feeds it.
 *
 * **The capture, not a fresh replay from the same seed.** {@link captureReplaySnapshot} is exactly what the
 * public `getReplay()` already builds (KS-07-01 AC2), pulled out so {@link enterRoundOver} can take the
 * identical snapshot into {@link lastRoundReplay} the instant a round ends — before the next `startRound()`
 * (reached through `NEXT_ROUND` or `REMATCH`) resets `roundInputLog`/`roundEventLog` out from under it.
 * `playtestPrompt.offer()`'s own call site, two lines below that capture, is the existing precedent for
 * "capture at exactly this instant" (tech-lead note on issue #222). Overwritten on every round-over, so by
 * the time `MATCH_OVER` fires, {@link lastRoundReplay} holds only the match's *last* round — exactly what the
 * ruling asks WATCH LAST ROUND to show. Capturing the recorded inputs and event log, not merely the round's
 * seed, is what makes this "exactly that round" rather than "a round with the same seed": a fresh
 * `RoundSimulation` built from the seed alone would replay with nobody's inputs applied and could diverge the
 * moment either player had actually turned.
 *
 * **Loading, not re-deriving.** {@link watchLastRound} calls the same {@link loadReplayInternal} the REPLAY
 * screen's own paste box uses, handing it {@link lastRoundReplay} directly — the exact "already-parsed value"
 * seam `loadReplay()`'s own doc comment names — then dispatches `SELECT_REPLAY`. `showReplayScreen`
 * (`onEnter[STATES.REPLAY]`) runs immediately after and finds `replayPlayer` already built; its own doc
 * comment already covers this case ("a replay already loaded... survives a round trip back to it"), so the
 * REPLAY screen comes up already showing this round, with no third code path needed.
 *
 * **Esc goes back to MATCH_OVER, not MAIN_MENU**, for the same reason PAUSE's own `RESUME` does: `REPLAY`'s
 * `BACK` row resolves through the {@link PREVIOUS} sentinel to whichever state `SELECT_REPLAY` was dispatched
 * from (`gameStateMachine.js`'s own `previousState` bookkeeping), which is `MATCH_OVER` when this section's
 * own `watchLastRound` is the caller. Re-entering `MATCH_OVER` re-runs `enterMatchOver`, which reads `match`
 * exactly as it did the first time — untouched by anything in this section (the "never touches match state"
 * property this file's KI-05-02 header note already establishes) — so the screen redraws identically rather
 * than losing the winner or the score.
 *
 * ## Surviving a lost WebGL context (KI-06-01)
 *
 * A laptop waking from sleep, a driver reset or a browser reclaiming GPU memory ends the same way: the canvas
 * fires `webglcontextlost` and there is nothing to draw into. Nothing here listens for that event — this file
 * may not touch the DOM (`ARCHITECTURE §3`) — it subscribes to the *renderer*, which owns the canvas and
 * turns those two events into {@link SessionRenderer.onContextLost} / `onContextRestored`.
 *
 * What happens on each is deliberately not new machinery. **Loss pauses the match through the existing
 * `AUTO_PAUSE`**, the same event a backgrounded tab already dispatches, and therefore through the same
 * {@link enterPause}: `loop.timeScale` goes to 0, `runUpdate`'s `default` case ticks nothing, and no
 * simulated time passes while the picture is gone. **Restore resumes through the existing {@link resume}**,
 * and therefore through the same one-second READY? beat the RESUME row and Esc play. The match continues
 * from the tick it stopped on because the simulation never advanced past it — `src/core` is pure and
 * headless and none of this reaches it.
 *
 * The one piece of state the recovery adds is {@link pausedByContextLoss}, and it exists to answer one
 * question honestly: a context that comes back while the player is sitting on a pause screen *they* opened
 * must not resume the match under them.
 */

/** @typedef {import('./input.js').Direction} Direction */
/** @typedef {import('./input.js').MenuAction} MenuAction */
/**
 * The subset of {@link MenuAction} a *screen* can be handed — everything except `PAUSE_TOGGLE`, which is
 * Space and is dealt with in {@link handleMenuAction} before any screen sees it (`DESIGN-DECISIONS §2.8`).
 * @typedef {import('../ui/focus.js').MenuAction} ScreenAction
 */
/** @typedef {import('./loop.js').RequestFrame} RequestFrame */
/** @typedef {import('./loop.js').VisibilitySource} VisibilitySource */
/** @typedef {import('./loop.js').LifecycleSource} LifecycleSource */
/** @typedef {import('./gameStateMachine.js').GameState} GameState */
/** @typedef {import('./gameStateMachine.js').GameEvent} GameEvent */
/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/round.js').SimEvent} SimEvent */
/** @typedef {import('../core/match.js').MatchState} MatchState */
/** @typedef {1 | 2} PlayerNumber */

/**
 * A world-space point that knows how to project itself through a camera — a `THREE.Vector3`, described
 * structurally rather than imported, since `src/game/` may never import three.js (`ARCHITECTURE §3`).
 * `renderer.getHeadWorldPosition` already returns exactly this (KS-03-04's own doc comment on it); KS-06-02's
 * HUD tag is the first caller in this file that calls `.project()` on it rather than only reading `x`/`y`/`z`.
 *
 * @typedef {object} ProjectableVector
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {(camera: any) => ProjectableVector} project - normalized device coordinates, `x`/`y` each
 *   in `[-1, 1]`; mutates and returns `this`, same as three's own. `camera: any` rather than a narrower type
 *   because the real caller hands it a `THREE.Camera` and this file may never name that type
 *   (`ARCHITECTURE §3`) — `unknown` would reject the real renderer's own `project`, whose parameter three
 *   itself types as `Camera`, not `unknown`.
 */

/**
 * @typedef {object} SessionRenderer
 * @property {(snapshot: object, dt?: number) => void} render
 * @property {() => boolean} resize - KI-16-02: `false` when the canvas had no area to re-frame for (a
 *   minimised window), so this file knows not to draw a frame for a zero-pixel viewport.
 * @property {{pulseLaserWarning: () => void, updateMatrixWorld?: () => void}} [camera] - the gameplay
 *   camera's `LASER_WARNING` reaction (KS-04-03) plus, since KS-06-02, whatever the HUD tag's projection
 *   needs from it — typed as only the members this file actually calls, because `src/game/` cannot import
 *   three.js and so can never name the real `GameplayCamera` class.
 * @property {(player: number) => ProjectableVector} [getHeadWorldPosition] - KS-06-02: where the HUD tag
 *   anchors. Optional, like `camera`, so a minimal test renderer stays legal.
 * @property {(listener: () => void) => () => void} [onContextLost] - KI-06-01: subscribe to the canvas
 *   losing its WebGL context; the return value unsubscribes. Optional for the same reason the two members
 *   above are — a test that is not about context loss passes a renderer without it and nothing subscribes.
 * @property {(listener: () => void) => () => void} [onContextRestored] - KI-06-01: subscribe to the context
 *   coming back, after the renderer has repaired itself.
 */

/**
 * @typedef {object} SessionHud
 * @property {(text: string) => void} setTime
 * @property {(p1Length: number, p2Length: number) => void} setLengths
 * @property {(durationSeconds: number) => void} showLaserWarning
 * @property {(dt: number) => void} tick
 * @property {() => void} resetWarning
 * @property {(tags: import('../ui/hud.js').PowerUpTagState[]) => void} [setPowerUpTags] - KS-06-02. Optional
 *   for the same reason `SessionRenderer`'s new members are: a minimal test HUD stays legal without it.
 */

/**
 * The screen router (`ARCHITECTURE §8`; built by KS-05-04). `show` is idempotent and re-renderable: this file
 * calls it again with new props whenever the props change, which for the countdown is four times a round.
 *
 * @typedef {object} SessionUi
 * @property {SessionHud} hud
 * @property {(state: GameState, props?: object) => void} show
 * @property {(action: ScreenAction) => void} handleMenuAction - routes one key action into the focus model of
 *   whichever screen is up. The screens deliberately do not listen for keys themselves: `input.js` owns the
 *   keyboard for the whole app, and a second listener would fire Enter twice.
 *
 *   A {@link ScreenAction}, not the wider {@link MenuAction} `input.js` emits: `PAUSE_TOGGLE` is Space, and
 *   Space never reaches a screen ({@link handleMenuAction} translates or drops it first), so the narrower
 *   type is the true one and the checker enforces it.
 * @property {(progress: {tick: number | null, replay: import('../core/replay.js').Replay | null, phase: import('../core/events.js').Phase | null, isPlaying: boolean}) => void} updateReplayProgress -
 *   KI-05-03: the REPLAY screen's cheap, once-a-frame readout update — see this file's own "the per-frame
 *   call site" header note and `ui.js`'s own doc comment on the real implementation. `replay` carries the
 *   loaded replay itself (or `null`) rather than a pre-computed total tick, so this file never has to import
 *   anything from `src/ui/` to answer "how many ticks does this replay run" — that derivation is
 *   `replay.js`'s own (`replayTotalTick`), kept entirely on the ui side of the line `ARCHITECTURE §3` draws.
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
 * @property {{1: PlayerKind, 2: PlayerKind}} playerKinds - KI-12-04: `'HUMAN'` or a CPU
 *   {@link import('./bots/levels.js').Level} per player. `{1: 'HUMAN', 2: 'HUMAN'}` is the shipping default
 *   (`DESIGN-DECISIONS §1` row 27, AC1) — {@link defaultMatchSettings} below.
 */

/**
 * `'HUMAN'` or one of `bots/levels.js`'s own {@link import('./bots/levels.js').Level} ids. Mirrors
 * `matchSetup.js`'s own `PlayerKind` typedef exactly — this file must not import that one (`src/game/` may
 * not import `src/ui/`, `ARCHITECTURE §3`), so the two are declared independently and kept in sync by hand,
 * the same way `MatchSettings` itself is already duplicated (with different property sets) across the two
 * files rather than shared.
 * @typedef {'HUMAN' | import('./bots/levels.js').Level} PlayerKind
 */

/**
 * The pieces of `RoundSimulation.getState()` this file reads. `round.js` only promises `object`, so every
 * reader casts to the shape it actually needs.
 *
 * @typedef {object} RoundSnapshot
 * @property {number} tick - KS-07-06: the integer sim tick this snapshot was taken at.
 * @property {number | null} timeRemaining
 * @property {{id: string, length: number, direction: {dx: number, dy: number}, effects: {type: string, remaining: number}[]}[]} snakes
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
 * @property {LifecycleSource | null} [documentLifecycleSource] - KI-06-03: forwarded to `createLoop` verbatim
 *   — where `freeze`/`resume` come from. Defaults to `document` where there is one; pass `null` to opt out.
 * @property {LifecycleSource | null} [windowLifecycleSource] - KI-06-03: forwarded to `createLoop` verbatim —
 *   where `pagehide`/`pageshow` come from. Defaults to `window` where there is one; pass `null` to opt out.
 * @property {boolean} [strict] - forwarded to the state machine: throw on an illegal transition (development
 *   and tests) or ignore and log it once (production).
 * @property {() => number} [randomSeed] - draws a match seed when none is fixed; defaults to `Date.now`
 * @property {boolean} [enableInputStats] - KS-07-06: build the input-latency tracker `getInputStats()`
 *   reads. Defaults to `false`, matching `ARCHITECTURE §11`'s `__kobi` gate: `main.js` passes `true` only
 *   under `import.meta.env.DEV`/`?test=1`, so a normal production session builds no tracker at all and pays
 *   nothing for it — not the two extra calls a frame, not the `sim.getState().tick` read on an accepted
 *   input, nothing (see this file's own "KS-07-06 deviation" note above).
 */

/**
 * The pieces of `src/ui/screens/playtestPrompt.js`'s `PlaytestPromptScreen` this file needs — KI-11-02's
 * nullable seam (`setPlaytestPrompt`, see this file's own header note). Typed structurally, like
 * `SessionRenderer`/`SessionHud` above, so a unit test can pass a minimal fake without importing the real
 * (DOM-building) module.
 *
 * @typedef {object} SessionPlaytestPrompt
 * @property {() => boolean} isOpen
 * @property {(facts: import('../qa/playtestQuestions.js').RoundFacts, roundIndex: number) => boolean} offer
 * @property {(action: ScreenAction) => void} handleAction
 */

/**
 * HUD timer text is throttled to 10 Hz (`ARCHITECTURE §8`).
 *
 * Exported — a one-word, zero-behaviour-change deviation from KI-03-03's `Files:` list, declared in that
 * ticket's PR (tech-lead ruling on issue #122) — so `tests/agent/invariants.js` can derive its HUD-agreement
 * tolerance from the real throttle instead of retyping `1 / 10` as a second copy that could drift from this
 * one.
 */
export const HUD_INTERVAL_SECONDS = 1 / 10;

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
 * The one apple KI-15-02/#157 puts on the match-setup screen's live arena: "a picture, not a round: nothing
 * moves" (`DESIGN-DECISIONS §3`). Fixed rather than drawn from `food.js`'s placement rules, because there is
 * no round underneath MATCH_SETUP to place it with — {@link drawFrame} reaches for this precisely when `sim`
 * is `null`, the same moment {@link EMPTY_SNAPSHOT} used to be the only option.
 *
 * `(3, 20)`, chosen and not merely picked:
 *  - inside the 24×24 grid (`§2.1`), nowhere near either wall;
 *  - Chebyshev distance 8 from P1's spawn `(5, 12)` and 15 from P2's `(18, 11)` (`§2.3`) — nowhere close to
 *    either snake's starting body, the same "≥ 2 cells from a head" instinct real apple placement uses, with
 *    room to spare because nothing here is actually moving;
 *  - the arena's rear-left quadrant, well outside `.menu-panel`'s centred, `min-width: 22rem` footprint
 *    (`styles.css`) — a player looking at the colour rows still sees the apple beside the arena, not lost
 *    under the dark overlay.
 * @type {{x: number, y: number}}
 */
export const MATCH_SETUP_APPLE_CELL = { x: 3, y: 20 };

/** The snapshot {@link drawFrame} draws for MATCH_SETUP alone — never MAIN_MENU, which stays {@link EMPTY_SNAPSHOT}. */
const MATCH_SETUP_SNAPSHOT = { snakes: [], apples: [MATCH_SETUP_APPLE_CELL] };

/**
 * Reverse of `core/grid.js`'s `DIRECTIONS`: `{dx, dy}` -> its name. Built once from the live table (rather
 * than a hand-written mirror, the way `testHooks.js`'s own reverse map is) since this file already imports
 * `DIRECTIONS` for nothing else. Used only by `handleDirection` (KS-07-01): the replay format
 * (`tests/sim/replays/replay.schema.json`) records a direction by name, the same as a `pressKey` call would.
 * @type {Record<string, 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>}
 */
const DIRECTION_NAME_BY_DELTA = /** @type {Record<string, 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'>} */ (
  Object.fromEntries(Object.entries(DIRECTIONS).map(([name, d]) => [`${d.dx},${d.dy}`, name]))
);

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
    // KI-12-04 (`DESIGN-DECISIONS §1` row 27, AC1): "defaulting to HUMAN for both". A match started without
    // touching the row must be byte-identical to today's — `startMatchState`'s `playersForMatch()` reads
    // this to decide `isCpu`, and every value here is `'HUMAN'` until the setup screen's own row (or a
    // caller's explicit override) says otherwise.
    playerKinds: { 1: 'HUMAN', 2: 'HUMAN' },
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
  settings: baseSettings = SETTINGS,
  matchSettings: matchSettingsOverrides,
  ownedColors = DEFAULT_OWNED_COLORS,
  inputTarget,
  requestFrame,
  cancelFrame,
  now,
  visibilitySource,
  documentLifecycleSource,
  windowLifecycleSource,
  blurSource,
  strict = true,
  randomSeed = Date.now,
  enableInputStats = false,
}) {
  /**
   * The settings the *next* `RoundSimulation` is built from (KS-07-01). Starts as whatever this session was
   * constructed with; {@link setSettingsOverrides} reassigns it, and every function below that reads
   * `settings.xxx` already does so live rather than holding a captured copy, so a reassignment here is picked
   * up automatically the next time `startRound()` runs — never mid-round, because a live `RoundSimulation`
   * captured its own `settings` at construction and never asks this file for another.
   */
  let settings = baseSettings;
  /**
   * The exact override tree {@link setSettingsOverrides} was last called with, verbatim — `null` means "no
   * tuning overrides; use the settings this session was constructed with". Kept separately from `settings`
   * itself (which is always a *complete* settings object) so {@link getReplay} can stamp only what actually
   * changed, matching `tests/sim/replays/*.json`'s own `settingsOverrides` field.
   * @type {import('./tuning.js').TuningSettingsOverride | null}
   */
  let settingsOverrides = null;

  /** @type {MatchSettings} */
  let matchSettings = { ...defaultMatchSettings(settings), ...matchSettingsOverrides };

  /**
   * KS-07-06: `null` unless `enableInputStats` is on (production never turns it on — see the option's own
   * doc comment above). Shares this session's own `now` clock with `createInput`'s `onDirectionTimed`, so a
   * test that injects a fake clock sees every stage measured against the same one.
   * @type {ReturnType<typeof createInputLatencyTracker> | null}
   */
  const inputLatency = enableInputStats
    ? createInputLatencyTracker({ now, simHz: settings.simHz, snakeSpeed: settings.snakeSpeed })
    : null;

  /**
   * KI-11-02: `null` unless `main.js` calls {@link setPlaytestPrompt} (only under `?playtest=1`). See this
   * file's own header note for the shape and the three call sites that read it.
   * @type {SessionPlaytestPrompt | null}
   */
  let playtestPrompt = null;

  /**
   * KI-12-02: `cpuPlayers[playerNumber - 1]` is `null` for a human player, or the `CpuPlayer`
   * (`cpuPlayer.js`) driving that player otherwise. `[null, null]` until {@link setCpuPlayer} is called — see
   * this file's own header note.
   * @type {[ReturnType<typeof createCpuPlayer> | null, ReturnType<typeof createCpuPlayer> | null]}
   */
  let cpuPlayers = [null, null];

  /**
   * Whether either slot of {@link cpuPlayers} is non-`null`, kept alongside it so {@link driveCpuPlayers} — on
   * `runUpdate`'s hot path, every frame, for every session — pays exactly one boolean read rather than two
   * property reads when there is nothing to drive.
   */
  let hasCpuPlayer = false;

  /**
   * KI-12-04: the one place {@link cpuPlayers}/{@link hasCpuPlayer} are actually written, whether the caller
   * is the public `setCpuPlayer` (a raw policy, from a test or `__kobi` — KI-12-02's own seam) or
   * {@link syncCpuPlayersFromKinds} below (a `PlayerKind`, translated through `policyForLevel`). One function
   * so both paths agree on exactly what "configuring player N" means.
   *
   * @param {PlayerNumber} playerNumber
   * @param {import('./bots/policy.js').Policy | null} policy
   */
  function assignCpuPlayer(playerNumber, policy) {
    cpuPlayers[playerNumber - 1] =
      policy === null ? null : createCpuPlayer({ playerNumber, policy });
    hasCpuPlayer = cpuPlayers[0] !== null || cpuPlayers[1] !== null;
  }

  /**
   * KI-12-04: reconciles {@link cpuPlayers} with a `matchSettings.playerKinds` change, one player number at a
   * time, and only for a player number whose kind actually changed — never the other. That is what keeps this
   * function from fighting a manually configured `setCpuPlayer` call: `cpu.spec.js` calls `setCpuPlayer`
   * directly and then `startMatch()` with no `playerKinds` override at all, so this function is never even
   * invoked on that path (see {@link startMatch}'s own `overrides.playerKinds !== undefined` guard below), and
   * the manual configuration survives untouched. `previousKinds`/`nextKinds` are compared by player number
   * rather than by object identity, since a fresh `matchSettings` object arrives on every change (this file's
   * own "one authority on what the match settings are" contract — `showMatchSetup`'s `onChange`, right below).
   *
   * @param {{1: PlayerKind, 2: PlayerKind}} previousKinds
   * @param {{1: PlayerKind, 2: PlayerKind}} nextKinds
   */
  function syncCpuPlayersFromKinds(previousKinds, nextKinds) {
    for (const playerNumber of /** @type {PlayerNumber[]} */ ([1, 2])) {
      const kind = nextKinds[playerNumber];
      if (kind === previousKinds[playerNumber]) continue;
      assignCpuPlayer(playerNumber, kind === 'HUMAN' ? null : policyForLevel(kind));
    }
  }

  /**
   * KI-11-02's `RoundFacts.laserPhaseSeen`: true once any round has actually armed its lasers, for the whole
   * life of this session (never reset by a new round or a new match) — see this file's header note.
   */
  let laserPhaseSeen = false;

  /**
   * KI-11-05 (#169): whether this build has practice mode at all — `RoundFacts.practiceExists`.
   *
   * `V3`'s procedure is "Grow both snakes past 15 segments in **practice mode**", and `G2`'s entire pass
   * condition is "See V3." Practice mode is Sprint 15 (`docs/sprints/README.md`); until it lands there is no
   * way for two humans to perform either, so `?playtest=1` must not put them. Before Improvement 11 a
   * facilitator skipped a row that did not apply — removing the facilitator means writing that rule down.
   *
   * A plain constant rather than a feature probe on purpose: `src/modes/practice.js` does not exist yet, so
   * there is nothing to probe, and a constant is greppable. **Sprint 15 flips this to `true`** and the two
   * questions start being asked with no other change.
   */
  const practiceExists = false;

  /**
   * KI-11-02's `RoundFacts.roundsPlayed`, counted across the whole session — every match this
   * `createSession` call ever plays, never reset at a match boundary. `MatchState.roundsPlayed` (`match.js`)
   * is the wrong source for this: it starts a fresh `0` every `createMatch()` call in {@link startMatchState},
   * so an `after-round` trigger read from it can only ever see the rounds of the match currently in progress.
   * `PLAYTEST-SCRIPT.md` §1 pins the session to Best of 3 while §4 asks for 5 rounds played before `C1`-`C3`
   * are due — the two only reconcile if "rounds played" spans matches, so this counts every round
   * `enterRoundOver` ever sees, incremented in the same place `match.recordRound(...)` is called (PR #176
   * review; per-match `roundsPlayed` stranded §4 and `A2` behind a Bo3 match boundary they can never cross).
   */
  let sessionRoundsPlayed = 0;

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

  /**
   * KI-05-02: the loaded replay's driver, or `null` when no replay is loaded. Entirely separate from `sim`
   * (see this file's own "a replay mode that never touches match state" header note) — nothing outside the
   * `-- replay mode --` section below reads or writes it.
   * @type {import('./replayPlayer.js').ReplayPlayer | null}
   */
  let replayPlayer = null;

  /**
   * The current round's own input log and full event log, in the exact `{t, player, dir}` /
   * `{type, tick, t, ...}` shapes `tests/sim/replays/*.json` fixtures use — reset by `startRound`,
   * appended to as the round plays, and read back verbatim by {@link getReplay} (KS-07-01 AC2).
   * @type {{t: number, player: string, dir: 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'}[]}
   */
  let roundInputLog = [];
  /** @type {SimEvent[]} */
  let roundEventLog = [];

  /**
   * KI-05-04: a snapshot of the most recent round-that-ended's replay, in exactly {@link captureReplaySnapshot}'s
   * shape — `null` until the first round of this session ends. Written once per round, in {@link enterRoundOver},
   * at the instant that round's own `roundInputLog`/`roundEventLog` are still live and correct; never read or
   * written anywhere else, so it cannot go stale between a round ending and `MATCH_OVER`'s own WATCH LAST ROUND
   * row asking for it (this file's own "WATCH LAST ROUND" header note).
   * @type {{seed: number | null, settingsOverrides: object, inputs: object[], expectedEvents: object[]} | null}
   */
  let lastRoundReplay = null;

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
  /**
   * KI-06-01: true while the game is paused **because the WebGL context went away**, rather than because a
   * player asked for it. Only that pause resumes itself when the context comes back — a player sitting on a
   * pause screen they opened deliberately must not have the match restarted under them by a driver reset
   * they never noticed.
   */
  let pausedByContextLoss = false;
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
        // KI-12-04: the switch's own wiring — reconciled *before* `matchSettings` is overwritten, since
        // `syncCpuPlayersFromKinds` needs the old value to know which player number (if any) actually
        // changed kind.
        syncCpuPlayersFromKinds(matchSettings.playerKinds, next.playerKinds);
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

  /**
   * The current round's replay, in exactly the shape `tests/sim/replays/*.json` fixtures use (KS-07-01 AC2):
   * the seed it was built from, the override tree that built its settings, every input actually applied and
   * the full event log produced so far. Factored out of the public `getReplay()` so KI-05-04's own
   * {@link enterRoundOver} can take the identical snapshot at the identical instant (this file's own "WATCH
   * LAST ROUND" header note) — the two callers must never drift into two different shapes of "what a round's
   * replay is".
   *
   * @returns {{seed: number | null, settingsOverrides: object, inputs: object[], expectedEvents: object[]}}
   */
  function captureReplaySnapshot() {
    return {
      seed: sim === null ? null : roundSeeds[roundIndex],
      settingsOverrides: settingsOverrides === null ? {} : { ...settingsOverrides },
      inputs: roundInputLog.map((entry) => ({ ...entry })),
      expectedEvents: roundEventLog.map((event) => ({ ...event })),
    };
  }

  function enterRoundOver() {
    // KI-05-04: captured before anything below touches `match`/`roundIndex`, and well before the next
    // `startRound()` (reached via `NEXT_ROUND` or `REMATCH`) resets `roundInputLog`/`roundEventLog` — this
    // file's own header note names `playtestPrompt.offer()`'s call site, a few lines below, as the existing
    // precedent for capturing at exactly this instant. Overwritten every round-over, so `MATCH_OVER` always
    // sees only the match's last round.
    lastRoundReplay = captureReplaySnapshot();
    const result = /** @type {string | null} */ (pendingRoundOver?.result ?? null);
    pendingRoundOver = null;
    scoreboardElapsed = 0;
    match?.recordRound(/** @type {any} */ (result));
    // KI-11-02 (PR #176 review): counted here, next to `match.recordRound(...)` above, rather than read off
    // `match.roundsPlayed` — see `sessionRoundsPlayed`'s own doc comment for why the match's own counter is
    // the wrong source.
    sessionRoundsPlayed += 1;
    ui.show(STATES.ROUND_OVER, scoreboardProps(result));
    // Offered after both counters above are updated, so this round is already counted. A no-op call when
    // there is nothing due (`offer` returns false and opens nothing) — `advanceScoreboard` and
    // `handleMenuAction` below only ever hold the scoreboard for a gap that actually opened.
    if (playtestPrompt !== null) {
      const current = /** @type {MatchState} */ (match);
      playtestPrompt.offer(
        {
          roundsPlayed: sessionRoundsPlayed,
          laserPhaseSeen,
          sessionOver: current.isOver(),
          practiceExists,
        },
        roundIndex,
      );
    }
  }

  function enterMatchOver() {
    const current = /** @type {MatchState} */ (match);
    ui.show(STATES.MATCH_OVER, {
      winner: current.winner,
      colorNames: matchSettings.colors,
      wins: current.wins,
      bestOf: current.bestOf,
      // Display only this sprint: keys are persisted in Sprint 13, and nothing here writes storage. A tie
      // (the draw cap firing on a level score, `DESIGN-DECISIONS §1` row 26) has no winner to pay
      // `rewardKeys` to — "won by nobody and worth no keys" — so this reads 0 rather than handing the
      // match-over screen a reward with nobody to attribute it to.
      keys: current.winner === null ? 0 : current.rewardKeys,
      onRematch: () => machine.dispatch(GAME_EVENTS.REMATCH),
      onMenu: () => machine.dispatch(GAME_EVENTS.QUIT_TO_MENU),
      onWatchLastRound: watchLastRound,
    });
  }

  /**
   * KI-05-04: `matchOver.js`'s own WATCH LAST ROUND row. Loads {@link lastRoundReplay} — snapshotted the
   * instant the match's last round ended, in {@link enterRoundOver} — into the same `replayPlayer` the REPLAY
   * screen's paste box loads into, then dispatches `SELECT_REPLAY` exactly as `mainMenu.js`'s own REPLAY row
   * does. See this file's own "WATCH LAST ROUND" header note for why loading the captured replay rather than
   * building a fresh one from its seed is what makes this "exactly that round".
   */
  function watchLastRound() {
    const result = loadReplayInternal(lastRoundReplay);
    replayLoadError = result.ok ? null : result.error;
    machine.dispatch(GAME_EVENTS.SELECT_REPLAY);
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
   * winner and changes no wins — the screen shows "DRAW — REPLAY" and the match replays the round, unless
   * this is the last replay before the draw cap (`consecutiveDraws`/`maxConsecutiveDraws`, KI-01-02), in which
   * case the screen warns instead.
   *
   * Read *after* `enterRoundOver` has already called `match.recordRound(result)` for this round, so
   * `current.consecutiveDraws` already reflects the round just played — the warning is decided from the same
   * number the draw cap itself will fire on.
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
      consecutiveDraws: current.consecutiveDraws,
      maxConsecutiveDraws: settings.maxConsecutiveDraws,
    };
  }

  /** Puts the screen for the current state back up — used when the READY? beat ends. */
  function showStateScreen() {
    ui.show(machine.getState());
  }

  /**
   * KI-05-03: `onEnter[STATES.REPLAY]`. `replayLoadError` clears on every fresh entry — a stale error from a
   * previous visit (Esc'd away from and reached again) has nothing left to point at — but `replayPlayer`
   * itself is deliberately left alone: a replay already loaded before REPLAY was last left survives a
   * round trip back to it, resuming (or staying paused) exactly where it was, which costs nothing extra to
   * support and is simply what falls out of `replayPlayer`'s own lifecycle (this file's "a replay mode that
   * never touches match state" header note) never being told to reset on a state re-entry.
   */
  function showReplayScreen() {
    replayLoadError = null;
    ui.show(STATES.REPLAY, replayScreenProps());
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

  /**
   * The two players, carrying the colours chosen on the setup screen into the simulation's snapshot, and
   * (KI-12-04) whether each is a computer — read by `createMatch` (`core/match.js`) to decide `rewardKeys`
   * (`§1` row 27: "keys are awarded only when at least one human played"). `RoundSimulation` itself only ever
   * reads `id`/`color` off a player (`round.js`'s own `this.players = players.map(...)`), so `isCpu` costs it
   * nothing — it exists for `createMatch` alone.
   */
  function playersForMatch() {
    return PLAYER_IDS.map((id, index) => {
      const playerNumber = /** @type {PlayerNumber} */ (index + 1);
      return {
        id,
        color: matchSettings.colors[playerNumber],
        isCpu: matchSettings.playerKinds[playerNumber] !== 'HUMAN',
      };
    });
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
    // KS-07-01 AC2: the replay recorder starts from whatever the constructor already emitted (the opening
    // apples) so `getReplay()`'s `expectedEvents` matches exactly what `runRound()` would produce — the same
    // events `tests/sim/harness.js`'s own `[...sim.events]` seeds a fresh run's log with.
    roundEventLog = [...sim.events];
    roundInputLog = [];

    resetRoundTimers();
    loop.timeScale = 1;
    // Last round's banner and red timer must not carry into a fresh one (KS-04-03).
    ui.hud.resetWarning();
    hudAccumulator = 0;
    writeHud();
    setCountdownStep(0);
    // KS-07-06: a fresh `RoundSimulation` resets every snake to its spawn heading; without this, that
    // heading could be misread as a commit matching a stale pending entry from the round that just ended
    // (see `resetForRound`'s own comment in `inputLatency.js`).
    inputLatency?.resetForRound();
    // KI-12-02: same idea, for `cpuPlayer.js`'s own head-cell memory — see this file's header note.
    if (hasCpuPlayer) {
      cpuPlayers[0]?.reset();
      cpuPlayers[1]?.reset();
    }
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
    driveCpuPlayers();

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
      case STATES.REPLAY:
        // KI-05-03's declared deviation (this file's own "the per-frame call site" header note): the loaded
        // replay (if any) advances by whatever it was already going to advance by; a no-op, safely, when
        // nothing is loaded or it is paused.
        advanceReplayInternal(unscaledDt);
        updateReplayScreenProgress();
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
    if (sim !== null) {
      const events = sim.advance(dt);
      // KS-07-01 AC2: appended before `handleSimEvents` reacts to them, so the recorded log is exactly what
      // the simulation produced regardless of what the state machine does with it this frame.
      roundEventLog.push(...events);
      handleSimEvents(events);
    }

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
    // KI-11-02, tech-lead note 3: never auto-advance while a gap is open. The hold releases the moment the
    // gap closes, by either route (answered or Esc) — this check runs every frame, so the very next frame
    // after `playtestPrompt.isOpen()` turns false resumes counting exactly as if the prompt had never opened.
    if (playtestPrompt !== null && playtestPrompt.isOpen()) return;
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
      // KI-11-02: sticky for this file's whole lifetime, not just this round — see the header note on why
      // this is not gated behind `playtestPrompt !== null` the way the prompt's own three call sites are.
      if (event.type === EVENTS.LASER_WARNING || event.type === EVENTS.LASER_STEP) {
        laserPhaseSeen = true;
      }
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

  /**
   * Builds this frame's power-up tags (`SessionHud.setPowerUpTags`, `PowerUpTagState`) from a snapshot's
   * per-snake `effects`, projecting each affected head through the gameplay camera. KS-06-02 tech-lead note:
   * `writeHud` is the only function in this file that holds both the snapshot and the renderer, so this
   * helper — new code, not a change to any other function here — exists only to keep `writeHud` itself
   * readable.
   *
   * Returns no tags at all when the renderer cannot project (`camera`/`getHeadWorldPosition` are optional on
   * `SessionRenderer` for exactly this reason) rather than throwing: the tag is cosmetic, and a test double
   * built to prove something else should not have to grow a fake camera to keep passing.
   *
   * @param {RoundSnapshot['snakes']} snakes
   * @param {SessionRenderer} rendererRef
   * @returns {import('../ui/hud.js').PowerUpTagState[]}
   */
  function powerUpTagsFor(snakes, rendererRef) {
    // Captured into `const`s rather than read off `rendererRef` again inside the closures below: both are
    // optional on `SessionRenderer`, and a `const` narrowed by this guard stays narrowed inside a nested
    // function in a way a property access on `rendererRef` would not.
    const getHeadWorldPosition = rendererRef.getHeadWorldPosition;
    const camera = rendererRef.camera;
    if (typeof getHeadWorldPosition !== 'function' || camera === undefined) {
      return [];
    }
    // Camera effects (shake, the laser-warning zoom pulse) move it slightly every frame; the renderer's own
    // `render()` keeps `matrixWorld` current for drawing, but `writeHud` can run before this frame's render
    // has happened yet (`ARCHITECTURE §5`'s update-then-render order), so this asks for it directly rather
    // than trusting whatever the *previous* frame left behind.
    camera.updateMatrixWorld?.();

    /** @type {import('../ui/hud.js').PowerUpTagState[]} */
    const tags = [];
    snakes.forEach((snake, index) => {
      snake.effects.forEach((effect, stackIndex) => {
        const head = /** @type {ProjectableVector} */ (
          getHeadWorldPosition(/** @type {PlayerNumber} */ (index + 1))
        );
        const projected = head.project(camera);
        tags.push({
          key: `${snake.id}:${effect.type}`,
          type: /** @type {'SPEED' | 'SLOW'} */ (effect.type),
          // AC2: whole seconds, rounded up — a fraction of a second left still reads as "1s", never "0s".
          seconds: Math.ceil(effect.remaining),
          // Normalized device coordinates are -1..1 with +y up; a CSS fraction is 0..1 with +y down.
          xFraction: (projected.x + 1) / 2,
          yFraction: (1 - projected.y) / 2,
          stackIndex,
        });
      });
    });
    return tags;
  }

  /** Writes the timer, both lengths and the power-up tags to the HUD right now, bypassing the 10 Hz throttle. */
  function writeHud() {
    if (sim === null) return;
    const state = /** @type {RoundSnapshot} */ (sim.getState());
    ui.hud.setTime(formatTime(state.timeRemaining ?? 0));
    const [p1, p2] = state.snakes;
    ui.hud.setLengths(p1?.length ?? 0, p2?.length ?? 0);
    ui.hud.setPowerUpTags?.(powerUpTagsFor(state.snakes, renderer));
  }

  /**
   * What {@link drawFrame} last handed the renderer. KI-15-02: a test-only readback (`__kobi.getRenderedSnapshot`,
   * `testHooks.js`) — the exact object a spec needs to assert the match-setup apple's fixed cell without
   * depending on `renderer.info.render.calls` or another implementation detail of *how* three.js drew it.
   * @type {object}
   */
  let lastRenderedState = EMPTY_SNAPSHOT;

  /**
   * Draws one frame of whatever the sim currently looks like, without advancing anything.
   *
   * This is `loop.js`'s `render` callback, which is called with the fixed-step interpolation `alpha` — a
   * value this function has never used and must not start using by accident. So the frame's `dt` stays an
   * explicit argument of {@link drawFrameWithDt} rather than a parameter here, where the loop's `alpha`
   * would land on it silently (KI-16-02).
   */
  function drawFrame() {
    drawFrameWithDt(lastDt);
  }

  /**
   * {@link drawFrame} with the seconds the camera's own effects should advance by, stated rather than
   * assumed.
   *
   * A resize draws with `dt = 0` (KI-16-02 AC3): it is not a frame of gameplay, so the crash shake and the
   * laser-warning zoom pulse must not tick forward for it. Passing `lastDt` there would replay the previous
   * frame's slice of those envelopes a second time — a small thing on its own, and a real one for the
   * visual baselines, which would then depend on how many times the window happened to be resized.
   *
   * @param {number} dt - seconds of camera-effect time this draw represents
   */
  function drawFrameWithDt(dt) {
    // KI-15-02/#157: MATCH_SETUP alone gets the one-apple preview snapshot; every other sim-less state
    // (MAIN_MENU foremost — see this constant's own doc comment) keeps the plain empty arena it always had.
    const state =
      sim !== null
        ? sim.getState()
        : machine.getState() === STATES.MATCH_SETUP
          ? MATCH_SETUP_SNAPSHOT
          : EMPTY_SNAPSHOT;
    lastRenderedState = state;
    // KS-07-06: `observeState` must see the state *before* it is drawn (it is looking for a direction that
    // changed on `sim.advance()` earlier this same frame) and `markRendered` immediately after — bracketing
    // the one `renderer.render()` call below is what makes "committed" and "first rendered frame" two
    // distinct timestamps rather than one. Both are `null`-safe no-ops when `enableInputStats` is off, and
    // reuse the very snapshot `renderer.render` already needed, so there is no extra `getState()` call here.
    inputLatency?.observeState(/** @type {RoundSnapshot} */ (state));
    renderer.render(state, dt);
    inputLatency?.markRendered();
  }

  // --- replay mode (KI-05-02) -----------------------------------------------------------------------------
  //
  // Additive and self-contained: nothing here dispatches a `GAME_EVENTS`, reads or writes `sim`/`match`, or
  // is called from `runUpdate`'s state-machine switch (see this file's own header note). A replay plays back
  // only when something calls one of the functions below by hand.

  /**
   * Draws the loaded replay's current tick with the same renderer and HUD a live round uses (ticket spec:
   * "renders it with the existing renderer and HUD"), or the empty arena when no replay is loaded.
   */
  function renderReplayFrame() {
    const state = replayPlayer === null ? EMPTY_SNAPSHOT : replayPlayer.getSnapshot();
    lastRenderedState = state;
    renderer.render(state, lastDt);
    if (replayPlayer !== null) {
      const snapshot = /** @type {RoundSnapshot} */ (state);
      ui.hud.setTime(formatTime(snapshot.timeRemaining ?? 0));
      const [p1, p2] = snapshot.snakes;
      ui.hud.setLengths(p1?.length ?? 0, p2?.length ?? 0);
    }
  }

  /**
   * The last load attempt's error, or `null` — the REPLAY screen's own `error` prop (raw `{code, message}`,
   * never mapped to player copy here: that mapping is `replay.js`'s `describeLoadError`, entirely on the ui
   * side of the line `ARCHITECTURE §3` draws, per this ticket's "the copy is not yours to write" note).
   * @type {import('../core/replay.js').ReplayError | import('./replayPlayer.js').ReplayPlayerError | null}
   */
  let replayLoadError = null;

  /**
   * KI-05-03: the shared "try to load a replay" logic behind both the public `loadReplay()` (unchanged
   * contract — every existing caller, `tests/e2e/replay.spec.js`'s `__kobi.loadReplay` included, sees no
   * difference) and the REPLAY screen's own paste/file callback below. Pulled out to a standalone function
   * only so both have exactly one implementation to agree with, not two that could drift.
   * @param {string | unknown} input
   * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
   */
  function loadReplayInternal(input) {
    const built = createReplayPlayer(input);
    if (!built.ok) return built;
    replayPlayer = built.player;
    return { ok: true };
  }

  /** Shared by the public `playReplay()` and the REPLAY screen's PLAY/PAUSE toggle. */
  function playReplayInternal() {
    replayPlayer?.play();
  }
  /** Shared by the public `pauseReplay()` and the REPLAY screen's PLAY/PAUSE toggle. */
  function pauseReplayInternal() {
    replayPlayer?.pause();
  }
  /** Shared by the public `stepReplay()` and the REPLAY screen's STEP button. @returns {boolean} */
  function stepReplayInternal() {
    return replayPlayer?.step() ?? false;
  }
  /** Shared by the public `seekReplay()` and the REPLAY screen's START AGAIN button. @param {number} tick */
  function seekReplayInternal(tick) {
    replayPlayer?.seek(tick);
  }
  /**
   * Shared by the public `advanceReplayFrame()` and `runUpdate`'s new `REPLAY` case (this file's own header
   * note on the deviation). Unchanged from what KI-05-02 wrote inline as `advanceReplayFrame`'s own body.
   * @param {number} wallSeconds
   */
  function advanceReplayInternal(wallSeconds) {
    replayPlayer?.advance(wallSeconds);
    renderReplayFrame();
  }

  /**
   * The REPLAY screen's props for `ui.show(STATES.REPLAY, ...)` (`replay.js`'s own `ReplayScreenProps`).
   * Rebuilt fresh on every call rather than kept as one object with mutated fields, the same "screen re-
   * rendered from the session's copy" discipline `showMatchSetup` already uses — there is exactly one
   * authority on `loaded`/`error` and the screen cannot drift from it.
   */
  function replayScreenProps() {
    return {
      loaded: replayPlayer !== null,
      error: replayLoadError,
      /** @param {string} text */
      onLoad(text) {
        const result = loadReplayInternal(text);
        replayLoadError = result.ok ? null : result.error;
        ui.show(STATES.REPLAY, replayScreenProps());
      },
      onPlayToggle() {
        if (replayPlayer === null) return;
        if (replayPlayer.isPlaying()) pauseReplayInternal();
        else playReplayInternal();
      },
      onStep() {
        stepReplayInternal();
        renderReplayFrame();
      },
      onSeekToStart() {
        seekReplayInternal(0);
        renderReplayFrame();
      },
      onBack: () => machine.dispatch(GAME_EVENTS.BACK),
    };
  }

  /**
   * `runUpdate`'s `REPLAY` case calls this every frame (this file's own header note on the deviation): the
   * screen's cheap tick-readout/PLAY-PAUSE-label update, entirely separate from the full `render(props)` a
   * load attempt triggers above.
   */
  function updateReplayScreenProgress() {
    ui.updateReplayProgress({
      tick: replayPlayer?.tick ?? null,
      replay: replayPlayer?.getReplay() ?? null,
      phase: replayPlayer?.phase ?? null,
      isPlaying: replayPlayer?.isPlaying() ?? false,
    });
  }

  // --- input --------------------------------------------------------------------------------------------

  /**
   * True while a round is actually taking steering input: during PLAYING and LASER_WARNING, and during the
   * countdown's "GO" beat, where `DESIGN-DECISIONS §2.4` says inputs are queued so a player can commit to a
   * first turn before the snakes start moving — but not through the post-pause READY? beat, which freezes
   * the round it is about to hand back (`§2.8`).
   *
   * Pulled out of {@link handleDirection} for KI-12-02: {@link driveCpuPlayers} needs the identical gate
   * *before* asking a CPU's policy for a decision, not after, so that PAUSE (which fails every branch here)
   * stops the policy from being consulted at all rather than merely dropping the answer it gave.
   */
  function acceptsSteeringInput() {
    const state = machine.getState();
    const playing = state === STATES.PLAYING || state === STATES.LASER_WARNING;
    if (!playing && !(state === STATES.COUNTDOWN && countdownAcceptsInput())) return false;
    if (playing && readyRemaining > 0) return false;
    return true;
  }

  /**
   * A steering key. Ignored unless a round is actually taking input — see {@link acceptsSteeringInput}.
   *
   * @param {number} playerNumber
   * @param {Direction} dir
   */
  function handleDirection(playerNumber, dir) {
    if (sim === null) return;
    if (!acceptsSteeringInput()) return;
    const playerId = PLAYER_IDS[playerNumber - 1];
    if (playerId === undefined) return;
    // KS-07-01 AC2: recorded before `applyInput`, at the round's current elapsed time, so `t` matches exactly
    // what a `tests/sim/replays/*.json` fixture's own `t` means — simulated seconds since round start. An
    // input a real key press could never produce (queue full, exact reverse, repeat of the current
    // direction) is recorded anyway, precisely as `input.js`'s own keydown handler would have — replay.schema
    // .json's own doc says this is "legal to record ... silently dropped ... when applied".
    const name = DIRECTION_NAME_BY_DELTA[`${dir.dx},${dir.dy}`];
    if (name !== undefined) roundInputLog.push({ t: sim.elapsed, player: playerId, dir: name });
    const accepted = sim.applyInput(playerId, dir);
    if (inputLatency !== null) {
      // `sim.getState()` is only read here on an *accepted* input — a handful of times a second at most for
      // a human player, never once a frame — so KS-07-06 never adds the cost `ARCHITECTURE §4`'s snapshot
      // clone would if this ran on every `runUpdate` instead. A rejected input passes `-1`, which
      // `recordApplied` documents it never reads.
      const tick = accepted ? /** @type {RoundSnapshot} */ (sim.getState()).tick : -1;
      inputLatency.recordApplied(playerId, tick, accepted);
    }
  }

  /**
   * KI-12-02: feeds every configured `CpuPlayer`'s decision into {@link handleDirection}, exactly as
   * `input.js`'s keydown listener feeds a human's — this file's own header note explains why that, and not a
   * second call to `sim.applyInput`, is the whole of this function.
   *
   * `runUpdate`'s first line, every frame, for every session: {@link hasCpuPlayer} is the "no CPU configured
   * costs one boolean read" guard this file's header note promises, and {@link acceptsSteeringInput} — the
   * same gate `handleDirection` itself uses — runs *before* either `CpuPlayer.decide()` call, so PAUSE (and
   * every other non-steering state) stops a CPU without ever asking its policy for an answer (AC3).
   */
  function driveCpuPlayers() {
    if (!hasCpuPlayer || sim === null) return;
    if (!acceptsSteeringInput()) return;
    const snapshot = /** @type {import('./bots/policy.js').PolicySnapshot} */ (sim.getState());
    for (let index = 0; index < cpuPlayers.length; index += 1) {
      const cpu = cpuPlayers[index];
      if (cpu === null) continue;
      const dir = cpu.decide(snapshot, settings.grid);
      if (dir !== null) handleDirection(index + 1, dir);
    }
  }

  /**
   * KS-07-06: the timing counterpart to {@link handleDirection}, fired by `input.js`'s `onDirectionTimed`
   * for the same key, immediately before it. Purely a recording call — it makes no decision about whether
   * the input will be accepted; `handleDirection`'s own `sim.applyInput` call, a moment later in the same
   * synchronous keydown, resolves that.
   *
   * @param {number} playerNumber
   * @param {Direction} dir
   * @param {number} atMs
   */
  function handleDirectionTimed(playerNumber, dir, atMs) {
    if (inputLatency === null) return;
    const playerId = PLAYER_IDS[playerNumber - 1];
    if (playerId === undefined) return;
    inputLatency.recordKeydown(playerId, dir, atMs);
  }

  /**
   * A menu key. Most states hand it straight to the active screen's focus model; the three that do not are
   * the three with no focusable screen of their own:
   *
   * - **PLAYING / LASER_WARNING** — Esc *or Space* opens the pause screen (`DESIGN-DECISIONS §2.8`), and
   *   nothing else.
   * - **COUNTDOWN** — nothing at all. Mashing Enter through the countdown is a thing players do and a thing
   *   this sprint's QA plan explicitly tries; it must not skip the countdown or start anything twice.
   * - **ROUND_OVER** — Enter skips the scoreboard, but only once it has been up for
   *   {@link SCOREBOARD_SKIP_AFTER_SECONDS} (`§2.6`), so the Enter that was still held from the round cannot
   *   also skip the scoreboard that round produced.
   *
   * @param {MenuAction} action
   */
  function handleMenuAction(action) {
    const state = machine.getState();

    // `Space` (`DESIGN-DECISIONS §2.8`, issue #103): "behaves exactly like Esc for pausing... Space has no
    // other meaning anywhere". So it becomes the `BACK` Esc would have produced, but only in the three
    // states where Esc's `BACK` means pause or resume — PLAYING and LASER_WARNING open the pause screen,
    // PAUSE resumes through the same READY? beat — and is dropped everywhere else, which is what keeps it
    // from backing out of the main menu or the setup screen. Translating here rather than in `input.js`
    // keeps "which state is this" in the one module that already knows.
    /** @type {ScreenAction} */
    let menuAction;
    if (action === 'PAUSE_TOGGLE') {
      const pauses =
        state === STATES.PLAYING || state === STATES.LASER_WARNING || state === STATES.PAUSE;
      if (!pauses) return;
      menuAction = 'BACK';
    } else {
      menuAction = action;
    }

    switch (state) {
      case STATES.PLAYING:
      case STATES.LASER_WARNING:
        if (menuAction === 'BACK' && readyRemaining === 0) machine.dispatch(GAME_EVENTS.PAUSE);
        return;
      case STATES.COUNTDOWN:
        return;
      case STATES.ROUND_OVER:
        // KI-11-02, tech-lead note 3: while a gap is open, every menu key belongs to the prompt — Enter
        // answers its focused field rather than skipping the scoreboard underneath it.
        if (playtestPrompt !== null && playtestPrompt.isOpen()) {
          playtestPrompt.handleAction(menuAction);
          return;
        }
        if (menuAction === 'CONFIRM' && scoreboardElapsed >= SCOREBOARD_SKIP_AFTER_SECONDS) {
          leaveScoreboard();
        }
        return;
      default:
        ui.handleMenuAction(menuAction);
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
   * KI-06-01: the canvas lost its WebGL context — a laptop waking from sleep, a driver reset, a browser
   * reclaiming GPU memory. Pause **exactly the way PAUSE does**, through the same `AUTO_PAUSE` event a
   * backgrounded tab already uses, so `loop.timeScale` goes to 0 and `runUpdate`'s `default` case ticks
   * nothing: no simulated time passes while there is nothing to see (AC2). The simulation is pure and
   * headless and survives all of this untouched, which is exactly what makes the match recoverable.
   *
   * `can()` first, for the same reason {@link autoPause} guards: a context is lost from a menu too, and only
   * PLAYING and LASER_WARNING have an `AUTO_PAUSE` row. The flag is set only when the pause is really ours,
   * so {@link handleContextRestored} has a truthful answer to "did I pause this?".
   */
  function handleContextLost() {
    if (!machine.can(GAME_EVENTS.AUTO_PAUSE)) return;
    pausedByContextLoss = true;
    autoPause();
  }

  /**
   * KI-06-01: the context came back, and the renderer has already repaired itself (`renderer.js` registers
   * its own restore listener before this one). Resume through {@link resume} — the same function the RESUME
   * row and Esc call — so the match continues through the same one-second READY? beat a normal resume plays,
   * from the same tick it stopped on. There is deliberately no second path: recovery that does not reuse the
   * ordinary resume is recovery nobody has tested.
   *
   * The flag is cleared **before** the decision, not inside {@link resume}'s guard: the player may have left
   * the pause by another door while the canvas was dead (QUIT TO MENU, RESTART MATCH), in which case
   * `resume()` finds no `RESUME` row and does nothing — and a flag left standing there would make the *next*
   * pause, the one the player opened deliberately, look like the context's to end.
   */
  function handleContextRestored() {
    const owedResume = pausedByContextLoss;
    pausedByContextLoss = false;
    if (owedResume) resume();
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
    // KI-06-01: however this pause ends, it is no longer the context's to end. A player who pressed RESUME
    // while the canvas was still dead has answered the question themselves.
    pausedByContextLoss = false;
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
      [STATES.REPLAY]: showReplayScreen,
    },
  });

  const input = createInput({
    onDirection: handleDirection,
    onMenu: handleMenuAction,
    // KS-07-06: `handleDirectionTimed` costs one extra no-op-shaped call per steering key when
    // `inputLatency` is `null` (every production load) — see `handleDirectionTimed`'s own early return.
    onDirectionTimed: handleDirectionTimed,
    // 'both' for the session's whole life: the same key means steering in one state and navigation in
    // another, and the two handlers above already know which state they are in. Switching `input.js`'s mode
    // on every transition would put the same knowledge in two places.
    mode: 'both',
    target: inputTarget,
    now,
  });

  const loop = createLoop({
    update: runUpdate,
    render: drawFrame,
    onAutoPause: autoPause,
    requestFrame,
    cancelFrame,
    now,
    visibilitySource,
    // KI-06-03: `pagehide`/`freeze` for a tab the browser suspends, and the `pagehide`/`freeze`/`pageshow`/
    // `resume` return trip that must not credit the frame loop with the gap. Forwarded verbatim — `loop.js`
    // already owns the clamp, the cancellation and the "next frame is zero-length" reset this ticket needs,
    // so this file has nothing of its own to add beyond wiring the two sources through.
    documentLifecycleSource,
    windowLifecycleSource,
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

  // KI-06-01. The subscription lives here rather than in `main.js` because pausing and resuming a match is
  // this file's job, and it goes through the renderer rather than through the canvas because `src/game/`
  // may not touch the DOM (`ARCHITECTURE §3`). Both members are optional on {@link SessionRenderer}, so a
  // test renderer that knows nothing about context loss simply never subscribes.
  /** @type {(() => void)[]} */
  const contextLossUnsubscribes = [
    renderer.onContextLost?.(handleContextLost),
    renderer.onContextRestored?.(handleContextRestored),
  ].filter((off) => off !== undefined);

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
      for (const off of contextLossUnsubscribes) off();
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
      return {
        ...matchSettings,
        colors: { ...matchSettings.colors },
        playerKinds: { ...matchSettings.playerKinds },
      };
    },
    /**
     * The seeds this match has used and the match seed they derive from (`AC4`, and the ticket's "round seeds
     * are exposed via `__kobi` for replays").
     */
    getSeeds() {
      return { matchSeed, roundIndex, roundSeeds: [...roundSeeds] };
    },
    /**
     * KS-07-06: the keydown-to-render latency stats, in both ms and sim steps (AC1). Safe to call whether or
     * not `enableInputStats` was on — {@link disabledInputLatencyStats} answers with the same shape, `enabled:
     * false`, when it was not, so `testHooks.js`'s `getInputStats()` never has to branch.
     */
    getInputStats() {
      return inputLatency === null ? disabledInputLatencyStats() : inputLatency.getStats();
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
     * The window changed shape (KI-16-02). Re-frames the camera and the drawing buffer to the canvas's new
     * box, rewrites the HUD, and draws exactly one frame — **advancing no simulated time whatsoever**
     * (AC3). `main.js`'s `resize` listener is the only caller.
     *
     * Three things have to happen here rather than being left to the next animation frame, and each is a
     * visible defect if it is not:
     *
     * 1. **The frame.** `renderer.resize()` replaces the drawing buffer; until something draws into it the
     *    browser scales whatever was in the old one across the new CSS box, so the arena visibly stretches
     *    for a frame. Drawing immediately means there is never such a frame. (This is the "without a frame
     *    of stretched canvas" half of the ticket.)
     * 2. **The HUD.** `writeHud` is throttled to 10 Hz (`ARCHITECTURE §8`), and the power-up tags are
     *    positioned as fractions of the viewport that `powerUpTagsFor` projects through the camera. After a
     *    re-frame those fractions are stale, so a tag would sit away from its snake for up to
     *    `HUD_INTERVAL_SECONDS`. Writing it here costs one projection and removes the whole window.
     * 3. **No time.** The draw goes through {@link drawFrameWithDt} with `dt = 0` and nothing calls
     *    `runUpdate`, so the round's tick, the countdown, the scoreboard beat and the camera's own effect
     *    envelopes are all exactly where they were. Resizing the window mid-round is not a way to play the
     *    game faster, and a player dragging a window edge produces a great many of these events.
     *
     * A canvas with no area — a minimised window — re-frames nothing and draws nothing: `renderer.resize()`
     * answers `false` and there is no sensible picture to produce for a zero-pixel viewport anyway. The
     * restore fires its own `resize` and is handled like any other.
     *
     * @returns {boolean} whether the canvas had an area and the frame was redrawn
     */
    resize() {
      if (!renderer.resize()) return false;
      writeHud();
      drawFrameWithDt(0);
      return true;
    },
    /**
     * KI-15-02: the exact object the last {@link drawFrame} call handed the renderer — `EMPTY_SNAPSHOT`,
     * `MATCH_SETUP_SNAPSHOT`, or a live round's own state. Test-only readback for `__kobi.getRenderedSnapshot`
     * (`testHooks.js`, declared in this ticket's PR description as outside its own `Files:` list).
     */
    getRenderedSnapshot() {
      return lastRenderedState;
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
        // KI-12-04: an `overrides.playerKinds` here bypasses the setup screen's own row entirely (this is
        // the shortcut `tests/e2e`/`tests/visual` use to reach a CPU match in one call), so it needs the same
        // reconciliation `showMatchSetup`'s `onChange` gives a real row change. Guarded on the key being
        // present at all — `overrides` with no `playerKinds` (every pre-existing caller, and KI-12-02's own
        // `cpu.spec.js`, which configures a CPU with `setCpuPlayer` and then calls `startMatch()` bare) must
        // leave a manually configured `cpuPlayers` completely alone.
        if (overrides.playerKinds !== undefined) {
          syncCpuPlayersFromKinds(matchSettings.playerKinds, overrides.playerKinds);
        }
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
    /**
     * Applies a tuning-overlay override tree (`src/game/tuning.js`'s `buildSettingsOverride`) to every round
     * from the next one onward (KS-07-01 AC1). The round already in progress is untouched — it captured its
     * own settings when its `RoundSimulation` was constructed and this file never hands it another. Passing
     * `null` reverts to the settings this session was originally constructed with.
     *
     * @param {import('./tuning.js').TuningSettingsOverride | null} overrides
     */
    setSettingsOverrides(overrides) {
      settingsOverrides = overrides;
      settings = overrides === null ? baseSettings : withOverrides(overrides);
    },
    /**
     * The override tree {@link setSettingsOverrides} was last called with, or `null` (KS-07-01). The overlay
     * reads this to redraw its own controls after a page that did not set them itself (none in this sprint,
     * but it keeps the getter honest rather than write-only).
     */
    getSettingsOverrides() {
      return settingsOverrides;
    },
    /**
     * KI-11-02's nullable seam (tech-lead note 2 on issue #161): registers the `?playtest=1` prompt, or
     * clears it back to `null`. `main.js` is the only caller, and only under its own flag — see this file's
     * header note for the three call sites that read `playtestPrompt` and why each short-circuits on `null`.
     * @param {SessionPlaytestPrompt | null} prompt
     */
    setPlaytestPrompt(prompt) {
      playtestPrompt = prompt;
    },
    /**
     * KI-12-02's seam: makes `playerNumber` (1 or 2) a CPU driven by `policy`, or hands it back to a human
     * when `policy` is `null` — the default for both players on every session
     * (`DESIGN-DECISIONS §1` row 27: "defaulting to HUMAN for both"). This file knows nothing beyond "does
     * player N have a policy function": KI-12-03 supplies the three named levels behind `policyForLevel`, and
     * KI-12-04's own {@link syncCpuPlayersFromKinds} is the match-setup switch's translation from a
     * `PlayerKind` down to this same call — a test or `__kobi` may still call this directly with a raw
     * policy, bypassing `matchSettings` entirely, exactly as `tests/e2e/cpu.spec.js` does.
     *
     * @param {PlayerNumber} playerNumber
     * @param {import('./bots/policy.js').Policy | null} policy
     */
    setCpuPlayer(playerNumber, policy) {
      assignCpuPlayer(playerNumber, policy);
    },
    /**
     * The current round's replay, in exactly the shape `tests/sim/replays/*.json` fixtures use (KS-07-01
     * AC2): the seed it was built from, the override tree that built its settings, every input actually
     * applied and the full event log produced so far. `JSON.stringify(session.getReplay())` is a fixture a
     * human can drop straight into `tests/sim/replays/` and it replays identically through
     * `tests/sim/harness.js`'s `runRound` — `replay.test.js` already asserts every file there does.
     *
     * `seed`/`inputs`/`expectedEvents` read `null`/`[]` when there is no round yet (before the first
     * countdown) rather than throwing, since the overlay may be open on the main menu.
     *
     * @returns {{seed: number | null, settingsOverrides: object, inputs: object[], expectedEvents: object[]}}
     */
    getReplay() {
      return captureReplaySnapshot();
    },

    /**
     * KI-05-02: loads a replay and builds its player (`replayPlayer.js`'s `createReplayPlayer`), discarding
     * whatever replay was loaded before. `input` is whatever `parseReplay` accepts — JSON text, or an
     * already-parsed value such as another session's `getReplay()` (KI-05-01's seam). Never throws: a
     * malformed file, an unsupported version or a `seed: null` replay all come back as `{ok: false, error}`
     * rather than leaving the previous replay (or a half-built one) in place.
     *
     * @param {string | unknown} input
     * @returns {{ok: true} | {ok: false, error: {code: string, message: string}}}
     */
    loadReplay(input) {
      return loadReplayInternal(input);
    },
    /** Whether a replay is currently loaded. */
    hasReplay() {
      return replayPlayer !== null;
    },
    /** Marks the loaded replay as playing; {@link advanceReplayFrame} is what actually moves it forward. */
    playReplay() {
      playReplayInternal();
    },
    /** Marks the loaded replay as paused. `stepReplay`/`seekReplay` still work while paused. */
    pauseReplay() {
      pauseReplayInternal();
    },
    /** @returns {boolean} */
    isReplayPlaying() {
      return replayPlayer?.isPlaying() ?? false;
    },
    /** Advances the loaded replay by exactly one simulation tick. A no-op once it has left `PLAYING`. */
    stepReplay() {
      return stepReplayInternal();
    },
    /**
     * Seeks the loaded replay to `tick` by replaying it from the start (ticket spec: "cheap and exact") — see
     * `replayPlayer.js`'s own `seek`.
     * @param {number} tick
     */
    seekReplay(tick) {
      seekReplayInternal(tick);
    },
    /**
     * Consumes `wallSeconds` of real time of the loaded replay, while it is playing, then draws it with the
     * existing renderer and HUD (ticket spec) — the replay-mode counterpart to `advanceSimulation`/
     * `fastForward`. A no-op (still renders) when no replay is loaded or it is paused.
     * @param {number} wallSeconds
     */
    advanceReplayFrame(wallSeconds) {
      advanceReplayInternal(wallSeconds);
    },
    /** Draws one frame of the loaded replay's current tick, without advancing it. */
    renderReplayFrame() {
      renderReplayFrame();
    },
    /** The loaded replay's current tick, or `null` when none is loaded. */
    getReplayTick() {
      return replayPlayer?.tick ?? null;
    },
    /** The loaded replay's current `RoundSimulation` phase, or `null` when none is loaded. */
    getReplayPhase() {
      return replayPlayer?.phase ?? null;
    },
    /** The loaded replay's event log so far, or `[]` when none is loaded. */
    getReplayEvents() {
      return replayPlayer?.getEvents() ?? [];
    },
    /** The loaded replay's current snapshot, or `null` when none is loaded. */
    getReplaySnapshot() {
      return replayPlayer?.getSnapshot() ?? null;
    },
  };
}
