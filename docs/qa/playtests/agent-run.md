# Agent playtest statistics

KI-03-04 · tracking issue [#122](https://github.com/aliceagent/kobisnake/issues/122) · origin
[#119](https://github.com/aliceagent/kobisnake/issues/119) F3, F1

This is the committed, reproducible successor to the ten-match scratch run in the 2026-09-07 agent QA pass
(`docs/qa/reports/2026-09-07-agent-qa-pass.md` §3). That run found F3 — "only 4 of 27 rounds (14.8%) reached
the laser phase" — by hand, on an unseeded run nobody could replay. This document aggregates
`tests/agent/driver.js`'s real `MatchResult[]` from real seeded matches of the built site into the numbers a
design lead actually uses, exactly the way `docs/qa/playtests/gate1-bot-matrix.md` does for the tuning
matrix: it is a design instrument, not a pass/fail gate — nothing below is asserted against a threshold in
code, except that a pairing named as "does not finish" (idle vs idle) is expected not to, and every other
pairing is expected to.

## What actually ran

- **Command:** `KI_AGENT_REPORT=1 npm run test:agent:report`
- **Date:** 2026-09-07. **This is the one line expected to change if you regenerate this document on a
  different day** — every number below comes from fixed seeds through a deterministic simulation
  (`ARCHITECTURE §11`), so re-running the command above should reproduce every other line byte for byte.
  Treat any other line changing as a real discrepancy to investigate, not a maintenance chore to reconcile.
- **Wall time:** ~100s. Real wall-clock time, reported because it is a fair sense of "how long
  does this take to regenerate" — but it is **not** reproducible (a busier machine, a different render
  cadence, a different container all move it) the way the date above is not, and unlike every other number in
  this document, which is a simulated quantity computed from the deterministic seeds. Do not expect this
  figure to match on a re-run.
- **Total:** 53 matches, 152 rounds, across 4 pairings.
- **Seeds, by pairing:**
  - **greedy vs greedy:** 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946 (20 seeds)
  - **survivor vs survivor:** 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946 (20 seeds)
  - **greedy vs survivor:** 1, 2, 3, 5, 8, 13, 21, 34, 55, 89 (10 seeds)
  - **idle vs idle:** 1, 2, 3 (3 seeds)
- **Render cadence.** `driver.js`'s header is explicit that skipping `renderer.render()` cannot affect
  simulation state — only real time it costs. This run reads only `RoundRecord`/`MatchResult` fields
  (never `maxDrawCalls`), so it renders far more sparsely than the driver's own default cadence, trading a
  render sample this document does not use for wall time it does; that choice changes wall-clock timing and
  nothing the simulation does.

## Read this before the numbers

1. **Bots die more cheaply than people.** Neither `greedy` nor `survivor` fears death the way a person
   playing for the first time does — a bot never hesitates, never mistimes a turn out of nerves, never look
   away from the screen. Every death-related rate below (draw rate, end-reason mix, how often a round ends
   before the laser phase) over-states how often a *player* would die early, in the same direction and for
   the same reason the 2026-09-07 QA pass's F3 already flagged.
2. **Neither policy adapts to Speed Boost.** Exactly the caveat `gate1-bot-matrix.md` makes: a bot that
   collects Speed Boost does not replan, does not get more careful, does not practice controlling the faster
   snake. Nothing here can show what a human player does differently under it.
3. **This sample is far smaller than `tests/sim`'s.** That layer runs 500 seeded rounds per cell headlessly,
   in milliseconds. This layer plays every round in a real Chromium, through the real `keydown` listener and
   the real state machine — the point of the layer (`tests/agent/README.md`), and also why the seed counts
   above are tens, not hundreds. Treat single-digit percentage differences between pairings, or between this
   run and a past one, with the caution that sample size implies.
4. **The rendering cadence changes wall-clock timing and nothing else.** `driver.js`'s own header is explicit
   that `__kobi.advance` drives the same `session.runUpdate` a rendered frame does — simulation, input and
   the HUD run on every driven frame regardless of whether that frame is also rendered. Every number in this
   document is a property of the simulation, never of how often it was drawn.
5. **This does not judge whether the game is fun.** That is Gate 1 (KS-07-02) and no agent can report it —
   this document is evidence for a design lead to weigh, not a verdict on any of it.

## Match-level statistics

| Pairing | Matches | Matches finished | Mean rounds/match | Mean match duration (simulated s) | p90 match duration (s) |
|---|---|---|---|---|---|
| greedy vs greedy | 20 | 20 | 2.5 | 83.4 | 144.7 |
| survivor vs survivor | 20 | 20 | 2.5 | 199.2 | 249.3 |
| greedy vs survivor | 10 | 10 | 2.3 | 108.4 | 157.0 |
| idle vs idle | 3 | 0 *(did not finish — see below)* | — | — | — |

## Round-level statistics

| Pairing | Rounds | Result mix (P1/P2/Draw) | Draw rate | End reason (Death/Timeout) | Reached laser phase | Mean round length (s) | p90 round length (s) |
|---|---|---|---|---|---|---|---|
| greedy vs greedy | 50 | 24/26/0 | 0.0% | 100.0% / 0.0% | 6/50 (12.0%) | 33.4 | 59.3 |
| survivor vs survivor | 49 | 22/27/0 | 0.0% | 100.0% / 0.0% | 49/49 (100.0%) | 81.3 | 85.3 |
| greedy vs survivor | 23 | 3/20/0 | 0.0% | 100.0% / 0.0% | 11/23 (47.8%) | 47.1 | 75.0 |
| idle vs idle | 30 | 0/0/30 | 100.0% | 100.0% / 0.0% | 0/30 (0.0%) | 3.2 | 3.2 |

## Pairings that do not finish

### idle vs idle

This pairing does not reach `MATCH_OVER` on this build — #119 F1: a match made entirely of draws never ends, because `DESIGN-DECISIONS §1 row 26`'s third-consecutive-draw rule is ruled but not yet implemented (I01/#120). Every seed above was bounded to 6000 frames so the run reports the defect instead of hanging on it, and every one of its 30 recorded rounds ended in a `DRAW` (see the round-level table above).

## Reading it against F3 and KI-03-02

- **greedy vs greedy** reached the laser phase in 12.0% of rounds here, against the reference figure of 12.0% — this run agrees with it (within 5 points).
- **survivor vs survivor** reached the laser phase in 100.0% of rounds here, against the reference figure of 100.0% — this run agrees with it (within 5 points).
- **greedy vs survivor** reached the laser phase in 47.8% of rounds here, against the reference figure of 14.8% — this run **differs from it by 33.0 points** — worth checking the aggregation before trusting this document, per the tech-lead ruling on #122 (report real numbers; a disagreement is a signal to investigate, not to adjust). F3's own figure predates this permanent layer's policies (an unseeded scratch run, before Improvement 03 existed). `survivor.js` (KI-03-02, ruling 5) excludes outright every cell a living opponent's head could reach next, where `tests/sim/bots/survivorBot.js` (behind `gate1-bot-matrix.md`'s own 20.6-31.4% for this nominal pairing) only penalises it — a documented improvement in collision avoidance that predicts longer rounds and a higher laser-phase rate, not a bug in this aggregation.

F3 called a mechanic four sprints were spent on "absent from most of the game" on a 14.8% laser-phase rate for greedy vs survivor; this run is what makes that number re-measurable on demand rather than trusting a one-off scratch script (`tests/agent/README.md`, KI-03-04's own reason to exist).

## Machine-readable data

The exact numbers tabulated above, one object per pairing. Everything here is a pure function of the seeds
named above and the deterministic simulation they drive — regenerating this document should reproduce this
block byte for byte (the date and wall time above are deliberately not included here, for exactly that
reason).

```json
{
  "pairings": [
    {
      "label": "greedy vs greedy",
      "seeds": [
        1,
        2,
        3,
        5,
        8,
        13,
        21,
        34,
        55,
        89,
        144,
        233,
        377,
        610,
        987,
        1597,
        2584,
        4181,
        6765,
        10946
      ],
      "matches": 20,
      "matchesFinished": 20,
      "rounds": 50,
      "p1Wins": 24,
      "p2Wins": 26,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 50,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "laserPhaseReachedCount": 6,
      "laserPhaseReachedRatePct": 12,
      "roundLength": {
        "meanSeconds": 33.37083333333333,
        "p90Seconds": 59.266666666666666,
        "minSeconds": 8,
        "maxSeconds": 66.16666666666667
      },
      "meanRoundsPerMatch": 2.5,
      "meanMatchSeconds": 83.42708333333333,
      "p90MatchSeconds": 144.7,
      "expectFinish": true
    },
    {
      "label": "survivor vs survivor",
      "seeds": [
        1,
        2,
        3,
        5,
        8,
        13,
        21,
        34,
        55,
        89,
        144,
        233,
        377,
        610,
        987,
        1597,
        2584,
        4181,
        6765,
        10946
      ],
      "matches": 20,
      "matchesFinished": 20,
      "rounds": 49,
      "p1Wins": 22,
      "p2Wins": 27,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 49,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "laserPhaseReachedCount": 49,
      "laserPhaseReachedRatePct": 100,
      "roundLength": {
        "meanSeconds": 81.29455782312927,
        "p90Seconds": 85.33333333333333,
        "minSeconds": 68.5,
        "maxSeconds": 87.16666666666667
      },
      "meanRoundsPerMatch": 2.45,
      "meanMatchSeconds": 199.17166666666668,
      "p90MatchSeconds": 249.33333333333334,
      "expectFinish": true
    },
    {
      "label": "greedy vs survivor",
      "seeds": [
        1,
        2,
        3,
        5,
        8,
        13,
        21,
        34,
        55,
        89
      ],
      "matches": 10,
      "matchesFinished": 10,
      "rounds": 23,
      "p1Wins": 3,
      "p2Wins": 20,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 23,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "laserPhaseReachedCount": 11,
      "laserPhaseReachedRatePct": 47.82608695652174,
      "roundLength": {
        "meanSeconds": 47.12355072463768,
        "p90Seconds": 75,
        "minSeconds": 15.5,
        "maxSeconds": 81.33333333333333
      },
      "meanRoundsPerMatch": 2.3,
      "meanMatchSeconds": 108.38416666666667,
      "p90MatchSeconds": 157,
      "expectFinish": true
    },
    {
      "label": "idle vs idle",
      "seeds": [
        1,
        2,
        3
      ],
      "matches": 3,
      "matchesFinished": 0,
      "rounds": 30,
      "p1Wins": 0,
      "p2Wins": 0,
      "draws": 30,
      "drawRatePct": 100,
      "deathCount": 30,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "laserPhaseReachedCount": 0,
      "laserPhaseReachedRatePct": 0,
      "roundLength": {
        "meanSeconds": 3.1666666666666674,
        "p90Seconds": 3.1666666666666665,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 3.1666666666666665
      },
      "meanRoundsPerMatch": null,
      "meanMatchSeconds": null,
      "p90MatchSeconds": null,
      "expectFinish": false,
      "maxFrames": 6000
    }
  ]
}
```
