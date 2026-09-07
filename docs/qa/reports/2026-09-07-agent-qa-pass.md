# Agent QA pass — 2026-09-07

**Build:** `main` @ `520b632`, production at https://kobisnake.vercel.app.
**Run by:** the design lead, in this repository, on a clean checkout.
**Why:** Gate 1's human sessions (KS-07-02) have not happened. This pass answers everything a machine can
answer without them, and it plays the game rather than only testing it.

## 1. The automated suite

Every check run serially on one machine, never two Playwright suites at once (the Sprint 06 finding on #86).

| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `COVERAGE_STRICT=1 npm run test:unit` | **643 passed**, 37 files |
| coverage | `src/core` **100 %** lines/functions · `src/game` 99.54 % · `src/render` 99.54 % |
| `npm run build` | 592.67 kB raw, **155.38 kB gzip** against `ARCHITECTURE §12`'s 350 kB budget |
| `npm run test:e2e` | **57 passed** (3.0 min) |
| `npm run test:visual` | **15 passed** (27.2 s) |

Nothing in the committed suite is red. The findings below all come from playing the build, not from it.

## 2. What "playing it" meant here

Three harnesses, all driving the **real production build** in a real Chromium at 1280×720 — through the real
`keydown` listener, the real session, the real state machine, and real renders. None of them touch
`src/core` directly, which is the point: the committed `tests/sim` suites already prove the simulation and
cannot see anything above it.

1. **Whole matches with a greedy bot.** Ten Best-of-3 matches played end to end, both players driven, with
   invariants checked on every simulated frame.
2. **A screen walk.** Main menu → match setup → START MATCH → countdown → round → laser warning → lasers →
   scoreboard → pause, driven by real key presses, photographed at each beat.
3. **A survival policy** that refuses to eat, so both snakes stay alive into the laser phase — a state the
   greedy bots almost never reach.

**Result of the ten matches: all ten completed, zero invariant failures, zero page errors.** Draw calls
measured 14–22 against `ARCHITECTURE §12`'s budget of 120. The invariants checked each frame were: segments
in bounds and integral, no self-overlap while alive, `length` agreeing with `segments`, `stepProgress` inside
[0, 1], positive finite `speedMultiplier`, non-negative `pendingGrowth`, finite non-negative `timeRemaining`,
no living head inside the laser dead zone, no apple underneath a snake, and HUD text agreeing with the
simulation.

## 3. Findings

### F1 — A match made of draws can never end *(major)*

**A Best-of-N match has no way to finish if every round draws, and two idle players draw every round.**

`match.js` records a draw as a played round and scores it to nobody — correct, `DESIGN-DECISIONS §2.5` row 7
says a draw is replayed. But `isOver()` is only ever true when somebody reaches the win target, and the
committed golden log fixes the no-input round as a `DRAW` at tick 380. A deterministic round replayed with
the same inputs draws again.

Demonstrated on the running build: a Best-of-3 started and then left alone played **12 rounds, every one a
`DRAW` at tick 380, score 0–0, `winner: null`**, and would have continued indefinitely. Nothing is stuck or
crashed — the scoreboard says "DRAW — REPLAY" each time and the next round starts — but the match cannot be
won, and the only exit is QUIT from the pause screen.

Two children who put the keyboard down reach this in ninety seconds. So do two evenly matched players who
keep colliding head-on at equal length, which `§2.5`'s own head-on rule makes a draw by design.

This needs a design ruling, not just code. Improvement sprint **I01**.

### F2 — Apples are hard to see, and they are the same colour as player one *(major, readability)*

At gameplay scale an apple is a small dark-red sphere on a two-tone green floor. In the captured frames the
apples are materially harder to pick out than the SPEED pedestal beside them, and **they share a hue with the
red snake** — the thing a player is also tracking, and the thing they must not confuse an apple with.

This is the same class of defect as the white-on-white SLOW pedestal that #105 fixed last night, and the
project already has the right instrument for it: KS-07-07 landed a WCAG relative-luminance assertion tying
the snowflake to its pedestal. Nothing yet ties **apple to floor**, or **apple to any player colour** — and
Sprint 14 adds six more unlockable colours, each of which could collide with the apple or with the opponent.

The GDD's own rule is "never rely on colour alone". Improvement sprint **I02**.

### F3 — The laser climax is skipped in most rounds *(design)*

The lasers are what the GDD calls the climax and what Gate 1 exists to judge. They are rarely reached.

Measured over the 27 rounds of the ten matches above, on the shipping defaults:

| | |
|---|---|
| Rounds that lasted 30 s or more (i.e. reached the warning) | **4 of 27 — 14.8 %** |
| Median round length | **16.0 s** |
| Mean round length | 20.3 s |
| p90 / longest round | 40.3 s / 62.7 s |
| Rounds decided by a death rather than the clock | 27 of 27 — 100 % |
| Draw rate | **7.4 %** (2 of 27) |
| Rounds per match | 2.7 |
| Whole-match playing time | 20 s to 92 s |

**Five rounds in six never see a laser.** That agrees with the committed matrix
(`docs/qa/playtests/gate1-bot-matrix.md`), where 75–79 % of `greedy vs survivor` rounds end before 0:30. A
mechanic four sprints were spent on is absent from most of the game.

Two other numbers in that table are worth the design lead's attention. `PLAYTEST-SCRIPT §5` asks for **at
least 85 % of rounds decided by death and a draw rate at or under 3 %**: the first is met outright at 100 %,
the second is missed at 7.4 %. And a whole Best-of-3 can be over in twenty seconds of play.

Bots die more cheaply than people, so this over-states the effect and is evidence rather than a verdict. But
the direction is not in doubt, it is now measurable on the real build, and two independent instruments agree.
Improvement sprint **I04**.

A wider sweep across Best-of-1/3/5 was attempted and abandoned: the Best-of-5 arm stopped finishing matches
inside the harness's step budget, which is F1 wearing a different hat — more rounds means more chances to
draw, and a drawn round is replayed. That sweep belongs in the permanent harness (KI-03-04), not in a
scratch script.

### F4 — Recorded and dismissed: the HUD lags the simulation by design

The first version of the invariant check reported 135 HUD/simulation mismatches per match. **It was wrong.**
`session.js` throttles HUD text to 10 Hz on purpose (`ARCHITECTURE §8`, `HUD_INTERVAL_SECONDS = 1/10`), so
the length readout may trail by up to 100 ms. The check now tolerates 0.25 s and reports nothing.

Written down because a future reader will re-derive this the same way, and because a 135-problem report that
turns out to be the design is exactly the sort of thing that gets a real finding ignored next to it.

### F5 — `__kobi.getSnapshot()` keeps serving a finished round *(minor, tooling)*

After `MATCH_OVER` the hook still returns the last round's snapshot, `timeRemaining` and all. A harness that
loops "until the clock reaches T" therefore spins forever once the match is over. It cost this pass one
wedged run. Not a player-facing defect; worth either a documented note or a `null`. Folded into **I03**.

### F6 — The first minute is mostly locked doors *(design)*

The main menu offers six items and **five are "COMING SOON"**. A new pair of players is shown one working
option, no controls, and no explanation of what the game is. Sprint 15 builds the tutorial, but the
first-minute reading of the menu is cheap to improve now. Improvement sprint **I10**.

### Verified working

- The whole flow runs on real key presses: menu → setup → START MATCH → countdown → play → warning →
  lasers → scoreboard, and Space opens PAUSE.
- The head-on rule behaves exactly as ruled: two equal-length snakes meeting head-on both die and the round
  is a draw.
- The "LASERS CLOSING!" banner, the red timer, the beam lines and the inward arrow markers all read clearly
  at 1280×720.
- Apples never share a row or column, on every frame of every match (the #102 fix, holding in play).
- Draw calls stay at 14–22 against a budget of 120.

## 4. Still open from Sprint 07

- **#117** — one unattributed e2e failure in four local runs. Not reproduced in this pass (57/57 twice).
- **Three SLOW target-mode rows** still pending in `gate1-bot-matrix.md`.
- **Branch protection on `main`** is still an owner click (#1).
- **KS-07-02** — the three human sessions. Everything a machine can answer is now answered; what remains is
  whether it is *fun*, which no agent can report.

## 5. What this pass changed

Nothing in `src/`. The harnesses are being productionised as a fourth test layer under improvement sprint
**I03** rather than left in a scratch directory, because a QA pass that cannot be re-run is a one-off
opinion.
