# KOBI Snake — Technical Architecture

Owner: **Fable (design lead)** with **Opus (tech lead)** as implementation authority. Status: LOCKED for V1.
Every sprint ticket references paths from this document. If a builder needs a module that is not here, they
propose it in the PR description and Opus approves before merge.

## 1. Guiding constraints (from the GDD)
1. Plain **HTML + CSS + JavaScript (ES modules)**. No framework, no TypeScript build step. JSDoc types with
   `// @ts-check` at the top of every file in `src/core/` so editors and CI still type-check.
2. **Three.js** is an npm dependency, bundled by Vite. Nothing loads from a CDN. The built site works offline.
3. **The simulation never touches the DOM or Three.js.** `src/core/` is pure data-in/data-out and is where ~all
   unit tests live. This is what makes "ample QA" possible: the whole game can be played headlessly in a test.
4. Readable to an 11-year-old: small files, one class per file, descriptive names, comments that explain *why*,
   all magic numbers in `settings.js`.

## 2. Toolchain
| Concern | Choice |
|---|---|
| Bundler / dev server | Vite 5 (`vite`, `vite build`, `vite preview`) |
| 3D | `three` (pinned exact version) |
| Unit tests | Vitest (`npm run test:unit`), coverage via `@vitest/coverage-v8` |
| End-to-end | Playwright (`npm run test:e2e`), Chromium in CI, Firefox + WebKit nightly |
| Lint / format | ESLint (flat config, `eslint:recommended` + import rules) and Prettier |
| Type checking | `tsc --noEmit --checkJs` over `src/core` and `src/game` using `jsconfig.json` |
| CI | GitHub Actions: `ci.yml` (lint, typecheck, unit, build, e2e) on every PR and on `main` |
| Hosting | **Vercel** static deployment of `dist/`. Preview deployment per PR, production from `main`. |
| Node | 20 LTS, `package-lock.json` committed |

