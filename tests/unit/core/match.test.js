// @ts-check
import { describe, expect, it } from 'vitest';
import { createMatch, MATCH_END_REASONS } from '../../../src/core/match.js';
import { RESULTS } from '../../../src/core/events.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';
import { createRng } from '../../../src/core/rng.js';

const PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

describe('KS-05-01 MatchState', () => {
  it('KS-05-01 AC1: Bo1 targets 1 win and sets winner exactly when reached', () => {
    const match = createMatch({ bestOf: 1, players: PLAYERS });
    expect(match.target).toBe(1);
    expect(match.winner).toBeNull();
    expect(match.isOver()).toBe(false);

    match.recordRound(RESULTS.P1_WIN);
    expect(match.wins).toEqual({ 1: 1, 2: 0 });
    expect(match.winner).toBe(1);
    expect(match.isOver()).toBe(true);
  });

  it('KS-05-01 AC1: Bo3 targets 2 wins and sets winner exactly when reached', () => {
    const match = createMatch({ bestOf: 3, players: PLAYERS });
    expect(match.target).toBe(2);

    match.recordRound(RESULTS.P2_WIN);
    expect(match.winner).toBeNull();
    expect(match.isOver()).toBe(false);

    match.recordRound(RESULTS.P2_WIN);
    expect(match.wins).toEqual({ 1: 0, 2: 2 });
    expect(match.winner).toBe(2);
    expect(match.isOver()).toBe(true);
  });

  it('KS-05-01 AC1: Bo5 targets 3 wins and sets winner exactly when reached', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    expect(match.target).toBe(3);

    match.recordRound(RESULTS.P1_WIN);
    match.recordRound(RESULTS.P1_WIN);
    expect(match.winner).toBeNull();
    expect(match.isOver()).toBe(false);

    match.recordRound(RESULTS.P1_WIN);
    expect(match.wins).toEqual({ 1: 3, 2: 0 });
    expect(match.winner).toBe(1);
    expect(match.isOver()).toBe(true);
  });

  it('KS-05-01 AC1: an unsupported bestOf throws RangeError', () => {
    expect(() => createMatch({ bestOf: 2, players: PLAYERS })).toThrow(RangeError);
    expect(() => createMatch({ bestOf: 7, players: PLAYERS })).toThrow(RangeError);
  });

  it('KS-05-01 AC2/KI-01-01: a draw never scores, but the third in a row ends the match', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    // A draw still never credits either player a win — that half of the original assertion still holds.
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.roundsPlayed).toBe(2);
    expect(match.isOver()).toBe(false);

    // The third consecutive draw is where row 26 now bites: level score, so the match ends as a tie.
    match.recordRound(RESULTS.DRAW);
    expect(match.roundsPlayed).toBe(3);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.winner).toBeNull();
    expect(match.isOver()).toBe(true);
  });

  it("KS-05-01 AC2: a practice round's null result is recorded like a draw, never ending the match", () => {
    const match = createMatch({ bestOf: 3, players: PLAYERS });
    match.recordRound(null);
    match.recordRound(null);
    expect(match.roundsPlayed).toBe(2);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.isOver()).toBe(false);
  });

  it('KS-05-01 AC3: Bo1/Bo3/Bo5 reward 0/1/2 keys, read from settings.rewards', () => {
    expect(createMatch({ bestOf: 1, players: PLAYERS }).rewardKeys).toBe(0);
    expect(createMatch({ bestOf: 3, players: PLAYERS }).rewardKeys).toBe(1);
    expect(createMatch({ bestOf: 5, players: PLAYERS }).rewardKeys).toBe(2);
  });

  it('KS-05-01 AC3: rewardKeys tracks a settings override rather than a retyped table', () => {
    const settings = withOverrides({ rewards: { 1: 4, 3: 5, 5: 6 } });
    expect(createMatch({ bestOf: 1, players: PLAYERS, settings }).rewardKeys).toBe(4);
    expect(createMatch({ bestOf: 3, players: PLAYERS, settings }).rewardKeys).toBe(5);
    expect(createMatch({ bestOf: 5, players: PLAYERS, settings }).rewardKeys).toBe(6);
  });

  it('KS-05-01: winsNeeded counts down to the target and floors at 0', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    expect(match.winsNeeded(1)).toBe(3);
    expect(match.winsNeeded(2)).toBe(3);

    match.recordRound(RESULTS.P1_WIN);
    expect(match.winsNeeded(1)).toBe(2);
    expect(match.winsNeeded(2)).toBe(3);

    match.recordRound(RESULTS.P1_WIN);
    match.recordRound(RESULTS.P1_WIN);
    expect(match.winsNeeded(1)).toBe(0);
  });

  it('KS-05-01: recordRound after the match is over is rejected rather than silently corrupting the score', () => {
    const match = createMatch({ bestOf: 1, players: PLAYERS });
    match.recordRound(RESULTS.P1_WIN);
    expect(match.isOver()).toBe(true);

    expect(() => match.recordRound(RESULTS.P2_WIN)).toThrow(Error);
    // The rejected call changed nothing: no extra round counted, no extra win credited.
    expect(match.roundsPlayed).toBe(1);
    expect(match.wins).toEqual({ 1: 1, 2: 0 });
  });

  it('KS-05-01: recordRound rejects a value that is not a RESULTS value or null', () => {
    const match = createMatch({ bestOf: 3, players: PLAYERS });
    // @ts-expect-error intentionally passing a value outside RoundResult | null to prove it is rejected
    expect(() => match.recordRound('NOT_A_RESULT')).toThrow(RangeError);
    // The rejected call did not count as a played round.
    expect(match.roundsPlayed).toBe(0);
  });

  it('KS-05-01: createMatch requires exactly 2 players', () => {
    expect(() => createMatch({ bestOf: 3, players: [PLAYERS[0]] })).toThrow(RangeError);
    expect(() => createMatch({ bestOf: 3, players: [...PLAYERS, { id: 'p3' }] })).toThrow(
      RangeError,
    );
  });

  it("KS-05-01: players are copied, not the caller's own array or objects", () => {
    const original = [
      { id: 'p1', color: 'red' },
      { id: 'p2', color: 'blue' },
    ];
    const match = createMatch({ bestOf: 3, players: original });
    expect(match.players).toEqual(original);
    expect(match.players).not.toBe(original);
    original.push({ id: 'p3' });
    expect(match.players).toHaveLength(2);
  });

  it('KS-05-01: defaults to the shipping SETTINGS when none is passed', () => {
    const match = createMatch({ bestOf: 3, players: PLAYERS });
    expect(match.rewardKeys).toBe(SETTINGS.rewards[3]);
  });
});

