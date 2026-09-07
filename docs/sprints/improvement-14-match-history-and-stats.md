# Improvement 14 — Match history and a STATS screen

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2 · **Prerequisite:** I13 KI-13-02 (names), Sprint 13 save schema or its stand-in
**Origin:** `DESIGN-DECISIONS §1` row 29 (design-lead ruling; the owner may veto)

## Goal
Remember what happened. Today a match ends, the screen says who won, and nothing is kept. A child who has
beaten a parent wants that to be on the record; a parent wants to know whether the handicap is working. This
sprint records every finished match locally and shows it on a STATS screen: per name, matches and rounds
won, longest snake, rounds survived into the laser phase, the head-to-head record, and the seed of the last
match so it can be watched again through I05's player.

Nothing leaves the browser. The save schema is Sprint 13's; this sprint writes under a versioned key that
sprint adopts, exactly as I07 and I13 do.

## In scope
A stats model, its persistence, the screen, and the hook from match over.

## Out of scope
Cloud sync, sharing, achievements, anything that changes how a match plays.

## Tickets

### KI-14-01 · The stats model
Owner: Sonnet · Size: M · Depends on: —
Files: `src/core/stats.js`, `tests/unit/core/stats.test.js`
Spec: A pure reducer: `(stats, finishedMatchSummary) → stats`. The summary is built from the match tally and
the round event logs the session already has — laser-phase survival is "alive at the LASER_WARNING event",
longest snake is the max length seen. Keyed by player name; a renamed player is a new player.
Acceptance criteria:
- [ ] AC1 Reducing the same summary twice is idempotent by match id.
- [ ] AC2 Every field is derived from events or the tally, asserted against a fixture match.
- [ ] AC3 Lives in `src/core`, no DOM, runs in Node.
QA: unit.

### KI-14-02 · Persistence
Owner: Sonnet · Size: S · Depends on: KI-14-01
Files: `src/game/statsStore.js`, `tests/unit/game/statsStore.test.js`
Spec: Versioned localStorage key, migration stub, corrupt-data fallback to empty, a size cap (keep the last
200 matches). Written once at MATCH_OVER, never during a round.
Acceptance criteria:
- [ ] AC1 Corrupt storage yields empty stats and no error visible to the player.
- [ ] AC2 The 201st match evicts the oldest.
QA: unit.

### KI-14-03 · The STATS screen
Owner: Sonnet · Size: M · Depends on: KI-14-02
Files: `src/ui/screens/stats.js`, `src/ui/ui.js`, `src/game/gameStateMachine.js`, `src/ui/styles.css`, tests, visual baseline
Spec: Reachable from the main menu; a table per name and a head-to-head block; WATCH LAST MATCH if I05 has
landed, otherwise the seed shown as text; CLEAR STATS with a confirm. Keyboard-only. `needs-design-review`.
Acceptance criteria:
- [ ] AC1 After a finished match, the screen shows it; an e2e test plays a match and reads the row.
- [ ] AC2 Every new state-machine row is covered by the generated table test.
- [ ] AC3 One baseline.
QA: e2e + visual.

## QA plan
Unit for the reducer, e2e through a real match, agent harness confirming a hundred matches do not exceed the
cap or slow MATCH_OVER.

## References
- `DESIGN-DECISIONS §1` row 29, `§2.9` (save data); Sprint 13; I05; I13

## Risks
- **Fighting Sprint 13's schema.** Versioned key, documented for adoption, same as I07/I13.
- **Storage bloat.** The cap is the answer; the test enforces it.

## Exit criteria
- [ ] A finished match is on the STATS screen, by name, with the numbers row 29 lists.
- [ ] Stats survive a reload and a corrupt store.
