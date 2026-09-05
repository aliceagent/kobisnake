# Sprint 00 — Bootstrap & Delivery Pipeline

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×2, Sonnet-QA ×1 · **Prerequisite:** none (empty repository)

## Goal
An empty repository becomes a project that lints, type-checks, unit-tests, e2e-tests, builds and deploys a
"hello arena" page to Vercel on every pull request, with the rules every later agent will follow.

## In scope
Vite + three.js scaffold, tooling, CI, Vercel wiring, branch protection, agent rules file, issue/PR templates,
test harness skeletons (unit, sim, e2e, visual, offline), a placeholder scene that proves WebGL renders.

## Out of scope
Any gameplay. No snake code is written in this sprint.

## Already done before the sprint (by the design lead, at project setup)
- The Vercel project `kobisnake` exists on the owner's team, linked to `aliceagent/kobisnake` through the GitHub
  integration, with `main` as the production branch and preview deployments per PR.
- `main` exists and is the repository's default branch.
- A placeholder `index.html` and a starter `vercel.json` (security headers, clean URLs) are committed so the
  first deployment is not a 404. KS-00-01 replaces `index.html` with the Vite entry page; KS-00-05 extends
  `vercel.json` (framework, cache headers, CSP) rather than creating it.

## Tickets

### KS-00-01 · Vite + three.js scaffold
Owner: Opus · Size: M · Depends on: —
Files: `package.json`, `package-lock.json`, `vite.config.js`, `index.html`, `src/main.js`, `src/render/renderer.js`, `public/favicon.svg`, `jsconfig.json`, `.gitignore`, `.nvmrc`
Spec: Create the project per `docs/design/ARCHITECTURE.md §2–3`. `index.html` has `<canvas id="game">` and
`<div id="ui">`. `src/main.js` creates a `WebGLRenderer`, a `PerspectiveCamera` at the locked pitch
(`DESIGN-DECISIONS §1 row 24`) and renders a flat 24×24 green plane with a single spinning red cube so WebGL is
proven. Three.js must be imported from the npm package (pinned exact version), never a CDN. Pixel ratio capped
at 2. Resize handled.
Acceptance criteria:
- [ ] AC1 `npm run dev` serves the page; `npm run build` produces `dist/` with no warnings.
- [ ] AC2 The built page renders the plane and cube with zero console errors.
- [ ] AC3 `dist/` contains no absolute external URLs (grep for `https://` returns only source-map comments or nothing).
- [ ] AC4 `jsconfig.json` enables `checkJs` for `src/core` and `src/game`.
QA: e2e smoke `tests/e2e/smoke.spec.js` loads the page, asserts canvas exists and no console errors.

### KS-00-02 · Lint, format, typecheck scripts
Owner: Sonnet · Size: S · Depends on: KS-00-01
Files: `eslint.config.js`, `.prettierrc`, `.prettierignore`, `package.json` (scripts), `.editorconfig`
Spec: ESLint flat config (`eslint:recommended`, `eslint-plugin-import`), Prettier (2 spaces, single quotes, 100
cols), `npm run lint`, `npm run format`, `npm run typecheck` (`tsc --noEmit -p jsconfig.json`). Add a
`// @ts-check` requirement documented in `CLAUDE.md`.
Acceptance criteria:
- [ ] AC1 All three scripts pass on the scaffold.
- [ ] AC2 Introducing an unused variable in `src/main.js` fails `npm run lint` (verified in the PR description).
QA: CI job exercises AC1.

### KS-00-03 · Test harnesses
Owner: Sonnet-QA · Size: M · Depends on: KS-00-01
Files: `vitest.config.js`, `playwright.config.js`, `tests/unit/example.test.js`, `tests/sim/README.md`, `tests/e2e/smoke.spec.js`, `tests/e2e/offline.spec.js`, `tests/visual/smoke.visual.spec.js`, `tests/visual/__baselines__/`, `package.json` (scripts)
Spec: Vitest with v8 coverage and thresholds from `docs/qa/QA-STRATEGY.md §1` (thresholds may start at 0 for
`src/core` since it is empty, but the config must already express the 90/75 targets behind a `COVERAGE_STRICT`
env flag that Sprint 01 turns on). Playwright configured for Chromium in CI with `webServer` running `vite
preview` on the built `dist/`, 1280×720, `?test=1&seed=1&reducedFx=1` default query. `offline.spec.js`
intercepts all requests after `load` and fails if any occur. Visual spec captures the scaffold scene and stores
a baseline.
Acceptance criteria:
- [ ] AC1 `npm run test:unit`, `npm run test:e2e`, `npm run test:visual` pass locally and in CI.
- [ ] AC2 Offline spec fails if a `<script src="https://…">` is added to `index.html` (demonstrated in PR).
- [ ] AC3 Visual spec fails when the cube colour is changed (demonstrated in PR), then baseline restored.
QA: this ticket is the QA harness.