describe('KI-01-01 consecutive-draw cap', () => {
  it('KI-01-01 AC1: a match of nothing but draws terminates on the exact round the cap fires', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    match.recordRound(RESULTS.DRAW);
    expect(match.isOver()).toBe(false);
    match.recordRound(RESULTS.DRAW);
    expect(match.isOver()).toBe(false);
    match.recordRound(RESULTS.DRAW);
    // The third draw is the maxConsecutiveDraws-th round played — the exact round the match ends on, since
    // draws never advance either player toward `target` and so cannot end it any other way.
    expect(match.roundsPlayed).toBe(SETTINGS.maxConsecutiveDraws);
    expect(match.isOver()).toBe(true);
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
  });

  it('KI-01-01 AC1: the cap fires on the same round number for every bestOf format', () => {
    for (const bestOf of SETTINGS.bestOfOptions) {
      const match = createMatch({ bestOf, players: PLAYERS });
      for (let i = 0; i < SETTINGS.maxConsecutiveDraws; i += 1) {
        expect(match.isOver()).toBe(false);
        match.recordRound(RESULTS.DRAW);
      }
      expect(match.roundsPlayed).toBe(SETTINGS.maxConsecutiveDraws);
      expect(match.isOver()).toBe(true);
    }
  });

  it('KI-01-01: a decisive round resets the consecutive-draw streak', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    expect(match.consecutiveDraws).toBe(2);

    match.recordRound(RESULTS.P1_WIN); // decisive: resets the streak, does not end the match
    expect(match.consecutiveDraws).toBe(0);
    expect(match.isOver()).toBe(false);

    // Two more draws alone did not end it before the reset, and do not now either — the streak is genuinely
    // back at zero, not merely under-counted.
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    expect(match.consecutiveDraws).toBe(2);
    expect(match.isOver()).toBe(false);
  });

  it("KI-01-01: a practice round's null result neither increments nor resets consecutiveDraws", () => {
    const match = createMatch({ bestOf: 3, players: PLAYERS });
    match.recordRound(RESULTS.DRAW);
    expect(match.consecutiveDraws).toBe(1);

    // Three practice rounds sandwiched in the middle of a draw streak must not trigger the cap (they are
    // not draws) and must not clear the streak either (they are not decisive).
    match.recordRound(null);
    match.recordRound(null);
    match.recordRound(null);
    expect(match.consecutiveDraws).toBe(1);
    expect(match.isOver()).toBe(false);

    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    expect(match.isOver()).toBe(true);
    expect(match.roundsPlayed).toBe(6);
  });

  it('KI-01-01 AC3: endReason distinguishes a normal win from a draw-cap match', () => {
    const match = createMatch({ bestOf: 1, players: PLAYERS });
    expect(match.endReason).toBeNull();

    match.recordRound(RESULTS.P1_WIN);
    expect(match.endReason).toBe(MATCH_END_REASONS.TARGET_REACHED);
    expect(match.endReason).not.toBe(MATCH_END_REASONS.DRAW_CAP);
    expect(match.winner).toBe(1);
  });

  it('KI-01-01 AC3: the draw cap awards the match to whoever leads on rounds won', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    match.recordRound(RESULTS.P1_WIN);
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);

    expect(match.wins).toEqual({ 1: 1, 2: 0 });
    expect(match.winner).toBe(1);
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
    expect(match.isOver()).toBe(true);
  });

  it('KI-01-01 AC3: the draw cap on a level score is a tie — isOver() true, winner null', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    match.recordRound(RESULTS.P1_WIN);
    match.recordRound(RESULTS.P2_WIN);
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);
    match.recordRound(RESULTS.DRAW);

    expect(match.wins).toEqual({ 1: 1, 2: 1 });
    expect(match.endReason).toBe(MATCH_END_REASONS.DRAW_CAP);
    // The defining shape of a tie: over, but nobody won.
    expect(match.isOver()).toBe(true);
    expect(match.winner).toBeNull();
  });

  it('KI-01-01 AC4: 10,000 random result sequences all terminate within the derived bound, across every bestOf', () => {
    // Bound derivation. Let target = Math.ceil(bestOf / 2) and cap = SETTINGS.maxConsecutiveDraws.
    //
    // A decisive round (P1_WIN/P2_WIN) is the only thing that moves either player toward `target`, and it
    // resets the draw streak (see the test above). While the match is still open, both players' `wins` are
    // strictly below `target`; by pigeonhole the most decisive rounds that can have been played while that
    // holds is 2 * (target - 1) (split target-1/target-1). The very next decisive round is therefore
    // guaranteed to push somebody to `target` — so at most 2 * target - 1 decisive rounds are ever needed to
    // force TARGET_REACHED, in any sequence whatsoever.
    //
    // Between any two decisive rounds (and before the first one), a run of draws can be at most cap - 1 long
    // before the cap itself ends the match — a run of exactly `cap` draws is a termination in its own right
    // (DRAW_CAP), so it never needs a decisive round to follow it. So each of the (2 * target - 1) decisive
    // rounds can be preceded by at most cap - 1 "free" draws without the match already having ended.
    //
    // Summing the worst case — every decisive round preceded by the longest safe draw run — gives:
    //   (2 * target - 1) decisive rounds + (2 * target - 1) * (cap - 1) draws = (2 * target - 1) * cap rounds.
    // Any sequence longer than that must already have triggered TARGET_REACHED or DRAW_CAP, so this product
    // is a sound upper bound on `roundsPlayed`, derived from the rule rather than guessed.
    const rng = createRng(20260907); // KI-01-01: any fixed seed makes a failure reproducible
    const trials = 10000;
    const candidates = [RESULTS.P1_WIN, RESULTS.P2_WIN, RESULTS.DRAW];

    for (let trial = 0; trial < trials; trial += 1) {
      // Cycle through every bestOf option so all three are covered, not just whichever is picked at random.
      const bestOf = SETTINGS.bestOfOptions[trial % SETTINGS.bestOfOptions.length];
      const target = Math.ceil(bestOf / 2);
      const bound = (2 * target - 1) * SETTINGS.maxConsecutiveDraws;

      const match = createMatch({ bestOf, players: PLAYERS });
      let rounds = 0;
      while (!match.isOver() && rounds < bound) {
        match.recordRound(rng.pick(candidates));
        rounds += 1;
      }

      expect(match.isOver()).toBe(true);
      expect(match.roundsPlayed).toBeLessThanOrEqual(bound);
    }
  });
});
