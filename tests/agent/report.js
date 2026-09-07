// @ts-check
import { END_REASONS, RESULTS } from '../../src/core/events.js';

/**
 * KI-03-04 — aggregates a run of `driver.js`'s `MatchResult[]` into the numbers a design lead actually uses
 * (rounds per match, match duration, draw rate, end-reason mix, how often the laser phase is reached, mean
 * and p90 round length) and renders them as the markdown document committed at
 * `docs/qa/playtests/agent-run.md`.
 *
 * **This module is Node-side only** (tech-lead ruling on #122, ruling 1). Unlike the driver, the policies and
 * the invariants module it reads, nothing here is ever shipped into the page as source text, so it carries
 * none of `driver.js`'s "no free variables" constraint and may import normally — `RESULTS`/`END_REASONS`
 * above are the real source of truth (`src/core/events.js`), not retyped string literals.
 *
 * Both entry points are pure functions of their arguments, with no I/O of their own:
 * {@link aggregateRun} takes a plain description of what ran — seeds, pairing labels, whether a pairing was
 * expected to finish, and the `MatchResult[]` the driver actually returned — and produces the numbers.
 * {@link renderReport} takes those numbers (plus a little more metadata: the date, the regenerating command,
 * the wall time) and produces the markdown text. Neither one reads a clock, a file, or an environment
 * variable, which is what makes both unit-testable against hand-built fixtures
 * (`tests/agent/report.test.js`) rather than only against a live browser run.
 */

/**
 * One pairing's raw material: what the generating script actually played.
 *
 * @typedef {object} PairingRun
 * @property {string} label - e.g. `"greedy vs greedy"`. Human-readable; also used to look up a historical
 *   reference figure in {@link REFERENCE_LASER_PHASE_RATES}, so keep it exactly one of the labels that
 *   constant's keys expect if a cross-check against F3/KI-03-02 is wanted for this pairing.
 * @property {number[]} seeds - the seeds this pairing was played on, quoted verbatim in the document (AC1).
 * @property {import('./driver.js').MatchResult[]} results
 * @property {boolean} expectFinish - `false` marks a pairing that is not expected to reach `MATCH_OVER` at
 *   all (idle vs idle, ruling 4: #119 F1 / I01, unimplemented) — `aggregatePairing` still computes every
 *   round-level number for it, but leaves the match-level numbers `null` rather than averaging over zero
 *   finished matches.
 * @property {number} [maxFrames] - the frame budget results were bounded to; only meaningful (and only
 *   rendered) when `expectFinish` is `false`, to say *why* nothing finished.
 * @property {string} [note] - free-text prose the renderer appends verbatim under this pairing's numbers.
 */

/**
 * @typedef {object} RoundLengthStats
 * @property {number} meanSeconds
 * @property {number} p90Seconds
 * @property {number} minSeconds
 * @property {number} maxSeconds
 */

/**
 * The aggregated numbers for one pairing. Every `*Pct` field is `null` only when its denominator (`rounds` or
 * `matchesFinished`) is zero — never a divide-by-zero `NaN` that would print as a numeric-looking lie.
 *
 * @typedef {object} PairingStats
 * @property {string} label
 * @property {number[]} seeds
 * @property {number} matches
 * @property {number} matchesFinished
 * @property {number} rounds
 * @property {number} p1Wins
 * @property {number} p2Wins
 * @property {number} draws
 * @property {number | null} drawRatePct
 * @property {number} deathCount
 * @property {number} timeoutCount
 * @property {number | null} deathRatePct
 * @property {number | null} timeoutRatePct
 * @property {number} laserPhaseReachedCount
 * @property {number | null} laserPhaseReachedRatePct
 * @property {RoundLengthStats | null} roundLength - `null` only when `rounds` is 0.
 * @property {number | null} meanRoundsPerMatch - `null` when `matchesFinished` is 0.
 * @property {number | null} meanMatchSeconds - simulated seconds (sum of a match's own round lengths), never
 *   wall-clock milliseconds (tech-lead ruling on #122, ruling 2: the reproducible quantity is preferred).
 * @property {number | null} p90MatchSeconds
 * @property {boolean} expectFinish
 * @property {number} [maxFrames]
 * @property {string} [note]
 */

