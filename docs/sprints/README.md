# KOBI Snake — Sprint Plan

Eighteen sprints take the repository from empty to a released, Vercel-hosted, two-player 3D Snake game, then
into post-1.0 single-player and arena variants. Sprints 00–15 are Version 1. Each sprint file is self-contained:
goal, scope, prerequisites, tickets with owners and acceptance criteria, QA plan, references, risks and exit
criteria. Read `docs/process/AGENT-ROLES-AND-WORKFLOW.md` for how a sprint runs and who does what.

## Roadmap

| Sprint | Name | GDD phase | Lead | Milestone |
|---|---|---|---|---|
| [00](sprint-00-bootstrap-and-delivery-pipeline.md) | Bootstrap & Delivery Pipeline | — | Opus | Repo builds, tests, deploys to Vercel on every PR |
| [01](sprint-01-core-simulation.md) | Core Simulation (headless) | 1 | Opus | Whole round playable in a unit test |
| [02](sprint-02-greybox-renderer-and-first-playable.md) | Grey-box Renderer, Input & First Playable | 1 | Opus | **M1: two snakes, square arena, movement feels excellent** |
| [03](sprint-03-closing-laser-arena.md) | Closing Laser Arena | 2 | Opus | **M2: the signature climax works** |
| [04](sprint-04-match-structure-and-game-flow.md) | Match Structure & Game Flow | 3 | Sonnet | Best-of matches, countdown, scoreboard, pause |
| [05](sprint-05-power-ups.md) | Power-ups | 4 | Sonnet | Speed Boost + Slow, ON/OFF, spawn cycle |
| [06](sprint-06-playtest-gate-1-and-tuning.md) | Playtest Gate 1 & Tuning | — | Fable | Humans say the grey-box game is fun |
| [07](sprint-07-snake-art-and-animation.md) | Snake Art & Animation | 5 | Sonnet | Snakes match the character sheet |
| [08](sprint-08-arena-art-lighting-and-camera.md) | Arena Art, Lighting & Camera Polish | 5 | Sonnet | Arena matches the clean-arena sheet |
| [09](sprint-09-vfx-and-game-feel.md) | VFX & Game Feel | 5 | Sonnet | Lasers, pickups, crashes, slow-mo, shake |
| [10](sprint-10-hud-menus-and-match-setup.md) | HUD, Menus & Match Setup | 6 | Sonnet | Toy-styled HUD and screens, keyboard + mouse |
| [11](sprint-11-audio.md) | Audio: Music, SFX, Settings | 6 | Sonnet | Three tracks, laser sting, all SFX, toggles |
| [12](sprint-12-save-data-keys-and-shop.md) | Save Data, Keys, Shop & Cosmetics | 7 | Opus | 3D shop, buy/try, colours persist |
| [13](sprint-13-tutorial-and-practice.md) | Tutorial & Practice Mode | 6 | Sonnet | Seven-step tutorial, practice from menu and shop |
| [14](sprint-14-playtest-gate-2-hardening.md) | Playtest Gate 2, Performance, Cross-browser, Accessibility | — | Fable | Budgets met, humans approve the full game |
| [15](sprint-15-release-1-0.md) | Release 1.0 | — | Opus | Production on Vercel, v1.0.0 tag, kid-friendly dev guide |
| [16](sprint-16-single-player.md) | Single Player | 8 | Sonnet | Post-1.0: solo survival with lasers and high score |
| [17](sprint-17-arena-variants-backlog.md) | Arena Variants (backlog) | — | Fable | Post-1.0: Zigzag Zone & Moving Obstacles concepts |

## Dependency graph

```
S00 ─► S01 ─► S02 ─► S03 ─► S04 ─► S05 ─► S06 (gate)
                │                              │
                │        ┌─────────────────────┤
                │        ▼                     ▼
                │      S07 ─► S08 ─► S09     S10 ─► S11
                │                     │        │
                │                     └───┬────┘
                │                         ▼
                │                   S12 ─► S13 ─► S14 (gate) ─► S15 (release)
                │                                                    │
                └── (M1 tag) ──────────────────────────────────►  S16 ─► S17
```

After Sprint 06 signs off, two tracks run in parallel: the **art track** (S07 → S08 → S09) and the **UI/audio
track** (S10 → S11). Both must be done before S12. S12 and S13 are sequential because Try-before-you-buy launches
practice mode.

## Ticket ID scheme
`KS-NN-TT` where NN is the sprint and TT the ticket. Issue titles and PR titles start with the ID. Acceptance
criteria are numbered AC1..ACn per ticket and tests are named after them.

## Sizes
S ≈ a couple of hours of agent work, M ≈ half a day, L ≈ a day. A sprint with 3–4 agents in parallel should
close in one to three days.

## Sign-off record
Fable appends a row here at each sign-off.

| Sprint | Tag | Date | Notes |
|---|---|---|---|
