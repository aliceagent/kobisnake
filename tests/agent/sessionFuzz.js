// @ts-check
import { TRANSITIONS } from '../../src/game/gameStateMachine.js';
import {
  KNOWN_STATES,
  STATES_THAT_RENDER_UNASKED,
  EXPENSIVE_STATE_BUDGET_SECONDS,
} from './monkey.js';

/**
 * KI-18-03 — the first campaign (Improvement 18, `docs/sprints/improvement-18-session-fuzzing.md`, tracking
 * issue #303, ticket issue #313). Builds on KI-18-01's monkey (#311, `tests/agent/monkey.js`) and KI-18-02's
 * shrinker (#312, `tests/agent/shrink.js`).
 *
 * **This module is Node-side only and pure**, in the same shape `report.js` and `pacing.js` already use for
 * exactly this reason (tech-lead ruling on #122): {@link aggregateCampaign} takes the campaign's raw
 * `MonkeyResult[]` (from `monkey.js`'s `runMonkeySession`, played over many seeds) plus a little run metadata
 * and produces every number the committed report needs — the state and transition coverage, the laser-warning
 * and REPLAY-budget calibration figures, and the distinct-failure groups. {@link renderSessionFuzzReport}
 * turns that into the markdown text committed at `docs/qa/reports/2026-09-08-session-fuzz.md`. Neither
 * function touches a page, a clock or the filesystem, which is what makes both provable against hand-built
 * fixtures in `tests/agent/sessionFuzz.test.js` — `tests/agent/sessionFuzz.spec.js` is the only thing here that
 * actually plays the seeds.
 *
 * ## Two things the sprint file asks the report to say, that a plain "coverage table" would not
 *
 * 1. **State coverage means "reached at all", not "reached under every random draw".** `PRACTICE`, `TUTORIAL`,
 *    `SHOP` and `SETTINGS` cannot be reached through the keyboard *by design* today — {@link
 *    reasonStateUnreachable} says exactly why, citing the file and line, rather than reporting a gap with no
 *    explanation. `LASER_WARNING` is different: nothing forbids it, it is merely rare, so it gets *measured*
 *    (how many seeds reached it, out of how many) rather than assumed either way.
 * 2. **A campaign that finds nothing is only as convincing as its own sensitivity.** #303's QA plan measured
 *    that directly — a deliberately removed `MATCH_OVER --QUIT_TO_MENU--> MAIN_MENU` row was found on 4 of 200
 *    seeds, first at seed 106, and a 20-seed pilot found it not at all. {@link CALIBRATION} carries that
 *    measurement as data (not prose baked into the renderer) so the report can quote it next to this run's own
 *    finding count, which is what turns "the campaign found nothing" from an unfalsifiable claim into a
 *    number a reader can weigh.
 */

/** @typedef {import('./monkey.js').MonkeyResult} MonkeyResult */
/** @typedef {import('./monkey.js').MonkeyProblem} MonkeyProblem */

/**
 * The QA plan's own calibration run (#303, tech-lead comment 2026-09-08T16:20:30Z): a deliberately removed
 * `MATCH_OVER --QUIT_TO_MENU--> MAIN_MENU` row, run against the merged monkey on a branch that is never
 * merged (`qa/i18-removed-transition`). Quoted as data, not re-derived — this run cannot reproduce it (`main`
 * carries every row), and is not supposed to.
 *
 * @type {{seedsRun: number, actionsPerSeed: number, seedsThatFoundIt: number, firstSeedThatFoundIt: number, pilotSeeds: number, pilotFoundIt: boolean}}
 */
export const CALIBRATION = Object.freeze({
  seedsRun: 200,
  actionsPerSeed: 500,
  seedsThatFoundIt: 4,
  firstSeedThatFoundIt: 106,
  pilotSeeds: 20,
  pilotFoundIt: false,
});

