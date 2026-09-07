# Improvement 12 — A CPU opponent

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** I03 KI-03-02 (the policies exist in the browser)
**Origin:** `DESIGN-DECISIONS §1` row 27 (design-lead ruling; the owner may veto)

## Goal
Let one child play the game that exists. Today the only playable mode needs two people at one keyboard; the
single-player mode the GDD promises is a different game (solo survival, post-1.0). This sprint adds a computer
opponent *inside the two-player mode*: on match setup, either player can be HUMAN or CPU, at three levels.

The bots already exist and are already good enough to be interesting — the greedy bot wins about a third of
its rounds against the survivor, and the survivor lives into the laser phase. They live in `tests/`. This
sprint moves the policy interface into `src/`, keeps the bots honest (they see only what a snapshot shows and
act only through the input queue), and puts a switch on the setup screen.

## In scope
A bot interface in `src/game`, three levels built from the existing policies, the setup-screen switch, the
key-award rule, and tests that the CPU cannot cheat.

## Out of scope
Solo survival (Sprint 19), a difficulty slider, bots that talk. The CPU never gets a mechanic a human does not
have.

## Tickets

### KI-12-01 · The policy interface, in `src/`
Owner: Opus · Size: M · Depends on: —
Files: `src/game/bots/policy.js`, `src/game/bots/greedy.js`, `src/game/bots/survivor.js`, `tests/unit/game/bots/*.test.js`, `tests/sim/bots/*`
Spec: A policy is a pure function `(snapshot, playerIndex, settings) → Direction | null`. Move the greedy and
survivor policies from `tests/sim/bots` into `src/game/bots` and make the sim tests import them from there,
so the bots the CPU uses are the bots the statistics are measured on. No policy may read anything but the
public snapshot; no policy may call `applyInput` — the session does that on its behalf through the same queue
a keyboard feeds.
Acceptance criteria:
- [ ] AC1 Every existing `tests/sim` statistic reproduces to the number after the move.
- [ ] AC2 A test passes a frozen snapshot and asserts a policy cannot mutate it.
- [ ] AC3 `src/game/bots` imports nothing from `src/render` or `src/ui` and nothing from `tests/`.
QA: unit + sim.

### KI-12-02 · Driving a CPU player through the input queue
Owner: Sonnet · Size: M · Depends on: KI-12-01
Files: `src/game/session.js`, `src/game/cpuPlayer.js`, `tests/unit/game/cpuPlayer.test.js`, `tests/e2e/cpu.spec.js`
Spec: A CPU player asks its policy once per grid step and enqueues the answer exactly as `input.js` would.
It is subject to `inputBufferSize` and the no-reversal rule like anyone else, it is paused when the game is
paused, and its choices are recorded in the replay so a CPU match replays identically. Determinism is the
contract: the same seed and the same levels give the same match.
Acceptance criteria:
- [ ] AC1 A CPU-vs-CPU match on a fixed seed produces an identical event log on two runs, and replays through I05's player if it exists.
- [ ] AC2 The CPU's inputs pass through the same queue; a test shows a reversal is rejected for a CPU exactly as for a human.
- [ ] AC3 PAUSE stops the CPU; no input is enqueued while paused.
QA: unit + e2e.

### KI-12-03 · Three levels
Owner: Sonnet-QA · Size: M · Depends on: KI-12-02
Files: `src/game/bots/levels.js`, `tests/sim/cpuLevels.test.js`, `docs/qa/playtests/cpu-levels.md`
Spec: EASY = greedy; NORMAL = survivor; HARD = survivor that also steers to force head-ons it will win by
length. Measure each level against the others and against a no-input human over 500 seeded rounds; the levels
must be ordered — HARD beats NORMAL beats EASY by a clear margin — and EASY must lose to an idle player less
than a quarter of the time, so a beginner can win.
Acceptance criteria:
- [ ] AC1 Win rates are monotone across the three levels, asserted with a margin, not just observed.
- [ ] AC2 A committed document with seeds and the command.
QA: sim.

### KI-12-04 · The switch, and the key rule
Owner: Sonnet · Size: M · Depends on: KI-12-02
Files: `src/ui/screens/matchSetup.js`, `src/game/session.js`, `src/core/match.js`, `src/ui/styles.css`, tests, visual baseline
Spec: Each player row on match setup gains HUMAN / CPU EASY / CPU NORMAL / CPU HARD. Keys are awarded only
when at least one human played (row 27). The controls card (KI-10-02) shows "CPU" instead of keys for a
computer player. `needs-design-review`.
Acceptance criteria:
- [ ] AC1 Defaults are HUMAN/HUMAN and a match started without touching the row is byte-identical to today's.
- [ ] AC2 A CPU-vs-CPU match awards zero keys; a human-vs-CPU match awards the normal amount to the human.
- [ ] AC3 One regenerated baseline.
QA: unit + e2e + visual.

## QA plan
The agent harness plays human-vs-CPU at each level; the sim measures the levels. The design lead plays five
matches against NORMAL before sign-off and records whether it felt like an opponent.

## References
- `DESIGN-DECISIONS §1` row 27, `§2.2` (queued input), `§2.6` (keys); `tests/sim/bots/*`; I03

## Risks
- **The CPU cheating by accident.** A policy that reads `pendingGrowth` or the RNG would be superhuman. AC2/AC3 of KI-12-01 fence it.
- **The owner vetoing.** Row 27 is flagged as vetoable. If vetoed, KI-12-01 still stands on its own as a code move and the rest is closed.

## Exit criteria
- [ ] One person can start a match against the computer from the setup screen.
- [ ] Three levels, measured, ordered, documented.
- [ ] The CPU sees only the snapshot and acts only through the queue; a CPU match replays identically.
