# Improvement 01 — Match termination and draw resolution

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1 · **Prerequisite:** none (runs against `main` today)
**Origin:** `docs/qa/reports/2026-09-07-agent-qa-pass.md` finding **F1**

## Goal
Make every match finish. Today a Best-of-N match whose rounds all draw can never be won: `match.js` scores a
draw to nobody and `isOver()` is only true when a player reaches the win target. Two players who put the
keyboard down draw at tick 380 every round, forever — twelve rounds were played this way on the running build,
score 0–0, before the harness gave up. The only exit is QUIT.

## In scope
The draw rule, its design ruling in `DESIGN-DECISIONS`, `src/core/match.js`, the scoreboard and match-over
copy that explains it, and tests that prove a match always terminates.

## Out of scope
Changing what makes a round a draw. `§2.5`'s head-on rule (equal length, both die) is signed off by the owner
and is not reopened here. This sprint decides what a *match* does about draws, not what a *round* does.

## Design ruling to make first (Fable, KI-01-00)
The design lead rules before any code is written, and records it as a new row in `DESIGN-DECISIONS §1` plus a
`§2.5` paragraph. The options on the table, cheapest first:

1. **Consecutive-draw cap.** After `maxConsecutiveDraws` draws in a row the match ends: the player with more
   wins takes it; if the wins are level the match is declared a draw and the scoreboard says so.
2. **Draws count as played.** A draw advances a round counter, and a match ends after `bestOf` rounds whatever
   the score, with the leader winning and a level score ending as a match draw.
3. **Sudden death.** After a draw the next round starts with the laser timer shortened, so the arena closes
   faster each time and a draw becomes progressively harder.

Option 1 is the recommendation: it is the smallest rule, it cannot change a single non-drawing match, and it
is explainable to an eleven-year-old in one sentence. Whatever is chosen, "a match always ends" becomes a
stated invariant of the design.

## Tickets

### KI-01-00 · The ruling
Owner: Fable · Size: S · Depends on: —
Files: `docs/design/DESIGN-DECISIONS.md`
Spec: Choose among the options above, write the rule into `§1` as a new row and into `§2.5` as prose, and name
the settings key(s) it needs with their values. Post the ruling on the tracking issue before KI-01-01 starts.
Acceptance criteria:
- [ ] AC1 `DESIGN-DECISIONS` states, in one sentence a child could read, when a match ends without either player reaching the target.
- [ ] AC2 The rule names every new settings key and its value.
QA: manual (documentation).

### KI-01-01 · The rule in the simulation
Owner: Sonnet · Size: M · Depends on: KI-01-00
Files: `src/core/match.js`, `src/core/settings.js`, `tests/unit/core/match.test.js`
Spec: Implement the ruling in `createMatch`. `recordRound` gains whatever draw bookkeeping the rule needs;
`isOver()` becomes true in the new case as well; a new accessor reports *why* the match ended so the UI can
say something truthful. `settings.js` gains the ruled key with the ruled value and nothing else.
Acceptance criteria:
- [ ] AC1 A match whose every round draws terminates, and the test asserts the exact round it does so on.
- [ ] AC2 A match with at least one decisive round is byte-for-byte unaffected: the existing `match.test.js` cases pass unchanged.
- [ ] AC3 The end reason is reported (`winner`, or the new "ended level" case) and is distinguishable from a normal win.
- [ ] AC4 A property test over 10 000 random result sequences: **every** match terminates within a bounded number of rounds.
QA: unit.

### KI-01-02 · The player is told
Owner: Sonnet · Size: S · Depends on: KI-01-01
Files: `src/game/session.js`, `src/ui/screens/scoreboard.js`, `src/ui/screens/matchOver.js`, `tests/e2e/match-flow.spec.js`, visual baselines
Spec: The scoreboard warns before the rule bites ("DRAW — REPLAY · one more and the match is called") and the
match-over screen states the outcome in the ruled words. No new screen, no new option; copy and wiring only.
Label the PR `needs-design-review` and include the two baselines.
Acceptance criteria:
- [ ] AC1 An e2e test plays a match of nothing but draws and reaches MATCH_OVER through the real flow.
- [ ] AC2 The match-over panel names the outcome and neither player is shown as a winner when the score is level.
- [ ] AC3 Regenerated baselines for the two screens, each deleted before re-recording.
QA: e2e + visual.

### KI-01-03 · The agent regression
Owner: Sonnet-QA · Size: S · Depends on: KI-01-01
Files: `tests/sim/matchTermination.test.js`
Spec: A simulation-level test that plays whole matches with the no-input driver and with two mirrored
survival bots — the two ways a human reaches this state — and asserts each terminates.
Acceptance criteria:
- [ ] AC1 A no-input Best-of-3 and a Best-of-5 both terminate, with the round count asserted.
- [ ] AC2 Two mirrored bots that draw by head-on collision terminate too.
QA: unit (`tests/sim`).

## QA plan
Unit and e2e as above, plus one run of the I03 agent harness against the built site once it exists: the
harness's own "match did not finish" report is the end-to-end proof.

## References
- `docs/qa/reports/2026-09-07-agent-qa-pass.md` §3 F1 (the demonstration: 12 rounds, 0–0)
- `DESIGN-DECISIONS §2.5` (draw replayed, head-on rule), `src/core/match.js` module comment
- `tests/unit/core/__golden__/no-input-round.json` (the DRAW at tick 380 that makes this reachable)

## Risks
- **Changing a signed-off rule by accident.** The head-on rule and "a draw is replayed" are both owner-approved. Option 1 leaves both intact; anything that changes round scoring needs the owner, not just the design lead.
- **Copy that confuses a child.** The match-over wording is design-reviewed, not invented in the PR.

## Exit criteria
- [ ] The ruling is in `DESIGN-DECISIONS` and implemented behind a named setting.
- [ ] A property test proves termination over 10 000 sequences.
- [ ] A match of pure draws ends on screen, in words, through the real flow.