/**
 * The four menu rows `mainMenu.js` ships `disabled: true` this sprint, and therefore the four states
 * `focus.js` can never let a keyboard reach — cited by file and line rather than merely asserted, per this
 * ticket's own instruction to verify rather than repeat the tech lead's answer.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DISABLED_MENU_STATE_REASONS = Object.freeze({
  PRACTICE:
    '`src/ui/screens/mainMenu.js:102` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/' +
    '`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard ' +
    'by design today, not a gap this campaign failed to find.',
  TUTORIAL:
    '`src/ui/screens/mainMenu.js:103` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/' +
    '`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard ' +
    'by design today, not a gap this campaign failed to find.',
  SHOP:
    '`src/ui/screens/mainMenu.js:104` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/' +
    '`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard ' +
    'by design today, not a gap this campaign failed to find.',
  SETTINGS:
    '`src/ui/screens/mainMenu.js:105` ships this row `disabled: true`, and `src/ui/focus.js`’s `move`/' +
    '`firstFocusableIndex` never let the cursor land on a disabled entry — unreachable through the keyboard ' +
    'by design today, not a gap this campaign failed to find.',
});

/**
 * Every row `TRANSITIONS` defines, as `"FROM --EVENT-->"` strings — the table-row half of coverage, kept
 * distinct from state coverage because a state can be *entered* (reached) while one of its own rows is never
 * *taken* (exercised). One entry per `(state, event)` pair; `PREVIOUS`-target rows are not expanded to every
 * state they could resolve to; the row itself is what a table-coverage claim is about.
 *
 * @type {readonly string[]}
 */
export const TRANSITION_ROWS = Object.freeze(
  Object.keys(TRANSITIONS).flatMap((state) =>
    Object.keys(/** @type {any} */ (TRANSITIONS)[state]).map((event) => `${state} --${event}-->`),
  ),
);

/** @param {MonkeyResult[]} results @param {(result: MonkeyResult) => number} pick @returns {number} */
function sumBy(results, pick) {
  return results.reduce((total, result) => total + pick(result), 0);
}

/**
 * Why a known state was never visited this run — `null` when the campaign should be expected to reach it
 * (there is no structural reason it could not) and simply did not this time.
 *
 * @param {string} state
 * @returns {string | null}
 */
export function reasonStateUnreachable(state) {
  return DISABLED_MENU_STATE_REASONS[state] ?? null;
}

/**
 * @typedef {object} StateCoverage
 * @property {string[]} reached - every state at least one seed's `statesVisited` named, sorted.
 * @property {string[]} notReached - `KNOWN_STATES` minus `reached`, sorted.
 * @property {Record<string, string | null>} unreachedReasons - `notReached` state -> {@link
 *   reasonStateUnreachable}'s answer, `null` when the campaign was structurally able to reach it and simply
 *   did not this run.
 * @property {Record<string, number>} seedsThatReached - reached state -> how many seeds visited it at least
 *   once.
 */

/**
 * @param {MonkeyResult[]} results
 * @returns {StateCoverage}
 */
export function aggregateStateCoverage(results) {
  /** @type {Record<string, number>} */
  const seedsThatReached = {};
  for (const result of results) {
    for (const state of new Set(result.statesVisited)) {
      seedsThatReached[state] = (seedsThatReached[state] ?? 0) + 1;
    }
  }
  const reached = Object.keys(seedsThatReached).sort();
  const notReached = KNOWN_STATES.filter((state) => !reached.includes(state)).sort();
  /** @type {Record<string, string | null>} */
  const unreachedReasons = {};
  for (const state of notReached) unreachedReasons[state] = reasonStateUnreachable(state);
  return { reached, notReached, unreachedReasons, seedsThatReached };
}

/**
 * @typedef {object} TransitionCoverage
 * @property {string[]} exercised - `TRANSITION_ROWS` entries at least one seed's recorded transitions took.
 * @property {string[]} notExercised - `TRANSITION_ROWS` minus `exercised`, sorted.
 */

/**
 * @param {MonkeyResult[]} results
 * @returns {TransitionCoverage}
 */
export function aggregateTransitionCoverage(results) {
  /** @type {Set<string>} */
  const exercised = new Set();
  for (const result of results) {
    for (const transition of result.transitions) {
      const row = `${transition.from} --${transition.event}-->`;
      if (TRANSITION_ROWS.includes(row)) exercised.add(row);
    }
  }
  return {
    exercised: [...exercised].sort(),
    notExercised: TRANSITION_ROWS.filter((row) => !exercised.has(row)).sort(),
  };
}

/**
 * How often the campaign reached `LASER_WARNING` — measured, per this module's header, never assumed either
 * way: a round has to survive 60 simulated seconds for the warning to fire, and random steering usually kills
 * a snake in seconds (`tests/sim/laserFuzz.test.js`'s own opening line).
 *
 * @param {MonkeyResult[]} results
 * @returns {{seedsThatReachedIt: number, totalSeeds: number, ratePct: number}}
 */
