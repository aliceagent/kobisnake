# Sprint 15 — Tutorial & Practice Mode

**Lead:** Sonnet · **Agents:** Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-14-done`

## Goal
An interactive, skippable, replayable seven-step tutorial with large text bubbles (GDD "Tutorial"), and a
practice mode reachable from the main menu and from the shop's TRY with no timer, no rewards and both key sets
steering.

## In scope
`modes/practice.js`, `modes/tutorial.js`, tutorial bubble UI, scripted tutorial arena, tutorial completion flag,
menu items enabled.

## Out of scope
Voice, videos, single-player scoring.

## Tickets

### KS-15-01 · Practice mode
Owner: Sonnet · Size: M · Depends on: —
Files: `src/modes/practice.js`, `src/game/session.js`, `src/ui/screens/practiceHud.js`
Spec: `RoundSimulation` in `mode: 'practice'`: one snake by default (second snake optional via a toggle on the
practice HUD, for two people to warm up), no timer, apples and power-ups ON, lasers OFF by default with a
"LASERS: OFF/ON" toggle that when ON runs a repeating 30-second closing cycle then resets the arena (so
players can rehearse the climax). Death → 1 s pause → respawn, arena reset. Esc → menu (or back to the shop if
launched from TRY). HUD shows length and a hint line ("Esc back · L lasers · 2 second snake"). Nothing is saved.
Both key sets steer the single snake.
Acceptance criteria:
- [ ] AC1 Both WASD and Arrows steer the one snake in single-snake practice.
- [ ] AC2 Death respawns without leaving PRACTICE state; save data unchanged after 10 deaths.
- [ ] AC3 Lasers toggle runs the cycle and resets; `LASER_STEP` events follow the normal schedule.
- [ ] AC4 TRY from the shop enters practice with the tried colour and Esc returns to the shop with focus on that pedestal.
QA: e2e `tests/e2e/practice.spec.js`.

### KS-15-02 · Tutorial script engine and bubble UI
Owner: Sonnet · Size: L · Depends on: KS-15-01
Files: `src/modes/tutorial.js`, `src/ui/screens/tutorialBubble.js`, `tests/unit/modes/tutorial.test.js`
Spec: Steps exactly as GDD "Tutorial": (1) "Use WASD or Arrow Keys to steer" — completes after two different
turns; (2) "Grab the food" — a single apple placed 4 cells ahead; completes on `FOOD_EATEN`; (3) "Your snake
grows when you collect food" — highlights the new tail segment with a light ring for 2 s; (4) "Grab the
power-up" — SPEED spawned 5 cells ahead; (5) "Speed Boost! You move faster for 5 seconds" — completes on
`EFFECT_ENDED`; (6) "Careful! Hitting walls or snakes ends the round" — a short ghost demonstration: a grey
demo snake drives into the wall and crashes with the debris effect (uses a second sim instance rendered
alongside, no risk to the player); (7) "In the last 30 seconds the lasers close in!" — lasers run one closing
cycle at 2× speed while the player's snake is invulnerable (test-only `godMode` is not used; instead the
tutorial pauses laser deaths via a tutorial-only flag in the practice sim mode); finish "You're ready!" with a
big PLAY button → main menu, `tutorialCompleted = true`. Bubble per `DESIGN-DECISIONS §3 "Tutorial"`: top-left,
≤ 2 lines, 32 px, key-cap row when relevant. "SKIP (Esc)" bottom-right. Each step also has a short "check"
predicate the engine polls from simulation events; steps are data (`TUTORIAL_STEPS` array) so they are
testable without the DOM.
Acceptance criteria:
- [ ] AC1 Unit: feeding the step engine a synthetic event stream completes all seven steps in order; a wrong event does not advance.
- [ ] AC2 e2e: a scripted player finishes in ≤ 90 s of sim time; `tutorialCompleted` saved.
- [ ] AC3 Esc at any step returns to the menu without saving completion.
- [ ] AC4 Fable approves bubble text and layout against the image-17 prompt.
QA: unit + e2e `tests/e2e/tutorial.spec.js` + visual.

### KS-15-03 · Menu wiring and first-run prompt
Owner: Sonnet · Size: S · Depends on: KS-15-02
Files: `src/ui/screens/mainMenu.js`, `src/game/gameStateMachine.js`
Spec: PRACTICE and TUTORIAL menu items enabled. When `tutorialCompleted` is false and the player selects
2 PLAYERS for the first time, show a small prompt "Play the tutorial first? (Enter yes · Esc no)" once; either
answer sets a session flag so it is not asked again this session.
Acceptance criteria:
- [ ] AC1 Prompt appears once and only when not completed.
QA: e2e.

### KS-15-04 · Tutorial and practice suites
Owner: Sonnet-QA · Size: S · Depends on: KS-15-02
Files: `tests/e2e/tutorial.spec.js`, `tests/e2e/practice.spec.js`, `tests/visual/tutorial.visual.spec.js`
Acceptance criteria:
- [ ] AC1 Green in CI.
QA: —

## QA plan (sprint pass)
1. Human (ideally someone who has never played): T1, T2 from `PLAYTEST-SCRIPT §9`.
2. Fable: bubble readability at 1080p and at 1366×768.
3. Adversary: die during step 2; collect the power-up before step 4; press Esc during the ghost crash.

## References
- GDD §4 "Practice mode", "Tutorial", §5 "Practice mode", "Tutorial", "Tutorial presentation/access/skip", §12 prompt 17
- `DESIGN-DECISIONS §1 row 14 (TRY), §3 "Tutorial"`

## Exit criteria
- [ ] T1 passes with a first-time player; tag `sprint-15-done`.
