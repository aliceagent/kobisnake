# Sprint 10 — HUD, Menus & Match Setup

**Lead:** Sonnet · **Agents:** Sonnet ×2, Sonnet-QA ×1, Fable · **Prerequisite:** `gate1-passed` (may run in parallel with S07–S09; needs `sprint-08-done` only for the final menu screenshots)

## Goal
The HTML overlay becomes the toy-styled interface from `13-gameplay-hud.png` and `14-main-menu.png`: player
pills with snake-face icons and round-win pips, the central timer panel with the BEST OF tab, the round pips,
the LASERS CLOSING! hazard banner, the block-built title, big yellow primary button, dark rounded secondary
buttons with icons, the match-setup screen, pause, scoreboard, match-over and settings screens. Keyboard and
mouse both work everywhere. Text stays crisp DOM text.

## In scope
CSS design system for the toy UI, all screens' final markup and styling, HUD, snake-face icons (SVG),
responsive layout, focus visuals, reduced-motion support.

## Out of scope
Audio (S11), shop overlay (S12), tutorial bubble (S13), the 3D title mesh (the title is CSS/SVG; a 3D mesh is a
post-1.0 nicety).

## Tickets

### KS-10-01 · Toy UI design system (CSS)
Owner: Sonnet · Size: M · Depends on: —
Files: `src/ui/styles.css`, `src/ui/tokens.css`, `docs/design/UI-STYLEGUIDE.md`
Spec: Tokens: colours from `SETTINGS.colors` mirrored as CSS variables (generated at build by a tiny Vite
plugin or copied with a unit test guarding equality), panel dark `#1C2230`, panel border `#2C3546`, yellow
primary `#F6C21B`, text `#FFFFFF`, muted `#AEB6C4`. Components: `.panel` (rounded 14 px, 3 px border, inner
top highlight), `.btn-primary` (yellow, chunky bottom shadow 6 px, press = translateY 4 px), `.btn-secondary`
(dark, icon slot), `.pill` (player pill with colour), `.pips` (win/round dots), `.tab` (BEST OF), `.hazard`
(red/black stripe banner). Studs as `::before` radial gradients on panels. Font: system UI stack with a heavy
weight (no web fonts; no CDN). Motion: 120 ms ease-out transitions; `prefers-reduced-motion` disables them.
Acceptance criteria:
- [ ] AC1 A style-guide page (`/styleguide.html`, DEV only) renders every component; Fable approves against images 13 and 14.
- [ ] AC2 CSS colour variables equal `SETTINGS.colors` (unit test).
- [ ] AC3 Zero external font or image requests (offline spec).
QA: visual baseline of the style-guide page.

### KS-10-02 · Gameplay HUD
Owner: Sonnet · Size: M · Depends on: KS-10-01
Files: `src/ui/hud.js`, `src/ui/icons.js`
Spec: Exactly `13-gameplay-hud.png`: top-left red P1 pill (snake-face SVG in the player colour, "P1", win pips
= `target` dots filled per win), top-centre yellow timer panel `m:ss` with a dark "BEST OF N" tab underneath,
top-right blue P2 pill mirrored. Bottom-centre "ROUND r OF n" pips (n = max rounds possible for the format:
1/3/5; filled = played). Power-up tag styled as the "SPEED BOOST 5s" pill. Warning banner = `.hazard` with a
⚠ and "LASERS CLOSING!", pulsing 2 Hz for 5 s. Timer turns red from 0:30. HUD never covers the arena: the
top band is above the far wall, bottom pips sit on the near wall (verify with the camera framing from S02).
Acceptance criteria:
- [ ] AC1 Screenshot vs image 13: Fable approves placement, sizes, colours.
- [ ] AC2 Pips reflect match state after each round (e2e over a Bo5).
- [ ] AC3 No HUD element's bounding box intersects the projected floor rectangle (e2e computes both).
QA: visual + e2e.