export function laserWarningCoverage(results) {
  const seedsThatReachedIt = results.filter((result) =>
    result.statesVisited.includes('LASER_WARNING'),
  ).length;
  return {
    seedsThatReachedIt,
    totalSeeds: results.length,
    ratePct: results.length === 0 ? 0 : (seedsThatReachedIt / results.length) * 100,
  };
}

/**
 * How much the {@link STATES_THAT_RENDER_UNASKED} budget (#317) bit this run: how many seeds entered such a
 * state at all, and the simulated seconds spent there versus declined.
 *
 * @param {MonkeyResult[]} results
 * @returns {{seedsThatEnteredIt: number, expensiveSeconds: number, expensiveSkippedSeconds: number, budgetSecondsPerSeed: number}}
 */
export function replayBudgetCoverage(results) {
  const seedsThatEnteredIt = results.filter((result) =>
    result.statesVisited.some((state) => STATES_THAT_RENDER_UNASKED.includes(state)),
  ).length;
  return {
    seedsThatEnteredIt,
    expensiveSeconds: sumBy(results, (r) => r.expensiveSeconds),
    expensiveSkippedSeconds: sumBy(results, (r) => r.expensiveSkippedSeconds),
    budgetSecondsPerSeed: EXPENSIVE_STATE_BUDGET_SECONDS,
  };
}

/**
 * One canonical grouping key for a finding — the ticket's own wording ("several seeds hitting the same rule
 * in the same state is one finding"). A page error carries no `state` (it is reported by the browser, not by
 * the monkey's own `report()`), so its exact message stands in for one — messages here are static text
 * produced by a thrown `Error`, never interpolated with a seed or an index, so the same underlying bug always
 * produces the same string.
 *
 * @param {{rule: string, state?: string | null}} entry
 * @returns {string}
 */
function failureKey(entry) {
  return `${entry.rule}::${entry.state ?? ''}`;
}

/**
 * @typedef {object} DistinctFailure
 * @property {string} key
 * @property {string} rule
 * @property {string | null} state - `null` for a page error, which carries no state.
 * @property {string} detail - the first occurrence's detail text.
 * @property {number[]} seeds - every seed that hit this finding at least once, ascending, deduplicated.
 * @property {number} occurrences - total times seen across every seed (may exceed `seeds.length`).
 * @property {{seed: number, actionIndex: number, actionsApplied: number}} firstSeen - the earliest seed to
 *   hit it, and where — the seed {@link buildShrinkFixture} in `sessionFuzz.spec.js` shrinks from.
 */

/**
 * Every finding one `MonkeyResult` carries, as the same `{rule, state, detail, actionIndex}` shape whether it
 * came from an in-page `problem` or a browser-level page error — the one place that shape is assembled, so
 * {@link groupFailures} and a shrink predicate (`sessionFuzz.spec.js`) can never compute it two different
 * ways.
 *
 * @param {MonkeyResult} result
 * @returns {{rule: string, state: string | null, detail: string, actionIndex: number}[]}
 */
export function failureEntriesFor(result) {
  /** @type {{rule: string, state: string | null, detail: string, actionIndex: number}[]} */
  const entries = [];
  for (const problem of result.problems) {
    entries.push({
      rule: problem.rule,
      state: problem.state,
      detail: problem.detail,
      actionIndex: problem.actionIndex,
    });
  }
  for (const message of result.pageErrors) {
    const separator = message.indexOf(': ');
    const rule = separator === -1 ? message : message.slice(0, separator);
    const detail = separator === -1 ? message : message.slice(separator + 2);
    entries.push({ rule, state: null, detail, actionIndex: -1 });
  }
  return entries;
}

/**
 * Every {@link failureKey} one `MonkeyResult` carries — what a shrink predicate checks a candidate against.
 *
 * @param {MonkeyResult} result
 * @returns {Set<string>}
 */
export function failureKeysFor(result) {
  return new Set(failureEntriesFor(result).map(failureKey));
}

/**
 * Groups every problem and page error across a campaign's results into {@link DistinctFailure}s, in the
 * order each was first seen (ascending seed, then ascending action index within that seed).
 *
 * @param {MonkeyResult[]} results
 * @returns {DistinctFailure[]}
 */
