# Improvement 07 — Controls: rebinding, gamepads, and turn feel

**Lead:** Sonnet · **Agents:** Opus ×0.5 (review), Sonnet ×2 · **Prerequisite:** none
**Origin:** gap audit; KS-07-06's latency measurement

## Goal
Let two people sit at one keyboard comfortably, and let a player who cannot use WASD play at all. The keys are
hard-coded: player one is WASD, player two is the arrows, and that is the entire input story. On a compact
laptop keyboard two people fighting over one board is cramped; on a non-QWERTY layout WASD is not even in the
right place; and a player who needs one hand has no route in.

Also settle the one number KS-07-06 left open. Keydown-to-queued is **0 ms** and render is **1 ms** — none of
the latency is our code, all of it is the 167 ms wait for the next grid step. If the game ever feels
unresponsive, the lever is `snakeSpeed` or `inputBufferSize`, and this sprint gives the design lead the
evidence to choose.

## In scope
A key-binding model with persistence, a rebinding screen, optional gamepad support, and a measured look at the
input buffer.

## Out of scope
Touch and mobile (the GDD is desktop-only). Online play. The HUD restyle (Sprint 11) — this sprint adds a
screen that Sprint 11 will then dress.

## Tickets

### KI-07-01 · Bindings as data
Owner: Sonnet · Size: M · Depends on: —
Files: `src/game/input.js`, `src/game/bindings.js`, `tests/unit/game/bindings.test.js`, `tests/unit/game/input.test.js`
Spec: Lift the hard-coded key codes into a binding table: per player, four directions, plus the global keys.
`input.js` reads the table instead of a literal. Default table is exactly today's WASD/arrows, so nothing
observable changes until somebody rebinds. Validation rejects a table that binds one code to two actions or
leaves an action unbound.
Acceptance criteria:
- [ ] AC1 The default table reproduces today's behaviour and every existing input test passes untouched.
- [ ] AC2 A conflicting or incomplete table is rejected with a named error.
- [ ] AC3 `KeyboardEvent.code` is used throughout, so a Dvorak or AZERTY player gets physical-key behaviour rather than letter behaviour — stated in the module comment.
QA: unit.

### KI-07-02 · The rebinding screen
Owner: Sonnet · Size: M · Depends on: KI-07-01
Files: `src/ui/screens/controls.js`, `src/ui/ui.js`, `src/game/gameStateMachine.js`, `src/ui/styles.css`, tests, visual baseline
Spec: A CONTROLS screen reachable from the main menu: shows both players' bindings, "press a key" capture,
conflict warning, and RESET TO DEFAULTS. Focus model as the other screens use. `needs-design-review`.
Acceptance criteria:
- [ ] AC1 Rebinding a direction changes it in play; an e2e test rebinds and then steers with the new key.
- [ ] AC2 Binding a key already used shows the conflict and refuses the change.
- [ ] AC3 RESET TO DEFAULTS restores exactly the shipping table.
- [ ] AC4 New state-machine rows covered by the generated table test.
QA: unit + e2e + visual.

### KI-07-03 · Persistence
Owner: Sonnet · Size: S · Depends on: KI-07-02
Files: `src/game/bindings.js`, `tests/unit/game/bindings.test.js`, `tests/e2e/controls.spec.js`
Spec: Bindings survive a reload via `localStorage`, behind a versioned key with a migration path — Sprint 13
owns the full save schema, so this stores under a key that sprint can adopt rather than inventing a rival
scheme. Unavailable or corrupt storage falls back to defaults silently; the game must never fail to start
because a binding could not be read.
Acceptance criteria:
- [ ] AC1 Rebind, reload, the binding is still there.
- [ ] AC2 Corrupt or absent storage starts on the defaults with no error visible to the player.
- [ ] AC3 The key name and version are documented for Sprint 13 to inherit.
QA: unit + e2e.

### KI-07-04 · Gamepads
Owner: Sonnet · Size: M · Depends on: KI-07-01
Files: `src/game/gamepad.js`, `src/game/session.js`, tests
Spec: Optional: if a gamepad is connected, its d-pad and left stick drive a player. Polled in the frame loop
through the same queue as the keyboard, so the simulation cannot tell the difference and determinism is
untouched. No gamepad, no cost.
Acceptance criteria:
- [ ] AC1 A fabricated gamepad in a test steers a player through the same input path as the keyboard.
- [ ] AC2 With no gamepad connected, no polling cost is added to a frame; asserted.
- [ ] AC3 Two gamepads drive two players independently.
QA: unit + e2e.

### KI-07-05 · What the input buffer should be
Owner: Sonnet-QA · Size: S · Depends on: I03
Files: `docs/qa/playtests/input-feel.md`
Spec: Sweep `inputBufferSize` (and, separately, `snakeSpeed`) through `withOverrides()` and report how often a
queued turn is dropped, how often two quick turns both land, and how often a turn arrives too late to matter.
Evidence for the design lead; no settings change in this ticket.
Acceptance criteria:
- [ ] AC1 A committed document with seeds and command, covering at least three buffer sizes.
- [ ] AC2 It states what only a human can answer, and hands that to Gate 1.
QA: agent.

## QA plan
Unit for the table, e2e for the screen and for steering with a rebound key, agent for the buffer sweep. The
zero-network check must stay green: nothing here fetches anything.

## References
- KS-07-06 / PR #116 (latency: overhead 0 ms, render 1 ms, the rest is the grid step)
- `DESIGN-DECISIONS §2.2` (queued directions, no reversal), `§4` (`inputBufferSize`)
- `ARCHITECTURE §6` (input), Sprint 13 (save schema this must not fight)

## Risks
- **Colliding with Sprint 13's save schema.** Mitigated by versioning the key and documenting it for adoption rather than inventing a parallel store.
- **Gamepad flakiness in CI.** The gamepad is fabricated in tests; no real hardware is ever required.
- **Determinism.** Every input path must end in the same queue. A gamepad that bypasses it would break replays; AC1 exists to prevent that.

## Exit criteria
- [ ] Bindings are data, default to today's keys, and survive a reload.
- [ ] A player can rebind both players' keys from a screen and play with them.
- [ ] A measured buffer document exists for the tuning decision.
