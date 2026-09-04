# Sprint 04 — Match Structure & Game Flow

**Lead:** Sonnet (Opus owns the state machine) · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-03-done`

## Goal
Replace the placeholder "press Enter" flow with the real game-state machine: main menu (grey), match setup
(grey), countdown 3-2-1-GO, playing, laser warning sub-state, round over with scoreboard, match over with
best-of logic and rewards computed (not yet persisted), pause and auto-pause. Every transition is tested.

## In scope
`match.js`, `gameStateMachine.js`, `session.js` rewrite, grey-box HTML screens for menu / setup / countdown /
scoreboard / match over / pause with the final keyboard model, rematch, draw handling.

## Out of scope
Visual design of screens (S10), save persistence (S12), audio (S11), power-ups (S05), tutorial/practice/shop (S12–S13; menu items present but disabled with "COMING SOON").

## Tickets

### KS-04-01 · MatchState
Owner: Sonnet · Size: S · Depends on: —
Files: `src/core/match.js`, `tests/unit/core/match.test.js`
Spec: `createMatch({ bestOf, players })` → `{ wins: {1:0, 2:0}, roundsPlayed, target, recordRound(result),
isOver(), winner, winsNeeded(player), rewardKeys }`. Draw increments `roundsPlayed` but no wins. Target per
`DESIGN-DECISIONS §2.6`; `rewardKeys` from `settings.rewards`.
Acceptance criteria:
- [ ] AC1 Bo1/Bo3/Bo5 targets 1/2/3; winner set exactly when reached.
- [ ] AC2 Draws never end a match; 20 consecutive draws still `isOver() === false`.
- [ ] AC3 Rewards 0/1/2.
QA: unit.

### KS-04-02 · Game state machine
Owner: Opus · Size: M · Depends on: KS-04-01
Files: `src/game/gameStateMachine.js`, `tests/unit/game/gameStateMachine.test.js`
Spec: Data-driven table per `ARCHITECTURE §6` with states `MAIN_MENU, MATCH_SETUP, TUTORIAL, PRACTICE, SHOP,
SETTINGS, COUNTDOWN, PLAYING, LASER_WARNING, ROUND_OVER, MATCH_OVER, PAUSE`. Events: `SELECT_2P, SELECT_PRACTICE,
SELECT_TUTORIAL, SELECT_SHOP, SELECT_SETTINGS, BACK, START_MATCH, COUNTDOWN_DONE, LASER_WARNING,
LASER_WARNING_DONE, ROUND_OVER, NEXT_ROUND, MATCH_OVER, REMATCH, PAUSE, RESUME, QUIT_TO_MENU, AUTO_PAUSE`.
`PAUSE` remembers the state it came from (PLAYING or LASER_WARNING). Illegal transitions throw in DEV and are
ignored in production (logged once). `onEnter/onExit` hooks per state. Exposes `can(event)`.
Acceptance criteria:
- [ ] AC1 Every row of the table is exercised by a test (generate tests from the table so a new transition without a test fails a "table coverage" assertion).
- [ ] AC2 `RESUME` from PAUSE returns to the exact prior state.
- [ ] AC3 `BACK` from MAIN_MENU is a no-op; from MATCH_SETUP returns to MAIN_MENU.
- [ ] AC4 `ROUND_OVER` → `NEXT_ROUND` → COUNTDOWN when match not over; `MATCH_OVER` when it is.
QA: unit.

### KS-04-03 · Session rewrite around the state machine
Owner: Opus · Size: L · Depends on: KS-04-02
Files: `src/game/session.js`, `src/main.js`, `src/game/testHooks.js`
Spec: Session holds `matchSettings { bestOf, powerUpsEnabled, musicTrack, colors: {1, 2} }`, `match`, `sim`,
and drives the machine. COUNTDOWN: create the sim (new seed per round, derived from the match seed + round
index), snakes frozen, HUD shows 3/2/1/GO at `countdownStepSeconds` each; inputs during GO are queued.
PLAYING: loop runs; `LASER_WARNING` event → machine event; `SNAKE_DIED` → `timeScale = crashSlowMo.scale` for
`crashSlowMo.duration` of wall time → `ROUND_OVER`. ROUND_OVER: scoreboard for `scoreboardSeconds`, Enter after
1 s skips; then `NEXT_ROUND` or `MATCH_OVER`. MATCH_OVER: winner + keys earned (display only) + REMATCH / MENU.
Esc during PLAYING → PAUSE; `loop.onAutoPause` → AUTO_PAUSE. Round seeds are exposed via `__kobi` for replays.
Acceptance criteria:
- [ ] AC1 Full Bo3 played by e2e with scripted crashes: 2 rounds → MATCH_OVER with winner and 1 key shown.
- [ ] AC2 A DRAW round shows "DRAW — REPLAY" and does not change wins.
- [ ] AC3 Pause freezes the timer; resume shows READY? for 1 s; timer resumes from the same value.
- [ ] AC4 Round seeds differ per round but are reproducible from the match seed.
QA: e2e `tests/e2e/match-flow.spec.js`.

### KS-04-04 · Grey-box screens with the shared focus model
Owner: Sonnet · Size: M · Depends on: KS-04-02
Files: `src/ui/focus.js`, `src/ui/ui.js`, `src/ui/screens/mainMenu.js`, `src/ui/screens/matchSetup.js`, `src/ui/screens/countdown.js`, `src/ui/screens/scoreboard.js`, `src/ui/screens/matchOver.js`, `src/ui/screens/pause.js`, `src/ui/styles.css`, `tests/unit/ui/focus.test.js`
Spec: `focus.js` implements `ARCHITECTURE §8` navigation (list of focusables, wrap-around, ←/→ value change
via `onChange`, Enter/Esc). Main menu items exactly as GDD: 1 PLAYER (disabled, "COMING SOON"), 2 PLAYERS,
PRACTICE (disabled until S13), TUTORIAL (disabled until S13), SHOP (disabled until S12), SETTINGS (disabled until
S11). Match setup rows: MATCH LENGTH, POWER-UPS, MUSIC, PLAYER 1 colour, PLAYER 2 colour, START MATCH; colour rows
cycle owned colours and enforce the swap rule (`DESIGN-DECISIONS §2.7`). Scoreboard shows the GDD example
format ("BEST OF 5 / Blue: 2 wins / Red: 1 win / Blue needs 1 more win"). All unstyled beyond legibility.
Acceptance criteria:
- [ ] AC1 Every screen is fully operable with keyboard only and with mouse only.
- [ ] AC2 Disabled items are skipped by focus and show COMING SOON.
- [ ] AC3 Choosing the same colour for both players swaps them.
- [ ] AC4 Focus ring is visible on the focused element (screenshot).
QA: unit for focus + e2e `tests/e2e/menus.spec.js`.

### KS-04-05 · Flow e2e suite and replays
Owner: Sonnet-QA · Size: M · Depends on: KS-04-03, KS-04-04
Files: `tests/e2e/match-flow.spec.js`, `tests/e2e/menus.spec.js`, `tests/e2e/pause.spec.js`, `tests/visual/screens.visual.spec.js`
Spec: Cover Bo1/Bo3/Bo5 completion, draw replay, pause/resume/quit, auto-pause on hidden tab, rematch keeps
settings, back navigation from every screen, visual baselines for every screen.
Acceptance criteria:
- [ ] AC1 All pass in CI; run time ≤ 4 min.
QA: —

## QA plan (sprint pass)
1. Adversary: mash Enter during countdown, press Esc during slow-mo, hide the tab during the scoreboard, resize
   during MATCH_OVER, start a match with power-ups OFF (still no power-ups since S05 is not done — verify nothing throws).
2. State machine table printed to the QA report with a check per row.
3. Human: play a Bo5; confirm the between-round flow "quick scoreboard then 3-2-1-GO" feels quick.

## References
- GDD §4 "Match formats", "Between rounds", §5 "Match structure", "Between-round scoreboard", "Main menu", "Match setup screen", §7 "Suggested game states"
- `DESIGN-DECISIONS §2.5–2.8`; `ARCHITECTURE §6, §8`

## Risks
- Slow-mo uses wall time while the sim uses sim time; keep them separate or the timer drifts (AC3).

## Exit criteria
- [ ] Table-coverage test proves every transition is tested.
- [ ] Human confirms flow pacing.
- [ ] Tag `sprint-04-done`.
