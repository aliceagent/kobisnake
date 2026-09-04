# Reference Image Catalog

These are the concept images supplied with the design pack. They are the **visual source of truth** for
every art, UI, VFX and camera task. Builder agents must open the relevant image before starting any task
that lists it, and QA agents must compare screenshots against it during design-fidelity review.

Numbering follows the "Highest-Priority Image Set" in the GDD (section 11). Images that were not supplied
are listed at the bottom so nobody goes looking for them.

| File | GDD image # | What it shows | Used by sprints |
|---|---|---|---|
| `01-master-visual.png` | 1 | Hero key art: block-built KOBI SNAKE logo, both snakes, apples, speed power-up on a blue pedestal, all four lasers lit, emitter towers at corners and mid-walls. The overall "target look". | S07, S08, S09, S10, S15 |
| `02-standard-gameplay-camera.png` | 2 | The real gameplay camera at round start (1:30, BEST OF 3). Lasers parked/inactive, four apples, one power-up, two 8–9 segment snakes. Locks HUD placement and arena framing. | S02, S08, S10, S14 |
| `03-camera-angle-comparison.png` | 3 | Four camera pitches (90°, 85°, 75–80°, 65°). **Panel C (75–80°) is the locked gameplay camera.** | S02, S08 |
| `04-clean-arena-design.png` | 4 | Clean arena with no snakes: floor tile detail (green tiles with subtle shade variety and studs), yellow/blue/grey wall bricks, hazard-stripe wall centre section, corner laser emitter (inactive, red lens), trees/lanterns/banners outside, primary material swatches. | S02, S08 |
| `05-laser-closing-phase.png` | 5 | The 0:30 moment: all four beams lit at the perimeter, inward arrows, "LASERS CLOSING!" hazard banner, sparks, darker/redder lighting. | S03, S09, S10 |
| `06-final-shrink-showdown.png` | 6 | 0:08, lasers far inward, a small safe square, outer tiles darkened, two long snakes squeezed together. Readability stress test. | S03, S06, S09, S14 |
| `07-snake-character-sheet.png` | 7 | Red and blue snake front/side/top views, 10-segment full snake, head close-ups (large white eyes with black pupils, yellow/cream mouth stripe), body-segment connection detail, underside, plastic texture. | S07 |
| `09-snake-turning-animation.png` | 9 | Six-frame 90° turn, "grid path (top view)" diagram, key principles (grid logic, smooth visuals, each segment follows the segment in front, clean 90° turns). | S01, S02, S07 |
| `13-gameplay-hud.png` | 13 | Annotated HUD: P1/P2 pills with snake-face icon and round-win pips, central timer panel with BEST OF 3 tab beneath, "SPEED BOOST 5s" tag floating near the boosted snake, "ROUND 1 OF 3" pips at the bottom. | S04, S05, S10 |
| `14-main-menu.png` | 14 | Main-menu look: block-built title, "SMALL SNAKE. BIG FUN." tagline, big yellow primary button, dark rounded secondary buttons with icons, stats panels top-right, red snake in foreground. **Menu items in this image differ from the GDD; see note below.** | S10, S12 |
| `future-level-moving-obstacles.png` | — | Out-of-scope concept: "Level 8 – Moving Obstacles" with sliding block hazards. Kept for the post-1.0 arena-variants backlog. | S17 |
| `future-level-zigzag-zone.png` | — | Out-of-scope concept: "Level 8 – Zigzag Zone" with static grey brick mazes. Kept for the post-1.0 arena-variants backlog. | S17 |

## Notes and discrepancies (resolved by the design lead)

1. **Main-menu items.** `14-main-menu.png` shows PLAY / STATS / SKINS / SETTINGS and single-player style stats
   (best score, total apples, rounds won). The GDD main menu is **1 PLAYER / 2 PLAYERS / PRACTICE / TUTORIAL /
   SHOP / SETTINGS** and that list is authoritative. Use the image only for visual language (title treatment,
   button styling, panel styling, snake-in-foreground composition). A small stats panel showing matches played
   and P1/P2 wins is allowed because the GDD save schema already tracks those numbers.
2. **Obstacle levels.** Both "Level 8" images contradict the GDD instruction "avoid decorative obstacles that
   interfere with gameplay" for the standard arena. They are **not** part of Version 1. They are the seed of
   Sprint 17 (arena variants) and must not leak into the default arena.
3. **Wall emitter placement.** The images consistently show emitter towers at the four corners **and** one at the
   centre of each wall (with hazard stripes). Build both; beams run between corner emitters, the centre emitter
   is the "mover" that visibly pushes the beam inward.
4. **Food is a toy-brick apple** in every image (red body, green leaf, small stud on top). This resolves GDD open
   question 1.
5. **Power-up pedestal**: a two-tier blue brick pedestal with a floating glowing yellow lightning bolt inside a
   cyan ring. The SLOW power-up (no image supplied) must reuse the same pedestal system with an ice-white
   pedestal and a snowflake, per the GDD "power-up visual language" rules.

## Images referenced by the GDD but NOT supplied

Tasks that would normally use these must instead use the GDD prompt text (section 12) as their spec and get a
written design note from the design lead (Fable) before starting:

- 8 Snake Head Exploration — resolved: use the head exactly as in `07-snake-character-sheet.png`.
- 10 Food and Growth Sequence
- 11 Power-Up Design Sheet (needed for SLOW)
- 12 Snake Crash and Laser Death Effects
- 15 Two-Player Match Setup
- 16 3D Shop Interior
- 17 Interactive Tutorial
- 18 Master Materials, Lighting and Effects Bible

Written substitutes for all of these live in `docs/design/DESIGN-DECISIONS.md` (sections "Visual notes for
un-illustrated screens").
