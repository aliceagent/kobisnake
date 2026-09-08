# Performance baseline — what the grey-box game costs, before the art

KI-08-03 · Improvement 08 (`docs/sprints/improvement-08-performance-budgets-before-the-art.md`), tracking
issue [#277](https://github.com/aliceagent/kobisnake/issues/277).

**This sprint builds the alarm, not the fix.** Nothing here is over budget and nothing was optimised. The
point of writing the numbers down now, while the game is grey boxes, is that Sprints 08–10 add snake models,
a studded floor, brick walls, emitter towers, trees, lanterns, banners, a lighting rig, beams, glow, sparks,
debris and celebrations — and every one of those is a draw call and a byte. This document is what "before"
looked like.

## The three budgets, and which of them a GPU-less runner can actually judge

`ARCHITECTURE §12` fixes three numbers. They are not equally testable in CI, and pretending otherwise is how
a gate becomes noise:

| §12 budget | Enforced where | Gated on |
|---|---|---|
| Initial JS bundle ≤ 350 kB gzip | `tests/perf/bundle.test.js` (KI-08-01) | The number itself — a build is a build on any machine |
| Draw calls during PLAYING ≤ 120 | `tests/perf/drawCalls.js` (KI-08-02), `tests/perf/frameTime.js` (this ticket) | The number itself — three's own counter is hardware-independent |
| Frame time p95 ≤ 16.6 ms (integrated GPU, 1080p) | **Not gated. Sprint 16.** | See below |

### Why the frame-time row does not gate here

CI has no GPU. Chromium falls back to SwiftShader, and the budget is written for an integrated GPU at 1080p —
hardware the runner does not have and cannot emulate. A raw millisecond gate would be red on every commit for
reasons that have nothing to do with the game, and a job that is always red is a job everyone learns to
ignore. That is not a hypothesis: it is why the Firefox nightly leg was removed rather than tolerated
([#23](https://github.com/aliceagent/kobisnake/issues/23)).

KS-07-06 met the same wall measuring input latency and answered it by reporting a machine-independent figure
beside the milliseconds; KI-19-00 turned that answer into the project's rule, and
`tests/e2e/inputLatency.spec.js` follows it today — it gates on `stepWaitTicks` and prints its `WALL CLOCK`
line as information that can never fail the job. This document and `tests/perf/frameTime.js` do the same
thing one layer up: **the gate is work done per frame; the milliseconds are recorded and never asserted.**

The milliseconds below are worse than merely machine-specific — they are not even stable on *this* machine.
Three runs of identical code, minutes apart on the same container, reported median submit times of **1.0 ms,
2.2 ms and 1.8 ms**, and wall-per-sampled-frame of **7.0 ms and 4.9 ms**. The draw-call, triangle and
residency figures were **identical in all three**. A budget on a number that swings by a factor of two
between runs of unchanged code, sitting next to figures that do not move at all, is the "budget that fires on
noise" this sprint's own Risks section warns against — and the contrast is the clearest argument for which
column deserves to gate.

### Two millisecond figures, because either one alone misleads

The first version of this measurement reported one number: `performance.now()` bracketed around
`renderer.render()`. It said **1.0 ms median — on a runner reputed to manage 7–8 fps.** Both cannot describe
the same frame. Under SwiftShader a `render()` call *submits* work and returns; the rasterisation happens outside
the bracket. So two figures are recorded:

- **Submit ms** — what the JS side spends inside `render()`. Real, and a small fraction of the story.
- **Wall ms per sampled frame** — the whole measurement's elapsed time over the number of sampled frames,
  which is how `tests/agent/driver.js` derived its own per-render figure. It catches the deferred
  rasterisation, and also includes the 60 unrendered simulation frames between samples, so it over-estimates
  a single frame in the other direction.

The true per-frame cost on this runner is somewhere between them. **Neither is `§12`'s p95**, and neither
gates.

One open discrepancy, recorded rather than resolved: `driver.js`'s module comment measures one
`renderer.render()` at **≈ 124 ms** on this project's container, derived from whole-suite wall clock, and
that figure is why the agent driver renders only once every 240 frames. This ticket's measurements do not
reproduce it — 28 sampled frames of a played round cost 5–7 ms each end to end, renders included, which is
roughly twenty times cheaper. Both were measured honestly, by different methods and under different container
load, and this document does not claim to settle which applies; the real-hardware run below is what would.
It is written down so that nobody quietly assumes one of the two is simply wrong, and so that whoever picks
up `KS-16-01` starts from the disagreement rather than rediscovering it.

## What gates, then

Two things, both hardware-independent:

1. **The worst sampled frame of a played round costs ≤ 120 draw calls** (`ARCHITECTURE §12`). The constant is
   imported from `tests/perf/drawCalls.js` so the two perf gates can never disagree about what §12 says. This
   is not a duplicate of KI-08-02: that ticket reads one frame at five *staged* moments, this samples a
   *played* round every simulated second and gates the worst frame in the series — so a composition nobody
   stages (a power-up pedestal and a laser step landing on a crash frame) is caught here and nowhere else.
   This measurement runs with power-ups **on**, deliberately, for exactly that reason.
2. **Scene residency does not grow across 500 rounds of churn** — geometries, textures, shader programs and
   scene-graph nodes, with **zero tolerance**. `createGameplayScene` builds the arena, both snake views, the
   pickups and the lasers exactly once, at renderer construction; no round boundary and no match reset is
   supposed to add to any of them. There is no legitimate drift for a tolerance to absorb, so a tolerance
   could only ever hide the thing being looked for.

Per-frame draw calls and triangles are deliberately *not* part of the leak check: a laser-warning frame
legitimately draws more than an opening one, so comparing them across checkpoints would report the game
working correctly as a leak.

### Per-frame allocation: measured, reported, not gated

The ticket names per-frame allocation among the proxies to gate on. It is measured (`performance.memory`,
where the browser offers it) and it is in the tables below — but it does not gate, and the reason is worth
stating rather than quietly dropping. In a garbage-collected runtime the heap reading says when the collector
last ran at least as much as it says what the frame allocated: two identical frames can differ by megabytes
across a collection, and a real leak can read flat because a collection happened to land inside the window.
What actually catches a leak here is the residency count, which moves only when something is created or
disposed.

## What Sprint 16 must add, on real hardware

This harness cannot answer `§12`'s frame-time row, and Sprint 16 (`KS-16-01`) owns doing so. Concretely, that
run needs:

1. **A machine with an integrated GPU, at 1080p** — the budget's own stated conditions. Not a GPU-less CI
   runner, and not a discrete-GPU workstation either, which would flatter the result.
2. **p95 frame time over a played round during PLAYING**, measured the way a player experiences it: across
   `requestAnimationFrame` deltas of the real loop, not bracketed around `render()` — this document's own
   submit-versus-wall discrepancy is the reason that distinction has to be explicit.
3. **The laser-warning and endgame phases included**, since they are the widest scenes this baseline records
   (19 draw calls against 15 for an opening board) and are where a frame-time problem would appear first.
4. **The same measurement after the art lands.** The numbers below are grey boxes. Their value to Sprint 16
   is as a "before" — a p95 on real hardware taken today, against the same figure taken after Sprints 08–10,
   is the only way to attribute a regression to the art rather than to the machine.
5. **A ruling on whether the 16.6 ms row then becomes a CI gate at all.** If it cannot be measured anywhere
   except on a human's laptop, it is a review step and not a gate, and the sprint should say so plainly
   instead of leaving an unenforced row in `§12`.

## How to regenerate the measurements below

```
npm run test:perf:frametime                  # measures and asserts; does not touch this file
KI_PERF_BASELINE=1 npm run test:perf:frametime   # also rewrites everything below the marker
```

Only the tables are regenerated — everything above the marker is prose, and a measurement run has no business
rewriting it. Never run two Playwright suites at once ([#86](https://github.com/aliceagent/kobisnake/issues/86));
`scripts/run-playwright-suite.mjs` holds the container-wide lock that enforces it.

**Conditions:** Chromium, software WebGL (SwiftShader), `playwright.config.js`'s 1280×720 viewport,
`?test=1&seed=1`, 2026-09-08. The played round is greedy vs. survivor with power-ups on; the churn run is 500
Bo1 matches, each ended by steering player one into the top wall and restarted with `REMATCH`, so every
iteration is a round boundary *and* a match reset — strictly more churn than the ticket's "500 rounds" asks
for.

The draw-call figures here are a continuous sample of one played round. The five staged scenes and their own
committed baseline are KI-08-02's, in `tests/perf/drawCalls.js`.

<!-- MEASUREMENTS -->

### One played round (seed 1, power-ups on)

Sampled 28 frames, one every 60 simulated frames.

| Measure | Median | p95 | Max | Budget |
|---|---|---|---|---|
| Draw calls | 15 | 19 | 19 | **120, gated** |
| Triangles | 22216 | 26416 | 27016 | recorded |
| Submit ms (JS side of render()) | 1.8 | 3.0 | 3.2 | recorded (16.6 ms needs real hardware) |
| Wall ms per sampled frame | 4.9 | — | — | recorded; includes the rasterisation `submitMs` misses |
| Geometries resident | 13 | — | — | must not grow, gated |
| Textures resident | 5 | — | — | must not grow, gated |
| Shader programs | 7 | — | — | must not grow, gated |
| Scene nodes | 27 | — | — | must not grow, gated |
| Heap used (MB) | 9.5 → 9.5 | — | — | recorded, never gated |

### Residency across 500 rounds of churn

| After round | Geometries | Textures | Programs | Scene nodes | Heap (MB) |
|---|---|---|---|---|---|
| 0 | 13 | 5 | 7 | 27 | 9.5 |
| 20 | 13 | 5 | 7 | 27 | 9.5 |
| 40 | 13 | 5 | 7 | 27 | 9.5 |
| 60 | 13 | 5 | 7 | 27 | 9.5 |
| 80 | 13 | 5 | 7 | 27 | 9.5 |
| 100 | 13 | 5 | 7 | 27 | 9.5 |
| 120 | 13 | 5 | 7 | 27 | 9.5 |
| 140 | 13 | 5 | 7 | 27 | 9.5 |
| 160 | 13 | 5 | 7 | 27 | 9.5 |
| 180 | 13 | 5 | 7 | 27 | 9.5 |
| 200 | 13 | 5 | 7 | 27 | 9.5 |
| 220 | 13 | 5 | 7 | 27 | 9.5 |
| 240 | 13 | 5 | 7 | 27 | 9.5 |
| 260 | 13 | 5 | 7 | 27 | 9.5 |
| 280 | 13 | 5 | 7 | 27 | 9.5 |
| 300 | 13 | 5 | 7 | 27 | 9.5 |
| 320 | 13 | 5 | 7 | 27 | 9.5 |
| 340 | 13 | 5 | 7 | 27 | 9.5 |
| 360 | 13 | 5 | 7 | 27 | 9.5 |
| 380 | 13 | 5 | 7 | 27 | 9.5 |
| 400 | 13 | 5 | 7 | 27 | 9.5 |
| 420 | 13 | 5 | 7 | 27 | 9.5 |
| 440 | 13 | 5 | 7 | 27 | 9.5 |
| 460 | 13 | 5 | 7 | 27 | 9.5 |
| 480 | 13 | 5 | 7 | 27 | 9.5 |
| 500 | 13 | 5 | 7 | 27 | 9.5 |
