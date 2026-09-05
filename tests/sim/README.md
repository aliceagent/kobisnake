# `tests/sim`

Headless whole-round and whole-match simulation tests (ARCHITECTURE §3, QA-STRATEGY §1 "Simulation" row). They
run on Vitest, exactly like `tests/unit`, and are picked up by the same `npm run test:unit` command
(`vitest.config.js` includes both `tests/unit/**/*.test.js` and `tests/sim/**/*.test.js`) — there is no separate
`RoundSimulation` or `MatchState` to test, so this directory holds only this README until then.

## What belongs here (from Sprint 02 onward)

- **Whole-round runs**: drive `RoundSimulation.advance(dt)` with scripted or bot input logs from countdown to
  `ROUND_OVER` and assert on the emitted event log, not on internal fields (ARCHITECTURE §4).
- **Whole-match runs**: `MatchState` across Best of 1/3/5, including draws and replays (DESIGN-DECISIONS §2.6).
- **Determinism checks**: same seed + same input log ⇒ identical event log (QA-STRATEGY §3).
- **Replays**: `tests/sim/replays/*.json` fixtures of the shape `{ seed, settings, inputs, expectedEvents }`,
  recorded from a real session that exposed a bug. Every bug fix adds one (QA-STRATEGY §3).
- **Bots**: `tests/sim/bots/` — `randomBot`, `greedyBot`, `survivorBot` (QA-STRATEGY §4), used to run hundreds of
  seeded rounds per pairing and report design-health statistics (draw rate, average survivor length, power-up
  pickup rate) that Fable reads at the Playtest Gates. These measure design health, not "does the bot play
  well".

## Naming

Every acceptance criterion gets a test named after it, exactly like `tests/unit`:
`it('KS-02-04 AC2: a head-on between equal-length snakes is a draw', ...)`.
