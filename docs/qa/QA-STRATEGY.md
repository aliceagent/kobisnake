# QA Strategy

"Ample QA" for KOBI Snake means every sprint ships with tests written from the acceptance criteria, an
independent QA pass on the deployed preview, an adversarial review of anything risky, and a design-fidelity
review against the reference images. This document defines the layers, the tooling, the gates and the report.

## 1. Test pyramid

| Layer | Tool | Lives in | Runs | Purpose |
|---|---|---|---|---|
| Unit | Vitest | `tests/unit/` | every PR, < 30 s | Every rule in `src/core/` and `src/game/` in isolation. Coverage gate, per file: **≥ 90 % lines on `src/core/`**, ≥ 75 % on `src/game/` and, from Sprint 04, ≥ 75 % on `src/render/` (view modules are unit-testable in Node with three.js; renderer/WebGL entry points may be excluded by name). |
| Simulation | Vitest | `tests/sim/` | every PR, < 2 min | Headless whole-round and whole-match runs with scripted or bot inputs. Determinism, timeline, statistics ("rounds decided before timeout"). |
| Contract | Vitest | `tests/unit/` | every PR | State-machine transition table, save-data migration, settings schema, event names. |
| End-to-end | Playwright (Chromium) | `tests/e2e/` | every PR, < 6 min | Real browser, real keyboard events, real UI. Uses `window.__kobi` hooks to fast-forward time. |
| Visual regression | Playwright screenshots | `tests/visual/` | every PR | Fixed seed, `?reducedFx=1`, 1280×720, 0.2 % pixel-diff threshold per screen. Baselines updated only via a PR labelled `needs-design-review` with Fable's approval. |
| Cross-browser | Playwright (Firefox, WebKit) | `tests/e2e/` | nightly + Sprint 16 | Rendering and input parity. |
| Performance | Playwright + `performance.now()` probes | `tests/perf/` | nightly + Sprint 16 | Frame-time p95, draw calls (from `renderer.info`), bundle size (from `vite build` output). |
| Offline / network | Playwright request interception | `tests/e2e/offline.spec.js` | every PR | Assert zero network requests after `load`. |
| Design fidelity | Human/Fable review of preview screenshots vs `docs/reference/images` | PR review | every visual PR | The game looks like the concept images. |
| Mutation | StrykerJS | `src/core/` mutated, `tests/unit/core/` judging | nightly (KI-17-03), `npm run test:mutation` | Whether the unit tests can *fail*. Changes the code and asks if any test notices; the score and the surviving mutants are committed in `docs/qa/playtests/mutation-baseline.md`. |
| Manual playtest | Humans + `docs/qa/PLAYTEST-SCRIPT.md` | Sprints 07 and 14 (+ any sprint touching feel) | gates | Fun, fairness, readability. |

## 2. Test-first from acceptance criteria
For each ticket, the QA engineer turns every acceptance-criteria checkbox into at least one test *before* or
independently of the implementation, naming tests after the criterion: `it('KS-04-02 AC3: first laser step
happens 5s after warning', ...)`. Reviewers reject PRs whose acceptance criteria have no corresponding test
unless the ticket explicitly says "manual".

## 3. Deterministic testing
- All randomness goes through `src/core/rng.js` with a seed. Tests pass explicit seeds.
- `RoundSimulation` accepts an input log and can run at any speed; a full 90 s round simulates in milliseconds.
- E2e tests never `waitForTimeout` to let game time pass; they call `__kobi.fastForward(seconds)`.
- Replays: `tests/sim/replays/*.json` store `{seed, settings, inputs, expectedEvents}` recorded from real
  sessions that exposed bugs. Every fixed bug adds a replay.

## 4. Bots for simulation statistics
`tests/sim/bots/` contains three simple bots used to measure design health, not to play well:
- `randomBot` — random legal turns every N steps.
- `greedyBot` — heads for the nearest apple, avoids immediate death.
- `survivorBot` — avoids death with two-step lookahead, ignores apples.
Statistics tracked per sprint (seeded, 500 rounds each pairing): % rounds ending by death before 0:30, between
0:30 and 0:00, by timeout; average survivor length; draw rate; power-up pickup rate. Fable uses these at
Playtest Gates. Targets in `docs/qa/PLAYTEST-SCRIPT.md §5`.

