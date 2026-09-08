// @ts-check
import { describe, expect, it } from 'vitest';
import { generateActions, describeAction } from './monkey.js';
import { buildShrinkFixture, renderSentence, shrinkFailure } from './shrink.js';

/**
 * KI-18-02 — `shrink.js`'s own suite (Improvement 18, tracking issue #303, ticket issue #312).
 *
 * Every test here is Node-side and browser-free, against a **fabricated** predicate — a plain async function
 * standing in for "replay this candidate through `runMonkeySession` and ask whether it still fails" — which
 * is exactly what AC1 asks for ("a *fabricated* failure at action 1 500 of 2 000") and what `shrink.js`'s own
 * header says the module is built to allow. `shrink.spec.js` is the belt-and-braces browser proof: it shrinks
 * a real (if deliberately provoked) failure against the built site and replays the resulting fixture through
 * `monkey.js`'s `runMonkeySession`.
 */

/**
 * A 2 000-action list and a predicate that fails exactly when a specific, marked action is present —
 * `shrinkFailure`'s simplest possible target, and the shape AC1's own wording describes: one action, deep in
 * a long run, is "the" cause. Matched by reference rather than by value, because `generateActions` gives every
 * action its own object and reference equality is unambiguous in a way that comparing fields never quite is
 * (two `blur` actions are structurally identical).
 *
 * @param {number} seed
 * @param {number} count
 * @param {number} triggerIndex - position of the one action the fabricated failure needs.
 * @returns {{actions: import('./monkey.js').MonkeyAction[], trigger: import('./monkey.js').MonkeyAction, predicate: import('./shrink.js').ShrinkPredicate}}
 */
function singleCauseScenario(seed, count, triggerIndex) {
  const actions = generateActions(seed, count);
  const trigger = actions[triggerIndex];
  /** @type {import('./shrink.js').ShrinkPredicate} */
  const predicate = async (candidate) => candidate.includes(trigger);
  return { actions, trigger, predicate };
}

