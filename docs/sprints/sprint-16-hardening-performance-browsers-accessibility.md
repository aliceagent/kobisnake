# Sprint 16 — Hardening: Performance, Cross-browser, Accessibility, Offline

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×2 · **Prerequisite:** `sprint-15-done`

## Goal
The complete Version 1 feature set meets every performance budget in `ARCHITECTURE §12`, works in Chrome,
Firefox, Safari and Edge, is fully keyboard-accessible, runs offline, and produces zero console noise. This is
engineering hardening; the human verdict comes in Sprint 17.

## In scope
Perf profiling and fixes, low-end fallback, cross-browser fixes, accessibility and reduced-motion, offline and
CSP verification, console hygiene, Lighthouse.

## Out of scope
New features; tuning (S17).

## Tickets

### KS-16-01 · Performance audit and budget enforcement
Owner: Opus · Size: L · Depends on: —
Files: `tests/perf/*.perf.spec.js`, `scripts/bundle-budget.mjs`, `.github/workflows/ci.yml`, fixes across `src/render/**`
Spec: Measure on the "maximum chaos" scene: two 30-segment snakes, laser phase, four apples, a power-up, a crash,
particles. Record p50/p95 frame time, draw calls, triangles, JS heap on the reference laptop (integrated GPU,
1080p) and in CI (software GL; regression deltas only). Fix until `ARCHITECTURE §12` budgets hold. Add
`scripts/bundle-budget.mjs` to fail CI when gzip JS > 350 kB. Implement automatic low-fx fallback: if p95 > 20 ms
for 3 s, reduce shadow map to 1024, disable particles, cap pixel ratio to 1, show a one-time toast "Reduced
effects for smoothness". `?lowfx=1` forces it.
Acceptance criteria:
- [ ] AC1 p95 ≤ 16.6 ms on the reference laptop in maximum chaos; numbers in the QA report.
- [ ] AC2 Bundle budget check in CI; current size recorded.
- [ ] AC3 Auto low-fx triggers under Playwright CPU throttling ×6 and the toast appears once.
QA: perf specs + e2e.

### KS-16-02 · Cross-browser and input-device matrix
Owner: Sonnet-QA · Size: M · Depends on: —
Files: `playwright.config.js`, `tests/e2e/**`, `docs/qa/browser-matrix.md`
Spec: Full e2e suite on Chromium, Firefox and WebKit in CI for this sprint (then nightly). Manual verification on
Safari macOS, Edge Windows, Chrome Windows/macOS/Linux: WebGL2, keyboard events for arrows/WASD including
simultaneous keys from two players (verify n-key rollover on at least two physical keyboards; document ghosting
caveats), fullscreen, audio unlock, localStorage.
Acceptance criteria:
- [ ] AC1 All three engines green in CI.
- [ ] AC2 Matrix document filled in with pass/fail per browser and caveats.
QA: —

### KS-16-03 · Accessibility and reduced-motion pass
Owner: Sonnet · Size: M · Depends on: —
Files: `src/ui/**`, `tests/e2e/a11y.spec.js`
Spec: axe on all screens including HUD states; `prefers-reduced-motion` disables screen shake, zoom pulse, banner
pulse and countdown pops; round/match results use `aria-live="polite"`, the timer `aria-live="off"`; all buttons
are real `<button>`s; canvas `aria-hidden`; visible keyboard-controls hint on the main menu; colour is never the
only signal.
Acceptance criteria:
- [ ] AC1 Zero critical/serious axe violations; Lighthouse Accessibility ≥ 90.
- [ ] AC2 Reduced-motion visual baselines stable across three runs.
QA: e2e + Lighthouse CI step.

### KS-16-04 · Offline and security verification
Owner: Sonnet · Size: S · Depends on: —
Files: `tests/e2e/offline.spec.js`, `vercel.json`, `public/manifest.webmanifest`
Spec: Load production, go offline (Playwright `setOffline`), play a full match, open the shop, buy, reload from
cache — all work. CSP has no `unsafe-inline` for `script-src`; zero CSP reports in the console. Minimal web
manifest and favicon set. No service worker in V1.
Acceptance criteria:
- [ ] AC1 Offline full-match e2e green against the production build.
- [ ] AC2 `curl -I` shows CSP without `unsafe-inline` for `script-src`.
QA: e2e.

### KS-16-05 · Console and error hygiene
Owner: Sonnet-QA · Size: S · Depends on: —
Files: `tests/e2e/console.spec.js`, `src/main.js`
Spec: Every e2e run fails on any console error or warning (empty allow-list). Global error handler shows a friendly
"Something broke — press F5" panel with the error text (no external reporting).
Acceptance criteria:
- [ ] AC1 Full match, tutorial, shop and settings produce zero console output above `info`.
QA: —

### KS-16-06 · Hardening bug fixes
Owner: Opus + Sonnet · Size: M · Depends on: KS-16-01..05
Files: as needed
Spec: Fix everything the tickets above surface. No feature work.
Acceptance criteria:
- [ ] AC1 Zero open `blocker`/`major` issues labelled `sprint:16`.
QA: —

## QA plan (sprint pass)
Budgets table, browser matrix, axe/Lighthouse scores, offline result and console check all posted in the QA report.

## References
- `ARCHITECTURE §12`, `QA-STRATEGY §1, §8`

## Exit criteria
- [ ] All five measurements meet their thresholds; tag `sprint-16-done`.
