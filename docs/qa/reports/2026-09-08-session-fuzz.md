# Session fuzz campaign — the first 2 000 seeds

KI-18-03 · Improvement 18 (`docs/sprints/improvement-18-session-fuzzing.md`) · tracking issue
[#303](https://github.com/aliceagent/kobisnake/issues/303) · ticket issue
[#313](https://github.com/aliceagent/kobisnake/issues/313)

`tests/agent/monkey.js` (KI-18-01, #311) fuzzes the game around the simulation: random keys, random
blur/focus/visibility/resize, at random simulated intervals, applied through the real listeners a person's
input reaches, with a stuck check and a check against the state machine's own table after every action.
`tests/agent/shrink.js` (KI-18-02, #312) turns a failing run into the shortest sequence that still fails.
This document is the first real campaign built on both: two thousand seeds, five hundred actions each, and
what they found.

**Findings are filed, not fixed** — this sprint's own rule, stated twice in its file. Nothing below was
changed to make a number look better.

## What actually ran

- **Command:** KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=1 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=251 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=501 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=751 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=1001 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=1251 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=1501 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz && KI_SESSION_FUZZ=1 KI_SESSION_FUZZ_FIRST_SEED=1751 KI_SESSION_FUZZ_SEED_COUNT=250 npm run test:agent:sessionfuzz
- **Date:** 2026-09-08. As with every other document in this family, this is the one line expected to
  change on a re-run — every number below comes from fixed seeds through a deterministic simulation
  (`ARCHITECTURE §11`), so regenerating this report should reproduce every other line byte for byte.
- **Wall time:** ~5143s, summed across 8 batched invocations. **Not**
  reproducible the way the numbers below are (a busier machine, a different container) — see `meta.command`
  for why it is batched at all: a single ~87-minute Playwright invocation would hold this container's suite
  lock long enough to make the other sessions sharing it wait out `scripts/run-playwright-suite.mjs`'s
  20-minute timeout and fail (`tests/agent/README.md`, `CLAUDE.md`'s "never run two Playwright suites at
  once").
- **Seeds run:** 2000, 500 actions each — 999862
  actions applied in total.
- **Simulated time:** 152668.1s advanced, plus 15609.3s
  counted while a tab was hidden and therefore not advanced (`monkey.js`, "a hidden tab is not advanced").
- **Machine transitions recorded:** 66869.

## The instrument's own sensitivity

Before reading the failure count below as an answer, read what the instrument itself is known to be able to
find: the sprint's QA plan deliberately removed the `MATCH_OVER --QUIT_TO_MENU--> MAIN_MENU` row from
`gameStateMachine.js` on a branch that was never merged, and ran the merged monkey against it. It was found
on **4 of 200 seeds** (a 2%
hit rate), first at seed 106 — and a 20-seed pilot of
the identical branch found it **not at all**. That is the sensitivity this campaign's clean seeds inherit: a
low single-digit hit rate is enough to hide from a small run and still turn up in a large one, which is the
whole argument for running two thousand seeds rather than two hundred.

## State coverage

Reached (8 of 13): `COUNTDOWN`, `MAIN_MENU`, `MATCH_OVER`, `MATCH_SETUP`, `PAUSE`, `PLAYING`, `REPLAY`, `ROUND_OVER`.

- **`LASER_WARNING`** — not visited by any seed in this run.
- **`PRACTICE`** — `src/ui/screens/mainMenu.js:102` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard by design today, not a gap this campaign failed to find.
- **`SETTINGS`** — `src/ui/screens/mainMenu.js:105` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard by design today, not a gap this campaign failed to find.
- **`SHOP`** — `src/ui/screens/mainMenu.js:104` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard by design today, not a gap this campaign failed to find.
- **`TUTORIAL`** — `src/ui/screens/mainMenu.js:103` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard by design today, not a gap this campaign failed to find.

### `LASER_WARNING`, measured rather than assumed

A round has to survive 60 simulated seconds for the warning to fire, and random steering usually kills a
snake in seconds (`tests/sim/laserFuzz.test.js`'s own opening line) — so this run measured it rather than
assuming either answer: reached on **0 of 2000 seeds**
(0.0%).

### `REPLAY` coverage is thinner than every other state's, and here is by how much

`STATES_THAT_RENDER_UNASKED` (`monkey.js`, tied to
[#317](https://github.com/aliceagent/kobisnake/issues/317)) means a run stops advancing simulated time on the
`REPLAY` screen once it has spent 0.25s of simulated time there — the screen
is still entered, keys still land, and the way out is still fuzzed, but time does not keep passing on it once
a seed's budget is spent. 1963 of 2000 seeds entered a state
on that list this run, spending 506.5s of simulated time there in total
and declining to advance a further 23551.4s once their budgets were
spent. Coverage of `REPLAY` is real but shallower than every other state's until #317 lands, at which point
this list empties and nothing else has to change.

## Transition-row coverage

18 of 32 rows in `TRANSITIONS` were
taken at least once.

Rows never taken this run:

- `LASER_WARNING --AUTO_PAUSE-->`
- `LASER_WARNING --LASER_WARNING_DONE-->`
- `LASER_WARNING --PAUSE-->`
- `LASER_WARNING --ROUND_OVER-->`
- `MAIN_MENU --BACK-->`
- `MAIN_MENU --SELECT_PRACTICE-->`
- `MAIN_MENU --SELECT_SETTINGS-->`
- `MAIN_MENU --SELECT_SHOP-->`
- `MAIN_MENU --SELECT_TUTORIAL-->`
- `PLAYING --LASER_WARNING-->`
- `PRACTICE --BACK-->`
- `SETTINGS --BACK-->`
- `SHOP --BACK-->`
- `TUTORIAL --BACK-->`

## Failures

1 distinct failure(s), across 1 of 2000
seeds. Grouped per the ticket's own wording: several seeds hitting the same rule in the same state is one
finding, not one line per seed.

### Finding 1: `stuck` in `MAIN_MENU`

- **Seeds:** 1 of the run — 1885
- **Occurrences:** 1
- **First seen:** seed 1885, action 361 of 362 applied
- **Detail:** MAIN_MENU has not changed in 60.9 simulated seconds with no round running
- **Issue:** #331


## Machine-readable data

The exact numbers above, one block. Regenerating this document from the same batches should reproduce this
block byte for byte (the date and wall time above are deliberately not included here, for the same reason
`agent-run.md` and `round-pacing.md` exclude them).

```json
{
  "seedsRun": 2000,
  "actionsApplied": 999862,
  "simSeconds": 152668.13715788623,
  "hiddenSeconds": 15609.289583252115,
  "transitionsRecorded": 66869,
  "actionsPerSeed": 500,
  "batchCount": 8,
  "stateCoverage": {
    "reached": [
      "COUNTDOWN",
      "MAIN_MENU",
      "MATCH_OVER",
      "MATCH_SETUP",
      "PAUSE",
      "PLAYING",
      "REPLAY",
      "ROUND_OVER"
    ],
    "notReached": [
      "LASER_WARNING",
      "PRACTICE",
      "SETTINGS",
      "SHOP",
      "TUTORIAL"
    ],
    "seedsThatReached": {
      "MAIN_MENU": 2000,
      "MATCH_SETUP": 1998,
      "REPLAY": 1963,
      "COUNTDOWN": 998,
      "PLAYING": 972,
      "PAUSE": 963,
      "ROUND_OVER": 453,
      "MATCH_OVER": 156
    }
  },
  "transitionCoverage": {
    "exercisedCount": 18,
    "totalRows": 32,
    "notExercised": [
      "LASER_WARNING --AUTO_PAUSE-->",
      "LASER_WARNING --LASER_WARNING_DONE-->",
      "LASER_WARNING --PAUSE-->",
      "LASER_WARNING --ROUND_OVER-->",
      "MAIN_MENU --BACK-->",
      "MAIN_MENU --SELECT_PRACTICE-->",
      "MAIN_MENU --SELECT_SETTINGS-->",
      "MAIN_MENU --SELECT_SHOP-->",
      "MAIN_MENU --SELECT_TUTORIAL-->",
      "PLAYING --LASER_WARNING-->",
      "PRACTICE --BACK-->",
      "SETTINGS --BACK-->",
      "SHOP --BACK-->",
      "TUTORIAL --BACK-->"
    ]
  },
  "laserWarning": {
    "seedsThatReachedIt": 0,
    "totalSeeds": 2000,
    "ratePct": 0
  },
  "replayBudget": {
    "seedsThatEnteredIt": 1963,
    "expensiveSeconds": 506.4716330009994,
    "expensiveSkippedSeconds": 23551.394296795515,
    "budgetSecondsPerSeed": 0.25
  },
  "calibration": {
    "seedsRun": 200,
    "actionsPerSeed": 500,
    "seedsThatFoundIt": 4,
    "firstSeedThatFoundIt": 106,
    "pilotSeeds": 20,
    "pilotFoundIt": false
  },
  "failures": [
    {
      "key": "stuck::MAIN_MENU",
      "rule": "stuck",
      "state": "MAIN_MENU",
      "detail": "MAIN_MENU has not changed in 60.9 simulated seconds with no round running",
      "seeds": [
        1885
      ],
      "occurrences": 1,
      "firstSeen": {
        "seed": 1885,
        "actionIndex": 361,
        "actionsApplied": 362
      },
      "issue": "#331"
    }
  ]
}
```
