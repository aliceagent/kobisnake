# Agent Roles and Workflow

KOBI Snake is built by a team of AI agents working in parallel on GitHub, with humans (the game's owner and the
11-year-old developer) reviewing and playtesting. This document is the operating manual. `CLAUDE.md` at the
repository root is the short version every agent reads on start-up.

## 1. Roster

| Role | Model | Count | Owns |
|---|---|---|---|
| **Design Lead / Architect** | **Fable** (`claude-fable-5-1`) | 1 | Design decisions, architecture, acceptance criteria, sprint sign-off, design-fidelity review, playtest gates, tuning decisions. **Does not write feature code.** May write docs, acceptance tests as specifications, and small tuning constants. |
| **Tech Lead / Senior Engineer** | **Opus** (`claude-opus-5`) | 1–2 | Architecture-critical code (simulation core, state machine, renderer foundation, interpolation, laser system, shop 3D interaction, performance). Code-reviews every Sonnet PR. Resolves integration conflicts. Adversarial review of critical systems. |
| **Feature Engineer** | **Sonnet** (`claude-sonnet-5`) | 2–4 in parallel | Well-specified feature tickets, view code, UI screens, audio, tooling, docs, bug fixes. |
| **QA Engineer** | **Sonnet** (`claude-sonnet-5`) | 1–2 in parallel | Writes tests from acceptance criteria (before or independently of implementation), e2e/visual specs, bug reports, playtest-script execution, coverage reports. |
| **QA Adversary** | **Opus** (`claude-opus-5`) | 1, part-time | Tries to break each sprint's exit criteria: edge cases, determinism, race conditions, perf regressions. Signs the sprint QA report. |

Rule of thumb for assigning a ticket: if it touches `src/core/`, `src/game/loop.js`, `gameStateMachine.js`,
`render/renderer.js`, `render/camera.js`, `render/snakeView.js` interpolation, `lasers.js` or `shopScene.js`
pointer picking → **Opus**. Everything else → **Sonnet**. Every ticket in the sprint files carries an explicit
owner; that assignment wins over the rule of thumb.

## 2. How a sprint runs

1. **Kick-off (Fable).** Fable re-reads the sprint file, confirms prerequisites are merged, and posts a
   kick-off comment on the sprint's GitHub tracking issue listing any changed acceptance criteria. Fable creates
   one GitHub issue per ticket (title = ticket ID + name, body = the ticket block copied verbatim, labels
   `sprint:NN`, `owner:opus|sonnet`, `type:feature|qa|design|infra`).
2. **Test-first QA (Sonnet QA).** In parallel with implementation, the QA engineer converts acceptance criteria
   into failing tests on a `qa/` branch. These tests are merged first when they are pure additions, or held in a
   draft PR that the feature PR must make green.
3. **Implementation (Opus / Sonnet).** One ticket = one branch = one PR. Builders follow the *Ticket contract*
   below. They run the fast checks locally before pushing and paste the output in the PR.
4. **Review.** Opus reviews every PR for correctness, architecture compliance and readability. Fable reviews
   every PR labelled `needs-design-review` (any PR that changes visuals, UI text, tunables, timing, rules or
   audio) by opening the Vercel preview and comparing against the reference images. Both reviewers leave
   findings as review comments; the builder fixes and re-requests. Two approvals (Opus + Fable where required)
   merge the PR.
5. **Sprint QA pass (Sonnet QA + Opus adversary).** Once all tickets merge, QA runs the sprint's *QA plan* on the
   `main` preview deployment, files bugs as issues labelled `bug` + `sprint:NN`, and posts the sprint QA report
   (template in `docs/qa/QA-STRATEGY.md §7`).
6. **Bug fixing.** Bugs marked `blocker` are fixed in the same sprint. Others go to the next sprint's backlog
   with Fable's triage decision.
7. **Sign-off (Fable).** Fable walks the *Exit criteria* in the sprint file against the deployed preview, records
   the result in the tracking issue and tags the repo `sprint-NN-done`. The next sprint cannot kick off until the
   tag exists.