/**
 * @typedef {object} RunMeta
 * @property {string} date - `YYYY-MM-DD`. The one field {@link renderReport} does not promise stays the same
 *   between two honest regenerations (ruling 2) — see the document's own "What actually ran" section.
 * @property {string} command - the exact command that regenerates this document (AC1).
 * @property {number} wallSeconds - real wall-clock seconds the generating run took. Reported because ruling
 *   6 asks for it, but it is exactly as reproducible as {@link RunMeta.date} — different on every run — and
 *   the document says so next to it rather than implying otherwise.
 */

/**
 * @typedef {object} AggregatedRun
 * @property {RunMeta} meta
 * @property {PairingStats[]} pairings
 */

/**
 * A simple nearest-rank percentile of a numeric array, `p` in `[0, 1]`. `null` for an empty array.
 *
 * Same convention `src/game/inputLatency.js`'s own (unexported) `percentileOfSorted` uses — a plain
 * `Math.floor(p * n)` index into the sorted array, clamped to the last element — reimplemented here rather
 * than imported because that helper is not itself exported. It is deliberately the simplest correct thing,
 * not a textbook percentile with interpolation: `tests/agent/report.test.js` pins its exact behaviour
 * against a hand-built list, which is what actually matters for reproducibility (ruling 1) — any consistent,
 * documented method reproduces identically given the same input, and this is the project's own.
 *
 * @param {number[]} values
 * @param {number} p
 * @returns {number | null}
 */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

/** @param {number[]} values @returns {number | null} */
function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** @param {number} count @param {number} total @returns {number | null} */
function pct(count, total) {
  if (total === 0) return null;
  return (count / total) * 100;
}

/**
 * Aggregates one pairing's raw matches into {@link PairingStats}.
 *
 * Round-level numbers (draw rate, end-reason mix, laser-phase rate, round length) are computed over **every**
 * round that actually completed, regardless of whether the match containing it ever reached `MATCH_OVER` —
 * a round that ends in a real `ROUND_OVER` happened, whether or not the series around it finished. Match-level
 * numbers (rounds per match, match duration) are computed only over matches that did finish, because "how
 * many rounds did an unfinished Best-of-3 play before its frame budget ran out" is not the same question as
 * "how many rounds does a Best-of-3 normally take" — ruling 4's idle-vs-idle pairing is exactly the case
 * this split exists for: it has real, reportable round-level numbers (every round a `DRAW`) and zero
 * finished matches to average a duration over.
 *
 * @param {PairingRun} pairingRun
 * @returns {PairingStats}
 */
