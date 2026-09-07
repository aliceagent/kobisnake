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
| `playtest.spec.js` | The suite `npm run test:agent` runs. |
| `policies/` | The play policies (KI-03-02). |
| `invariants.js` | The per-frame checks (KI-03-03). |
| `report.js` | Aggregation into `docs/qa/playtests/agent-run.md` (KI-03-04). |

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
