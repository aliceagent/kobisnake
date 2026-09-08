// @ts-check
import { END_REASONS, RESULTS } from '../../src/core/events.js';
import { SETTINGS } from '../../src/core/settings.js';
import { FRAME_SECONDS } from './driver.js';
import { percentile } from './report.js';

/**
 * KI-04-01 — aggregates a swept run of `driver.js`'s `MatchResult[]` into the shape of a round, and renders
 * it as the markdown document committed at `docs/qa/playtests/round-pacing.md`.
 *
 * This is `report.js`'s sibling, not its replacement. `report.js` answers "what does a match look like on the
 * shipping numbers"; this answers I04's question, which is a different one:
 *
 * > On the shipping numbers, what fraction of rounds reach the laser warning, and which single lever moves
 * > that fraction most without making a round drag?
 *
 * So the unit here is a **cell** — one pairing at one `(laserStartTime, roundDuration)` — rather than a
 * pairing, and the two figures every cell must carry are the two moments the climax exists at all: the round
 * reached the warning, and the round reached laser inset ≥ 3 (AC2).
 *
 * ## Three things this module deliberately does not do
 *
 * 1. **It never edits `src/core/settings.js`.** Every swept value travels as a `withOverrides()`-shaped tree
 *    through `driver.playMatch`'s `settingsOverrides` option into `session.js`, which is where
 *    `withOverrides()` is actually called. The sprint file's "**never** by editing `settings.js`" and
 *    `CLAUDE.md`'s never list are the same rule; {@link combinationsFor} yields a list of hypotheticals, and
 *    the one cell that is not a hypothetical is the baseline — a hypothetical that happens to equal what
 *    ships.
 * 2. **It does not judge whether the game is fun, or decide anything.** KI-04-02 is the design lead's ruling
 *    and this document is its evidence. Nothing below is asserted against a design threshold in code.
 * 3. **It does not re-run the browser.** Like `report.js` this half is pure Node — no clock, no file, no
 *    environment variable — so it is unit-testable against hand-built fixtures (`tests/agent/pacing.test.js`)
 *    rather than only against a live run.
 *
 * ## Why the baseline cell is special
 *
 * `laserStartTime` 30 / `roundDuration` 90 **is** `SETTINGS`, so a baseline cell restricted to
 * `docs/qa/playtests/agent-run.md`'s own seeds must reproduce that document *exactly* — same seeds, same
 * driver, same policies, same deterministic simulation, and an override tree that changes nothing. That is
 * the strongest self-check this document has, and {@link reconcileBaseline} performs it as a first-class
 * output rather than as prose. It is also why the sweep reuses `driver.js`'s match loop instead of writing a
 * second one: two loops that merely resemble each other would make the comparison meaningless.
 */

/** @typedef {import('./driver.js').MatchResult} MatchResult */
/** @typedef {import('./driver.js').RoundRecord} RoundRecord */

/**
 * The three pairings I04 asks for, in the order the document lists them.
 *
 * **`idle vs idle` is deliberately absent.** It carries no pacing signal — two players who press nothing draw
 * at a fixed tick every round and never reach a laser at any setting, so every cell of a swept matrix would
 * report the same three numbers — and the #119 F1 regression cover it exists for already lives in
 * `agent-run.md` and `policies.spec.js`, where it stays. Sweeping it would spend a quarter of the run's wall
 * clock re-deriving a constant.
 *
 * @type {readonly string[]}
 */
export const PAIRINGS = Object.freeze([
  'greedy vs greedy',
  'survivor vs survivor',
  'greedy vs survivor',
]);

/** The `laserStartTime` values I04's ticket names, in seconds remaining. The last is the shipping default. */
export const LASER_START_TIMES = Object.freeze([20, 25, 30]);

/**
 * Two **earlier** laser starts, run as a declared extension to the ticket's grid at the shipping
 * `roundDuration`.
 *
 * `laserStartTime` is measured in seconds *remaining*, so a **larger** number is an **earlier** warning: 30 is
 * 60 s into a 90 s round, and 20 is 70 s into it. The ticket's own three values (20/25/30) are therefore the
 * shipping start and two *later* ones — and the sprint file's lever table says the opposite of what that
 * measures ("Earlier lasers reach more rounds"). Swept only downward, this lever can do just one thing to the
 * climax fraction, which would let the matrix answer "which single lever moves it most" by default rather
 * than on the evidence.
 *
 * So these cells exist to bound the lever from the other side, and `gate1-bot-matrix.md` already establishes
 * 35 as a value worth asking about (its own variants are 25/30/35). They are labelled as an extension
 * everywhere they appear, and the ticket's 3×3 grid is reported intact and unchanged beside them — the point
 * is to add the missing direction, never to quietly redefine what was asked for.
 *
 * **35 and 40 were run by KI-04-01; 45 and 50 were added by KI-04-03** on the design lead's ruling (#229,
 * `DESIGN-DECISIONS §1` row 30): with only two points the arm is "a line, not a curve", and the lever has to
 * be measured far enough to see where it turns over. It must turn: `laserStartTime` cannot usefully approach
 * `roundDuration`, because a warning at 50 s remaining leaves only 40 s of open board before the arena starts
 * closing, and the round has to be worth playing before the climax as well as during it.
 */
export const EARLIER_LASER_START_TIMES = Object.freeze([35, 40, 45, 50]);

/** The `roundDuration` values I04 sweeps, in simulated seconds. The last is the shipping default. */
export const ROUND_DURATIONS = Object.freeze([60, 75, 90]);

