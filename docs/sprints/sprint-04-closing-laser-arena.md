# Sprint 04 — Closing Laser Arena

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-03-done`

## Goal
**Milestone 2 from the GDD:** at 0:30 four deadly laser walls light up, a five-second warning plays, and the
walls step inward every 2.5 s until a 6×6 square remains. Deaths on lasers are correct and fair; the climax is
visible in grey-box form.

## In scope
Laser schedule and dead zone in the simulation, laser death cause, dead-zone item removal, grey-box beam and
dead-zone rendering, warning overlay text in the placeholder HUD, camera zoom pulse on warning, tests and bot
statistics for the closing phase.

## Out of scope
Final laser art, sparks, floor glow (S10), warning music (S12), HUD styling (S11).

## Tickets

### KS-04-01 · Laser schedule in the simulation
Owner: Opus · Size: M · Depends on: —
Files: `src/core/lasers.js`, `src/core/round.js`, `tests/unit/core/lasers.test.js`
Spec: `createLasers(settings)` → `{ phase: 'PARKED'|'WARNING'|'CLOSING'|'STOPPED', inset, update(timeRemaining)
→ events[] , isDeadly(cell), inDeadZone(cell) }`. Timeline per `DESIGN-DECISIONS §2.4`: at `timeRemaining ≤
laserStartTime` emit `LASER_WARNING` once and phase → WARNING (beams deadly at inset 0 = the wall line, which is
already deadly, so nothing changes for the player yet). At `laserStartTime − laserWarningDuration` and then
every `laserStepInterval`: `inset += 1`, emit `LASER_STEP { inset }`, phase CLOSING. Stop when
`grid.width − 2·inset ≤ laserMinArena` (phase STOPPED). `isDeadly(cell)` is true for any cell outside the safe
square `[inset, width−inset)`; the wall (inset −1) remains deadly. `round.js` replaces its stub, passes
`lasers.isDeadly` into `resolveStep`, maps the cause to `LASER` when `inset > 0` and the cell is inside the
grid, `WALL` otherwise, and after each `LASER_STEP` kills any snake whose **head** is now in the dead zone
(`SNAKE_DIED cause: LASER`).
Acceptance criteria:
- [ ] AC1 Events at exactly t=30.000 (`LASER_WARNING`), 25.0, 22.5, 20.0 … (`LASER_STEP` 1..9); the 9th step at 5.0 s leaves a 6×6 square; no 10th step.
- [ ] AC2 Head at (0, 12) when inset becomes 1 → dies with `LASER`; body segments in the dead zone do not kill.
- [ ] AC3 Head moving into cell x = inset−1 dies with `LASER`; into x = −1 dies with `WALL` (only possible at inset 0).
- [ ] AC4 Apples and power-ups inside the dead zone are removed on the step and apples respawn inside the safe square (`FOOD_REMOVED`, `FOOD_SPAWNED`), using the `DESIGN-DECISIONS §2.3` fallback (distance 2 → 1 → 0, then an empty slot retried each tick); a 6×6 square with two length-15 snakes never throws (closes #39).
- [ ] AC5 After STOPPED, `advance()` to 0:00 with both alive applies the timeout rule.
QA: unit tests AC1–AC5 plus a golden event log for a no-input round with immortal snakes (test-only flag `godMode` in settings overrides, allowed only under `import.meta.env.TEST`).

### KS-04-02 · Grey-box laser and dead-zone rendering
Owner: Sonnet · Size: M · Depends on: KS-04-01
Files: `src/render/laserView.js`, `src/render/arenaView.js`
Spec: Four thin emissive red boxes (0.15 wide, 0.4 tall) along the current safe-square edges, hidden while
PARKED, visible from WARNING. On `LASER_STEP` the beams glide from the old inset to the new one over 0.3 s
(ease-out). Floor tiles in the dead zone darken (material colour × 0.35) as the beam passes. Emitters are
placeholder grey cubes at the four corners and wall centres that move with the beams. Direction arrows
(`05-laser-closing-phase.png`) are a flat red triangle sprite per side pointing inward, shown during WARNING only.
Acceptance criteria:
- [ ] AC1 Visual baseline screenshots at t=30, 24, 10 and 3 match the safe square from the sim (assert dead-zone tile count equals `width² − safe²`).
- [ ] AC2 Beam glide never lags the sim by more than one frame after the 0.3 s ease (the deadly cell and the visible beam agree by t+0.3 s).
- [ ] AC3 Zero extra draw calls beyond +6 during the laser phase.
QA: visual spec + e2e assert via `__kobi`.

### KS-04-03 · Warning presentation (placeholder)
Owner: Sonnet · Size: S · Depends on: KS-04-01
Files: `src/ui/hud.js`, `src/ui/styles.css`, `src/render/camera.js`
Spec: On `LASER_WARNING`: HUD shows a "LASERS CLOSING!" banner for 5 s (plain styled div; real design in S11),
timer text turns red for the rest of the round, camera `zoomPulse(2 %, 0.4 s)` twice. Respect `?reducedFx=1`.
Acceptance criteria:
- [ ] AC1 Banner appears within one frame of the event and disappears at 5 s ± 1 frame.
- [ ] AC2 Timer stays red until ROUND_OVER.
QA: e2e.

### KS-04-04 · Closing-phase statistics and fairness tests
Owner: Sonnet-QA · Size: M · Depends on: KS-04-01
Files: `tests/sim/laserStats.test.js`, `tests/sim/bots/survivorBot.js` (laser-aware), `tests/sim/replays/laser-*.json`
Spec: Make `survivorBot` treat dead-zone and next-step cells as deadly. Run 500 seeded rounds for each bot
pairing and report: % ending before 0:30, 0:30–0:00, timeout; draw rate; deaths by cause. Add replays for: head
one cell inside the safe square survives a step; head on the boundary dies; both heads killed by the same step
→ DRAW.
Acceptance criteria:
- [ ] AC1 greedy vs survivor: ≥ 85 % of rounds end by death (target from `PLAYTEST-SCRIPT §5`); print the table.
- [ ] AC2 Zero deaths with cause LASER occur while `inset === 0` (that would be a WALL mislabel).
- [ ] AC3 Three replays committed and green.
QA: —

### KS-04-05 · Fuzz: laser step vs snake step ordering
Owner: Opus (adversary) · Size: S · Depends on: KS-04-01
Files: `tests/sim/laserFuzz.test.js`
Spec: For 2 000 seeds with random inputs, assert invariants after every sim tick: no living head in the dead
zone; no apple in the dead zone; `inset` monotonic; number of `LASER_STEP` events ≤ 9; if a snake died with
LASER its head cell is in the dead zone in the same tick.
Acceptance criteria:
- [ ] AC1 Invariants hold for all seeds; any failure is minimised into a replay and fixed in this sprint.
QA: —

## QA plan (sprint pass)
1. Human plays 5 rounds; answers A1, A3, A4 from `PLAYTEST-SCRIPT §5` (warning obviousness will be re-asked
   after S10/S12 art and audio).
2. Adversary attempts: turn into a beam on the exact frame it steps; sit on the boundary cell; be 15 segments
   long inside the final 6×6.
3. Design fidelity: safe-square shrink versus `05-laser-closing-phase.png` and `06-final-shrink-showdown.png`
   (geometry only at this stage).

## References
- GDD §5 "Main gameplay hook", "Laser system", "Laser warning sequence", "Round structure"
- `DESIGN-DECISIONS §1 rows 5, 6, 9, 23; §2.4`
- Images `05-laser-closing-phase.png`, `06-final-shrink-showdown.png`, `04-clean-arena-design.png` (emitter positions)

## Risks
- Off-by-one on the boundary cell is the classic bug; AC2/AC3 of KS-04-01 pin it.
- The 6×6 minimum with two long snakes could feel unfair; the bot draw rate and human A4 answer decide whether
  Fable changes `laserMinArena` in S07.

## Exit criteria
- [ ] All tickets merged; fuzz green; statistics table in the tracking issue.
- [ ] Human answers A3 and A4 positive.
- [ ] Tag `sprint-04-done` and `m2-laser-arena`.
