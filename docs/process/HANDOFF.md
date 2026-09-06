# Handoff: how Opus and Sonnet pick up the sprints

This is the operational hand-over from the design lead (Fable) to the build team. Every sprint is started by
creating **one Opus session** that acts as tech lead for that sprint. The Opus session implements the tickets
owned by Opus itself and spawns **Sonnet subagents** for every ticket owned by Sonnet or Sonnet-QA, running
them in parallel wherever the ticket's `Depends on:` allows. Fable reviews PRs, resolves design questions and
signs the sprint off.

## Before starting any sprint
1. The previous sprint has its sign-off row in `docs/sprints/README.md`, or the design lead has started it
   conditionally on the tracking issue.
2. `main` is green and deployed.
3. The sprint's tracking issue exists (title `Sprint NN — <name>`, label `sprint:NN`), with one issue per
   ticket. If they do not exist, the Opus session creates them from the ticket blocks as its first action.

## Kick-off prompt (paste into a new Opus session on `main`)

```
You are the tech lead for KOBI Snake Sprint NN. Repository: aliceagent/kobisnake, branch main.

Read, in order: CLAUDE.md, docs/sprints/README.md, docs/sprints/sprint-NN-*.md,
docs/design/DESIGN-DECISIONS.md, docs/design/ARCHITECTURE.md, docs/process/AGENT-ROLES-AND-WORKFLOW.md,
docs/qa/QA-STRATEGY.md, and every reference image named in the sprint file.

Then:
1. Create the sprint tracking issue and one issue per ticket if they do not already exist (labels per
   AGENT-ROLES §4).
2. Implement the tickets owned by Opus yourself. For every ticket owned by Sonnet or Sonnet-QA, spawn a
   Sonnet subagent with the ticket block, CLAUDE.md, and the file paths it may touch; run independent
   tickets in parallel; respect Depends on.
3. One ticket = one branch (s{NN}/{ticket-id}-{slug}) = one pull request against main, title
   "KS-NN-TT: ...", body from .github/pull_request_template.md, fast-check output pasted, screenshots for
   visual work. Review every Sonnet PR yourself before merging; request changes until every acceptance
   criterion has a named test.
4. Never change a tunable, add a dependency, skip a test, or load anything from a CDN. Propose instead.
5. When all tickets are merged: run the sprint QA plan on the main deployment, post the sprint QA report
   (QA-STRATEGY §7) on the tracking issue, and post "READY FOR SIGN-OFF" or the list of blockers.
6. Stop there. Fable signs off (sign-off row + comment).

Report progress as comments on the tracking issue, not in chat. If blocked, post "BLOCKED: <what> <from whom>".
```

## Sonnet subagent prompt (used by the Opus session for each Sonnet ticket)

```
You are implementing ticket KS-NN-TT of KOBI Snake. Read CLAUDE.md, then the ticket block below, then
docs/design/DESIGN-DECISIONS.md and docs/design/ARCHITECTURE.md, and the reference images the ticket names.
Work on branch s{NN}/ks-NN-TT-{slug} from main. Touch only the files the ticket lists. Write a test named
after every acceptance criterion before or alongside the code. Run
`npm run lint && npm run typecheck && npm run test:unit && npm run build` (and test:e2e if a browser can see
your change) and paste the output in the PR. Open a PR with the template; label it needs-design-review if
anything visual, textual, timing- or rule-related changed. Do not merge. Report the PR URL.

<ticket block pasted verbatim>
```

## Environment limits the build team must know
- GitHub *repository settings* (default branch, protection, rulesets, labels via API) cannot be written from
  agent sessions; the proxy refuses those paths. Prepare the exact settings as a checklist and ask the owner.
- The Vercel team is on the Hobby plan (100 deployments/day). Do not retry refused deployments in a loop.
- `vercel.app` domains are not reachable from agent sessions; verify deployments through the GitHub commit
  status that Vercel posts, or through the Vercel connector.
- Never put model names in commits, code, or comments.

## Fable's cadence
Fable checks each active sprint session at least twice a day: reviews open PRs labelled
`needs-design-review`, answers `BLOCKED:` comments, walks exit criteria when "READY FOR SIGN-OFF" is posted,
tags, updates the sign-off record in `docs/sprints/README.md`, and starts the next sprint's Opus session.

## Sprint start order
S01 → S02 → S03 → S04 → S05 → S06 → S07 → { S08 → S09 → S10 } ∥ { S11 → S12 } → S13 → S14 → S15 → S16 → S17 →
S18 → S19 → S20. Sprint 07 and Sprint 17 need two humans on one keyboard; Fable schedules them at the start of
the preceding sprint.
