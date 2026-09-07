# Improvement 05 — Replays you can actually watch

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2 · **Prerequisite:** none
**Origin:** KS-07-01 shipped a replay *recorder* with nowhere to play a replay back

## Goal
A round can already be recorded exactly — seed, every input, the settings it was played under — and the
tuning overlay's "Copy replay" button hands it over as JSON. Nothing can play it back. The JSON goes into an
issue, and a person then has to write a test to see what happened.

Make a replay a thing the game can show you: load one, watch it, scrub it, and step it frame by frame. That
turns every "that death was unfair" into something reproducible in ten seconds, and it is the foundation the
agent harness (I03) and any future spectating feature stand on.

## In scope
A replay format with a version number, a player for it in the running game, and the plumbing to load one from
the clipboard or a file. Determinism is the contract; I09 proves it holds in a browser.

## Out of scope
Saving replays to a server, sharing links, or a replay browser UI with thumbnails. Local only, one replay at a
time. Cosmetic replay features (camera angles, slow-mo scrubbing) are Sprint 10's business if anyone wants
them.

## Tickets

### KI-05-01 · A versioned replay format
Owner: Sonnet · Size: S · Depends on: —
Files: `src/core/replay.js`, `tests/unit/core/replay.test.js`, `docs/design/ARCHITECTURE.md`
Spec: Promote the shape KS-07-01 already writes into a named, versioned format with a parser that validates
it and rejects a malformed or future-versioned file with a useful message rather than throwing. The existing
`tests/sim/replays/*.json` fixtures must parse unchanged — they are the compatibility test.
Acceptance criteria:
- [ ] AC1 Every committed fixture in `tests/sim/replays/` parses and reports version 1.
- [ ] AC2 A truncated file, a wrong-typed field and a version-2 file each produce a named error, not an exception.
- [ ] AC3 `ARCHITECTURE` documents the format in one short section.
QA: unit.

### KI-05-02 · Play a replay back
Owner: Sonnet · Size: L · Depends on: KI-05-01
Files: `src/game/replayPlayer.js`, `src/game/session.js`, `tests/unit/game/replayPlayer.test.js`, `tests/e2e/replay.spec.js`
Spec: A driver that takes a parsed replay and feeds its inputs to a `RoundSimulation` built from its seed and
settings, so the round re-runs identically. Playback controls are play, pause, step one simulation step, and
seek to a tick — seek by replaying from the start, which is cheap and exact, rather than by storing snapshots.
The session grows a replay mode that renders it with the existing renderer and HUD.
Acceptance criteria:
- [ ] AC1 Replaying a committed fixture reproduces its event log **tick for tick**, asserted against the golden.
- [ ] AC2 Seeking to tick N then playing forward gives the same state as playing from 0 to N.
- [ ] AC3 Replay mode accepts no player input into the simulation: pressing a movement key changes nothing.
- [ ] AC4 An e2e test loads a replay, plays it to the end and reads the same result the fixture records.
QA: unit + e2e.

### KI-05-03 · Getting a replay into the game
Owner: Sonnet · Size: M · Depends on: KI-05-02
Files: `src/ui/screens/replay.js`, `src/ui/ui.js`, `src/game/gameStateMachine.js`, `src/ui/styles.css`, tests, visual baselines
Spec: A REPLAY entry point that takes JSON from a paste box or a chosen local file — no network, nothing
fetched, the zero-request test still passes — plus the transport controls and a tick readout. New state in the
machine with its generated transition tests. Label `needs-design-review` with a screenshot.
Acceptance criteria:
- [ ] AC1 Pasting a valid replay plays it; pasting rubbish shows a readable error and stays on the screen.
- [ ] AC2 The offline/zero-network e2e check still passes.
- [ ] AC3 Every new state-machine row is covered by the generated table test.
- [ ] AC4 Esc leaves replay mode and returns where it came from.
QA: unit + e2e + visual.

### KI-05-04 · Record the round that just happened
Owner: Sonnet · Size: S · Depends on: KI-05-02
Files: `src/game/session.js`, `src/ui/screens/scoreboard.js`, tests
Spec: The scoreboard offers WATCH LAST ROUND. The recorder already runs under the tuning gate; this makes the
last round's replay available in an ordinary session so a player — or an eleven-year-old showing a friend the
death that was definitely unfair — can watch it back without a query string.
Acceptance criteria:
- [ ] AC1 After any round, WATCH LAST ROUND plays exactly that round.
- [ ] AC2 The recorder's cost when nothing asks for a replay is measured and stated in the PR.
QA: e2e.

## QA plan
Determinism is the whole ticket: the golden logs are the oracle, and I09 extends that proof to the browser.
Add one agent-harness run that records a match and replays every round of it.

## References
- KS-07-01 / PR #115 (the recorder and its fixture shape), `tests/sim/replays/*`
- `ARCHITECTURE §4` (determinism), `§11` (`__kobi`)

## Risks
- **Replay drift.** If the browser and Node disagree by one float, replays break silently. I09 is the guard; this sprint should not land its player before that check exists or is scheduled.
- **Scope creep into a spectator feature.** One replay, local, four controls.

## Exit criteria
- [ ] A versioned format, a validating parser, and every existing fixture still parsing.
- [ ] A replay plays back tick-for-tick identical to its golden.
- [ ] A player can watch the round they just lost, from the scoreboard, with no query string.
