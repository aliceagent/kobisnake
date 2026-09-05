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
Fable appends a row here at each sign-off.

| Sprint | Tag | Date | Notes |
|---|---|---|---|
| 01 | *(pending)* | 2026-09-05 | All 7 implementable tickets merged, CI green, QA report posted. Tag withheld until (a) the first Vercel deployment succeeds after the quota reset on 2026-09-06 and (b) the owner applies branch protection. **Sprint 02 conditionally started** because it has no dependency on either. |