/**
 * The laser inset AC2 names as the second moment the climax exists ("reached inset ≥ 3").
 *
 * At `laserMinArena` 6 on a 24-cell arena the lasers take nine steps in all, so inset 3 is a third of the way
 * in: the board is 18×18, visibly closed, and both snakes are being pushed together. Reaching the *warning*
 * only says the beams lit; reaching inset 3 says the round was still alive long enough for them to matter.
 */
export const CLIMAX_INSET = 3;

/**
 * How many steps the lasers can ever take on the shipping arena — `⌈(24 − 6) / 2⌉` = 9
 * (`src/core/lasers.js`'s `maxStepCount`). Derived here rather than hard-coded so the per-inset histogram
 * covers exactly the reachable range, and recomputed from `SETTINGS` so a future arena change moves it.
 */
export const MAX_LASER_INSET = Math.ceil((SETTINGS.grid.width - SETTINGS.laserMinArena) / 2);

/**
 * The 20 seeds `docs/qa/playtests/agent-run.md` and `tests/agent/policies.spec.js` both use, verbatim and in
 * order. Every cell's seed list **starts** with these, so the baseline cell restricted to this prefix is
 * literally the same set of matches `agent-run.md` played — which is what makes {@link reconcileBaseline} an
 * exact comparison rather than an approximate one.
 *
 * Copied as a literal for the reason `report.spec.js` gives for copying them: importing a `.spec.js` file
 * would re-register that file's own tests against this run.
 */
export const AGENT_RUN_SEEDS = Object.freeze([
  1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584, 4181, 6765, 10946,
]);

/**
 * Where this document's *additional* seeds start.
 *
 * Chosen to sit clear of every other committed instrument's range, the way `gate1-bot-matrix.md`'s own header
 * keeps its 300 000+ seeds clear of `stats.test.js` (10 000–40 000), `laserStats.test.js` (110 000–130 000)
 * and `powerupStats.test.js` (210 000+): a figure here that differs slightly from one quoted elsewhere is
 * then plainly sampling noise from a different seed range rather than a contradiction to chase.
 */
export const PACING_SEED_BASE = 500_000;

/**
 * The seed list every cell plays: {@link AGENT_RUN_SEEDS} followed by `PACING_SEED_BASE + 1 …`.
 *
 * **Why the count matters.** A Best-of-3 is first-to-two, so a match plays at least two rounds; `count` seeds
 * therefore guarantee **at least `2 × count` rounds** in every cell no matter how the sweep changes the
 * shape of a round. That is how "at least 300 seeded rounds per cell" is met by construction rather than
 * checked afterwards and hoped for — the run cannot quietly under-sample a cell that turns out to be short.
 *
 * @param {number} count
 * @returns {number[]}
 */
export function pacingSeeds(count) {
  const seeds = AGENT_RUN_SEEDS.slice(0, count);
  for (let i = seeds.length; i < count; i += 1)
    seeds.push(PACING_SEED_BASE + (i - AGENT_RUN_SEEDS.length) + 1);
  return seeds;
}

/**
 * The shipping pair, and this sweep's origin: every other combination is one or two steps away from it.
 */
export const BASELINE_COMBINATION = Object.freeze({
  laserStartTime: SETTINGS.laserStartTime,
  roundDuration: SETTINGS.roundDuration,
});

/**
 * @typedef {object} Combination
 * @property {number} laserStartTime
 * @property {number} roundDuration
 */

/**
 * @typedef {'grid' | 'cross'} SweepShape
 */

/**
 * The combinations a given shape runs, baseline first — so the reconciliation cell is played before anything
 * depends on it — then the rest in a fixed order, because a run's cell order must not depend on an iteration
 * accident.
 *
 * - **`grid`** is the full cross-product of {@link LASER_START_TIMES} and {@link ROUND_DURATIONS}: 9
 *   combinations, 27 cells across three pairings. What the ticket asks for when it fits the budget.
 * - **`cross`** is the 5 combinations that change **one** lever at a time from {@link BASELINE_COMBINATION}.
 *   This is the reduction the sprint's budget rule allows ("reduce the cell count and say which cells were
 *   dropped and why, rather than quietly shrinking rounds per cell"), and it is principled rather than
 *   arbitrary: I04 asks which **single** lever moves the climax most, and a one-at-a-time sweep answers
 *   exactly that question. What it gives up is the four interaction cells — whether a 20 s laser start
 *   inside a 60 s round does something neither change does alone. {@link droppedCellLines} says so in the
 *   document rather than leaving it as an omission.
 *
 * @param {SweepShape} shape
 * @returns {Combination[]}
 */
export function combinationsFor(shape) {
  /** @type {Combination[]} */
  const all = [];
  for (const roundDuration of [...ROUND_DURATIONS].reverse()) {
    for (const laserStartTime of [...LASER_START_TIMES].reverse()) {
      all.push({ laserStartTime, roundDuration });
    }
  }
  const kept =
    shape === 'grid'
      ? all
      : all.filter(
          (combination) =>
            combination.laserStartTime === BASELINE_COMBINATION.laserStartTime ||
            combination.roundDuration === BASELINE_COMBINATION.roundDuration,
        );
  // The earlier-start extension rides along with both shapes: it is two cells per pairing and it is the only
  // measurement in the document that can show this lever helping at all (see EARLIER_LASER_START_TIMES).
  return [
    ...kept,
    ...EARLIER_LASER_START_TIMES.map((laserStartTime) => ({
      laserStartTime,
      roundDuration: BASELINE_COMBINATION.roundDuration,
    })),
  ];
}

