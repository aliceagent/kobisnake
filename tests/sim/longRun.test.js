// @ts-check
import { describe, expect, it } from 'vitest';
import { PHASES } from '../../src/core/events.js';
import { RoundSimulation } from '../../src/core/round.js';
import { SETTINGS, withOverrides } from '../../src/core/settings.js';

/**
 * KI-09-04 — long-run tick and clock stability
 * (`docs/sprints/improvement-09-determinism-across-browsers.md`).
 *
 * `round.js`'s clock is an integer tick count, and `elapsed`/`timeRemaining` are *derived* from it
 * (`tick / simHz`) rather than kept as a running float sum — that is the whole design reason a round never
 * drifts, per that file's own module comment. This file is the long-horizon proof of it: AC1 drives a round
 * 100 000 ticks past its natural end (and a match of fresh rounds after it) checking `elapsed === tick / simHz`
 * exactly the whole way, and AC2 pins the one equivalence `advance`'s own doc comment actually claims — one
 * big `advance` call agreeing with many one-tick calls — **and** the one duration it explicitly does not
 * claim this for, so nobody later widens AC2 into a promise the engine never made.
 *
 * `tests/sim/**` runs under `npm run test:unit`; there is no separate `test:sim` script (`CLAUDE.md`).
 */

const TWO_PLAYERS = [
  { id: 'p1', color: 'red' },
  { id: 'p2', color: 'blue' },
];

/**
 * A round nobody can lose and nobody moves, built to survive far past this file's 100 000-tick horizon:
 * `snakeSpeed: 0` + `godMode: true` is this repository's standing recipe for a round nobody can lose
 * (`tests/unit/core/powerups.test.js`'s `frozenRound`, `tests/unit/game/session.test.js`). `roundDuration` is
 * raised well past 100 000 ticks (833.3 s at `simHz` 120) so the round never ends on `TIMEOUT` before AC1's
 * assertions do — raising it here is an override tree inside a test, not a change to the tunable itself
 * (`CLAUDE.md` "the never list").
 *
 * @param {number} seed
 * @returns {RoundSimulation}
 */
function immortalRound(seed) {
  return new RoundSimulation({
    settings: withOverrides({ snakeSpeed: 0, godMode: true, roundDuration: 100_000 }),
    seed,
    players: TWO_PLAYERS,
  });
}

