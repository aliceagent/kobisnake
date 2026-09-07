# Improvement 19 — Supply chain and release engineering

**Lead:** Opus · **Agents:** Opus ×1, Sonnet ×1 · **Prerequisite:** none
**Origin:** Sprint 18 releases 1.0; nothing before it checks what is being released

## Goal
Know exactly what ships. The build is one dependency (three.js) and a dev toolchain, pinned and offline —
a good position that nothing currently defends. There is no lockfile integrity check in CI, no audit gate,
no automated dependency updates, no version stamp in the build, no changelog discipline, and the preview
deployment every PR gets is never exercised by anything. Sprint 18 will need all of this on release day;
building it there is building it in a hurry.

## In scope
Lockfile and provenance checks, audit as a gate, automated update PRs, a build stamp visible in-game, a
changelog kept by the PRs that change behaviour, and a smoke of every preview deployment.

## Out of scope
Signing, SBOM publication beyond a generated file, anything that requires a paid service.

## Tickets

### KI-19-00 · Test infrastructure under contention (#170, #175, #151, #181)
Owner: Opus · Size: M · Depends on: — · **First, before any other ticket**
Files: `playwright.config.js`, `vitest.config.js`, `tests/e2e/inputLatency.spec.js`, `CLAUDE.md`, `scripts/run-playwright-suite.mjs`
Spec: The design-lead ruling on #170: (1) derive the preview port from the checkout path (hash the repository
root into a private-range port) and make `baseURL` follow, so a `vite preview` from another worktree is never
reused and an orphan never blocks the next run; CI unaffected. (2) #175/#151: KS-07-06 AC1 gates on
`stepWaitTicks` only; the wall-clock half is printed as information and never fails the job — the module
comment says why, citing KS-07-06's own three-machine table. (3) #181: cap Vitest worker parallelism locally
to half the cores, leave CI alone, and add to `CLAUDE.md`'s setup section: "a green summary with a red exit
is the runner, not a test; re-run once." Never make the suite ignore unhandled errors.
Acceptance criteria:
- [ ] AC1 Two worktrees in one container run `test:e2e` one after the other against their own builds; asserted by a test that starts a server from one checkout and shows the other refuses to reuse it.
- [ ] AC2 `inputLatency.spec.js` cannot fail on wall-clock milliseconds; the tick assertion is unchanged.
- [ ] AC3 Local Vitest worker count is capped; CI's is not; both stated in `vitest.config.js`.
- [ ] AC4 The four issues are closed by this PR with a sentence each.
QA: e2e (run twice, from two worktrees), unit.

### KI-19-01 · Integrity gates
Owner: Opus · Size: M · Depends on: —
Files: `.github/workflows/ci.yml`, `package.json`, `.npmrc`
Spec: CI installs with `npm ci` only (it already does — assert it), fails if `package-lock.json` is out of
date with `package.json`, fails on a high-severity audit finding, and generates an SBOM as a build artifact.
Acceptance criteria:
- [ ] AC1 A PR that edits `package.json` without the lockfile goes red.
- [ ] AC2 An audit finding at the chosen severity goes red; the level is documented with why.
- [ ] AC3 An SBOM artifact is attached to every `main` build.
QA: the workflow.

### KI-19-02 · Automated updates
Owner: Sonnet · Size: S · Depends on: KI-19-01
Files: `.github/dependabot.yml` (or equivalent)
Spec: Weekly update PRs for dev dependencies, grouped; three.js updates separately and never auto-merged —
a renderer update needs the visual suite and the design lead. Every update PR runs the full suite.
Acceptance criteria:
- [ ] AC1 The config exists and the first PR it opens passes CI or is explained.
- [ ] AC2 three.js is excluded from grouping.
QA: the first PR.

### KI-19-03 · A build stamp
Owner: Sonnet · Size: S · Depends on: —
Files: `vite.config.js`, `src/main.js`, `src/ui/screens/mainMenu.js`, tests
Spec: The commit short-hash and build date are baked in at build time and shown small on the main menu, so
a bug report can say which build. Also exposed on `__kobi` for the harnesses.
Acceptance criteria:
- [ ] AC1 The stamp on the deployed page matches the commit that built it; asserted in e2e against the build's own env.
- [ ] AC2 No runtime network request to find it out.
QA: e2e.

### KI-19-04 · Changelog discipline
Owner: Opus · Size: S · Depends on: —
Files: `CHANGELOG.md`, `.github/pull_request_template.md`, `docs/process/AGENT-ROLES-AND-WORKFLOW.md`
Spec: A `CHANGELOG.md` in Keep-a-Changelog form, an "Unreleased" section, and a PR template line asking
whether the change is player-visible; a CI check that a PR labelled `player-visible` touched the changelog.
Backfill from Sprint 01 to now in one pass, from the sprint sign-off table.
Acceptance criteria:
- [ ] AC1 Backfilled changelog through the current `main`.
- [ ] AC2 A `player-visible` PR without a changelog line goes red.
QA: the workflow.

### KI-19-05 · Smoke every preview
Owner: Opus · Size: M · Depends on: I03
Files: `.github/workflows/preview-smoke.yml`, `tests/agent/smoke.js`
Spec: When Vercel reports a preview deployment ready, run one agent match against it and the zero-network
check. Report on the PR. **Mind the Hobby quota**: this job runs against a deployment that already exists; it
must never trigger one.
Acceptance criteria:
- [ ] AC1 A PR shows a smoke result from its own preview URL.
- [ ] AC2 The job creates no deployment.
QA: the workflow.

## QA plan
Each ticket's gate is demonstrated red on a deliberately bad PR and green on `main`.

## References
- Sprint 01 (the pipeline), Sprint 18 (release), `HANDOFF.md`'s Vercel quota note, `ARCHITECTURE §12`

## Risks
- **Gates that block the agents.** Every gate must fail with a message that says what to do.
- **Quota.** KI-19-05 consumes no deployments; verify by counting before and after.

## Exit criteria
- [ ] The lockfile, the audit and the SBOM are gated; updates arrive as PRs.
- [ ] Every build says which commit it is; every player-visible change is in the changelog.
- [ ] Every preview is played once before a human looks at it.
