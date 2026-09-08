# CLAUDE.md — rules for agents building KOBI Snake

You are one of several agents building this game. Roles: **Fable** designs and signs off, **Opus** leads
engineering and reviews every PR, **Sonnet** implements tickets and writes tests. Full detail:
`docs/process/AGENT-ROLES-AND-WORKFLOW.md`.

## Before you start a ticket
1. Read `docs/sprints/README.md`, then the sprint file for your ticket, then the ticket block itself.
2. Read `docs/design/DESIGN-DECISIONS.md` (numbers and rules) and `docs/design/ARCHITECTURE.md` (where code goes).
3. Open every reference image your ticket names (`docs/reference/images/`). Read `docs/reference/README.md`
   for what each image locks and the known discrepancies.
4. Only when intent is unclear, read the GDD: `docs/design/GDD-KOBI-Snake-Design-and-Reference-Pack.txt`.

## Setup and scripts
Node 20 (`.nvmrc`). Run `npm install` once per worktree — `node_modules` is not shared between worktrees.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server, http://localhost:5173 |
| `npm run build` | Vite build → `dist/` |
| `npm run preview` | Serves the built `dist/` |
| `npm run lint` | ESLint (flat config) |
| `npm run format` | Prettier `--write .` — **scope it to your own files** until #194 lands: `main` has 27 files Prettier would rewrite, so a bare `--write .` sweeps them into your diff. Use `npx prettier --write <your files>`. `.prettierignore` excludes `docs/**` and `*.md` |
| `npm run typecheck` | `tsc --noEmit -p jsconfig.json` |
| `npm run test:unit` | Vitest — every test (`tests/unit/**`, `tests/sim/**`, `tests/agent/**/*.test.js`, `tests/perf/**/*.test.js`), **coverage off** |
| `npm run test:coverage` | Vitest — the per-file coverage thresholds over `tests/unit` + `tests/agent`; sets `COVERAGE_STRICT` itself |
| `npm run test:e2e` | Playwright — `tests/e2e/**`, including the offline/zero-network-request check |
| `npm run test:visual` | Playwright — `tests/visual/**` against `tests/visual/__baselines__/` |
| `npm run test:perf` | The per-PR performance budgets (KI-08-04): bundle size, then draw calls |
| `npm run test:perf:frametime` | The nightly one — frame cost over a played round, and the 500-round leak check |

There is no `test:sim` script: simulation tests live in `tests/sim/` but run under `npm run test:unit`.

**Several worktrees share one container, and the test tooling knows it (KI-19-00):**
- **A green summary with a red exit is the runner, not a test — read the error, do not count re-runs.**
  A run can print `1121 passed` and still exit non-zero with
  `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`. That is Vitest's own worker-to-main RPC missing
  birpc's unconfigurable 60-second window, not a failing test, **however many times it reproduces**.
  KI-19-00 first wrote this rule as "re-run once; if it is red a second time it is real", and that was
  wrong: once the suite grew past that window the same failure reproduced on every run and on CI, and it was
  still not a test. The reliable tell is the error text, not the repeat count — if every test passed and the
  only errors name `onTaskUpdate`, no test failed.
  KI-19-06 removed the cause by taking coverage off `npm run test:unit` (`vitest.config.js` has the
  measurements), so this should now be rare; if you meet it, say so on an issue rather than living with it.
  Never reach for `dangerouslyIgnoreUnhandledErrors`: a clean exit bought by muting unhandled errors hides
  the real ones too.
- **The preview port is derived from your checkout's path**, not fixed at 4173 (#170), so a `vite preview`
  from another worktree can never be reused and an orphan can never block your `--strictPort`. `npm run
  preview` and `npm run test:e2e` in the same worktree agree on it. `scripts/preview-port.mjs` prints it:
  `node -e "import('./scripts/preview-port.mjs').then(m => console.log(m.previewBaseUrl()))"`.
