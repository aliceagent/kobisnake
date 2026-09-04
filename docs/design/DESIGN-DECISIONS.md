# KOBI Snake — Design Decisions (Version 1)

Owner: **Fable (design lead)**. Status: **LOCKED for Version 1** unless a Playtest Gate (Sprint 06 or Sprint 14)
produces evidence to change a value. Every number below is a tunable in `src/core/settings.js`; the value here
is the shipping default. Builder agents implement exactly these values and never invent new rules.

This document resolves every item in GDD section 6 ("Open Questions") and adds the rules the GDD left implicit
but code needs. The GDD (`GDD-KOBI-Snake-Design-and-Reference-Pack.txt`) remains the authority on intent; this
file is the authority on numbers and edge cases.

---

## 1. Resolved open questions

| # | GDD open question | Decision | Rationale |
|---|---|---|---|
| 1 | Exact food appearance | **Toy-brick apple**: red 2×2 rounded brick body, green leaf brick, single stud on top. | Every supplied concept image already shows it. Instantly readable from the gameplay camera. |
| 2 | Growth amount per food | **+1 segment per apple.** | Classic, readable, keeps long-snake pressure gradual. Tunable `growthPerFood`. |
| 3 / 21 | Slow power-up behaviour | **SLOW slows every snake except the collector** to 0.6× speed for 4 s. In practice/single-player (no opponent) it instead slows the laser step interval by 2× for 4 s. | Benefits the collector, obvious to both players, symmetric with Speed Boost (one helps you, one hinders them). |
| 4 | Speed boost multiplier | **1.5× movement speed for 5 s.** | Noticeably faster, still controllable at the base speed below. |
| 5 | Laser shrink speed | **One grid cell inward per side every 2.5 s**, first step 5 s after the warning starts. | Reaches the minimum arena with ~2.5 s to spare in a 90 s round. Readable, stepwise, glides visually. |
| 6 / 23 | Minimum final arena | **6 × 6 cells.** Lasers stop there. | Two length-15 snakes still fit; near-zero arenas produce unfair "nowhere to go" deaths. |
| 7 / 22 | Simultaneous crash | **Both die in the same simulation step → round is a DRAW → replay the round**, no win recorded. | Symmetric, needs no tie-break the players must learn. Rare in practice. |
| 8 | Head-to-head | Both heads enter the same cell, or swap cells, in the same step → **both die → draw → replay.** If one head enters a cell the other head already occupies (different step), the arriving snake dies. | Deterministic; "the head is the dangerous point" stays true. |
| 9 | Arena wall before lasers | Outer wall is **deadly** on head contact from second 0. Lasers start parked exactly on the wall line, unlit. | Classic Snake rule; the laser phase changes where the deadly edge is, not whether it exists. |
| 10 | Self-collision | **Deadly** (classic). | Confirmed as GDD recommended. |
| 11 | Starting snake length | **4 segments** (head + 3). | GDD settings object value. |
| 12 | Number of unlockable colours | **6**: Green, Yellow, Orange, Purple, Teal, Gold. Red and Blue are owned from the start. | Matches the GDD shop prompt list plus one; enough for a full shop room. |
| 13 | Key prices | Green 2 · Yellow 2 · Orange 3 · Purple 3 · Teal 3 · Gold 6. | One Best-of-5 win (2 keys) buys the first colour; Gold is the long-term goal. |
| 14 | Shop navigation | **Rail camera**: pedestals in an arc, mouse hover/click or ←/→ keys focus a pedestal, camera glides to it. No free-roam. Esc returns to the menu. | GDD wants mouse in the shop; free-roam first-person is complexity with no gameplay value. |
| 15 | Additional cosmetics in V1 | **Colours only.** Eyes/hats/trails are post-1.0. | Scope control. |
| 16 | Single-player mechanics | Post-1.0 (Sprint 16): solo survival, apples score points, laser phase every 90 s cycle, speed ramps, local high score. Menu shows "COMING SOON" until then. | GDD: two-player first. |
| 17 | Numerical score for food | **No numeric score in two-player.** Length is the visible score. Single-player has a score (S16). | Keeps the HUD to timer + wins. |
| 18 | Food persistence | **Persists until collected.** Never despawns. | Simplicity; encourages movement. |
| 19 | Food items active at once | **4** apples always present; a collected apple respawns immediately at a random free cell. | Concept images show 4–6; 4 keeps the arena uncluttered. |
| 20 | Power-up visuals | Speed = yellow lightning bolt over a blue two-tier pedestal inside a cyan ring. Slow = white snowflake over an ice-white pedestal inside a pale-blue ring. Different silhouette, icon, colour and pedestal. | GDD: never rely on colour alone. |
| 24 | Camera | **Perspective camera, vertical FOV 32°, pitch 78° below horizontal** (image 03 panel C), yaw 0, fixed position framing the whole arena plus one wall thickness of margin. Small shake on crash, ≤ 2 % zoom pulse on laser warning, no rotation. | Locked by the camera comparison sheet. |
| 25 | Music production | **Composed in-repo as note-sequence data and played by a small Web Audio synth sequencer.** No audio files, no CDN. SFX are synthesised the same way. | Offline by construction, licence-free, tiny, and an 11-year-old can edit a melody array. |

