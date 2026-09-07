# Improvement 02 — Readability: apples, snakes and the floor

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×1 · **Prerequisite:** none
**Origin:** `docs/qa/reports/2026-09-07-agent-qa-pass.md` finding **F2**

## Goal
Make the thing the whole game is about — an apple — unmistakable at gameplay scale, and stop it sharing a
colour with a player. Today an apple is a small dark-red sphere on a two-tone green floor, materially harder
to see than the SPEED pedestal beside it, and the same hue as player one's snake.

The project already fixed exactly this defect once: #105 turned the white-on-white SLOW pedestal mid ice-blue
and, more importantly, KS-07-07 landed a **tested** WCAG relative-luminance rule so it cannot regress. That
rule covers a pedestal and its icon. It covers neither apple-to-floor nor apple-to-player, and Sprint 14 is
about to add six more unlockable player colours, any of which could collide.

## In scope
`materials.js` colour values, the apple's size and shading, and a contrast rule extended into a test that
covers every pair the player has to tell apart.

## Out of scope
The apple *model* and the arena art (Sprint 09), snake geometry and eyes (Sprint 08), VFX (Sprint 10). This
sprint sets the legibility constraint those sprints must then satisfy, and proves it with a test they inherit.

## Tickets

### KI-02-01 · A contrast rule that covers every pair
Owner: Sonnet · Size: M · Depends on: —
Files: `src/render/materials.js`, `tests/unit/render/materials.test.js`
Spec: Generalise KS-07-07's luminance assertion into a rule over the whole palette. For every pair a player
must distinguish at a glance — apple vs floor (both checker shades), apple vs each of the eight player
colours, player 1 vs player 2, each power-up pedestal vs floor, and each icon vs its own pedestal — assert a
minimum WCAG relative-luminance separation, using the same linearised-sRGB helper KS-07-07 introduced rather
than a second copy of it. The threshold is the one KS-07-07 already meets, stated once as a named constant.
Acceptance criteria:
- [ ] AC1 A table-driven test enumerates every required pair and asserts the separation; adding a colour to `COLORS` without a pair entry fails the test rather than passing silently.
- [ ] AC2 The test is proved able to go red: reverting the apple to today's value fails it, and the PR shows that output.
- [ ] AC3 No hex outside `materials.js`; `src/core/settings.js` untouched.
QA: unit.

### KI-02-02 · Make the apple read
Owner: Sonnet · Size: M · Depends on: KI-02-01
Files: `src/render/materials.js`, `src/render/pickupView.js` (or wherever the apple mesh is built), `tests/visual/__baselines__/*`
Spec: Whatever KI-02-01's rule demands — a lighter, more saturated apple, a rim or outline that separates it
from the floor, a slightly larger radius, or all three. The apple stays an apple: red-family, round, on the
floor plane. It must not become confusable with the SLOW pedestal or with a player. Delete each baseline
before re-recording it (`--update-snapshots` will not rewrite a PNG whose diff is under the ratio). Label the
PR `needs-design-review` with a before/after crop at gameplay scale, not zoomed.
Acceptance criteria:
- [ ] AC1 KI-02-01's test passes for apple-vs-both-floor-shades and apple-vs-all-eight-player-colours.
- [ ] AC2 Every affected visual baseline re-recorded; the PR names each one and why it changed.
- [ ] AC3 A frame captured at 1280×720 shows all four apples findable without zooming; the crop is in the PR.
QA: unit + visual, design review.

### KI-02-03 · The eight player colours are checked against each other
Owner: Sonnet · Size: S · Depends on: KI-02-01
Files: `src/render/materials.js`, `tests/unit/render/materials.test.js`, `docs/design/DESIGN-DECISIONS.md`
Spec: The GDD promises eight colours and Sprint 14 unlocks six of them. Verify every *pair* that can appear
in one match separates, not just the shipping red/blue, and record in `DESIGN-DECISIONS` that a new colour
must pass this test before it ships. If a promised colour fails, report it with numbers rather than quietly
adjusting it — the palette is the design lead's.
Acceptance criteria:
- [ ] AC1 All 28 unordered pairs of the eight colours are asserted, or the failing pairs are reported on the issue with their measured separation.
- [ ] AC2 `DESIGN-DECISIONS` states the rule for adding a colour.
QA: unit.

## QA plan
Unit for the rule, visual for the frames, and one pass of the I03 agent harness with the screenshots attached
so the design lead judges the apple at the size a player actually sees it.

## References
- `docs/qa/reports/2026-09-07-agent-qa-pass.md` §3 F2 and the captured frames
- #105 / PR #118 (KS-07-07): the luminance helper and the "prove the test can go red" pattern to copy
- `DESIGN-DECISIONS §1` row 20; GDD "never rely on colour alone"

## Risks
- **Drifting into art.** The apple's final model is Sprint 09's. Keep this to colour, contrast and scale, and hand Sprint 09 a test it must keep green.
- **Baseline churn.** Every gameplay baseline contains apples. Expect most of the fifteen to move; each one gets a sentence in the PR.

## Exit criteria
- [ ] One luminance rule, one helper, every required pair asserted.
- [ ] The apple passes at gameplay scale and the design lead has approved the crop.
- [ ] Adding a ninth colour without a contrast entry fails CI.
