# CPU levels — measured

KI-12-03 · tracking issue [#217](https://github.com/aliceagent/kobisnake/issues/217) · sprint tracking issue
[#210](https://github.com/aliceagent/kobisnake/issues/210)

## Status: BLOCKED on #217

**AC1 is still not met, on `HARD`'s second definition.** `HARD` was originally "survivor that steers into a
cell it would win a head-on over by length" (`DESIGN-DECISIONS §1 row 8`). Measured, that came out **3.5
points weaker** than NORMAL, not stronger — see "History: HARD v1" below. The design lead ruled on that
finding on #210 and redefined `HARD` as NORMAL's own rules plus eating an apple when it costs no reachable
room. Re-measured on the *same* seats, seeds and 20-point margin: **HARD (v2) now edges NORMAL by +3.1
points — a real, positive, seat-controlled improvement over v1's −3.5 — but still well short of the 20-point
margin AC1 requires.** Two of the three orderings hold by a wide margin regardless of which `HARD` is used
(NORMAL beats EASY, HARD beats EASY). Per the ruling's own explicit instruction, `hard`'s eating rule has not
been re-weighted or tuned to try to close the remaining 17-point gap — this document is the number, for the
design lead's decision between the ruling's own two options: accept a smaller margin for this specific
mechanic, or take the ruled fallback (ship EASY/NORMAL only, `HARD` stays defined but off the menu, row 27
records the measurement as the reason).

## What actually ran

- **Command:** `KI_12_03_LEVELS_FULL=1 npx vitest run tests/sim/cpuLevels.test.js`
- **Date:** 2026-09-08 (re-measured the same day, after the design lead's ruling on #210 redefined `HARD`).
  **Total:** 6 matchups × 1 000 rounds (500 per seat, both seats) = 6 000 rounds, ~63 s under this repository's
  always-on coverage instrumentation.
- `npm run test:unit`'s own (default, non-`FULL`) run of this file recomputes only the four matchups every
  assertion below needs (`normalVsEasy`, `hardVsNormal`, `hardVsEasy`, `easyVsIdle`) fresh on every push, ~56 s,
  and diffs them against this document's JSON block at the bottom (`tests/sim/cpuLevels.test.js`'s own module
  doc has the runtime accounting). `normalVsIdle` and `hardVsIdle` are informative-only rows recomputed only by
  the full command above.
- Every level plays under `src/game/bots/policy.js`'s `PLAY_RULES` (no `rules` passed at all — the CPU's own
  rules: dead-zone aware, contested cells excluded outright for NORMAL and HARD alike, no randomness), exactly
  what a real CPU opponent would play by. Nothing in `src/core/settings.js` was touched.
- **Seeds, the seat-swap methodology, and the 20-point margin are byte-for-byte unchanged from the first
  measurement** — the ruling was explicit that a re-measurement must use "the same measurement, same seats,
  same margin, same seed scheme" so the two `HARD` definitions are compared on identical footing, not on a
  friendlier test. See `seedStartFor` in `tests/sim/cpuLevels.test.js`: a pure function of `(lowIndex,
  highIndex, seatIndex)` where `lowIndex`/`highIndex` identify which two participants (`EASY=0`, `NORMAL=1`,
  `HARD=2`, `IDLE=3`, the last a local label for this file only, never one of the three approved level words)
  are matched, and `seatIndex` (0 or 1) is which side goes first. This range (`700 000+`) is distinct from
  every other `tests/sim` file's own seeds (`stats.test.js` 10 000-40 000, `laserStats.test.js` 110 000-130 000,
  `powerupStats.test.js` 210 000+, `tuningMatrix.test.js` 300 000+).

## Read this before the numbers

