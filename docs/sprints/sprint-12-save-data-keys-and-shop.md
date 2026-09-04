# Sprint 12 — Save Data, Keys, Shop & Cosmetics

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `sprint-09-done` and `sprint-11-done`

## Goal
GDD Phase 7: persistent save data in localStorage, keys awarded to match winners with an award animation, a 3D
shop room with snakes on pedestals, mouse and keyboard navigation, BUY / TRY / OWNED / LOCKED states, six
unlockable colours, and selected colours persisting into match setup. TRY launches practice (S13 supplies the
practice mode; this sprint wires TRY to a "practice" entry point that S13 completes).

## In scope
`saveData.js` with migration, stats, settings persistence, key economy, match-over key animation, shop scene,
shop overlay, purchase flow, colour ownership rules.

## Out of scope
Practice mode itself (S13), cosmetics beyond colours.

## Tickets

### KS-12-01 · Save data module
Owner: Sonnet · Size: M · Depends on: —
Files: `src/save/saveData.js`, `tests/unit/save/saveData.test.js`
Spec: Per `DESIGN-DECISIONS §2.9` and the GDD object: `{ schemaVersion: 1, keys, ownedColors, selectedPlayer1Color,
selectedPlayer2Color, settings: { musicEnabled, soundEnabled, selectedMusicTrack }, tutorialCompleted, stats: {
matchesPlayed, player1Wins, player2Wins } }`. `load()` validates every field's type and range (colours must be
catalogue keys; owned always includes red and blue; selected colours must be owned and different) and repairs
to defaults field by field. `save(partial)` merges and writes. `reset()`. Migrations table keyed by
`schemaVersion`. Handles `localStorage` throwing (private mode) by falling back to in-memory.
Acceptance criteria:
- [ ] AC1 Corrupt JSON, wrong types, unknown colour, same colour for both players → repaired defaults; no throw.
- [ ] AC2 A v0 object (no `schemaVersion`, `unlockedColors` key) migrates to v1 with `ownedColors`.
- [ ] AC3 `localStorage` throwing → module still works in memory and logs once.
- [ ] AC4 No other file calls `localStorage` (grep test).
QA: unit.

### KS-12-02 · Keys economy and match-over award animation
Owner: Sonnet · Size: M · Depends on: KS-12-01
Files: `src/game/session.js`, `src/ui/screens/matchOver.js`, `src/render/effects/keyAward.js`
Spec: On MATCH_OVER entry: `stats` updated, `keys += rewards[bestOf]`, saved immediately (before the animation).
Animation: N toy keys (yellow brick key model built from `brickGeometry`) drop from above the winner snake,
bounce, and fly to the HUD key counter while the counter ticks up with the key-reward SFX. Bo1 shows "NO KEYS
FOR BEST OF 1 — PLAY BEST OF 3 OR 5 TO EARN KEYS" small text. Practice/tutorial never award.
Acceptance criteria:
- [ ] AC1 Reloading the page immediately after MATCH_OVER shows the incremented key count.
- [ ] AC2 Only the winner's reward is applied (no keys for the loser; assert via save contents).
- [ ] AC3 Animation is skipped (counter jumps) under `?reducedFx=1`.
QA: e2e.

### KS-12-03 · Shop scene (3D room, pedestals, rail camera, picking)
Owner: Opus · Size: L · Depends on: KS-07-03
Files: `src/render/shopScene.js`, `src/render/brickGeometry.js`
Spec: Per `DESIGN-DECISIONS §1 row 14` and `§3 "Shop interior"`: a bright brick showroom (walls, glossy floor,
block shelves, display lighting = spotlight-like emissive panels; still one shadow light), eight pedestals in a
shallow arc each with a coiled 8-segment idle snake in its colour (reuse `snakeView` in "posed" mode). Rail
camera: `focusIndex` 0..7; the camera glides (0.4 s ease) to a position facing the focused pedestal; ←/→ change
focus; mouse hover over a pedestal (raycast against pedestal hit boxes) moves focus; click confirms (same as
Enter). Locked snakes are rendered in a translucent grey plastic with a padlock brick above; owned in full
colour; the currently focused pedestal has a subtle light ring.
Acceptance criteria:
- [ ] AC1 Hover changes focus within one frame; the camera reaches the target pose in 0.4 s ± 1 frame.
- [ ] AC2 Keyboard-only and mouse-only users can reach all eight pedestals and confirm.
- [ ] AC3 Shop scene ≤ 60 draw calls, p95 frame time ≤ 16.6 ms.
- [ ] AC4 Fable approves against the image-16 prompt and `01-master-visual.png` materials.
QA: e2e + visual + perf.