### KS-00-04 · GitHub Actions CI
Owner: Sonnet · Size: S · Depends on: KS-00-02, KS-00-03
Files: `.github/workflows/ci.yml`, `.github/workflows/nightly.yml`
Spec: `ci.yml` on `pull_request` and `push` to `main`: install (`npm ci`, Node 20, cached), lint, typecheck,
unit (with coverage upload as artifact), build (upload `dist/` as artifact), e2e + visual (Playwright Chromium,
upload report on failure), offline. `nightly.yml` on schedule: Firefox + WebKit e2e and the perf specs (may be
empty stubs now). Concurrency group per PR cancels stale runs.
Acceptance criteria:
- [ ] AC1 A PR with a failing unit test shows a red check.
- [ ] AC2 Total CI time on the scaffold ≤ 6 minutes.
- [ ] AC3 Playwright report artifact is downloadable on failure.
QA: manual verification on a throwaway PR, documented in the PR.

### KS-00-05 · Vercel project and previews
Owner: Opus · Size: S · Depends on: KS-00-01
Files: `vercel.json`, `README.md` (deploy section)
Spec: Create the Vercel project linked to `aliceagent/kobisnake` via the GitHub integration (framework: Vite,
output `dist`). `vercel.json`: `cleanUrls`, immutable cache headers for `/assets/*`, `X-Content-Type-Options`,
and a `Content-Security-Policy` that allows only `'self'` for scripts, styles, images, connect, fonts and media
(this is what makes "no CDN" enforceable in production). Production = `main`. Every PR gets a preview URL comment.
Acceptance criteria:
- [ ] AC1 Opening a PR produces a Vercel preview comment within 5 minutes; the preview renders the scaffold.
- [ ] AC2 Merging to `main` updates the production URL.
- [ ] AC3 Response headers on production include the CSP; the page still renders with zero CSP violations in the console.
- [ ] AC4 The production URL and preview mechanism are documented in `README.md`.
QA: manual; screenshots in the PR.

### KS-00-06 · Branch protection and repository hygiene
Owner: Opus · Size: S · Depends on: KS-00-04
Files: `.github/CODEOWNERS`, `.github/ISSUE_TEMPLATE/ticket.md`, `.github/ISSUE_TEMPLATE/bug.md`, `.github/labels.json`, `scripts/sync-labels.mjs`
Spec: Protect `main` per `AGENT-ROLES-AND-WORKFLOW §4` (PR required, CI required, 1 approval, linear history,
squash only). CODEOWNERS routes `src/core/**`, `src/game/**`, `src/render/renderer.js`, `src/render/camera.js`
to the Opus reviewer account and `docs/design/**` to the Fable reviewer account. Issue templates mirror the
ticket contract and the bug format. `labels.json` + script create the label set from `AGENT-ROLES §4`.
Acceptance criteria:
- [ ] AC1 Direct push to `main` is rejected.
- [ ] AC2 Labels exist on the repository.
- [ ] AC3 Creating an issue from the "ticket" template yields the ticket-contract skeleton.
QA: manual.

### KS-00-07 · Agent rules and developer README
Owner: Sonnet · Size: S · Depends on: KS-00-02
Files: `CLAUDE.md`, `README.md`
Spec: `CLAUDE.md` is the short operating manual for builder agents: read the sprint file and ticket, run the
fast checks, the "never" list (no CDN, no tunable changes, no new deps, no skipping tests, no files outside the
ticket), file layout pointer, `@ts-check` rule, how to run each test layer. `README.md`: what the game is, how to
run it, how to test it, where the docs are, the production URL. Keep both under 150 lines each.
Acceptance criteria:
- [ ] AC1 A fresh agent given only `CLAUDE.md` can run all scripts without asking a question (Opus verifies by dry run).
QA: review.

### KS-00-08 · Sprint tracking issues
Owner: Fable · Size: S · Depends on: KS-00-06
Files: none (GitHub issues)
Spec: Create the tracking issue for Sprint 00 and Sprint 01 with the ticket list; create the issues for every
Sprint 01 ticket from its ticket blocks. Post the Sprint 00 kick-off comment retroactively so the record is
complete.
Acceptance criteria:
- [ ] AC1 Sprint 01 tickets exist as issues with correct labels and owners.

## QA plan (sprint pass)
1. Clone fresh, `npm ci`, run every script from `README.md`; all pass.
2. Open a PR that changes the cube colour: CI red on visual, Vercel preview shows the new colour. Close it.
3. Check production headers with `curl -I`; CSP present.
4. Console clean on production in Chrome, Firefox, Safari.

## References
- `docs/design/ARCHITECTURE.md` §2, §3, §11, §12
- `docs/process/AGENT-ROLES-AND-WORKFLOW.md` §4
- `docs/qa/QA-STRATEGY.md` §1

## Risks
- Vercel GitHub integration needs an owner account action; Opus prepares everything and posts `BLOCKED:` on the
  tracking issue if a human must click "connect".
- CSP may block Vite's inline module preload script; use `vite build` defaults and test before tightening.

## Exit criteria (Fable signs off)
- [ ] CI green on `main`; production URL renders the scaffold; preview per PR works.
- [ ] All test layers exist and are wired in CI even where they only contain smoke tests.
- [ ] `CLAUDE.md` dry run passed.
- [ ] Tag `sprint-00-done`.
