# KOBI Snake — Design Decisions (Version 1)

Owner: **Fable (design lead)**. Status: **LOCKED for Version 1** unless a Playtest Gate (Sprint 07 or Sprint 17)
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
| 3 / 21 | Slow power-up behaviour | **SLOW slows every snake except the collector** to 0.6× speed for 4 s. In practice/single-player (no opponent) it instead slows the laser step interval by 2× for 4 s. Unreachable until Sprint 19 (practice has no clock, so nothing spawns there); built and unit-tested anyway. | Benefits the collector, obvious to both players, symmetric with Speed Boost (one helps you, one hinders them). |
| 4 | Speed boost multiplier | **1.5× movement speed for 5 s.** | Noticeably faster, still controllable at the base speed below. |
| 5 | Laser shrink speed | **One grid cell inward per side every 2.5 s**, first step 5 s after the warning starts. | Reaches the minimum arena with ~2.5 s to spare in a 90 s round. Readable, stepwise, glides visually. |
| 6 / 23 | Minimum final arena | **6 × 6 cells.** Lasers stop there. | Two length-15 snakes still fit; near-zero arenas produce unfair "nowhere to go" deaths. |
| 7 / 22 | Simultaneous crash | **Both die in the same simulation step → round is a DRAW → replay the round**, no win recorded. (Head-on is the exception; see row 8.) | Symmetric, needs no tie-break the players must learn. Rare in practice: 1–4 % of bot rounds. |
| 8 | Head-to-head | Both heads enter the same cell, or swap cells, in the same step → **the longer snake survives, the shorter dies** (cause `HEAD_ON`). Equal length → both die → draw → replay. If one head enters a cell the other head already occupies (different step), the arriving snake dies. | "Bigger snake wins a head-on" is a one-sentence rule, it gives apples a purpose in two-player, and the pre-sprint simulation showed the both-die rule produced 35 % draws between cautious snakes in the final 6×6 square versus 10 % with this rule (`docs/design/spikes/`). **Owner-approved 2026-09-05.** |
| 9 | Arena wall before lasers | Outer wall is **deadly** on head contact from second 0. Lasers start parked exactly on the wall line, unlit. | Classic Snake rule; the laser phase changes where the deadly edge is, not whether it exists. |
| 10 | Self-collision | **Deadly** (classic). | Confirmed as GDD recommended. |
| 11 | Starting snake length | **4 segments** (head + 3). | GDD settings object value. |
| 12 | Number of unlockable colours | **6**: Green, Yellow, Orange, Purple, Teal, Gold. Red and Blue are owned from the start. | Matches the GDD shop prompt list plus one; enough for a full shop room. |
| 13 | Key prices | Green 2 · Yellow 2 · Orange 3 · Purple 3 · Teal 3 · Gold 6. | One Best-of-5 win (2 keys) buys the first colour; Gold is the long-term goal. |
| 14 | Shop navigation | **Rail camera**: pedestals in an arc, mouse hover/click or ←/→ keys focus a pedestal, camera glides to it. No free-roam. Esc returns to the menu. | GDD wants mouse in the shop; free-roam first-person is complexity with no gameplay value. |
| 15 | Additional cosmetics in V1 | **Colours only.** Eyes/hats/trails are post-1.0. | Scope control. |
| 16 | Single-player mechanics | Post-1.0 (Sprint 19): solo survival, apples score points, laser phase every 90 s cycle, speed ramps, local high score. Menu shows "COMING SOON" until then. | GDD: two-player first. |
| 17 | Numerical score for food | **No numeric score in two-player.** Length is the visible score. Single-player has a score (S19). | Keeps the HUD to timer + wins. |
| 18 | Food persistence | **Persists until collected.** Never despawns. | Simplicity; encourages movement. |
| 19 | Food items active at once | **4** apples always present; a collected apple respawns immediately at a random free cell. | Concept images show 4–6; 4 keeps the arena uncluttered. |
| 20 | Power-up visuals | Speed = yellow lightning bolt over a blue two-tier pedestal inside a cyan ring. Slow = **white snowflake over a mid ice-blue pedestal (`#4FA9DD`) inside a pale-blue ring**; the icon must contrast with its pedestal as strongly as the bolt does (white-on-white was unreadable at gameplay scale, Sprint 06). Different silhouette, icon, colour and pedestal. | GDD: never rely on colour alone. |
| 24 | Camera | **Perspective camera, vertical FOV 32°, pitch 78° below horizontal** (image 03 panel C), yaw 0, fixed position framing the whole arena plus one wall thickness of margin. Small shake on crash, ≤ 2 % zoom pulse on laser warning, no rotation. **Confirmed picture (Sprint 03):** at 16:9 the arena fills ≈ 84 % of the frame height and ≈ 48 % of its width; the flanks carry Sprint 09's decoration, as in panel C, not the wider board of image 02. | Locked by the camera comparison sheet. |
| 25 | Music production | **Two lanes.** (a) Synthesised in-repo (note data + Web Audio synth) as the guaranteed baseline. (b) **Freesound assets** chosen by the owner: CC0 preferred, CC-BY allowed with attribution in the credits screen, no NC/ND licences; files bundled under `public/audio/` (OGG + MP3, ≤ 300 kB each, music ≤ 1.5 MB per track), listed in `docs/design/AUDIO-ASSETS.md` with Freesound URL, author and licence. Agents cannot reach freesound.org; the owner supplies the files. Still no CDN, still offline after load. | Owner has a Freesound account and prefers real recordings; the synth lane guarantees the game is never silent. |
| 26 | A match that cannot be won | **A draw is still replayed, but no more than twice in a row.** The third consecutive draw ends the match: whoever has more round wins takes it, and if the wins are level nobody wins and the match is a tie. A decisive round resets the count. `maxConsecutiveDraws: 3`. A tie awards no keys. | Agent QA 2026-09-07 (#119 F1): two idle players draw at tick 380 every round and the match could never end. Every match must terminate. |
| 27 | Playing alone | **A CPU opponent in the two-player mode** (Improvement 12): 2 PLAYERS gains a per-player HUMAN / CPU choice on match setup, defaulting to HUMAN for both. The CPU plays through the same input queue as a keyboard, at three named levels (EASY = the greedy bot, NORMAL = the survivor bot, HARD = the survivor bot that also eats when it is safe — a level that steered into head-ons measured 3.5 points *weaker* than NORMAL, #228; measured 2026-09-08 at +3.1 pp against NORMAL, 95 % interval ±6.3 over 971 decisive rounds — indistinguishable from zero, so **two levels ship, HUMAN / CPU EASY / CPU NORMAL, and HARD stays defined in `levels.js` but off the menu**; `docs/qa/playtests/cpu-levels.md` carries both measurements and a guard asserts HARD has not quietly become stronger), and never sees anything a human cannot. Keys are awarded only when at least one human is playing. Solo survival (row 16) is unchanged and still post-1.0. | Design-lead ruling 2026-09-07; the owner may veto. A child alone should be able to play the game that exists. |
| 28 | Fair play between mismatched players | **Handicaps, names, and swapping sides** (Improvement 13). Match setup gains, per player: a NAME (up to 10 characters, defaults P1/P2), a HEAD START of 0–6 extra segments, and a SPEED handicap of 100 % / 85 % / 70 %. REMATCH gains SWAP SIDES, which exchanges spawn points and controls, not colours. None of it changes the simulation's rules — a handicap is an initial condition and a speed multiplier the simulation already supports. Defaults reproduce today's match exactly. | Design-lead ruling 2026-09-07; the owner may veto. The GDD's audience is a child and a parent, who are not evenly matched. |
| 29 | Remembering what happened | **Match history and a STATS screen** (Improvement 14), stored locally under the Sprint 13 save schema: per player-name, matches and rounds won, longest snake, rounds survived into the laser phase, head-to-head record, and the seed of the last match so it can be replayed (Improvement 05). Nothing leaves the browser. | Design-lead ruling 2026-09-07; the owner may veto. |
| 30 | Round pacing levers | **Measured, decision deferred to Gate 1 (Improvement 04, #229).** Over 33 cells and 12 299 seeded rounds: `roundDuration` moves the fraction of rounds reaching the lasers most (90→75 s: +16 to +23 points) but by arithmetic — it deletes play that would not have reached them; `laserStartTime` 40 s converts existing play into climax (+9 to +16 points) at unchanged match length; `laserStartTime` 20 s is a cliff (lasers stall at inset 7, 80 % of careful rounds time out) and is excluded as a value. **No settings change.** Both candidates ship as tuning-overlay presets beside the Speed Boost pair — `round 75 s` and `laser at 0:40` — and Gate 1 session 2 decides against `§5 A2` and `§6 R1`. The design lead's lean if humans cannot tell them apart: `laserStartTime: 40`, which keeps the GDD's round and makes the closing phase 44 % of it. | Bots die more cheaply than people, so the human baseline is above the bots' 9.5 % and the change needed is probably smaller than any cell implies; a permanent value must be chosen against the right population. |

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
- A reversal is judged against the **last queued** direction when the queue is non-empty, and against the
  committed direction only when it is empty. (Otherwise a two-turn U-turn could never be buffered.)
- Both key sets are polled every frame; whichever player's key it is goes to that player's queue. P1 = WASD,
  P2 = Arrow keys. In single-player, practice and tutorial, **both** key sets steer the one snake.
- Keys are never rebindable in V1. Mouse is ignored during PLAYING.

### 2.3 Spawn positions
- P1 starts at cell (5, 12) heading **right**, body extending left. P2 starts at (18, 11) heading **left**, body
  extending right. (Offset rows so a straight charge is never an instant head-on.)
- Apples spawn only on free cells at least **2** cells (Chebyshev distance) from any snake head and never inside
  the laser dead zone. Power-ups additionally require ≥ 3 cells from any head and never on an apple.
- **When nothing fits** (only possible in the shrunken endgame): retry apple placement with head distance 1,
  then 0. If the safe square has no free cell at all, the slot stays empty and is retried every tick; in that
  state `foodCount` is a target, not an invariant. Power-ups relax 3 → 2 → 1 → 0 and otherwise skip that spawn
  cycle. Placement never throws inside a round.
- **Apples never line up** (owner playtest, 2026-09-06): a new apple may not share a row or a column with any
  existing apple, and must be ≥ `foodMinDistanceFromFood` (3) Chebyshev cells from every other apple. This
  applies to the opening board too. Fallback ladder when nothing fits: drop the row/column rule, then apple
  distance 2, 1, 0, then the head-distance ladder above.

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
- Death is evaluated after every grid step in this order: wall/laser, self, other snake body, other snake head
  (head-on resolves by length: longer survives, equal both die).
- When one snake dies the round ends immediately (survivor wins). `crashSlowMo`: game time runs at 0.25× for 0.6 s,
  then ROUND_OVER.
- Round result is one of `P1_WIN | P2_WIN | DRAW`. Draws never count; the match simply replays the round —
  but **only twice in a row** (`§1` row 26). The third consecutive draw ends the match: the player with more
  wins takes it, and if the wins are level the match is a tie, won by nobody and worth no keys. Any decisive
  round resets the count. Without this a match of draws never ends, which two idle players reach in ninety
  seconds (agent QA 2026-09-07, #119 F1).
- Head-on (same cell, or swap) is evaluated **before** body contact, because after a step the other snake's
  former head cell has become its neck.
- Head-on length comparison uses the lengths **before** this step's growth is applied.
- Practice rounds have **no result**: `ROUND_OVER.result` and `winnerId` are `null`; `reason` is recorded.
- The 3·2·1·GO countdown lives in the game state machine, not the simulation. Simulation time starts at the
  round's first tick.

### 2.6 Match
- Formats: Best of 1 (first to 1), Best of 3 (first to 2), Best of 5 (first to 3). **Match setup opens on Best of 3.**
- Between rounds: scoreboard for 2.5 s (or Enter to skip after 1 s) → countdown → next round. Round winner is
  displayed with the "needs N more win(s)" line from the GDD example.
- Match win rewards: Bo1 0 keys, Bo3 1 key, Bo5 2 keys, to the winner only. Keys are added when the MATCH_OVER
  screen shows the key animation, and persisted immediately.
- A match ends when a player reaches the win target **or** on the third consecutive draw (`§1` row 26). It
  can therefore end with nobody having won; the match-over screen says so and awards no keys.
- After MATCH_OVER: `REMATCH` (same settings, swap nothing) or `MAIN MENU`.

### 2.7 Player colours
- Two players can never select the same colour. Selecting a colour the other player holds swaps the two.
- Colour catalogue (hex, plastic base colour):
  Red `#E3261B`, Blue `#1F6FE5`, Green `#2FB44B`, Yellow `#F6C21B`, Orange `#F27A1A`, Purple `#8A3FD1`,
  Teal `#12B5B0`, Gold `#E8B028` with metallic sheen (roughness 0.25, metalness 0.6).
- **A colour added to this catalogue is checked against the player-pair rule before it ships** (ruled on #121,
  reworded here by KI-15-01 as that ruling directed; the rule itself is `tests/unit/render/colourVision.test.js`).
  The player-pair rule is **not** the luminance rule. Player-vs-player pairs came out of
  `MIN_LUMINANCE_SEPARATION` entirely on #121: relative luminance measures figure against ground — an apple on
  the floor, an icon on its pedestal — and it answers "can two people tell their snakes apart" badly enough to
  have ranked `red`/`blue` the worst pair in this catalogue, which is the pair every match starts with and one
  nobody has ever confused.
- The instrument is **CIEDE2000 between the two body colours, measured three times: under normal vision and
  under simulated protanopia and deuteranopia** (`src/render/colourVision.js`, which cites its two published
  sources). A pair is judged by its *worst* showing of the three, because a pair of colours has to work for
  whoever is holding the keyboard rather than on average. The threshold is `MIN_COLOUR_DIFFERENCE`.
- **`MIN_COLOUR_DIFFERENCE = 15` — ruled by Fable, 2026-09-07 (#184).** The palette's 28 pairs leave a
  7-wide empty band between 11.7 and 18.7, so every threshold from 12 through 18 fails exactly the same nine
  pairs: the palette decides which pairs fail and the constant only has to land in the band, which a test
  asserts. Nine of the 28 fail today and are recorded as ratcheted waivers; the numbers live in the test and
  on #184 rather than here, so this document cannot go stale the moment a colour is repainted. `red` and
  `blue` are the only two owned from the start, and that pair clears the rule three times over.
- **The shop's gate (Sprint 14, #213): no colour may be sold while it fails this rule against a default colour
  or against any colour already owned.** On the shipping catalogue that means `purple` (3.1 against the free
  blue) and `gold` (fails three of seven partners) are repainted before they go on sale, and `green` (9.9
  against player one's red) is not the cheapest first unlock without a repaint or a different price order.
- Pedestal-vs-player differences are measured and reported but **not bound** by this rule: SPEED's pedestal
  *is* player blue by `§1` row 20, and the two power-ups are told apart by silhouette, icon and pedestal, not
  colour alone.

### 2.8 Pause and focus
- `Esc` **or `Space`** during PLAYING opens PAUSE (Resume / Restart match / Quit to menu). **`Esc` or `Space` on the pause screen resumes** (Esc
  is "back" on every screen, `ARCHITECTURE §8`) and goes through the same READY? beat as Resume. Restart match
  reuses the REMATCH event. Simulation is frozen; music ducks.
- Losing window focus pauses automatically. Resuming from pause shows a 1-second "READY?" then continues.

### 2.9 Save data
Schema version 1, stored under `localStorage["kobisnake.save.v1"]`. Exactly the GDD object, plus `schemaVersion: 1`
and `ownedColors` replacing `unlockedColors`. Corrupt or missing data → defaults. Never store anything else.

## 3. Visual notes for un-illustrated screens

These substitute for the GDD images that were not supplied (see `docs/reference/README.md`).

**First-minute copy (Improvement 10, KI-10-00).** Approved strings, to be used verbatim. Written for an
eleven-year-old: short words, no jargon, and no exclamation mark doing the work that clarity should.

- **Under the title on the main menu:** "Two players, one keyboard. Eat apples, grow long, and make the other
  snake crash."
- **HOW TO PLAY panel**, four lines in this order:
  1. "Eat apples to grow longer."
  2. "Don't hit a wall, yourself, or the other snake."
  3. "After 30 seconds the lasers close in."
  4. "The last snake alive wins the round."
- **Controls card on match setup.** Two blocks, each labelled in words as well as colour (the GDD's "never rely
  on colour alone" applies here too): "PLAYER 1 · RED — W A S D" and "PLAYER 2 · BLUE — ARROW KEYS". If
  Improvement 07 has landed, read the live bindings rather than these literals and say so in the PR.
- **Items that are not ready** keep the existing "COMING SOON". They stay visible and stay unselectable: the
  GDD promises them, and hiding them would misrepresent the game's shape.
- **A match that ends level** (`§1` row 26): the match-over screen reads "IT'S A TIE" with the score line
  beneath it, and no key is awarded.
- **The scoreboard on the third consecutive draw** (#150): that round is not replayed, so it must not say REPLAY.
  It reads **"THIRD DRAW — MATCH OVER"**, then the match-over screen follows as usual. The ordinary draw keeps
  "DRAW — REPLAY" and the second keeps its "one more and the match is called" warning.
- **The colour-safe pairing note on match setup** (Improvement 15, KI-15-02): two lines, verbatim, next to
  the colour rows — "These two colours look alike to some players." and "Try TEAL for PLAYER 2." The colour
  word and the player number are computed, never literals; PLAYER is capitalised because the controls card
  on the same screen spells it so. The note informs and never blocks, and it wraps inside a fixed-width
  panel so the preview apple stays visible (#214).
- **The REPLAY screen** (Improvement 05, #211). An eighth, enabled main-menu row `REPLAY`, placed with
  `2 PLAYERS` and `HOW TO PLAY` above the locked group; `2 PLAYERS` stays the default focus. Screen heading
  `REPLAY`; label `PASTE A REPLAY`; placeholder "Paste the replay text here."; buttons `WATCH` and `OPEN A FILE`.
  Transport: `PLAY` / `PAUSE` on one toggled button, `STEP`, `START AGAIN`; readout `TICK 137 / 380` (the word
  stays — it is the unit the screen exists to show); key hint `SPACE PLAY · . STEP · ← → SCRUB · ESC BACK` (a
  full stop for step, so W/A/S/D stay clear); `END OF REPLAY` at the end. A bad paste shows
  `THAT IS NOT A REPLAY` over the parser's one-sentence reason; a future version shows `THIS REPLAY IS TOO NEW`
  / "It was made by a newer version of the game." `WATCH LAST ROUND` is a row on the **match-over** screen, not
  the scoreboard: the scoreboard is a 2.5-second passive beat and its interaction model is Sprint 11's to
  redesign. A replay accepts no player input into the simulation.
- **The playtest prompt's key hint** (#182, Improvement 11): one line under the answers, verbatim:
  "← → CHOOSE · ENTER ANSWER · ESC SKIP". The questions themselves are `PLAYTEST-SCRIPT.md`'s own words.
- **The match-setup miniature arena shows one apple** (#157), at a fixed cell, so a player choosing a colour sees
  it beside the thing they will be chasing. It is a picture, not a round: nothing moves.

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
**The SLOW collector also gets a confirmation**: a 0.4 s ice-blue ring pulse on its own head and the pickup
sound, so a player who grabs SLOW knows they collected something even though the effect lands on the
opponent (Sprint 10 VFX, Sprint 12 audio).

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
  foodMinDistanceFromFood: 3,
  foodNoSharedRowOrColumn: true,

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
  maxConsecutiveDraws: 3, // §1 row 26 — the third draw in a row ends the match
  rewards: { 1: 0, 3: 1, 5: 2 },

  colors: { /* see section 2.7 */ },
  shopPrices: { green: 2, yellow: 2, orange: 3, purple: 3, teal: 3, gold: 6 },

  camera: { fov: 32, pitchDegrees: 78, margin: 1.5 },
};
```

### 4.1 Test-only settings
`godMode: true` exists in the `Settings` *type* only, is honoured only under `import.meta.env.TEST`, and is absent
from `SETTINGS` (asserted). It exists so full-timeline golden logs can be recorded with immortal snakes.

## 5. Things Version 1 deliberately does NOT do
- No single-player mode (menu item says COMING SOON) — Sprint 19.
- No obstacles inside the arena — Sprint 20 backlog.
- No rebindable keys, gamepads, or touch controls.
- No online anything: no analytics, no fonts from CDNs, no external scripts. The built site must make zero
  network requests after the initial page load (QA verifies this).
- No volume sliders (ON/OFF only).