Sprints are sized by scope, not calendar. Expect one sprint to take roughly one to three agent-days of wall
clock with two to four agents in parallel.

## 3. Ticket contract

Every ticket in `docs/sprints/` has this shape and builders must satisfy all of it:

```
### KS-NN-TT · Title
Owner: Opus | Sonnet | Sonnet-QA | Fable      Size: S | M | L      Depends on: KS-..
Files: exact paths the ticket may create or change
Spec: what to build, referencing GDD sections, DESIGN-DECISIONS rows and reference images by filename
Acceptance criteria: checkboxes; each one must be verifiable by a test or by a reviewer following a step
QA: the tests this ticket must add or make pass
```

- Do not touch files outside `Files:` without saying so in the PR description and getting Opus's approval.
- Do not change a tunable value. Propose it in the PR; Fable decides.
- Do not add a dependency. Propose it in the PR; Opus decides.
- Every PR: description uses the template, links the issue, includes the fast-check output, and for visual work
  includes a screenshot from the Vercel preview next to the reference image crop it is matching.

## 4. Git and GitHub conventions

- Repository: `aliceagent/kobisnake`. Default branch `main` is protected: PR required, CI required, linear
  history (squash merge), force-pushes and deletions blocked. **Approvals are not enforced by GitHub** while every
  agent pushes as the single `aliceagent` account (GitHub forbids self-approval, so a required-approval rule would
  stop all merges). Opus's review and Fable's design review are therefore written as PR comments and are still
  mandatory before merge; if separate reviewer accounts are created later, turn on "require 1 approval" and
  "require review from Code Owners".
- Branch names: `s{NN}/{ticket-id}-{slug}`, e.g. `s03/ks-03-02-laser-schedule`. QA branches `qa/s{NN}-{slug}`.
- Commit messages: imperative, ≤ 72 chars subject, body explains why. Ticket ID in the subject.
- Squash-merge title = PR title = `KS-NN-TT: description`.
- Labels: `sprint:NN`, `owner:*`, `type:*`, `needs-design-review`, `bug`, `blocker`, `tuning-proposal`.
- Tags: `sprint-NN-done` at sign-off; `v1.0.0` at release (Sprint 18).
- Vercel: the GitHub integration builds every PR into a preview URL (posted automatically on the PR). `main`
  deploys to production. Nobody deploys manually.

## 5. Parallelism map

Tickets inside a sprint are written so that they can run in parallel unless `Depends on:` says otherwise.
The typical shape of a sprint is:

```
      ┌── Sonnet-QA: tests from acceptance criteria ──┐
Fable ┤── Opus: core / risky ticket(s) ───────────────┼── Opus review → Fable design review → merge → QA pass → sign-off
      └── Sonnet ×N: independent feature tickets ─────┘
```

Two sprints may overlap only when the later one's prerequisites list says "may start after KS-.. merges" rather
than "after sprint-NN-done".

## 6. Communication rules for agents
- Everything is written down in the PR or the issue. There is no side channel.
- A blocked agent posts a comment starting with `BLOCKED:` on its issue with what it needs and from whom, then
  moves to another ticket of its own.
- A finding that is out of the ticket's scope becomes a new issue, not a scope creep.
- Report outcomes faithfully: if a test is flaky, say so and file it; never skip or delete a test to get green.

## 7. Human touchpoints
- The owner reviews Fable's sign-off comment for each sprint and plays the preview.
- Playtest gates (Sprint 07 and Sprint 17) require at least two humans sharing one keyboard to run
  `docs/qa/PLAYTEST-SCRIPT.md` and record the answers. Agents cannot replace this step; they prepare the build,
  the script and the bots, and they act on the results.
- The 11-year-old developer's "can I change this?" test: at Sprint 18 they change `snakeSpeed` and a colour hex
  with no help. If they cannot find where, that is a blocker bug.
