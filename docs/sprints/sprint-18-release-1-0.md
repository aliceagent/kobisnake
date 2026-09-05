# Sprint 18 — Release 1.0

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Fable · **Prerequisite:** `gate2-passed`

## Goal
Version 1.0 is live on the production Vercel URL, tagged, documented for players and for the 11-year-old
developer, with a release checklist that any future release repeats.

## In scope
Release checklist, version stamping, changelog, player-facing README section, the developer guide, in-game
credits/version display, final production verification, post-release monitoring plan (without analytics).

## Out of scope
New features; single player (S19).

## Tickets

### KS-18-01 · Release checklist and version stamp
Owner: Opus · Size: S · Depends on: —
Files: `docs/process/RELEASE-CHECKLIST.md`, `package.json` (version 1.0.0), `src/ui/screens/settings.js` (version line), `vite.config.js` (define `__APP_VERSION__`)
Spec: Checklist: CI green on `main`; all `sprint-17-done` criteria; preview smoke by a human; tag `v1.0.0`;
production deploy verified; `curl` headers; offline check; rollback procedure (Vercel "promote previous
deployment"). Settings screen shows "KOBI Snake v1.0.0" bottom-left.
Acceptance criteria:
- [ ] AC1 Checklist executed and each line initialled in the release issue.
- [ ] AC2 Version visible in-game matches the tag.
QA: manual.

### KS-18-02 · Developer guide for the 11-year-old
Owner: Sonnet · Size: M · Depends on: —
Files: `docs/DEVELOPER-GUIDE.md`, `README.md`
Spec: A friendly guide (≤ 300 lines, short sentences, screenshots as needed via `docs/guide-images/`):
how to install Node and run the game; a map of the folders in plain language; "Try this" exercises: change the
snake speed, change a colour hex, change the round length, add a fourth music track by copying track1, add a
new SFX, change the apple count; how to run the tests and what a failing test looks like; how to make a
branch and open a PR; where the design docs are. Every exercise names the exact file and line pattern.
Acceptance criteria:
- [ ] AC1 The "can I change this?" test from `AGENT-ROLES §7`: a young developer completes the first three exercises with no help (recorded in the release issue). If not possible to run, Fable performs the exercises literally as written and confirms each step is accurate.
QA: manual.

### KS-18-03 · Changelog, credits, licence
Owner: Sonnet · Size: S · Depends on: —
Files: `CHANGELOG.md`, `LICENSE`, `src/ui/screens/credits.js` (reachable from Settings)
Spec: `CHANGELOG.md` summarises sprints 00–14 as a 1.0.0 entry in player language. Credits screen: game
design, build team (roles, not model names), "built with three.js". Licence chosen by the owner (default MIT
for code; note that the concept images are reference material and not licensed for redistribution unless the
owner says otherwise).
Acceptance criteria:
- [ ] AC1 Files present; credits reachable by keyboard.
QA: e2e smoke.

### KS-18-04 · Production verification and monitoring plan
Owner: Opus · Size: S · Depends on: KS-18-01
Files: `docs/process/RELEASE-CHECKLIST.md` (post-release section)
Spec: After the deploy: run the e2e suite against the production URL (`BASE_URL` env); manual smoke on two
machines; document how to check Vercel deployment logs and how to roll back; since there are no analytics, the
monitoring plan is "GitHub issues from players + the weekly nightly CI run against production".
Acceptance criteria:
- [ ] AC1 Production e2e run recorded green in the release issue.
QA: —

## QA plan (sprint pass)
1. Release checklist executed; production e2e green; rollback rehearsed once on a preview.
2. Fable plays one full Bo5 on production and signs.

## References
- `AGENT-ROLES §7`, `ARCHITECTURE §2`, GDD §2 "Player age / development constraint"

## Exit criteria
- [ ] `v1.0.0` tag on `main`; production URL in `README.md`; developer guide verified.
- [ ] Tag `sprint-18-done`. Version 1 complete.