1. **Every matchup is measured in both seats and combined.** The two spawn positions are not symmetric
   (`DESIGN-DECISIONS §2.3`). A control of two copies of the *same* policy (survivor vs survivor, on this
   file's own seeds) showed **39.2 % vs 58.8 %** — a ~20-point gap from spawn position alone, nothing to do
   with skill. Every matchup below plays 500 rounds with each side as `p1`, then combines both halves, so a
   spawn advantage cannot be mistaken for a level advantage. This is why this document's numbers do not exactly
   match a naive one-seat run — they are the more defensible figure, and it is this control that made the v1
   measurement's −3.5 believable rather than dismissible as noise.
2. **"Loses" never counts a draw.** A round is `P1_WIN`, `P2_WIN` or `DRAW`. "X loses to Y" means the round
   resolves as Y's win specifically; a draw is neither a win nor a loss for either side. Used for "EASY loses
   to idle" below.
3. **The no-input human is `IDLE`: a bot that presses nothing, ever**, the sim equivalent of `tests/agent/
   policies/idle.js`. It walks straight out of its spawn heading until it dies, almost always to the wall,
   almost immediately — which is why every level beats it 100.0 % of the time. That is the expected, correct
   shape of this comparison, not a sign the test is vacuous: it is exactly why EASY's "loses to idle" rate
   comes in far under the ticket's 25 % ceiling.
4. **`NORMAL` still never eats; `HARD` (v2) now does, but only opportunistically.** `survivor` (`NORMAL`)
   ignores apples by design (`QA-STRATEGY §4`) and stays near spawn length all round. `HARD` (v2) takes an
   apple only when one of its already-safe candidate cells happens to sit on one *and* doing so costs no
   reachable room (`src/game/bots/levels.js`'s module doc) — it does not travel toward apples the way `greedy`
   does. This is why HARD's growth advantage over NORMAL, while real, is modest rather than dramatic: it eats
   only what falls in its path.

## Main matrix (current: HARD v2, safe eating)

**Margin:** every "beats" comparison is asserted at **≥ 20 percentage points** of `gapPct` (the higher level's
combined win % minus the lower's) — unchanged from the first measurement (see "What actually ran"). Chosen
from what was actually measured: the two orderings that hold clear roughly 80 points, so 20 leaves wide
headroom against seed noise while still being a real, decisive bar — nowhere near a coin flip. It was not
lowered to try to catch HARD vs NORMAL on either definition.

| Matchup | Rounds | Higher win% | Lower win% | Draw% | Gap (higher − lower) | ≥ 20pp? |
|---|---|---|---|---|---|---|
| NORMAL vs EASY | 1000 | NORMAL 90.4% | EASY 9.6% | 0.0% | +80.8pp | **Yes** |
| HARD vs NORMAL | 1000 | HARD 50.1% | NORMAL 47.0% | 2.9% | **+3.1pp** | **No** |
| HARD vs EASY (transitivity) | 1000 | HARD 90.5% | EASY 9.4% | 0.1% | +81.1pp | **Yes** |
| EASY vs idle | 1000 | EASY 100.0% | idle 0.0% | 0.0% | +100.0pp | Yes (not asserted at 20pp — see beginner check) |
| NORMAL vs idle | 1000 | NORMAL 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |
| HARD vs idle | 1000 | HARD 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |

**Beginner check (ticket spec):** EASY loses to an idle player 0.0 % of the time (1 000 rounds, both seats) —
comfortably under the ticket's "less than a quarter of the time" ceiling. Unaffected by which `HARD` is used.

## Why HARD (v2) still falls short of the margin

The redefinition worked in the *direction* the ruling predicted — HARD moved from losing to NORMAL (−3.5pp) to
beating it (+3.1pp), a 6.6-point swing purely from adding opportunistic eating with no change to survivor's
safety rules at all. It just does not move far enough to clear a 20-point bar. Two things about the mechanic's
own shape explain why the swing is modest rather than large:

1. **HARD only eats what is already on its path.** It never travels toward an apple (module doc: that would be
   `greedy`'s behaviour, not this ruling's). Whether an apple happens to sit on one of the up-to-three cells
   HARD was already about to consider is mostly luck of the board, so its growth advantage over NORMAL accrues
   slowly and unevenly across a round rather than reliably.
2. **A length edge only pays out at two moments** — a head-on (row 8) and a 0:00 timeout (`DESIGN-DECISIONS
   §2.5`) — and neither is guaranteed to occur before one side dies to something else first (a wall, itself, or
   the laser). A modest, opportunistic length edge is a real but narrow lever compared to the ~80-point gaps
   `greedy`'s active apple-seeking produces against either survival-only bot.

Both bots keep identical laser awareness and contested-cell exclusion, so — unlike v1 — there is no new
avoidable risk being introduced; the entire 6.6-point swing is pure upside from the length HARD now carries
into the moments that reward it. It is simply a smaller upside than the ticket's 20-point bar asks for.

## Machine-readable data (current — HARD v2, safe eating)

The exact numbers tabulated in "Main matrix (current)" above, as computed by `tests/sim/cpuLevels.test.js`'s
own `beforeAll`. The committed test recomputes every cell it needs fresh on every `npm run test:unit` and
diffs it against **this** block, so a hand-edited number here that drifts from what the code actually produces
fails a test, and a code change that moves the numbers without this document being regenerated also fails one.

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
      "higherWinPct": 50.1,
      "lowerWinPct": 47,
      "drawPct": 2.9,
      "gapPct": 3.1
    },
    {
      "id": "hardVsEasy",
      "higher": "HARD",
      "lower": "EASY",
      "n": 1000,
      "higherWinPct": 90.5,
      "lowerWinPct": 9.4,
      "drawPct": 0.1,
      "gapPct": 81.1
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

## History: HARD v1 (steered into head-ons) — superseded, kept for the record

This is the original measurement, from `HARD`'s first definition ("survivor that also steers to force
head-ons it will win by length"), left here unedited because it is the finding the design lead's ruling on
#210 was based on — the reason the definition changed, not a draft to overwrite.

### Main matrix (v1)

| Matchup | Rounds | Higher win% | Lower win% | Draw% | Gap (higher − lower) | ≥ 20pp? |
|---|---|---|---|---|---|---|
| NORMAL vs EASY | 1000 | NORMAL 90.4% | EASY 9.6% | 0.0% | +80.8pp | **Yes** |
| HARD (v1) vs NORMAL | 1000 | HARD 47.1% | NORMAL 50.6% | 2.3% | **−3.5pp** | **No** |
| HARD (v1) vs EASY (transitivity) | 1000 | HARD 90.2% | EASY 9.7% | 0.1% | +80.5pp | **Yes** |
| EASY vs idle | 1000 | EASY 100.0% | idle 0.0% | 0.0% | +100.0pp | Yes |
| NORMAL vs idle | 1000 | NORMAL 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |
| HARD (v1) vs idle | 1000 | HARD 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |

### Why HARD (v1) did not beat NORMAL

`hard` (v1) was `survivor`'s own safety and two-step lookahead, plus one addition: when — and only when —
`me.segments.length` was *strictly* greater than every living opponent's, it stopped excluding a cell the
opponent's head could also reach next step (`survivor`'s `contestedCells` set) and instead preferred one
there, with a small added pull toward the opponent's head. Three checks confirmed this was implemented and
doing something, and that its failure to beat NORMAL was a real property of the design rather than dead code
or a bug:

1. **The trigger fired often.** Across 500 HARD-vs-NORMAL rounds, HARD was strictly longer than NORMAL on
   28.6 % of its own decisions, and in 67 % of rounds (335/500) at least once. The mechanism was exercised
   throughout, not dormant.
2. **The head-on trade itself was a small net win for HARD.** In those same 500 rounds, HARD died to `HEAD_ON`
   18 times and NORMAL died to `HEAD_ON` 26 times — HARD won more head-ons than it lost (+8 net). The ticket's
   specific mechanic worked as designed, in isolation.
3. **But HARD died to `LASER` far more often — 195 times against NORMAL's 129, a 66-death swing that dwarfed
   the head-on trade's +8.** An ablation with the steering pull toward the opponent removed (keep only "stop
   excluding a contested cell, add a bonus for choosing one," no distance term at all) still showed the same
   shape: HARD ≈ 44.5 %, NORMAL ≈ 52.1 % combined. The extra laser deaths were the dominant cost, and persisted
   whether or not the active steering term was present.

The likely mechanism: taking a contested cell over a defensively-optimal one cost a little of the two-step
free-space margin `survivor`'s own lookahead would otherwise have kept, on average, across the whole round.
Two similarly-cautious bots that both reach the laser's closing phase are frequently down to a coin-flip on
*who* gets cornered first by the shrinking arena; a level that spent slightly more of the pre-laser game on
marginally riskier cells lost that coin-flip somewhat more often. Because v1 never intentionally grew,
"strictly longer" was close to a 50/50 accident of incidental apple pickups rather than a skill it could
reliably create, so the head-on mechanic's real, positive contribution (+8 net head-ons) was not large enough
or frequent enough to offset that accumulated risk. The ruling's own words: it "spends the length advantage on
a coin the opponent can also refuse to flip".

### Machine-readable data (v1 — historical, not diffed by any test)

Kept verbatim for the record. `tests/sim/cpuLevels.test.js` diffs its fresh run against the **current**
machine-readable block below, not this one.

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