describe('KI-18-02 · shrinkFailure', () => {
  it('KI-18-02 AC1: a fabricated failure at action 1 500 of 2 000 shrinks to fewer than 20 actions', async () => {
    const { actions, trigger, predicate } = singleCauseScenario(2024, 2000, 1500);

    const result = await shrinkFailure(actions, predicate);

    console.log(
      `KI-18-02 AC1: 2000 actions, failure caused by action 1500 → shrunk to ` +
        `${result.actions.length} action(s) over ${result.evaluations} candidate evaluation(s).`,
    );

    expect(result.actions.length).toBeLessThan(20);
    // The shrink did not just get *short* — it kept the actual cause rather than losing it along the way.
    expect(result.actions).toContain(trigger);
    // A predicate this cheap and this targeted shrinks all the way to the one action that matters. Asserted
    // as fact, not merely "under 20", because a looser result here would say the search stopped early rather
    // than that it converged.
    expect(result.actions).toEqual([trigger]);
  });

  it('KI-18-02 AC1: the search evaluates a bounded, not exponential, number of candidates', async () => {
    // Four positions across the run, including both ends, so the bound is not a fluke of the middle. An
    // exponential search over 2 000 actions could not evaluate a *bounded* number of candidates at any of
    // these — it would not finish inside this test at all — so the fact that every one of these completes
    // in milliseconds and reports a small count is itself most of the proof; the explicit ceiling below is
    // the machine-checkable half of it.
    for (const triggerIndex of [0, 1, 1500, 1999]) {
      const { actions, predicate } = singleCauseScenario(11, 2000, triggerIndex);
      const result = await shrinkFailure(actions, predicate);
      // ddmin over n items visits O(n) candidates in the worst practiced case and far fewer against a
      // single-cause failure like this one (see `shrink.js`'s header): generous next to a genuine bound, and
      // still nowhere near what an exponential search over 2 000 actions would cost.
      expect(result.evaluations, `trigger at ${triggerIndex}`).toBeLessThan(2000);
      expect(result.actions, `trigger at ${triggerIndex}`).toHaveLength(1);
    }
  });

  it('KI-18-02: drops halves, then quarters, then single actions — never a coarser pass after a finer one', async () => {
    // A small, hand-sized run so every attempt can be inspected rather than sampled. Sixteen actions is
    // enough to see three full granularity levels (2, 4, 8 chunks) before the loop reaches chunk size one.
    const { actions, predicate } = singleCauseScenario(3, 16, 11);

    const result = await shrinkFailure(actions, predicate);

    const chunkCounts = result.attempts.map((attempt) => attempt.chunkCount);
    // Non-decreasing: whatever level shrinkPass is run at, the next level's chunkCount is never smaller.
    for (let i = 1; i < chunkCounts.length; i += 1) {
      expect(chunkCounts[i], `attempt ${i}`).toBeGreaterThanOrEqual(chunkCounts[i - 1]);
    }
    // The ticket's exact words appear, in this order, and nothing named 'single actions' appears before a
    // 'quarters' or 'halves' attempt.
    const granularities = result.attempts.map((attempt) => attempt.granularity);
    expect(granularities[0]).toBe('halves');
    expect(granularities).toContain('single actions');
    const firstSingles = granularities.indexOf('single actions');
    expect(granularities.slice(0, firstSingles)).not.toContain('single actions');
    // Every kept attempt actually shrank the list; every rejected one left it exactly as it was.
    for (const attempt of result.attempts) {
      if (attempt.kept) expect(attempt.sizeAfter).toBeLessThan(attempt.sizeBefore);
      else expect(attempt.sizeAfter).toBe(attempt.sizeBefore);
    }
  });

  it('KI-18-02: a candidate can stop failing for a reason that is not necessity, and the search is unbothered', async () => {
    // Two actions the fabricated failure needs *both* present — dropping either one on its own makes the
    // candidate healthy, which is the shape of a stateful dependency the module's header warns about (though
    // here it is exact rather than merely "whatever the game happened to do"). Nothing about the algorithm
    // has to know which of the two mattered; it only ever learns "removing this chunk broke the repro".
    const actions = generateActions(5, 500);
    const [a, b] = [actions[40], actions[460]];
    /** @type {import('./shrink.js').ShrinkPredicate} */
    const predicate = async (candidate) => candidate.includes(a) && candidate.includes(b);

    const result = await shrinkFailure(actions, predicate);

    expect(result.actions).toEqual(expect.arrayContaining([a, b]));
    expect(result.actions).toHaveLength(2);
    // Order preserved — the two survivors are a subsequence of the original, not a set the search was free
    // to reorder into whichever order made the story cleanest.
    expect(result.actions).toEqual([a, b]);
    expect(result.evaluations).toBeGreaterThan(0);
    expect(result.evaluations).toBeLessThan(500);
  });

  it('KI-18-02: refuses to shrink an action list that was never failing', async () => {
    const actions = generateActions(1, 50);
    await expect(shrinkFailure(actions, async () => false)).rejects.toThrow(
      /did not fail the predicate/,
    );
  });

  it('KI-18-02: `verifyOriginal: false` skips that check and shrinks nothing from an already-healthy list', async () => {
    const actions = generateActions(1, 20);
    let calls = 0;
    const result = await shrinkFailure(
      actions,
      async () => {
        calls += 1;
        return false;
      },
      { verifyOriginal: false },
    );
    // Every candidate the search tried was rejected (the predicate never says "still fails"), so nothing was
    // dropped: the result is the original list, unchanged and in its original order.
    expect(result.actions).toEqual(actions);
    expect(calls).toBe(result.evaluations);
    expect(calls).toBeGreaterThan(0);
  });

  it('KI-18-02: a one- or zero-action list is returned as-is — nothing left to split', async () => {
    const one = generateActions(1, 1);
    const resultOne = await shrinkFailure(one, async () => true);
    expect(resultOne.actions).toEqual(one);
    expect(resultOne.attempts).toEqual([]);

    const resultEmpty = await shrinkFailure([], async () => true);
    expect(resultEmpty.actions).toEqual([]);
    expect(resultEmpty.attempts).toEqual([]);
  });
});

describe('KI-18-02 · renderSentence', () => {
  it('KI-18-02: renders one action as one describeAction fragment, ending the sentence', () => {
    const [action] = generateActions(9, 1);
    expect(renderSentence([action])).toBe(`${describeAction(action)}.`);
  });

  it('KI-18-02: renders several actions joined in order, so a reviewer reads the sequence as written', () => {
    const actions = generateActions(9, 4);
    const sentence = renderSentence(actions);
    expect(sentence).toBe(actions.map(describeAction).join('; then ') + '.');
    // Order matters — this is a replay script, not a bag of facts.
    expect(sentence.indexOf(describeAction(actions[0]))).toBeLessThan(
      sentence.indexOf(describeAction(actions[1])),
    );
  });

  it('KI-18-02: the empty list still reads as a sentence, not blank output', () => {
    expect(renderSentence([])).toMatch(/\S/);
    expect(renderSentence([])).toMatch(/\.$/);
  });
});

