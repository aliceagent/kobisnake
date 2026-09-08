// @ts-check
import { expect, test } from '@playwright/test';
import { runMonkeySession } from './monkey.js';
import { buildShrinkFixture, shrinkFailure } from './shrink.js';

/**
 * KI-18-02 — the belt-and-braces browser proof (Improvement 18, tracking issue #303, ticket issue #312).
 *
 * `shrink.test.js` proves AC1 and AC2 in plain Node against a fabricated predicate, which is what AC1's own
 * wording ("a *fabricated* failure") asks for and what lets `shrinkFailure` stay pure and browser-free. This
 * file is the deviation the ticket names as acceptable when a claim can only be proved by actually playing a
 * run: it drives `shrinkFailure` against a **real** `runMonkeySession` predicate over the built site, so the
 * candidates it evaluates are real page loads and real `__kobi.advance` calls, not a fabricated stand-in for
 * one.
 *
 * **Files deviation, declared per this ticket's process:** the ticket's own `Files:` list names only
 * `tests/agent/shrink.js` and `tests/agent/shrink.test.js`. This `.spec.js` is the ticket's own suggestion
 * ("An agent-level test that shrinks a real failure and replays the fixture belongs in a `.spec.js`
 * (Playwright)") acted on, called out here and in the PR description as the addition it is.
 *
 * The "failure" this shrinks is deliberately provoked rather than a genuine bug hunted down for the
 * occasion: a `stuckSimulatedSeconds` far below `monkey.js`'s real 60 s default, against a run that sits on
 * `MAIN_MENU` doing nothing that changes the state (`focus` events, which `MAIN_MENU` does not act on). That
 * is "a real failure" in every sense this module cares about — a genuine `runMonkeySession` result with a
 * `stuck` problem in it, reached by actually running the actions through the actual page — without this
 * suite's outcome depending on a bug in the shipped game either existing or continuing to exist. Finding and
 * shrinking whatever the campaign turns up is KI-18-03's job, not this ticket's.
 */

/** Far below `monkey.js`'s real 60 s default, so a handful of idle actions trips it inside one test. */
const STUCK_THRESHOLD_SECONDS = 2;

/**
 * `focus` is real, dispatched at `window` exactly as `monkey.js` always does, and `MAIN_MENU` does not react
 * to it — no transition, so `lastChangeSimSeconds` never moves and the wait before each one accumulates
 * straight into "how long has this state sat still".
 *
 * @param {number} count
 * @param {number} waitSeconds
 * @returns {import('./monkey.js').MonkeyAction[]}
 */
function idleFocusActions(count, waitSeconds) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    kind: /** @type {const} */ ('focus'),
    waitSeconds,
  }));
}