/**
 * The "why is this cell missing" lines {@link SweepMeta.droppedCells} carries for a shape that is not the
 * full grid. Empty for `grid`, which drops nothing.
 *
 * @param {SweepShape} shape
 * @param {string} reason - the budget sentence, written by whoever decided to reduce the sweep.
 * @returns {string[]}
 */
export function droppedCellLines(shape, reason) {
  if (shape === 'grid') return [];
  const kept = combinationsFor(shape);
  const dropped = combinationsFor('grid')
    .filter((c) => !EARLIER_LASER_START_TIMES.includes(c.laserStartTime))
    .filter(
      (combination) =>
        !kept.some(
          (keep) =>
            keep.laserStartTime === combination.laserStartTime &&
            keep.roundDuration === combination.roundDuration,
        ),
    );
  return [
    reason,
    `Dropped, for all ${PAIRINGS.length} pairings (${dropped.length * PAIRINGS.length} cells): ` +
      dropped.map((c) => `laser ${c.laserStartTime}s / round ${c.roundDuration}s`).join(', ') +
      '. Every dropped combination changes **both** levers at once, so what is lost is the interaction ' +
      'between them — whether two changes together do something neither does alone — and not the answer to ' +
      "I04's own question, which asks for the single lever that moves the climax most. Rounds per cell were " +
      'held at the ticket floor; no cell was under-sampled to make the grid fit.',
  ];
}

/**
 * One cell's raw material: what the generating spec actually played.
 *
 * @typedef {object} CellRun
 * @property {string} pairing - one of {@link PAIRINGS}.
 * @property {number} laserStartTime - the swept value, seconds remaining.
 * @property {number} roundDuration - the swept value, simulated seconds.
 * @property {number[]} seeds
 * @property {MatchResult[]} results
 */

/**
 * One cell's numbers.
 *
 * @typedef {object} CellStats
 * @property {string} pairing
 * @property {number} laserStartTime
 * @property {number} roundDuration
 * @property {boolean} isBaseline - this cell is the shipping pair, so it is the reconciliation target.
 * @property {boolean} isEarlierStartExtension - this cell is one of {@link EARLIER_LASER_START_TIMES}, i.e.
 *   the declared extension beyond the ticket's own grid rather than a cell the ticket asked for.
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
 * @property {number} reachedWarningCount
 * @property {number | null} reachedWarningRatePct
 * @property {number} reachedClimaxInsetCount - rounds with `maxLaserInset >= ` {@link CLIMAX_INSET}.
 * @property {number | null} reachedClimaxInsetRatePct
 * @property {(number | null)[]} reachedInsetAtLeastRatePct - index `k` is the percentage of rounds that
 *   reached inset ≥ `k`, for `k` from 0 to {@link MAX_LASER_INSET}. Index 0 is always 100 %.
 * @property {RoundLength | null} roundLength
 * @property {MatchWallClock | null} matchWallClock
 */

/**
 * @typedef {object} RoundLength
 * @property {number} medianSeconds
 * @property {number} p90Seconds
 * @property {number} meanSeconds
 * @property {number} minSeconds
 * @property {number} maxSeconds
 */

/**
 * How long a whole match takes **including the countdown, the crash slow-mo beat and the scoreboard** — the
 * ticket's own "how long a whole match takes wall-clock including countdown and scoreboard".
 *
 * Measured, not reconstructed: `MatchResult.frames` is every frame the driver drove from `startMatch` to
 * `MATCH_OVER`, each worth exactly {@link FRAME_SECONDS}, so `frames × FRAME_SECONDS` is the wall time a
 * player at 60 fps would have sat through. Adding up round lengths (what `report.js`'s `meanMatchSeconds`
 * does, for its own different question) would miss all three beats — 3.2 s of countdown per round, up to
 * 0.6 s of slow-mo, and 2.5 s of scoreboard between rounds — and those beats are a third of a short match.
 *
 * @typedef {object} MatchWallClock
 * @property {number} medianSeconds
 * @property {number} p90Seconds
 * @property {number} meanSeconds
 */

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
 * Aggregates one cell's raw matches into {@link CellStats}.
 *
 * The round-level/match-level split is `report.js`'s, for its reason: a round that reached a real
 * `ROUND_OVER` happened whether or not the series around it finished, but "how many rounds did an unfinished
 * Best-of-3 play before its budget ran out" is not the question "how long does a match take" asks. So every
 * round counts towards the round-level figures and only finished matches count towards the wall clock.
 *
 * @param {CellRun} cellRun
 * @returns {CellStats}
 */
