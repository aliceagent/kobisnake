# Sprint 13 — Save Data & Keys

**Lead:** Sonnet (Opus reviews) · **Agents:** Sonnet ×2, Sonnet-QA ×1, Opus ×0.5, Fable · **Prerequisite:** `sprint-10-done` and `sprint-12-done`

## Goal
The first half of GDD Phase 7: persistent save data in localStorage with validation and migration, keys
awarded to match winners with the award animation, settings and colour choices that survive a reload, and the
main-menu stats panel. This sprint makes progression real; Sprint 14 gives players something to spend keys on.

## In scope
`saveData.js`, stats, persisted settings, key economy, match-over key animation, persistence test suite.

## Out of scope
The shop scene and purchase flow (S14), practice mode (S15).

## Tickets

### KS-13-01 · Save data module
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

### KS-13-02 · Keys economy and match-over award animation
Owner: Sonnet · Size: M · Depends on: KS-13-01
Files: `src/game/session.js`, `src/ui/screens/matchOver.js`, `src/render/effects/keyAward.js`, `src/render/brickGeometry.js`
Spec: On MATCH_OVER entry: `stats` updated, `keys += rewards[bestOf]`, saved immediately (before the animation).
Animation: N toy keys (yellow brick key model built from `brickGeometry`) drop from above the winner snake,
bounce, and fly to a key counter in the match-over panel while the counter ticks up with the key-reward SFX.
Bo1 shows "NO KEYS FOR BEST OF 1 — PLAY BEST OF 3 OR 5 TO EARN KEYS" small text. Practice/tutorial never award.
Acceptance criteria:
- [ ] AC1 Reloading the page immediately after MATCH_OVER shows the incremented key count.
- [ ] AC2 Only the winner's reward is applied (assert via save contents).
- [ ] AC3 Animation is skipped (counter jumps) under `?reducedFx=1`.
- [ ] AC4 Fable approves the key model and animation timing.
QA: e2e.

### KS-13-03 · Persisted settings, colours and match-setup defaults
Owner: Sonnet · Size: S · Depends on: KS-13-01
Files: `src/ui/screens/settings.js`, `src/ui/screens/matchSetup.js`, `src/game/session.js`, `src/ui/screens/mainMenu.js`
Spec: Settings toggles and selected music track persist; match setup opens with the saved colours and track and
writes colour changes back; main-menu stats panel shows saved stats. SETTINGS menu item becomes enabled.
Acceptance criteria:
- [ ] AC1 Toggle music off, reload → still off and the engine is muted from the first note.
- [ ] AC2 Stats panel increments after a match; colours chosen in setup are restored after reload.
QA: e2e.

### KS-13-04 · Persistence suite and fuzz
Owner: Sonnet-QA + Opus · Size: M · Depends on: KS-13-03
Files: `tests/e2e/persistence.spec.js`, `tests/unit/save/fuzz.test.js`
Spec: Fuzz `load()` with 5 000 random JSON shapes. E2e: win Bo5 → 2 keys persisted → settings persisted → two tabs
open simultaneously (last write wins; no corruption) → quota-exhausted localStorage (mock) degrades gracefully.
Acceptance criteria:
- [ ] AC1 Fuzz never throws; every output validates against the schema.
- [ ] AC2 E2e scenarios green.
QA: —

## QA plan (sprint pass)
1. Fable: key animation and match-over screen fidelity.
2. Human: K1 from `PLAYTEST-SCRIPT §9` (keys feel earned).
3. Adversary: reload during the award animation; clear storage mid-match; private browsing window.

## References
- GDD §4 "Persistent currency", "Match rewards", §7 "Suggested localStorage data"
- `DESIGN-DECISIONS §2.6, §2.7, §2.9`

## Exit criteria
- [ ] Persistence suite green; K1 positive; tag `sprint-13-done`.
