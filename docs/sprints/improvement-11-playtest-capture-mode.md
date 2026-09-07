# Improvement 11 — Playtest capture mode

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2 · **Prerequisite:** I05 KI-05-01 (the replay format) is helpful, not required
**Origin:** Gate 1 (KS-07-02) has waited on two humans and a facilitator since Sprint 07 signed off

## Goal
Make a human playtest something two people can run by themselves in thirty minutes, with nothing to write
down. `?playtest=1` records every round's replay automatically, asks the two players the playtest script's
questions between rounds — one or two at a time, in the words the script already uses — and at the end hands
back a single file the design lead can read and the agents can act on. The facilitator the process assumes
becomes optional, and every "that was unfair" arrives with the replay that proves it.

## In scope
A capture mode behind a query flag, the between-round question flow drawn from `docs/qa/PLAYTEST-SCRIPT.md`,
automatic replay capture per round, one exported JSON plus a rendered markdown summary, and the bridge from
that file to issues.

## Out of scope
Sending anything anywhere: the file is downloaded or copied, never uploaded. Redesigning the playtest script.
Anything visible without the flag — a normal load is byte-for-byte unaffected.

## Tickets

### KI-11-01 · The question bank as data
Owner: Sonnet · Size: S · Depends on: —
Files: `src/qa/playtestQuestions.js`, `tests/unit/qa/playtestQuestions.test.js`, `docs/qa/PLAYTEST-SCRIPT.md`
Spec: Lift every question in `PLAYTEST-SCRIPT.md` §2–§8 into a data file: id (M1, V2, P5…), the question,
its answer type (yes/no, 1–5, free text), which section it belongs to, and when it is asked (after round N,
after the laser phase was seen, at the end). The script gains a line saying it is generated from this file,
so the two cannot drift.
Acceptance criteria:
- [ ] AC1 Every question id in the script exists in the data and vice versa, asserted by a test that parses the markdown.
- [ ] AC2 Each question carries a trigger; no question is asked before its trigger can have happened.
QA: unit.

### KI-11-02 · The between-round prompt
Owner: Sonnet · Size: L · Depends on: KI-11-01
Files: `src/ui/screens/playtestPrompt.js`, `src/game/session.js`, `src/ui/styles.css`, `src/main.js`, tests, visual baseline
Spec: Under `?playtest=1`, after the scoreboard and before the next countdown, show at most two due questions
with keyboard-only answering (arrows and Enter; both players can answer, each answer tagged P1/P2). Skippable
with Esc, and a skipped question comes back later rather than being lost. The flow is a local overlay in
ROUND_OVER, not a state-machine row, following KI-10-03's pattern. Without the flag no DOM node exists.
Acceptance criteria:
- [ ] AC1 A round played under the flag is followed by a prompt; the same round without the flag is not, and the DOM has no prompt node.
- [ ] AC2 Answers are attributed to a player and stored with the round they follow.
- [ ] AC3 The generated state-machine table test is unchanged.
- [ ] AC4 One baseline of the prompt.
QA: unit + e2e + visual.

### KI-11-03 · Automatic replay capture and the session file
Owner: Sonnet · Size: M · Depends on: KI-11-02
Files: `src/qa/playtestSession.js`, `src/ui/screens/playtestPrompt.js`, `tests/unit/qa/playtestSession.test.js`, `tests/e2e/playtest-mode.spec.js`
Spec: Every round's replay (the KS-07-01 recorder, already present) is kept with its answers, its result and
its tuning overrides. At any time, and at match over, EXPORT copies one JSON document to the clipboard with
the textarea fallback the tuning overlay already uses, and offers a download. A markdown summary is rendered
alongside: per-question tallies, every "no" or "unfair" with its round and seed.
Acceptance criteria:
- [ ] AC1 An e2e test plays two rounds under the flag, answers three questions, exports, and the JSON contains both replays and all three answers.
- [ ] AC2 Each replay in the export reproduces its round tick for tick through `tests/sim`'s harness.
- [ ] AC3 The offline/zero-network e2e check still passes.
QA: unit + e2e.

### KI-11-04 · From file to issues
Owner: Opus · Size: S · Depends on: KI-11-03
Files: `scripts/playtest-to-issues.mjs`, `docs/qa/PLAYTEST-SCRIPT.md`, `docs/process/HANDOFF.md`
Spec: A script that reads an exported session file and prints one ready-to-paste issue body per failing
answer — question, both players' words, the round's seed and replay — so the design lead files findings in
minutes. Document the whole self-serve flow in the script and the handoff.
Acceptance criteria:
- [ ] AC1 Running the script on the AC1 fixture from KI-11-03 prints one issue body per "no", each with a replay.
- [ ] AC2 `PLAYTEST-SCRIPT.md` §1 tells two humans how to run a session with no facilitator.
QA: unit (the script's formatter).

## QA plan
The agent harness (I03) drives a whole session under the flag and exports; that export is the fixture for
KI-11-04. A human dry run by the design lead before the owner is asked to use it.

## References
- `docs/qa/PLAYTEST-SCRIPT.md`, `docs/qa/QA-STRATEGY.md`; KS-07-01 (the recorder), I05 (the format)
- KI-10-03's local-overlay pattern; `ARCHITECTURE §11`

## Risks
- **Turning a playtest into a form.** Two questions at most between rounds, skippable, never blocking a countdown for more than the players want.
- **Copy drift.** Questions come from the script's own words; the parse test enforces it.

## Exit criteria
- [ ] Two people can run a Gate session with no facilitator and hand back one file.
- [ ] Every "no" in that file carries a replay that reproduces.
- [ ] A normal load is unaffected.