### KS-12-04 · Shop overlay and purchase flow
Owner: Sonnet · Size: M · Depends on: KS-12-01, KS-12-03
Files: `src/shop/shop.js`, `src/ui/screens/shopOverlay.js`, `tests/unit/shop/shop.test.js`
Spec: Catalogue from `SETTINGS.shopPrices` + colour names. Overlay: key counter top-right (key icon + count),
focused-pedestal panel with name, price or OWNED, BUY (disabled + reason when unaffordable/owned), TRY, and for
owned colours SELECT FOR P1 / SELECT FOR P2 (which applies the swap rule). Purchase: confirm dialog "Buy GREEN
for 2 keys?" → deduct, add to owned, save, pedestal flash + purchase SFX. TRY → `session.startPractice({ color })`
(S13 implements the mode; until then it starts a practice round with the S02-era grey overlay). Esc → main menu.
Acceptance criteria:
- [ ] AC1 Cannot buy with insufficient keys; cannot buy twice; state persists after reload.
- [ ] AC2 Selecting for P1 a colour P2 holds swaps them and persists.
- [ ] AC3 TRY on a locked colour is allowed and awards nothing (save unchanged after the try).
- [ ] AC4 Fable approves panel text and layout.
QA: unit + e2e `tests/e2e/shop.spec.js`.

### KS-12-05 · Persisted settings and match-setup defaults
Owner: Sonnet · Size: S · Depends on: KS-12-01
Files: `src/ui/screens/settings.js`, `src/ui/screens/matchSetup.js`, `src/game/session.js`, `src/ui/screens/mainMenu.js`
Spec: Settings toggles and selected music track persist; match setup opens with the saved colours and track;
main-menu stats panel shows saved stats. SHOP and SETTINGS menu items become enabled.
Acceptance criteria:
- [ ] AC1 Toggle music off, reload → still off and the engine is muted from the first note.
- [ ] AC2 Stats panel increments after a match.
QA: e2e.

### KS-12-06 · Save/shop test suite and adversarial pass
Owner: Sonnet-QA + Opus · Size: M · Depends on: KS-12-04
Files: `tests/e2e/shop.spec.js`, `tests/e2e/persistence.spec.js`, `tests/unit/save/fuzz.test.js`
Spec: Fuzz `load()` with 5 000 random JSON shapes. E2e: full economy loop (win Bo5 → 2 keys → buy Green → select
for P1 → start match → P1 is green in the arena).
Acceptance criteria:
- [ ] AC1 Fuzz never throws; every output validates against the schema.
- [ ] AC2 Economy loop e2e green.
QA: —

## QA plan (sprint pass)
1. Fable: fidelity of the shop room and overlay (prompt 16), key animation, match-over screen.
2. Human: K1, S1, S2 from `PLAYTEST-SCRIPT §9`.
3. Adversary: two tabs open simultaneously (last write wins; no corruption); localStorage quota exhausted; buy
   during the flash animation; spam ←/→ in the shop.

## References
- GDD §4 "Persistent currency" … "Try-before-you-buy", §5 "Match rewards" … "Try before you buy", §7 "Suggested localStorage data"
- `DESIGN-DECISIONS §1 rows 12–15, §2.6, §2.7, §2.9, §3 "Shop interior"`

## Exit criteria
- [ ] Economy loop green; fidelity approved; tag `sprint-12-done`.
