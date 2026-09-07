# Improvement 03 — Agent playtest harness (`tests/agent`)

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1, Sonnet-QA ×1 · **Prerequisite:** none
**Origin:** `docs/qa/reports/2026-09-07-agent-qa-pass.md` §2 and finding **F5**

## Goal
Turn the throwaway harness that produced the 2026-09-07 QA report into a fourth, permanent test layer: bots
that **play the built game in a browser** and report what a player would notice. The committed suites prove
the simulation (`tests/sim`) and script individual behaviours (`tests/e2e`); nothing plays whole matches
through the whole stack, which is why F1 and F2 survived seven sprints and 643 green tests.

It also removes the project's single biggest dependency: today every gate waits on two humans being in a room.
Agents cannot say whether the game is *fun* and this sprint does not pretend otherwise — but everything else a
playtest reports, they can.

## In scope
`tests/agent/`: a driver, two or more play policies, per-frame invariants, match-level statistics, a written
report, and a CI job. The scratch versions in this pass are the specification, not the implementation.

## Out of scope
Judging fun (Gate 1, KS-07-02). Replacing `tests/e2e` or `tests/sim` — this layer adds, never substitutes.

## Tickets

### KI-03-01 · The driver
Owner: Opus · Size: M · Depends on: —
Files: `tests/agent/driver.js`, `tests/agent/README.md`, `package.json`
Spec: A harness that loads the built site with `?test=1&seed=N`, plays whole matches through `__kobi`
(`pressKey` for input, `advance` for time, a render every N frames because a software-WebGL render costs
~150 ms and rendering every frame makes a match take minutes instead of half a second), and returns a plain
result object per match: rounds, results, end reasons, ticks, lengths, draw calls, states visited. Add
`npm run test:agent`. It must never run concurrently with another Playwright suite (#86).
Acceptance criteria:
- [ ] AC1 Ten seeded Best-of-3 matches complete in under 60 s total on CI, and the results are deterministic for a given seed.
- [ ] AC2 The render cadence is a named constant with the measured cost in its comment; simulation, input and HUD paths still run every frame.
- [ ] AC3 `npm run test:agent` fails on a non-zero problem count, a page error, or a match that does not finish.
QA: the suite is its own QA; one run committed as the baseline report.

### KI-03-02 · Play policies
Owner: Sonnet · Size: M · Depends on: KI-03-01
Files: `tests/agent/policies/greedy.js`, `tests/agent/policies/survivor.js`, `tests/agent/policies/idle.js`
Spec: Three policies with different failure modes: **greedy** (nearest apple or power-up, one-step safe),
**survivor** (never eats, maximises reachable room, avoids the cells the opponent's head can reach — without
that last rule two mirrored bots drive into each other from the spawn line and draw seven seconds in), and
**idle** (no input at all, the state that found F1). Each is a pure function of the snapshot.
Acceptance criteria:
- [ ] AC1 Greedy reaches the laser phase in a minority of rounds and survivor in a majority — the two must differ measurably, or one of them is not doing its job.
- [ ] AC2 Survivor keeps both snakes alive past 0:30 in at least 80 % of rounds.
- [ ] AC3 Each policy is unit-tested on a fixed snapshot for the move it must choose.
QA: unit + agent.

### KI-03-03 · Invariants
Owner: Sonnet-QA · Size: M · Depends on: KI-03-01
Files: `tests/agent/invariants.js`, `tests/agent/invariants.test.js`
Spec: The per-frame checks the QA pass ran, as a reusable module: segments in bounds and integral, no
self-overlap while alive, `length` equals `segments.length`, `stepProgress` in [0, 1], positive finite
`speedMultiplier`, non-negative `pendingGrowth`, finite non-negative `timeRemaining`, no living head inside
the laser dead zone, no apple under a snake, apples never sharing a row or column, and HUD text agreeing with
the simulation **within 0.25 s** — because `ARCHITECTURE §8` throttles HUD text to 10 Hz on purpose and a
strict check reports 135 false problems a match (F4).
Acceptance criteria:
- [ ] AC1 Every invariant has a unit test that feeds it a deliberately broken snapshot and sees it fail.
- [ ] AC2 The HUD tolerance is derived from `HUD_INTERVAL_SECONDS`, not a magic number.
- [ ] AC3 A clean run of ten matches reports zero problems.
QA: unit + agent.

### KI-03-04 · Statistics and the written report
Owner: Sonnet-QA · Size: S · Depends on: KI-03-02, KI-03-03
Files: `tests/agent/report.js`, `docs/qa/playtests/agent-run.md`
Spec: Aggregate a run into the numbers a design lead actually uses — rounds per match, match duration, draw
rate, end-reason mix, how often the laser phase is reached, mean and p90 round length — and write them to a
committed markdown document the way `gate1-bot-matrix.md` does, with the command that regenerates it.
Acceptance criteria:
- [ ] AC1 The document states its seeds and its command, and re-running reproduces it.
- [ ] AC2 "Reached the laser phase" is reported per policy, since that is F3's measurement.
QA: agent.

### KI-03-05 · CI
Owner: Opus · Size: S · Depends on: KI-03-01
Files: `.github/workflows/*.yml`
Spec: Run the agent suite on a schedule and on demand, never in parallel with `tests/e2e` or `tests/visual`.
A failure names the seed so it can be replayed.
Acceptance criteria:
- [ ] AC1 A scheduled job runs the suite and uploads the report.
- [ ] AC2 No two Playwright suites run at once in any job.
QA: the workflow run itself.

### KI-03-06 · `getSnapshot()` after a match ends
Owner: Sonnet · Size: S · Depends on: —
Files: `src/game/testHooks.js`, `tests/e2e/test-hooks.spec.js`
Spec: F5: after `MATCH_OVER` the hook keeps returning the finished round's snapshot, so "step until the clock
reaches T" spins forever. Either return `null` once no round is live, or document the behaviour on the hook —
whichever the tech lead judges least likely to break the existing specs, with the reasoning in the PR.
Acceptance criteria:
- [ ] AC1 The chosen behaviour is asserted by a test.
- [ ] AC2 No existing e2e spec changes meaning.
QA: e2e.

## QA plan
This sprint *is* QA infrastructure. Its own proof is that re-running it reproduces the 2026-09-07 findings:
F1 must be caught by the idle policy, and the invariants must stay silent on a healthy build.

## References
- `docs/qa/reports/2026-09-07-agent-qa-pass.md`
- `ARCHITECTURE §11` (`__kobi`), `§8` (HUD throttle); `QA-STRATEGY §4`
- `tests/sim/bots/*` — the headless policies this layer's browser policies mirror

## Risks
- **A second suite to maintain.** Kept small: one driver, three policies, one invariants module.
- **Container contention.** Two Playwright suites at once corrupts both (#86). The CI job and the npm script both serialise.
- **Mistaking design for defects.** F4 is the cautionary tale; every invariant states the design rule it derives from.

## Exit criteria
- [ ] `npm run test:agent` plays ten matches, checks every invariant, and fails loudly on a real defect.
- [ ] The idle policy reproduces F1 on a build without I01's fix, and passes with it.
- [ ] A committed report with reproducible seeds.
