# Round pacing — the shape of a round, swept

KI-04-01 · tracking issue [#229](https://github.com/aliceagent/kobisnake/issues/229) · ticket issue
[#231](https://github.com/aliceagent/kobisnake/issues/231) · origin
[#119](https://github.com/aliceagent/kobisnake/issues/119) finding F3

F3 measured 4 of 27 rounds (14.8 %) reaching the laser warning, on an unseeded scratch run, with a median
round of 16 s — "five rounds in six never see a laser", on a mechanic four sprints were spent building.
`docs/qa/playtests/agent-run.md` (I03) made that number reproducible on the shipping settings. This document
does the next thing I04 asks for: it sweeps the two levers that could move it and reports what each one costs.

It is a **design instrument, not a pass/fail gate** — the same standing `gate1-bot-matrix.md` and
`agent-run.md` have. Nothing below is asserted against a design threshold in code. The decision it feeds is
KI-04-02, which belongs to the design lead; this document deliberately stops at the numbers.

## What actually ran

- **Command:** `KI_PACING=1 npm run test:agent:pacing`
- **Date:** 2026-09-08. **This and the wall time below are the only two lines expected to change if you
  regenerate this document on a different day or a different machine** — every other number comes from fixed
  seeds through a deterministic simulation (`ARCHITECTURE §11`). Treat any other line changing as a real
  discrepancy to investigate, not a maintenance chore to reconcile.
- **Wall time:** ~12551s. Real time, reported as a sense of what regenerating costs. Not
  reproducible, and unlike every other figure here not a property of the simulation at all.
- **Total:** 39 cells, 5850 matches, 14509 rounds. Smallest cell:
  328 rounds (the ticket's floor is 300).
- **Seeds** — the same list in every cell, so any two cells differ by their swept values and nothing else:
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946, then 500001…500130 (150 seeds in total, the same list in every cell)
  The first 20 are `agent-run.md`'s own seeds, in its own order, which is what makes
  the reconciliation below an exact comparison. The rest start at 500001, clear of every
  other committed instrument's range (`gate1-bot-matrix.md` 300 000+, `powerupStats.test.js` 210 000+,
  `laserStats.test.js` 110 000–130 000, `stats.test.js` 10 000–40 000), so a small difference from a figure
  quoted elsewhere is sampling noise from a different seed range rather than a contradiction.
- **Every cell is built with `withOverrides()`**, through `driver.playMatch`'s `settingsOverrides`
  option into `session.js`. **`src/core/settings.js` was never edited**, so every row below is a
  hypothetical — including the baseline row, which is a hypothetical that happens to equal what ships.
- **Two cells per pairing are a declared extension to the ticket's grid.** `laserStartTime` is measured in
  seconds *remaining*, so a larger number is an **earlier** warning — which means the ticket's own three
  values (20 / 25 / 30) are the shipping start and two *later* ones, and the sprint file's lever table
  ("earlier lasers reach more rounds") describes the direction none of them test. Swept only downward this
  lever can move the climax fraction one way, so a matrix built from those three alone would answer "which
  single lever moves it most" by default rather than on evidence. `laserStartTime` 35, 40, 45 and 50 s
  at the shipping `roundDuration` are therefore run as well, labelled *(extension: earlier start)* wherever
  they appear. The ticket's 3×3 grid is reported intact beside them. 35 and 40 s were measured by KI-04-01;
  45 and 50 s were added by KI-04-03 on the design lead's ruling, because two points describe a line rather
  than a curve and this lever has to be measured far enough to show where it turns over.
- **Best-of-3**, `agent-run.md`'s format and the game's own default. First-to-two means every match plays at
  least two rounds, so 150 seeds guarantee at least 300 rounds in every
  cell by construction.
- **Render cadence:** one render every 1200 frames. This run reads only
  `RoundRecord`/`MatchResult` fields and never `maxDrawCalls`, so it renders sparsely, trading a render
  sample it does not use for wall time it does. `driver.js`'s header is explicit that skipping
  `renderer.render()` cannot affect simulation state — every number here is a property of the simulation,
  never of how often it was drawn.

### Cells that did not run

Every cell of the full grid ran. No cell was dropped and no cell was under-sampled.

## Read this before the numbers

1. **Bots die more cheaply than people.** This is the single most important caveat in the document and it
   applies to every figure below. Neither `greedy` nor `survivor` fears death the way a person does — a bot
   never hesitates, never mistimes a turn out of nerves, never looks away from the screen, and never gets
   better between rounds. Every death-driven figure here — how often a round ends before the warning, the
   draw rate, the end-reason mix — over-states how often a *player* would die early. **These are directional
   numbers.** They say which lever moves the climax and roughly how far; they do not say what the right value
   is, and a lever ranked first here could easily rank second with humans on the keyboard.
2. **The direction is the finding; the magnitude is not.** Read the *differences between cells* rather than
   any single cell's absolute percentage, and prefer a lever that moves the number a lot to one that moves it
   a little — that comparison survives the caveat above far better than the levels do.
3. **Neither policy adapts to anything.** Same caveat `gate1-bot-matrix.md` and `agent-run.md` both make: a
   bot that collects Speed Boost does not replan or get more careful, and neither policy plays the closing
   board differently from the open one. A human does both.
4. **A shorter round is not automatically a better round.** `roundDuration` moves the warning fraction by
   moving the finish line, which is arithmetic, not design: it raises the fraction partly by removing round
   that would otherwise have been played. The match wall-clock columns are in the tables for exactly this
   reason — a lever that buys the climax by making the whole match shorter has a cost, and it is visible
   there rather than argued about.
5. **This does not judge whether the game is fun, and it cannot.** That is Gate 1 (KS-07-02) and
   `PLAYTEST-SCRIPT §5` A2/A4 — "did the lasers come too early or late?", "was the ending exciting or
   frustrating?" — which no agent can answer. This document is evidence for a design lead to weigh against
   those sessions, not a verdict on any of it.

## Reconciling the baseline against `agent-run.md`

The baseline cell (`laserStartTime` 30 s, `roundDuration` 90 s)
**is** `SETTINGS`. Restricted to `agent-run.md`'s own seeds it is the same set of matches that document
played, through the same driver and the same policies, so it must reproduce it exactly. Expected / actual:

| Pairing | Seeds compared | Rounds | Reached warning | Mean round (s) | Verdict |
|---|---|---|---|---|---|
| greedy vs greedy | 20 | 50 / 50 | 6 / 6 | 33.4 / 33.4 | **matches to the number** |
| survivor vs survivor | 20 | 49 / 49 | 49 / 49 | 81.3 / 81.3 | **matches to the number** |
| greedy vs survivor | 10 | 23 / 23 | 11 / 11 | 47.1 / 47.1 | **matches to the number** |

Every pairing reproduces `agent-run.md` **to the number**. The baseline cell is the shipping configuration expressed as an override, so this is what a correct run must show — and it is the evidence that the swept cells below differ from the baseline because of the swept value and for no other reason.

## The matrix

Every cell: 150 seeds, Best-of-3, power-ups at the match-setup default. "Reached warning" is
`RoundRecord.reachedLaserPhase` — the beams left `PARKED` during the round — and "reached inset ≥ 3"
is `maxLaserInset >= 3`, a third of the way in, where the board is visibly closing rather than
merely lit. Match times are whole matches including countdown, crash slow-mo and scoreboard. Rows marked
*(extension: earlier start)* are the 4 cells beyond the ticket's grid, for
the reason given above; read the ticket's own nine rows as the answer to what it asked, and those as the
question it did not ask.

### greedy vs greedy

| Cell | Rounds | Median round (s) | p90 round (s) | Reached warning | Reached inset ≥ 3 | Timeout | Draw | Median match (s) | p90 match (s) |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s **(baseline = shipping)** | 388 | 30.8 | 54.3 | 9.5% | 2.3% | 0.0% | 1.3% | 96.8 | 143.2 |
| laser 25s / round 90s | 392 | 30.8 | 53.9 | 7.1% | 1.3% | 0.0% | 1.8% | 98.0 | 144.1 |
| laser 20s / round 90s | 395 | 30.8 | 53.9 | 6.8% | 0.8% | 0.0% | 2.3% | 98.0 | 144.1 |
| laser 30s / round 75s | 389 | 29.1 | 50.0 | 25.4% | 9.0% | 0.0% | 1.5% | 92.2 | 142.9 |
| laser 25s / round 75s | 381 | 28.9 | 53.0 | 19.2% | 5.8% | 0.0% | 1.3% | 92.2 | 135.9 |
| laser 20s / round 75s | 384 | 28.9 | 53.0 | 14.3% | 2.6% | 0.0% | 0.8% | 94.0 | 139.8 |
| laser 30s / round 60s | 386 | 29.8 | 40.0 | 66.3% | 23.6% | 0.0% | 4.7% | 85.4 | 131.3 |
| laser 25s / round 60s | 374 | 29.5 | 45.0 | 50.8% | 15.0% | 0.0% | 1.6% | 90.3 | 122.0 |
| laser 20s / round 60s | 367 | 29.9 | 47.9 | 38.4% | 9.8% | 0.0% | 1.4% | 89.4 | 129.1 |
| laser 35s / round 90s *(extension: earlier start)* | 390 | 30.9 | 54.3 | 13.6% | 4.1% | 0.0% | 1.8% | 96.8 | 143.3 |
| laser 40s / round 90s *(extension: earlier start)* | 389 | 30.9 | 54.3 | 18.5% | 5.4% | 0.0% | 1.8% | 96.1 | 143.2 |
| laser 45s / round 90s *(extension: earlier start)* | 395 | 30.8 | 50.0 | 27.1% | 5.6% | 0.0% | 2.5% | 96.7 | 138.6 |
| laser 50s / round 90s *(extension: earlier start)* | 388 | 30.9 | 47.5 | 42.5% | 8.5% | 0.0% | 1.5% | 96.1 | 132.6 |

**How deep the lasers got** — percentage of greedy vs greedy rounds reaching at least each inset:

| Cell | ≥ 1 | ≥ 2 | ≥ 3 | ≥ 4 | ≥ 5 | ≥ 6 | ≥ 7 | ≥ 8 | ≥ 9 |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s | 8.0% | 3.4% | 2.3% | 1.0% | 0.5% | 0.5% | 0.5% | 0.0% | 0.0% |
| laser 25s / round 90s | 6.1% | 3.8% | 1.3% | 0.8% | 0.3% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 20s / round 90s | 5.6% | 2.8% | 0.8% | 0.3% | 0.3% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 30s / round 75s | 19.5% | 12.9% | 9.0% | 3.3% | 1.5% | 0.3% | 0.0% | 0.0% | 0.0% |
| laser 25s / round 75s | 14.2% | 9.4% | 5.8% | 3.9% | 1.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 20s / round 75s | 11.5% | 4.9% | 2.6% | 1.6% | 0.0% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 30s / round 60s | 54.1% | 38.1% | 23.6% | 11.1% | 4.9% | 1.3% | 0.0% | 0.0% | 0.0% |
| laser 25s / round 60s | 37.2% | 25.4% | 15.0% | 9.4% | 4.3% | 1.9% | 0.0% | 0.0% | 0.0% |
| laser 20s / round 60s | 30.0% | 20.7% | 9.8% | 2.7% | 0.3% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 35s / round 90s | 9.7% | 6.7% | 4.1% | 1.5% | 0.5% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 40s / round 90s | 13.6% | 8.5% | 5.4% | 3.9% | 1.3% | 0.0% | 0.0% | 0.0% | 0.0% |
| laser 45s / round 90s | 20.5% | 12.2% | 5.6% | 3.0% | 1.0% | 0.5% | 0.0% | 0.0% | 0.0% |
| laser 50s / round 90s | 27.6% | 18.3% | 8.5% | 4.4% | 2.6% | 1.3% | 0.5% | 0.0% | 0.0% |

### survivor vs survivor

| Cell | Rounds | Median round (s) | p90 round (s) | Reached warning | Reached inset ≥ 3 | Timeout | Draw | Median match (s) | p90 match (s) |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s **(baseline = shipping)** | 382 | 82.8 | 86.2 | 100.0% | 98.7% | 2.4% | 1.8% | 248.9 | 270.9 |
| laser 25s / round 90s | 386 | 85.3 | 90.0 | 100.0% | 97.7% | 15.8% | 6.5% | 252.0 | 281.8 |
| laser 20s / round 90s | 433 | 90.0 | 90.0 | 100.0% | 98.6% | 80.4% | 16.9% | 282.9 | 382.9 |
| laser 30s / round 75s | 371 | 63.2 | 71.4 | 100.0% | 100.0% | 3.5% | 2.7% | 151.3 | 220.1 |
| laser 25s / round 75s | 393 | 73.5 | 75.0 | 100.0% | 98.5% | 23.7% | 5.1% | 221.8 | 242.2 |
| laser 20s / round 75s | 436 | 75.0 | 75.0 | 99.8% | 98.9% | 74.1% | 13.3% | 237.9 | 322.9 |
| laser 30s / round 60s | 383 | 53.5 | 56.8 | 100.0% | 100.0% | 2.6% | 2.1% | 162.2 | 184.1 |
| laser 25s / round 60s | 383 | 50.3 | 60.0 | 100.0% | 74.4% | 14.4% | 4.7% | 152.6 | 190.2 |
| laser 20s / round 60s | 449 | 60.0 | 60.0 | 100.0% | 99.6% | 82.0% | 14.9% | 193.1 | 262.9 |
| laser 35s / round 90s *(extension: earlier start)* | 400 | 77.7 | 81.6 | 100.0% | 99.3% | 1.0% | 5.0% | 239.6 | 267.4 |
| laser 40s / round 90s *(extension: earlier start)* | 396 | 73.4 | 76.8 | 100.0% | 99.2% | 0.8% | 3.8% | 229.1 | 245.4 |
| laser 45s / round 90s *(extension: earlier start)* | 363 | 60.2 | 70.1 | 100.0% | 99.2% | 0.8% | 1.7% | 145.2 | 221.8 |
| laser 50s / round 90s *(extension: earlier start)* | 388 | 63.2 | 66.7 | 100.0% | 99.0% | 1.0% | 3.1% | 192.3 | 215.8 |

**How deep the lasers got** — percentage of survivor vs survivor rounds reaching at least each inset:

| Cell | ≥ 1 | ≥ 2 | ≥ 3 | ≥ 4 | ≥ 5 | ≥ 6 | ≥ 7 | ≥ 8 | ≥ 9 |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s | 99.7% | 99.5% | 98.7% | 98.2% | 97.4% | 90.8% | 88.7% | 67.0% | 29.1% |
| laser 25s / round 90s | 99.7% | 99.2% | 97.7% | 96.9% | 96.1% | 71.8% | 67.9% | 55.4% | 26.7% |
| laser 20s / round 90s | 100.0% | 99.3% | 98.6% | 98.4% | 97.0% | 93.8% | 92.6% | 0.0% | 0.0% |
| laser 30s / round 75s | 100.0% | 100.0% | 100.0% | 100.0% | 99.5% | 67.7% | 64.7% | 55.8% | 28.8% |
| laser 25s / round 75s | 99.5% | 99.5% | 98.5% | 98.5% | 96.9% | 94.1% | 91.9% | 78.1% | 38.4% |
| laser 20s / round 75s | 99.8% | 99.5% | 98.9% | 98.6% | 98.4% | 95.2% | 86.7% | 0.0% | 0.0% |
| laser 30s / round 60s | 100.0% | 100.0% | 100.0% | 99.5% | 97.9% | 94.5% | 91.9% | 79.6% | 42.3% |
| laser 25s / round 60s | 100.0% | 100.0% | 74.4% | 73.9% | 70.5% | 66.3% | 59.8% | 54.6% | 26.6% |
| laser 20s / round 60s | 100.0% | 99.8% | 99.6% | 99.6% | 99.1% | 95.8% | 93.8% | 0.0% | 0.0% |
| laser 35s / round 90s | 100.0% | 99.8% | 99.3% | 99.0% | 98.5% | 91.5% | 79.8% | 67.8% | 39.3% |
| laser 40s / round 90s | 100.0% | 99.5% | 99.2% | 99.0% | 96.5% | 92.7% | 91.7% | 76.8% | 35.4% |
| laser 45s / round 90s | 100.0% | 100.0% | 99.2% | 98.6% | 97.5% | 56.5% | 51.8% | 44.4% | 19.8% |
| laser 50s / round 90s | 99.7% | 99.5% | 99.0% | 98.7% | 97.9% | 95.1% | 94.6% | 81.7% | 37.6% |

### greedy vs survivor

| Cell | Rounds | Median round (s) | p90 round (s) | Reached warning | Reached inset ≥ 3 | Timeout | Draw | Median match (s) | p90 match (s) |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s **(baseline = shipping)** | 332 | 47.7 | 70.5 | 42.2% | 20.5% | 0.0% | 0.0% | 117.6 | 158.4 |
| laser 25s / round 90s | 333 | 47.7 | 74.5 | 37.2% | 14.1% | 0.0% | 0.0% | 119.1 | 161.9 |
| laser 20s / round 90s | 334 | 47.7 | 77.5 | 32.3% | 10.8% | 0.0% | 0.0% | 120.1 | 177.3 |
| laser 30s / round 75s | 330 | 43.7 | 58.9 | 64.8% | 32.1% | 0.0% | 0.0% | 101.8 | 151.3 |
| laser 25s / round 75s | 330 | 43.5 | 64.3 | 56.1% | 28.8% | 0.0% | 0.0% | 108.3 | 153.0 |
| laser 20s / round 75s | 333 | 43.7 | 66.5 | 51.7% | 22.2% | 0.0% | 0.3% | 111.5 | 165.0 |
| laser 30s / round 60s | 328 | 35.7 | 45.2 | 83.2% | 48.2% | 0.0% | 0.0% | 87.6 | 125.0 |
| laser 25s / round 60s | 331 | 40.0 | 50.0 | 76.7% | 41.4% | 0.0% | 0.0% | 93.3 | 134.6 |
| laser 20s / round 60s | 334 | 44.0 | 55.0 | 70.1% | 37.4% | 1.2% | 0.0% | 98.1 | 149.2 |
| laser 35s / round 90s *(extension: earlier start)* | 332 | 47.2 | 66.9 | 49.1% | 25.0% | 0.0% | 0.0% | 111.0 | 155.3 |
| laser 40s / round 90s *(extension: earlier start)* | 335 | 46.3 | 65.0 | 58.5% | 27.5% | 0.0% | 0.0% | 113.5 | 150.8 |
| laser 45s / round 90s *(extension: earlier start)* | 335 | 47.0 | 60.0 | 66.3% | 37.9% | 0.0% | 0.0% | 110.9 | 149.6 |
| laser 50s / round 90s *(extension: earlier start)* | 341 | 45.0 | 55.2 | 76.5% | 43.1% | 0.0% | 0.0% | 106.3 | 149.2 |

**How deep the lasers got** — percentage of greedy vs survivor rounds reaching at least each inset:

| Cell | ≥ 1 | ≥ 2 | ≥ 3 | ≥ 4 | ≥ 5 | ≥ 6 | ≥ 7 | ≥ 8 | ≥ 9 |
|---|---|---|---|---|---|---|---|---|---|
| laser 30s / round 90s | 37.3% | 27.7% | 20.5% | 12.3% | 7.2% | 3.6% | 1.8% | 0.0% | 0.0% |
| laser 25s / round 90s | 28.8% | 20.1% | 14.1% | 7.5% | 3.9% | 2.7% | 0.9% | 0.0% | 0.0% |
| laser 20s / round 90s | 24.3% | 14.4% | 10.8% | 5.1% | 3.0% | 1.2% | 0.0% | 0.0% | 0.0% |
| laser 30s / round 75s | 54.8% | 42.4% | 32.1% | 24.5% | 14.8% | 9.7% | 3.6% | 0.0% | 0.0% |
| laser 25s / round 75s | 47.9% | 37.3% | 28.8% | 19.4% | 14.5% | 7.6% | 3.3% | 0.0% | 0.0% |
| laser 20s / round 75s | 44.7% | 30.0% | 22.2% | 14.4% | 9.3% | 4.2% | 0.6% | 0.0% | 0.0% |
| laser 30s / round 60s | 75.9% | 59.1% | 48.2% | 33.8% | 18.6% | 10.7% | 6.1% | 0.3% | 0.0% |
| laser 25s / round 60s | 69.5% | 55.0% | 41.4% | 29.9% | 19.9% | 10.6% | 4.5% | 1.2% | 0.0% |
| laser 20s / round 60s | 62.3% | 50.9% | 37.4% | 24.6% | 20.4% | 11.1% | 4.2% | 0.0% | 0.0% |
| laser 35s / round 90s | 42.5% | 33.4% | 25.0% | 15.7% | 8.7% | 5.1% | 1.2% | 0.6% | 0.0% |
| laser 40s / round 90s | 50.1% | 35.5% | 27.5% | 23.0% | 16.4% | 6.6% | 3.3% | 0.3% | 0.0% |
| laser 45s / round 90s | 59.1% | 49.9% | 37.9% | 25.7% | 17.9% | 9.9% | 3.9% | 0.6% | 0.0% |
| laser 50s / round 90s | 66.0% | 52.2% | 43.1% | 29.6% | 20.2% | 10.9% | 4.1% | 1.5% | 0.0% |

## What the earlier-start arm shows

KI-04-03 extended `laserStartTime` to 35, 40, 45 and 50 s to find where the lever turns
over. Reading the arm back, at the shipping round length:

- **greedy vs greedy:** 30 s → 9.5%, 35 s → 13.6%, 40 s → 18.5%, 45 s → 27.1%, 50 s → 42.5%. **Still climbing at 50 s** — the lever does not turn over anywhere in the measured range. Median round over the same span: 30.8 s → 30.9 s.
- **survivor vs survivor:** 30 s → 100.0%, 35 s → 100.0%, 40 s → 100.0%, 45 s → 100.0%, 50 s → 100.0%. Already at the ceiling at the shipping value, so this arm says nothing about the warning rate here — read the match wall-clock column instead. Median round over the same span: 82.8 s → 63.2 s.
- **greedy vs survivor:** 30 s → 42.2%, 35 s → 49.1%, 40 s → 58.5%, 45 s → 66.3%, 50 s → 76.5%. **Still climbing at 50 s** — the lever does not turn over anywhere in the measured range. Median round over the same span: 47.7 s → 45.0 s.

Two things follow, and the second matters more than the first. **The climax fraction is bought without
lengthening the round** — the median round barely moves across the whole arm, because `laserStartTime` changes
*when* the arena starts closing rather than how long the round lasts. And a lever still climbing at the top of
its measured range has not been bounded: if a value beyond the largest cell here is wanted, it needs measuring,
not extrapolating.

## Machine-readable data

The exact numbers above, one object per cell, plus the reconciliation rows. Everything here is a pure function
of the seeds named above and the deterministic simulation they drive — regenerating this document should
reproduce this block byte for byte (the date and the wall time are deliberately excluded, for exactly that
reason).

`tests/agent/pacing.test.js` diffs against this block on every `npm run test:unit`. What it checks is what
can honestly be checked without a browser: that the block parses, that every cell carries the fields AC2 names
and meets the ticket's 300-round floor or is listed as dropped, that the rendered tables above agree with it,
that the rates are internally consistent, and that every reconciliation row agrees. It cannot recompute these
numbers — that needs Chromium and the command at the top of this document — which is exactly the difference
between this document and `gate1-bot-matrix.md`, whose cells are headless and *are* recomputed on every push.

```json
{
  "seedsPerCell": 150,
  "renderEveryNFrames": 1200,
  "climaxInset": 3,
  "maxLaserInset": 9,
  "droppedCells": [],
  "cells": [
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 30,
      "roundDuration": 90,
      "isBaseline": true,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 388,
      "p1Wins": 200,
      "p2Wins": 183,
      "draws": 5,
      "drawRatePct": 1.2886597938144329,
      "deathCount": 388,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 37,
      "reachedWarningRatePct": 9.536082474226804,
      "reachedClimaxInsetCount": 9,
      "reachedClimaxInsetRatePct": 2.3195876288659796,
      "reachedInsetAtLeastRatePct": [
        100,
        7.989690721649484,
        3.350515463917526,
        2.3195876288659796,
        1.0309278350515463,
        0.5154639175257731,
        0.5154639175257731,
        0.5154639175257731,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.833333333333332,
        "p90Seconds": 54.266666666666666,
        "meanSeconds": 32.899205326460475,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 82.16666666666667
      },
      "matchWallClock": {
        "medianSeconds": 96.78333333333333,
        "p90Seconds": 143.21666666666667,
        "meanSeconds": 101.4395555555556
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 25,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 392,
      "p1Wins": 198,
      "p2Wins": 187,
      "draws": 7,
      "drawRatePct": 1.7857142857142856,
      "deathCount": 392,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 28,
      "reachedWarningRatePct": 7.142857142857142,
      "reachedClimaxInsetCount": 5,
      "reachedClimaxInsetRatePct": 1.2755102040816326,
      "reachedInsetAtLeastRatePct": [
        100,
        6.122448979591836,
        3.826530612244898,
        1.2755102040816326,
        0.7653061224489796,
        0.25510204081632654,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.833333333333332,
        "p90Seconds": 53.86666666666667,
        "meanSeconds": 33.02323554421769,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 80
      },
      "matchWallClock": {
        "medianSeconds": 97.95,
        "p90Seconds": 144.05,
        "meanSeconds": 102.8094444444445
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 20,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 395,
      "p1Wins": 199,
      "p2Wins": 187,
      "draws": 9,
      "drawRatePct": 2.278481012658228,
      "deathCount": 395,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 27,
      "reachedWarningRatePct": 6.8354430379746836,
      "reachedClimaxInsetCount": 3,
      "reachedClimaxInsetRatePct": 0.7594936708860759,
      "reachedInsetAtLeastRatePct": [
        100,
        5.5696202531645564,
        2.7848101265822782,
        0.7594936708860759,
        0.25316455696202533,
        0.25316455696202533,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.833333333333332,
        "p90Seconds": 53.86666666666667,
        "meanSeconds": 33.10476793248945,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 85
      },
      "matchWallClock": {
        "medianSeconds": 97.95,
        "p90Seconds": 144.05,
        "meanSeconds": 103.81100000000006
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 30,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 389,
      "p1Wins": 202,
      "p2Wins": 181,
      "draws": 6,
      "drawRatePct": 1.5424164524421593,
      "deathCount": 389,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 99,
      "reachedWarningRatePct": 25.449871465295633,
      "reachedClimaxInsetCount": 35,
      "reachedClimaxInsetRatePct": 8.997429305912597,
      "reachedInsetAtLeastRatePct": [
        100,
        19.53727506426735,
        12.853470437017995,
        8.997429305912597,
        3.3419023136246784,
        1.5424164524421593,
        0.2570694087403599,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 29.116666666666667,
        "p90Seconds": 50,
        "meanSeconds": 30.57328620394175,
        "minSeconds": 2.8333333333333335,
        "maxSeconds": 62.5
      },
      "matchWallClock": {
        "medianSeconds": 92.15,
        "p90Seconds": 142.88333333333333,
        "meanSeconds": 95.66866666666665
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 25,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 381,
      "p1Wins": 195,
      "p2Wins": 181,
      "draws": 5,
      "drawRatePct": 1.3123359580052494,
      "deathCount": 381,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 73,
      "reachedWarningRatePct": 19.160104986876643,
      "reachedClimaxInsetCount": 22,
      "reachedClimaxInsetRatePct": 5.774278215223097,
      "reachedInsetAtLeastRatePct": [
        100,
        14.173228346456693,
        9.448818897637794,
        5.774278215223097,
        3.937007874015748,
        1.0498687664041995,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 28.933333333333334,
        "p90Seconds": 53,
        "meanSeconds": 30.861220472440955,
        "minSeconds": 2.8333333333333335,
        "maxSeconds": 65.2
      },
      "matchWallClock": {
        "medianSeconds": 92.15,
        "p90Seconds": 135.9,
        "meanSeconds": 94.43266666666663
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 20,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 384,
      "p1Wins": 197,
      "p2Wins": 184,
      "draws": 3,
      "drawRatePct": 0.78125,
      "deathCount": 384,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 55,
      "reachedWarningRatePct": 14.322916666666666,
      "reachedClimaxInsetCount": 10,
      "reachedClimaxInsetRatePct": 2.604166666666667,
      "reachedInsetAtLeastRatePct": [
        100,
        11.458333333333332,
        4.947916666666666,
        2.604166666666667,
        1.5625,
        0,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 28.933333333333334,
        "p90Seconds": 53,
        "meanSeconds": 31.063346354166672,
        "minSeconds": 2.8333333333333335,
        "maxSeconds": 69.33333333333333
      },
      "matchWallClock": {
        "medianSeconds": 94,
        "p90Seconds": 139.83333333333334,
        "meanSeconds": 95.69366666666664
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 30,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 386,
      "p1Wins": 167,
      "p2Wins": 201,
      "draws": 18,
      "drawRatePct": 4.66321243523316,
      "deathCount": 386,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 256,
      "reachedWarningRatePct": 66.32124352331607,
      "reachedClimaxInsetCount": 91,
      "reachedClimaxInsetRatePct": 23.57512953367876,
      "reachedInsetAtLeastRatePct": [
        100,
        54.145077720207254,
        38.082901554404145,
        23.57512953367876,
        11.139896373056994,
        4.922279792746114,
        1.2953367875647668,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 29.833333333333332,
        "p90Seconds": 40,
        "meanSeconds": 28.52642487046632,
        "minSeconds": 3.3333333333333335,
        "maxSeconds": 47.5
      },
      "matchWallClock": {
        "medianSeconds": 85.4,
        "p90Seconds": 131.28333333333333,
        "meanSeconds": 89.66366666666661
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 25,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 374,
      "p1Wins": 172,
      "p2Wins": 196,
      "draws": 6,
      "drawRatePct": 1.6042780748663104,
      "deathCount": 374,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 190,
      "reachedWarningRatePct": 50.80213903743316,
      "reachedClimaxInsetCount": 56,
      "reachedClimaxInsetRatePct": 14.973262032085561,
      "reachedInsetAtLeastRatePct": [
        100,
        37.16577540106952,
        25.40106951871658,
        14.973262032085561,
        9.358288770053475,
        4.27807486631016,
        1.8716577540106951,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 29.5,
        "p90Seconds": 45,
        "meanSeconds": 29.58897058823531,
        "minSeconds": 3.3333333333333335,
        "maxSeconds": 54.333333333333336
      },
      "matchWallClock": {
        "medianSeconds": 90.33333333333333,
        "p90Seconds": 121.95,
        "meanSeconds": 89.52566666666665
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 20,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 367,
      "p1Wins": 157,
      "p2Wins": 205,
      "draws": 5,
      "drawRatePct": 1.3623978201634876,
      "deathCount": 367,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 141,
      "reachedWarningRatePct": 38.41961852861036,
      "reachedClimaxInsetCount": 36,
      "reachedClimaxInsetRatePct": 9.809264305177113,
      "reachedInsetAtLeastRatePct": [
        100,
        29.972752043596728,
        20.708446866485016,
        9.809264305177113,
        2.7247956403269753,
        0.2724795640326975,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 29.866666666666667,
        "p90Seconds": 47.93333333333333,
        "meanSeconds": 30.861285195277024,
        "minSeconds": 3.3333333333333335,
        "maxSeconds": 55
      },
      "matchWallClock": {
        "medianSeconds": 89.4,
        "p90Seconds": 129.08333333333334,
        "meanSeconds": 90.96300000000004
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 35,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 390,
      "p1Wins": 196,
      "p2Wins": 187,
      "draws": 7,
      "drawRatePct": 1.7948717948717947,
      "deathCount": 390,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 53,
      "reachedWarningRatePct": 13.58974358974359,
      "reachedClimaxInsetCount": 16,
      "reachedClimaxInsetRatePct": 4.102564102564102,
      "reachedInsetAtLeastRatePct": [
        100,
        9.743589743589745,
        6.666666666666667,
        4.102564102564102,
        1.5384615384615385,
        0.5128205128205128,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.933333333333334,
        "p90Seconds": 54.266666666666666,
        "meanSeconds": 32.65668803418803,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 70
      },
      "matchWallClock": {
        "medianSeconds": 96.78333333333333,
        "p90Seconds": 143.31666666666666,
        "meanSeconds": 101.33188888888893
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 40,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 389,
      "p1Wins": 198,
      "p2Wins": 184,
      "draws": 7,
      "drawRatePct": 1.7994858611825193,
      "deathCount": 389,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 72,
      "reachedWarningRatePct": 18.50899742930591,
      "reachedClimaxInsetCount": 21,
      "reachedClimaxInsetRatePct": 5.3984575835475574,
      "reachedInsetAtLeastRatePct": [
        100,
        13.624678663239074,
        8.483290488431876,
        5.3984575835475574,
        3.8560411311053984,
        1.2853470437017995,
        0,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.933333333333334,
        "p90Seconds": 54.266666666666666,
        "meanSeconds": 32.48091259640102,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 65.83333333333333
      },
      "matchWallClock": {
        "medianSeconds": 96.1,
        "p90Seconds": 143.21666666666667,
        "meanSeconds": 100.61622222222223
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 45,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 395,
      "p1Wins": 194,
      "p2Wins": 191,
      "draws": 10,
      "drawRatePct": 2.5316455696202533,
      "deathCount": 395,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 107,
      "reachedWarningRatePct": 27.088607594936708,
      "reachedClimaxInsetCount": 22,
      "reachedClimaxInsetRatePct": 5.5696202531645564,
      "reachedInsetAtLeastRatePct": [
        100,
        20.506329113924053,
        12.151898734177214,
        5.5696202531645564,
        3.0379746835443036,
        1.0126582278481013,
        0.5063291139240507,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.833333333333332,
        "p90Seconds": 50,
        "meanSeconds": 31.91109704641349,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 62.5
      },
      "matchWallClock": {
        "medianSeconds": 96.73333333333333,
        "p90Seconds": 138.55,
        "meanSeconds": 100.66733333333337
      }
    },
    {
      "pairing": "greedy vs greedy",
      "laserStartTime": 50,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 388,
      "p1Wins": 199,
      "p2Wins": 183,
      "draws": 6,
      "drawRatePct": 1.5463917525773196,
      "deathCount": 388,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 165,
      "reachedWarningRatePct": 42.52577319587629,
      "reachedClimaxInsetCount": 33,
      "reachedClimaxInsetRatePct": 8.505154639175258,
      "reachedInsetAtLeastRatePct": [
        100,
        27.577319587628867,
        18.298969072164947,
        8.505154639175258,
        4.381443298969072,
        2.5773195876288657,
        1.2886597938144329,
        0.5154639175257731,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 30.933333333333334,
        "p90Seconds": 47.5,
        "meanSeconds": 31.431743986254286,
        "minSeconds": 3.1666666666666665,
        "maxSeconds": 60.333333333333336
      },
      "matchWallClock": {
        "medianSeconds": 96.1,
        "p90Seconds": 132.55,
        "meanSeconds": 97.6434444444445
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 30,
      "roundDuration": 90,
      "isBaseline": true,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 382,
      "p1Wins": 137,
      "p2Wins": 238,
      "draws": 7,
      "drawRatePct": 1.832460732984293,
      "deathCount": 373,
      "timeoutCount": 9,
      "deathRatePct": 97.64397905759162,
      "timeoutRatePct": 2.356020942408377,
      "reachedWarningCount": 382,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 377,
      "reachedClimaxInsetRatePct": 98.69109947643979,
      "reachedInsetAtLeastRatePct": [
        100,
        99.73821989528795,
        99.47643979057592,
        98.69109947643979,
        98.1675392670157,
        97.38219895287958,
        90.83769633507853,
        88.7434554973822,
        67.01570680628272,
        29.05759162303665
      ],
      "roundLength": {
        "medianSeconds": 82.76666666666667,
        "p90Seconds": 86.16666666666667,
        "meanSeconds": 81.61219458987797,
        "minSeconds": 64.83333333333333,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 248.95,
        "p90Seconds": 270.8833333333333,
        "meanSeconds": 223.8906666666668
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 25,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 386,
      "p1Wins": 126,
      "p2Wins": 235,
      "draws": 25,
      "drawRatePct": 6.476683937823833,
      "deathCount": 325,
      "timeoutCount": 61,
      "deathRatePct": 84.19689119170984,
      "timeoutRatePct": 15.803108808290157,
      "reachedWarningCount": 386,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 377,
      "reachedClimaxInsetRatePct": 97.66839378238342,
      "reachedInsetAtLeastRatePct": [
        100,
        99.74093264248705,
        99.22279792746113,
        97.66839378238342,
        96.89119170984456,
        96.11398963730569,
        71.76165803108809,
        67.87564766839378,
        55.44041450777202,
        26.683937823834196
      ],
      "roundLength": {
        "medianSeconds": 85.26666666666667,
        "p90Seconds": 90,
        "meanSeconds": 83.97189119171001,
        "minSeconds": 65.16666666666667,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 252.04999999999998,
        "p90Seconds": 281.75,
        "meanSeconds": 232.10555555555567
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 20,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 433,
      "p1Wins": 180,
      "p2Wins": 180,
      "draws": 73,
      "drawRatePct": 16.859122401847575,
      "deathCount": 85,
      "timeoutCount": 348,
      "deathRatePct": 19.630484988452658,
      "timeoutRatePct": 80.36951501154735,
      "reachedWarningCount": 433,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 427,
      "reachedClimaxInsetRatePct": 98.61431870669746,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        99.30715935334872,
        98.61431870669746,
        98.38337182448036,
        96.99769053117782,
        93.76443418013857,
        92.60969976905312,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 90,
        "p90Seconds": 90,
        "meanSeconds": 88.8051963048499,
        "minSeconds": 75.16666666666667,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 282.95,
        "p90Seconds": 382.93333333333334,
        "meanSeconds": 273.23177777777795
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 30,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 371,
      "p1Wins": 117,
      "p2Wins": 244,
      "draws": 10,
      "drawRatePct": 2.6954177897574128,
      "deathCount": 358,
      "timeoutCount": 13,
      "deathRatePct": 96.49595687331536,
      "timeoutRatePct": 3.5040431266846364,
      "reachedWarningCount": 371,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 371,
      "reachedClimaxInsetRatePct": 100,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        100,
        100,
        100,
        99.46091644204851,
        67.65498652291106,
        64.6900269541779,
        55.79514824797843,
        28.84097035040431
      ],
      "roundLength": {
        "medianSeconds": 63.2,
        "p90Seconds": 71.43333333333334,
        "meanSeconds": 64.45101078167121,
        "minSeconds": 44.266666666666666,
        "maxSeconds": 75
      },
      "matchWallClock": {
        "medianSeconds": 151.26666666666665,
        "p90Seconds": 220.11666666666667,
        "meanSeconds": 174.98166666666674
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 25,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 393,
      "p1Wins": 186,
      "p2Wins": 187,
      "draws": 20,
      "drawRatePct": 5.089058524173027,
      "deathCount": 300,
      "timeoutCount": 93,
      "deathRatePct": 76.33587786259542,
      "timeoutRatePct": 23.66412213740458,
      "reachedWarningCount": 393,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 387,
      "reachedClimaxInsetRatePct": 98.47328244274809,
      "reachedInsetAtLeastRatePct": [
        100,
        99.49109414758269,
        99.49109414758269,
        98.47328244274809,
        98.47328244274809,
        96.94656488549617,
        94.14758269720102,
        91.85750636132316,
        78.11704834605598,
        38.42239185750636
      ],
      "roundLength": {
        "medianSeconds": 73.5,
        "p90Seconds": 75,
        "meanSeconds": 71.46164122137407,
        "minSeconds": 47.666666666666664,
        "maxSeconds": 75
      },
      "matchWallClock": {
        "medianSeconds": 221.78333333333333,
        "p90Seconds": 242.2,
        "meanSeconds": 203.41777777777781
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 20,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 436,
      "p1Wins": 190,
      "p2Wins": 188,
      "draws": 58,
      "drawRatePct": 13.302752293577983,
      "deathCount": 113,
      "timeoutCount": 323,
      "deathRatePct": 25.91743119266055,
      "timeoutRatePct": 74.08256880733946,
      "reachedWarningCount": 435,
      "reachedWarningRatePct": 99.77064220183486,
      "reachedClimaxInsetCount": 431,
      "reachedClimaxInsetRatePct": 98.85321100917432,
      "reachedInsetAtLeastRatePct": [
        100,
        99.77064220183486,
        99.54128440366972,
        98.85321100917432,
        98.62385321100918,
        98.39449541284404,
        95.18348623853211,
        86.69724770642202,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 75,
        "p90Seconds": 75,
        "meanSeconds": 73.60896406727835,
        "minSeconds": 44.266666666666666,
        "maxSeconds": 75
      },
      "matchWallClock": {
        "medianSeconds": 237.95,
        "p90Seconds": 322.93333333333334,
        "meanSeconds": 231.0611111111114
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 30,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 383,
      "p1Wins": 177,
      "p2Wins": 198,
      "draws": 8,
      "drawRatePct": 2.088772845953003,
      "deathCount": 373,
      "timeoutCount": 10,
      "deathRatePct": 97.38903394255874,
      "timeoutRatePct": 2.610966057441253,
      "reachedWarningCount": 383,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 383,
      "reachedClimaxInsetRatePct": 100,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        100,
        100,
        99.47780678851174,
        97.911227154047,
        94.51697127937337,
        91.90600522193212,
        79.63446475195822,
        42.297650130548305
      ],
      "roundLength": {
        "medianSeconds": 53.5,
        "p90Seconds": 56.833333333333336,
        "meanSeconds": 52.40739773716277,
        "minSeconds": 35.166666666666664,
        "maxSeconds": 60
      },
      "matchWallClock": {
        "medianSeconds": 162.21666666666667,
        "p90Seconds": 184.11666666666667,
        "meanSeconds": 149.90322222222215
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 25,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 383,
      "p1Wins": 245,
      "p2Wins": 120,
      "draws": 18,
      "drawRatePct": 4.699738903394255,
      "deathCount": 328,
      "timeoutCount": 55,
      "deathRatePct": 85.6396866840731,
      "timeoutRatePct": 14.360313315926893,
      "reachedWarningCount": 383,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 285,
      "reachedClimaxInsetRatePct": 74.41253263707573,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        100,
        74.41253263707573,
        73.89033942558747,
        70.49608355091384,
        66.31853785900783,
        59.7911227154047,
        54.56919060052219,
        26.631853785900784
      ],
      "roundLength": {
        "medianSeconds": 50.266666666666666,
        "p90Seconds": 60,
        "meanSeconds": 51.63233246301128,
        "minSeconds": 35.166666666666664,
        "maxSeconds": 60
      },
      "matchWallClock": {
        "medianSeconds": 152.55,
        "p90Seconds": 190.15,
        "meanSeconds": 147.74933333333348
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 20,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 449,
      "p1Wins": 199,
      "p2Wins": 183,
      "draws": 67,
      "drawRatePct": 14.92204899777283,
      "deathCount": 81,
      "timeoutCount": 368,
      "deathRatePct": 18.040089086859687,
      "timeoutRatePct": 81.9599109131403,
      "reachedWarningCount": 449,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 447,
      "reachedClimaxInsetRatePct": 99.55456570155901,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        99.77728285077951,
        99.55456570155901,
        99.55456570155901,
        99.10913140311804,
        95.7683741648107,
        93.76391982182628,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 60,
        "p90Seconds": 60,
        "meanSeconds": 58.86978470675578,
        "minSeconds": 40.166666666666664,
        "maxSeconds": 60
      },
      "matchWallClock": {
        "medianSeconds": 193.05,
        "p90Seconds": 262.93333333333334,
        "meanSeconds": 193.6936666666669
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 35,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 400,
      "p1Wins": 209,
      "p2Wins": 171,
      "draws": 20,
      "drawRatePct": 5,
      "deathCount": 396,
      "timeoutCount": 4,
      "deathRatePct": 99,
      "timeoutRatePct": 1,
      "reachedWarningCount": 400,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 397,
      "reachedClimaxInsetRatePct": 99.25,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        99.75,
        99.25,
        99,
        98.5,
        91.5,
        79.75,
        67.75,
        39.25
      ],
      "roundLength": {
        "medianSeconds": 77.66666666666667,
        "p90Seconds": 81.6,
        "meanSeconds": 76.82941666666675,
        "minSeconds": 55.266666666666666,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 239.61666666666667,
        "p90Seconds": 267.3666666666667,
        "meanSeconds": 221.70744444444452
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 40,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 396,
      "p1Wins": 175,
      "p2Wins": 206,
      "draws": 15,
      "drawRatePct": 3.787878787878788,
      "deathCount": 393,
      "timeoutCount": 3,
      "deathRatePct": 99.24242424242425,
      "timeoutRatePct": 0.7575757575757576,
      "reachedWarningCount": 396,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 393,
      "reachedClimaxInsetRatePct": 99.24242424242425,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        99.4949494949495,
        99.24242424242425,
        98.98989898989899,
        96.46464646464646,
        92.67676767676768,
        91.66666666666666,
        76.76767676767676,
        35.35353535353536
      ],
      "roundLength": {
        "medianSeconds": 73.43333333333334,
        "p90Seconds": 76.83333333333333,
        "meanSeconds": 72.25896464646468,
        "minSeconds": 55.166666666666664,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 229.11666666666667,
        "p90Seconds": 245.38333333333333,
        "meanSeconds": 207.42799999999997
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 45,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 363,
      "p1Wins": 85,
      "p2Wins": 272,
      "draws": 6,
      "drawRatePct": 1.6528925619834711,
      "deathCount": 360,
      "timeoutCount": 3,
      "deathRatePct": 99.17355371900827,
      "timeoutRatePct": 0.8264462809917356,
      "reachedWarningCount": 363,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 360,
      "reachedClimaxInsetRatePct": 99.17355371900827,
      "reachedInsetAtLeastRatePct": [
        100,
        100,
        100,
        99.17355371900827,
        98.62258953168043,
        97.52066115702479,
        56.473829201101935,
        51.790633608815426,
        44.352617079889804,
        19.834710743801654
      ],
      "roundLength": {
        "medianSeconds": 60.166666666666664,
        "p90Seconds": 70.1,
        "meanSeconds": 63.696005509641935,
        "minSeconds": 45.333333333333336,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 145.23333333333332,
        "p90Seconds": 221.78333333333333,
        "meanSeconds": 169.41900000000012
      }
    },
    {
      "pairing": "survivor vs survivor",
      "laserStartTime": 50,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 388,
      "p1Wins": 159,
      "p2Wins": 217,
      "draws": 12,
      "drawRatePct": 3.0927835051546393,
      "deathCount": 384,
      "timeoutCount": 4,
      "deathRatePct": 98.96907216494846,
      "timeoutRatePct": 1.0309278350515463,
      "reachedWarningCount": 388,
      "reachedWarningRatePct": 100,
      "reachedClimaxInsetCount": 384,
      "reachedClimaxInsetRatePct": 98.96907216494846,
      "reachedInsetAtLeastRatePct": [
        100,
        99.74226804123711,
        99.48453608247422,
        98.96907216494846,
        98.71134020618557,
        97.9381443298969,
        95.10309278350515,
        94.58762886597938,
        81.70103092783505,
        37.628865979381445
      ],
      "roundLength": {
        "medianSeconds": 63.166666666666664,
        "p90Seconds": 66.66666666666667,
        "meanSeconds": 62.58767182130589,
        "minSeconds": 40.166666666666664,
        "maxSeconds": 90
      },
      "matchWallClock": {
        "medianSeconds": 192.28333333333333,
        "p90Seconds": 215.78333333333333,
        "meanSeconds": 178.21711111111114
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 30,
      "roundDuration": 90,
      "isBaseline": true,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 332,
      "p1Wins": 34,
      "p2Wins": 298,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 332,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 140,
      "reachedWarningRatePct": 42.168674698795186,
      "reachedClimaxInsetCount": 68,
      "reachedClimaxInsetRatePct": 20.481927710843372,
      "reachedInsetAtLeastRatePct": [
        100,
        37.34939759036144,
        27.710843373493976,
        20.481927710843372,
        12.349397590361445,
        7.228915662650602,
        3.614457831325301,
        1.8072289156626504,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 47.666666666666664,
        "p90Seconds": 70.5,
        "meanSeconds": 47.07141064257026,
        "minSeconds": 5.5,
        "maxSeconds": 81.33333333333333
      },
      "matchWallClock": {
        "medianSeconds": 117.58333333333333,
        "p90Seconds": 158.45,
        "meanSeconds": 118.16633333333331
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 25,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 333,
      "p1Wins": 43,
      "p2Wins": 290,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 333,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 124,
      "reachedWarningRatePct": 37.23723723723724,
      "reachedClimaxInsetCount": 47,
      "reachedClimaxInsetRatePct": 14.114114114114114,
      "reachedInsetAtLeastRatePct": [
        100,
        28.82882882882883,
        20.12012012012012,
        14.114114114114114,
        7.5075075075075075,
        3.903903903903904,
        2.7027027027027026,
        0.9009009009009009,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 47.666666666666664,
        "p90Seconds": 74.5,
        "meanSeconds": 47.69041541541536,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 85
      },
      "matchWallClock": {
        "medianSeconds": 119.13333333333333,
        "p90Seconds": 161.91666666666666,
        "meanSeconds": 119.89655555555555
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 20,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 334,
      "p1Wins": 44,
      "p2Wins": 290,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 334,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 108,
      "reachedWarningRatePct": 32.33532934131736,
      "reachedClimaxInsetCount": 36,
      "reachedClimaxInsetRatePct": 10.778443113772456,
      "reachedInsetAtLeastRatePct": [
        100,
        24.251497005988025,
        14.37125748502994,
        10.778443113772456,
        5.089820359281437,
        2.9940119760479043,
        1.1976047904191618,
        0,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 47.666666666666664,
        "p90Seconds": 77.5,
        "meanSeconds": 48.48802395209575,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 88
      },
      "matchWallClock": {
        "medianSeconds": 120.06666666666666,
        "p90Seconds": 177.31666666666666,
        "meanSeconds": 122.0326666666667
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 30,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 330,
      "p1Wins": 36,
      "p2Wins": 294,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 330,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 214,
      "reachedWarningRatePct": 64.84848484848484,
      "reachedClimaxInsetCount": 106,
      "reachedClimaxInsetRatePct": 32.121212121212125,
      "reachedInsetAtLeastRatePct": [
        100,
        54.848484848484844,
        42.42424242424242,
        32.121212121212125,
        24.545454545454547,
        14.84848484848485,
        9.696969696969697,
        3.6363636363636362,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 43.666666666666664,
        "p90Seconds": 58.93333333333333,
        "meanSeconds": 41.66805555555558,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 66.83333333333333
      },
      "matchWallClock": {
        "medianSeconds": 101.8,
        "p90Seconds": 151.31666666666666,
        "meanSeconds": 105.56677777777777
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 25,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 330,
      "p1Wins": 40,
      "p2Wins": 290,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 330,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 185,
      "reachedWarningRatePct": 56.060606060606055,
      "reachedClimaxInsetCount": 95,
      "reachedClimaxInsetRatePct": 28.78787878787879,
      "reachedInsetAtLeastRatePct": [
        100,
        47.878787878787875,
        37.27272727272727,
        28.78787878787879,
        19.393939393939394,
        14.545454545454545,
        7.575757575757576,
        3.3333333333333335,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 43.5,
        "p90Seconds": 64.33333333333333,
        "meanSeconds": 43.04219696969698,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 71.5
      },
      "matchWallClock": {
        "medianSeconds": 108.28333333333333,
        "p90Seconds": 152.98333333333332,
        "meanSeconds": 108.59011111111111
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 20,
      "roundDuration": 75,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 333,
      "p1Wins": 33,
      "p2Wins": 299,
      "draws": 1,
      "drawRatePct": 0.3003003003003003,
      "deathCount": 333,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 172,
      "reachedWarningRatePct": 51.651651651651655,
      "reachedClimaxInsetCount": 74,
      "reachedClimaxInsetRatePct": 22.22222222222222,
      "reachedInsetAtLeastRatePct": [
        100,
        44.74474474474475,
        30.03003003003003,
        22.22222222222222,
        14.414414414414415,
        9.30930930930931,
        4.2042042042042045,
        0.6006006006006006,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 43.666666666666664,
        "p90Seconds": 66.5,
        "meanSeconds": 44.55655655655657,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 75
      },
      "matchWallClock": {
        "medianSeconds": 111.46666666666667,
        "p90Seconds": 164.98333333333332,
        "meanSeconds": 112.9391111111111
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 30,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 328,
      "p1Wins": 39,
      "p2Wins": 289,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 328,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 273,
      "reachedWarningRatePct": 83.23170731707317,
      "reachedClimaxInsetCount": 158,
      "reachedClimaxInsetRatePct": 48.170731707317074,
      "reachedInsetAtLeastRatePct": [
        100,
        75.91463414634147,
        59.14634146341463,
        48.170731707317074,
        33.84146341463415,
        18.597560975609756,
        10.670731707317072,
        6.097560975609756,
        0.3048780487804878,
        0
      ],
      "roundLength": {
        "medianSeconds": 35.666666666666664,
        "p90Seconds": 45.166666666666664,
        "meanSeconds": 34.67045223577236,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 52.766666666666666
      },
      "matchWallClock": {
        "medianSeconds": 87.63333333333333,
        "p90Seconds": 124.98333333333333,
        "meanSeconds": 89.6257777777777
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 25,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 331,
      "p1Wins": 45,
      "p2Wins": 286,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 331,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 254,
      "reachedWarningRatePct": 76.73716012084593,
      "reachedClimaxInsetCount": 137,
      "reachedClimaxInsetRatePct": 41.389728096676734,
      "reachedInsetAtLeastRatePct": [
        100,
        69.48640483383686,
        54.98489425981873,
        41.389728096676734,
        29.909365558912388,
        19.939577039274926,
        10.574018126888216,
        4.531722054380665,
        1.2084592145015105,
        0
      ],
      "roundLength": {
        "medianSeconds": 40,
        "p90Seconds": 50,
        "meanSeconds": 37.55324773413896,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 57.833333333333336
      },
      "matchWallClock": {
        "medianSeconds": 93.3,
        "p90Seconds": 134.55,
        "meanSeconds": 96.80688888888886
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 20,
      "roundDuration": 60,
      "isBaseline": false,
      "isEarlierStartExtension": false,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 334,
      "p1Wins": 43,
      "p2Wins": 291,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 330,
      "timeoutCount": 4,
      "deathRatePct": 98.80239520958084,
      "timeoutRatePct": 1.1976047904191618,
      "reachedWarningCount": 234,
      "reachedWarningRatePct": 70.05988023952095,
      "reachedClimaxInsetCount": 125,
      "reachedClimaxInsetRatePct": 37.4251497005988,
      "reachedInsetAtLeastRatePct": [
        100,
        62.27544910179641,
        50.898203592814376,
        37.4251497005988,
        24.550898203592812,
        20.35928143712575,
        11.077844311377245,
        4.191616766467066,
        0,
        0
      ],
      "roundLength": {
        "medianSeconds": 44.03333333333333,
        "p90Seconds": 55,
        "meanSeconds": 39.37926646706585,
        "minSeconds": 5.166666666666667,
        "maxSeconds": 60
      },
      "matchWallClock": {
        "medianSeconds": 98.13333333333333,
        "p90Seconds": 149.15,
        "meanSeconds": 101.7347777777778
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 35,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 332,
      "p1Wins": 39,
      "p2Wins": 293,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 332,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 163,
      "reachedWarningRatePct": 49.096385542168676,
      "reachedClimaxInsetCount": 83,
      "reachedClimaxInsetRatePct": 25,
      "reachedInsetAtLeastRatePct": [
        100,
        42.46987951807229,
        33.433734939759034,
        25,
        15.66265060240964,
        8.734939759036145,
        5.120481927710843,
        1.2048192771084338,
        0.6024096385542169,
        0
      ],
      "roundLength": {
        "medianSeconds": 47.166666666666664,
        "p90Seconds": 66.93333333333334,
        "meanSeconds": 45.77417168674695,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 78.5
      },
      "matchWallClock": {
        "medianSeconds": 111.03333333333333,
        "p90Seconds": 155.35,
        "meanSeconds": 115.29522222222216
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 40,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 335,
      "p1Wins": 42,
      "p2Wins": 293,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 335,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 196,
      "reachedWarningRatePct": 58.507462686567166,
      "reachedClimaxInsetCount": 92,
      "reachedClimaxInsetRatePct": 27.46268656716418,
      "reachedInsetAtLeastRatePct": [
        100,
        50.14925373134328,
        35.52238805970149,
        27.46268656716418,
        22.98507462686567,
        16.417910447761194,
        6.567164179104477,
        3.2835820895522385,
        0.2985074626865672,
        0
      ],
      "roundLength": {
        "medianSeconds": 46.333333333333336,
        "p90Seconds": 65,
        "meanSeconds": 44.38504975124375,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 72.5
      },
      "matchWallClock": {
        "medianSeconds": 113.46666666666667,
        "p90Seconds": 150.81666666666666,
        "meanSeconds": 113.23477777777771
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 45,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 335,
      "p1Wins": 43,
      "p2Wins": 292,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 335,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 222,
      "reachedWarningRatePct": 66.26865671641791,
      "reachedClimaxInsetCount": 127,
      "reachedClimaxInsetRatePct": 37.91044776119403,
      "reachedInsetAtLeastRatePct": [
        100,
        59.1044776119403,
        49.850746268656714,
        37.91044776119403,
        25.671641791044774,
        17.91044776119403,
        9.850746268656717,
        3.880597014925373,
        0.5970149253731344,
        0
      ],
      "roundLength": {
        "medianSeconds": 47,
        "p90Seconds": 60,
        "meanSeconds": 43.14485074626863,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 67.5
      },
      "matchWallClock": {
        "medianSeconds": 110.89999999999999,
        "p90Seconds": 149.55,
        "meanSeconds": 110.46477777777771
      }
    },
    {
      "pairing": "greedy vs survivor",
      "laserStartTime": 50,
      "roundDuration": 90,
      "isBaseline": false,
      "isEarlierStartExtension": true,
      "matches": 150,
      "matchesFinished": 150,
      "rounds": 341,
      "p1Wins": 53,
      "p2Wins": 288,
      "draws": 0,
      "drawRatePct": 0,
      "deathCount": 341,
      "timeoutCount": 0,
      "deathRatePct": 100,
      "timeoutRatePct": 0,
      "reachedWarningCount": 261,
      "reachedWarningRatePct": 76.53958944281524,
      "reachedClimaxInsetCount": 147,
      "reachedClimaxInsetRatePct": 43.10850439882698,
      "reachedInsetAtLeastRatePct": [
        100,
        65.98240469208211,
        52.19941348973607,
        43.10850439882698,
        29.61876832844575,
        20.234604105571847,
        10.850439882697946,
        4.105571847507331,
        1.466275659824047,
        0
      ],
      "roundLength": {
        "medianSeconds": 45,
        "p90Seconds": 55.166666666666664,
        "meanSeconds": 40.799682306940355,
        "minSeconds": 6.333333333333333,
        "maxSeconds": 63.6
      },
      "matchWallClock": {
        "medianSeconds": 106.3,
        "p90Seconds": 149.21666666666667,
        "meanSeconds": 107.11177777777772
      }
    }
  ],
  "reconciliation": [
    {
      "pairing": "greedy vs greedy",
      "seedCount": 20,
      "agrees": true,
      "expected": {
        "rounds": 50,
        "reachedWarningCount": 6,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 33.37083333333333,
        "p90RoundSeconds": 59.266666666666666
      },
      "actual": {
        "rounds": 50,
        "reachedWarningCount": 6,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 33.37083333333333,
        "p90RoundSeconds": 59.266666666666666
      },
      "differences": []
    },
    {
      "pairing": "survivor vs survivor",
      "seedCount": 20,
      "agrees": true,
      "expected": {
        "rounds": 49,
        "reachedWarningCount": 49,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 81.29455782312927,
        "p90RoundSeconds": 85.33333333333333
      },
      "actual": {
        "rounds": 49,
        "reachedWarningCount": 49,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 81.29455782312927,
        "p90RoundSeconds": 85.33333333333333
      },
      "differences": []
    },
    {
      "pairing": "greedy vs survivor",
      "seedCount": 10,
      "agrees": true,
      "expected": {
        "rounds": 23,
        "reachedWarningCount": 11,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 47.12355072463768,
        "p90RoundSeconds": 75
      },
      "actual": {
        "rounds": 23,
        "reachedWarningCount": 11,
        "draws": 0,
        "timeoutCount": 0,
        "meanRoundSeconds": 47.12355072463768,
        "p90RoundSeconds": 75
      },
      "differences": []
    }
  ]
}
```
