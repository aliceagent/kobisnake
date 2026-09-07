# Improvement 17 — Mutation testing on the core

**Lead:** Opus · **Agents:** Opus ×1, Sonnet-QA ×2 · **Prerequisite:** none · **Dependency approval required:** Opus, for the mutation tool
**Origin:** this project has shipped at least six tests that were green while measuring nothing (#111, #112, #115, #116, #142's `vitest.config.js` finding, #154)

## Goal
Find every test in `src/core` that cannot fail. Coverage is 100 % and has been since Sprint 02, and it has
not stopped green-but-empty tests from reaching `main` — a line executed is not a line checked. Mutation
testing does systematically what reviewers here do by hand: change the code (flip a comparison, drop a
branch, alter a constant) and see whether any test notices. A mutant that survives is a test that is not
testing.

`src/core` is pure, deterministic and fast, which makes it the ideal target and keeps the run affordable.

## In scope
A mutation tool wired to `src/core` with a score gate, the surviving mutants triaged and killed by
strengthening tests, and the gate in CI on a schedule.

## Out of scope
`src/game` and `src/render` in the gate (measured once for information); rewriting tests for their own sake.

## Tickets

### KI-17-01 · The tool, and the first honest number
Owner: Opus · Size: M · Depends on: —
Files: `package.json`, `stryker.config.mjs` (or the chosen tool's config), `docs/qa/QA-STRATEGY.md`
Spec: Add a mutation-testing tool as a dev dependency (Opus approves; pin the version; it must never appear
in the bundle or make a network request during a test run). Configure it for `src/core/**` against
`tests/unit/core/**` and `tests/sim/**`, run it once, and commit the report summary: mutation score, and every
surviving mutant with file and line. No test is changed in this ticket — the point is the honest baseline.
Acceptance criteria:
- [ ] AC1 A committed baseline mutation score for `src/core` with the surviving mutants listed.
- [ ] AC2 The tool runs under `npm run test:mutation` in under 20 minutes on CI.
- [ ] AC3 The offline e2e check and the bundle size are unchanged.
QA: the run.

### KI-17-02 · Kill the survivors
Owner: Sonnet-QA · Size: L · Depends on: KI-17-01
Files: `tests/unit/core/**`, `tests/sim/**`
Spec: For each surviving mutant, either write the assertion that kills it or record in a committed triage
file why it is equivalent (a mutant that cannot change behaviour). No test is weakened; no mutant is
"ignored" without a sentence. Expect this to find real gaps — the whole sprint exists because it will.
Acceptance criteria:
- [ ] AC1 Mutation score for `src/core` at or above the threshold the design lead sets from the baseline (target: 95 %).
- [ ] AC2 Every remaining survivor is in the triage file with a reason.
- [ ] AC3 Every new assertion is shown to kill its mutant in the PR.
QA: mutation + unit.

### KI-17-03 · The gate
Owner: Opus · Size: S · Depends on: KI-17-02
Files: `.github/workflows/*.yml`, `docs/qa/QA-STRATEGY.md`
Spec: Nightly, with the score compared to the committed threshold; a drop fails the job and names the new
survivors. On PRs touching `src/core`, run incrementally if the tool supports it.
Acceptance criteria:
- [ ] AC1 A nightly run exists and a deliberately weakened test fails it.
- [ ] AC2 `QA-STRATEGY` documents the layer and the threshold.
QA: the workflow.

### KI-17-04 · `src/game` measured once
Owner: Sonnet-QA · Size: S · Depends on: KI-17-01
Files: `docs/qa/playtests/mutation-game.md`
Spec: One run over `src/game` for information: the score and the ten worst survivors, with a recommendation
of whether to gate it later.
Acceptance criteria:
- [ ] AC1 A committed report with the number and the survivors.
QA: the run.

## QA plan
The tool is the QA. The proof it works is that a known green-but-empty test from the project's history
(re-created on a branch) produces a surviving mutant.

## References
- `CLAUDE.md` "never skip, weaken or quarantine a test"; `QA-STRATEGY §1`; the PRs listed in Origin

## Risks
- **Run time.** `src/core` is small; the sim suites are slow. Configure the mutant set and the test filter so the run fits 20 minutes, or scope the sim suites out of the mutation run and say so.
- **Killing mutants with bad tests.** An assertion that pins an implementation detail kills a mutant and worsens the suite. Review for behaviour, not for the mutant.

## Exit criteria
- [ ] A mutation score for `src/core`, gated nightly.
- [ ] Every surviving mutant killed or explained.
