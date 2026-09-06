# Sprint 03 — Grey-box Renderer, Input & First Playable

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-02-done`

## Goal
**Milestone 1 from the GDD:** two snakes in a square arena, on screen, controlled by WASD and Arrow keys, with
movement that feels excellent. Everything is grey-box (plain boxes, flat colours) but the camera, the
interpolation and the input feel are final.

## In scope
Game loop, fixed-step accumulator, keyboard input, locked camera, box-based arena/snake/apple views, segment
interpolation and corner bending, a minimal HTML HUD (timer only), a minimal "press Enter to start / round over
press Enter" flow, the `window.__kobi` test hooks, first e2e and visual tests of real gameplay.

## Out of scope
Art, materials, lighting polish (S08–S10), menus (S11), lasers (S04), match logic (S05).

## Tickets

### KS-03-01 · Game loop with fixed-step accumulator and time scale
Owner: Opus · Size: M · Depends on: —
Files: `src/game/loop.js`, `tests/unit/game/loop.test.js`
Spec: `createLoop({ update(dt), render(alpha) })` using `requestAnimationFrame`; frame dt clamped to 0.1 s;
`timeScale` property (1, 0.25, 0); `start()`, `stop()`, `step(dt)` for tests. Pauses on `visibilitychange`
hidden and resumes on visible with an explicit `onAutoPause` callback so the UI can show "READY?". No sim code
here; it just calls `update`.
Acceptance criteria:
- [ ] AC1 Feeding frames of 250 ms results in `update` receiving at most 100 ms per frame.
- [ ] AC2 `timeScale = 0.25` quarters the dt passed to `update`.
- [ ] AC3 Hidden tab stops updates; visible resumes and calls `onAutoPause` first.
QA: unit tests with a fake rAF.

### KS-03-02 · Keyboard input
Owner: Sonnet · Size: S · Depends on: —
Files: `src/game/input.js`, `tests/unit/game/input.test.js`
Spec: `createInput({ onDirection(playerId, dir), onMenu(action) })`. WASD → player 1, Arrow keys → player 2.
`preventDefault` on arrows and space so the page never scrolls. Menu actions: `UP DOWN LEFT RIGHT CONFIRM BACK`
from Enter/Esc/arrows/WASD; `setMode('game'|'menu'|'both')`. Key repeat is ignored (`event.repeat`). In
`soloSteering` mode both key sets go to player 1.
Acceptance criteria:
- [ ] AC1 Dispatching a `keydown` for `KeyW` calls `onDirection(1, UP)`; `ArrowLeft` calls `onDirection(2, LEFT)`.
- [ ] AC2 Repeated keydown events (`repeat: true`) are ignored.
- [ ] AC3 Arrow keydown has `defaultPrevented === true`.
QA: unit tests with synthetic events.

### KS-03-03 · Locked gameplay camera
Owner: Opus · Size: S · Depends on: —
Files: `src/render/camera.js`, `tests/unit/render/camera.test.js`
Spec: `createGameplayCamera({ grid, settings })` returns a `PerspectiveCamera` with FOV `settings.camera.fov`,
pitch `settings.camera.pitchDegrees` below horizontal, yaw 0, looking at the arena centre, distance solved so the
arena plus `margin` fits both the vertical and horizontal frustum at the current aspect (recomputed on resize).
Provide `shake(amplitude, seconds)` and `zoomPulse(percent, seconds)` that modify the camera each frame and
decay; both are no-ops when `?reducedFx=1`. Match panel C of `03-camera-angle-comparison.png` and the framing of
`02-standard-gameplay-camera.png`: the far wall's top edge sits just under the HUD line, the near wall is fully
visible.
Acceptance criteria:
- [ ] AC1 At 16:9 the projected arena corners lie within the viewport with the specified margin (assert by projecting the four floor corners).
- [ ] AC2 At 4:3 the arena still fits. (Amended after KS-03-03: with a fixed 32° vertical FOV the width constraint only binds below an aspect of ≈ 1.02, so 21:9, 16:9 and 4:3 share one distance; distance grows strictly at 1:1 and 3:4. Tests assert fit, monotonicity and the crossover.)
- [ ] AC3 Pitch is exactly 78° (dot product of forward vector with down).
QA: unit tests with `three` in node (no WebGL needed for matrix maths).

### KS-03-04 · Grey-box views: arena, snakes, apples with interpolation
Owner: Opus · Size: L · Depends on: KS-03-03
Files: `src/render/renderer.js`, `src/render/arenaView.js`, `src/render/snakeView.js`, `src/render/pickupView.js`, `src/render/materials.js`
Spec: Scene with a 24×24 floor of flat green tiles (slightly alternating shades already, since it is cheap) and
a one-cell-thick grey wall ring, one directional light with shadows, hemisphere fill. `SnakeView.update(snapshot)`
renders every segment as a rounded box (0.9 units, height 0.7) in the player colour, head 1.0 units and 0.85
tall with two white sphere eyes + black pupils facing the direction of travel. Position of each segment =
`lerp(previousCell, currentCell, stepProgress)`. Corner bending per `09-snake-turning-animation.png`: a segment
whose previous and next neighbours are not collinear is rendered at the corner cell with its box slightly
rotated toward the bisector so the chain reads as a curve; keep it subtle (≤ 20°). Growth: a new tail segment
scales from 0 to 1 over its first step. Apples: red sphere with a green disc leaf. Uses `InstancedMesh` for
segments. Dead snakes stay visible (frozen) until round reset.
Acceptance criteria:
- [ ] AC1 Snakes glide: with `?seed=1`, screenshots at stepProgress 0.25/0.5/0.75 show the head at interpolated world x positions within 0.02 units of the expected lerp (assert via `__kobi.getHeadWorldPosition`).
- [ ] AC2 A 20-segment snake renders in ≤ 3 draw calls per snake.
- [ ] AC3 Eyes face the direction of travel within one frame of a turn.
- [ ] AC4 Zero console warnings from three.js (no missing uniforms, no deprecated params).
QA: e2e `tests/e2e/interpolation.spec.js` and the visual smoke baseline of the first frame.

### KS-03-05 · Session wiring, minimal HUD and round flow
Owner: Sonnet · Size: M · Depends on: KS-03-01, KS-03-02, KS-03-04
Files: `src/game/session.js`, `src/ui/ui.js`, `src/ui/hud.js`, `src/ui/styles.css`, `src/main.js`
Spec: `main.js` builds `session` = loop + input + renderer + sim. Start state: an HTML overlay "PRESS ENTER"
(grey-box). Enter → new `RoundSimulation(seed from `?seed` or `Date.now()`)`, loop running, HUD shows `m:ss`
timer updated at 10 Hz and both players' current lengths. On `ROUND_OVER` overlay shows "P1 WINS / P2 WINS /
DRAW — PRESS ENTER" and Enter starts a new round. This flow is a placeholder for Sprint 05's state machine and
must be trivially removable.
Acceptance criteria:
- [ ] AC1 Two humans can play a full round with WASD and Arrows on the Vercel preview.
- [ ] AC2 Timer reads 1:30 at start and 0:00 at timeout; it does not advance while the tab is hidden.
- [ ] AC3 Round over → Enter → new round with fresh apples and snakes.
QA: e2e `tests/e2e/first-playable.spec.js` drives both players via keyboard, fast-forwards, and asserts the overlay text.

### KS-03-06 · Test hooks
Owner: Sonnet · Size: S · Depends on: KS-03-05
Files: `src/game/testHooks.js`, `src/main.js`
Spec: `window.__kobi` per `ARCHITECTURE §11`, gated on `import.meta.env.DEV || location.search.includes('test=1')`.
`fastForward(seconds)` advances the sim without rendering frames in between (one render at the end).
`pressKey(player, dir)` goes through the same path as real keyboard input. `getSnapshot()` returns
`sim.getState()`. `getHeadWorldPosition(player)`.
Acceptance criteria:
- [ ] AC1 Hooks are absent from the production build unless `?test=1` is present (assert `typeof window.__kobi`).
- [ ] AC2 `fastForward(90)` completes in < 500 ms.
QA: e2e.

### KS-03-07 · First-playable e2e and visual suite
Owner: Sonnet-QA · Size: M · Depends on: KS-03-06
Files: `tests/e2e/first-playable.spec.js`, `tests/e2e/interpolation.spec.js`, `tests/e2e/input.spec.js`, `tests/visual/gameplay.visual.spec.js`, `tests/visual/__baselines__/*`
Spec: Scenarios: (a) P1 turns up then left, P2 turns down; fast-forward 2 s; snapshot positions match the
headless sim run with the same seed and input log (cross-check e2e vs unit); (b) reversal key does nothing;
(c) tab hidden → timer frozen; (d) round-over overlay after a scripted wall crash; (e) visual baseline at t=0
and t=5 s with `?seed=1&reducedFx=1`.
Acceptance criteria:
- [ ] AC1 All scenarios pass in CI under 3 minutes.
- [ ] AC2 Scenario (a) proves the browser and the headless sim agree exactly on segment cells.
QA: —

## QA plan (sprint pass)
1. Two agents cannot share a keyboard; a **human** plays 5 rounds and answers Movement M1–M4 from
   `PLAYTEST-SCRIPT.md`. Any "ignored input" report is a blocker.
2. Adversary: hold a key down, mash all eight keys, alt-tab mid-round, resize to 300×300 and back.
3. Frame-time probe: p95 ≤ 16.6 ms on the reviewer's laptop with two 20-segment snakes (record the number).
4. Design fidelity: camera framing vs `02-standard-gameplay-camera.png` side by side (Fable).

## References
- GDD §5 "Perspective and camera", "Snake movement", "Player controls"
- `DESIGN-DECISIONS §1 row 24, §2.1, §2.2`; `ARCHITECTURE §5, §7, §11`
- Images `02-standard-gameplay-camera.png`, `03-camera-angle-comparison.png` (panel C), `09-snake-turning-animation.png`

## Risks
- Interpolation across a growth step or a death step is where visual glitches hide; KS-03-04 must handle
  `previousSegments` length changes explicitly.
- Human playtest availability: schedule it the moment KS-03-05 has a preview.

## Exit criteria
- [ ] Human playtest M1–M4 all pass; the reviewer writes "movement feels excellent" or lists what is wrong.
- [ ] e2e/visual suites green; hooks absent in production.
- [ ] Tag `sprint-03-done` and additionally `m1-first-playable`.