export function aggregateCell(cellRun) {
  const { pairing, laserStartTime, roundDuration, results } = cellRun;

  const finished = results.filter((result) => result.finished);
  const rounds = results.flatMap((result) => result.rounds);
  const roundCount = rounds.length;

  const draws = rounds.filter((round) => round.result === RESULTS.DRAW).length;
  const deathCount = rounds.filter((round) => round.endReason === END_REASONS.DEATH).length;
  const timeoutCount = rounds.filter((round) => round.endReason === END_REASONS.TIMEOUT).length;
  const reachedWarningCount = rounds.filter((round) => round.reachedLaserPhase).length;
  const reachedClimaxInsetCount = rounds.filter(
    (round) => round.maxLaserInset >= CLIMAX_INSET,
  ).length;

  const reachedInsetAtLeastRatePct = [];
  for (let inset = 0; inset <= MAX_LASER_INSET; inset += 1) {
    reachedInsetAtLeastRatePct.push(
      pct(rounds.filter((round) => round.maxLaserInset >= inset).length, roundCount),
    );
  }

  const roundSeconds = rounds.map((round) => round.seconds);
  const matchSeconds = finished.map((result) => result.frames * FRAME_SECONDS);

  return {
    pairing,
    laserStartTime,
    roundDuration,
    isBaseline:
      laserStartTime === SETTINGS.laserStartTime && roundDuration === SETTINGS.roundDuration,
    isEarlierStartExtension: EARLIER_LASER_START_TIMES.includes(laserStartTime),
    matches: results.length,
    matchesFinished: finished.length,
    rounds: roundCount,
    p1Wins: rounds.filter((round) => round.result === RESULTS.P1_WIN).length,
    p2Wins: rounds.filter((round) => round.result === RESULTS.P2_WIN).length,
    draws,
    drawRatePct: pct(draws, roundCount),
    deathCount,
    timeoutCount,
    deathRatePct: pct(deathCount, roundCount),
    timeoutRatePct: pct(timeoutCount, roundCount),
    reachedWarningCount,
    reachedWarningRatePct: pct(reachedWarningCount, roundCount),
    reachedClimaxInsetCount,
    reachedClimaxInsetRatePct: pct(reachedClimaxInsetCount, roundCount),
    reachedInsetAtLeastRatePct,
    roundLength:
      roundCount === 0
        ? null
        : {
            medianSeconds: /** @type {number} */ (percentile(roundSeconds, 0.5)),
            p90Seconds: /** @type {number} */ (percentile(roundSeconds, 0.9)),
            meanSeconds: /** @type {number} */ (mean(roundSeconds)),
            minSeconds: Math.min(...roundSeconds),
            maxSeconds: Math.max(...roundSeconds),
          },
    matchWallClock:
      matchSeconds.length === 0
        ? null
        : {
            medianSeconds: /** @type {number} */ (percentile(matchSeconds, 0.5)),
            p90Seconds: /** @type {number} */ (percentile(matchSeconds, 0.9)),
            meanSeconds: /** @type {number} */ (mean(matchSeconds)),
          },
  };
}

/**
 * `docs/qa/playtests/agent-run.md`'s own committed figures for the three pairings this document sweeps,
 * transcribed from that document's machine-readable block.
 *
 * These are the numbers the baseline cell must **reproduce exactly**, not approximately: same seeds, same
 * driver, same policies, same deterministic simulation, and an override tree whose values equal `SETTINGS`.
 * A mismatch is a defect in one of the two instruments — most likely this one's plumbing of
 * `settingsOverrides` — and the honest response is to go and find it, never to widen a tolerance.
 *
 * `seedCount` differs per pairing because `agent-run.md`'s own seed lists do: it played 20 seeds of each
 * mirrored pairing and 10 of greedy vs survivor.
 *
 * @type {Readonly<Record<string, {seedCount: number, rounds: number, reachedWarningCount: number, draws: number, timeoutCount: number, meanRoundSeconds: number, p90RoundSeconds: number}>>}
 */
export const AGENT_RUN_REFERENCE = Object.freeze({
  'greedy vs greedy': {
    seedCount: 20,
    rounds: 50,
    reachedWarningCount: 6,
    draws: 0,
    timeoutCount: 0,
    meanRoundSeconds: 33.37083333333333,
    p90RoundSeconds: 59.266666666666666,
  },
  'survivor vs survivor': {
    seedCount: 20,
    rounds: 49,
    reachedWarningCount: 49,
    draws: 0,
    timeoutCount: 0,
    meanRoundSeconds: 81.29455782312927,
    p90RoundSeconds: 85.33333333333333,
  },
  'greedy vs survivor': {
    seedCount: 10,
    rounds: 23,
    reachedWarningCount: 11,
    draws: 0,
    timeoutCount: 0,
    meanRoundSeconds: 47.12355072463768,
    p90RoundSeconds: 75,
  },
});

/**
 * How close two floating-point second counts must be to count as the same number. Both sides are sums and
 * means of exact `tick / simHz` quantities computed by the same code, so the only difference a correct run
 * can produce is float association order.
 */
const EXACT_SECONDS_EPSILON = 1e-9;

/**
 * @typedef {object} ReconciliationRow
 * @property {string} pairing
 * @property {number} seedCount - how many of the cell's seeds were compared (the `agent-run.md` prefix).
 * @property {boolean} agrees
 * @property {{rounds: number, reachedWarningCount: number, draws: number, timeoutCount: number, meanRoundSeconds: number, p90RoundSeconds: number}} expected
 * @property {{rounds: number, reachedWarningCount: number, draws: number, timeoutCount: number, meanRoundSeconds: number | null, p90RoundSeconds: number | null}} actual
 * @property {string[]} differences - one line per field that did not match; empty when `agrees`.
 */

/**
 * Recomputes the baseline cell over exactly the seeds `agent-run.md` used and compares, field by field.
 *
 * Restricting by seed is sound because every match is independent: `playMatch` reloads the page and fixes the
 * seed through `?seed=N`, so a match's result cannot depend on which other seeds were in the list with it.
 * The prefix of this document's seed list therefore *is* `agent-run.md`'s run.
 *
 * @param {CellRun[]} cellRuns - every cell of the sweep; the baseline cells are picked out here.
 * @returns {ReconciliationRow[]}
 */
