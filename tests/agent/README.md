# `tests/agent` — the agent playtest harness

The fourth test layer, added by **Improvement 03** (`docs/sprints/improvement-03-agent-playtest-harness.md`,
tracking issue [#122](https://github.com/aliceagent/kobisnake/issues/122)).

`tests/unit` proves the rules in isolation. `tests/sim` proves the simulation over whole rounds, headlessly.
`tests/e2e` scripts individual behaviours in a real browser. **Nothing played a whole match through the whole
stack** — which is why F1 and F2 in the agent QA pass of 2026-09-07
([#119](https://github.com/aliceagent/kobisnake/issues/119),
`docs/qa/reports/2026-09-07-agent-qa-pass.md`) survived seven sprints and 643 green tests.

This layer plays whole matches of the **built site** in a real browser — through the real `keydown` listener,
the real session, the real state machine and real renders — checks invariants on every simulated frame, and
reports the numbers a design lead uses.

It adds; it never substitutes. And it does not judge whether the game is *fun*: that is Playtest Gate 1
(KS-07-02) and no agent can report it.

## Running it

```
npm run test:agent
```

**Never run two Playwright suites at once in one container** — two concurrent suites corrupt both
([#86](https://github.com/aliceagent/kobisnake/issues/86)). `test:e2e`, `test:visual` and `test:agent` all run
through `scripts/run-playwright-suite.mjs`, which holds one lock in the OS temp directory. A second suite
**queues** behind the first, saying so while it waits, and gives up after 20 minutes. Queueing rather than
refusing is deliberate: several agents verify in parallel in one container, and turning every concurrent run
into a spurious failure would be worse than waiting. Separate CI runners are separate containers and never see
each other's lock.

A lock is released **only when its holder's process is gone** — never on age. An earlier version also expired
a lock after thirty minutes, and when a `tests/e2e` run hung (alive, holding the lock, producing nothing) that
rule declared it abandoned and let a second suite start beside it: precisely the thing the lock exists to
prevent. An age threshold cannot tell "wedged" from "slow", and it fails *open*. A holder that never finishes
is handled at the other end instead — the waiter gives up after 20 minutes and fails loudly, naming the
process to go and look at.

The suite fails on any of three things (KI-03-01 AC3), each reported with the **seed** so it can be replayed:

1. a non-zero invariant problem count,
2. a page error or a `console.error` from the page,
3. a match that does not finish inside its frame budget.

## What is here

| File | What it is |
|---|---|
| `driver.js` | Loads the built site at `?test=1&seed=N`, plays a whole match through `__kobi`, returns a plain result object. Also `failureReasons()`, the AC3 gate. |
| `driver.test.js` | The driver's pure functions, in Node. Runs under `npm run test:unit`. |
| `driver.spec.js` | The driver's **in-page** half — the claims about `runMatchInPage` that only playing a match can prove, and which `driver.test.js` structurally cannot reach. Added with the fix for [#291](https://github.com/aliceagent/kobisnake/issues/291). |
| `playtest.spec.js` | The suite `npm run test:agent` runs — ten seeded Bo3 matches, greedy vs survivor. |
| `policies/` | The play policies (KI-03-02): `greedy.js`, `survivor.js`, `idle.js`, unit-tested in `policies.test.js`. |
| `policies.spec.js` | KI-03-02's own agent-level measurements — AC1's laser-phase rates, AC2's 0:30 survival rate, and the idle/F1 characterisation scenario. Not part of the ten-match run above. |
| `invariants.js` | The per-frame checks (KI-03-03). |
| `report.js` | Pure aggregation of a run's `MatchResult[]` into the numbers a design lead uses, and the markdown renderer for `docs/qa/playtests/agent-run.md` (KI-03-04). Node-side only — never shipped into the page, so it imports normally and is unit-tested in `report.test.js`. |
| `report.spec.js` | Plays the seeded matches `report.js` aggregates and writes `docs/qa/playtests/agent-run.md`. Gated behind `KI_AGENT_REPORT=1` (unset, it is discovered and instantly skipped) so it does not add to the ten-match gate's runtime. Run it with `npm run test:agent:report` — see that document's own "What actually ran" section for the exact regenerating command. |
| `pacing.js` | `report.js`'s sibling for I04 (KI-04-01): aggregates a **swept** run into the shape of a round — round-length median and p90, the fraction reaching the laser warning, the fraction reaching each inset, timeout and draw rates, and whole-match wall clock — and renders `docs/qa/playtests/round-pacing.md`. Node-side and pure, like `report.js`. |
| `pacing.spec.js` | Plays that sweep: `laserStartTime` × `roundDuration` through `withOverrides()`, three pairings, 150 seeded Best-of-3 matches per cell. Gated behind `KI_PACING=1`; run it with `npm run test:agent:pacing`. **Hours, not minutes** — see "Sweeping a setting" below. |
| `pacing.test.js` | `pacing.js`'s pure functions against hand-built fixtures, plus the diff against the committed document's machine-readable block. Runs under `npm run test:unit`. |
| `monkey.js` | The session fuzzer (KI-18-01, Improvement 18): a seeded action list, the in-page applier, and the Node-side judgement. See "The monkey" below. |
| `monkey.spec.js` | KI-18-01's own suite — AC1 and AC2 in `npm run test:agent`, and the AC3 campaign behind `KI_MONKEY=1`. |

## The monkey (Improvement 18)

`monkey.js` fuzzes the game *around* the simulation: from a seed it generates a sequence drawn from every key
the game listens to plus `blur`, `focus`, `visibilitychange` and `resize`, applies each through the same
listener a person's action would reach, and after every one checks the invariants and asks whether the game
can still get out of the state it is in. `tests/sim` has fuzzed the simulation since Sprint 02; nothing had
ever fuzzed the state machine, the screens, the focus model or the tab lifecycle.

```
npm run test:agent                       # AC1 and AC2 — the harness's own proofs, seconds
KI_MONKEY=1 npm run test:agent:monkey    # the campaign: 200 seeds × 500 actions
KI_MONKEY=1 KI_MONKEY_SEEDS=20 npm run test:agent:monkey   # a pilot
```

Four things to know before touching it, each of which cost a measurement to learn:

1. **The monkey is the only clock, and it replaces `requestAnimationFrame` to stay that way.** `main.js`
   starts a real frame loop, and a run is several `page.evaluate` calls with idle wall time between them (a
   `resize` has to be a `page.setViewportSize` on the Node side), so a live loop would advance the round by
   however long a round trip took. The frame pump also buys the one thing that would otherwise be
   unreachable: `loop.js`'s deferred auto-pause, which only fires on a frame `__kobi.advance` never produces.
2. **A hidden tab is not advanced**, because `loop.js` gives one no frames. The seconds are counted, not
   played, which is also what keeps the stuck check honest.
3. **The stuck check counts simulated seconds** — never wall ones. Several agent sessions share this
   container and a wall-clock check would report a loaded box as a hung game.
4. **`STATES_THAT_RENDER_UNASKED` is a temporary list tied to [#317](https://github.com/aliceagent/kobisnake/issues/317).**
   The monkey never asks for a render, so every state costs it 0.00 ms a frame — except `REPLAY`, where
   `session.js` renders on every update, at 17–33 ms a frame under software WebGL. A run gets a small budget
   of simulated time there and then stops paying for time to pass on that screen while carrying on with every
   action. When #317 is fixed the list empties and nothing else changes.

## Sweeping a setting

`driver.playMatch` takes an optional `settingsOverrides` — a `withOverrides()`-shaped tree that reaches
`session.js` through `__kobi.setSettingsOverrides` **before** the match starts, so it applies to every round
including the first. That is the only supported way to measure a hypothetical setting from this layer, and
`src/core/settings.js` is never edited to do it (`CLAUDE.md`'s never list; I04's ticket says so again in its
own words). Omitting the option calls nothing, so every caller written before it existed measures exactly what
it always did — which is what lets `round-pacing.md`'s baseline cell be checked against `agent-run.md` to the
number.

**A long sweep is resumable.** `pacing.spec.js` caches each finished cell's raw `MatchResult[]` under the OS
temp directory and reuses it on a later invocation, keyed by pairing, both swept values and the seed list.
That is sound rather than a shortcut: a match is a pure function of its seed and its settings
(`ARCHITECTURE §11`), so a cached cell is *identical* to a replayed one. Delete the cache directory the spec
names to force a cold run.

## Two things to know before you write anything here

### 1. The whole match loop runs inside one `page.evaluate`

A Best-of-3 is a few thousand simulated frames. Round-tripping each one through `page.evaluate` to fetch a
snapshot and hand back a key would cost minutes per match, so the driver ships the loop into the page once
and gets one result back.

That fixes the shape of every policy and of the invariants module. **Each is one self-contained function with
no free variables** — helpers nested inside it, nothing referenced from module scope, no imports used in the
body — because the driver ships them into the page as source text (`Function.prototype.toString()`).
`tests/e2e/helpers.js` documents the identical constraint for the identical reason.

A module may still import at the top level for values the **Node side** passes in as `config` (KI-03-03's HUD
tolerance is derived from `session.js`'s `HUD_INTERVAL_SECONDS` this way). The serialised function itself must
never reference them.

Because they are ordinary exported functions, they stay unit-testable in plain Node against a hand-built
snapshot — which is how the policies and the invariants are tested.

### 2. Rendering is the entire cost, so it is deliberately rare

One `renderer.render()` costs **≈ 124 ms** under Chromium's software WebGL at 1280×720, against ≈ 0.04 ms for
one `__kobi.advance` frame. Rendering every frame turns a single Best-of-3 into **196 seconds**.

So the driver renders every `RENDER_EVERY_N_FRAMES` frames and `advance`s the rest. **Simulation, input and
the HUD still run on every frame** — `advance` drives `session.runUpdate`, the same function a rendered frame
runs; only `renderer.render()` is skipped, and it cannot affect simulation state. See that constant's comment
in `driver.js` for the measurements and for why the cadence is the only lever (`?reducedFx=1` changes nothing;
a quarter-size viewport only halves it — the floor is the shadow pass).

## The state shapes that cost the scratch run two failed starts

Write these down rather than guess them:

- `snapshot.powerUps` is **`{ pickups: [{cell, type}] }`**, not an array.
- `snapshot.lasers` is **`{phase, inset, insetCells}`** — **no bounds**. The safe square is
  `[inset, width - 1 - inset]` on both axes (`src/core/lasers.js`'s `safeRegion`; the grid is 24×24).
- `snapshot.snakes[i]` carries `segments` (head first), `previousSegments`, `length`, `alive`, `direction`,
  `stepProgress`, `pendingGrowth`, `speedMultiplier` and `effects[]`.
- `snapshot.timeRemaining` is `null` in practice mode.
- `__kobi.getSnapshot()` returns `null` in `MATCH_OVER` (KI-03-06 / #119 F5). `__kobi.sim` still serves the
  finished round there.

## The rule every invariant follows

**State the design rule it derives from.** #119's F4 is the cautionary tale: the first version of the HUD
check reported **135 problems a match**, every one of them the design — `ARCHITECTURE §8` throttles HUD text
to 10 Hz on purpose. A QA layer that cries wolf is worse than none, and a 135-problem report that turns out to
be the design is exactly what gets a real finding ignored next to it.
