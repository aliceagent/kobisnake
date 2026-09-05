# Sprint 09 — Arena Art, Lighting & Camera Polish

**Lead:** Sonnet (Opus on instancing/perf) · **Agents:** Sonnet ×2, Opus ×0.5, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-08-done`

## Goal
The arena matches `04-clean-arena-design.png` and the framing of `02-standard-gameplay-camera.png`: green
studded floor tiles with subtle variety, yellow/blue/grey brick walls with hazard-striped centre sections, corner
and mid-wall laser emitter towers (inactive look), trees, lanterns and banners outside the walls, the locked
lighting, soft shadows, and a menu background scene reusing the same pieces. Apples become toy-brick apples.

## In scope
Floor, walls, emitters (static look; animation in S10), outside decoration, lighting rig, apple model,
menu-background scene, performance via instancing/merging.

## Out of scope
Laser beams/glow (S10), shop room (S14), HUD (S11).

## Tickets

### KS-09-01 · Floor and walls
Owner: Sonnet · Size: M · Depends on: —
Files: `src/render/arenaView.js`, `src/render/brickGeometry.js`
Spec: Floor: 24×24 `brick` tiles (1 × 0.2 × 1, 2×2 studs) with the two greens + 4 % grey per
`DESIGN-DECISIONS §3` chosen by a seeded RNG (fixed seed 7 so it never changes). Walls: one-cell ring of 1.2-tall
bricks in runs of yellow with blue inserts every 5–7 bricks and grey mortar bricks at corners, matching the
"wall section (center)" and "side view" panels of the arena sheet; hazard-striped grey centre block per side
(canvas-drawn stripe texture, no image file). All merged into ≤ 4 draw calls.
Acceptance criteria:
- [ ] AC1 Screenshot from the gameplay camera vs the arena sheet: Fable approves colours, proportions, stud size.
- [ ] AC2 Floor + walls ≤ 4 draw calls; ≤ 120 k triangles.
- [ ] AC3 Floor pattern identical across reloads (seeded).
QA: visual + `renderer.info` assertions.

### KS-09-02 · Laser emitter towers (static)
Owner: Sonnet · Size: M · Depends on: KS-09-01
Files: `src/render/arenaView.js`, `src/render/laserView.js`
Spec: Corner emitter per the "corner laser emitter (inactive)" panel: grey/black brick tower 1.8 tall with a
red lens (emissive off while PARKED), yellow trim, small side vents. Mid-wall emitters: lower (1.4), hazard
stripe base, red lens. Emitters are `Group`s that `laserView` will move during CLOSING (S10), so they sit in a
parent node per side.
Acceptance criteria:
- [ ] AC1 Eight emitters (4 corners + 4 mids) at the positions in `04-clean-arena-design.png` top-down panel.
- [ ] AC2 Lens material is emissive-capable but intensity 0 while PARKED.
QA: visual.

### KS-09-03 · Outside decoration
Owner: Sonnet · Size: M · Depends on: KS-09-01
Files: `src/render/decorView.js`, `src/render/brickGeometry.js`
Spec: A 6-cell apron of darker desaturated brick ground around the arena; block trees (green cube-cluster
canopy on a brown brick trunk, 3 sizes), lanterns (yellow emissive cube on a pole; emissive intensity 1.5, no
extra lights), crown banners (blue and red flags with a yellow crown drawn on a canvas texture) on poles at the
four mid-sides beyond the walls, per the "environment details" panel. Placement by seeded RNG (seed 7), kept out
of the camera's view of the playfield. Everything instanced (≤ 6 draw calls total).
Acceptance criteria:
- [ ] AC1 Nothing outside the arena occludes any floor cell from the gameplay camera (project every floor cell centre and ray-test).
- [ ] AC2 Decoration ≤ 6 draw calls.
- [ ] AC3 Fable approves the look against the arena sheet and `02-standard-gameplay-camera.png`.
QA: e2e occlusion test + visual.

### KS-09-04 · Lighting rig and shadow tuning
Owner: Opus · Size: S · Depends on: KS-09-01
Files: `src/render/renderer.js`, `src/render/lighting.js`
Spec: Exactly the rig in `DESIGN-DECISIONS §3 "Materials bible"`: warm key directional with shadow camera fitted
tightly to the arena (not the decoration), 2048 PCFSoft, bias tuned to remove acne on studs; hemisphere fill;
tone mapping ACES with exposure 1.0; `outputColorSpace` sRGB. Shadow casters: snakes, apples, power-ups, walls,
emitters. Receivers: floor, walls. Decoration neither casts nor receives.
Acceptance criteria:
- [ ] AC1 No visible shadow acne on the floor studs at 1080p (Fable review of a zoomed screenshot).
- [ ] AC2 Snake contact shadows are visible and soft (compare with the sheet).
- [ ] AC3 Frame time p95 ≤ 16.6 ms with the full arena and two 20-segment snakes on the reference laptop.
QA: visual + perf probe.

### KS-09-05 · Toy-brick apple
Owner: Sonnet · Size: S · Depends on: —
Files: `src/render/pickupView.js`, `src/render/brickGeometry.js`
Spec: Apple per `DESIGN-DECISIONS §1 row 1` and every reference image: red rounded 2×2 body (0.6 units), one
stud on top, a green leaf brick (0.3 × 0.1 × 0.15) angled 30°. Gentle idle bob (±0.04, 1.6 s) and 20°/s spin.
Instanced (one draw call for all apples).
Acceptance criteria:
- [ ] AC1 Matches the apple in `02-standard-gameplay-camera.png` (Fable).
- [ ] AC2 One draw call for `foodCount` apples.
QA: visual.

### KS-09-06 · Menu background scene
Owner: Sonnet · Size: M · Depends on: KS-09-03, KS-08-03
Files: `src/render/menuScene.js`
Spec: A wider, lower-angle (65°) shot of the same arena and decoration with the red snake coiled in the
foreground left and the blue snake mid-right, both idling (breathing scale ±2 %, blinking), evening warm light
as in `14-main-menu.png`. Slow 0.5°/s camera drift. Rendered only while in menu states.
Acceptance criteria:
- [ ] AC1 Fable approves composition against `14-main-menu.png` (composition only; the title/buttons are S11).
- [ ] AC2 Switching menu ↔ game swaps scenes with no flash of the wrong scene.
QA: visual.

### KS-09-07 · Arena visual and occlusion suite
Owner: Sonnet-QA · Size: S · Depends on: KS-09-03
Files: `tests/visual/arena.visual.spec.js`, `tests/e2e/occlusion.spec.js`, `tests/perf/arena.perf.spec.js`
Acceptance criteria:
- [ ] AC1 Baselines approved and committed; occlusion test green; perf probe records the numbers.
QA: —

## QA plan (sprint pass)
1. Fable: fidelity review of six crops (floor, wall centre, corner emitter, environment, materials, full frame)
   against `04-clean-arena-design.png` and `02-standard-gameplay-camera.png`.
2. Human: V1/V2 readability re-check with the real arena.
3. Adversary: 4:3 and ultrawide aspect; 4K with pixel ratio 2; low-end mode (`?lowfx=1` reduces shadow map to 1024 — implement if p95 fails).

## References
- GDD §5 "Core visual direction", "Perspective and camera", §12 image prompts 2, 4, 18
- Images `04-clean-arena-design.png`, `02-standard-gameplay-camera.png`, `03-camera-angle-comparison.png`, `14-main-menu.png`, `01-master-visual.png`

## Exit criteria
- [ ] Fidelity verdict positive on all six crops; perf budget held; tag `sprint-09-done`.