### KS-10-03 · Main menu
Owner: Sonnet · Size: M · Depends on: KS-10-01, KS-08-06
Files: `src/ui/screens/mainMenu.js`, `src/ui/title.js`
Spec: Title "KOBI SNAKE" as layered SVG/CSS block letters (K red, O blue, B yellow, I green on the top row;
SNAKE in white on a dark brick plate) matching `14-main-menu.png`; tagline "SMALL SNAKE. BIG FUN."; items in GDD
order: 1 PLAYER (COMING SOON), 2 PLAYERS (primary yellow), PRACTICE, TUTORIAL, SHOP, SETTINGS as secondary
buttons with icons. Optional small stats panel top-right (matches played, P1 wins, P2 wins) from save data
(zeros until S12). Focus = brighter border + slight scale. Keyboard hint line at the bottom ("↑↓ move · Enter
select"). Menu background scene from S08 behind.
Acceptance criteria:
- [ ] AC1 Fable approves vs image 14 (note: item list follows the GDD, not the image).
- [ ] AC2 Full keyboard and mouse operability (e2e).
- [ ] AC3 Layout holds from 1024×600 to 3840×2160 without overflow (three visual baselines).
QA: visual + e2e.

### KS-10-04 · Match setup screen
Owner: Sonnet · Size: M · Depends on: KS-10-01
Files: `src/ui/screens/matchSetup.js`, `src/render/menuScene.js` (setup pose)
Spec: Per `DESIGN-DECISIONS §3 "Match setup"`: rows as pill groups (MATCH LENGTH, POWER-UPS, MUSIC), centre
miniature arena (menu scene re-posed: both snakes facing each other) recoloured live as colours change, PLAYER
1 / PLAYER 2 colour rows show swatches of owned colours with the current one enlarged, START MATCH primary.
Keyboard ↑↓ rows, ←→ values, Enter start, Esc back.
Acceptance criteria:
- [ ] AC1 Changing a colour recolours the 3D snake within one frame.
- [ ] AC2 Same-colour selection swaps (already tested; re-verify visually).
- [ ] AC3 Fable approves against the image-15 prompt.
QA: visual + e2e.

### KS-10-05 · Countdown, scoreboard, match over, pause, settings shells
Owner: Sonnet · Size: M · Depends on: KS-10-01
Files: `src/ui/screens/countdown.js`, `src/ui/screens/scoreboard.js`, `src/ui/screens/matchOver.js`, `src/ui/screens/pause.js`, `src/ui/screens/settings.js`
Spec: Countdown: huge block-styled 3 / 2 / 1 / GO! centred, each popping in (scale 1.4 → 1) in the alternating
brick colours. Scoreboard: panel with both pills, wins, "X needs N more win(s)", format tab, "DRAW — REPLAY"
variant. Match over: "RED WINS THE MATCH!" in the winner colour, key icon + "+N KEYS" (animation in S12),
REMATCH / MAIN MENU buttons. Pause: dim overlay, RESUME / RESTART MATCH / QUIT TO MENU; "READY?" flash on
resume. Settings: MUSIC ON/OFF, SOUND ON/OFF pills (wired in S11), BACK.
Acceptance criteria:
- [ ] AC1 Every screen has a visual baseline approved by Fable.
- [ ] AC2 Countdown timing matches `countdownStepSeconds` (e2e measures ±1 frame).
QA: visual + e2e.

### KS-10-06 · UI accessibility pass
Owner: Sonnet-QA · Size: S · Depends on: KS-10-03, KS-10-05
Files: `tests/e2e/a11y.spec.js`
Spec: axe-core (bundled as a dev dependency, run only in tests) on every screen: no critical/serious
violations; every interactive element has an accessible name; focus order matches visual order; contrast ≥ 4.5:1
for body text and ≥ 3:1 for large text.
Acceptance criteria:
- [ ] AC1 Zero critical/serious violations on all screens.
QA: —

## QA plan (sprint pass)
1. Fable: fidelity review of HUD (image 13), main menu (image 14), and the setup screen (prompt 15).
2. Human: navigate every screen with keyboard only, then mouse only; note any confusion.
3. Adversary: window at 800×500; browser zoom 200 %; hold Enter on the menu; spam Esc in setup.

## References
- GDD §5 "3D interface philosophy", "Main menu", "Match setup screen", "Between-round scoreboard", §12 prompts 13, 14, 15
- `DESIGN-DECISIONS §3`, `ARCHITECTURE §8`, `docs/reference/README.md` note 1

## Exit criteria
- [ ] Fidelity verdict positive; a11y green; tag `sprint-10-done`.
