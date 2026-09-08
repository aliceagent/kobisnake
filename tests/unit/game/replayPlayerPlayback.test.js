// @ts-check
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHASES } from '../../../src/core/events.js';
import { createReplayPlayer } from '../../../src/game/replayPlayer.js';

/**
 * #233 — the playback controls of `replayPlayer.js` (KI-05-02), which no unit test drove.
 *
 * `replayPlayer.test.js` covers construction, `step`, `seek`, the committed fixtures and the error paths.
 * What it never called is the *running* half of the player — `play`, `pause`, `isPlaying`, `advance`,
 * `getSettings` and `getReplay` — which is how `main` came to fail CI's per-file **functions** coverage gate
 * at 66.66 % while sitting at 94.87 % lines and 100 % branches. A branch inside a function that is never
 * entered is not a missed branch, so the other two metrics could not see the hole; the functions metric
 * could, which is the case for keeping it (`vitest.config.js`, KS-02-07: per-file, so one under-tested file
 * cannot hide behind an aggregate).
 *
 * These are behavioural assertions against the contract in `ReplayPlayer`'s own typedef, not calls made to
 * move a number: each one below fails if the documented behaviour changes. In a separate file from
 * `replayPlayer.test.js` only to stay out of the way of Improvement 05's in-flight work — the subject is the
 * same and the two belong together once that settles.
 */

const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../sim/replays');

/** The no-input round: a committed fixture with a known, deterministic end (`tests/sim/replays/README.md`). */
function noInputReplay() {
  return JSON.parse(readFileSync(join(REPLAYS_DIR, 'no-input-round.json'), 'utf8'));
}

/** @returns {import('../../../src/game/replayPlayer.js').ReplayPlayer} */
function playerFor(replay = noInputReplay()) {
  const built = createReplayPlayer(replay);
  if (!built.ok) throw new Error(`fixture did not build a player: ${built.error.code}`);
  return built.player;
}

describe('#233 · replayPlayer playback controls', () => {
  it('#233: play/pause/isPlaying report the transport state, starting paused', () => {
    const player = playerFor();
    // A freshly built player is not running: `advance` must not move a replay nobody asked to play.
    expect(player.isPlaying()).toBe(false);
    player.play();
    expect(player.isPlaying()).toBe(true);
    player.pause();
    expect(player.isPlaying()).toBe(false);
  });

  it('#233: advance is a no-op while paused', () => {
    const player = playerFor();
    const tick = player.tick;
    player.advance(1);
    expect(player.tick).toBe(tick);
    expect(player.getEvents().length).toBe(playerFor().getEvents().length);
  });

  it('#233: advance consumes whole ticks of wall time while playing', () => {
    const player = playerFor();
    const simHz = player.getSettings().simHz;
    player.play();
    player.advance(10 / simHz);
    expect(player.tick).toBe(10);
  });

  it('#233: advance accumulates fractional ticks across calls rather than dropping them', () => {
    // The tick accumulator is the reason `advance` takes wall seconds at all: a browser frame is not a
    // whole number of simulation ticks, and two half-ticks must make one tick rather than none.
    const player = playerFor();
    const half = 0.5 / player.getSettings().simHz;
    player.play();
    player.advance(half);
    expect(player.tick).toBe(0);
    player.advance(half);
    expect(player.tick).toBe(1);
  });

  it('#233: advance and step move the round identically', () => {
    // The contract that makes the transport trustworthy: running playback is exactly repeated stepping, so
    // a replay watched in the browser is the same round a test steps through tick by tick.
    const stepped = playerFor();
    for (let i = 0; i < 25; i += 1) stepped.step();

    const advanced = playerFor();
    advanced.play();
    advanced.advance(25 / advanced.getSettings().simHz);

    expect(advanced.tick).toBe(stepped.tick);
    expect(advanced.getEvents()).toEqual(stepped.getEvents());
    expect(advanced.getSnapshot()).toEqual(stepped.getSnapshot());
  });

  it('#233: advance stops itself when the round ends, rather than spinning', () => {
    // `no-input-round.json` ends on its own; playing far past that must leave the player stopped at the end
    // instead of running forever or advancing a finished round.
    const player = playerFor();
    player.play();
    player.advance(600);
    expect(player.phase).not.toBe(PHASES.PLAYING);
    expect(player.isPlaying()).toBe(false);

    const endTick = player.tick;
    player.play();
    player.advance(10);
    expect(player.tick).toBe(endTick);
  });

  it('#233: seek leaves the transport state exactly as it found it', () => {
    const player = playerFor();
    player.seek(20);
    expect(player.isPlaying()).toBe(false);

    player.play();
    player.seek(40);
    expect(player.isPlaying()).toBe(true);
    expect(player.tick).toBe(40);
  });

  it('#233: getSettings returns the settings the replay was built with, overrides applied', () => {
    const replay = noInputReplay();
    const base = playerFor(replay).getSettings();
    // A replay carries its own `settingsOverrides`; the player must resolve them rather than serve defaults.
    const slowed = playerFor({ ...replay, settingsOverrides: { snakeSpeed: 3 } }).getSettings();
    expect(slowed.snakeSpeed).toBe(3);
    expect(base.snakeSpeed).not.toBe(3);
    expect(slowed.simHz).toBe(base.simHz);
  });

  it('#233: getReplay returns the parsed replay verbatim', () => {
    const replay = noInputReplay();
    const returned = playerFor(replay).getReplay();
    expect(returned.seed).toBe(replay.seed);
    expect(returned.inputs).toEqual(replay.inputs);
  });
});
