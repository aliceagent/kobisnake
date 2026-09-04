# Sprint 01 — Core Simulation (headless)

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-00-done`

## Goal
The whole grey-box game of GDD Phase 1 (arena, two snakes, movement, input queues, food, growth, collision,
round timer, round victory) exists as pure JavaScript in `src/core/` with no DOM and no three.js, is
deterministic, and is proven by unit and simulation tests to ≥ 90 % coverage.

## In scope
`settings.js`, `rng.js`, `grid.js`, `snake.js`, `food.js`, `collisions.js`, `round.js`, `events.js`, the
simulation test harness, bots, and replay format. Lasers, power-ups and match logic get placeholders only.

## Out of scope
Rendering, input devices, UI, lasers (S03), power-ups (S05), match logic (S04).

## Tickets

### KS-01-01 · Settings, RNG and grid primitives
Owner: Sonnet · Size: S · Depends on: —
Files: `src/core/settings.js`, `src/core/rng.js`, `src/core/grid.js`, `tests/unit/core/rng.test.js`, `tests/unit/core/grid.test.js`
Spec: `SETTINGS` exactly as `DESIGN-DECISIONS §4` with a JSDoc typedef; `deepFreeze` it; export
`withOverrides(partial)` for tests. `rng.js`: mulberry32 `createRng(seed)` → `{ next(), int(maxExclusive),
pick(array), seed }`. `grid.js`: `DIRECTIONS` (UP/DOWN/LEFT/RIGHT as `{dx, dy}`), `isOpposite(a, b)`, `addDir(cell,
dir)`, `inBounds(cell, grid)`, `cellKey(cell)`, `chebyshev(a, b)`.
Acceptance criteria:
- [ ] AC1 Same seed → same first 1000 numbers; different seeds differ.
- [ ] AC2 `int(n)` is uniform enough: 100 000 draws of `int(4)` each bucket within ±2 % of 25 %.
- [ ] AC3 `isOpposite` true only for UP/DOWN and LEFT/RIGHT pairs.
- [ ] AC4 `SETTINGS` is frozen; mutation throws in strict mode.
QA: the listed unit tests.

### KS-01-02 · Snake with direction queue and speed modifiers
Owner: Opus · Size: M · Depends on: KS-01-01
Files: `src/core/snake.js`, `tests/unit/core/snake.test.js`
Spec: `class Snake { constructor({ id, cells, direction, settings }) }` with `segments` (head first),
`direction`, `queue` (max `inputBufferSize`), `pendingGrowth`, `speedMultiplier`, `alive`, `stepProgress`,
`previousSegments`. `queueDirection(dir)` applies the rules in `DESIGN-DECISIONS §2.2` (ignore reverse of last
committed or last queued, ignore duplicate of current/last queued, drop when full). `nextHeadCell()` returns the
cell the head will occupy on the next step using the queued direction if any. `commitStep()` moves the snake
(consumes queue head, shifts segments, honours `pendingGrowth`, stores `previousSegments`). `accumulate(dt)`
advances `stepProgress` by `dt * snakeSpeed * speedMultiplier`; returns true when a step is due (and subtracts 1).
Acceptance criteria:
- [ ] AC1 Reversal input is ignored; duplicate input is ignored; third input when two are queued is dropped.
- [ ] AC2 Up-then-Left within one step yields two turns on two consecutive steps.
- [ ] AC3 Growth: after `grow(1)`, the next step adds a segment; length increases by exactly 1.
- [ ] AC4 At speed 6 and dt 1/120, a step is due every 20 accumulations; at multiplier 1.5, every ~13.3 (fractional carry preserved: 3 steps in 40 accumulations).
- [ ] AC5 `previousSegments` always has the same length as `segments` after a step (grown segment duplicates the tail).
QA: the listed unit tests, named after AC1–AC5.

### KS-01-03 · Food placement
Owner: Sonnet · Size: S · Depends on: KS-01-01
Files: `src/core/food.js`, `tests/unit/core/food.test.js`
Spec: `placeFood({ grid, occupied: Set<cellKey>, heads: cell[], deadZone: (cell)=>bool, rng, minDistance })`
returns a random free cell not in the dead zone and ≥ `minDistance` Chebyshev from every head; throws
`NoFreeCellError` if none. `FoodState` keeps `foodCount` apples, `respawn(index)`.
Acceptance criteria:
- [ ] AC1 Never returns an occupied cell in 10 000 seeded trials on a 6×6 grid with 20 occupied cells.
- [ ] AC2 Respects `minDistance` from every head.
- [ ] AC3 Throws when the grid is full.
- [ ] AC4 Deterministic for a given seed and occupancy.
QA: listed unit tests.

### KS-01-04 · Collision resolution
Owner: Opus · Size: M · Depends on: KS-01-02
Files: `src/core/collisions.js`, `tests/unit/core/collisions.test.js`
Spec: `resolveStep({ steppingSnakes, allSnakes, isDeadly(cell) })`: compute every stepping snake's
`nextHeadCell` first, then evaluate in the order of `DESIGN-DECISIONS §2.5`: wall/laser (`isDeadly`), self (new
head equals any of its own segments except the tail cell that is about to vacate, unless growing), other snake
body, other snake head (same next cell, or swap: A moves into B's current head while B moves into A's current
head). Returns `{ deaths: [{snakeId, cause}] }`. `cause ∈ WALL | LASER | SELF | BODY | HEAD_ON`.
Acceptance criteria:
- [ ] AC1 Moving into the tail cell of a non-growing snake is safe; into the tail of a growing snake is death.
- [ ] AC2 Two heads entering the same cell → both die with `HEAD_ON`.
- [ ] AC3 Swap case → both die with `HEAD_ON`.
- [ ] AC4 Only one snake stepping this tick into the other's stationary head → only the mover dies (`BODY`).
- [ ] AC5 Evaluation order: a cell that is both out of bounds and a body reports `WALL`.
QA: listed unit tests.

### KS-01-05 · RoundSimulation and event stream
Owner: Opus · Size: L · Depends on: KS-01-02, KS-01-03, KS-01-04
Files: `src/core/round.js`, `src/core/events.js`, `tests/unit/core/round.test.js`
Spec: `new RoundSimulation({ settings, seed, players: [{id, color}], powerUpsEnabled, mode: 'match'|'practice' })`.
`advance(dtSeconds)` accumulates and steps at `1/simHz`; per sim tick: decrement `timeRemaining`; for each alive
snake `accumulate`; collect due snakes; `resolveStep`; apply deaths; commit steps for survivors; eat apples
(`FOOD_EATEN` → `grow`, respawn); check timeout (`DESIGN-DECISIONS §2.4` 0:00 rule). Emits events per
`ARCHITECTURE §4`. `getState()` returns a plain snapshot (segments, previousSegments, stepProgress per snake,
apples, timeRemaining, phase, result). `applyInput(playerId, dir)` → `queueDirection`. Spawn positions from
`DESIGN-DECISIONS §2.3`. Hooks for lasers and power-ups exist as no-op modules (`lasers.js` and `powerups.js`
stubs exporting `createInactive()`), to be filled in S03/S05. Practice mode: no timer, single snake optional.
Acceptance criteria:
- [ ] AC1 A round with no inputs is deterministic: P1 (start (5,12) heading right) reaches x=23 on its 18th step and dies on its 19th step into the wall at x=24; P2 (start (18,11) heading left) mirrors it into x=−1. Both die on the same step at t = 19/6 ≈ 3.167 s ⇒ `DRAW`. Record the exact expected event log as a golden file.
- [ ] AC2 Same seed + same input log ⇒ identical event log and identical `getState()` snapshots at every 0.5 s (100 seeds).
- [ ] AC3 `advance(90)` in one call and 10 800 calls of `advance(1/120)` yield identical logs.
- [ ] AC4 Timeout with both alive: longer wins; equal → `DRAW`.
- [ ] AC5 Exactly `foodCount` apples exist at all times during PLAYING.
- [ ] AC6 `getState()` is JSON-serialisable and contains no functions or class instances.
QA: listed unit tests + `tests/sim/determinism.test.js`.

### KS-01-06 · Simulation harness, bots and replays
Owner: Sonnet-QA · Size: M · Depends on: KS-01-05
Files: `tests/sim/harness.js`, `tests/sim/bots/randomBot.js`, `tests/sim/bots/greedyBot.js`, `tests/sim/bots/survivorBot.js`, `tests/sim/replays/README.md`, `tests/sim/replays/replay.schema.json`, `tests/sim/stats.test.js`, `tests/sim/replay.test.js`
Spec: `runRound({ seed, bots, settings, inputLog? })` returns `{ events, result, lengths, endedAt, cause }`.
Bots per `QA-STRATEGY §4`. Replay JSON `{ seed, settingsOverrides, inputs:[{t, player, dir}], expectedEvents }`;
`replay.test.js` loads every file in `replays/` and asserts. `stats.test.js` runs 200 seeded rounds per pairing
and prints the statistics table; it asserts only sanity (no exceptions, every round ends).
Acceptance criteria:
- [ ] AC1 `greedyBot` vs `survivorBot` 200 rounds complete in < 10 s.
- [ ] AC2 Statistics table printed with the columns from `QA-STRATEGY §4`.
- [ ] AC3 At least one replay file exists (no-input round) and passes.
QA: this is QA infrastructure.

### KS-01-07 · Coverage gate on
Owner: Sonnet-QA · Size: S · Depends on: KS-01-05
Files: `vitest.config.js`, `.github/workflows/ci.yml`
Spec: Turn on `COVERAGE_STRICT` so CI fails below 90 % lines/branches on `src/core/`.
Acceptance criteria:
- [ ] AC1 CI fails when a core function is left untested (demonstrated once in a draft PR).
QA: —

## QA plan (sprint pass)
1. Adversary (Opus): fuzz `RoundSimulation` with random input logs for 2 000 seeds; any exception or any
   snapshot with overlapping segments of a living snake is a blocker.
2. Property: number of segments never decreases while alive except… never (only growth). Assert.
3. Print the bot statistics table into the QA report for the Sprint 06 baseline.

## References
- GDD §5 "Snake movement", "Player controls", "Collision rules", "Round structure", "Round victory"
- `DESIGN-DECISIONS §2.1–2.5`, `ARCHITECTURE §4`
- `docs/reference/images/09-snake-turning-animation.png` (the "grid path" diagram: each segment follows the exact path of the one in front)

## Risks
- Simultaneous stepping with different speeds is the subtle part. Opus writes the tests for KS-01-04 AC2–AC4 before the code.

## Exit criteria
- [ ] All tickets merged, coverage on `src/core/` ≥ 90 %, determinism test green for 100 seeds.
- [ ] Golden event log for the no-input round committed and explained in a comment.
- [ ] Bot statistics baseline recorded in the tracking issue.
- [ ] Tag `sprint-01-done`.
