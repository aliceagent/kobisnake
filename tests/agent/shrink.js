// @ts-check
import { describeAction } from './monkey.js';

/**
 * KI-18-02 — shrink the failure (Improvement 18, `docs/sprints/improvement-18-session-fuzzing.md`, tracking
 * issue #303, ticket issue #312). Builds on KI-18-01's monkey (#311, `tests/agent/monkey.js`).
 *
 * A monkey campaign fails at action 1 500 of 2 000, and nobody reads a 2 000-action trace to find out why.
 * {@link shrinkFailure} delta-debugs the list down to the actions the failure actually needs: given a
 * candidate's actions and a predicate that says whether that candidate *still* fails, it drops chunks —
 * halves, then quarters, then single actions, exactly in the order the ticket names — re-running the
 * predicate on each candidate and keeping only the removals that leave the failure standing.
 *
 * ## Why this module is pure and Node-side
 *
 * `shrinkFailure` never touches a page. It takes a plain array and a `(actions) => Promise<boolean>`
 * function and returns a plain object; what the predicate does with a candidate — replay it in a browser,
 * check a fabricated condition, anything — is entirely the caller's business. That is what lets AC1 be
 * proved in plain Node against a fabricated predicate (`shrink.test.js`), which is exactly what the
 * acceptance criterion asks for ("a *fabricated* failure"), and it is what makes the search itself testable
 * without the cost or the flakiness of a browser: `monkey.spec.js`'s own AC3 campaign is the thing this
 * module exists to make cheap to investigate, so the investigation had better not need Playwright too.
 *
 * ## The order, and why it is that order rather than a binary search
 *
 * Classic delta-debugging (Zeller & Hildebrandt's `ddmin`) tries coarse splits before fine ones because a
 * failure is usually caused by a small fraction of a long run, and a coarse pass can throw away most of a
 * 2 000-action list in a handful of predicate calls rather than one action at a time. This module runs that
 * shape but only the "drop a chunk" half of the classic algorithm — never the "keep only a chunk" complement
 * half — because the ticket names exactly three granularities in exactly this order: halves, then quarters,
 * then single actions. In this module the granularity doubles (2 chunks, 4, 8, …) each time a level finds
 * nothing left to drop, computed fresh against whatever the list has already shrunk to, until the chunk size
 * reaches one action — "single actions" is not a fourth named step, it is what "keep doubling" reaches, and
 * the loop stops there because the ticket's list stops there too. One pass per granularity, left to right;
 * a chunk that is dropped successfully is never revisited, and the module does not restart at the coarsest
 * granularity after a successful drop the way full `ddmin` does. That keeps the algorithm the one thing AC1
 * cares about — evaluations bounded well short of exponential (`shrink.test.js` counts them) — at the cost
 * of a result that is "shrunk", not provably 1-minimal: a later, finer pass might still find something an
 * earlier, coarser one left behind, but nothing revisits a chunk once it is confirmed to matter, and this
 * module does not pretend to a stronger guarantee than that.
 *
 * ## Statefulness: a dropped candidate can stop failing for a reason that is not "necessity"
 *
 * The game the monkey drives is stateful — action 900 lands on whatever action 5 left behind — so an action
 * list is only reproducible *as a whole*. Dropping action 5 changes what action 900 does, which means a
 * candidate can stop failing not because the dropped chunk *caused* the failure but because removing it
 * nudged everything after it onto a different path that never reaches the failure at all. This is inherent
 * to delta-debugging anything with state, not a bug in this module, and the algorithm is already robust to
 * it in the only way that matters: a candidate that stops failing is simply rejected, exactly like one that
 * fails for an unrelated reason. Nothing here infers "action 5 was necessary" from a rejection — it only
 * ever concludes "removing this chunk did not leave a still-failing candidate" and keeps the original chunk
 * in place. A reader tracing back from a shrunk fixture to "why is this action here" should read it as "the
 * search could not drop it and keep the failure", not as "the game specifically needs it".
 *
 * ## The two outputs the ticket names
 *
 * {@link buildShrinkFixture} turns a shrunk action list into the **replayable fixture**: the seed, the
 * original action count, the shrunk actions themselves (unmodified — see below) and enough to re-run it
 * through `monkey.js`'s `runMonkeySession(page, {seed, actions})`, which already accepts an explicit action
 * list for exactly this reason. {@link renderSentence} is **the sentence**: it reuses `monkey.js`'s own
 * `describeAction` (the vocabulary belongs with the module that defines the actions, not a second copy of
 * it here) and joins the shrunk list into one human-readable line a reviewer can read without a debugger.
 *
 * Every action keeps the `index` it had in the original 2 000-action list rather than being renumbered
 * 0..n-1: a shrunk fixture's third action still reports itself — in a replayed run's `problems` — as
 * whichever index it always was, so a reviewer holding the original campaign log and the shrunk fixture side
 * by side can find the same action in both.
 */