## 3. Repository layout
```
/
├── index.html                  # single page; canvas + UI overlay root
├── vite.config.js
├── vercel.json                 # static output, immutable cache headers for /assets
├── package.json
├── jsconfig.json
├── .github/workflows/ci.yml
├── .github/pull_request_template.md
├── CLAUDE.md                   # rules for builder agents
├── docs/                       # design, sprints, QA, reference images
├── public/                     # favicon, manifest (no game assets live here)
├── src/
│   ├── main.js                 # boot: create Game, start loop
│   ├── core/                   # PURE simulation (no DOM, no three)
│   │   ├── settings.js         # SETTINGS object (see DESIGN-DECISIONS §4)
│   │   ├── rng.js              # seeded mulberry32; every random call goes through here
│   │   ├── grid.js             # cell helpers, directions, bounds
│   │   ├── snake.js            # Snake: segments, direction queue, speed modifiers, step()
│   │   ├── food.js             # apple placement / respawn
│   │   ├── powerups.js         # spawn cycle, pickup, effect timers
│   │   ├── lasers.js           # warning + step schedule, dead-zone query
│   │   ├── collisions.js       # resolveStep(): death evaluation order
│   │   ├── round.js            # RoundSimulation: owns everything above; advance(dtSeconds) → events[]
│   │   ├── match.js            # MatchState: best-of logic, wins, draws, rewards
│   │   └── events.js           # event type constants emitted by the simulation
│   ├── game/                   # orchestration (DOM allowed, three NOT allowed)
│   │   ├── gameStateMachine.js # MAIN_MENU … MATCH_OVER, PAUSE
│   │   ├── input.js            # keyboard → per-player direction queues; menu navigation events
│   │   ├── loop.js             # requestAnimationFrame, fixed-step accumulator, time scale (slow-mo)
│   │   └── session.js          # wires match settings, save data, audio, renderer, ui together
│   ├── render/                 # three.js only
│   │   ├── renderer.js         # WebGLRenderer, resize, pixel-ratio cap, shadow settings
│   │   ├── camera.js           # fixed gameplay camera + shake/zoom pulses
│   │   ├── materials.js        # plastic material factory, colour catalogue → materials
│   │   ├── brickGeometry.js    # reusable brick/stud/rounded-box geometries (merged, instanced)
│   │   ├── arenaView.js        # floor tiles, walls, emitters, outside decoration
│   │   ├── snakeView.js        # segment meshes, head, eyes, interpolation, corner bending, growth anim
│   │   ├── pickupView.js       # apples, power-up pedestals, idle animation
│   │   ├── laserView.js        # beams, floor glow, dead-zone darkening, emitter lights
│   │   ├── effects/            # particles.js, crashDebris.js, screenShake.js
│   │   ├── shopScene.js        # shop room, pedestals, rail camera, pointer picking
│   │   └── menuScene.js        # background scene behind menus (title bricks, idle snakes)
│   ├── ui/                     # HTML overlay (DOM only)
│   │   ├── ui.js               # screen router: show(screenName, props)
│   │   ├── hud.js              # timer, player pills, win pips, power-up tag, warning banner
│   │   ├── screens/            # mainMenu.js, matchSetup.js, settings.js, pause.js, scoreboard.js,
│   │   │                       # matchOver.js, countdown.js, shopOverlay.js, tutorialBubble.js
│   │   ├── focus.js            # keyboard navigation model shared by all menus
│   │   └── styles.css
│   ├── audio/
│   │   ├── audioEngine.js      # AudioContext, master/music/sfx gains, unlock on first key
│   │   ├── synth.js            # tiny polyphonic synth (osc + env + filter)
│   │   ├── sequencer.js        # plays note-data tracks in a loop, tempo, mute/duck
│   │   ├── tracks/             # track1.js, track2.js, track3.js, laserSting.js (note data)
│   │   └── sfx.js              # named one-shot sounds built from synth params
│   ├── save/
│   │   └── saveData.js         # load/save/migrate, defaults, validation
│   ├── modes/
│   │   ├── practice.js         # untimed round, no rewards, both key sets
│   │   └── tutorial.js         # scripted steps driving RoundSimulation + tutorialBubble
│   └── shop/
│       └── shop.js             # catalogue, purchase rules, try → practice
└── tests/
    ├── unit/                   # vitest, mirrors src/core and src/game
    ├── sim/                    # headless full-round simulations, bots, statistics
    ├── e2e/                    # playwright specs + fixtures
    └── visual/                 # playwright screenshot specs + approved baselines
```

## 4. Simulation model (`src/core`)
- `RoundSimulation.advance(dt)` is the only way time passes. It steps at `1/simHz` internally, accumulating `dt`.
  It returns an array of events (`FOOD_EATEN`, `POWERUP_SPAWNED`, `POWERUP_COLLECTED`, `EFFECT_STARTED`,
  `EFFECT_ENDED`, `LASER_WARNING`, `LASER_STEP`, `SNAKE_DIED`, `ROUND_OVER`, ...). Render, audio and UI react to
  events; they never poll internal fields except through read-only getters (`getState()` returns a plain
  serialisable snapshot).
- Determinism: constructor takes `{ settings, seed, players, powerUpsEnabled }`. Same seed + same input log ⇒
  identical event log. Tests assert on this. An **input log** (`{t, player, dir}`) can be recorded from a real
  game and replayed in a test.
- Snakes: `segments[0]` is the head. `pendingGrowth` counter adds a tail segment on the next step instead of
  removing it. Per-snake `speedMultiplier` = product of active effect multipliers.
- Step resolution: all snakes that are due to step in this sim tick are stepped **simultaneously** (compute all
  new head cells first, then evaluate deaths), which is what makes head-to-head symmetric.
- Lasers: `insetCells` (0 at start). Dead zone is any cell with x < inset, x ≥ width−inset, same for y. Walls are
  simply "inset −1" so the same query answers wall and laser deaths.