test.describe('KI-18-02 · shrinking a real monkey run', () => {
  test('KI-18-02 AC2: shrinks a real stuck run and the fixture reproduces it on replay', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // Ten actions of 0.5 simulated seconds each: 5 s of idle waiting on MAIN_MENU against a 2 s threshold,
    // comfortably enough margin that the run stops early rather than needing every action.
    const original = idleFocusActions(10, 0.5);

    // The predicate has to know `STUCK_THRESHOLD_SECONDS` to search with — the fixture does not exist until
    // after the search finishes — but it also records the `stuck` finding of the last candidate it *kept*,
    // which by construction is the finding the final shrunk list itself produces: the search only advances
    // `current` on a candidate the predicate said still fails, so the last "still fails" it ever records is
    // for exactly the candidate that becomes `shrunk.actions`. That is what {@link buildShrinkFixture}'s
    // `failure` gets built from below, rather than a second, separate replay to go and find it again.
    /** @type {{rule: string, detail: string} | null} */
    let lastFailureFound = null;

    /** @param {import('./monkey.js').MonkeyAction[]} candidate */
    const predicate = async (candidate) => {
      if (candidate.length === 0) return false;
      const result = await runMonkeySession(page, {
        seed: 909,
        actions: candidate,
        stuckSimulatedSeconds: STUCK_THRESHOLD_SECONDS,
      });
      expect(result.pageErrors).toEqual([]);
      const stuck = result.problems.find((problem) => problem.rule === 'stuck');
      if (stuck !== undefined) lastFailureFound = { rule: stuck.rule, detail: stuck.detail };
      return stuck !== undefined;
    };

    const shrunk = await shrinkFailure(original, predicate);
    expect(lastFailureFound).not.toBeNull();

    console.log(
      `KI-18-02 AC2: a real stuck run over ${original.length} actions shrank to ` +
        `${shrunk.actions.length} action(s) over ${shrunk.evaluations} real page run(s).`,
    );

    // Shrunk to (at most) the handful of actions whose waits alone clear the threshold — strictly fewer
    // than the original, and never more than one extra action past the arithmetic minimum
    // (ceil(2 / 0.5) = 4), which is the shrink's own margin for the frame-sized rounding `advance` does.
    expect(shrunk.actions.length).toBeLessThan(original.length);
    expect(shrunk.actions.length).toBeLessThanOrEqual(5);
    expect(shrunk.actions.length).toBeGreaterThan(0);

    // `failure` and `options` are what the tech-lead review asked this fixture to carry: which finding the
    // actions reproduce, and the non-default `runMonkeySession` option (`stuckSimulatedSeconds`, far below
    // `monkey.js`'s real 60 s default) the replay needs — so the fixture is the whole recipe rather than
    // something a reader has to already know to pass `stuckSimulatedSeconds` by hand to reproduce.
    const fixture = buildShrinkFixture({
      seed: 909,
      originalActionCount: original.length,
      actions: shrunk.actions,
      evaluations: shrunk.evaluations,
      failure: /** @type {{rule: string, detail: string}} */ (lastFailureFound),
      options: { stuckSimulatedSeconds: STUCK_THRESHOLD_SECONDS },
    });

    expect(fixture.seed).toBe(909);
    expect(fixture.originalActionCount).toBe(10);
    expect(fixture.shrunkActionCount).toBe(shrunk.actions.length);
    expect(fixture.sentence).toMatch(/^wait \d+\.\d{3} s, focus the window/);
    expect(fixture.failure).toEqual(lastFailureFound);
    expect(fixture.failure?.rule).toBe('stuck');
    expect(fixture.options).toEqual({ stuckSimulatedSeconds: STUCK_THRESHOLD_SECONDS });
    console.log(
      `KI-18-02 AC2 fixture sentence: ${fixture.sentence}\n` +
        `KI-18-02 AC2 fixture failure: ${fixture.failure?.rule} — ${fixture.failure?.detail}`,
    );

    // AC2 itself: replaying the fixture — through the real driver, on a fresh page load, exactly as
    // `runMonkeySession(page, {seed: fixture.seed, actions: fixture.actions, ...fixture.options})` documents
    // it should be used — reproduces the same finding. `STUCK_THRESHOLD_SECONDS` is deliberately not named
    // again from here on: `...fixture.options` is the only place either replay below gets it, which is what
    // proves the fixture is self-sufficient rather than merely demonstrating it by coincidence.
    const replayed = await runMonkeySession(page, {
      seed: fixture.seed,
      actions: fixture.actions,
      ...fixture.options,
    });
    expect(replayed.pageErrors).toEqual([]);
    expect(replayed.problems.some((problem) => problem.rule === fixture.failure?.rule)).toBe(true);

    // And the fixture survives being written out and read back — `docs/qa/reports/` would commit the JSON,
    // not the live objects — and still replays, `options` included.
    const revived = JSON.parse(JSON.stringify(fixture));
    expect(revived.failure).toEqual(fixture.failure);
    expect(revived.options).toEqual(fixture.options);
    const replayedFromJson = await runMonkeySession(page, {
      seed: revived.seed,
      actions: revived.actions,
      ...revived.options,
    });
    expect(replayedFromJson.problems.some((problem) => problem.rule === revived.failure.rule)).toBe(
      true,
    );
  });
});
