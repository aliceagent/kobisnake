# Improvement 04 — Round pacing and the laser climax

**Lead:** Fable · **Agents:** Fable (decision), Sonnet-QA ×1 · **Prerequisite:** I03 (KI-03-02, KI-03-04)
**Origin:** `docs/qa/reports/2026-09-07-agent-qa-pass.md` finding **F3**

## Goal
Make the arena actually close during a normal round. On the shipping numbers only **4 of 27** measured rounds
lasted long enough to see the 0:30 warning, and the median round was **16 seconds**. Four sprints built the
lasers, the GDD calls them the climax, and five rounds in six end before they appear.

This sprint measures the shape of a round properly, then proposes one tuning change with evidence behind it.
It is the design lead's ticket, not an engineering one: nothing is changed in `settings.js` without a
`tuning-proposal` PR and a stated reason.

## In scope
Measurement of round length and laser reach across policies and settings; a written recommendation; one
tuning proposal if the evidence supports it; regenerated goldens and matrices if it lands.

## Out of scope
Changing laser behaviour or the arena's geometry. This is about *when* things happen, not what they do.
Whether the game is fun stays with Gate 1 and the humans.

## The question, stated so it can be answered
> On the shipping numbers, what fraction of rounds reach the laser warning, and which single number moves that
> fraction most without making a round drag?

The candidate levers, all already in `settings.js`:

| Lever | Shipping | Effect if changed |
|---|---|---|
| `laserStartTime` | 0:30 | Earlier lasers reach more rounds, but shorten the open-board phase |
| `roundDuration` | 90 s | A shorter round makes the closing phase a larger share of it |
| `snakeSpeed` | 6 cells/s | Faster play fills the board sooner; also changes input feel (see I07) |
| `foodCount` | 4 | Fewer apples means slower growth and longer rounds |

## Tickets

### KI-04-01 · Measure the shape of a round
Owner: Sonnet-QA · Size: M · Depends on: KI-03-02, KI-03-04
Files: `tests/agent/pacing.js`, `docs/qa/playtests/round-pacing.md`
Spec: Across all three policies and at least 300 seeded rounds per arm, report: the distribution of round
length, the fraction reaching `laserStartTime`, the fraction reaching each laser inset, the fraction ending by
timeout, the draw rate, and how long a whole match takes wall-clock including countdown and scoreboard. Sweep
`laserStartTime` at 20/25/30 s and `roundDuration` at 60/75/90 s through `withOverrides()` — **never** by
editing `settings.js`.
Acceptance criteria:
- [ ] AC1 A committed document with its command and seeds, reproducible on re-run.
- [ ] AC2 Every cell reports "reached the warning" and "reached inset ≥ 3", because those are the two moments the climax exists.
- [ ] AC3 The document states plainly that bots die more cheaply than people and that these are directional numbers.
QA: agent.

### KI-04-02 · The recommendation
Owner: Fable · Size: S · Depends on: KI-04-01
Files: `docs/design/DESIGN-DECISIONS.md` (proposal only), the tracking issue
Spec: Read the matrix, name the single change with the best ratio of climax-reached to round-drag, and write
the argument for it — including the argument against. If the evidence does not support a change, say so and
close the sprint; "the numbers did not justify it" is a valid outcome and a cheap one.
Acceptance criteria:
- [ ] AC1 A written recommendation naming one lever and one value, with the measured before/after.
- [ ] AC2 The human-session question this cannot answer is stated for Gate 1.
QA: manual.

### KI-04-03 · Land the change
Owner: Sonnet · Size: M · Depends on: KI-04-02
Files: `src/core/settings.js`, `tests/unit/core/__golden__/*`, `tests/sim/replays/*`, `docs/qa/playtests/gate1-bot-matrix.md`, visual baselines
Spec: Only if KI-04-02 recommends one. One `tuning-proposal` PR: the value, the regenerated goldens, the
regenerated matrix (its `baseline` row *is* the shipping defaults, so it fails the moment `settings.js`
changes — that is correct behaviour), and the affected baselines, each deleted before re-recording.
Acceptance criteria:
- [ ] AC1 Exactly one settings value changes, labelled `tuning-proposal`, approved by the design lead.
- [ ] AC2 Every golden log and replay fixture regenerated, with the tick-level differences explained rather than waved through.
- [ ] AC3 `gate1-bot-matrix.md` regenerated in the same PR.
QA: unit + sim + visual.

## QA plan
The agent harness is the instrument. The proof the change did what it claimed is the same measurement re-run
after it lands, in the same document.

## References
- `docs/qa/reports/2026-09-07-agent-qa-pass.md` §3 F3 (the 4-of-27 measurement)
- `docs/qa/playtests/gate1-bot-matrix.md` (75–79 % end before 0:30)
- `DESIGN-DECISIONS §1` rows 3 and 4, `§4` SETTINGS; `PLAYTEST-SCRIPT §5`

## Risks
- **Tuning to bots.** They are not players. Every number here is directional and the sprint says so in its own document; the final call belongs to Gate 1.
- **Golden churn.** Any settings change moves every golden log. Budgeted in KI-04-03 rather than discovered.
- **Fixing the symptom.** If rounds are short because a greedy bot suicides, the answer may be better bots, not different numbers. KI-04-01 reports per policy precisely so this is visible.

## Exit criteria
- [ ] A reproducible pacing document across three policies and two swept levers.
- [ ] A written recommendation, taken or explicitly declined.
- [ ] If taken: one tuning-proposal PR, goldens and matrix regenerated together.