describe('KI-18-02 AC2 · the shrunk fixture reproduces the failure on replay', () => {
  it('KI-18-02 AC2: a fixture built from a shrunk run still fails the same predicate, including after a JSON round trip', async () => {
    const { actions, trigger, predicate } = singleCauseScenario(77, 2000, 1500);
    const shrunk = await shrinkFailure(actions, predicate);

    // `failure` and `options` are what turn "actions that once failed something" into "the whole recipe":
    // which finding the actions reproduce, and the non-default `runMonkeySession` options the replay needs
    // (`shrink.spec.js` demonstrates the real ones; a plain `{rule, detail}` and an arbitrary options bag
    // are enough to prove this module carries them through without caring what is inside either).
    const fixture = buildShrinkFixture({
      seed: 77,
      originalActionCount: actions.length,
      actions: shrunk.actions,
      evaluations: shrunk.evaluations,
      failure: { rule: 'contains-trigger', detail: `action ${trigger.index} present` },
      options: { stuckSimulatedSeconds: 5 },
    });

    // Everything the ticket names is here, and it is what it says it is.
    expect(fixture.seed).toBe(77);
    expect(fixture.originalActionCount).toBe(2000);
    expect(fixture.shrunkActionCount).toBe(fixture.actions.length);
    expect(fixture.actions).toContain(trigger);
    expect(fixture.sentence).toBe(renderSentence(fixture.actions));
    expect(fixture.evaluations).toBe(shrunk.evaluations);
    // …and so is what the tech-lead review asked for: the finding the actions reproduce, and the options a
    // replay needs, both round-trippable as part of the same object rather than known only by the caller.
    expect(fixture.failure).toEqual({
      rule: 'contains-trigger',
      detail: `action ${trigger.index} present`,
    });
    expect(fixture.options).toEqual({ stuckSimulatedSeconds: 5 });

    // Replayed directly: the fixture's own actions still trip the predicate that found the failure.
    await expect(predicate(fixture.actions)).resolves.toBe(true);

    // Replayed after a JSON round trip — the shape `docs/qa/reports/` would actually commit and the shape
    // `runMonkeySession(page, {seed, actions, ...options})` would actually be handed on a later invocation of
    // this process, where the original `trigger` object no longer exists to compare by reference. The
    // predicate above cannot be reused as-is (it closes over `trigger`'s identity), so this checks the thing
    // identity cannot: every field of every action, and `failure` and `options` themselves, survive the round
    // trip untouched.
    const revived = JSON.parse(JSON.stringify(fixture));
    expect(revived.actions).toEqual(fixture.actions);
    expect(revived.sentence).toBe(fixture.sentence);
    expect(revived.failure).toEqual(fixture.failure);
    expect(revived.options).toEqual(fixture.options);
    expect(revived.actions.some((/** @type {any} */ a) => a.index === trigger.index)).toBe(true);
  });

  it('KI-18-02 AC2: `failure` and `options` are omitted, not written in as `undefined`, when the caller never supplies them', async () => {
    // The tech-lead review's own condition: "both optional, so nothing that builds a fixture today breaks".
    // A fixture built the way every call before this addition built one should be indistinguishable from
    // one built before `failure`/`options` existed — not merely `undefined`-valued, genuinely absent, which
    // is also the only shape a `JSON.stringify` round trip cannot smuggle a stray key through by accident.
    const { actions, trigger, predicate } = singleCauseScenario(3, 300, 217);
    const shrunk = await shrinkFailure(actions, predicate);
    const fixture = buildShrinkFixture({
      seed: 3,
      originalActionCount: 300,
      actions: shrunk.actions,
      evaluations: shrunk.evaluations,
    });

    // A reviewer holding a 2 000-action campaign log and a shrunk fixture side by side should be able to
    // find "action 1500" in both. Renumbering the shrunk list 0..n-1 would break exactly that.
    expect(fixture.actions[0].index).toBe(trigger.index);
    expect(trigger.index).toBe(217);

    expect('failure' in fixture).toBe(false);
    expect('options' in fixture).toBe(false);
    expect(Object.keys(fixture).sort()).toEqual(
      ['actions', 'evaluations', 'originalActionCount', 'seed', 'sentence', 'shrunkActionCount'].sort(),
    );
  });
});
