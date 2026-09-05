# KOBI Snake

A modern, local two-player 3D Snake game for the desktop browser. Two block-built toy snakes compete for apples
in a square brick arena; in the last 30 seconds of every 90-second round four laser walls close inward until
somebody crashes. Built with HTML, CSS, JavaScript and three.js, no server, no accounts, works offline after
the first load. Designed so an 11-year-old developer can read, change and extend it.

**Status:** planning complete, build not started. This repository currently contains the complete design pack,
the reference concept images, and an 18-sprint plan for a multi-agent build.

## Where things are

| Path | What |
|---|---|
| `docs/design/GDD-KOBI-Snake-Design-and-Reference-Pack.txt` | The original game design document (authoritative on intent). |
| `docs/design/DESIGN-DECISIONS.md` | Every open question in the GDD resolved into a shipping default (authoritative on numbers and edge cases). |
| `docs/design/ARCHITECTURE.md` | Toolchain, folder layout, simulation model, rendering/UI/audio rules, performance budgets. |
| `docs/reference/` | The concept images and a catalog explaining what each one locks. |
| `docs/sprints/` | The sprint plan: `README.md` is the roadmap; one file per sprint with tickets, acceptance criteria, QA plan and exit criteria. |
| `docs/process/AGENT-ROLES-AND-WORKFLOW.md` | Who builds what (Fable designs, Opus leads engineering and review, Sonnet builds and tests), how a sprint runs, GitHub conventions. |
| `docs/qa/` | QA strategy, playtest script, playtest records. |
| `CLAUDE.md` | The short rulebook every builder agent reads first. |

## How it will be built and hosted

- Code lives on GitHub (`aliceagent/kobisnake`). `main` is protected; every change is a pull request with CI.
- Hosting is **Vercel**: every pull request gets a preview deployment, `main` deploys to production. The Vercel
  project is `kobisnake` on the owner's team, linked to this repository through the GitHub integration (project
  id `prj_cE5eSQETJjAtso5htBrzNI1jgAYj`). The production URL is assigned by Vercel on the first successful
  deployment and is recorded here by Sprint 00 (`docs/sprints/sprint-00-bootstrap-and-delivery-pipeline.md`).
- Sprint 00 creates the toolchain (`npm run dev | build | lint | typecheck | test:unit | test:e2e | test:visual`).
  Until then there is nothing to run.

## Reading order for a new agent
1. `CLAUDE.md`
2. `docs/sprints/README.md` then the current sprint file
3. `docs/design/DESIGN-DECISIONS.md` and `docs/design/ARCHITECTURE.md`
4. The reference images listed in your ticket
5. The GDD when you need the intent behind a rule
