# Sprint 16 — Single Player (post-1.0)

**Lead:** Sonnet (Fable designs first) · **Agents:** Fable ×1, Opus ×0.5, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-15-done`

## Goal
GDD Phase 8: a single-player mode that reuses the two-player systems: solo survival with apples, growth,
gradually increasing speed, the closing-laser climax on a repeating cycle, a numeric score and a local high
score. Replaces the "COMING SOON" item.

## Design (Fable, ticket KS-16-01 finalises)
Proposed rules, to be locked in `DESIGN-DECISIONS.md` §6 before build:
- One snake, both key sets steer. Arena and camera identical to two-player.
- Score: +10 per apple, +1 per second survived, +25 per power-up. High score saved per difficulty.
- Speed: starts at `snakeSpeed` and rises +0.25 cells/s per apple, capped at 12.
- Lasers: every 90 s cycle the last 30 s close as in two-player; at 0:00 the lasers **reset to the perimeter**,
  the cycle restarts, and the round continues (single-player never times out; you play until you die).
- Power-ups: same cycle; SLOW slows the laser step (already implemented for solo).
- Difficulty select: EASY (speed cap 9, lasers min 8×8), NORMAL (defaults), HARD (start speed 8, min 4×4).
- Game over: score, high score, RETRY / MENU. No keys awarded (keys are a two-player reward).

## Tickets
### KS-16-01 · Single-player design lock
Owner: Fable · Size: S · Depends on: — · Files: `docs/design/DESIGN-DECISIONS.md`, `src/core/settings.js`
Acceptance criteria: [ ] AC1 Section 6 added; settings `singlePlayer` block added; bot statistics target defined (median survival ≥ 60 s for survivorBot on NORMAL).

### KS-16-02 · Solo simulation mode
Owner: Opus · Size: M · Depends on: KS-16-01 · Files: `src/core/round.js`, `src/core/lasers.js`, `src/core/score.js`, `tests/unit/core/solo.test.js`
Spec: `mode: 'solo'`: no timeout, laser cycle reset, speed ramp, score events (`SCORE_CHANGED`).
Acceptance criteria: [ ] AC1 Laser cycle repeats at 90 s intervals with reset events; [ ] AC2 speed ramp and cap; [ ] AC3 score arithmetic; [ ] AC4 determinism holds.

### KS-16-03 · Solo flow, HUD and game-over screen
Owner: Sonnet · Size: M · Depends on: KS-16-02 · Files: `src/game/gameStateMachine.js`, `src/game/session.js`, `src/ui/hud.js`, `src/ui/screens/soloSetup.js`, `src/ui/screens/gameOver.js`, `src/save/saveData.js` (highScores, schema v2 migration)
Acceptance criteria: [ ] AC1 Menu 1 PLAYER → difficulty → countdown → play → game over → retry; [ ] AC2 high score persists per difficulty; [ ] AC3 HUD shows score and cycle timer; [ ] AC4 save migrates v1 → v2.

### KS-16-04 · Solo tests and statistics
Owner: Sonnet-QA · Size: M · Depends on: KS-16-02 · Files: `tests/sim/soloStats.test.js`, `tests/e2e/solo.spec.js`, `tests/visual/solo.visual.spec.js`
Acceptance criteria: [ ] AC1 survivorBot median survival meets the target on NORMAL; [ ] AC2 e2e and visuals green.

### KS-16-05 · Tutorial and docs update
Owner: Sonnet · Size: S · Depends on: KS-16-03 · Files: `src/modes/tutorial.js`, `docs/DEVELOPER-GUIDE.md`, `CHANGELOG.md`
Acceptance criteria: [ ] AC1 Tutorial mentions single player at the end; [ ] AC2 changelog 1.1.0 entry.

## QA plan
Human: 20 minutes solo on each difficulty; "one more go" test (does the player press RETRY unprompted?).
Adversary: die on the exact laser reset frame; reach speed cap; 200-segment snake.

## References
GDD §5 "Single-player future mode", §4 "Main menu"; images `14-main-menu.png` (stats panel), `06-final-shrink-showdown.png`.

## Exit criteria
- [ ] Fable signs; tag `sprint-16-done` and `v1.1.0`.
