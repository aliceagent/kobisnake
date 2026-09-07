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
| `npm run format` | Prettier `--write .` — always safe; `.prettierignore` excludes `docs/**` and `*.md` |
| `npm run typecheck` | `tsc --noEmit -p jsconfig.json` |
| `npm run test:unit` | Vitest — runs `tests/unit/**` **and** `tests/sim/**` together; coverage always on |
| `npm run test:e2e` | Playwright — `tests/e2e/**`, including the offline/zero-network-request check |
| `npm run test:visual` | Playwright — `tests/visual/**` against `tests/visual/__baselines__/` |

There is no `test:sim` script: simulation tests live in `tests/sim/` but run under `npm run test:unit`.

**Several worktrees share one container, and the test tooling knows it (KI-19-00):**
- **A green summary with a red exit is the runner, not a test; re-run once.** `npm run test:unit` can print
  `718 passed` and still exit non-zero, with `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` — that is
  Vitest's own progress RPC starved by a busy box (#181), not a failing test. Re-run once; if it exits red a
  second time, or the summary is not green, it is real. Never reach for
  `dangerouslyIgnoreUnhandledErrors` to make it go away: a clean exit bought by muting unhandled errors hides
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
- Before pushing run: `npm run lint && npm run typecheck && npm run test:unit && npm run build`, and paste the
  output in the PR. Run `npm run test:e2e` if you touched anything a browser can see.
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
- `tests/perf` — frame-time, draw-call and bundle-size budgets. Does not exist yet; arrives in Sprint 16.

## When blocked
Post `BLOCKED: <what you need> <from whom>` on your issue and pick up another ticket of yours.
