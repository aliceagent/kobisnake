// @ts-check
import { describe, expect, it } from 'vitest';
import { createMatch } from '../../../src/core/match.js';
import { RESULTS } from '../../../src/core/events.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

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

  it('KS-05-01 AC2: draws never end a match; 20 consecutive draws still isOver() === false', () => {
    const match = createMatch({ bestOf: 5, players: PLAYERS });
    for (let i = 0; i < 20; i += 1) {
      match.recordRound(RESULTS.DRAW);
    }
    expect(match.roundsPlayed).toBe(20);
    expect(match.wins).toEqual({ 1: 0, 2: 0 });
    expect(match.winner).toBeNull();
    expect(match.isOver()).toBe(false);
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
