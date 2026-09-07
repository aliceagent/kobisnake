# Improvement 15 — Colour vision and motion

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1 · **Prerequisite:** I02 (the contrast rule exists)
**Origin:** #152 (player pairs need a colour-vision check), #157 (match-setup apple), GDD "never rely on colour alone"

## Goal
Make the game playable by the roughly one in twelve boys who cannot tell some of its colours apart, and
comfortable for anyone who finds screen shake and pulses unpleasant. Sprint 11's accessibility pass covers
focus and screen readers; Sprint 16 covers axe. Neither covers *which colours a player can see*, and the
palette check I02 shipped measures brightness, which is the wrong instrument for that.

## In scope
The CIEDE2000-with-simulated-deficiency check from #152, applied to player pairs and to apple/power-up
against players; a colour-safe assignment on match setup; honouring `prefers-reduced-motion`; the one apple
on the match-setup preview.

## Out of scope
Repainting the catalogue (the design lead's, if the numbers demand it), screen-reader work (Sprint 11).

## Tickets

### KI-15-01 · The colour-vision check (#152)
Owner: Opus · Size: M · Depends on: —
Files: `src/render/colourVision.js`, `tests/unit/render/colourVision.test.js`, `tests/unit/render/materials.test.js`, `docs/design/DESIGN-DECISIONS.md`
Spec: As #152 specifies: CIEDE2000 between two colours under normal vision, protanopia and deuteranopia;
all 28 player pairs plus apple-vs-player and each pedestal-vs-player measured; a threshold proposed with the
matrix, ruled on, then asserted. Player pairs come *out* of the luminance rule at the same time (the #121
ruling), and the nine waivers go with them; #156 closes as a consequence.
Acceptance criteria:
- [ ] AC1 The 28×3 matrix committed; the threshold ruled and asserted; the test shown able to go red.
- [ ] AC2 The luminance rule no longer includes player-vs-player pairs; `assertContrastRule`'s "waivers are exactly the failing set" still holds.
- [ ] AC3 Adding a ninth colour without an entry fails.
QA: unit.

### KI-15-02 · Colour-safe pairing on match setup
Owner: Sonnet · Size: M · Depends on: KI-15-01
Files: `src/ui/screens/matchSetup.js`, `src/game/session.js`, `src/ui/styles.css`, tests, visual baseline
Spec: When the two chosen colours fail KI-15-01's check, the setup screen says so in words next to the
colour row — "these two look alike to some players" — and offers the nearest passing alternative for the
second player. Never blocks starting; informs. The apple appears once on the miniature arena (#157 ruling).
Acceptance criteria:
- [ ] AC1 Choosing a failing pair shows the note; a passing pair does not; asserted in e2e.
- [ ] AC2 The apple is on the preview at its fixed cell; baseline regenerated.
QA: e2e + visual.

### KI-15-03 · Reduced motion
Owner: Sonnet · Size: S · Depends on: —
Files: `src/render/renderer.js`, `src/game/session.js`, `src/ui/styles.css`, tests
Spec: `prefers-reduced-motion: reduce` disables camera shake, the laser-warning zoom pulse and the crash
slow-mo *visual* (the simulation beat stays; only the camera stops moving), and CSS transitions on menus.
The existing `?reducedFx=1` becomes one way to force it; the media query becomes the other.
Acceptance criteria:
- [ ] AC1 With the media query emulated, a crash produces no camera displacement; asserted numerically through the renderer.
- [ ] AC2 Visual baselines, which already run under `?reducedFx=1`, are unchanged.
QA: unit + e2e.

## QA plan
Unit for the metric, e2e with emulated media and forced colour choices, one design-lead check of the
simulated-deficiency renders of the shipping pair.

## References
- #152, #157, #121 ruling; `DESIGN-DECISIONS §1` rows 20 and 26; GDD "never rely on colour alone"

## Risks
- **Simulating deficiency wrongly.** Use the published Brettel/Viénot matrices and cite them; test the simulator against known confusion pairs before trusting a single result.
- **The catalogue failing hard.** If a promised colour cannot be paired with anything, the design lead repaints it; the ticket reports, it does not decide.

## Exit criteria
- [ ] Player colours are checked by an instrument that models colour blindness, and the palette's failures are known and ruled on.
- [ ] Two players who chose look-alike colours are told before the countdown.
- [ ] Reduced motion is honoured from the system setting.
