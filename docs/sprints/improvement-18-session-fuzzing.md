# Improvement 18 — Session fuzzing

**Lead:** Opus · **Agents:** Opus ×1, Sonnet-QA ×1 · **Prerequisite:** I03 (the driver)
**Origin:** `tests/sim` fuzzes the simulation with random inputs; nothing fuzzes the game around it

## Goal
Find the stuck states. The simulation has been fuzzed with 4 000 seeds since Sprint 02. The thing wrapped
around it — the state machine, the screens, the focus model, pause and resume, blur and refocus, the
scoreboard beats, the tuning overrides — has only ever been driven by scripts that do what a spec expects.
A child mashes keys during the countdown, presses Esc twice on the scoreboard, alt-tabs during READY?, and
holds Space through a crash. This sprint does that, at random, ten thousand times, and reports every state the
game cannot get out of, every unhandled exception, and every invariant the I03 module breaks.

## In scope
A monkey driver over the I03 harness: random key and menu sequences, random blur/focus, random resizes,
random timing; a stuck-state detector; a shrinking reproducer that turns a 2 000-step failure into the
shortest sequence that still fails.

## Out of scope
Fuzzing the simulation (done), fuzzing the renderer's GPU behaviour (I06 covers context loss).

## Tickets

### KI-18-01 · The monkey
Owner: Opus · Size: M · Depends on: —
Files: `tests/agent/monkey.js`, `tests/agent/monkey.spec.js`
Spec: From a seed, generate a sequence of actions drawn from every key the game listens to plus `blur`,
`focus`, `visibilitychange` and `resize`, at random intervals from 0 to 2 s of simulated time, and apply them
through the driver. After each action: the invariants, and a stuck check — a state that has not changed in
60 s of simulated time with no round running is stuck, and so is any state the machine's own table says is
unreachable.
Acceptance criteria:
- [ ] AC1 A seeded run is reproducible action for action.
- [ ] AC2 Every action reaches the game through the same listeners a person's would.
- [ ] AC3 200 seeds × 500 actions complete in under 10 minutes on CI.
QA: agent.

### KI-18-02 · Shrink the failure
Owner: Sonnet-QA · Size: M · Depends on: KI-18-01
Files: `tests/agent/shrink.js`, `tests/agent/shrink.test.js`
Spec: When a run fails, delta-debug the action list — drop halves, then quarters, then single actions —
re-running each candidate until the shortest still-failing sequence is found. Write it out as a replayable
fixture and as a sentence.
Acceptance criteria:
- [ ] AC1 A fabricated failure at action 1 500 of 2 000 shrinks to fewer than 20 actions.
- [ ] AC2 The shrunk fixture reproduces the failure on replay.
QA: unit + agent.

### KI-18-03 · The first campaign
Owner: Sonnet-QA · Size: M · Depends on: KI-18-02
Files: `docs/qa/reports/*-session-fuzz.md`, issues
Spec: Run 2 000 seeds. File one issue per distinct failure with the shrunk sequence, and write the report:
seeds run, failures found, states reached (every state in the machine's table should be visited, and the
report says which were not).
Acceptance criteria:
- [ ] AC1 A committed report with the coverage of states and the failure list.
- [ ] AC2 Every failure has an issue with a shrunk reproducer.
QA: agent.

## QA plan
The campaign is the QA. Its own check is that a deliberately introduced stuck state (a transition removed on
a branch) is found within 200 seeds.

## References
- I03; `src/game/gameStateMachine.js` and its generated table test; `tests/sim/laserFuzz.test.js` for the fuzzing discipline

## Risks
- **Noise from container contention.** Timing-sensitive actions on a loaded box produce false stuck reports; the stuck check uses simulated time, not wall time, for exactly this reason.
- **Finding a lot.** Good. File them; do not fix them in this sprint.

## Exit criteria
- [ ] Ten thousand random actions across 2 000 seeds, every state visited, every failure shrunk and filed.