## 2. Rules the GDD left implicit

### 2.1 Grid, speed and time
- Arena grid: **24 × 24 cells** (cell = 1 world unit). Origin bottom-left, x to the right, y upward.
- Base speed: **6 cells per second** (`snakeSpeed: 6`). Speed Boost → 9 cells/s. Slowed → 3.6 cells/s.
- Simulation runs on a **fixed 120 Hz step** (`simHz: 120`). Each snake has its own movement accumulator; when it
  reaches one cell the snake takes a grid step. Rendering interpolates between the previous and current cell
  positions using the snake's current step interval. This gives "grid logic, smooth visuals" and lets two snakes
  move at different speeds without float drift.
- Round length: **90 s** of simulated time. The timer counts simulated seconds, not wall-clock, so pausing or a
  slow frame never steals time.

### 2.2 Input
- Direction inputs are queued (max **2** buffered). A direction that is the exact reverse of the last committed
  or last queued direction is ignored. A direction equal to the current one is ignored. The queue is consumed one
  entry per grid step.
- Both key sets are polled every frame; whichever player's key it is goes to that player's queue. P1 = WASD,
  P2 = Arrow keys. In single-player, practice and tutorial, **both** key sets steer the one snake.
- Keys are never rebindable in V1. Mouse is ignored during PLAYING.

### 2.3 Spawn positions
- P1 starts at cell (5, 12) heading **right**, body extending left. P2 starts at (18, 11) heading **left**, body
  extending right. (Offset rows so a straight charge is never an instant head-on.)
- Apples spawn only on free cells at least **2** cells (Chebyshev distance) from any snake head and never inside
  the laser dead zone. Power-ups additionally require ≥ 3 cells from any head and never on an apple.

### 2.4 Round timeline (simulated seconds remaining)
| Time | Event |
|---|---|
| Countdown | 3 · 2 · 1 · GO, 0.8 s each; snakes visible but frozen; inputs are accepted into the queue during "GO". |
| 1:30 | Round starts. 4 apples present. If power-ups ON, first power-up spawns at **1:15**. |
| every 15 s | Uncollected power-up despawns and a new one spawns at a new random valid cell (same cell allowed by chance). |
| 0:30 | **LASER_WARNING**: all four beams ignite on the wall line (deadly), warning overlay + sting for 5 s, no further power-up spawns. Active boosts/slows keep running to their normal end. |
| 0:25 | First laser step; each side moves 1 cell inward. Repeats every 2.5 s. |
| ~0:02.5 | Lasers reach the 6 × 6 minimum and stop. |
| 0:00 | Timeout. Longer snake wins the round. Equal length → draw → replay. |

Cells outside the laser square are the **dead zone**. Anything in it (apples, power-ups) is removed the moment a
laser passes over it. A snake **body** in the dead zone does not die (the head is the only fatal point) but the
head entering or being inside the dead zone when the laser steps onto it dies.

### 2.5 Death and round end
- Death is evaluated after every grid step in this order: wall/laser, self, other snake body, other snake head.
- When one snake dies the round ends immediately (survivor wins). `crashSlowMo`: game time runs at 0.25× for 0.6 s,
  then ROUND_OVER.
- Round result is one of `P1_WIN | P2_WIN | DRAW`. Draws never count; the match simply replays the round.

### 2.6 Match
- Formats: Best of 1 (first to 1), Best of 3 (first to 2), Best of 5 (first to 3).
- Between rounds: scoreboard for 2.5 s (or Enter to skip after 1 s) → countdown → next round. Round winner is
  displayed with the "needs N more win(s)" line from the GDD example.
- Match win rewards: Bo1 0 keys, Bo3 1 key, Bo5 2 keys, to the winner only. Keys are added when the MATCH_OVER
  screen shows the key animation, and persisted immediately.
- After MATCH_OVER: `REMATCH` (same settings, swap nothing) or `MAIN MENU`.

### 2.7 Player colours
- Two players can never select the same colour. Selecting a colour the other player holds swaps the two.
- Colour catalogue (hex, plastic base colour):
  Red `#E3261B`, Blue `#1F6FE5`, Green `#2FB44B`, Yellow `#F6C21B`, Orange `#F27A1A`, Purple `#8A3FD1`,
  Teal `#12B5B0`, Gold `#E8B028` with metallic sheen (roughness 0.25, metalness 0.6).

### 2.8 Pause and focus
- `Esc` during PLAYING opens PAUSE (Resume / Restart match / Quit to menu). Simulation is frozen; music ducks.
- Losing window focus pauses automatically. Resuming from pause shows a 1-second "READY?" then continues.

### 2.9 Save data
Schema version 1, stored under `localStorage["kobisnake.save.v1"]`. Exactly the GDD object, plus `schemaVersion: 1`
and `ownedColors` replacing `unlockedColors`. Corrupt or missing data → defaults. Never store anything else.

## 3. Visual notes for un-illustrated screens