export function aggregatePairing(pairingRun) {
  const { label, seeds, results, expectFinish, maxFrames, note } = pairingRun;

  const matches = results.length;
  const finished = results.filter((result) => result.finished);
  const matchesFinished = finished.length;

  const rounds = results.flatMap((result) => result.rounds);
  const roundCount = rounds.length;

  const p1Wins = rounds.filter((round) => round.result === RESULTS.P1_WIN).length;
  const p2Wins = rounds.filter((round) => round.result === RESULTS.P2_WIN).length;
  const draws = rounds.filter((round) => round.result === RESULTS.DRAW).length;
  const deathCount = rounds.filter((round) => round.endReason === END_REASONS.DEATH).length;
  const timeoutCount = rounds.filter((round) => round.endReason === END_REASONS.TIMEOUT).length;
  const laserPhaseReachedCount = rounds.filter((round) => round.reachedLaserPhase).length;

  const roundSeconds = rounds.map((round) => round.seconds);
  /** @type {RoundLengthStats | null} */
  const roundLength =
    roundCount === 0
      ? null
      : {
          meanSeconds: /** @type {number} */ (mean(roundSeconds)),
          p90Seconds: /** @type {number} */ (percentile(roundSeconds, 0.9)),
          minSeconds: Math.min(...roundSeconds),
          maxSeconds: Math.max(...roundSeconds),
        };

  const roundsPerMatchValues = finished.map((result) => result.rounds.length);
  const matchSecondsValues = finished.map((result) =>
    result.rounds.reduce((total, round) => total + round.seconds, 0),
  );

  return {
    label,
    seeds: [...seeds],
    matches,
    matchesFinished,
    rounds: roundCount,
    p1Wins,
    p2Wins,
    draws,
    drawRatePct: pct(draws, roundCount),
    deathCount,
    timeoutCount,
    deathRatePct: pct(deathCount, roundCount),
    timeoutRatePct: pct(timeoutCount, roundCount),
    laserPhaseReachedCount,
    laserPhaseReachedRatePct: pct(laserPhaseReachedCount, roundCount),
    roundLength,
    meanRoundsPerMatch: matchesFinished === 0 ? null : mean(roundsPerMatchValues),
    meanMatchSeconds: matchesFinished === 0 ? null : mean(matchSecondsValues),
    p90MatchSeconds: matchesFinished === 0 ? null : percentile(matchSecondsValues, 0.9),
    expectFinish,
    ...(maxFrames === undefined ? {} : { maxFrames }),
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * @param {{meta: RunMeta, pairings: PairingRun[]}} run
 * @returns {AggregatedRun}
 */
export function aggregateRun(run) {
  return {
    meta: { ...run.meta },
    pairings: run.pairings.map(aggregatePairing),
  };
}

/**
 * Historical laser-phase-reached figures this document is meant to stay comparable with (tech-lead ruling on
 * #122, ruling 3). Quoted, not re-derived — these are the numbers to check a fresh run *against*, so if this
 * run disagrees materially the right response is to go investigate the aggregation, not to edit these.
 *
 * `"greedy vs survivor"` is F3's own figure (`docs/qa/reports/2026-09-07-agent-qa-pass.md` §3: "4 of 27
 * rounds — 14.8 %"), from an unseeded scratch run predating this harness — a close match here corroborates
 * F3, but the seeds are not identical, so exact equality is not expected. `"greedy vs greedy"` and
 * `"survivor vs survivor"` are KI-03-02's own seeded 20-seed mirrored measurement
 * (`tests/agent/policies.spec.js` AC1) — the same seeds this document's generating script uses for those two
 * pairings, so those two should land close to exact.
 *
 * @type {Record<string, number>}
 */
export const REFERENCE_LASER_PHASE_RATES = Object.freeze({
  'greedy vs greedy': 12.0,
  'survivor vs survivor': 100.0,
  'greedy vs survivor': 14.8,
});

/** How many percentage points away from a reference figure still counts as "agrees" rather than "differs". */
const REFERENCE_AGREEMENT_TOLERANCE_POINTS = 5;

/**
 * A known, standing reason a pairing's rate is **expected** to differ materially from its reference figure —
 * printed alongside the mechanical flag so a real, investigated cause is not mistaken for an unexplained
 * discrepancy (tech-lead ruling on #122, ruling 3: "say so and investigate", not "force it to agree").
 *
 * `"greedy vs survivor"` is the one entry so far, and the investigation behind it: F3's own 14.8 % came from
 * an unseeded scratch run that predates this permanent layer's policies entirely — Improvement 03 (this
 * sprint) is what turned that scratch run into `tests/agent/policies/`. `survivor.js` (KI-03-02, its own
 * ruling 5) deliberately **excludes outright** every cell a living opponent's own head could reach on its
 * next step, where `tests/sim/bots/survivorBot.js` (the headless bot behind `gate1-bot-matrix.md`'s
 * comparable-sounding row) only *penalises* that cell in its score. That is a real, documented improvement in
 * collision avoidance, not a defect in this document's aggregation, and it predicts exactly the direction
 * seen: a survivor that dies less often to a head-on collision drags rounds on longer, so more of them cross
 * the laser-phase threshold. A materially higher rate here than F3's original figure is therefore the
 * expected outcome of that change, not by itself evidence of a bug — `gate1-bot-matrix.md`'s own 20.6-31.4 %
 * for the same nominal pairing name (a different, headless bot implementation, run at a much larger sample)
 * is the closer comparison, and still not the same measurement.
 *
 * @type {Record<string, string>}
 */
export const REFERENCE_CAVEATS = Object.freeze({
  'greedy vs survivor':
    "F3's own figure predates this permanent layer's policies (an unseeded scratch run, before Improvement " +
    '03 existed). `survivor.js` (KI-03-02, ruling 5) excludes outright every cell a living opponent\'s head ' +
    'could reach next, where `tests/sim/bots/survivorBot.js` (behind `gate1-bot-matrix.md`\'s own ' +
    '20.6-31.4% for this nominal pairing) only penalises it — a documented improvement in collision ' +
    'avoidance that predicts longer rounds and a higher laser-phase rate, not a bug in this aggregation.',
});

const fmtPct = (/** @type {number | null} */ value) => (value === null ? '—' : `${value.toFixed(1)}%`);
const fmtSeconds = (/** @type {number | null} */ value) => (value === null ? '—' : value.toFixed(1));

/**
 * One row of the match-level table.
 *
 * @param {PairingStats} stats
 * @returns {string}
 */
function matchLevelRow(stats) {
  return (
    `| ${stats.label} | ${stats.matches} | ${stats.matchesFinished}` +
    `${stats.expectFinish ? '' : ' *(did not finish — see below)*'} ` +
    `| ${fmtSeconds(stats.meanRoundsPerMatch)} | ${fmtSeconds(stats.meanMatchSeconds)} | ` +
    `${fmtSeconds(stats.p90MatchSeconds)} |`
  );
}

/**
 * One row of the round-level table.
 *
 * @param {PairingStats} stats
 * @returns {string}
 */
function roundLevelRow(stats) {
  const rl = stats.roundLength;
  return (
    `| ${stats.label} | ${stats.rounds} | ${stats.p1Wins}/${stats.p2Wins}/${stats.draws} | ` +
    `${fmtPct(stats.drawRatePct)} | ${fmtPct(stats.deathRatePct)} / ${fmtPct(stats.timeoutRatePct)} | ` +
    `${stats.laserPhaseReachedCount}/${stats.rounds} (${fmtPct(stats.laserPhaseReachedRatePct)}) | ` +
    `${rl === null ? '—' : fmtSeconds(rl.meanSeconds)} | ${rl === null ? '—' : fmtSeconds(rl.p90Seconds)} |`
  );
}

/**
 * A one-sentence comparison of this run's laser-phase rate for `stats` against
 * {@link REFERENCE_LASER_PHASE_RATES}, when that pairing has a reference figure. `null` when it does not
 * (there is no historical figure to check idle vs idle against, for instance).
 *
 * @param {PairingStats} stats
 * @returns {string | null}
 */
function referenceComparisonLine(stats) {
  const reference = REFERENCE_LASER_PHASE_RATES[stats.label];
  if (reference === undefined || stats.laserPhaseReachedRatePct === null) return null;
  const actual = stats.laserPhaseReachedRatePct;
  const diff = Math.abs(actual - reference);
  const verdict =
    diff <= REFERENCE_AGREEMENT_TOLERANCE_POINTS
      ? `agrees with it (within ${REFERENCE_AGREEMENT_TOLERANCE_POINTS} points)`
      : `**differs from it by ${diff.toFixed(1)} points** — worth checking the aggregation before trusting ` +
        'this document, per the tech-lead ruling on #122 (report real numbers; a disagreement is a signal ' +
        'to investigate, not to adjust)';
  const caveat = REFERENCE_CAVEATS[stats.label];
  return (
    `- **${stats.label}** reached the laser phase in ${fmtPct(actual)} of rounds here, against the ` +
    `reference figure of ${reference.toFixed(1)}% — this run ${verdict}.` +
    (caveat === undefined ? '' : ` ${caveat}`)
  );
}

/**
 * Renders {@link AggregatedRun} as the markdown document committed at
 * `docs/qa/playtests/agent-run.md`, in the style `docs/qa/playtests/gate1-bot-matrix.md` uses: a "What
 * actually ran" section naming the exact command and seeds, a "Read this before the numbers" section stating
 * what the figures are evidence *for* and what they are not a verdict *on*, the tables themselves, and a
 * machine-readable JSON block at the bottom for exact diffing between two regenerations.
 *
 * Pure: reads nothing but `run`. Every value that could differ between two honest regenerations on different
 * days or machines (the date, the wall time) is confined to the one paragraph that says so — nothing else in
 * the output depends on `Date.now()`, a hostname, or any other non-reproducible input.
 *
 * @param {AggregatedRun} run
 * @returns {string}
 */
export function renderReport(run) {
  const { meta, pairings } = run;
  const totalRounds = pairings.reduce((total, stats) => total + stats.rounds, 0);
  const totalMatches = pairings.reduce((total, stats) => total + stats.matches, 0);

  const seedLines = pairings
    .map((stats) => `  - **${stats.label}:** ${stats.seeds.join(', ')} (${stats.seeds.length} seeds)`)
    .join('\n');

  const matchTable = [
    '| Pairing | Matches | Matches finished | Mean rounds/match | Mean match duration (simulated s) | p90 match duration (s) |',
    '|---|---|---|---|---|---|',
    ...pairings.map(matchLevelRow),
  ].join('\n');

  const roundTable = [
    '| Pairing | Rounds | Result mix (P1/P2/Draw) | Draw rate | End reason (Death/Timeout) | Reached laser phase | Mean round length (s) | p90 round length (s) |',
    '|---|---|---|---|---|---|---|---|',
    ...pairings.map(roundLevelRow),
  ].join('\n');

  const unfinished = pairings.filter((stats) => !stats.expectFinish);
  const unfinishedSection =
    unfinished.length === 0
      ? ''
      : '\n## Pairings that do not finish\n\n' +
        unfinished
          .map(
            (stats) =>
              `### ${stats.label}\n\n` +
              `This pairing does not reach \`MATCH_OVER\` on this build — #119 F1: a match made entirely of ` +
              `draws never ends, because \`DESIGN-DECISIONS §1 row 26\`'s third-consecutive-draw rule is ` +
              `ruled but not yet implemented (I01/#120). Every seed above was bounded to ` +
              `${stats.maxFrames ?? '?'} frames so the run reports the defect instead of hanging on it, and ` +
              `every one of its ${stats.rounds} recorded rounds ended in a \`DRAW\` (see the round-level table ` +
              `above). ${stats.note ?? ''}`.trim() +
              '\n',
          )
          .join('\n');

  const comparisonLines = pairings
    .map(referenceComparisonLine)
    .filter((line) => line !== null);
  const comparisonSection =
    comparisonLines.length === 0
      ? ''
      : '\n## Reading it against F3 and KI-03-02\n\n' +
        comparisonLines.join('\n') +
        '\n\nF3 called a mechanic four sprints were spent on "absent from most of the game" on a 14.8% ' +
        'laser-phase rate for greedy vs survivor; this run is what makes that number re-measurable on demand ' +
        'rather than trusting a one-off scratch script (`tests/agent/README.md`, KI-03-04\'s own reason to ' +
        'exist).\n';

  const jsonBlock = JSON.stringify(
    {
      pairings: pairings.map((stats) => {
        // The command and date are `meta`, not per-pairing, and deliberately excluded from this block:
        // everything in here must be identical between two honest regenerations (ruling 2), and those two
        // fields are the only ones that are not.
        const { label, seeds, ...numbers } = stats;
        return { label, seeds, ...numbers };
      }),
    },
    null,
    2,
  );

  return `# Agent playtest statistics

KI-03-04 · tracking issue [#122](https://github.com/aliceagent/kobisnake/issues/122) · origin
[#119](https://github.com/aliceagent/kobisnake/issues/119) F3, F1

This is the committed, reproducible successor to the ten-match scratch run in the 2026-09-07 agent QA pass
(\`docs/qa/reports/2026-09-07-agent-qa-pass.md\` §3). That run found F3 — "only 4 of 27 rounds (14.8%) reached
the laser phase" — by hand, on an unseeded run nobody could replay. This document aggregates
\`tests/agent/driver.js\`'s real \`MatchResult[]\` from real seeded matches of the built site into the numbers a
design lead actually uses, exactly the way \`docs/qa/playtests/gate1-bot-matrix.md\` does for the tuning
matrix: it is a design instrument, not a pass/fail gate — nothing below is asserted against a threshold in
code, except that a pairing named as "does not finish" (idle vs idle) is expected not to, and every other
pairing is expected to.

## What actually ran

- **Command:** \`${meta.command}\`
- **Date:** ${meta.date}. **This is the one line expected to change if you regenerate this document on a
  different day** — every number below comes from fixed seeds through a deterministic simulation
  (\`ARCHITECTURE §11\`), so re-running the command above should reproduce every other line byte for byte.
  Treat any other line changing as a real discrepancy to investigate, not a maintenance chore to reconcile.
- **Wall time:** ~${meta.wallSeconds}s. Real wall-clock time, reported because it is a fair sense of "how long
  does this take to regenerate" — but it is **not** reproducible (a busier machine, a different render
  cadence, a different container all move it) the way the date above is not, and unlike every other number in
  this document, which is a simulated quantity computed from the deterministic seeds. Do not expect this
  figure to match on a re-run.
- **Total:** ${totalMatches} matches, ${totalRounds} rounds, across ${pairings.length} pairings.
- **Seeds, by pairing:**
${seedLines}
- **Render cadence.** \`driver.js\`'s header is explicit that skipping \`renderer.render()\` cannot affect
  simulation state — only real time it costs. This run reads only \`RoundRecord\`/\`MatchResult\` fields
  (never \`maxDrawCalls\`), so it renders far more sparsely than the driver's own default cadence, trading a
  render sample this document does not use for wall time it does; that choice changes wall-clock timing and
  nothing the simulation does.

## Read this before the numbers

1. **Bots die more cheaply than people.** Neither \`greedy\` nor \`survivor\` fears death the way a person
   playing for the first time does — a bot never hesitates, never mistimes a turn out of nerves, never look
   away from the screen. Every death-related rate below (draw rate, end-reason mix, how often a round ends
   before the laser phase) over-states how often a *player* would die early, in the same direction and for
   the same reason the 2026-09-07 QA pass's F3 already flagged.
2. **Neither policy adapts to Speed Boost.** Exactly the caveat \`gate1-bot-matrix.md\` makes: a bot that
   collects Speed Boost does not replan, does not get more careful, does not practice controlling the faster
   snake. Nothing here can show what a human player does differently under it.
3. **This sample is far smaller than \`tests/sim\`'s.** That layer runs 500 seeded rounds per cell headlessly,
   in milliseconds. This layer plays every round in a real Chromium, through the real \`keydown\` listener and
   the real state machine — the point of the layer (\`tests/agent/README.md\`), and also why the seed counts
   above are tens, not hundreds. Treat single-digit percentage differences between pairings, or between this
   run and a past one, with the caution that sample size implies.
4. **The rendering cadence changes wall-clock timing and nothing else.** \`driver.js\`'s own header is explicit
   that \`__kobi.advance\` drives the same \`session.runUpdate\` a rendered frame does — simulation, input and
   the HUD run on every driven frame regardless of whether that frame is also rendered. Every number in this
   document is a property of the simulation, never of how often it was drawn.
5. **This does not judge whether the game is fun.** That is Gate 1 (KS-07-02) and no agent can report it —
   this document is evidence for a design lead to weigh, not a verdict on any of it.

## Match-level statistics

${matchTable}

## Round-level statistics

${roundTable}
${unfinishedSection}${comparisonSection}
## Machine-readable data

The exact numbers tabulated above, one object per pairing. Everything here is a pure function of the seeds
named above and the deterministic simulation they drive — regenerating this document should reproduce this
block byte for byte (the date and wall time above are deliberately not included here, for exactly that
reason).

\`\`\`json
${jsonBlock}
\`\`\`
`;
}