export function reconcileBaseline(cellRuns) {
  /** @type {ReconciliationRow[]} */
  const rows = [];
  for (const pairing of PAIRINGS) {
    const reference = AGENT_RUN_REFERENCE[pairing];
    if (reference === undefined) continue;
    const baseline = cellRuns.find(
      (cell) =>
        cell.pairing === pairing &&
        cell.laserStartTime === SETTINGS.laserStartTime &&
        cell.roundDuration === SETTINGS.roundDuration,
    );
    if (baseline === undefined) continue;

    const compared = AGENT_RUN_SEEDS.slice(0, reference.seedCount);
    const results = baseline.results.filter((result) => compared.includes(result.seed));
    // A cell that does not contain every reference seed cannot be compared with `agent-run.md` at all — a
    // short probe run is the case this exists for. Producing a row anyway would manufacture a "differs"
    // verdict out of a smaller sample, which is worse than producing no row: it would read as a real
    // disagreement between two instruments when it is only a difference in how much was played.
    if (results.length !== compared.length) continue;
    const rounds = results.flatMap((result) => result.rounds);
    const roundSeconds = rounds.map((round) => round.seconds);

    const actual = {
      rounds: rounds.length,
      reachedWarningCount: rounds.filter((round) => round.reachedLaserPhase).length,
      draws: rounds.filter((round) => round.result === RESULTS.DRAW).length,
      timeoutCount: rounds.filter((round) => round.endReason === END_REASONS.TIMEOUT).length,
      meanRoundSeconds: mean(roundSeconds),
      p90RoundSeconds: percentile(roundSeconds, 0.9),
    };

    /** @type {string[]} */
    const differences = [];
    /** @param {string} field @param {number} want @param {number | null} got */
    const compare = (field, want, got) => {
      const same = got !== null && Math.abs(got - want) <= EXACT_SECONDS_EPSILON;
      if (!same)
        differences.push(`${field}: agent-run.md ${want}, this run ${got === null ? '—' : got}`);
    };
    compare('rounds', reference.rounds, actual.rounds);
    compare('reachedWarningCount', reference.reachedWarningCount, actual.reachedWarningCount);
    compare('draws', reference.draws, actual.draws);
    compare('timeoutCount', reference.timeoutCount, actual.timeoutCount);
    compare('meanRoundSeconds', reference.meanRoundSeconds, actual.meanRoundSeconds);
    compare('p90RoundSeconds', reference.p90RoundSeconds, actual.p90RoundSeconds);

    rows.push({
      pairing,
      seedCount: reference.seedCount,
      agrees: differences.length === 0,
      expected: {
        rounds: reference.rounds,
        reachedWarningCount: reference.reachedWarningCount,
        draws: reference.draws,
        timeoutCount: reference.timeoutCount,
        meanRoundSeconds: reference.meanRoundSeconds,
        p90RoundSeconds: reference.p90RoundSeconds,
      },
      actual,
      differences,
    });
  }
  return rows;
}

/**
 * @typedef {object} SweepMeta
 * @property {string} date
 * @property {string} command
 * @property {number} wallSeconds
 * @property {number} seedsPerCell
 * @property {number} renderEveryNFrames
 * @property {string[]} droppedCells - human-readable "this combination was not run, and why" lines. Empty
 *   when the full grid ran. The sprint's own budget rule: reduce the cell count and say which, never shrink
 *   rounds per cell quietly.
 */

/**
 * @typedef {object} AggregatedSweep
 * @property {SweepMeta} meta
 * @property {CellStats[]} cells
 * @property {ReconciliationRow[]} reconciliation
 */

/**
 * @param {{meta: SweepMeta, cells: CellRun[]}} run
 * @returns {AggregatedSweep}
 */
export function aggregateSweep(run) {
  return {
    meta: { ...run.meta },
    cells: run.cells.map(aggregateCell),
    reconciliation: reconcileBaseline(run.cells),
  };
}