These substitute for the GDD images that were not supplied (see `docs/reference/README.md`).

**Match setup (GDD image 15).** Same dark rounded panels as the main-menu image. Left column: MATCH LENGTH
(three pills), POWER-UPS (ON/OFF pills), MUSIC (three pills). Centre: a miniature arena with the two chosen snake
models facing each other; changing a colour recolours the model live. Bottom: big yellow START MATCH button.
Keyboard: ↑↓ move between rows, ←→ change value, Enter start, Esc back. Player colour rows use ←→ to cycle owned
colours only.

**Shop interior (GDD image 16).** A bright brick showroom. Eight pedestals in a shallow arc (Red, Blue, Green,
Yellow, Orange, Purple, Teal, Gold), each holding a coiled 8-segment snake of that colour that idles (slow
breathing and eye blink). A floating panel above the focused pedestal shows name, key price (key icon + number)
or OWNED, and two buttons: BUY (disabled and greyed when unaffordable or owned) and TRY. Key counter top-right
as a toy key icon + count. Purchase: pedestal flashes, key count ticks down, panel becomes OWNED + SELECT P1 /
SELECT P2.

**Food & growth (image 10).** Apple pop: scale 1 → 1.3 → 0 over 0.15 s, 8–12 red/green particle bricks, a
brightness pulse that travels head → tail over 0.3 s, new segment appears at the tail scaling 0 → 1 over 0.2 s.

**Power-up sheet (image 11).** Shared pedestal, ring, idle bob (±0.1 units, 1.2 s) and slow spin (30°/s).
Collected: ring expands to 2× and fades, 16 particles in the power-up colour. Snake effect: Speed = yellow
emissive pulses along the body + short motion streak behind the head; Slow (applied to the victim) = pale-blue
tint and a small snowflake above the head, both for the effect duration.

**Crash & laser death (image 12).** Collision: the dead snake's segments detach into rigid bricks that tumble
outward (simple ballistic + spin, 0.8 s, then fade); screen shake 0.3 s amplitude 0.15 units; 0.25× slow-mo for
0.6 s. Laser death: same but the head segment flashes white, sparks are emitted in the laser colour, and the
first three segments fade with an emissive glow instead of tumbling.

**Tutorial (image 17).** A single rounded bubble anchored to the top-left of the arena, max two short lines,
32 px text, with a key-cap graphic row when relevant. "SKIP (Esc)" bottom-right at 60 % opacity.

**Materials bible (image 18).** Plastic: `MeshStandardMaterial`, roughness 0.35, metalness 0.0, clearcoat via a
subtle specular highlight from one key light. Arena floor tiles: two greens `#3DB54A` and `#33A241` in a random
70/30 mix plus 4 % grey tiles `#B9BCC2`. Walls: yellow `#F6C21B`, blue `#1F6FE5`, grey `#7C8088`. Lasers: red
`#FF2A2A` emissive intensity 4, additive floor glow. Key light: warm directional (colour `#FFF3E0`, intensity
2.2, from top-front-left, casting soft shadows, shadow map 2048). Fill: hemisphere sky `#CFE9FF` ground
`#5A6A40` intensity 0.8. Background/outside-arena: darker desaturated bricks, trees, lanterns, banners, all
static and instanced.

## 4. The SETTINGS object (shipping defaults)

```js
export const SETTINGS = {
  grid: { width: 24, height: 24 },
  simHz: 120,
  roundDuration: 90,
  countdownStepSeconds: 0.8,

  snakeSpeed: 6,               // cells per second
  startingSnakeLength: 4,
  growthPerFood: 1,
  inputBufferSize: 2,

  foodCount: 4,
  foodMinDistanceFromHead: 2,

  powerUpsEnabled: true,
  powerUpFirstSpawnAt: 75,     // seconds remaining
  powerUpInterval: 15,
  powerUpMinDistanceFromHead: 3,
  speedBoost: { multiplier: 1.5, duration: 5 },
  slow: { multiplier: 0.6, duration: 4, laserMultiplierWhenSolo: 2 },

  laserStartTime: 30,          // seconds remaining
  laserWarningDuration: 5,
  laserStepInterval: 2.5,
  laserMinArena: 6,

  crashSlowMo: { scale: 0.25, duration: 0.6 },
  scoreboardSeconds: 2.5,

  bestOfOptions: [1, 3, 5],
  rewards: { 1: 0, 3: 1, 5: 2 },

  colors: { /* see section 2.7 */ },
  shopPrices: { green: 2, yellow: 2, orange: 3, purple: 3, teal: 3, gold: 6 },

  camera: { fov: 32, pitchDegrees: 78, margin: 1.5 },
};
```

## 5. Things Version 1 deliberately does NOT do
- No single-player mode (menu item says COMING SOON) — Sprint 16.
- No obstacles inside the arena — Sprint 17 backlog.
- No rebindable keys, gamepads, or touch controls.
- No online anything: no analytics, no fonts from CDNs, no external scripts. The built site must make zero
  network requests after the initial page load (QA verifies this).
- No volume sliders (ON/OFF only).
