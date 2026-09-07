# KOBI Snake — 20-Sprint Roadmap

Twenty sprints take the repository from empty to a released, Vercel-hosted, two-player 3D Snake game, then into
post-1.0 single-player and arena variants. Sprints 01–18 are Version 1. Each sprint file is self-contained: goal,
scope, prerequisites, tickets with owners and acceptance criteria, QA plan, references, risks and exit criteria.
Read `docs/process/AGENT-ROLES-AND-WORKFLOW.md` for how a sprint runs and who does what, and
`docs/process/HANDOFF.md` for the kick-off prompt of each sprint.

## Roadmap

| # | Sprint | GDD phase | Lead | What exists when it is done |
|---|---|---|---|---|
| [01](sprint-01-bootstrap-and-delivery-pipeline.md) | Bootstrap & Delivery Pipeline | — | Opus | Repo lints, type-checks, unit/e2e/visual-tests, builds and deploys to Vercel on every PR |
| [02](sprint-02-core-simulation.md) | Core Simulation (headless) | 1 | Opus | A whole round runs in a unit test: grid, snakes, input queues, food, growth, collisions, timer, deterministic RNG |
| [03](sprint-03-greybox-renderer-and-first-playable.md) | Grey-box Renderer, Input & First Playable | 1 | Opus | **M1: two snakes, square arena, WASD vs Arrows, movement feels excellent** |
| [04](sprint-04-closing-laser-arena.md) | Closing Laser Arena | 2 | Opus | **M2: 0:30 warning, four lasers step inward to 6×6, laser death, dead zone** |
| [05](sprint-05-match-structure-and-game-flow.md) | Match Structure & Game Flow | 3 | Sonnet | State machine, Bo1/3/5, countdown, scoreboard, match over, pause, grey menus |
| [06](sprint-06-power-ups.md) | Power-ups | 4 | Sonnet | Speed Boost + Slow, ON/OFF, 15 s cycle, no spawns after 0:30, HUD tag |
| [07](sprint-07-playtest-gate-1-and-tuning.md) | Playtest Gate 1 & Tuning | — | Fable | Humans say the grey-box game is fun; numbers locked; art may begin |
| [08](sprint-08-snake-art-and-animation.md) | Snake Art & Animation | 5 | Sonnet | Brick snakes with eyes, corner bending, growth, all eight colours |
| [09](sprint-09-arena-art-lighting-and-camera.md) | Arena Art, Lighting & Camera Polish | 5 | Sonnet | Studded floor, brick walls, emitter towers, trees/lanterns/banners, lighting rig, apple model |
| [10](sprint-10-vfx-and-game-feel.md) | VFX & Game Feel | 5 | Sonnet | Laser beams and glow, sparks, food pop, power-up bursts, crash debris, slow-mo, shake, celebrations |
| [11](sprint-11-hud-menus-and-match-setup.md) | HUD, Menus & Match Setup | 6 | Sonnet | Toy-styled HUD and every screen, keyboard + mouse, accessibility pass |
| [12](sprint-12-audio.md) | Audio: Music, SFX, Settings | 6 | Sonnet | Three synthesised tracks, laser sting, full SFX bank, toggles |
| [13](sprint-13-save-data-and-keys.md) | Save Data & Keys | 7 | Sonnet | localStorage schema + migration, key rewards and award animation, persisted settings and colours |
| [14](sprint-14-shop-and-cosmetics.md) | Shop & Cosmetics | 7 | Opus | 3D shop room, rail camera, buy/try/owned/locked, six unlockable colours |
| [15](sprint-15-tutorial-and-practice.md) | Tutorial & Practice Mode | 6 | Sonnet | Seven-step tutorial with bubbles, practice from menu and shop |
| [16](sprint-16-hardening-performance-browsers-accessibility.md) | Hardening: Performance, Browsers, Accessibility, Offline | — | Opus | Budgets met, three browser engines green, axe/Lighthouse thresholds, offline verified |
| [17](sprint-17-playtest-gate-2-and-final-tuning.md) | Playtest Gate 2 & Final Tuning | — | Fable | Full playtest script passes with humans; final numbers; release readiness memo |
| [18](sprint-18-release-1-0.md) | Release 1.0 | — | Opus | Production on Vercel, `v1.0.0`, changelog, developer guide for the 11-year-old |
| [19](sprint-19-single-player.md) | Single Player | 8 | Sonnet | Post-1.0: solo survival with laser cycles, score, high score, difficulties |
| [20](sprint-20-arena-variants-backlog.md) | Arena Variants (prototype gate) | — | Fable | Post-1.0: Zigzag Zone and Moving Obstacles prototyped, decision to ship or shelve |

## Dependency graph

```
S01 ─► S02 ─► S03 ─► S04 ─► S05 ─► S06 ─► S07 (gate 1)
                                            │
                        ┌───────────────────┴────────────────┐
                        ▼                                    ▼
                  S08 ─► S09 ─► S10                    S11 ─► S12
                                 │                            │
                                 └──────────────┬─────────────┘
                                                ▼
                               S13 ─► S14 ─► S15 ─► S16 ─► S17 (gate 2) ─► S18 (release 1.0)
                                                                              │
                                                                       S19 ─► S20 (post-1.0)
```