describe('KI-09-04 long-run tick and clock stability', () => {
  it('KI-09-04 AC1: after 100,000 ticks, elapsed equals tick / simHz exactly', () => {
    const sim = immortalRound(1);
    const simHz = sim.settings.simHz;

    for (let tick = 1; tick <= 100_000; tick += 1) {
      sim.advance(sim.tickDuration);
      // Every tick is still driven one at a time (never a single big `advance(100_000 / simHz)`, which would
      // just re-run AC2's own claim) but only sampled by `expect` every 10 000 ticks: that is enough for a
      // failure to report *where* drift started, per the tech-lead note on #167, without turning this file
      // into 100 000 assertions.
      if (tick % 10_000 === 0) {
        expect(sim.tick).toBe(tick);
        // `toBe`, never `toBeCloseTo` — the property under test is exactness, not proximity (`round.js`'s own
        // doc comment on `elapsed` and on `advance`).
        expect(sim.elapsed).toBe(tick / simHz);
      }
    }

    expect(sim.tick).toBe(100_000);
    expect(sim.elapsed).toBe(100_000 / simHz);
    // Confirms the raised roundDuration actually did its job: a round that had quietly hit TIMEOUT somewhere
    // in the middle would still leave `tick` and `elapsed` in lockstep (simulateTick's guard on `phase` stops
    // moving both at once), so this is what catches that failure mode instead.
    expect(sim.phase).toBe(PHASES.PLAYING);
  });

  it('KI-09-04 AC1: a match of many rounds — every fresh RoundSimulation keeps the same exact clock', () => {
    // The test above only proves the guarantee for one long-lived instance. This shows it is a property of
    // `RoundSimulation` itself, not of state one particular run happened to accumulate, by checking it again
    // from scratch across many independently constructed rounds (the tech-lead note's "survive a fresh
    // RoundSimulation"). Ticks-per-round is kept well below AC1's own 100 000 so this second half stays cheap.
    const ROUNDS = 25;
    const TICKS_PER_ROUND = 4_000; // 33.3 s per round

    for (let seed = 0; seed < ROUNDS; seed += 1) {
      const sim = immortalRound(seed);
      for (let tick = 1; tick <= TICKS_PER_ROUND; tick += 1) {
        sim.advance(sim.tickDuration);
        if (tick % 1_000 === 0) {
          expect(sim.tick).toBe(tick);
          expect(sim.elapsed).toBe(tick / sim.settings.simHz);
        }
      }
      expect(sim.tick).toBe(TICKS_PER_ROUND);
      expect(sim.elapsed).toBe(TICKS_PER_ROUND / sim.settings.simHz);
    }
  });

  it('KI-09-04 AC2: one advance(90) matches 10800 advance(1/120), with lasers and power-ups actually running', () => {
    // `round.js`'s own comment on `advance` makes exactly one equivalence claim: `advance(90)` and 10 800
    // one-tick calls of `advance(1/120)` produce byte-identical logs, because `90 * 120` is exactly `10800` in
    // binary float. `tests/sim/determinism.test.js`'s existing "KS-02-05 AC3" check of the same claim uses a
    // no-input round that is over at tick 380 — comparing two copies of a 380-tick golden would satisfy AC2's
    // wording without proving much. This uses the `snakeSpeed: 0` + `godMode: true` recipe *without* raising
    // `roundDuration` off its shipping 90 s, so the round survives to the laser-closing phase
    // (`laserStartTime: 30` = 60 s in, well inside 90) and the full power-up spawn schedule before ending on
    // `TIMEOUT` — a log with real events on both sides to compare.
    const settings = withOverrides({ snakeSpeed: 0, godMode: true });
    // The exact-integer precondition `advance`'s doc comment relies on; stated here so a future change to
    // `roundDuration` or `simHz` (Fable's call, `CLAUDE.md` "the never list") that broke it would fail loudly
    // right here rather than via a mysteriously unequal event log below.
    expect(settings.roundDuration * settings.simHz).toBe(10_800);

    const oneShot = new RoundSimulation({ settings, seed: 7, players: TWO_PLAYERS });
    const oneShotEvents = [...oneShot.events, ...oneShot.advance(settings.roundDuration)];

    const ticked = new RoundSimulation({ settings, seed: 7, players: TWO_PLAYERS });
    const tickedEvents = [...ticked.events];
    for (let i = 0; i < settings.roundDuration * settings.simHz; i += 1) {
      tickedEvents.push(...ticked.advance(ticked.tickDuration));
    }

    expect(tickedEvents).toEqual(oneShotEvents);
    expect(ticked.getState()).toEqual(oneShot.getState());

    // Guards the equality above from passing vacuously (two short, near-identical logs would also be
    // `toEqual`): the round must have actually produced a laser event, so there is something non-trivial for
    // the two paths to have agreed on.
    expect(oneShotEvents.length).toBeGreaterThan(20);
    const types = new Set(oneShotEvents.map((event) => /** @type {{type: string}} */ (event).type));
    expect(types.has('LASER_STEP') || types.has('LASER_WARNING')).toBe(true);
  });

  it(
    'KI-09-04: advance is deterministic given a sequence of dts, not for an arbitrary single dt on its own ' +
      '(round.js `advance`, issue #155)',
    () => {
      // The claim AC2 does NOT make, pinned deliberately so nobody later "fixes" it into one it never made.
      // `31 * tickDuration` is the natural way to write "31 ticks' worth of time" starting from a per-tick
      // duration (the same shape issue #155 and `tests/e2e/first-playable.spec.js` document at the hook
      // level) — and it is not exactly `31/120` in binary: `(31 * (1/120)) * 120 === 30.999999999999996`, one
      // whole tick short of 31. `advance`'s `while (tickAccumulator >= 1)` loop only has 30 whole ticks to take
      // off that accumulator, and carries the ~0.9999999999999964 remainder forward rather than losing it. 31
      // separate `advance(1/120)` calls carry nothing between them: each one's `dt * simHz` is exactly `1` (a
      // reciprocal-then-back-multiply that happens to round trip exactly at this simHz), so they deliver
      // exactly 31 whole ticks between them.
      const settings = SETTINGS;
      const bigStep = new RoundSimulation({ settings, seed: 3, players: TWO_PLAYERS });
      const dt = 31 * bigStep.tickDuration;
      // The float fact the rest of this test rests on, stated as its own assertion so a future engine change
      // that made this representable exactly would surface here first.
      expect(dt * settings.simHz).not.toBe(31);
      bigStep.advance(dt);

      const smallSteps = new RoundSimulation({ settings, seed: 3, players: TWO_PLAYERS });
      for (let i = 0; i < 31; i += 1) smallSteps.advance(smallSteps.tickDuration);

      expect(bigStep.tick).toBe(30);
      expect(smallSteps.tick).toBe(31);
      expect(bigStep.tick).not.toBe(smallSteps.tick);
    },
  );
});