## 5. Game loop and interpolation (`src/game/loop.js`)
- `requestAnimationFrame` drives rendering. Simulation is advanced by `frameDt * timeScale`, clamped to 100 ms
  per frame to avoid spiral-of-death after tab switches (the sim clock therefore stalls rather than jumps).
- `timeScale` is 1 normally, 0.25 during crash slow-mo, 0 when paused.
- Renderer receives `alpha = snake.stepProgress` (0..1) for each snake and lerps every segment from its previous
  cell to its current cell. Corner segments bend using the previous/next segment directions (see
  `09-snake-turning-animation.png`).

## 6. State machine (`src/game/gameStateMachine.js`)
States exactly as GDD §7: `MAIN_MENU, MATCH_SETUP, TUTORIAL, PRACTICE, SHOP, SETTINGS, COUNTDOWN, PLAYING,
LASER_WARNING, ROUND_OVER, MATCH_OVER` plus `PAUSE`. Transitions are a data table (`TRANSITIONS[state][event]`)
so QA can test every allowed and forbidden transition. `LASER_WARNING` is a sub-state of PLAYING for UI/audio
purposes; the simulation keeps running.

## 7. Rendering rules
- One `THREE.Scene` for gameplay, one for the menu background, one for the shop. Only one is rendered per frame.
- Geometry budget: arena + walls + decorations are **merged or instanced** (≤ 60 draw calls at rest). Snake
  segments use `InstancedMesh` per colour. Target **60 fps on an integrated GPU laptop at 1080p**; pixel ratio
  capped at 2.
- Shadows: one directional shadow-casting light, 2048 map, PCFSoft. Nothing else casts.
- Post-processing: none in V1. Laser glow is done with emissive materials + additive floor quads, not bloom.
- All colours come from `SETTINGS.colors` / `materials.js`; no hex literals in view code.

## 8. UI rules
- Menus are HTML in `#ui` over the canvas. One screen visible at a time via `ui.show()`.
- Keyboard model (`focus.js`): ↑/↓ or W/S move focus, ←/→ or A/D change a value, Enter select, Esc back. Mouse
  hover moves focus, click selects. Every focusable element has a visible focus ring.
- Text is real DOM text (crisp, selectable, screen-reader friendly). Panels use the chunky toy style from the
  reference images through CSS only (borders, radii, gradients, studs as pseudo-elements).
- HUD updates come from simulation events, throttled to 10 Hz for the timer text.

## 9. Audio rules
- `AudioContext` is created on the first keydown (browser autoplay policy). Until then, the game runs silent.
- Music tracks are `{ bpm, patterns: [...] }` data. Switching track crossfades over 0.5 s. The laser sting ducks
  music to −12 dB, plays 5 s, music returns.
- Settings toggles mute the corresponding gain node; state persists in save data.

## 10. Save data
`saveData.js` exposes `load()`, `save(partial)`, `reset()`. Validates types, fills defaults, migrates by
`schemaVersion`. No other module calls `localStorage`.

## 11. Testing hooks (used by QA sprints)
- `window.__kobi` is exposed **only** when `import.meta.env.DEV` or `?test=1`: `{ sim, stateMachine, setSeed(),
  fastForward(seconds), getSnapshot(), pressKey(player, dir) }`. Playwright uses it to drive deterministic e2e
  scenarios without waiting real time.
- `?seed=123` fixes the RNG for visual regression baselines. `?reducedFx=1` disables particles for screenshot
  stability.

## 12. Performance budgets (enforced in Sprint 14, measured from Sprint 02)
| Metric | Budget |
|---|---|
| Initial JS bundle (gzip) | ≤ 350 kB including three.js |
| Time to first frame (cold, mid-range laptop) | ≤ 2 s |
| Frame time during PLAYING (integrated GPU, 1080p) | p95 ≤ 16.6 ms |
| Draw calls during PLAYING | ≤ 120 |
| Network requests after load | 0 |