export function groupFailures(results) {
  /** @type {Map<string, DistinctFailure>} */
  const byKey = new Map();

  for (const result of results) {
    const entries = failureEntriesFor(result);
    for (const entry of entries) {
      const key = failureKey(entry);
      const existing = byKey.get(key);
      if (existing === undefined) {
        byKey.set(key, {
          key,
          rule: entry.rule,
          state: entry.state,
          detail: entry.detail,
          seeds: [result.seed],
          occurrences: 1,
          firstSeen: {
            seed: result.seed,
            actionIndex: entry.actionIndex,
            actionsApplied: result.actionsApplied,
          },
        });
      } else {
        existing.occurrences += 1;
        if (!existing.seeds.includes(result.seed)) existing.seeds.push(result.seed);
      }
    }
  }

  const failures = [...byKey.values()];
  // `seeds` reads as "which seeds hit this", so it is sorted ascending regardless of the order `results`
  // happened to be handed in — `firstSeen` is what carries "which one was seen first" for a reader who cares.
  for (const failure of failures) failure.seeds.sort((a, b) => a - b);
  return failures.sort((a, b) => a.firstSeen.seed - b.firstSeen.seed);
}

/**
 * @typedef {object} CampaignMeta
 * @property {string} date - `YYYY-MM-DD`.
 * @property {string} command - the batched commands that produced this run (AC1).
 * @property {number} wallSeconds - real wall-clock seconds summed across every batch.
 * @property {number} actionsPerSeed - the action count every seed in this run was generated with.
 * @property {number} batchCount - how many separate `npm run test:agent:sessionfuzz` invocations this run
 *   was split across (the sprint file's own container-contention constraint — see `sessionFuzz.spec.js`).
 */

/**
 * @typedef {object} AggregatedCampaign
 * @property {CampaignMeta} meta
 * @property {number} seedsRun
 * @property {number} actionsApplied
 * @property {number} simSeconds
 * @property {number} hiddenSeconds
 * @property {number} transitionsRecorded
 * @property {StateCoverage} stateCoverage
 * @property {TransitionCoverage} transitionCoverage
 * @property {{seedsThatReachedIt: number, totalSeeds: number, ratePct: number}} laserWarning
 * @property {{seedsThatEnteredIt: number, expensiveSeconds: number, expensiveSkippedSeconds: number, budgetSecondsPerSeed: number}} replayBudget
 * @property {DistinctFailure[]} failures
 * @property {number} seedsWithAFailure
 */

/**
 * The whole of what `renderSessionFuzzReport` needs, computed from a campaign's raw `MonkeyResult[]`.
 *
 * @param {{meta: CampaignMeta, results: MonkeyResult[]}} campaign
 * @returns {AggregatedCampaign}
 */
export function aggregateCampaign({ meta, results }) {
  const failures = groupFailures(results);
  const seedsWithAFailure = new Set(failures.flatMap((failure) => failure.seeds)).size;
  return {
    meta: { ...meta },
    seedsRun: results.length,
    actionsApplied: sumBy(results, (r) => r.actionsApplied),
    simSeconds: sumBy(results, (r) => r.simSeconds),
    hiddenSeconds: sumBy(results, (r) => r.hiddenSeconds),
    transitionsRecorded: sumBy(results, (r) => r.transitions.length),
    stateCoverage: aggregateStateCoverage(results),
    transitionCoverage: aggregateTransitionCoverage(results),
    laserWarning: laserWarningCoverage(results),
    replayBudget: replayBudgetCoverage(results),
    failures,
    seedsWithAFailure,
  };
}

const fmtPct = (/** @type {number} */ value) => `${value.toFixed(1)}%`;

/**
 * One failure's markdown block: the rule, the state, how many seeds and how many times, the seeds
 * themselves, the representative detail, and — when the caller supplies one — the filed issue link.
 *
 * @param {DistinctFailure} failure
 * @param {number} index
 * @param {Record<string, string>} issueLinks - `failure.key` -> `"#123"`, when filed.
 * @returns {string}
 */