- **Never run two Playwright suites at once.** Every suite goes through `scripts/run-playwright-suite.mjs`,
  which holds one container-wide lock: a second suite waits for the first, and after 20 minutes gives up and
  says which process it waited for rather than starting beside it (#86). Per-checkout ports do not change
  this — the contention #86 is about is one GPU-less browser stack, which every worktree shares.
- **`tests/e2e/inputLatency.spec.js` gates on simulated ticks, not milliseconds** (#175, #151). Its
  `KS-07-06 WALL CLOCK` lines are information; only `stepWaitTicks` can fail the job.
- **What you can and cannot read about a CI failure from an agent session.** Retested 2026-09-08, because
  reports disagree and the difference matters:
  - **Check-run annotations: readable.** `GET /repos/:o/:r/check-runs/:id/annotations`. Playwright's
    `github` reporter (KI-03-05) writes the failing test, file, line and message into them, so a red
    `browser` job can usually be attributed without leaving the terminal. This is the first thing to try.
  - **Job logs: not readable.** `GET /actions/jobs/:id/logs` answers **302** to
    `productionresultssaN.blob.core.windows.net`, and this container's egress proxy refuses that CONNECT.
    The 302 looks like success if you do not follow it, which is probably why it gets reported as working.
  - **Re-running a job: refused.** Both `POST /actions/jobs/:id/rerun` and
    `POST /actions/runs/:id/rerun-failed-jobs` return **403 "Resource not accessible by integration"**.
    To re-run, push a commit.
  - A session with a different egress policy — the design lead's, for one — *can* read job logs, so "read
    the log" in a review comment may be advice from somewhere this does not apply. Ask for the quote rather
    than assuming the endpoint changed.
- **Which suite failed is in the step list, not just the annotations.** `ci.yml`'s two suite steps carry
  `continue-on-error: true`, so both report `conclusion: success` whatever happened and the jobs API exposes
  only that. KI-19-01 added a named gate step per suite: `e2e failed` and `visual failed` are `skipped` when
  their suite passed and `failure` when it did not, so `GET /actions/runs/:id/jobs` names the suite on its
  own. Prefer the annotations for *which test*; use the steps when a suite died before Playwright could
  report (a `webServer` that never came up emits no annotations at all).

## The never list
- Never load anything from a CDN or external URL. three.js comes from npm and is bundled. The built site makes
  zero network requests after load; a test enforces this.
- Never change a value in `src/core/settings.js` or a rule in `DESIGN-DECISIONS.md`. Propose it in your PR with
  the `tuning-proposal` label; Fable decides.
- Never add a dependency without Opus's approval in the PR.
- Never touch files outside your ticket's `Files:` list without saying so in the PR description.
- Never skip, delete, weaken or quarantine a test to get CI green. If a test is flaky, say so and file it.
- Never put DOM or three.js code in `src/core/`. It is pure simulation and must run in Node.
- Never write a hex colour outside `src/render/materials.js` (3D) or the UI stylesheet `src/ui/styles.css` (DOM).
- Never invent a mechanic, screen, option or rule that is not in the ticket. File an issue instead.
- Never put model names in commits, code or comments (this governs what you author — commit subject/body, code,
  comments, PR text — not the harness's automatic `Co-Authored-By:` trailer, which is attribution metadata you
  cannot suppress, not authored content).

## Conventions
- Plain JavaScript ES modules. `// @ts-check` at the top of every file in `src/core/` and `src/game/`, with
  JSDoc types. Small files, one class per file, descriptive names, comments explain *why*.
- Branch `s{NN}/{ticket-id}-{slug}`; PR title `KS-NN-TT: description`; one ticket per PR; squash merge.
- Every acceptance criterion in your ticket gets a test named after it (`KS-04-02 AC3: …`) unless the ticket
  says "manual".
- Before pushing run: `npm run lint && npm run typecheck && npm run test:unit && npm run test:coverage && npm run build`,
  and paste the output in the PR. Both test commands are gates and CI's `unit` job runs both: `test:unit` is
  every test with coverage off, `test:coverage` is the per-file thresholds. `test:coverage` sets
  `COVERAGE_STRICT` itself, so the old trap — thresholds silently 0 locally because only CI set the flag —
  is gone.
- Visual work: include a preview screenshot next to the reference-image crop in the PR. Label the PR
  `needs-design-review`.
- Determinism: all randomness goes through `src/core/rng.js` with a seed. E2e tests fast-forward time through
  `window.__kobi`; they never sleep.

## Test layers (all wired in CI from Sprint 01)
- `tests/unit` — Vitest, ≥ 90 % coverage on `src/core`. Run with `npm run test:unit`.
- `tests/sim` — headless whole-round/match simulations, bots, replays; Vitest too, same `npm run test:unit`
  command. Currently holds only a README — Sprint 02 fills it in.
- `tests/e2e` — Playwright, `npm run test:e2e`. Includes the offline/zero-network-request check.
- `tests/visual` — Playwright screenshots vs `tests/visual/__baselines__/`, seed 1, `?reducedFx=1`. Run with
  `npm run test:visual`.
- `tests/perf` — the `ARCHITECTURE §12` budgets (Improvement 08, not Sprint 16 as this line used to say).
  **`npm run test:perf` is the per-PR gate**: the gzipped bundle total (`bundle.test.js`, Vitest, and it also
  rides along in `npm run test:unit`) and the draw-call budget over five staged scenes (`drawCalls.spec.js`,
  Playwright). **`npm run test:perf:frametime` is the nightly one** — a played round sampled frame by frame
  plus a leak check over 500 rounds of churn; it is nightly because the churn run is the expensive half.
  CI runs the first as `ci.yml`'s `perf` job and the second as `nightly.yml`'s.
  Two rules worth knowing before you touch any of it: **the budgets are `ARCHITECTURE §12`'s and are not
  yours to raise** — a gate that fires is either a regression to fix or a `tuning-proposal` for the design
  lead — and **no gate here keys on wall-clock milliseconds**. `docs/qa/playtests/perf-baseline.md` records
  today's figures and says which are gated, which are only recorded, and why.

## When blocked
Post `BLOCKED: <what you need> <from whom>` on your issue and pick up another ticket of yours.
