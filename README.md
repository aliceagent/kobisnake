# KOBI Snake

A modern, local two-player 3D Snake game for the desktop browser. Two block-built toy snakes compete for apples
in a square brick arena; in the last 30 seconds of every 90-second round four laser walls close inward until
somebody crashes. Built with HTML, CSS, JavaScript and three.js, no server, no accounts, works offline after
the first load. Designed so an 11-year-old developer can read, change and extend it.

**Status:** build under way (Sprint 01 of 20). This repository contains the complete design pack, the reference
concept images, and a 20-sprint plan (`docs/sprints/README.md`) for a multi-agent build.

## How to run

```
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build to dist/
npm run preview   # serve the dist/ build locally
```

Requires Node 20 (`.nvmrc`).

## How to test

```
npm run lint         # ESLint
npm run format       # Prettier --write . (safe — .prettierignore excludes docs/** and *.md)
npm run typecheck    # tsc --noEmit -p jsconfig.json
npm run test:unit    # Vitest: tests/unit/** and tests/sim/**, coverage always on
npm run test:e2e     # Playwright: tests/e2e/**, includes the offline/zero-network check
npm run test:visual  # Playwright: tests/visual/** against tests/visual/__baselines__/
```

Full test-layer detail (what each layer covers, gates, bots): `docs/qa/QA-STRATEGY.md`.

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
- Sprint 01 builds the toolchain and delivery pipeline described above and in `docs/design/ARCHITECTURE.md`.

## Deployment

Hosting is **Vercel**, static, from the `dist/` folder Vite builds. Nobody deploys by hand.

| | |
|---|---|
| Vercel project | `kobisnake` (id `prj_cE5eSQETJjAtso5htBrzNI1jgAYj`), linked to this repository through the GitHub integration |
| Framework preset | Vite, output directory `dist` (also declared in `vercel.json` so the repository is the source of truth) |
| Production branch | `main` — every merge redeploys production |
| Preview | every pull request gets its own preview deployment; Vercel posts the URL as a commit status and a PR comment |
| Production URL | _assigned by Vercel on the first successful production deployment; recorded here by Sprint 01 (see `docs/sprints/sprint-01-bootstrap-and-delivery-pipeline.md`)_ |

`vercel.json` is what makes "the game loads nothing from the internet" enforceable by the browser rather than
by good intentions:

- a **Content-Security-Policy** that allows `'self'` and nothing else for scripts, styles, images, fonts,
  media, workers and connections (`object-src 'none'`, `frame-ancestors 'none'`). A `<script>` pointing at a
  CDN is refused by the browser even if one ever slips past code review;
- `Cache-Control: public, max-age=31536000, immutable` on `/assets/*`, whose filenames Vite content-hashes,
  and `max-age=0, must-revalidate` on the page itself so a new build is never served from a stale index;
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `cleanUrls`.

Because the policy has no `'unsafe-inline'`, page CSS lives in `src/ui/styles.css` rather than in a `<style>`
block, and Vite emits it as a hashed stylesheet.

### Checking a deployment

Agent sessions cannot reach `*.vercel.app` or `api.vercel.com`. Check the commit status GitHub records
instead:

```
curl -s https://api.github.com/repos/aliceagent/kobisnake/commits/<sha>/status
```

The `Vercel` context reports `pending` → `success` with the deployment URL in `target_url`, or `failure` with
the reason. The team is on the Hobby plan, which caps deployments per day; if the status says
`Deployment rate limited`, wait for the daily reset rather than retrying in a loop.

## Reading order for a new agent
1. `CLAUDE.md`
2. `docs/sprints/README.md` then the current sprint file
3. `docs/design/DESIGN-DECISIONS.md` and `docs/design/ARCHITECTURE.md`
4. The reference images listed in your ticket
5. The GDD when you need the intent behind a rule
