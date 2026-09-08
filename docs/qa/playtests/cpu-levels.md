# CPU levels — measured

KI-12-03 · tracking issue [#217](https://github.com/aliceagent/kobisnake/issues/217) · sprint tracking issue
[#210](https://github.com/aliceagent/kobisnake/issues/210)

## Decision: two levels ship

**EASY and NORMAL ship on the match-setup row (KI-12-04). `HARD` stays defined in `src/game/bots/levels.js`,
exported and fully measured, but is not offered.** This is the fallback the design lead pre-authorised on
#210: "if that does not order either, ship two levels... two honest levels beat three with one that lies."

Two things settled it, not one. First, on the point estimate: `HARD`'s only two attempted definitions both
failed to beat `NORMAL` by the ticket's 20-point margin — the first (steer into a winnable head-on) came out
**3.5 points weaker**, and the ruled redefinition (eat an apple when it costs no room) came out only **+3.1
points**. Second, and more decisive: the +3.1-point gap is **not distinguishable from zero at this sample
size** (p = 0.32 — see "Statistical significance" below). `HARD` was never shown to be a stronger opponent in
any sense a player would feel; shipping it as `CPU HARD` would be the level lying about itself, which is
exactly what the ruling on #210 refuses. `DESIGN-DECISIONS §1 row 27` records the final wording; this document
is the measurement the row change is based on, not a rule itself — agents do not edit that file.

Both measurements are kept below in full, in order, because both are real design knowledge (see "What this
measurement taught us" below): steering into head-ons and eating-what's-on-the-path fail for two different
reasons, and a future ticket revisiting a CPU `HARD` should not have to re-discover either one.

## What actually ran

- **Command:** `KI_12_03_LEVELS_FULL=1 npx vitest run tests/sim/cpuLevels.test.js`
- **Date:** 2026-09-08, in two passes on the same day: the original measurement (`HARD` v1, steering into
  head-ons), then a re-measurement (`HARD` v2, safe eating) after the design lead's ruling on #210 redefined
  the policy. **Total per pass:** 6 matchups × 1 000 rounds (500 per seat, both seats) = 6 000 rounds, ~60-63 s
  under this repository's always-on coverage instrumentation.
- `npm run test:unit`'s own (default, non-`FULL`) run of this file recomputes only the four matchups any
  assertion needs (`normalVsEasy`, `hardVsNormal`, `hardVsEasy`, `easyVsIdle`) fresh on every push, ~56 s, and
  diffs them against this document's **current** JSON block (`tests/sim/cpuLevels.test.js`'s own module doc has
  the runtime accounting). `normalVsIdle` and `hardVsIdle` are informative-only rows recomputed only by the
  full command above.
- Every level plays under `src/game/bots/policy.js`'s `PLAY_RULES` (no `rules` passed at all — the CPU's own
  rules: dead-zone aware, contested cells excluded outright for NORMAL and HARD alike, no randomness), exactly
  what a real CPU opponent would play by. Nothing in `src/core/settings.js` was touched.
- **Seeds, the seat-swap methodology, and the 20-point margin are byte-for-byte identical between the two
  passes** — the ruling required the same measurement on both definitions of `HARD`, precisely so the
  comparison is not confounded by a friendlier test the second time. See `seedStartFor` in `tests/sim/
  cpuLevels.test.js`: a pure function of `(lowIndex, highIndex, seatIndex)` where `lowIndex`/`highIndex`
  identify which two participants (`EASY=0`, `NORMAL=1`, `HARD=2`, `IDLE=3`, the last a local label for this
  file only, never one of the three approved level words) are matched, and `seatIndex` (0 or 1) is which side
  goes first. This range (`700 000+`) is distinct from every other `tests/sim` file's own seeds (`stats.test.js`
  10 000-40 000, `laserStats.test.js` 110 000-130 000, `powerupStats.test.js` 210 000+, `tuningMatrix.test.js`
  300 000+).

## Read this before the numbers

