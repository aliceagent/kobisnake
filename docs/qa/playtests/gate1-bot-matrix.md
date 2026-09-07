# Gate 1 bot statistics matrix

KS-07-03 · tracking issue [#109](https://github.com/aliceagent/kobisnake/issues/109) · sprint tracking issue
[#106](https://github.com/aliceagent/kobisnake/issues/106)

This is the bot-driven counterpart to KS-07-02's human session 2: the same tuning variants (laser start 25 /
30 / 35 s, laser step interval 2 / 2.5 / 3 s, the three SLOW target modes, Speed Boost 1.5×/5 s vs 1.35×/4 s),
run through the three bot pairings `tests/sim/laserStats.test.js` already reports, 500 seeded rounds per cell.
It is a design instrument for Fable's KS-07-04 decision, not a pass/fail gate — exactly like every other
`tests/sim` statistics file, no rate below is asserted against a threshold in code.

## What actually ran

- **Command:** `KS_TUNING_MATRIX_FULL=1 npx vitest run tests/sim/tuningMatrix.test.js`
- **Date:** 2026-09-06. **Total:** 18 cells × 500 rounds = 9 000 rounds, 78.2 s wall time on the CI machine.
- **Every variant is built with `withOverrides()`** (`tests/sim/tuningMatrix.test.js`); `src/core/settings.js`
  itself was never edited, so every row below is a hypothetical, not a shipped value.
- **Seeds** are a pure function of `(pairing index, variant index)` — see `seedStartFor` in the test file — so
  every number below is exactly reproducible by re-running that command, and `npm run test:unit`'s own (smaller)
  run of this file recomputes the `greedy vs survivor` rows and the Speed Boost deep-dive fresh on every push
  and diffs them against this document's JSON block at the bottom. If those two runs diverge on a future
  PR, this document is stale and needs regenerating with the command above.
- These seeds (300 000+) are **distinct from** `stats.test.js` (10 000-40 000), `laserStats.test.js`
  (110 000-130 000) and `powerupStats.test.js` (210 000+), so a small difference from a figure quoted
  elsewhere (e.g. the Sprint 06 79.0 % "greedy vs survivor ends before 0:30" figure below) is expected sampling
  noise from a different seed range, not a contradiction.

## Read this before the numbers

1. **The bots do not adapt to going faster.** Neither `greedyBot` nor `survivorBot` reacts to its own or its
   opponent's Speed Boost in any way — no route replanning, no extra caution. A human player might slow down,
   change plans, or simply get better at controlling the faster snake with practice; nothing here can show
   that. The Speed Boost section below is evidence for the design lead to weigh against the human sessions
   (KS-07-02), **not a verdict** on which value is correct.
2. **`greedyVsSurvivor`'s numbers are not comparable to Sprints 02/04.** `greedyBot` was taught in Sprint 06 to
   detour for power-up pedestals, which by itself (power-ups were already on in both the before and after
   measurement) moved "greedy vs survivor ends before 0:30" from 66.2 % to 79.0 % — a change of instrument, not
   a change in the design. This document's own baseline row (75.0 %, different seeds, same bot code) is a
   fresh data point from the same instrument as that 79.0 % figure, not from Sprint 02's or Sprint 04's.
3. **The three SLOW target-mode rows are not in this matrix.** KS-07-01 (parallel branch, adding the
   experimental `opponent | collector | everyone-but-collector` switch) had not landed on `main` as of this
   run — confirmed by grepping `src/` for `targetMode`/`slowTarget` and finding nothing outside the sprint
   file's own prose. Building the switch a second time here would duplicate KS-07-01's work and risk
   disagreeing with it, so those three rows are listed at the end, explicitly marked pending, with no
   fabricated numbers. See "Open item" below.

## Main matrix

**Target (`PLAYTEST-SCRIPT §5`):** ≥ 85 % of rounds end by death (not timeout); draw rate ≤ 3 %. "Meets §5?"
below is `yes` only when **both** hold. The before/during-laser boundary is each row's **own** `laserStartTime`
(25/30/35 s), not a fixed 30 s — three of the six variants change exactly that number.

### survivor vs survivor

| Variant | Rounds | Death before laser | Death during laser | Timeout | Draw rate | Mean survivor length | Meets §5? |
|---|---|---|---|---|---|---|---|
| baseline (defaults: laser start 30s, step 2.5s, boost 1.5×/5s) | 500 | 3.4% | 93.0% | 3.6% | 4.0% | 8.0 | **No** — draws 4.0% > 3% |
| laser start 25s | 500 | 3.2% | 76.8% | 20.0% | 4.8% | 7.6 | **No** — ends by death 80.0% < 85%, draws 4.8% > 3% |
| laser start 35s | 500 | 2.0% | 97.2% | 0.8% | 3.2% | 8.1 | **No** — draws 3.2% > 3% |
| laser step interval 2s | 500 | 2.8% | 95.2% | 2.0% | 4.2% | 8.0 | **No** — draws 4.2% > 3% |
| laser step interval 3s | 500 | 2.4% | 88.4% | 9.2% | 3.4% | 8.1 | **No** — draws 3.4% > 3% |
| Speed Boost 1.35×/4s (vs baseline 1.5×/5s) | 500 | 4.8% | 94.2% | 1.0% | 3.6% | 7.9 | **No** — draws 3.6% > 3% |

Two careful bots that both avoid immediate death routinely get killed by the very same laser step (both heads
on the same swept cell) — the whole pairing sits above the 3 % draw target in every variant tried, including
the shipping defaults. This is a known, pre-existing characteristic of `survivorBot` vs itself
(`laserStats.test.js`'s own table shows the same thing), not a new finding from this ticket, and `laser start
25s` additionally misses the death-vs-timeout target because a shorter pre-laser phase leaves relatively more
of survivor-vs-survivor's naturally-long stalemates unresolved by 0:00.

### greedy vs survivor (the pairing `PLAYTEST-SCRIPT §5`'s "Bot stat" row names)

| Variant | Rounds | Death before laser | Death during laser | Timeout | Draw rate | Mean survivor length | Meets §5? |
|---|---|---|---|---|---|---|---|
| baseline (defaults: laser start 30s, step 2.5s, boost 1.5×/5s) | 500 | 75.0% | 25.0% | 0.0% | 0.0% | 29.0 | **Yes** |
| laser start 25s | 500 | 79.4% | 20.6% | 0.0% | 0.0% | 28.7 | **Yes** |
| laser start 35s | 500 | 72.0% | 28.0% | 0.0% | 0.2% | 28.1 | **Yes** |
| laser step interval 2s | 500 | 78.2% | 21.8% | 0.0% | 0.0% | 28.3 | **Yes** |
| laser step interval 3s | 500 | 77.4% | 22.6% | 0.0% | 0.2% | 28.3 | **Yes** |
| Speed Boost 1.35×/4s (vs baseline 1.5×/5s) | 500 | 68.6% | 31.4% | 0.0% | 0.0% | 30.4 | **Yes** |

Every variant meets the §5 target for this pairing — `greedyBot`'s power-up-seeking detours and general
apple-chasing are enough of an edge over `survivorBot` that no laser-timing or Speed Boost tweak tried here
comes close to 3 % draws or any timeouts. The baseline row's 75.0 % "before laser" is this run's own seeds
(300 000+, note above), not Sprint 06's 79.0 % — same bot code, same instrument, different sample.

### greedy vs greedy

| Variant | Rounds | Death before laser | Death during laser | Timeout | Draw rate | Mean survivor length | Meets §5? |
|---|---|---|---|---|---|---|---|
| baseline (defaults: laser start 30s, step 2.5s, boost 1.5×/5s) | 500 | 94.6% | 5.4% | 0.0% | 0.8% | 20.9 | **Yes** |
| laser start 25s | 500 | 97.6% | 2.4% | 0.0% | 1.2% | 21.6 | **Yes** |
| laser start 35s | 500 | 92.0% | 8.0% | 0.0% | 1.2% | 21.5 | **Yes** |
| laser step interval 2s | 500 | 95.0% | 5.0% | 0.0% | 1.2% | 21.1 | **Yes** |
| laser step interval 3s | 500 | 93.8% | 6.2% | 0.0% | 0.4% | 21.2 | **Yes** |
| Speed Boost 1.35×/4s (vs baseline 1.5×/5s) | 500 | 91.8% | 8.2% | 0.0% | 0.6% | 22.4 | **Yes** |

Two identically-scripted `greedyBot`s racing for the same apples decide almost every round well before the
lasers close in; every variant meets §5 here too.

## Speed Boost deep-dive (the sharpest question, per the tech lead)

Sprint 06 found that a non-adapting bot which collects Speed Boost wins under a quarter of its rounds and is
about eight times more likely to die within one second of the boost starting than the control. The hypothesis
under test: is **1.35×/4 s** materially less lethal than the shipping **1.5×/5 s**? Both arms below are
`greedy vs greedy` (the only bot pairing that ever detours for a power-up at all), 500 rounds each, same seed
range as that pairing's baseline/Speed-Boost-alt rows above.

| Speed Boost | Rounds | SPEED collector win rate | Died ≤ 1s after boost starts | Control: dies within any 1s window | Hazard multiple |
|---|---|---|---|---|---|
| 1.5× / 5s (shipping default) | 500 | 30.1% (n=309) | 10.2% (n=334) | 1.6% | ~6.4× |
| 1.35× / 4s (proposed alternative) | 500 | 36.0% (n=325) | 7.7% (n=363) | 1.5% | ~5.3× |

**Definitions** (identical to `powerupStats.test.js`'s, duplicated here per that file not being in this
ticket's `Files:` list): "SPEED collector win rate" = win rate of whichever snake collected a SPEED power-up,
restricted to rounds where that happened. "Died ≤ 1s after boost starts" = of every `EFFECT_STARTED(SPEED)`,
the percentage followed by that same snake's `SNAKE_DIED` within 1 simulated second. "Control" = the same
1-second-window death probability computed analytically from every snake's own death tick (or the round's end
tick if it survives), over the same 500 rounds — not a separate run. "Hazard multiple" = the first column
divided by the second, for readability only (not itself a measured statistic).

**Reading it:** in this bot-only measurement, the 1.35×/4 s arm moves in the hypothesized direction on **both**
counts — a higher collector win rate (36.0 % vs 30.1 %) and a lower near-boost death rate (7.7 % vs 10.2 %,
roughly 5.3× the control instead of 6.4×) — but neither arm's collector win rate approaches parity (a snake
that grabbed nothing would win ~50 % of a symmetric greedy-vs-greedy round), and the near-boost death rate is
still several times the control in both arms. **This is directional evidence that 1.35×/4 s is somewhat less
punishing, not proof it is safe, and it says nothing about how it feels to a human hand on the keyboard** — P4
in the session 3 playtest script is what actually decides this.

## Open item: SLOW target mode (pending KS-07-01)

The following three variants are named in the ticket and in KS-07-02's session-2 variant list, but the
experimental SLOW-target-mode switch they need does not exist in the simulation yet — it is KS-07-01's own
deliverable, on a separate, not-yet-merged branch. Building it a second time here would risk disagreeing with
that ticket's implementation. No numbers are given for these rows; they are listed so the matrix visibly has
three rows outstanding rather than silently having fewer rows than the ticket asked for.

- **SLOW target = opponent** — pending KS-07-01 (switch not yet merged to `main`); no rows.
- **SLOW target = collector** — pending KS-07-01 (switch not yet merged to `main`); no rows.
- **SLOW target = everyone-but-collector** — pending KS-07-01 (switch not yet merged to `main`); no rows.

Once KS-07-01 lands, these three rows can be filled in for all three pairings using the exact same method as
the rest of this document (`tests/sim/tuningMatrix.test.js`'s `BUILDABLE_VARIANTS`/`cellsToRun`), and the
`meetsTarget`/Speed-Boost sections above are unaffected either way.

## Summary for the tracking issue

- Every buildable laser-timing variant (laser start 25/30/35 s, step interval 2/2.5/3 s) meets `PLAYTEST-SCRIPT
  §5` for both pairings that involve `greedyBot`; **none** of them meet it for `survivor vs survivor`, which is
  a pre-existing characteristic of two symmetric, laser-avoidant bots rather than a new regression from any
  variant tried.
- The Speed Boost alternative (1.35×/4 s) looks directionally less punishing than the shipping default in this
  bot-only measurement on both of the tech lead's named metrics, but the margin is not large and bots cannot
  speak to feel — session 3's P4 answer is the deciding input for KS-07-04, this document is supporting
  evidence only.
- SLOW target mode: three rows pending KS-07-01; see above.

## Machine-readable data

The exact numbers tabulated above, plus every cell computed by a full run, as printed by
`tests/sim/tuningMatrix.test.js`'s own `console.log` when run with `KS_TUNING_MATRIX_FULL=1`. The committed
test's default (CI) run recomputes the `greedyVsSurvivor` cells and the `speedBoost` entries fresh on every
`npm run test:unit` and diffs them against this block — see "What actually ran" above.

```json
{
  "roundsPerCell": 500,
  "cells": [
    {
      "variant": "baseline",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 3.4,
      "duringLaserPct": 93,
      "timeoutPct": 3.6,
      "drawPct": 4,
      "meanSurvivorLength": 7.968,
      "endsByDeathPct": 96.4,
      "meetsTarget": false
    },
    {
      "variant": "laserStart25",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 3.2,
      "duringLaserPct": 76.8,
      "timeoutPct": 20,
      "drawPct": 4.8,
      "meanSurvivorLength": 7.576,
      "endsByDeathPct": 80,
      "meetsTarget": false
    },
    {
      "variant": "laserStart35",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 2,
      "duringLaserPct": 97.2,
      "timeoutPct": 0.8,
      "drawPct": 3.2,
      "meanSurvivorLength": 8.096,
      "endsByDeathPct": 99.2,
      "meetsTarget": false
    },
    {
      "variant": "stepInterval2",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 2.8,
      "duringLaserPct": 95.2,
      "timeoutPct": 2,
      "drawPct": 4.2,
      "meanSurvivorLength": 7.988,
      "endsByDeathPct": 98,
      "meetsTarget": false
    },
    {
      "variant": "stepInterval3",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 2.4,
      "duringLaserPct": 88.4,
      "timeoutPct": 9.2,
      "drawPct": 3.4,
      "meanSurvivorLength": 8.148,
      "endsByDeathPct": 90.8,
      "meetsTarget": false
    },
    {
      "variant": "speedBoostAlt",
      "pairing": "survivorVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 4.8,
      "duringLaserPct": 94.2,
      "timeoutPct": 1,
      "drawPct": 3.6,
      "meanSurvivorLength": 7.878,
      "endsByDeathPct": 99,
      "meetsTarget": false
    },
    {
      "variant": "baseline",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 75,
      "duringLaserPct": 25,
      "timeoutPct": 0,
      "drawPct": 0,
      "meanSurvivorLength": 29.038,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "laserStart25",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 79.4,
      "duringLaserPct": 20.6,
      "timeoutPct": 0,
      "drawPct": 0,
      "meanSurvivorLength": 28.72,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "laserStart35",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 72,
      "duringLaserPct": 28,
      "timeoutPct": 0,
      "drawPct": 0.2,
      "meanSurvivorLength": 28.06,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "stepInterval2",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 78.2,
      "duringLaserPct": 21.8,
      "timeoutPct": 0,
      "drawPct": 0,
      "meanSurvivorLength": 28.3,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "stepInterval3",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 77.4,
      "duringLaserPct": 22.6,
      "timeoutPct": 0,
      "drawPct": 0.2,
      "meanSurvivorLength": 28.294,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "speedBoostAlt",
      "pairing": "greedyVsSurvivor",
      "rounds": 500,
      "beforeLaserPct": 68.6,
      "duringLaserPct": 31.4,
      "timeoutPct": 0,
      "drawPct": 0,
      "meanSurvivorLength": 30.448,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "baseline",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 94.6,
      "duringLaserPct": 5.4,
      "timeoutPct": 0,
      "drawPct": 0.8,
      "meanSurvivorLength": 20.918,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "laserStart25",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 97.6,
      "duringLaserPct": 2.4,
      "timeoutPct": 0,
      "drawPct": 1.2,
      "meanSurvivorLength": 21.584,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "laserStart35",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 92,
      "duringLaserPct": 8,
      "timeoutPct": 0,
      "drawPct": 1.2,
      "meanSurvivorLength": 21.476,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "stepInterval2",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 95,
      "duringLaserPct": 5,
      "timeoutPct": 0,
      "drawPct": 1.2,
      "meanSurvivorLength": 21.056,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "stepInterval3",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 93.8,
      "duringLaserPct": 6.2,
      "timeoutPct": 0,
      "drawPct": 0.4,
      "meanSurvivorLength": 21.204,
      "endsByDeathPct": 100,
      "meetsTarget": true
    },
    {
      "variant": "speedBoostAlt",
      "pairing": "greedyVsGreedy",
      "rounds": 500,
      "beforeLaserPct": 91.8,
      "duringLaserPct": 8.2,
      "timeoutPct": 0,
      "drawPct": 0.6,
      "meanSurvivorLength": 22.434,
      "endsByDeathPct": 100,
      "meetsTarget": true
    }
  ],
  "speedBoost": {
    "baseline": {
      "boostSamples": 334,
      "diedWithin1sPct": 10.179640718562874,
      "controlWithin1sPct": 1.5933576376576168,
      "collectorSample": 309,
      "collectorWinRatePct": 30.097087378640776
    },
    "speedBoostAlt": {
      "boostSamples": 363,
      "diedWithin1sPct": 7.7134986225895315,
      "controlWithin1sPct": 1.4537733317854677,
      "collectorSample": 325,
      "collectorWinRatePct": 36
    }
  }
}
```
