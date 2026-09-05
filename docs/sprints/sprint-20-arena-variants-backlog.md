# Sprint 20 — Arena Variants (post-1.0 backlog)

**Lead:** Fable · **Agents:** Fable ×1, Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** `sprint-19-done` and an explicit owner decision to proceed

## Why this sprint exists
Two supplied concept images (`future-level-zigzag-zone.png`, `future-level-moving-obstacles.png`) show
obstacle arenas: static grey brick mazes and blocks that slide on fixed paths. The GDD's standard arena
forbids obstacles, and the guiding principle says every mechanic must make movement more satisfying, make
two-player competition more exciting, make the closing arena more dramatic, or give players a reason to play
again. Obstacle arenas plausibly serve the last two. This sprint is the **design and prototype gate** for
that idea; it ships nothing to players until Fable and the owner agree the prototype is fun.

## Scope of the gate
1. **Design note (Fable).** Define "arena variants" as a match-setup option: CLASSIC (default), ZIGZAG,
   MOVERS. Rules to decide: obstacles are deadly to the head like walls; lasers remove obstacles as they pass
   over them (dead zone clears); movers move one cell per 1.5 s on a fixed 4–6 cell track and are telegraphed
   with the yellow arrows from the image; spawn rules must exclude obstacle cells and mover tracks; variants are
   ON only if both players agree in setup (single toggle).
2. **Prototype (Opus + Sonnet).** `src/core/obstacles.js` behind a feature flag (`SETTINGS.experimental.arenaVariants`),
   grey-box rendering, two hand-authored layouts (one per image), bots updated to treat obstacles as deadly.
3. **Statistics (Sonnet-QA).** Bot matrix per variant vs CLASSIC: death rate before/during lasers, draws,
   average length. Reject a variant if draws > 5 % or timeout > 20 %.
4. **Human playtest (Fable).** Two sessions with the playtest script's Collision and Arena Closing sections
   plus "did the obstacles create new fun or just more deaths?".
5. **Decision.** Ship (moves to a full art sprint modelled on S09/S10 with the image references), iterate, or
   shelve. Recorded in `DESIGN-DECISIONS.md` §7.

## Tickets (prototype only)
### KS-20-01 · Variant design note — Owner: Fable · Files: `docs/design/DESIGN-DECISIONS.md`
### KS-20-02 · Obstacle model and layouts — Owner: Opus · Files: `src/core/obstacles.js`, `src/core/layouts/zigzag.js`, `src/core/layouts/movers.js`, `src/core/round.js`, `tests/unit/core/obstacles.test.js`
### KS-20-03 · Grey-box obstacle rendering with arrows — Owner: Sonnet · Files: `src/render/obstacleView.js`
### KS-20-04 · Setup toggle behind the flag — Owner: Sonnet · Files: `src/ui/screens/matchSetup.js`, `src/game/session.js`
### KS-20-05 · Bots, statistics, fuzz — Owner: Sonnet-QA + Opus · Files: `tests/sim/bots/*`, `tests/sim/variantStats.test.js`, `tests/sim/obstacleFuzz.test.js`
### KS-20-06 · Playtest sessions and decision — Owner: Fable · Files: `docs/qa/playtests/*variants*`

## Exit criteria
- [ ] A written ship / iterate / shelve decision with evidence. Nothing merges to `main` outside the feature flag until "ship".