/** @typedef {import('./monkey.js').MonkeyAction} MonkeyAction */

/**
 * A predicate answers whether a candidate action list still reproduces the failure. `true` means "still
 * fails, keep looking for less"; `false` means "this candidate is healthy, the dropped chunk stays".
 *
 * @typedef {(actions: MonkeyAction[]) => Promise<boolean>} ShrinkPredicate
 */

/**
 * One candidate the search tried, in the order it tried them — the "record of what it did".
 *
 * @typedef {object} ShrinkAttempt
 * @property {string} granularity - 'halves', 'quarters', '1/8', … or 'single actions' at chunk size one.
 * @property {number} chunkCount - how many pieces this level nominally split the list into.
 * @property {number} chunkSize - the size of the chunk this attempt dropped.
 * @property {number} sizeBefore - `actions.length` before this attempt.
 * @property {number} sizeAfter - `actions.length` after it — equal to `sizeBefore` when `kept` is `false`.
 * @property {boolean} kept - whether the candidate still failed and the drop was kept.
 */

/**
 * @typedef {object} ShrinkResult
 * @property {MonkeyAction[]} actions - the shortest still-failing list the search found.
 * @property {number} evaluations - how many times the predicate was called, original check included.
 * @property {ShrinkAttempt[]} attempts - every candidate tried, in order.
 */

/**
 * What to call the granularity of a level, in the ticket's own words. 'single actions' is not a fourth
 * named level — it is where doubling `chunkCount` ends up once a chunk can no longer hold more than one
 * action — so it is decided by `chunkSize`, not by which iteration this is.
 *
 * @param {number} chunkCount
 * @param {number} chunkSize
 * @returns {string}
 */
function granularityLabel(chunkCount, chunkSize) {
  if (chunkSize === 1) return 'single actions';
  if (chunkCount === 2) return 'halves';
  if (chunkCount === 4) return 'quarters';
  return `1/${chunkCount}`;
}

/**
 * One left-to-right pass at a fixed chunk size: try dropping each chunk in turn, keep the drop when the
 * predicate says the candidate still fails, and try the chunk that slid into the same position next when it
 * does. Mutates nothing — returns the list this pass leaves behind.
 *
 * @param {MonkeyAction[]} actions
 * @param {number} chunkCount
 * @param {ShrinkPredicate} predicate
 * @param {ShrinkAttempt[]} attempts - appended to in place
 * @returns {Promise<{actions: MonkeyAction[], evaluations: number}>}
 */
async function shrinkPass(actions, chunkCount, predicate, attempts) {
  const chunkSize = Math.max(1, Math.ceil(actions.length / chunkCount));
  let current = actions;
  let evaluations = 0;
  let start = 0;

  while (start < current.length) {
    const end = Math.min(start + chunkSize, current.length);
    const candidate = current.slice(0, start).concat(current.slice(end));
    evaluations += 1;
    // Awaited one at a time, on purpose: each candidate is built from whichever drops the previous
    // candidates in this pass were *kept* for, so there is no "current" to test a later candidate against
    // until the predicate has answered for this one.
    const stillFails = await predicate(candidate);
    attempts.push({
      granularity: granularityLabel(chunkCount, chunkSize),
      chunkCount,
      chunkSize,
      sizeBefore: current.length,
      sizeAfter: stillFails ? candidate.length : current.length,
      kept: stillFails,
    });
    if (stillFails) {
      current = candidate;
      // Do not advance `start`: the chunk that slid into this position by the removal has not been tried
      // yet, and skipping it would leave a droppable chunk untested for no reason.
    } else {
      start = end;
    }
  }

  return { actions: current, evaluations };
}

