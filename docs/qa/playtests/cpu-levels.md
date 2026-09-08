# CPU levels — measured

KI-12-03 · tracking issue [#217](https://github.com/aliceagent/kobisnake/issues/217) · sprint tracking issue
[#210](https://github.com/aliceagent/kobisnake/issues/210)

## Status: BLOCKED on #217

**AC1 is not met.** Two of the three orderings the ticket requires hold by a wide margin — NORMAL beats EASY,
HARD beats EASY — but **HARD does not beat NORMAL**: the measured gap is *negative* (NORMAL wins more often
than HARD does, head-to-head, seat-controlled). Per the ticket's own instruction ("do not tune the bots to hit
the numbers... if a level will not order itself, post BLOCKED and tell me the numbers"), `src/game/bots/
levels.js`'s `hard` policy has not been re-weighted to try to change this result. This document is the number,
and the investigation into why it comes out this way, for the design lead's decision — see "Why HARD does not
beat NORMAL" below.

## What actually ran

- **Command:** `KI_12_03_LEVELS_FULL=1 npx vitest run tests/sim/cpuLevels.test.js`
- **Date:** 2026-09-08. **Total:** 6 matchups × 1 000 rounds (500 per seat, both seats) = 6 000 rounds, ~60 s
  under this repository's always-on coverage instrumentation.
- `npm run test:unit`'s own (default, non-`FULL`) run of this file recomputes only the four matchups every
  assertion below needs (`normalVsEasy`, `hardVsNormal`, `hardVsEasy`, `easyVsIdle`) fresh on every push, ~56 s,
  and diffs them against this document's JSON block at the bottom (`tests/sim/cpuLevels.test.js`'s own module
  doc has the runtime accounting). `normalVsIdle` and `hardVsIdle` are informative-only rows recomputed only by
  the full command above.
- Every level plays under `src/game/bots/policy.js`'s `PLAY_RULES` (no `rules` passed at all — the CPU's own
  rules: dead-zone aware, contested cells excluded outright for NORMAL, no randomness), exactly what a real
  CPU opponent would play by. Nothing in `src/core/settings.js` was touched.
- **Seeds** are a pure function of `(lowIndex, highIndex, seatIndex)` — see `seedStartFor` in
  `tests/sim/cpuLevels.test.js` — where `lowIndex`/`highIndex` identify which two participants (`EASY=0`,
  `NORMAL=1`, `HARD=2`, `IDLE=3`, the last a local label for this file only, never one of the three approved
  level words) are matched, and `seatIndex` (0 or 1) is which side goes first. Every number below is exactly
  reproducible by re-running the command above. This range (`700 000+`) is distinct from every other
  `tests/sim` file's own seeds (`stats.test.js` 10 000-40 000, `laserStats.test.js` 110 000-130 000,
  `powerupStats.test.js` 210 000+, `tuningMatrix.test.js` 300 000+).

## Read this before the numbers

1. **Every matchup is measured in both seats and combined.** The two spawn positions are not symmetric
   (`DESIGN-DECISIONS §2.3`). A control of two copies of the *same* policy (survivor vs survivor, on this
   file's own seeds) showed **39.2 % vs 58.8 %** — a ~20-point gap from spawn position alone, nothing to do
   with skill. Every matchup below plays 500 rounds with each side as `p1`, then combines both halves, so a
   spawn advantage cannot be mistaken for a level advantage. This is why this document's numbers do not exactly
   match a naive one-seat run — they are the more defensible figure.
2. **"Loses" never counts a draw.** A round is `P1_WIN`, `P2_WIN` or `DRAW`. "X loses to Y" means the round
   resolves as Y's win specifically; a draw is neither a win nor a loss for either side. Used for "EASY loses
   to idle" below.
3. **The no-input human is `IDLE`: a bot that presses nothing, ever**, the sim equivalent of `tests/agent/
   policies/idle.js`. It walks straight out of its spawn heading until it dies, almost always to the wall,
   almost immediately — which is why every level beats it 100.0 % of the time. That is the expected, correct
   shape of this comparison, not a sign the test is vacuous: it is exactly why EASY's "loses to idle" rate
   comes in far under the ticket's 25 % ceiling.
4. **Neither `NORMAL` nor `HARD` intentionally eats.** `survivor` (`NORMAL`) ignores apples by design
   (`QA-STRATEGY §4`); `HARD` inherits that (module doc, `src/game/bots/levels.js`). Both hover near spawn
   length (mean final length ~7, against a spawn length of 4) for the whole round, growing only by passing over
   an apple incidentally. This matters directly for the finding below.

## Main matrix

**Margin:** every "beats" comparison is asserted at **≥ 20 percentage points** of `gapPct` (the higher level's
combined win % minus the lower's). Chosen from what was actually measured: the two orderings that hold clear
roughly 80 points, so 20 leaves wide headroom against seed noise while still being a real, decisive bar —
nowhere near a coin flip. It was not lowered to try to catch HARD vs NORMAL, whose measured gap is negative.

| Matchup | Rounds | Higher win% | Lower win% | Draw% | Gap (higher − lower) | ≥ 20pp? |
|---|---|---|---|---|---|---|
| NORMAL vs EASY | 1000 | NORMAL 90.4% | EASY 9.6% | 0.0% | +80.8pp | **Yes** |
| HARD vs NORMAL | 1000 | HARD 47.1% | NORMAL 50.6% | 2.3% | **−3.5pp** | **No** |
| HARD vs EASY (transitivity) | 1000 | HARD 90.2% | EASY 9.7% | 0.1% | +80.5pp | **Yes** |
| EASY vs idle | 1000 | EASY 100.0% | idle 0.0% | 0.0% | +100.0pp | Yes (not asserted at 20pp — see beginner check) |
| NORMAL vs idle | 1000 | NORMAL 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |
| HARD vs idle | 1000 | HARD 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |

**Beginner check (ticket spec):** EASY loses to an idle player 0.0 % of the time (1 000 rounds, both seats) —
comfortably under the ticket's "less than a quarter of the time" ceiling.

## Why HARD does not beat NORMAL

`hard` is `survivor`'s own safety and two-step lookahead, plus one addition: when — and only when —
`me.segments.length` is *strictly* greater than every living opponent's, it stops excluding a cell the
opponent's head could also reach next step (`survivor`'s `contestedCells` set) and instead prefers one there,
with a small added pull toward the opponent's head (`DESIGN-DECISIONS §1 row 8`: only a strictly-longer snake
wins a head-on outright, so only a strictly-longer snake should ever want one). Three checks confirm this is
implemented and doing something, and that its failure to beat NORMAL is a real property of the design rather
than dead code or a bug:

1. **The trigger fires often.** Across 500 HARD-vs-NORMAL rounds, HARD was strictly longer than NORMAL on
   28.6 % of its own decisions, and in 67 % of rounds (335/500) at least once. The mechanism is exercised
   throughout, not dormant.
2. **The head-on trade itself is a small net win for HARD.** In those same 500 rounds, HARD died to `HEAD_ON`
   18 times and NORMAL died to `HEAD_ON` 26 times — HARD wins more head-ons than it loses (+8 net). The
   ticket's specific mechanic works as designed, in isolation.
3. **But HARD dies to `LASER` far more often — 195 times against NORMAL's 129, a 66-death swing that dwarfs
   the head-on trade's +8.** An ablation with the steering pull toward the opponent removed (keep only "stop
   excluding a contested cell, add a bonus for choosing one," no distance term at all) still shows the same
   shape: HARD ≈ 44.5 %, NORMAL ≈ 52.1 % combined. The extra laser deaths are the dominant cost, and they
   persist whether or not the active steering term is present.

The likely mechanism: taking a contested cell over a defensively-optimal one costs a little of the two-step
free-space margin `survivor`'s own lookahead would otherwise have kept, on average, across the whole round.
Two similarly-cautious bots that both reach the laser's closing phase are frequently down to a coin-flip on
*who* gets cornered first by the shrinking arena; a level that has spent slightly more of the pre-laser game
on marginally riskier cells loses that coin-flip somewhat more often. Because `hard` never intentionally grows
(point 4 above), "strictly longer" is close to a 50/50 accident of incidental apple pickups rather than a
skill it can reliably create, so the head-on mechanic's real, positive contribution (+8 net head-ons) is not
large enough or frequent enough to offset that accumulated risk.

This reads as a genuine tension in the ticket's own spec: "survivor that *also* steers to force head-ons" asks
for survivor's caution *plus* an opportunistic aggression, but survivor's caution is exactly what keeps it from
ever being meaningfully longer than an equally apple-ignoring opponent, so the opportunity the aggression is
meant to exploit rarely arrives with enough weight to pay for its own cost. Options for the design lead, none
implemented here (that would be tuning to the number, which this ticket does not do):

- Give `HARD` a modest apple-seeking bias so a length edge over `NORMAL` is something it can build, not just
  an accident it occasionally inherits — a bigger behavioural change than "also steers to force head-ons," and
  arguably a different level altogether.
- Suppress the hunting branch once the laser phase is imminent (`WARNING`/`CLOSING`), so the aggression never
  spends down the exact safety margin the closing arena is about to test.
- Revisit whether AC1's "HARD beats NORMAL by a clear margin" is the right bar for this specific mechanic, or
  whether "does not lose to NORMAL by a clear margin" (i.e., roughly holds its own while still being a
  materially different, riskier play style) is what "harder" should mean here.

## Machine-readable data

The exact numbers tabulated above, as computed by `tests/sim/cpuLevels.test.js`'s own `beforeAll`. The
committed test recomputes every cell fresh on every `npm run test:unit` (no `FULL_RUN`-style subset — see that
file's module doc for why) and diffs it against this block, so a hand-edited number here that drifts from what
the code actually produces fails a test, and a code change that moves the numbers without this document being
regenerated also fails one.

```json
{
  "roundsPerMatchup": 1000,
  "matchups": [
    {
      "id": "normalVsEasy",
      "higher": "NORMAL",
      "lower": "EASY",
      "n": 1000,
      "higherWinPct": 90.4,
      "lowerWinPct": 9.6,
      "drawPct": 0,
      "gapPct": 80.8
    },
    {
      "id": "hardVsNormal",
      "higher": "HARD",
      "lower": "NORMAL",
      "n": 1000,
      "higherWinPct": 47.1,
      "lowerWinPct": 50.6,
      "drawPct": 2.3,
      "gapPct": -3.5
    },
    {
      "id": "hardVsEasy",
      "higher": "HARD",
      "lower": "EASY",
      "n": 1000,
      "higherWinPct": 90.2,
      "lowerWinPct": 9.7,
      "drawPct": 0.1,
      "gapPct": 80.5
    },
    {
      "id": "easyVsIdle",
      "higher": "EASY",
      "lower": "IDLE",
      "n": 1000,
      "higherWinPct": 100,
      "lowerWinPct": 0,
      "drawPct": 0,
      "gapPct": 100
    },
    {
      "id": "normalVsIdle",
      "higher": "NORMAL",
      "lower": "IDLE",
      "n": 1000,
      "higherWinPct": 100,
      "lowerWinPct": 0,
      "drawPct": 0,
      "gapPct": 100
    },
    {
      "id": "hardVsIdle",
      "higher": "HARD",
      "lower": "IDLE",
      "n": 1000,
      "higherWinPct": 100,
      "lowerWinPct": 0,
      "drawPct": 0,
      "gapPct": 100
    }
  ]
}
```
