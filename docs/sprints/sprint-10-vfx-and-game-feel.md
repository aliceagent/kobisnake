# Sprint 10 — VFX & Game Feel

**Lead:** Sonnet (Opus on the particle system) · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-09-done`

## Goal
Everything in GDD "Game feel" and the laser visual design: emissive beams with floor glow, emitters that light
up and push inward, sparks, warning lighting shift, dead-zone darkening; food pop; power-up pedestals and
bursts; crash debris with slow-mo and screen shake; laser death variant; round-win and match-win celebrations.
All effects respect readability and `?reducedFx=1`.

## In scope
Particle system, crash debris, laser visuals, pickup visuals and bursts, warning lighting, celebrations.

## Out of scope
Sounds (S12), HUD banner styling (S11), key award animation (S13).

## Tickets

### KS-10-01 · Particle system
Owner: Opus · Size: M · Depends on: —
Files: `src/render/effects/particles.js`, `tests/unit/render/particles.test.js`
Spec: One `InstancedMesh` pool (capacity 512) of tiny bricks (0.12 units) with per-instance colour, velocity,
angular velocity, gravity, lifetime, fade. `emit({ position, count, color, speed, spread, gravity, life })`.
Fixed-step update on the render clock. Disabled (no emit) under `?reducedFx=1`. Deterministic with a seeded RNG
for visual tests.
Acceptance criteria:
- [ ] AC1 Emitting beyond capacity recycles the oldest; never throws.
- [ ] AC2 512 live particles cost ≤ 1 draw call and ≤ 1 ms update on the reference laptop.
QA: unit + perf.

### KS-10-02 · Laser visuals: beams, glow, emitters, sparks, dead zone
Owner: Sonnet · Size: L · Depends on: KS-10-01
Files: `src/render/laserView.js`, `src/render/materials.js`, `src/render/arenaView.js`
Spec: Beams: emissive red core cylinder (radius 0.08) plus an additive-blended outer quad (0.5 wide, alpha
0.35) and an additive floor-glow strip (1.2 wide) per side, matching `05-laser-closing-phase.png`. Emitters: lens
emissive intensity ramps 0 → 4 over 0.5 s at WARNING; corner towers stay; mid-wall emitters glide with the
beams (they are the "movers"); beam ends emit 3 sparks/s (particles) during CLOSING. Dead-zone tiles darken to
35 % and desaturate over 0.3 s as the beam passes (per-instance colour update). Warning: hemisphere sky colour
shifts to `#FFB4A0` and key light to 80 % intensity for the warning duration, then eases back over 2 s (the
scene stays readable; compare `05` vs `06`). Beam glide 0.3 s ease-out as in S04. The final 6×6 state must
match `06-final-shrink-showdown.png`.
Acceptance criteria:
- [ ] AC1 Visual baselines at t=30.5, 24, 10, 3 approved by Fable against images 05 and 06.
- [ ] AC2 Additive glow never exceeds 60 % luminance over the safe floor (sample the centre tile pixel) so snakes stay readable.
- [ ] AC3 Laser phase adds ≤ 12 draw calls.
QA: visual + pixel sample e2e.

### KS-10-03 · Food pop and power-up presentation
Owner: Sonnet · Size: M · Depends on: KS-10-01
Files: `src/render/pickupView.js`, `src/render/snakeView.js`
Spec: Per `DESIGN-DECISIONS §3 "Food & growth"` and `"Power-up sheet"`: apple pop scale + 10 red/green
particles + head→tail brightness pulse + tail segment overshoot. Power-up pedestals: SPEED two-tier blue brick
pedestal with a floating yellow bolt inside a cyan ring (ring = emissive torus), SLOW ice-white pedestal with a
white snowflake inside a pale-blue ring; bob and spin; spawn = ring scales 0 → 1 with 8 particles; despawn =
fade over 0.3 s; collect = ring expands to 2× and fades with 16 particles in the power-up colour.
Acceptance criteria:
- [ ] AC1 Both pedestals match the bolt pedestal in `02-standard-gameplay-camera.png` for construction and scale (Fable).
- [ ] AC2 Pop and burst never exceed 0.4 s total so repeated pickups do not clutter (timed via e2e).
QA: visual + e2e.

### KS-10-04 · Crash debris, slow-mo, shake, laser death
Owner: Opus · Size: L · Depends on: KS-10-01
Files: `src/render/effects/crashDebris.js`, `src/render/effects/screenShake.js`, `src/render/snakeView.js`, `src/render/camera.js`
Spec: On `SNAKE_DIED`: hide the snake, spawn one rigid brick per segment at the segment's position with
outward velocity (from the head), spin, gravity, bounce once on the floor (simple), fade after 0.8 s. Screen
shake 0.3 s amplitude 0.15 (camera). Slow-mo is already handled by the loop; effects run on the render clock so
debris flies in real time while the sim is slowed. Laser death variant: head flashes white 3 frames, 24 red
sparks at the contact point, first three segments dissolve with emissive glow instead of tumbling.
Head-on/double death: both effects at once, shake amplitude 0.2. Family-friendly, per image 12 prompt.
Acceptance criteria:
- [ ] AC1 Debris count equals segment count; all debris gone by 1.0 s.
- [ ] AC2 Shake and slow-mo are disabled under `?reducedFx=1` (positions stable in visual test).
- [ ] AC3 Fable approves both death variants against the GDD image-12 prompt.
QA: e2e + visual.

### KS-10-05 · Round-win and match-win celebration
Owner: Sonnet · Size: S · Depends on: KS-10-01
Files: `src/render/snakeView.js`, `src/render/effects/celebration.js`
Spec: Round win: the surviving snake's head bobs (3 hops over 0.9 s) with 20 particles in its colour; runs
under the scoreboard. Match win: same plus a 2 s stream of confetti bricks in all catalogue colours from above
the arena centre; the winner snake is re-posed coiled at the centre.
Acceptance criteria:
- [ ] AC1 Effects trigger from `ROUND_OVER`/`MATCH_OVER` state entries and stop on exit.
QA: e2e.

### KS-10-06 · VFX visual and perf suite
Owner: Sonnet-QA · Size: M · Depends on: KS-10-02, KS-10-04
Files: `tests/visual/vfx.visual.spec.js`, `tests/perf/vfx.perf.spec.js`, `tests/e2e/reducedFx.spec.js`
Acceptance criteria:
- [ ] AC1 Baselines approved; "maximum chaos" perf scene (two 30-segment snakes, laser phase, crash) p95 ≤ 16.6 ms.
- [ ] AC2 `?reducedFx=1` produces pixel-identical frames across three runs.
QA: —

## QA plan (sprint pass)
1. Fable: fidelity review against images 05, 06 and the image-10/11/12 prompts.
2. Human: A1 warning obviousness, C1 "was that fair" with effects on; feel checklist items for pop/burst/crash.
3. Adversary: die on the same frame the laser steps; two crashes in one step; 30 apples eaten in 5 s via tuning overlay.

## References
- GDD §5 "Laser system", "Laser warning sequence", "Game feel", §12 prompts 5, 6, 10, 11, 12
- `DESIGN-DECISIONS §3`; images `05-laser-closing-phase.png`, `06-final-shrink-showdown.png`, `01-master-visual.png`

## Exit criteria
- [ ] Fidelity verdict positive; perf held; reducedFx deterministic; tag `sprint-10-done`.
