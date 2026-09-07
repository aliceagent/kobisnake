# Sprint 07 — Playtest Gate 1 & Tuning

**Lead:** Fable · **Agents:** Fable ×1, Opus ×1, Sonnet ×2, Sonnet-QA ×1, **humans ×2+** · **Prerequisite:** `sprint-06-done`

## Goal
Answer the GDD's first real milestone question with evidence: "Is it fun for two people to try to make each
other crash, and do the closing lasers create a climax?" Tune the numbers, fix every fairness bug, and lock the
design before art investment (GDD principle 8: build in layers).

## In scope
A tuning build with runtime overrides, the human playtest sessions, bot statistics comparison, tuning
decisions, bug bash, replay collection, an updated `DESIGN-DECISIONS.md`.

## Out of scope
New features. Art. Anything not required to answer the gate question.

## Tickets

### KS-07-00 · Owner playtest blockers from the grey-box build
Owner: Opus · Size: M · Depends on: —
Files: `src/core/settings.js`, `src/core/food.js`, `src/core/round.js`, `src/game/input.js`, `src/game/session.js`, `src/ui/screens/pause.js`, `tests/unit/core/food.test.js`, `tests/unit/core/__golden__/*`, `tests/unit/game/input.test.js`, `tests/e2e/pause.spec.js`
Spec: Implement issues **#102** (apples never in a line: `foodNoSharedRowOrColumn`, `foodMinDistanceFromFood` 3, fallback
ladder per `DESIGN-DECISIONS §2.3`; the opening board obeys it; regenerate the no-input golden log and say so — its
timing, tick 380 DRAW, must not move) and **#103** (Space pauses and resumes exactly like Esc per `§2.8`, no other
meaning). One PR each, `needs-design-review`. These come before every other ticket in this sprint.
Acceptance criteria:
- [ ] AC1 Opening board and 10 000 seeded respawns: no two apples share a row or column and all pairs are ≥ 3 apart whenever a legal cell exists; the ladder relaxes in the stated order; the #39 6×6 case never throws.
- [ ] AC2 A failed placement draws no random number (rng stream unchanged when the ladder is not entered).
- [ ] AC3 Space during PLAYING → PAUSE; Space on PAUSE → READY? → previous state; Space on menus does nothing; held Space does not repeat-toggle.
QA: unit + e2e; visual baselines that show the opening board are regenerated under `needs-design-review`.

### KS-07-01 · Tuning build
Owner: Sonnet · Size: M · Depends on: —
Files: `src/game/tuning.js`, `src/game/session.js`, `src/ui/screens/tuning.js`
Spec: `?tuning=1` shows a small overlay (DEV/`?test=1`-style gating; excluded from production unless the flag
is present) with sliders/steppers for: `snakeSpeed`, `laserStartTime`, `laserStepInterval`, `laserMinArena`,
`powerUpInterval`, `speedBoost.multiplier/duration`, `slow.multiplier/duration`, `inputBufferSize`, `foodCount`,
`growthPerFood`, plus SLOW target mode (`opponent` | `collector` | `everyone-but-collector`) as an experimental
switch so the GDD's three options can be felt. Values apply at the next round and are stamped into the
`__kobi` replay recorder. A "copy replay" button copies the current round's replay JSON.
Acceptance criteria:
- [ ] AC1 Every listed tunable can be changed without reloading; the next round uses it.
- [ ] AC2 Recorded replays include the overrides and replay identically in `tests/sim`.
- [ ] AC3 Overlay is absent from a normal production load.
QA: e2e.

### KS-07-02 · Human playtest sessions (×3)
Owner: Fable (facilitator), humans · Size: L · Depends on: KS-07-01
Files: `docs/qa/playtests/2026-xx-xx-gate1-session-N.md`
Spec: Three sessions of ≥ 30 minutes with two humans on one keyboard, using `PLAYTEST-SCRIPT.md` sections 2–8.
Session 1 default values. Session 2 the tuning variants Fable prepares from session 1 (at least: laser start
25/30/35 s, step interval 2/2.5/3 s, SLOW target modes). Add **Speed Boost 1.5×/5 s vs 1.35×/4 s** to the variants.

**Sharpest question from the bots (Sprint 06):** a non-adapting bot that collects Speed Boost wins under a
quarter of its rounds and is about eight times more likely to die in the second after the boost starts. Humans
may adapt where the bot cannot; P4 ("5 s feels good; no uncontrollable deaths attributed to boost") decides it.
Also watch P5 readability: SLOW acts only on the opponent, so the collector may not notice they collected
anything until the tag appears over the other snake (confirmation cue designed in `DESIGN-DECISIONS §3`). Session 3 the proposed final values. Every "no"/"unfair"
becomes a replay file and an issue.
Acceptance criteria:
- [ ] AC1 Three filled-in scripts committed under `docs/qa/playtests/`.
- [ ] AC2 Every FAIL has an issue number.
QA: —