## 5. Gates
A PR merges only when: lint, typecheck, unit + sim (with coverage gate), build, e2e, visual, offline all pass;
Opus approved; Fable approved if `needs-design-review`.
A sprint signs off only when: all tickets merged; sprint QA report posted with zero open `blocker` bugs; exit
criteria walked by Fable on the production preview.

## 6. Bug report format (GitHub issue, label `bug`)
```
Title: [S04] Laser step kills snake whose head is one cell inside the safe zone
Build: preview URL + commit sha
Seed / replay: seed=4242 or attached replay json
Steps: 1. … 2. …
Expected: (quote the DESIGN-DECISIONS row or AC)
Actual:
Severity: blocker | major | minor | polish
Evidence: screenshot / video / failing test name
```

## 7. Sprint QA report (posted on the sprint tracking issue)
```
## Sprint NN QA report
Build: <production preview URL> @ <sha>
Automated: unit N passed / sim N passed / e2e N passed / visual N passed / coverage core X% game Y%
Manual QA plan: <each QA-plan item: PASS / FAIL (#issue) / N/A>
Adversarial review (Opus): <what was attacked, what broke, what was filed>
Design fidelity (Fable): <screens compared, verdict per screen>
Open bugs: blocker 0 · major N · minor N · polish N
Verdict: READY FOR SIGN-OFF | NOT READY (list blockers)
```

## 8. Non-functional checks (every sprint from Sprint 03)
- Console has zero errors and zero warnings during a full match.
- Resize the window mid-round; nothing breaks, aspect is preserved, HUD stays anchored.
- Tab away and back; game is paused, timer did not advance.
- Lighthouse (Sprint 16): Performance ≥ 90, Accessibility ≥ 90, Best Practices ≥ 95.

## 9. Mutation testing on the core (Improvement 17)

Coverage answers "was this line executed?". It has answered **100 %** for `src/core` since Sprint 02, and in
that time at least six tests that asserted nothing reached `main` anyway (#111, #112, #115, #116, #142, #154).
A line executed is not a line checked, and no coverage tool can tell the difference.

Mutation testing can. StrykerJS compiles a copy of `src/core` in which each mutable expression can be
switched to a wrong version of itself — a `<` becomes `<=`, a branch is dropped, a constant is replaced, a
method call is stripped — runs `tests/unit/core` against each of those 1 300-odd mutants in turn, and reports
which ones no test noticed. **A surviving mutant is a rule of this game that nothing proves.** It is the same
thing a careful reviewer does by hand when they ask "what if this comparison were the other way round?", done
exhaustively and without getting bored.

- **Run it:** `npm run test:mutation`. Configuration is `stryker.config.mjs`, and the tests that judge the
  mutants are scoped by `vitest.mutation.config.js`; both files explain their choices at length.
- **What is gated:** `src/core` only. It is pure, deterministic, has no DOM and no three.js, and its unit
  suite runs in four seconds, which is what makes an exhaustive run affordable. `src/game` is measured once
  for information (`docs/qa/playtests/mutation-game.md`); `src/render` is not measured.
- **What judges it:** `tests/unit/core` only, not `tests/sim`. The reasoning is in `stryker.config.mjs`, and
  the consequence is the point: **a rule in `src/core` whose only proof is a fuzz run is a rule with no unit
  test.** If a mutant survives here that a sim suite would have killed, the answer is to write the unit test.
- **The score and the survivors** are committed in `docs/qa/playtests/mutation-baseline.md`, regenerated from
  the run by `node scripts/mutation-report.mjs`. Every survivor is either killed by a new assertion or listed
  in the triage file with a sentence saying why it cannot change behaviour.
- **The trap to avoid.** An assertion written to kill a specific mutant, rather than to state a rule, pins an
  implementation detail and makes the suite worse — it raises the score and lowers the value. Reviewers of a
  mutation PR review the assertions as behaviour, and reject one that reads as "because Stryker said so".
  `CLAUDE.md`'s "never skip, delete, weaken or quarantine a test" has a sibling here: never *narrow* the code
  to kill a mutant either.
