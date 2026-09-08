// @ts-check
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PHASES } from '../../../src/core/events.js';
import { REPLAY_ERROR_CODES } from '../../../src/core/replay.js';
import { REPLAY_PLAYER_ERROR_CODES, createReplayPlayer } from '../../../src/game/replayPlayer.js';
import { runRound } from '../../sim/harness.js';

/**
 * KI-05-02 (`docs/sprints/improvement-05-replay-capture-and-playback.md`): `replayPlayer.js`'s driver, run
 * against the **committed** fixtures in `tests/sim/replays/` — never against a log produced in this same
 * run, per the ticket's own tech-lead notes — plus the seek/seed/error-forwarding behaviour those fixtures
 * cannot exercise on their own.
 */

const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../sim/replays');

/** A generous cap on stepping loops below, so a bug that broke "a round always ends" fails loudly, not by hanging. */
const MAX_STEPS = 20_000;

/**
 * @returns {{file: string, replay: object}[]}
 */
function loadFixtures() {
  return readdirSync(REPLAYS_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'replay.schema.json')
    .map((file) => ({ file, replay: JSON.parse(readFileSync(join(REPLAYS_DIR, file), 'utf8')) }));
}

/** Steps `player` to the end of the round (or {@link MAX_STEPS}, whichever comes first). */
function playToEnd(player) {
  let steps = 0;
  while (player.step()) {
    steps += 1;
    if (steps > MAX_STEPS) {
      throw new Error('playToEnd: exceeded the safety step cap without the round ending');
    }
  }
}

/** A no-op bot, exactly like `tests/sim/replay.test.js`'s own — `inputLog` drives `runRound`, not bots. */
function noopBot() {
  return null;
}