/**
 * Delta-debugs `actions` against `predicate`, dropping halves, then quarters, then single actions (see this
 * module's header for why that order and why not further). Returns the shortest still-failing list the
 * search found, how many candidates it evaluated, and the attempts in order.
 *
 * `predicate` is asked about `actions` itself first (unless `verifyOriginal` is `false`) — shrinking
 * something that was never failing is a caller error, not a search this module can usefully run, and saying
 * so immediately is cheaper than a confusing empty result three passes later.
 *
 * @param {MonkeyAction[]} actions
 * @param {ShrinkPredicate} predicate
 * @param {object} [options]
 * @param {boolean} [options.verifyOriginal] - default `true`.
 * @returns {Promise<ShrinkResult>}
 */
export async function shrinkFailure(actions, predicate, options = {}) {
  const { verifyOriginal = true } = options;
  let current = actions.slice();
  let evaluations = 0;
  /** @type {ShrinkAttempt[]} */
  const attempts = [];

  if (verifyOriginal) {
    evaluations += 1;
    const stillFails = await predicate(current);
    if (!stillFails) {
      throw new Error(
        `shrinkFailure: the original ${current.length}-action list did not fail the predicate — there is ` +
          'nothing to shrink. Pass { verifyOriginal: false } to skip this check.',
      );
    }
  }

  let chunkCount = 2;
  while (current.length > 1) {
    // Computed here, against the list this level *starts* with, so the loop can tell — without re-deriving
    // it from `attempts` — whether the pass it is about to run is already "single actions": at that point
    // `chunkCount` has doubled past `current.length` and every chunk is one action, which is where the
    // ticket's own list of granularities ends.
    const chunkSize = Math.max(1, Math.ceil(current.length / chunkCount));
    const pass = await shrinkPass(current, chunkCount, predicate, attempts);
    current = pass.actions;
    evaluations += pass.evaluations;
    if (chunkSize === 1) break;
    chunkCount *= 2;
  }

  return { actions: current, evaluations, attempts };
}

/**
 * One action as a fragment of a sentence — {@link describeAction} is `monkey.js`'s own vocabulary, reused
 * rather than duplicated, per this module's header.
 *
 * @param {MonkeyAction[]} actions
 * @returns {string}
 */
export function renderSentence(actions) {
  if (actions.length === 0) {
    // Reachable in principle — a predicate that says the empty list still fails (a load-time failure, say)
    // — and worth a readable sentence of its own rather than an empty string a reviewer might mistake for a
    // rendering bug.
    return 'The empty action list still failed — nothing the monkey did to the page was necessary.';
  }
  return `${actions.map(describeAction).join('; then ')}.`;
}

/**
 * @typedef {object} ShrinkFixture
 * @property {number} seed - the match seed the actions were generated against, and the one to replay with:
 *   `runMonkeySession(page, {seed: fixture.seed, actions: fixture.actions})`.
 * @property {number} originalActionCount - how long the run was before shrinking.
 * @property {number} shrunkActionCount - `actions.length`, kept alongside the list for a reviewer skimming
 *   the fixture without counting.
 * @property {MonkeyAction[]} actions - the shrunk list, replayable as-is.
 * @property {number} evaluations - how many candidates the search evaluated to find this list.
 * @property {string} sentence - {@link renderSentence} of `actions`.
 */

/**
 * Builds the replayable fixture the ticket asks for: the seed, the original action count, the shrunk
 * actions themselves, and enough to re-run it — plus the sentence, so a reviewer reading the fixture never
 * has to separately call {@link renderSentence}.
 *
 * @param {object} args
 * @param {number} args.seed
 * @param {number} args.originalActionCount
 * @param {MonkeyAction[]} args.actions - the shrunk list, e.g. `(await shrinkFailure(...)).actions`.
 * @param {number} args.evaluations
 * @returns {ShrinkFixture}
 */
export function buildShrinkFixture({ seed, originalActionCount, actions, evaluations }) {
  return {
    seed,
    originalActionCount,
    shrunkActionCount: actions.length,
    actions,
    evaluations,
    sentence: renderSentence(actions),
  };
}
