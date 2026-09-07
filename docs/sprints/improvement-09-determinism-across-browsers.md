# Improvement 09 — Determinism, proved in a browser

**Lead:** Opus · **Agents:** Opus ×1, Sonnet-QA ×1 · **Prerequisite:** none
**Origin:** gap audit — every determinism proof in this repository runs in Node

## Goal
Prove that the game a player runs produces the same round as the tests say it does.

Determinism is the foundation everything else here stands on: the golden logs, the replay fixtures, the bot
matrices, `?seed=1` visual baselines, the replay player (I05) and the agent harness (I03). Every existing
proof of it runs under Vitest in **Node**. Nothing has ever checked that Chromium, WebKit and Node agree on
the same seed and the same inputs.

They almost certainly do — the simulation is integer ticks and a mulberry32 RNG over `Math.imul`, with no
`Date.now`, no `Math.random` and no float accumulation in the tick counter. This sprint turns "almost
certainly" into a test, because the day it stops being true, every replay a player saved is silently wrong.

## In scope
A browser-side comparison against the committed golden logs, across engines, plus the guards that keep the
simulation free of ambient state.

## Out of scope
Fixing WebKit or Firefox WebGL (issue #23, Sprint 16). This sprint's checks need JavaScript, not a GPU, so
they can run on engines whose WebGL is unavailable.

## Tickets

### KI-09-01 · The same round, in Node and in Chromium
Owner: Sonnet-QA · Size: M · Depends on: —
Files: `tests/e2e/determinism.spec.js`
Spec: Load the built site with a fixed seed, run the committed no-input round to completion through `__kobi`,
extract the event log, and compare it **field for field** against `tests/unit/core/__golden__/no-input-round.json`.
Then do the same for at least two `tests/sim/replays/*.json` fixtures, feeding their input logs through
`pressKey`. Any divergence names the first differing tick.
Acceptance criteria:
- [ ] AC1 The browser's event log for the no-input round is identical to the committed golden, tick for tick, including the DRAW at tick 380.
- [ ] AC2 Two replay fixtures reproduce identically in the browser.
- [ ] AC3 A deliberately altered golden makes the test fail and name the first differing tick; the PR shows it.
QA: e2e.

### KI-09-02 · The same round, in WebKit
Owner: Opus · Size: S · Depends on: KI-09-01
Files: `playwright.config.js`, `.github/workflows/nightly.yml`
Spec: Run KI-09-01's spec — and only that spec — under the `webkit` project nightly. It needs no WebGL if the
comparison is driven through the simulation rather than the renderer; if the page cannot boot without a
context, say so on the issue rather than widening the ticket.
Acceptance criteria:
- [ ] AC1 The determinism spec passes under WebKit nightly, or the blocker is reported with what was tried.
- [ ] AC2 No other spec is added to the WebKit leg.
QA: the nightly run.

### KI-09-03 · Guards against ambient state
Owner: Sonnet-QA · Size: M · Depends on: —
Files: `tests/unit/core/purity.test.js`, `eslint.config.js`
Spec: Two guards. A lint rule forbidding `Math.random`, `Date.now`, `performance.now` and `new Date` anywhere
in `src/core/`. And a test that runs a full round with those globals replaced by throwing stubs, proving the
simulation never reaches for them.
Acceptance criteria:
- [ ] AC1 The lint rule fires on a deliberately added `Math.random()` in `src/core`.
- [ ] AC2 A full round completes with all four globals stubbed to throw.
- [ ] AC3 The rule is scoped to `src/core` only; `src/game` and `src/render` legitimately use timers.
QA: lint + unit.

### KI-09-04 · Long-run stability
Owner: Sonnet-QA · Size: S · Depends on: KI-09-01
Files: `tests/sim/longRun.test.js`
Spec: A round played far past its natural end, and a match of many rounds, asserting the tick counter and the
derived clock never drift — `elapsed` is derived from an integer tick and must stay exact where a float
accumulator would not.
Acceptance criteria:
- [ ] AC1 After 100 000 ticks, `elapsed` equals `tick / simHz` exactly.
- [ ] AC2 One large `advance` and many small ones produce identical event logs.
QA: unit.

## QA plan
The committed goldens are the oracle throughout. Every ticket here compares against something already in the
repository rather than inventing a new source of truth.

## References
- `ARCHITECTURE §4` (determinism: integer ticks, seeded RNG), `src/core/rng.js`
- `tests/unit/core/__golden__/no-input-round.json`, `tests/sim/replays/*`
- Issue #23 (Firefox WebGL), Sprint 16

## Risks
- **Finding a real divergence.** If one exists, it is a serious defect and this sprint stops to report it rather than routing around it.
- **A WebKit page that will not boot without WebGL.** Report it; do not widen the ticket into fixing #23.

## Exit criteria
- [ ] The browser reproduces the committed goldens tick for tick, and the check runs on every PR.
- [ ] WebKit runs the same check nightly, or the blocker is written down.
- [ ] `src/core` is proved free of ambient time and randomness, by a lint rule and a test.
