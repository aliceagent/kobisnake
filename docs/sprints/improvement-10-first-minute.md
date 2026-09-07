# Improvement 10 — The first minute

**Lead:** Sonnet · **Agents:** Fable (copy and review), Sonnet ×1 · **Prerequisite:** none
**Origin:** `docs/qa/reports/2026-09-07-agent-qa-pass.md` finding **F6**

## Goal
Make the first sixty seconds explain themselves. Two children open the page and see a menu of six items, five
of which say COMING SOON. There is no statement of what the game is, no picture of the controls, and no clue
that this is a two-player game needing two people at one keyboard. The only working item is the second one.

Sprint 15 builds the seven-step tutorial. This sprint is the cheap part that should not wait for it: say what
the game is, show which keys move which snake, and stop the menu reading as a wall of locked doors.

## In scope
Main-menu presentation of unavailable items, a controls card on the match-setup screen, and a short
"how to play" panel. Copy is the design lead's; layout is Sprint 11's to restyle later.

## Out of scope
The tutorial (Sprint 15). Implementing any COMING SOON item — this sprint changes how they are *presented*,
never what they do. No new mechanic, no new option.

## Tickets

### KI-10-00 · The words
Owner: Fable · Size: S · Depends on: —
Files: `docs/design/DESIGN-DECISIONS.md` (§3 visual notes)
Spec: Write the copy before anything is built: the one-line description of the game, the controls card's
wording, the three or four lines of "how to play", and the phrasing for items that are not ready yet. Written
for an eleven-year-old — short words, no jargon, no exclamation marks doing the work of clarity.
Acceptance criteria:
- [ ] AC1 Every string this sprint displays is written down and approved before KI-10-01 opens.
- [ ] AC2 The one-line description says who plays (two people, one keyboard) and what they are trying to do.
QA: manual.

### KI-10-01 · A menu that reads as an invitation
Owner: Sonnet · Size: M · Depends on: KI-10-00
Files: `src/ui/screens/mainMenu.js`, `src/ui/styles.css`, tests, visual baseline
Spec: Present the one playable item as the clear primary action and group the unavailable ones so the screen
does not read as mostly locked. The unavailable items stay visible and stay unselectable — the GDD promises
them and hiding them would be a lie about the game's shape — but they stop competing with the thing a player
can do. Add the one-line description under the title. Nothing about focus order or the state machine changes
beyond what the layout needs. `needs-design-review`.
Acceptance criteria:
- [ ] AC1 Every previously unavailable item is still present and still unselectable; the existing focus test passes unchanged.
- [ ] AC2 The description line is on screen at 1280×720 without pushing any item off it.
- [ ] AC3 One regenerated baseline, deleted before re-recording.
QA: unit + e2e + visual.

### KI-10-02 · A controls card
Owner: Sonnet · Size: M · Depends on: KI-10-00
Files: `src/ui/screens/matchSetup.js`, `src/ui/styles.css`, tests, visual baseline
Spec: On the match-setup screen, show which keys drive which snake, coloured to match the two players, so the
answer to "which one am I?" is on screen at the moment it is asked. Read the bindings from the live table if
I07 has landed, otherwise from the defaults — and say in the PR which one it did.
Acceptance criteria:
- [ ] AC1 The card names both players' keys and is colour-matched to the snakes it describes.
- [ ] AC2 It does not rely on colour alone: each side is labelled in words too (GDD).
- [ ] AC3 One regenerated baseline.
QA: e2e + visual.

### KI-10-03 · How to play
Owner: Sonnet · Size: S · Depends on: KI-10-00
Files: `src/ui/screens/mainMenu.js` or a small panel, `src/ui/styles.css`, tests, visual baseline
Spec: Three or four lines reachable from the main menu: eat apples to grow, do not hit anything, the walls
close in at the end, last one alive wins the round. Text only — the illustrated version is Sprint 15's.
Acceptance criteria:
- [ ] AC1 Reachable from the main menu and dismissible with Esc.
- [ ] AC2 Adds no state-machine row that the generated table test does not cover.
- [ ] AC3 One baseline.
QA: e2e + visual.

## QA plan
E2e for reachability and focus, visual for the three screens, and a design review of the copy against the
reference images. The agent harness's screen walk should pass unchanged: none of this alters the flow.

## References
- `docs/qa/reports/2026-09-07-agent-qa-pass.md` §3 F6 and the captured main-menu frame
- `docs/reference/README.md` (the main menu follows the GDD, not the reference image — known discrepancy)
- `DESIGN-DECISIONS §1` row 16 (single player is post-1.0, menu shows COMING SOON until then)

## Risks
- **Implying something is coming sooner than it is.** COMING SOON stays honest; this sprint does not promise dates.
- **Colliding with Sprint 11.** That sprint restyles every screen. Keep changes structural and copy-level so a restyle inherits them cleanly.
- **Creeping into the tutorial.** Three or four lines of text. If it needs a diagram, it is Sprint 15's.

## Exit criteria
- [ ] A player who has never seen the game learns what it is and which keys are theirs, without being told.
- [ ] Unavailable items remain visible and honest, without dominating the screen.
- [ ] Copy approved by the design lead before it was built, not after.
