# Improvement 13 — Fair play: names, handicaps, swap sides

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2 · **Prerequisite:** none
**Origin:** `DESIGN-DECISIONS §1` row 28 (design-lead ruling; the owner may veto)

## Goal
The GDD's audience is a child and a parent. They are not evenly matched, and a game the stronger player
always wins is a game the weaker one stops asking to play. This sprint adds the three things a family
actually uses to even a table: a name, so the scoreboard says who; a head start, so a beginner starts with a
longer snake; a speed handicap, so the stronger player moves slower. And SWAP SIDES on rematch, so the spawn
that turned out to be lucky changes hands.

None of it changes a rule. A head start is an initial length the simulation already accepts, a handicap is a
speed multiplier the SLOW effect already applies, and swapping sides is swapping two spawn points. The
defaults reproduce today's match exactly.

## In scope
Per-player name, head start and speed handicap on match setup; SWAP SIDES on match over; the scoreboard, HUD
pills and match-over copy using names; persistence of names only.

## Out of scope
Handicaps that change rules (extra lives, immunity), anything per-round, online anything.

## Tickets

### KI-13-01 · Initial conditions the simulation accepts
Owner: Sonnet · Size: M · Depends on: —
Files: `src/core/round.js`, `src/core/settings.js`, `tests/unit/core/round.test.js`, `tests/unit/core/__golden__/*`
Spec: `RoundSimulation` takes per-player `startLength` and `speedHandicap` in its options, defaulting to the
shipping values so every golden log is unchanged. A head start is extra segments placed behind the spawn head
along its heading; the handicap is a permanent multiplier composed with any SLOW/SPEED effect exactly as those
compose with each other today.
Acceptance criteria:
- [ ] AC1 With defaults, every golden log and replay fixture is byte-identical.
- [ ] AC2 A head start of N places exactly N extra segments, in bounds, never overlapping the other spawn.
- [ ] AC3 A 70 % handicap composes with SPEED and SLOW in the documented order; a test pins the resulting multipliers.
QA: unit.

### KI-13-02 · Match setup rows
Owner: Sonnet · Size: M · Depends on: KI-13-01
Files: `src/ui/screens/matchSetup.js`, `src/game/session.js`, `src/ui/styles.css`, tests, visual baseline
Spec: Per player: NAME (up to 10 characters, keyboard entry, defaults P1/P2), HEAD START 0–6, SPEED 100/85/70 %.
Names persist under a versioned localStorage key Sprint 13 can adopt (same discipline as I07's bindings);
handicaps do not persist. The controls card and the HUD pills use the name.
Acceptance criteria:
- [ ] AC1 A match started without touching the rows is identical to today's, asserted by event log.
- [ ] AC2 Names appear on the HUD pills, the scoreboard and the match-over screen; an e2e test reads them.
- [ ] AC3 Corrupt or absent stored names fall back to P1/P2 silently.
- [ ] AC4 One regenerated baseline.
QA: unit + e2e + visual.

### KI-13-03 · Swap sides
Owner: Sonnet · Size: S · Depends on: KI-13-02
Files: `src/ui/screens/matchOver.js`, `src/game/session.js`, `src/game/gameStateMachine.js`, tests
Spec: MATCH_OVER gains SWAP SIDES & REMATCH beside REMATCH: spawn points and controls exchange, colours and
names stay with their player, score resets. If the state machine needs a row, the generated table test covers it.
Acceptance criteria:
- [ ] AC1 After a swap, player one spawns where player two did and is steered by the arrow keys; asserted through the real flow.
- [ ] AC2 Colours and names do not move.
QA: e2e.

## QA plan
Unit for the simulation options, e2e through the real screens, agent harness playing a handicapped match to
confirm the invariants hold with a length-9 spawn.

## References
- `DESIGN-DECISIONS §1` row 28, `§2.3` (spawns), `§2.7` (colours); I07 (persistence key discipline); Sprint 13

## Risks
- **Golden drift.** KI-13-01 AC1 is the guard; defaults must be exactly the shipping values.
- **A head start that overlaps a spawn.** Six segments from (5,12) heading right reach back to x = −1; the placement must clamp or wrap and the test must cover the longest case.
- **Owner veto.** Row 28 is vetoable; KI-13-01 stands alone as a simulation option either way.

## Exit criteria
- [ ] A parent and a child can name themselves, even the match, and swap sides, from the screens.
- [ ] Every golden log unchanged.