After Sprint 07 signs off, two tracks run in parallel: the **art track** (S08 → S09 → S10) and the **UI/audio
track** (S11 → S12). Both must be done before S13. S13 → S14 → S15 are sequential because the shop needs keys
and Try-before-you-buy needs practice mode.

## Milestones
| Tag | After | Meaning |
|---|---|---|
| `m1-first-playable` | S03 | GDD's first real milestone: movement is fun between two people |
| `m2-laser-arena` | S04 | The signature hook creates a climax |
| `gate1-passed` | S07 | Design locked; art investment begins |
| `gate2-passed` | S17 | Version 1 verified by humans |
| `v1.0.0` | S18 | Release |
| `v1.1.0` | S19 | Single player |

## Ticket ID scheme
`KS-NN-TT` where NN is the sprint (01–20) and TT the ticket. Issue titles and PR titles start with the ID.
Acceptance criteria are numbered AC1..ACn per ticket and tests are named after them.

## Sizes
S ≈ a couple of hours of agent work, M ≈ half a day, L ≈ a day. A sprint with 3–4 agents in parallel should
close in one to three days. Ticket counts: S01 8 · S02 7 · S03 7 · S04 5 · S05 5 · S06 5 · S07 6 · S08 5 ·
S09 7 · S10 6 · S11 6 · S12 5 · S13 4 · S14 4 · S15 4 · S16 6 · S17 6 · S18 4 · S19 5 · S20 6.

## Sign-off record
Fable appends a row here at each sign-off. **This table is the source of truth for sprint completion.** Git tags
cannot be pushed from agent sessions (the proxy refuses tag refs), so `sprint-NN-done` tags are a courtesy the
owner may add; a sprint is done when its row is here and the sign-off comment is on its tracking issue.

| Sprint | Tag | Date | Notes |
|---|---|---|---|
| 01 | signed off (tag: owner may add `sprint-01-done` at 60b1145) | 2026-09-06 | All 8 tickets merged; CI green; production live at https://kobisnake.vercel.app. KS-01-06 AC1 (branch protection) remains an owner click, tracked on #1. |
| 02 | signed off (owner may tag `sprint-02-done` at fab5d02) | 2026-09-06 | All 7 tickets merged; 148 tests, 100 % coverage on `src/core` with the strict gate on; golden no-input log and 4 000-seed fuzz clean; bot baseline recorded on #26 and agrees with the pre-sprint model. |
| 03 | pending human playtest | 2026-09-06 | All 7 tickets merged; 313 tests, 100 % core, 100 % lines on `src/game`; e2e 11 and visual 3 green; production serves the first playable; design review of camera, grey-box scene and HUD approved. Waiting on PLAYTEST-SCRIPT §2 M1–M4 from two humans. **Sprint 04 conditionally started**; any playtest finding becomes a blocker ticket in Sprint 04. |
| 04 | pending human playtest | 2026-09-06 | All 6 tickets merged; 399 tests, 100 % core, `src/render` gated at 75 %; 2 000-seed laser fuzz validated against four mutations; bot statistics match the pre-sprint model within a few points (greedy vs survivor 100 % decided by death, 0.8 % draws); #39 closed with evidence. Design review of beams, dead zone and warning approved (grey-box). Waiting on PLAYTEST-SCRIPT §5 A3/A4. **Sprint 05 conditionally started.** |
| 05 | pending human playtest | 2026-09-06 | All 5 tickets merged; 527 tests, 100 % core, 100 % lines on `src/game`; 28-row state machine with generated per-row tests; e2e 29, visual 13; production current. Design review of all six screens approved. Human check (Bo5 pacing) folded into Gate 1 with the Sprint 03/04 questions. **Sprint 06 conditionally started.** |
| 06 | pending human playtest | 2026-09-06 | All 7 tickets + 2 follow-ups merged; 551 unit, 40 sim, 45 e2e, 15 visual; 2 000-seed fuzz clean; seven defects caught in review; bot finding: Speed Boost hurts a non-adapting collector (Gate 1 question). Two owner-playtest blockers (#102, #103) carried into Sprint 07 as KS-07-00. Human P1–P5 folded into Gate 1. |
| 07 | agent side complete; gate pending human sessions | 2026-09-07 | KS-07-00 (#102 apples never line up, #103 Space pauses), KS-07-01 tuning overlay (`?tuning=1`, folds during rounds, presets incl. Speed Boost 1.35×/4 s and the SLOW target switch), KS-07-03 bot matrix (`docs/qa/playtests/gate1-bot-matrix.md`, 18 cells × 500 rounds; three SLOW-target rows pending), KS-07-06 latency instrumentation merged; 640 unit, 57 e2e, 15 visual, core 100 %; latency floor is the 167 ms grid step (keydown-to-queued 0 ms, render 1 ms). KS-07-07 (#105 ice-blue SLOW pedestal) in flight before the sessions. Waiting on KS-07-02: three human sessions per `PLAYTEST-SCRIPT.md`, which also answer the Sprint 03–06 questions. |
