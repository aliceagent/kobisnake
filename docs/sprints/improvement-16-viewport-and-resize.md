# Improvement 16 — Viewport and resize robustness

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1 · **Prerequisite:** none
**Origin:** every test, baseline and design confirmation in this project is at 1280×720

## Goal
Make the game correct in whatever window it is given. The camera was locked with a "confirmed picture" at
16:9; the HUD pills, the tuning overlay's fold and every baseline assume 1280×720. Nobody has looked at a
4:3 laptop, a vertical ultrawide split, a browser at 150 % zoom, a high-DPI display, a window that is resized
mid-round, or the 800×600 a school laptop still ships with. Sprint 16 tests browser engines; it does not test
window shapes.

## In scope
Resize handling mid-round, aspect-ratio framing rules, DPR handling, minimum-size behaviour, and a matrix of
viewport baselines.

## Out of scope
Touch and mobile (desktop-only by the GDD), rotating the camera, any change to the 16:9 confirmed picture.

## Tickets

### KI-16-01 · Measure it
Owner: Sonnet · Size: S · Depends on: I03 KI-03-01
Files: `tests/agent/viewports.js`, `docs/qa/playtests/viewports.md`
Spec: Through the agent driver, load a mid-round frame at 1280×720, 1024×768, 800×600, 1920×1080, 2560×1080,
1280×720 at DPR 2, and 640×480, and record for each: whether the whole arena is on screen, whether either HUD
pill overlaps the arena, whether the laser banner overlaps a pill, and the canvas's backing size. Screenshots
committed for the design lead.
Acceptance criteria:
- [ ] AC1 A committed table with a screenshot per viewport.
- [ ] AC2 Each overlap question answered by `getBoundingClientRect`, not by eye.
QA: agent.

### KI-16-02 · Framing rule and resize
Owner: Opus · Size: M · Depends on: KI-16-01
Files: `src/render/camera.js`, `src/render/renderer.js`, `src/game/session.js`, `docs/design/DESIGN-DECISIONS.md`, tests
Spec: A framing rule that keeps the whole arena plus one wall thickness visible at any aspect ratio — fit to
the shorter axis, pitch and yaw untouched, so the 16:9 picture is exactly today's. Handle `resize` mid-round
without a frame of stretched canvas, and DPR without blurring. Recorded as a `DESIGN-DECISIONS` row: the
confirmed picture is a *minimum*, not the only shape.
Acceptance criteria:
- [ ] AC1 At every viewport in KI-16-01's list the arena's projected bounds are inside the canvas; asserted numerically.
- [ ] AC2 At 1280×720 the camera parameters are unchanged and every existing baseline passes.
- [ ] AC3 A resize during PLAYING advances no simulated time and the next frame is correctly framed.
QA: unit + e2e + visual.

### KI-16-03 · HUD and overlays at every size
Owner: Sonnet · Size: M · Depends on: KI-16-02
Files: `src/ui/styles.css`, `src/ui/hud.js`, `src/ui/screens/tuning.js`, tests, visual baselines
Spec: Pills, timer, laser banner, power-up tags and the tuning fold never overlap the arena or each other at
any measured viewport; below a stated minimum (640×480) a plain "make the window bigger" note replaces the
HUD rather than a broken one.
Acceptance criteria:
- [ ] AC1 The `elementFromPoint` check from KS-07-01 passes at every viewport in the list.
- [ ] AC2 Below the minimum, the note shows and the game still runs.
- [ ] AC3 Baselines at 1024×768 and 1920×1080 added alongside the 1280×720 set.
QA: e2e + visual.

## QA plan
The agent viewport matrix is the instrument; the design lead reviews the screenshots at three sizes.

## References
- `DESIGN-DECISIONS §1` row 24 (camera, confirmed picture), KS-07-01's overlay fold, `ARCHITECTURE §12`

## Risks
- **Changing the confirmed picture.** AC2 of KI-16-02 forbids it at 16:9.
- **Baseline explosion.** Two extra sizes, chosen from the matrix, not all seven.

## Exit criteria
- [ ] The whole arena is visible and the HUD is clear at every measured viewport.
- [ ] A mid-round resize is harmless.
- [ ] The 16:9 picture is unchanged.
