# Sprint 14 — Shop & Cosmetics

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-13-done` and `sprint-10-done`

## Goal
The second half of GDD Phase 7: a 3D shop room built from the arena's brick language, eight snakes on pedestals,
mouse and keyboard navigation with a rail camera, BUY / TRY / OWNED / LOCKED states, six unlockable colours, and
colour selection for either player. TRY launches practice (Sprint 15 supplies the full practice mode; this
sprint wires the entry point to a minimal untimed round so the flow is testable).

## In scope
Shop scene, pedestals and posed snakes, pointer picking, shop overlay, purchase flow, catalogue, selection rules.

## Out of scope
Practice mode proper (S15), cosmetics beyond colours (post-1.0).

## Tickets

### KS-14-01 · Shop scene: room, pedestals, rail camera, picking
Owner: Opus · Size: L · Depends on: —
Files: `src/render/shopScene.js`, `src/render/brickGeometry.js`, `src/render/snakeView.js` (posed mode)
Spec: Per `DESIGN-DECISIONS §1 row 14` and `§3 "Shop interior"`: a bright brick showroom (walls, glossy floor,
block shelves, display lighting via emissive panels; still one shadow light), eight pedestals in a shallow arc
each with a coiled 8-segment idle snake in its colour (`snakeView` in "posed" mode: breathing, blinking). Rail
camera: `focusIndex` 0..7; camera glides (0.4 s ease) to face the focused pedestal; ←/→ change focus; mouse hover
over a pedestal (raycast against hit boxes) moves focus; click confirms (same as Enter). Locked snakes render in
translucent grey plastic with a padlock brick above; owned in full colour; focused pedestal has a light ring.
Acceptance criteria:
- [ ] AC1 Hover changes focus within one frame; the camera reaches the target pose in 0.4 s ± 1 frame.
- [ ] AC2 Keyboard-only and mouse-only users can reach all eight pedestals and confirm.
- [ ] AC3 Shop scene ≤ 60 draw calls, p95 frame time ≤ 16.6 ms.
- [ ] AC4 Fable approves against the image-16 prompt and `01-master-visual.png` materials.
QA: e2e + visual + perf.

### KS-14-02 · Catalogue, overlay and purchase flow
Owner: Sonnet · Size: M · Depends on: KS-14-01
Files: `src/shop/shop.js`, `src/ui/screens/shopOverlay.js`, `tests/unit/shop/shop.test.js`
Spec: Catalogue from `SETTINGS.shopPrices` + colour names. Overlay: key counter top-right (key icon + count),
focused-pedestal panel with name, price or OWNED, BUY (disabled + reason when unaffordable/owned), TRY, and for
owned colours SELECT FOR P1 / SELECT FOR P2 (applies the swap rule). Purchase: confirm dialog "Buy GREEN for 2
keys?" → deduct, add to owned, save, pedestal flash + purchase SFX. Esc → main menu. SHOP menu item enabled.
Acceptance criteria:
- [ ] AC1 Cannot buy with insufficient keys; cannot buy twice; state persists after reload.
- [ ] AC2 Selecting for P1 a colour P2 holds swaps them and persists.
- [ ] AC3 Fable approves panel text and layout.
QA: unit + e2e `tests/e2e/shop.spec.js`.

### KS-14-03 · TRY entry point
Owner: Sonnet · Size: S · Depends on: KS-14-02
Files: `src/game/session.js`, `src/game/gameStateMachine.js`, `src/modes/practice.js` (minimal)
Spec: TRY → `session.startPractice({ color, returnTo: 'SHOP', focusIndex })`: an untimed single-snake round with
the tried colour, both key sets steering, apples on, no lasers, no rewards; Esc returns to the shop with focus
on the same pedestal. Sprint 15 extends this file into the full practice mode.
Acceptance criteria:
- [ ] AC1 TRY on a locked colour is allowed and awards nothing (save unchanged after the try).
- [ ] AC2 Esc returns to the shop with the same pedestal focused.
QA: e2e.

### KS-14-04 · Shop suite and adversarial pass
Owner: Sonnet-QA + Opus · Size: M · Depends on: KS-14-03
Files: `tests/e2e/shop.spec.js`, `tests/visual/shop.visual.spec.js`, `tests/perf/shop.perf.spec.js`
Spec: Full economy loop e2e (win Bo5 → 2 keys → buy Green → select for P1 → start match → P1 is green in the
arena). Adversary: buy during the flash; spam ←/→; resize the shop; hover while the camera is gliding.
Acceptance criteria:
- [ ] AC1 Economy loop green; visual baselines approved; perf recorded.
QA: —

## QA plan (sprint pass)
1. Fable: fidelity of the shop room and overlay (prompt 16).
2. Human: S1, S2 from `PLAYTEST-SCRIPT §9`.

## References
- GDD §4 "Keys", "Shop", "Try-before-you-buy", §5 "What keys buy", "Shop", "Try before you buy"
- `DESIGN-DECISIONS §1 rows 12–15, §3 "Shop interior"`

## Exit criteria
- [ ] Economy loop green; fidelity approved; tag `sprint-14-done`.