describe('KI-05-02 replayPlayer', () => {
  const fixtures = loadFixtures();

  it('loads at least one committed fixture', () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  describe.each(fixtures)('$file', ({ file, replay }) => {
    it(`KI-05-02 AC1: ${file} replays tick for tick to its expectedEvents`, () => {
      const built = createReplayPlayer(replay);
      expect(built.ok).toBe(true);
      if (!built.ok) return; // narrows for the checker; the assertion above already fails the test otherwise

      playToEnd(built.player);

      expect(built.player.phase).toBe(PHASES.ROUND_OVER);
      expect(built.player.getEvents()).toEqual(/** @type {any} */ (replay).expectedEvents);
      expect(built.player.getSeed()).toBe(/** @type {any} */ (replay).seed);
    });
  });

  it('KI-05-02 AC1: a corrupted input log no longer matches its expectedEvents (the check is not vacuous)', () => {
    // laser-both-heads-draw.json is the fixture with the richest input log (four entries, two of them tied
    // on tick 0) — proof that this test's assertion above is actually sensitive to what the replay records,
    // not something that would pass no matter what `expectedEvents` said.
    const original = fixtures.find((entry) => entry.file === 'laser-both-heads-draw.json');
    expect(original).toBeDefined();
    const replay = /** @type {any} */ (original).replay;
    const corrupted = {
      ...replay,
      inputs: replay.inputs.map((entry, index) =>
        // Flips p1's very first turn from UP to DOWN — a legal input, just not the recorded one.
        index === 0 ? { ...entry, dir: 'DOWN' } : entry,
      ),
    };

    const built = createReplayPlayer(corrupted);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    playToEnd(built.player);

    expect(built.player.getEvents()).not.toEqual(replay.expectedEvents);
  });

  it('KI-05-02: matches tests/sim/harness.js runRound exactly, including a same-tick input tie', () => {
    // The reference implementation this driver must reproduce (ticket: "Your player must reproduce its
    // semantics exactly"). Two inputs for the *same* player resolve to the same tick here (0 and 0 again,
    // after rounding) — a tie `driveWithInputLog`'s own untied `.sort` breaks by original order, which this
    // player must break the same way.
    const seed = 7;
    const inputs = [
      { t: 0, player: 'p1', dir: 'UP' },
      { t: 0.001, player: 'p1', dir: 'LEFT' }, // rounds to tick 0 at simHz 120, same as the entry above
      { t: 0.3, player: 'p2', dir: 'DOWN' },
    ];
    const replay = { seed, settingsOverrides: {}, inputs, expectedEvents: [] };

    const reference = runRound({ seed, bots: [noopBot, noopBot], inputLog: inputs });

    const built = createReplayPlayer(replay);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    playToEnd(built.player);

    expect(built.player.getEvents()).toEqual(reference.events);
  });

  describe('KI-05-02 AC2: seeking then playing forward matches playing straight through', () => {
    const fixture = /** @type {any} */ (
      fixtures.find((entry) => entry.file === 'laser-both-heads-draw.json')
    ).replay;

    /** The full, straight-through run every seek below is checked against. */
    const full = (() => {
      const built = createReplayPlayer(fixture);
      if (!built.ok) throw new Error('setup: fixture failed to build a player');
      playToEnd(built.player);
      return { events: built.player.getEvents(), lastTick: built.player.tick };
    })();

    it('the straight-through run reproduces the golden (sanity check for the rest of this block)', () => {
      expect(full.events).toEqual(fixture.expectedEvents);
    });

    it.each([0, Math.floor(full.lastTick / 2), full.lastTick])(
      'seeking to tick %i then playing to the end matches playing straight through',
      (targetTick) => {
        const built = createReplayPlayer(fixture);
        expect(built.ok).toBe(true);
        if (!built.ok) return;
        const { player } = built;

        player.seek(targetTick);
        // seek never overshoots: it stops at targetTick, or earlier if the round had already ended.
        expect(player.tick).toBeLessThanOrEqual(targetTick);

        playToEnd(player);

        expect(player.getEvents()).toEqual(full.events);
        expect(player.tick).toBe(full.lastTick);
        expect(player.phase).toBe(PHASES.ROUND_OVER);
      },
    );

    it('seeking to N gives the same state as stepping there one tick at a time from 0', () => {
      const targetTick = Math.floor(full.lastTick / 2);

      const seeked = createReplayPlayer(fixture);
      const stepped = createReplayPlayer(fixture);
      expect(seeked.ok).toBe(true);
      expect(stepped.ok).toBe(true);
      if (!seeked.ok || !stepped.ok) return;

      seeked.player.seek(targetTick);
      while (stepped.player.tick < targetTick && stepped.player.step()) {
        /* stepping to the same tick by hand */
      }

      expect(seeked.player.tick).toBe(stepped.player.tick);
      expect(seeked.player.phase).toBe(stepped.player.phase);
      expect(seeked.player.getEvents()).toEqual(stepped.player.getEvents());
      expect(seeked.player.getSnapshot()).toEqual(stepped.player.getSnapshot());
    });

    it('seeking backward after playing forward still replays from the start, not from where playback was', () => {
      // Demonstrates seek is a real re-run, not an incremental resume: if it only rewound a live sim's own
      // counters instead of rebuilding, seeking back below a tick already passed would carry stale state
      // (e.g. an input already applied, or a snake already dead) forward with it.
      const built = createReplayPlayer(fixture);
      expect(built.ok).toBe(true);
      if (!built.ok) return;
      const { player } = built;

      playToEnd(player);
      const forwardTick = Math.floor(full.lastTick / 2);
      player.seek(forwardTick);

      expect(player.tick).toBe(forwardTick);
      expect(player.getEvents()).toEqual(full.events.filter((event) => event.tick <= forwardTick));
    });
  });

  it('KI-05-02 tech-lead note E: a seed: null replay is refused, not played', () => {
    const replay = { seed: null, settingsOverrides: {}, inputs: [], expectedEvents: [] };
    const built = createReplayPlayer(replay);
    expect(built.ok).toBe(false);
    if (built.ok) return;
    expect(built.error.code).toBe(REPLAY_PLAYER_ERROR_CODES.NO_SEED);
    expect(typeof built.error.message).toBe('string');
  });

  it('forwards parseReplay JSON/shape errors verbatim (tech-lead note F: one entry point)', () => {
    const brokenJson = createReplayPlayer('{not valid json');
    expect(brokenJson.ok).toBe(false);
    if (!brokenJson.ok) expect(brokenJson.error.code).toBe(REPLAY_ERROR_CODES.INVALID_JSON);

    const wrongVersion = createReplayPlayer({
      version: 2,
      seed: 1,
      inputs: [],
      expectedEvents: [],
    });
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok)
      expect(wrongVersion.error.code).toBe(REPLAY_ERROR_CODES.UNSUPPORTED_VERSION);
  });

  it('accepts JSON text the same as an already-parsed object (tech-lead note F)', () => {
    const fixture = /** @type {any} */ (
      fixtures.find((entry) => entry.file === 'no-input-round.json')
    ).replay;
    const fromObject = createReplayPlayer(fixture);
    const fromText = createReplayPlayer(JSON.stringify(fixture));
    expect(fromObject.ok).toBe(true);
    expect(fromText.ok).toBe(true);
    if (!fromObject.ok || !fromText.ok) return;

    playToEnd(fromObject.player);
    playToEnd(fromText.player);
    expect(fromText.player.getEvents()).toEqual(fromObject.player.getEvents());
  });

  it('KI-05-02 AC3 (structural): the player exposes no way to apply an input outside the recorded log', () => {
    // The real AC3 guarantee — a live keydown must not reach the simulation — is proved at the session/e2e
    // level (`tests/e2e/replay.spec.js`), since it depends on a real keyboard listener this module never
    // has. What this module *can* guarantee on its own is that its own public surface has no `applyInput` (or
    // similarly-shaped) method for anything but the replay's own recorded inputs to reach the simulation
    // through.
    const built = createReplayPlayer({
      seed: 1,
      settingsOverrides: {},
      inputs: [],
      expectedEvents: [],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const player = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (built.player));
    expect(player.applyInput).toBeUndefined();
    expect(player.queueDirection).toBeUndefined();
  });
});
