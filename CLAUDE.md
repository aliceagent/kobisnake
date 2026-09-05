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

## The never list
- Never load anything from a CDN or external URL. three.js comes from npm and is bundled. The built site makes
  zero network requests after load; a test enforces this.
- Never change a value in `src/core/settings.js` or a rule in `DESIGN-DECISIONS.md`. Propose it in your PR with
  the `tuning-proposal` label; Fable decides.
- Never add a dependency without Opus's approval in the PR.
- Never touch files outside your ticket's `Files:` list without saying so in the PR description.
- Never skip, delete, weaken or quarantine a test to get CI green. If a test is flaky, say so and file it.
- Never put DOM or three.js code in `src/core/`. It is pure simulation and must run in Node.
- Never write a hex colour outside `src/render/materials.js` / `src/ui/tokens.css`.
- Never invent a mechanic, screen, option or rule that is not in the ticket. File an issue instead.
- Never put model names in commits, code or comments.

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
`tests/unit` (Vitest, ≥ 90 % on `src/core`), `tests/sim` (headless rounds, bots, replays), `tests/e2e`
(Playwright), `tests/visual` (screenshot baselines, seed 1, `?reducedFx=1`), `tests/perf`, offline check.

## When blocked
Post `BLOCKED: <what you need> <from whom>` on your issue and pick up another ticket of yours.