function failureBlock(failure, index, issueLinks) {
  const issue = issueLinks[failure.key];
  const seedsList = failure.seeds.join(', ');
  return (
    `### Finding ${index + 1}: \`${failure.rule}\`${failure.state === null ? '' : ` in \`${failure.state}\``}\n\n` +
    `- **Seeds:** ${failure.seeds.length} of the run — ${seedsList}\n` +
    `- **Occurrences:** ${failure.occurrences}\n` +
    `- **First seen:** seed ${failure.firstSeen.seed}, action ${failure.firstSeen.actionIndex} of ` +
    `${failure.firstSeen.actionsApplied} applied\n` +
    `- **Detail:** ${failure.detail}\n` +
    `- **Issue:** ${issue === undefined ? '_not yet filed_' : issue}\n`
  );
}

/**
 * Renders {@link AggregatedCampaign} as the markdown document committed at
 * `docs/qa/reports/2026-09-08-session-fuzz.md`, in the style `docs/qa/playtests/agent-run.md` and
 * `docs/qa/playtests/round-pacing.md` use: a "What actually ran" section naming the exact batched commands, a
 * calibration section quoting the QA plan's own sensitivity measurement, the state and transition coverage,
 * the laser-warning and REPLAY-budget numbers, the failure list, and a machine-readable JSON block at the
 * bottom for exact diffing between two regenerations.
 *
 * @param {AggregatedCampaign} aggregated
 * @param {Record<string, string>} [issueLinks] - `DistinctFailure.key` -> `"#123"`, for every failure that
 *   has been filed. A failure with no entry here renders as "not yet filed".
 * @returns {string}
 */
export function renderSessionFuzzReport(aggregated, issueLinks = {}) {
  const { meta, stateCoverage, transitionCoverage, laserWarning, replayBudget, failures } =
    aggregated;

  const reachedList = stateCoverage.reached.map((state) => `\`${state}\``).join(', ');
  const notReachedLines = stateCoverage.notReached
    .map((state) => {
      const reason = stateCoverage.unreachedReasons[state];
      return `- **\`${state}\`** — ${reason ?? 'not visited by any seed in this run.'}`;
    })
    .join('\n');

  const transitionNotExercisedSection =
    transitionCoverage.notExercised.length === 0
      ? 'Every row in `TRANSITIONS` was taken at least once.'
      : 'Rows never taken this run:\n\n' +
        transitionCoverage.notExercised.map((row) => `- \`${row}\``).join('\n');

  const failuresSection =
    failures.length === 0
      ? 'No distinct failure was found across every seed this run played. Given the calibration above — a ' +
        'known finding at a 2% hit rate, missed entirely by a 20-seed pilot — a clean 2 000-seed run is real ' +
        'evidence the game holds up under this much random pressure, not proof nothing is there; it is the ' +
        "same honest reading `monkey.spec.js`'s own AC3 gate gives a clean 200-seed run."
      : failures.map((failure, index) => failureBlock(failure, index, issueLinks)).join('\n');

  const jsonBlock = JSON.stringify(
    {
      seedsRun: aggregated.seedsRun,
      actionsApplied: aggregated.actionsApplied,
      simSeconds: aggregated.simSeconds,
      hiddenSeconds: aggregated.hiddenSeconds,
      transitionsRecorded: aggregated.transitionsRecorded,
      actionsPerSeed: meta.actionsPerSeed,
      batchCount: meta.batchCount,
      stateCoverage: {
        reached: stateCoverage.reached,
        notReached: stateCoverage.notReached,
        seedsThatReached: stateCoverage.seedsThatReached,
      },
      transitionCoverage: {
        exercisedCount: transitionCoverage.exercised.length,
        totalRows: TRANSITION_ROWS.length,
        notExercised: transitionCoverage.notExercised,
      },
      laserWarning,
      replayBudget,
      calibration: CALIBRATION,
      failures: failures.map((failure) => ({
        key: failure.key,
        rule: failure.rule,
        state: failure.state,
        detail: failure.detail,
        seeds: failure.seeds,
        occurrences: failure.occurrences,
        firstSeen: failure.firstSeen,
        issue: issueLinks[failure.key] ?? null,
      })),
    },
    null,
    2,
  );

  return `# Session fuzz campaign — the first 2 000 seeds

KI-18-03 · Improvement 18 (\`docs/sprints/improvement-18-session-fuzzing.md\`) · tracking issue
[#303](https://github.com/aliceagent/kobisnake/issues/303) · ticket issue
[#313](https://github.com/aliceagent/kobisnake/issues/313)

\`tests/agent/monkey.js\` (KI-18-01, #311) fuzzes the game around the simulation: random keys, random
blur/focus/visibility/resize, at random simulated intervals, applied through the real listeners a person's
input reaches, with a stuck check and a check against the state machine's own table after every action.
\`tests/agent/shrink.js\` (KI-18-02, #312) turns a failing run into the shortest sequence that still fails.
This document is the first real campaign built on both: two thousand seeds, five hundred actions each, and
what they found.

**Findings are filed, not fixed** — this sprint's own rule, stated twice in its file. Nothing below was
changed to make a number look better.

## What actually ran

- **Command:** ${meta.command}
- **Date:** ${meta.date}. As with every other document in this family, this is the one line expected to
  change on a re-run — every number below comes from fixed seeds through a deterministic simulation
  (\`ARCHITECTURE §11\`), so regenerating this report should reproduce every other line byte for byte.
- **Wall time:** ~${meta.wallSeconds}s, summed across ${meta.batchCount} batched invocations. **Not**
  reproducible the way the numbers below are (a busier machine, a different container) — see \`meta.command\`
  for why it is batched at all: a single ~87-minute Playwright invocation would hold this container's suite
  lock long enough to make the other sessions sharing it wait out \`scripts/run-playwright-suite.mjs\`'s
  20-minute timeout and fail (\`tests/agent/README.md\`, \`CLAUDE.md\`'s "never run two Playwright suites at
  once").
- **Seeds run:** ${aggregated.seedsRun}, ${meta.actionsPerSeed} actions each — ${aggregated.actionsApplied}
  actions applied in total.
- **Simulated time:** ${aggregated.simSeconds.toFixed(1)}s advanced, plus ${aggregated.hiddenSeconds.toFixed(1)}s
  counted while a tab was hidden and therefore not advanced (\`monkey.js\`, "a hidden tab is not advanced").
- **Machine transitions recorded:** ${aggregated.transitionsRecorded}.

## The instrument's own sensitivity

Before reading the failure count below as an answer, read what the instrument itself is known to be able to
find: the sprint's QA plan deliberately removed the \`MATCH_OVER --QUIT_TO_MENU--> MAIN_MENU\` row from
\`gameStateMachine.js\` on a branch that was never merged, and ran the merged monkey against it. It was found
on **${CALIBRATION.seedsThatFoundIt} of ${CALIBRATION.seedsRun} seeds** (a ${((CALIBRATION.seedsThatFoundIt / CALIBRATION.seedsRun) * 100).toFixed(0)}%
hit rate), first at seed ${CALIBRATION.firstSeedThatFoundIt} — and a ${CALIBRATION.pilotSeeds}-seed pilot of
the identical branch found it **not at all**. That is the sensitivity this campaign's clean seeds inherit: a
low single-digit hit rate is enough to hide from a small run and still turn up in a large one, which is the
whole argument for running two thousand seeds rather than two hundred.

## State coverage

Reached (${stateCoverage.reached.length} of ${KNOWN_STATES.length}): ${reachedList}.

${stateCoverage.notReached.length === 0 ? 'Every state in the table was visited.' : notReachedLines}

### \`LASER_WARNING\`, measured rather than assumed

A round has to survive 60 simulated seconds for the warning to fire, and random steering usually kills a
snake in seconds (\`tests/sim/laserFuzz.test.js\`'s own opening line) — so this run measured it rather than
assuming either answer: reached on **${laserWarning.seedsThatReachedIt} of ${laserWarning.totalSeeds} seeds**
(${fmtPct(laserWarning.ratePct)}).

### \`REPLAY\` coverage is thinner than every other state's, and here is by how much

\`STATES_THAT_RENDER_UNASKED\` (\`monkey.js\`, tied to
[#317](https://github.com/aliceagent/kobisnake/issues/317)) means a run stops advancing simulated time on the
\`REPLAY\` screen once it has spent ${replayBudget.budgetSecondsPerSeed}s of simulated time there — the screen
is still entered, keys still land, and the way out is still fuzzed, but time does not keep passing on it once
a seed's budget is spent. ${replayBudget.seedsThatEnteredIt} of ${aggregated.seedsRun} seeds entered a state
on that list this run, spending ${replayBudget.expensiveSeconds.toFixed(1)}s of simulated time there in total
and declining to advance a further ${replayBudget.expensiveSkippedSeconds.toFixed(1)}s once their budgets were
spent. Coverage of \`REPLAY\` is real but shallower than every other state's until #317 lands, at which point
this list empties and nothing else has to change.

## Transition-row coverage

${aggregated.transitionCoverage.exercised.length} of ${TRANSITION_ROWS.length} rows in \`TRANSITIONS\` were
taken at least once.

${transitionNotExercisedSection}

## Failures

${failures.length} distinct failure(s), across ${aggregated.seedsWithAFailure} of ${aggregated.seedsRun}
seeds. Grouped per the ticket's own wording: several seeds hitting the same rule in the same state is one
finding, not one line per seed.

${failuresSection}

## Machine-readable data

The exact numbers above, one block. Regenerating this document from the same batches should reproduce this
block byte for byte (the date and wall time above are deliberately not included here, for the same reason
\`agent-run.md\` and \`round-pacing.md\` exclude them).

\`\`\`json
${jsonBlock}
\`\`\`
`;
}