### KS-07-03 · Bot statistics comparison
Owner: Sonnet-QA · Size: S · Depends on: —
Files: `tests/sim/tuningMatrix.test.js`, `docs/qa/playtests/gate1-bot-matrix.md`
Spec: Run the bot pairings across the same tuning variants as session 2 (500 rounds each) and produce the
matrix: % death-before-laser, % death-during-laser, % timeout, draw %, mean survivor length. Mark which cells
meet `PLAYTEST-SCRIPT §5` targets.
Acceptance criteria:
- [ ] AC1 Matrix committed and linked from the tracking issue.
QA: —

### KS-07-04 · Tuning decision and design update
Owner: Fable · Size: S · Depends on: KS-07-02, KS-07-03
Files: `docs/design/DESIGN-DECISIONS.md`, `src/core/settings.js`
Spec: Fable writes the decision memo in the tracking issue (what changed, what evidence, what stays), updates
`DESIGN-DECISIONS.md` rows and `§4`, and the SETTINGS defaults change in one PR labelled `tuning-proposal`
with all golden logs regenerated by Sonnet-QA in the same PR. The SLOW target is finalised here.
Acceptance criteria:
- [ ] AC1 `DESIGN-DECISIONS.md` and `settings.js` agree on every value (a unit test reads both: `tests/unit/core/settingsDoc.test.js` parses the `§4` code block and compares).
- [ ] AC2 Golden logs and replays regenerated and green.
QA: —

### KS-07-05 · Bug bash and fairness fixes
Owner: Opus (+ Sonnet) · Size: M · Depends on: KS-07-02
Files: as needed under `src/core`, `src/game`, `src/render`; `tests/sim/replays/*`
Spec: Fix every `blocker` and `major` bug from the sessions. Each fix adds the reproducing replay to
`tests/sim/replays/` first (red), then the fix (green).
Acceptance criteria:
- [ ] AC1 Zero open `blocker`/`major` issues labelled `sprint:07`.
- [ ] AC2 Replay count increased by at least the number of fixed bugs.
QA: —

### KS-07-06 · Input-feel instrumentation
Owner: Sonnet · Size: S · Depends on: —
Files: `src/game/input.js`, `src/game/testHooks.js`, `tests/e2e/inputLatency.spec.js`
Spec: Measure keydown → queued → committed step → first rendered frame with the new direction, in ms and in sim
steps. Expose in `__kobi.getInputStats()`; log a histogram in the tuning overlay.
Acceptance criteria:
- [ ] AC1 Median keydown-to-render latency ≤ 1 frame + the remaining step time; documented number in the QA report.
QA: —

### KS-07-07 · SLOW pedestal mid ice-blue (#105)
Owner: Opus (or Sonnet) · Size: S · Depends on: KS-07-00
Files: `src/render/materials.js`, `tests/unit/render/materials.test.js` (or the existing materials/pickupView
test), `tests/visual/__baselines__/powerups-slow-pedestal.png`
Spec: Apply `DESIGN-DECISIONS §1 row 20` as ruled in the Sprint 06 review: the SLOW pedestal is mid ice-blue
`#4FA9DD` under the white snowflake, inside the existing pale-blue ring. Added after the sprint started because
Gate 1's P5 ("could you tell who got slowed?") must be played against the ruled palette, not the white-on-white
grey-box one. No `settings.js` change; hex lives only in `materials.js`.
Acceptance criteria:
- [ ] AC1 `materials.js` builds the SLOW pedestal at `#4FA9DD`; icon white, ring pale blue, unchanged.
- [ ] AC2 A unit test asserts snowflake-vs-pedestal luminance contrast ≥ bolt-vs-SPEED-pedestal contrast.
- [ ] AC3 `powerups-slow-pedestal.png` deleted and re-recorded; PR shows the before/after crop; `needs-design-review`.
QA: visual suite green; no other baseline changes (or each one explained in the PR).

## QA plan (sprint pass)
This sprint is the QA plan. The gate passes when the Movement, Collision, Arena Closing, Round Length, Growth
and Power-up sections of the playtest script all pass in session 3 and the bot matrix meets its targets with
the chosen values.

## References
- GDD §3 "Build in layers", §9 "Playtesting checklist", "Final guiding principle"
- `PLAYTEST-SCRIPT.md`, `QA-STRATEGY §4`

## Risks
- Humans unavailable: the gate cannot be replaced by bots. Fable schedules sessions at S06 kick-off.
- Temptation to add features ("what if there were walls…"): out of scope by definition; file under S20.

## Exit criteria
- [ ] Session 3 script all-pass; matrix targets met; decisions memo posted; docs and settings in sync.
- [ ] Fable writes the sentence "The grey-box game is fun; art may begin." in the tracking issue, or lists what must change first.
- [ ] Tag `sprint-07-done` and `gate1-passed`.