1. **Every matchup is measured in both seats and combined.** The two spawn positions are not symmetric
   (`DESIGN-DECISIONS §2.3`). A control of two copies of the *same* policy (survivor vs survivor, on this
   file's own seeds) showed **39.2 % vs 58.8 %** — a ~20-point gap from spawn position alone, nothing to do
   with skill. Every matchup below plays 500 rounds with each side as `p1`, then combines both halves, so a
   spawn advantage cannot be mistaken for a level advantage. It is this control that made the v1 measurement's
   −3.5pp believable rather than dismissible as noise.
2. **"Loses" never counts a draw.** A round is `P1_WIN`, `P2_WIN` or `DRAW`. "X loses to Y" means the round
   resolves as Y's win specifically; a draw is neither a win nor a loss for either side. Used for "EASY loses
   to idle" below.
3. **The no-input human is `IDLE`: a bot that presses nothing, ever**, the sim equivalent of `tests/agent/
   policies/idle.js`. It walks straight out of its spawn heading until it dies, almost always to the wall,
   almost immediately — which is why every level beats it 100.0 % of the time. That is the expected, correct
   shape of this comparison, not a sign the test is vacuous: it is exactly why EASY's "loses to idle" rate
   comes in far under the ticket's 25 % ceiling.
4. **`NORMAL` never eats; `HARD` (v2) does, but only opportunistically.** `survivor` (`NORMAL`) ignores apples
   by design (`QA-STRATEGY §4`) and stays near spawn length all round. `HARD` (v2) takes an apple only when one
   of its already-safe candidate cells happens to sit on one *and* doing so costs no reachable room
   (`src/game/bots/levels.js`'s module doc) — it does not travel toward apples the way `greedy` does. This is
   why HARD's growth advantage over NORMAL, while real, is modest rather than dramatic: it eats only what falls
   in its path.

## Main matrix — the measurement that decided it (HARD v2, safe eating)

**Margin:** every "beats" comparison is asserted at **≥ 20 percentage points** of `gapPct` (the higher level's
combined win % minus the lower's) — unchanged between both passes (see "What actually ran"). Chosen from what
was actually measured: the two orderings that hold clear roughly 80 points, so 20 leaves wide headroom against
seed noise while still being a real, decisive bar — nowhere near a coin flip. It was not lowered to try to
catch HARD vs NORMAL on either definition.

| Matchup | Rounds | Higher win% | Lower win% | Draw% | Gap (higher − lower) | ≥ 20pp? |
|---|---|---|---|---|---|---|
| NORMAL vs EASY | 1000 | NORMAL 90.4% | EASY 9.6% | 0.0% | +80.8pp | **Yes — ships** |
| HARD vs NORMAL | 1000 | HARD 50.1% | NORMAL 47.0% | 2.9% | **+3.1pp** | **No — HARD stays off the menu** |
| HARD vs EASY (measured, not shipped) | 1000 | HARD 90.5% | EASY 9.4% | 0.1% | +81.1pp | Yes (HARD is not offered regardless) |
| EASY vs idle | 1000 | EASY 100.0% | idle 0.0% | 0.0% | +100.0pp | Yes (not asserted at 20pp — see beginner check) |
| NORMAL vs idle | 1000 | NORMAL 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |
| HARD vs idle | 1000 | HARD 100.0% | idle 0.0% | 0.0% | +100.0pp | informative only |

**Beginner check (ticket spec):** EASY loses to an idle player 0.0 % of the time (1 000 rounds, both seats) —
comfortably under the ticket's "less than a quarter of the time" ceiling.

## Statistical significance: why +3.1pp is not a real edge

The point estimate alone invites exactly the wrong conversation — "3.1 is closer to 20 than −3.5 was, keep
pushing" — so the question this section answers is not "did HARD improve" (yes, see below) but "is +3.1pp
distinguishable from a coin flip at n = 1 000". It is not:

- **Decisive rounds:** 971 (draws: 29). **HARD 501 / NORMAL 470.**
- **z = 0.99, two-sided p = 0.320.** Nowhere near a conventional significance threshold — a gap this size or
  larger would show up roughly one run in three even if the two levels were exactly equally matched.
- **95 % confidence interval on the gap: +3.1pp ± 6.3pp** — i.e. the interval comfortably contains zero, and
  comfortably contains a small *negative* gap too.
- **Rounds needed to resolve a true 3.1-point gap at 80 % power: ~8 158 per matchup** — roughly eight times what
  this ticket's own 500-per-seat convention runs, and a wall-clock cost this file's own "keep it out of the
  default `test:unit` path if it is slow" convention would not accept as a routine measurement.

None of this says the redefinition failed to do anything — see "What this measurement taught us" below, the
−3.5 → +3.1 swing is a genuine, reproducible directional move with an identified mechanism behind it. It says
that at the sample size this ticket's own convention runs, `HARD` (v2) has not been shown to be a stronger
opponent than `NORMAL` in any sense a player sitting at the keyboard would feel, which is the actual bar
`DESIGN-DECISIONS §1 row 27` sets for a CPU level's name.

## What this measurement taught us

Two mechanisms, from `HARD`'s two attempted definitions, worth keeping regardless of what ships:

1. **Steering into head-ons spends a length advantage on a coin the opponent can refuse to flip** (the ruling's
   own words). `HARD` v1's head-on-forcing trigger fired often (28.6 % of its decisions, 67 % of rounds) and
   the head-on trade itself was a small net win in isolation (+8 net head-on kills over 500 rounds), but taking
   a contested cell over a defensively-optimal one cost a sliver of `survivor`'s own two-step free-space margin
   on average, and that spent margin lost the laser-endgame coin-flip (who gets cornered first) often enough —
   66 more `LASER` deaths than `NORMAL` over the same rounds — to erase the head-on trade's gain and then some.
   An opponent that already excludes contested cells (exactly `NORMAL`'s own rule) rarely reciprocates the
   invitation, so the mechanic mostly just pays its own cost without collecting its own payoff.
2. **Eating only what is already on your path builds length too slowly to cash in at the only two moments
   length pays.** `HARD` v2 never travels toward an apple — it only takes one when a cell it was already
   considering happens to have one, at no cost in room. That is genuinely safer than v1 (both bots keep
   identical laser awareness and contested-cell exclusion; the entire +3.1pp/−3.5pp swing between the two
   `HARD`s is pure upside from carried length, no new avoidable risk). But a length edge only pays out at a
   head-on (`DESIGN-DECISIONS §1` row 8) or a 0:00 timeout (`§2.5`) — and an opportunistic, path-luck edge is a
   narrow lever next to the ~80-point gaps `greedy`'s *active* apple-seeking produces against either
   survival-only bot. Something that reliably grows (like `greedy`) or that reliably reaches a length-deciding
   moment would need a materially different algorithm than "survivor plus a tie-break", which is a bigger
   change than either of this ticket's two attempts made.

## Machine-readable data (current — HARD v2, safe eating; diffed by `tests/sim/cpuLevels.test.js`)

The exact numbers tabulated in "Main matrix" above, as computed by `tests/sim/cpuLevels.test.js`'s own
`beforeAll`. The committed test recomputes every cell it needs fresh on every `npm run test:unit` and diffs it
against **this** block (the first ` ```json ` block in this file — kept ahead of the v1 history block below so
the test's regex, which matches the first one, reads the right numbers), so a hand-edited number here that
drifts from what the code actually produces fails a test, and a code change that moves the numbers without
this document being regenerated also fails one.

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
machine-readable block above, not this one.

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
