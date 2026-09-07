# Improvement 08 — Performance budgets, enforced before the art lands

**Lead:** Opus · **Agents:** Opus ×1, Sonnet-QA ×1 · **Prerequisite:** none
**Origin:** gap audit — `ARCHITECTURE §12` states budgets; `tests/perf` does not exist until Sprint 16

## Goal
Enforce the budgets now, while the game is grey boxes and every measurement is comfortably inside them, so
the art sprints get a red build the day they cross a line instead of a bill at Sprint 16.

`ARCHITECTURE §12` already fixes the numbers: **≤ 350 kB gzip**, **p95 frame ≤ 16.6 ms**, **≤ 120 draw calls**.
Today the build is **155 kB gzip** and a played match measures **14–22 draw calls**. Sprints 08–10 add snake
models, a studded floor, brick walls, emitter towers, trees, lanterns, banners, a lighting rig, beams, glow,
sparks, debris and celebrations. Every one of those is a draw call and a byte, and nothing currently notices.

## In scope
`tests/perf`: bundle size, draw calls, frame time, and a written baseline. Wired into CI as a gate.

## Out of scope
Optimising anything. Nothing is over budget. This sprint builds the alarm, not the fix. Browser-matrix and
accessibility gating stay with Sprint 16, which inherits this harness.

## Tickets

### KI-08-01 · Bundle budget
Owner: Sonnet-QA · Size: S · Depends on: —
Files: `tests/perf/bundle.test.js`, `package.json`
Spec: After a build, assert the gzipped JS+CSS total against `ARCHITECTURE §12`'s 350 kB, and print the
current figure and the headroom so a PR that adds 40 kB is visible in the log even while it passes. The
threshold is read from one named constant with the §12 reference in its comment.
Acceptance criteria:
- [ ] AC1 The test fails against a deliberately inflated build and the PR shows that run.
- [ ] AC2 Output names the current size, the budget, and the percentage used.
QA: unit.

### KI-08-02 · Draw-call budget
Owner: Sonnet-QA · Size: M · Depends on: I03 (KI-03-01)
Files: `tests/perf/drawCalls.js`
Spec: Measure `renderer.getDrawCalls()` at the moments that matter — opening board, mid-round with both
snakes long, laser warning with beams lit, the 6×6 endgame, and every menu — and assert each against 120.
Take the measurement through the agent driver so it is the real scene, not a fixture. Note that KS-07-00
already found one draw-call assertion measuring the wrong thing (a pedestal counted as a laser); isolate what
each sample counts.
Acceptance criteria:
- [ ] AC1 Five named scenes measured and asserted, each with its own number recorded.
- [ ] AC2 Each sample isolates what it claims to measure; the PR says how.
- [ ] AC3 The committed baseline names today's figures.
QA: perf + agent.

### KI-08-03 · Frame-time budget
Owner: Opus · Size: M · Depends on: KI-08-02
Files: `tests/perf/frameTime.js`, `docs/qa/playtests/perf-baseline.md`
Spec: p95 frame time over a played round. **The honest part of this ticket is the measurement's own
caveat**: CI renders in software at 7–8 fps, so a raw millisecond budget there is meaningless — KS-07-06 hit
exactly this and solved it by reporting a machine-independent figure alongside the milliseconds. Do the same:
gate on a hardware-independent proxy (draw calls, triangles, geometry and material counts, and per-frame
allocation), record the milliseconds as information, and say plainly that the 16.6 ms gate needs real hardware
and belongs to Sprint 16.
Acceptance criteria:
- [ ] AC1 A committed baseline document with both the machine-independent figures and the milliseconds, and a paragraph on why only the former gates.
- [ ] AC2 Scene object counts do not grow across a match — a leak check, asserted over 500 rounds' worth of scene churn.
- [ ] AC3 The document states what Sprint 16 must add on real hardware.
QA: perf.

### KI-08-04 · CI gate
Owner: Opus · Size: S · Depends on: KI-08-01, KI-08-02
Files: `.github/workflows/*.yml`, `package.json`
Spec: `npm run test:perf`, run on every PR for the cheap checks (bundle, draw calls) and nightly for the rest.
A failure names the budget, the measurement and the headroom lost.
Acceptance criteria:
- [ ] AC1 A PR that crosses a budget goes red with a message naming the budget and the number.
- [ ] AC2 No two Playwright suites run concurrently in any job (#86).
QA: the workflow run.

## QA plan
This sprint is a QA layer. Its proof is that it goes red on a deliberately inflated build and stays green on
`main`, both shown in the PRs.

## References
- `ARCHITECTURE §12` (the three budgets), KS-07-06 (how to report a machine-dependent number honestly)
- KS-04-02 AC3 and its draw-call defect (a pedestal counted as a laser) — the cautionary tale for KI-08-02
- Sprint 16, which inherits this harness

## Risks
- **A budget that fires on noise.** Software rendering is noisy; that is why the gate is on counts, not milliseconds.
- **A budget nobody can pass later.** If the art track genuinely needs more than 120 draw calls, the answer is a design decision, not a quietly raised constant. Any change to §12 is the design lead's.

## Exit criteria
- [ ] Bundle, draw-call and scene-count budgets enforced in CI, with today's figures recorded.
- [ ] Each gate demonstrated red on a deliberately over-budget build.
- [ ] A written baseline the art sprints can be measured against.
