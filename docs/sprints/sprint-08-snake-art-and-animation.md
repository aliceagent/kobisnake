# Sprint 08 — Snake Art & Animation

**Lead:** Sonnet (Opus reviews geometry/perf) · **Agents:** Sonnet ×2, Opus ×0.5, Sonnet-QA ×1, Fable (design review) · **Prerequisite:** `gate1-passed`. Runs in parallel with the UI track (S11).

## Goal
The snakes look like `07-snake-character-sheet.png`: chunky block-built segments with studs, a larger
expressive head with big white toy eyes and a cream mouth stripe, smooth corner bending as in
`09-snake-turning-animation.png`, satisfying growth, and toy-plastic materials, at the performance budget.

## In scope
Procedural brick geometry (no external model files), materials, head/eyes/mouth, segment connection look,
corner bending, growth animation, idle eye blink, colour catalogue applied to all eight colours, death "freeze"
pose (the debris effect is S10).

## Out of scope
Arena art (S09), particles/crash debris (S10), shop pedestals (S14).

## Tickets

### KS-08-01 · Brick geometry library
Owner: Opus · Size: M · Depends on: —
Files: `src/render/brickGeometry.js`, `tests/unit/render/brickGeometry.test.js`
Spec: Functions returning merged `BufferGeometry`: `roundedBox(w, h, d, radius, segments)`, `stud(radius, height)`,
`brick({ w, d, h, studsX, studsZ, radius })` = rounded box + studs on top merged into one geometry,
`segmentBrick()` (0.92 × 0.72 × 0.92, 2×2 studs), `headBrick()` (1.0 × 0.82 × 1.05 with a slight forward
taper and a 2×2 stud top), `eye(radius)`, `pupil(radius)`, `mouthStripe()`. Everything is cached by key. Vertex
counts documented in JSDoc; a segment ≤ 900 vertices.
Acceptance criteria:
- [ ] AC1 Geometries are watertight-enough for shadows (no NaN normals; bounding boxes match the stated sizes ± 0.01).
- [ ] AC2 Cache returns the same instance for the same key.
- [ ] AC3 Segment vertex count ≤ 900; head ≤ 2 500.
QA: unit (node, no WebGL).

### KS-08-02 · Toy plastic materials and colour catalogue
Owner: Sonnet · Size: S · Depends on: —
Files: `src/render/materials.js`, `tests/unit/render/materials.test.js`
Spec: `plastic(colorKey)` → `MeshStandardMaterial` per `DESIGN-DECISIONS §3 "Materials bible"`; Gold uses the
metallic variant. `eyeWhite`, `pupilBlack`, `mouthCream (#F5E6B3)`. Emissive variants for SPEED pulse
(`plasticEmissive(colorKey, intensity)`), and `tint(colorKey, 'slow')` for the pale-blue SLOW victim look.
Materials are shared singletons per key.
Acceptance criteria:
- [ ] AC1 All eight colours produce materials; hex values equal `SETTINGS.colors`.
- [ ] AC2 No hex literal exists in `src/render/**` outside `materials.js` (lint rule or grep test).
QA: unit + grep test.

### KS-08-03 · Snake view rebuild: segments, head, eyes, corners, growth
Owner: Sonnet · Size: L · Depends on: KS-08-01, KS-08-02
Files: `src/render/snakeView.js`
Spec: Replace grey-box boxes with `segmentBrick` instances (`InstancedMesh` per snake, capacity grows in
chunks of 32). Head is a separate mesh group: `headBrick` + two eyes (white spheres radius 0.17 with black
pupils radius 0.08 offset toward look direction) + mouth stripe on the front face, per the close-ups in
`07-snake-character-sheet.png`. Head faces travel direction; turning rotates the head over the step (slerp from
old to new yaw across `stepProgress`) so it "leans into" the turn as in frames 2–3 of
`09-snake-turning-animation.png`. Body corner bending: a segment at a corner cell is positioned on a quarter
circle between the incoming and outgoing edge midpoints (parametrised by stepProgress) instead of a straight
lerp, so the chain reads as a smooth curve; adjacent segments stay in contact (gap ≤ 0.06 units at all times).
Growth: new tail segment scales 0 → 1 with a small overshoot (1.15) over one step. Idle: eyes blink (scale y to
0.1 for 80 ms) every 3–5 s per snake, RNG-seeded so visual tests are stable. Dead snake: freeze at the death
frame (debris in S10 will hide it).
Acceptance criteria:
- [ ] AC1 Screenshot of a mid-turn snake with `?seed=1` matches the approved baseline; Fable approves the baseline against frames 3–5 of the turning sheet.
- [ ] AC2 Gap between consecutive segment centres never exceeds 1.06 units and never falls below 0.85 during a full bot round (assert via `__kobi.getSegmentWorldPositions`).
- [ ] AC3 Two 30-segment snakes render in ≤ 8 draw calls total and keep p95 frame time ≤ 16.6 ms in the perf probe.
- [ ] AC4 Both eyes and the mouth are visible from the gameplay camera at every yaw (four screenshots).
QA: visual + e2e geometry assertions + perf probe.

### KS-08-04 · Effect looks on the snake
Owner: Sonnet · Size: S · Depends on: KS-08-03
Files: `src/render/snakeView.js`, `src/render/materials.js`
Spec: SPEED: emissive yellow pulse travelling head → tail every 0.4 s plus a short translucent streak quad
behind the head. SLOW victim: pale-blue tint on all segments and a small white snowflake sprite hovering 0.6
units above the head, bobbing. Both end exactly on `EFFECT_ENDED`.
Acceptance criteria:
- [ ] AC1 Visual baselines for both states approved by Fable.
- [ ] AC2 Effects are cleared on `EFFECT_ENDED` within one frame (no lingering tint).
QA: visual + e2e.

### KS-08-05 · Snake visual test suite
Owner: Sonnet-QA · Size: M · Depends on: KS-08-03
Files: `tests/visual/snake.visual.spec.js`, `tests/e2e/snakeGeometry.spec.js`, `tests/perf/snakes.perf.spec.js`
Spec: Baselines: straight snake, mid-turn, U-turn (two consecutive turns), growth frame, 30-segment stress,
each colour (8) on a neutral floor, effects. Geometry assertions from AC2. Perf probe from AC3.
Acceptance criteria:
- [ ] AC1 Suite green; baselines committed with Fable's approval comment linked.
QA: —

## QA plan (sprint pass)
1. Design fidelity (Fable): side-by-side of preview screenshots with `07-snake-character-sheet.png` (head, body
   segment, full snake) and `09-snake-turning-animation.png` (frames 1–6). Verdict per item.
2. Human: V1 "find your head", V3 "long snakes readable" from `PLAYTEST-SCRIPT §3`.
3. Adversary: 60-segment snake in practice via tuning overlay; watch for gaps, z-fighting, shadow acne.

## References
- GDD §4 "Snakes", §5 "Snake appearance", "Snake movement"
- `DESIGN-DECISIONS §2.7, §3 "Materials bible"`, `ARCHITECTURE §7`
- Images `07-snake-character-sheet.png`, `09-snake-turning-animation.png`, `01-master-visual.png`

## Risks
- Corner bending that looks good can break the "≥ 0.85 gap" invariant on U-turns; AC2 is measured, not eyeballed.

## Exit criteria
- [ ] Fable's fidelity verdict is "matches the sheet" for head, body and turn.
- [ ] Perf budget held. Tag `sprint-08-done`.
