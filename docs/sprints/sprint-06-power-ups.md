# Sprint 06 — Power-ups

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-05-done`

## Goal
GDD Phase 4: Power-ups ON/OFF, Speed Boost and Slow, 15-second spawn/despawn/replace cycle, random placement,
no new spawns from 0:30, effects that outlive the warning, a HUD tag showing the active effect and remaining
seconds. Grey-box visuals.

## In scope
`powerups.js`, effect timers on snakes, spawn rules, HUD tag, grey-box pedestal views, tests, bot awareness.

## Out of scope
Final power-up art and burst VFX (S10), pickup sounds (S12).

## Tickets

### KS-06-01 · Power-up spawn cycle and effects in the simulation
Owner: Sonnet · Size: M · Depends on: —
Files: `src/core/powerups.js`, `src/core/snake.js` (effects), `src/core/round.js`, `tests/unit/core/powerups.test.js`
Spec: Types `SPEED` and `SLOW` chosen 50/50 by the round RNG. Timeline per `DESIGN-DECISIONS §2.4`: first spawn
at `powerUpFirstSpawnAt`, then every `powerUpInterval` the uncollected one despawns (`POWERUP_DESPAWNED`) and a
new one spawns (`POWERUP_SPAWNED { type, cell }`) at a valid cell (`§2.3`). No spawns at or after
`laserStartTime`; an existing uncollected one is removed at the first `LASER_STEP` that covers it (emit
`POWERUP_REMOVED { cell }`; the sweep in `round.js` already filters `powerUps.pickups` but nothing exercises it,
so this ticket adds the event and the test), or stays until collected otherwise. Pickup: head enters the cell → `POWERUP_COLLECTED { playerId, type }` → effect.
Effects live on snakes: `effects: [{ type, remaining, multiplier }]`, `speedMultiplier` = product. SPEED: the
collector ×1.5 for 5 s. SLOW: every other snake ×0.6 for 4 s; if there is no other snake (practice/solo), the
laser step interval ×2 for 4 s instead. Re-collecting the same type refreshes the duration (no stacking).
Effects tick in sim time and continue through LASER_WARNING and CLOSING. `EFFECT_STARTED/ENDED { playerId,
type }`. `powerUpsEnabled: false` → nothing ever spawns.
Acceptance criteria:
- [ ] AC1 With power-ups ON, spawns at t=75, 60, 45 (remaining) and none at 30; with OFF, zero `POWERUP_*` events in 100 seeds.
- [ ] AC2 Uncollected power-up despawns exactly when the next spawns; collected one does not despawn.
- [ ] AC3 SPEED: collector step interval shrinks to 1/9 s for exactly 5.000 s of sim time; then back to 1/6 s.
- [ ] AC4 SLOW in a 2-player round: the opponent's speed is 3.6 cells/s for 4 s; collector unaffected.
- [ ] AC5 SLOW in solo: `laserStepInterval` doubles for 4 s (schedule shifts accordingly); snake speed unchanged.
- [ ] AC6 Collecting SPEED at 0:31 keeps it active until 0:26 even though the warning started at 0:30.
- [ ] AC7 Refresh, not stack: two SPEED pickups 2 s apart → multiplier 1.5 (not 2.25) ending 5 s after the second.
QA: unit AC1–AC7 + replay files for AC6 and AC7.

### KS-06-02 · Grey-box power-up views and HUD tag
Owner: Sonnet · Size: M · Depends on: KS-06-01
Files: `src/render/pickupView.js`, `src/ui/hud.js`, `src/ui/styles.css`
Spec: Pedestal placeholder: blue box (SPEED) or white box (SLOW) 0.8 units with a floating yellow bolt-shaped
plane or white snowflake-shaped plane (simple sprite textures drawn on a canvas at runtime, no image files) that
bobs and spins per `DESIGN-DECISIONS §3 "Power-up sheet"`. HUD tag per `13-gameplay-hud.png`: a small pill
"SPEED BOOST 5s" / "SLOWED 4s" anchored near the affected snake's head in screen space (project head world
position), counting down in whole seconds. Snake tint while affected: SPEED = emissive yellow pulse, SLOW victim
= pale-blue tint (grey-box versions).
Acceptance criteria:
- [ ] AC1 Tag follows the head each frame within 2 px of the projected position + offset.
- [ ] AC2 Tag reads the remaining seconds correctly (ceil) and disappears at 0.
- [ ] AC3 Two tags can show at once (both players affected) without overlapping the timer panel region.
QA: e2e `tests/e2e/powerups.spec.js` with fast-forward to the first spawn and scripted pickup.

### KS-06-03 · Match-setup toggle and practice wiring
Owner: Sonnet · Size: S · Depends on: KS-06-01
Files: `src/game/session.js`, `src/ui/screens/matchSetup.js`
Spec: The POWER-UPS row now controls `powerUpsEnabled`; default ON. Value persists for the session (save data
in S13).
Acceptance criteria:
- [ ] AC1 OFF → a full round produces no power-up events (checked via `__kobi`).
QA: e2e.

### KS-06-04 · Bots and statistics with power-ups
Owner: Sonnet-QA · Size: S · Depends on: KS-06-01
Files: `tests/sim/bots/greedyBot.js`, `tests/sim/powerupStats.test.js`
Spec: greedyBot prefers a power-up over an apple if closer. Statistics: pickup rate, % rounds where a boosted
snake dies within 1 s of boost start (a "boost killed me" proxy, target ≤ 15 %), effect of SLOW on win rate.
Acceptance criteria:
- [ ] AC1 Table printed to the QA report.
QA: —

### KS-06-05 · Adversarial review
Owner: Opus · Size: S · Depends on: KS-06-01
Files: `tests/sim/powerupFuzz.test.js`
Spec: Invariants across 2 000 seeds: at most one power-up on the board; never on an apple or a snake cell;
`speedMultiplier` ∈ {0.6, 1, 1.5, 0.9}; no `POWERUP_SPAWNED` after `LASER_WARNING`; effect timers reach exactly 0.
Acceptance criteria:
- [ ] AC1 All invariants hold.
QA: —

## QA plan (sprint pass)
1. Human: 5 rounds with ON, answer P1–P5 in `PLAYTEST-SCRIPT §8`. Record the P5 answer on SLOW targeting for the Sprint 07 decision.
2. Adversary: collect a power-up on the same step you die; collect during slow-mo; toggle OFF mid-match via rematch.

## References
- GDD §4 "Power-ups", "Speed boost", "Power-up spawning", "Slow power-up", §5 "Power-up modes" … "Power-up visual language"
- `DESIGN-DECISIONS §1 rows 3, 4, 20, 21; §2.4`
- Images `13-gameplay-hud.png` (tag), `02-standard-gameplay-camera.png` (pedestal placement)

## Risks
- The solo-SLOW rule is unusual; keep it isolated in `powerups.js` with a comment so S19 can revisit.

## Exit criteria
- [ ] All ACs green; fuzz green; statistics recorded.
- [ ] Human P1–P4 pass; P5 answer recorded.
- [ ] Tag `sprint-06-done`.
