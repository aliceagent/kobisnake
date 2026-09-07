# Improvement 06 — Resilience: context loss, tab lifecycle, low-end fallback

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1 · **Prerequisite:** none
**Origin:** gap audit during the 2026-09-07 agent QA pass

## Goal
Survive the ordinary accidents of a browser. Nothing in the codebase listens for `webglcontextlost`, so a
laptop waking from sleep, a driver reset, or a browser reclaiming GPU memory from a background tab leaves the
player looking at a dead canvas with no way back except reloading — and a reload loses the match.

Sprint 16 covers budgets, browser engines, axe and offline. It does not cover *recovering from a failure*.
This sprint does.

## In scope
WebGL context loss and restore, an error screen that says something useful, tab lifecycle beyond the existing
hidden-tab pause, and a startup path that degrades rather than dies when WebGL is unavailable.

## Out of scope
Performance budgets (I08), browser-matrix testing (Sprint 16), any change to simulation behaviour. The
simulation is pure and headless; it survives all of this already, which is precisely what makes recovery
possible.

## Tickets

### KI-06-01 · Survive context loss
Owner: Opus · Size: M · Depends on: —
Files: `src/render/renderer.js`, `src/game/session.js`, `tests/unit/render/renderer.test.js`, `tests/e2e/resilience.spec.js`
Spec: Listen for `webglcontextlost` (calling `preventDefault`, without which the context never restores) and
`webglcontextrestored`. On loss: pause the match the way PAUSE already does, so no simulated time passes
while there is nothing to see. On restore: rebuild whatever GPU resources need rebuilding and resume through
the same READY? beat a normal resume uses. Drive it in the e2e test with the `WEBGL_lose_context` extension,
which is exactly what it exists for.
Acceptance criteria:
- [ ] AC1 An e2e test loses the context mid-round, restores it, and the match continues from the same tick — asserted, not eyeballed.
- [ ] AC2 No simulated time passes while the context is gone.
- [ ] AC3 `preventDefault` is called on the loss event, with a comment saying why.
QA: unit + e2e.

### KI-06-02 · A screen for when it cannot be fixed
Owner: Sonnet · Size: M · Depends on: KI-06-01
Files: `src/ui/screens/error.js`, `src/main.js`, `src/ui/styles.css`, tests, visual baseline
Spec: If the context does not come back, or WebGL was never available, show a plain screen that says what
happened and offers RELOAD — in words an eleven-year-old can act on, not a stack trace. Also the last-resort
handler for an unexpected throw during startup, so the failure mode is a message rather than a white page.
Label `needs-design-review`.
Acceptance criteria:
- [ ] AC1 With WebGL unavailable the game shows the screen instead of a blank page; asserted in a test that blocks context creation.
- [ ] AC2 A thrown error during startup reaches the screen rather than the console alone.
- [ ] AC3 The screen carries no technical jargon; one visual baseline.
QA: unit + e2e + visual.

### KI-06-03 · Tab lifecycle
Owner: Sonnet · Size: S · Depends on: —
Files: `src/game/loop.js`, `src/game/session.js`, tests
Spec: A hidden tab already freezes simulated time (KS-05-05). Extend the same care to the rest of the
lifecycle: `pagehide`/`freeze` for a tab the browser suspends, and a return from suspension that does not
credit the frame loop with a huge delta. `loop.js` clamps a frame to 100 ms already; verify that clamp holds
across a suspension of minutes and that the match is paused rather than silently advanced.
Acceptance criteria:
- [ ] AC1 A simulated multi-minute suspension advances the round by nothing.
- [ ] AC2 The frame clamp is asserted directly with a fabricated large delta.
QA: unit + e2e.

### KI-06-04 · The agent harness proves it
Owner: Sonnet-QA · Size: S · Depends on: KI-06-01, I03
Files: `tests/agent/resilience.js`
Spec: Add a chaos pass to the agent harness: during a played match, lose and restore the context at random
moments and assert the match still finishes with its invariants intact.
Acceptance criteria:
- [ ] AC1 Ten matches, each interrupted at least three times, all finish with zero invariant failures.
QA: agent.

## QA plan
Everything here is testable without special hardware: `WEBGL_lose_context` fabricates the failure and
Playwright fabricates the lifecycle events. If a behaviour cannot be tested, it is not in this sprint.

## References
- `ARCHITECTURE §3` (only `src/render` may touch three.js), `§5` (the loop), `§11`
- KS-05-05's hidden-tab test, `src/game/loop.js`'s `maxFrameSeconds` clamp

## Risks
- **Recovery code that never runs.** Untestable recovery is worse than none, because it is believed. Every ticket here has a way to fabricate the failure.
- **Overlap with Sprint 16.** That sprint measures and gates; this one recovers. Hand it the tests.

## Exit criteria
- [ ] A lost context is recovered and the match continues from the same tick.
- [ ] An unrecoverable failure shows a screen a child can act on.
- [ ] The chaos pass runs ten interrupted matches clean.
