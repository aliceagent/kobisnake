# Sprint 14 — Playtest Gate 2, Performance, Cross-browser & Accessibility

**Lead:** Fable · **Agents:** Fable ×1, Opus ×1, Sonnet ×2, Sonnet-QA ×2, **humans ×2+** · **Prerequisite:** `sprint-13-done`

## Goal
The complete Version 1 feature set passes the full playtest script with humans, meets every performance
budget in `ARCHITECTURE §12`, works in Chrome, Firefox, Safari and Edge, is fully keyboard-accessible, runs
offline, and has zero open blocker or major bugs.

## In scope
Perf profiling and fixes, low-end fallback, cross-browser fixes, accessibility fixes, offline verification,
Lighthouse, second human playtest gate, final tuning, bug bash.

## Out of scope
New features.

## Tickets

### KS-14-01 · Performance audit and budget enforcement
Owner: Opus · Size: L · Depends on: —
Files: `tests/perf/*.perf.spec.js`, `scripts/bundle-budget.mjs`, `.github/workflows/ci.yml`, fixes across `src/render/**`
Spec: Measure on the "maximum chaos" scene (GDD image 54 description): two 30-segment snakes, laser phase,
four apples, a power-up, a crash, particles. Record p50/p95 frame time, draw calls, triangles, JS heap, on the
reference laptop (integrated GPU, 1080p) and in CI (software GL; used only for regression deltas, not absolute
budgets). Fix until `ARCHITECTURE §12` budgets hold. Add `scripts/bundle-budget.mjs` to fail CI when gzip JS
> 350 kB. Implement `?lowfx=1` automatic fallback: if p95 > 20 ms for 3 s, reduce shadow map to 1024, disable
particles, cap pixel ratio to 1, and show a one-time toast "Reduced effects for smoothness".
Acceptance criteria:
- [ ] AC1 p95 ≤ 16.6 ms on the reference laptop in maximum chaos; numbers in the QA report.
- [ ] AC2 Bundle budget check in CI; current size recorded.
- [ ] AC3 Auto low-fx triggers under a throttled CPU (Playwright CPU throttling ×6) and the toast appears once.
QA: perf specs + e2e.

### KS-14-02 · Cross-browser and input-device matrix
Owner: Sonnet-QA · Size: M · Depends on: —
Files: `playwright.config.js`, `tests/e2e/**` (browser-specific fixes), `docs/qa/browser-matrix.md`
Spec: Run the full e2e suite on Chromium, Firefox and WebKit in CI for this sprint (then keep nightly).
Manually verify on Safari macOS, Edge Windows, Chrome Windows/macOS/Linux: WebGL2 works, keyboard events for
arrows/WASD (including simultaneous keys from two players — verify n-key rollover on at least two physical
keyboards and document ghosting caveats), fullscreen (F11), audio unlock, localStorage.
Acceptance criteria:
- [ ] AC1 All three engines green in CI.
- [ ] AC2 Matrix document filled in with pass/fail per browser and any caveat.
QA: —

### KS-14-03 · Accessibility and reduced-motion pass
Owner: Sonnet · Size: M · Depends on: —
Files: `src/ui/**`, `tests/e2e/a11y.spec.js`
Spec: axe on all screens including HUD states; `prefers-reduced-motion` disables screen shake, zoom pulse,
banner pulse and countdown pops; HUD timer has `aria-live="off"` (too chatty) but round/match results use
`aria-live="polite"`; all buttons are real `<button>`s; the canvas has `aria-hidden`; a visible "keyboard
controls" hint on the main menu; colour is never the only signal (player pills include "P1"/"P2" text; power-up
tags include text).
Acceptance criteria:
- [ ] AC1 Zero critical/serious axe violations; Lighthouse Accessibility ≥ 90.
- [ ] AC2 Reduced-motion visual baselines are stable across three runs.
QA: e2e + Lighthouse CI step.

### KS-14-04 · Offline and security verification
Owner: Sonnet · Size: S · Depends on: —
Files: `tests/e2e/offline.spec.js`, `vercel.json`, `public/manifest.webmanifest`
Spec: Load production, go offline (Playwright `context.setOffline(true)`), play a full match, open the shop,
buy, reload from cache (Vercel cache headers) — all work. Confirm CSP has no `unsafe-inline` for scripts (Vite
build output must not require it), and that the console shows zero CSP reports. Add a minimal web manifest and
favicon set so the game can be "installed"; no service worker in V1 (cache headers are enough for the offline
requirement after first load; a service worker is a post-1.0 nicety).
Acceptance criteria:
- [ ] AC1 Offline full-match e2e green against the production build.
- [ ] AC2 `curl -I` shows CSP without `unsafe-inline` for `script-src`.
QA: e2e.

### KS-14-05 · Playtest Gate 2 sessions
Owner: Fable + humans · Size: L · Depends on: KS-14-01
Files: `docs/qa/playtests/2026-xx-xx-gate2-session-N.md`
Spec: Two sessions covering the **entire** `PLAYTEST-SCRIPT.md` (sections 2–10) on the production preview,
including one first-time player for the tutorial. Bot statistics rerun with the final settings.
Acceptance criteria:
- [ ] AC1 Both scripts committed; every FAIL has an issue.
- [ ] AC2 Bot matrix rerun and committed.
QA: —

### KS-14-06 · Final tuning and bug bash
Owner: Opus + Sonnet ×2 · Size: L · Depends on: KS-14-05
Files: as needed; `docs/design/DESIGN-DECISIONS.md`; `src/core/settings.js`; `tests/sim/replays/*`
Spec: Fix all blocker and major bugs; apply Fable's tuning memo; regenerate goldens; add replays.
Acceptance criteria:
- [ ] AC1 Zero open blocker/major issues; docs and settings in sync (settingsDoc test).
QA: —

### KS-14-07 · Console and error hygiene
Owner: Sonnet-QA · Size: S · Depends on: —
Files: `tests/e2e/console.spec.js`, `src/main.js`
Spec: Every e2e run fails on any console error or warning (allow-list is empty). Add a global error handler
that shows a friendly "Something broke — press F5" panel with the error text (no external reporting).
Acceptance criteria:
- [ ] AC1 Full match, tutorial, shop and settings produce zero console output above `info`.
QA: —

## QA plan (sprint pass)
This sprint is the second gate. It passes when: all playtest sections pass, budgets hold, three browser
engines green, axe/Lighthouse thresholds met, offline e2e green, zero blocker/major bugs.

## References
- `ARCHITECTURE §12`, `QA-STRATEGY §1, §8`, `PLAYTEST-SCRIPT.md` (all), GDD §9

## Exit criteria
- [ ] Fable posts "Version 1 is ready to release" with the evidence table (budgets, browsers, playtest summary).
- [ ] Tag `sprint-14-done` and `gate2-passed`.
