# Pre-sprint validation report — 2026-09-05

Author: Fable (design lead). Build: no game code yet; repository at the planning commit on `main`.
Purpose: test what exists (the design numbers, the placeholder deployment, the documents) before handing the
sprints to the build team, and fix what the tests found.

## 1. Design rules simulated
`docs/design/spikes/design-validation-sim.py` is a 150-line throwaway Python model of the rules in
`DESIGN-DECISIONS.md` (24×24 grid, 120 Hz, 6 cells/s, 4 apples, laser warning at 0:30, steps every 2.5 s to a
6×6 minimum, timeout rule, draw rule). It is **not** the engine; it exists so the numbers were checked before
anyone wrote JavaScript. Three bots: `survivor` (avoids death, two-step lookahead, avoids the opponent's
reachable cells), `greedy` (heads for the nearest apple with the same safety checks), `noop`.

| Check | Expected | Result |
|---|---|---|
| No-input round | both hit opposite walls on the same step at 19/6 s → DRAW | DRAW, causes WALL/WALL, t = 3.167 s ✔ |
| Laser timeline | WARN at 60 s elapsed, steps at 65, 67.5, 70 … | matches; 9th step at 85 s leaves 6×6 ✔ |
| Rounds decided before timeout (target ≥ 85 %) | | 98–100 % across all pairings ✔ |
| Lasers force a climax | cautious play ends during the laser phase | survivor vs survivor: 98 % of rounds end during lasers ✔ |
| Draw rate (target ≤ 3 %) with the original "head-on = both die" rule | | greedy vs survivor 2 %, greedy vs greedy 4 %, **survivor vs survivor 35 %** ✘ |
| Draw rate with "longer snake survives a head-on" | | 1 %, 1.7 %, 10.3 % |

**Finding and decision.** With equal speeds and phase-locked stepping, every head-on between two careful
snakes in the final square is simultaneous, so the both-die rule turned the climax into a replay one time in
three. Rule 8 in `DESIGN-DECISIONS.md` now reads: longer snake survives a head-on, equal length both die. Sprint
02 acceptance criteria (KS-02-04 AC2/AC3) and the playtest script (C3) were updated. The remaining 10 % draws in
the survivor-vs-survivor pairing are equal-length head-ons between two snakes that never eat; humans eat.

Bot statistics with the adopted rule (300 seeded rounds each):

| Pairing | Ends before 0:30 | Ends during lasers | Timeout | Draws | Mean longest snake |
|---|---|---|---|---|---|
| survivor vs survivor | 0 % | 98 % | 2 % | 10.3 % | 8.7 |
| greedy vs survivor | 61 % | 39 % | 0 % | 1.0 % | 35.0 |
| greedy vs greedy | 91 % | 9 % | 0 % | 1.7 % | 23.4 |

Sprint 02's real bots (`tests/sim/bots/`) must reproduce these orders of magnitude; a large deviation means the
engine and the design disagree.

## 2. Placeholder deployment page
Served `index.html` locally and loaded it in headless Chromium (Playwright 1.63, viewport 1280×720).

| Check | Result |
|---|---|
| Page renders, `<title>` "KOBI Snake", heading present | ✔ |
| External network requests after load | 0 ✔ |
| Console errors/warnings | 1 ✘ → favicon 404. Fixed by inlining an SVG favicon (data URI). Re-run: 0 ✔ |
| `vercel.json` parses | ✔ |

## 3. Documents
| Check | Result |
|---|---|
| 20 sprint files, index links resolve | ✔ |
| 111 ticket IDs; every `KS-NN-TT` reference points at an existing ticket | ✔ |
| Every `sprint-NN-done` tag reference points at an existing sprint | ✔ |
| Every reference-image filename cited exists | ✔ |
| Relative Markdown links (20) | 0 broken ✔ |
| Doc paths cited but not yet existing | 10, all created by later sprints by design (developer guide, style guide, audio notes, playtest records, release checklist, browser matrix) |
| `SETTINGS` block in DESIGN-DECISIONS §4 balanced | ✔ |

## 4. Deployment status
Vercel project `kobisnake` linked to the repository with `main` as production. First deployment refused by the
Hobby daily quota; a retry is scheduled for 2026-09-06 17:40 UTC.

## 5. Open items carried into Sprint 01
- Branch protection on `main` requires the owner to click through GitHub settings (agents cannot write repo
  settings from this environment).
- Vercel production URL to be recorded in `README.md` after the first successful deployment.