/** `[35, 40, 45, 50]` → `"35, 40, 45 and 50"`. Prose, not data — the JSON block carries the values themselves. */
const listOf = (/** @type {readonly number[]} */ values) =>
  values.length < 2
    ? String(values[0] ?? '')
    : `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;

const fmtPct = (/** @type {number | null} */ value) =>
  value === null ? '—' : `${value.toFixed(1)}%`;
const fmtSeconds = (/** @type {number | null} */ value) =>
  value === null ? '—' : value.toFixed(1);

/**
 * One row of a pairing's cell table.
 *
 * @param {CellStats} cell
 * @returns {string}
 */
function cellRow(cell) {
  const length = cell.roundLength;
  const wall = cell.matchWallClock;
  const label =
    `laser ${cell.laserStartTime}s / round ${cell.roundDuration}s` +
    (cell.isBaseline ? ' **(baseline = shipping)**' : '') +
    (cell.isEarlierStartExtension ? ' *(extension: earlier start)*' : '');
  return (
    `| ${label} | ${cell.rounds} | ${fmtSeconds(length?.medianSeconds ?? null)} | ` +
    `${fmtSeconds(length?.p90Seconds ?? null)} | ${fmtPct(cell.reachedWarningRatePct)} | ` +
    `${fmtPct(cell.reachedClimaxInsetRatePct)} | ${fmtPct(cell.timeoutRatePct)} | ` +
    `${fmtPct(cell.drawRatePct)} | ${fmtSeconds(wall?.medianSeconds ?? null)} | ` +
    `${fmtSeconds(wall?.p90Seconds ?? null)} |`
  );
}

/**
 * The per-inset table for one pairing: how deep the lasers actually got, cell by cell. AC2 asks for inset ≥ 3
 * by name and the sprint spec asks for "the fraction reaching each laser inset"; this is the second.
 *
 * @param {CellStats[]} cells
 * @returns {string}
 */
function insetTable(cells) {
  const header = ['| Cell'];
  for (let inset = 1; inset <= MAX_LASER_INSET; inset += 1) header.push(`≥ ${inset}`);
  return [
    `${header.join(' | ')} |`,
    `|${'---|'.repeat(header.length)}`,
    ...cells.map((cell) => {
      const cols = [`| laser ${cell.laserStartTime}s / round ${cell.roundDuration}s`];
      for (let inset = 1; inset <= MAX_LASER_INSET; inset += 1) {
        cols.push(fmtPct(cell.reachedInsetAtLeastRatePct[inset] ?? null));
      }
      return `${cols.join(' | ')} |`;
    }),
  ].join('\n');
}

/**
 * The earlier-start arm, read back as a sentence per pairing.
 *
 * KI-04-03 ran 45 and 50 s to find where the lever turns over — the ruling's own reason for extending it.
 * Whether it *does* turn over inside the measured range is a property of the numbers, so this is computed
 * from them rather than asserted in prose that a later regeneration could silently outlive. It reports the
 * warning rate at each value, whether the rate is still climbing at the top of the range, and what the round
 * length did while it climbed — because a lever that raises the climax without lengthening the round is
 * doing something different from one that merely stretches the round out.
 *
 * @param {CellStats[]} cells
 * @returns {string}
 */
function earlierStartReading(cells) {
  const lines = [];
  for (const pairing of PAIRINGS) {
    const arm = cells
      .filter(
        (cell) =>
          cell.pairing === pairing &&
          cell.roundDuration === SETTINGS.roundDuration &&
          cell.laserStartTime >= SETTINGS.laserStartTime,
      )
      .sort((a, b) => a.laserStartTime - b.laserStartTime);
    if (arm.length < 2) continue;

    const rate = (/** @type {CellStats} */ cell) => cell.reachedWarningRatePct ?? 0;
    const first = arm[0];
    const last = arm[arm.length - 1];
    const rising = arm.every((cell, i) => i === 0 || rate(cell) >= rate(arm[i - 1]));
    const saturated = rate(first) >= 99.9;

    const trail = arm
      .map((cell) => `${cell.laserStartTime} s → ${fmtPct(cell.reachedWarningRatePct)}`)
      .join(', ');

    const medianFirst = first.roundLength?.medianSeconds ?? null;
    const medianLast = last.roundLength?.medianSeconds ?? null;
    const roundNote =
      medianFirst === null || medianLast === null
        ? ''
        : ` Median round over the same span: ${fmtSeconds(medianFirst)} s → ${fmtSeconds(medianLast)} s.`;

    const verdict = saturated
      ? 'Already at the ceiling at the shipping value, so this arm says nothing about the warning rate here — read the match wall-clock column instead.'
      : rising
        ? `**Still climbing at ${last.laserStartTime} s** — the lever does not turn over anywhere in the measured range.`
        : `Turns over inside the range: the rate stops climbing before ${last.laserStartTime} s.`;

    lines.push(`- **${pairing}:** ${trail}. ${verdict}${roundNote}`);
  }
  return lines.join('\n');
}

/**
 * @param {ReconciliationRow} row
 * @returns {string}
 */
function reconciliationRow(row) {
  const verdict = row.agrees
    ? '**matches to the number**'
    : `**differs** — ${row.differences.join('; ')}`;
  return (
    `| ${row.pairing} | ${row.seedCount} | ${row.expected.rounds} / ${row.actual.rounds} | ` +
    `${row.expected.reachedWarningCount} / ${row.actual.reachedWarningCount} | ` +
    `${fmtSeconds(row.expected.meanRoundSeconds)} / ${fmtSeconds(row.actual.meanRoundSeconds)} | ` +
    `${verdict} |`
  );
}

/**
 * Renders {@link AggregatedSweep} as the markdown document committed at
 * `docs/qa/playtests/round-pacing.md`, in the shape `docs/qa/playtests/agent-run.md` uses: the exact command
 * and seeds, a "read this before the numbers" section that says what the figures are evidence *for*, the
 * tables, and a machine-readable block at the bottom that `tests/agent/pacing.test.js` diffs against.
 *
 * Pure, and reproducible in the same sense `renderReport` is: the date and the wall time are the only two
 * lines that may differ between two honest regenerations, and neither of them reaches the JSON block.
 *
 * @param {AggregatedSweep} run
 * @returns {string}
 */
export function renderPacingReport(run) {
  const { meta, cells, reconciliation } = run;
  const totalRounds = cells.reduce((total, cell) => total + cell.rounds, 0);
  const totalMatches = cells.reduce((total, cell) => total + cell.matches, 0);
  const minRounds = cells.length === 0 ? 0 : Math.min(...cells.map((cell) => cell.rounds));

  const seeds = pacingSeeds(meta.seedsPerCell);
  const seedLine =
    `${seeds.slice(0, AGENT_RUN_SEEDS.length).join(', ')}` +
    (seeds.length > AGENT_RUN_SEEDS.length
      ? `, then ${PACING_SEED_BASE + 1}…${seeds[seeds.length - 1]} (${seeds.length} seeds in total, the same list in every cell)`
      : ` (${seeds.length} seeds)`);

  const perPairing = PAIRINGS.map((pairing) => {
    const own = cells.filter((cell) => cell.pairing === pairing);
    if (own.length === 0) return '';
    return (
      `### ${pairing}\n\n` +
      [
        '| Cell | Rounds | Median round (s) | p90 round (s) | Reached warning | Reached inset ≥ 3 | Timeout | Draw | Median match (s) | p90 match (s) |',
        '|---|---|---|---|---|---|---|---|---|---|',
        ...own.map(cellRow),
      ].join('\n') +
      `\n\n**How deep the lasers got** — percentage of ${pairing} rounds reaching at least each inset:\n\n` +
      insetTable(own) +
      '\n'
    );
  })
    .filter((section) => section !== '')
    .join('\n');

  const droppedSection =
    meta.droppedCells.length === 0
      ? 'Every cell of the full grid ran. No cell was dropped and no cell was under-sampled.'
      : 'The full grid did **not** run. These cells were dropped, and why — rounds per cell was held at the ' +
        "ticket's floor rather than quietly shrunk to make the grid fit:\n\n" +
        meta.droppedCells.map((line) => `- ${line}`).join('\n');

  const allAgree = reconciliation.every((row) => row.agrees);
  const reconciliationVerdict = allAgree
    ? 'Every pairing reproduces `agent-run.md` **to the number**. The baseline cell is the shipping ' +
      'configuration expressed as an override, so this is what a correct run must show — and it is the ' +
      'evidence that the swept cells below differ from the baseline because of the swept value and for no ' +
      'other reason.'
    : '**At least one pairing does not reproduce `agent-run.md`.** That is a defect in one of the two ' +
      'instruments, not a discrepancy to explain away: the baseline cell is the shipping configuration ' +
      'expressed as an override and must reproduce it exactly. Do not read the swept cells below until it ' +
      'is resolved.';

  const jsonBlock = JSON.stringify(
    {
      // The date and the wall time are `meta` and deliberately excluded: everything in this block must be
      // identical between two honest regenerations, and those two are the only fields that are not.
      seedsPerCell: meta.seedsPerCell,
      renderEveryNFrames: meta.renderEveryNFrames,
      climaxInset: CLIMAX_INSET,
      maxLaserInset: MAX_LASER_INSET,
      droppedCells: meta.droppedCells,
      cells,
      reconciliation,
    },
    null,
    2,
  );

  return `# Round pacing — the shape of a round, swept

KI-04-01 · tracking issue [#229](https://github.com/aliceagent/kobisnake/issues/229) · ticket issue
[#231](https://github.com/aliceagent/kobisnake/issues/231) · origin
[#119](https://github.com/aliceagent/kobisnake/issues/119) finding F3

F3 measured 4 of 27 rounds (14.8 %) reaching the laser warning, on an unseeded scratch run, with a median
round of 16 s — "five rounds in six never see a laser", on a mechanic four sprints were spent building.
\`docs/qa/playtests/agent-run.md\` (I03) made that number reproducible on the shipping settings. This document
does the next thing I04 asks for: it sweeps the two levers that could move it and reports what each one costs.

It is a **design instrument, not a pass/fail gate** — the same standing \`gate1-bot-matrix.md\` and
\`agent-run.md\` have. Nothing below is asserted against a design threshold in code. The decision it feeds is
KI-04-02, which belongs to the design lead; this document deliberately stops at the numbers.

## What actually ran

- **Command:** \`${meta.command}\`
- **Date:** ${meta.date}. **This and the wall time below are the only two lines expected to change if you
  regenerate this document on a different day or a different machine** — every other number comes from fixed
  seeds through a deterministic simulation (\`ARCHITECTURE §11\`). Treat any other line changing as a real
  discrepancy to investigate, not a maintenance chore to reconcile.
- **Wall time:** ~${meta.wallSeconds}s. Real time, reported as a sense of what regenerating costs. Not
  reproducible, and unlike every other figure here not a property of the simulation at all.
- **Total:** ${cells.length} cells, ${totalMatches} matches, ${totalRounds} rounds. Smallest cell:
  ${minRounds} rounds (the ticket's floor is 300).
- **Seeds** — the same list in every cell, so any two cells differ by their swept values and nothing else:
  ${seedLine}
  The first ${AGENT_RUN_SEEDS.length} are \`agent-run.md\`'s own seeds, in its own order, which is what makes
  the reconciliation below an exact comparison. The rest start at ${PACING_SEED_BASE + 1}, clear of every
  other committed instrument's range (\`gate1-bot-matrix.md\` 300 000+, \`powerupStats.test.js\` 210 000+,
  \`laserStats.test.js\` 110 000–130 000, \`stats.test.js\` 10 000–40 000), so a small difference from a figure
  quoted elsewhere is sampling noise from a different seed range rather than a contradiction.
- **Every cell is built with \`withOverrides()\`**, through \`driver.playMatch\`'s \`settingsOverrides\`
  option into \`session.js\`. **\`src/core/settings.js\` was never edited**, so every row below is a
  hypothetical — including the baseline row, which is a hypothetical that happens to equal what ships.
- **Two cells per pairing are a declared extension to the ticket's grid.** \`laserStartTime\` is measured in
  seconds *remaining*, so a larger number is an **earlier** warning — which means the ticket's own three
  values (20 / 25 / 30) are the shipping start and two *later* ones, and the sprint file's lever table
  ("earlier lasers reach more rounds") describes the direction none of them test. Swept only downward this
  lever can move the climax fraction one way, so a matrix built from those three alone would answer "which
  single lever moves it most" by default rather than on evidence. \`laserStartTime\` ${listOf(EARLIER_LASER_START_TIMES)} s
  at the shipping \`roundDuration\` are therefore run as well, labelled *(extension: earlier start)* wherever
  they appear. The ticket's 3×3 grid is reported intact beside them. 35 and 40 s were measured by KI-04-01;
  45 and 50 s were added by KI-04-03 on the design lead's ruling, because two points describe a line rather
  than a curve and this lever has to be measured far enough to show where it turns over.
- **Best-of-3**, \`agent-run.md\`'s format and the game's own default. First-to-two means every match plays at
  least two rounds, so ${meta.seedsPerCell} seeds guarantee at least ${meta.seedsPerCell * 2} rounds in every
  cell by construction.
- **Render cadence:** one render every ${meta.renderEveryNFrames} frames. This run reads only
  \`RoundRecord\`/\`MatchResult\` fields and never \`maxDrawCalls\`, so it renders sparsely, trading a render
  sample it does not use for wall time it does. \`driver.js\`'s header is explicit that skipping
  \`renderer.render()\` cannot affect simulation state — every number here is a property of the simulation,
  never of how often it was drawn.

### Cells that did not run

${droppedSection}

## Read this before the numbers

1. **Bots die more cheaply than people.** This is the single most important caveat in the document and it
   applies to every figure below. Neither \`greedy\` nor \`survivor\` fears death the way a person does — a bot
   never hesitates, never mistimes a turn out of nerves, never looks away from the screen, and never gets
   better between rounds. Every death-driven figure here — how often a round ends before the warning, the
   draw rate, the end-reason mix — over-states how often a *player* would die early. **These are directional
   numbers.** They say which lever moves the climax and roughly how far; they do not say what the right value
   is, and a lever ranked first here could easily rank second with humans on the keyboard.
2. **The direction is the finding; the magnitude is not.** Read the *differences between cells* rather than
   any single cell's absolute percentage, and prefer a lever that moves the number a lot to one that moves it
   a little — that comparison survives the caveat above far better than the levels do.
3. **Neither policy adapts to anything.** Same caveat \`gate1-bot-matrix.md\` and \`agent-run.md\` both make: a
   bot that collects Speed Boost does not replan or get more careful, and neither policy plays the closing
   board differently from the open one. A human does both.
4. **A shorter round is not automatically a better round.** \`roundDuration\` moves the warning fraction by
   moving the finish line, which is arithmetic, not design: it raises the fraction partly by removing round
   that would otherwise have been played. The match wall-clock columns are in the tables for exactly this
   reason — a lever that buys the climax by making the whole match shorter has a cost, and it is visible
   there rather than argued about.
5. **This does not judge whether the game is fun, and it cannot.** That is Gate 1 (KS-07-02) and
   \`PLAYTEST-SCRIPT §5\` A2/A4 — "did the lasers come too early or late?", "was the ending exciting or
   frustrating?" — which no agent can answer. This document is evidence for a design lead to weigh against
   those sessions, not a verdict on any of it.

## Reconciling the baseline against \`agent-run.md\`

The baseline cell (\`laserStartTime\` ${SETTINGS.laserStartTime} s, \`roundDuration\` ${SETTINGS.roundDuration} s)
**is** \`SETTINGS\`. Restricted to \`agent-run.md\`'s own seeds it is the same set of matches that document
played, through the same driver and the same policies, so it must reproduce it exactly. Expected / actual:

| Pairing | Seeds compared | Rounds | Reached warning | Mean round (s) | Verdict |
|---|---|---|---|---|---|
${reconciliation.map(reconciliationRow).join('\n')}

${reconciliationVerdict}

## The matrix

Every cell: ${meta.seedsPerCell} seeds, Best-of-3, power-ups at the match-setup default. "Reached warning" is
\`RoundRecord.reachedLaserPhase\` — the beams left \`PARKED\` during the round — and "reached inset ≥ ${CLIMAX_INSET}"
is \`maxLaserInset >= ${CLIMAX_INSET}\`, a third of the way in, where the board is visibly closing rather than
merely lit. Match times are whole matches including countdown, crash slow-mo and scoreboard. Rows marked
*(extension: earlier start)* are the ${EARLIER_LASER_START_TIMES.length} cells beyond the ticket's grid, for
the reason given above; read the ticket's own nine rows as the answer to what it asked, and those as the
question it did not ask.

${perPairing}
## What the earlier-start arm shows

KI-04-03 extended \`laserStartTime\` to ${listOf(EARLIER_LASER_START_TIMES)} s to find where the lever turns
over. Reading the arm back, at the shipping round length:

${earlierStartReading(cells)}

Two things follow, and the second matters more than the first. **The climax fraction is bought without
lengthening the round** — the median round barely moves across the whole arm, because \`laserStartTime\` changes
*when* the arena starts closing rather than how long the round lasts. And a lever still climbing at the top of
its measured range has not been bounded: if a value beyond the largest cell here is wanted, it needs measuring,
not extrapolating.

## Machine-readable data

The exact numbers above, one object per cell, plus the reconciliation rows. Everything here is a pure function
of the seeds named above and the deterministic simulation they drive — regenerating this document should
reproduce this block byte for byte (the date and the wall time are deliberately excluded, for exactly that
reason).

\`tests/agent/pacing.test.js\` diffs against this block on every \`npm run test:unit\`. What it checks is what
can honestly be checked without a browser: that the block parses, that every cell carries the fields AC2 names
and meets the ticket's 300-round floor or is listed as dropped, that the rendered tables above agree with it,
that the rates are internally consistent, and that every reconciliation row agrees. It cannot recompute these
numbers — that needs Chromium and the command at the top of this document — which is exactly the difference
between this document and \`gate1-bot-matrix.md\`, whose cells are headless and *are* recomputed on every push.

\`\`\`json
${jsonBlock}
\`\`\`
`;
}
