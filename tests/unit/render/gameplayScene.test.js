import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createGameplayScene } from '../../../src/render/renderer.js';
import { cellToWorld } from '../../../src/render/arenaView.js';
import { COLORS } from '../../../src/render/materials.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/**
 * The scene composition, without WebGL. `createGameplayScene` is deliberately split out of
 * `createGameplayRenderer` so everything except the `WebGLRenderer` itself can be asserted on in Node; the
 * GPU half is covered by the e2e and visual suites (KS-03-07).
 */

/** Advance a round by whole simulation ticks and return the snapshot. */
function runTicks(sim, ticks) {
  for (let i = 0; i < ticks; i += 1) sim.advance(1 / SETTINGS.simHz);
  return sim.getState();
}

describe('createGameplayScene', () => {
  it('builds the arena, one view per player and the pickups', () => {
    const composition = createGameplayScene({ reducedFx: true });

    expect(composition.snakes).toHaveLength(2);
    expect(composition.snakes[0].colorName).toBe('red');
    expect(composition.snakes[1].colorName).toBe('blue');
    expect(composition.scene.background.getHex()).toBe(COLORS.skyFill);
    expect(composition.camera.fov).toBe(SETTINGS.camera.fov);
  });

  it('KS-04-03: the real composition exposes a camera with pulseLaserWarning (session.js calls it optionally)', () => {
    // `session.js`'s `renderer.camera?.pulseLaserWarning()` is optional-chained because `src/game/` cannot
    // import three.js and therefore cannot assert the real shape at that call site — so nothing there would
    // fail if `createGameplayScene` ever stopped building a camera, or the camera lost this method. This is
    // the one place that actually builds the real composition in Node and can pin that connected half down.
    const composition = createGameplayScene({ reducedFx: true });

    expect(composition.camera).toBeDefined();
    expect(typeof composition.camera.pulseLaserWarning).toBe('function');
  });

  it('KS-03-04 AC2: the whole scene stays inside the ARCHITECTURE §12 draw-call budget', () => {
    const composition = createGameplayScene({ reducedFx: true });
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    composition.update(runTicks(sim, 60));

    // Two snakes at three each, four apples at two, the floor and the wall ring at one each.
    const snakeCalls = composition.snakes.reduce((total, view) => total + view.drawCalls, 0);
    const total = snakeCalls + composition.pickups.drawCalls + 2;

    expect(snakeCalls).toBe(6);
    expect(total).toBe(10);
    expect(total).toBeLessThanOrEqual(120);
  });

  it('KS-03-04 AC1: drives both snakes from one snapshot', () => {
    const composition = createGameplayScene({ reducedFx: true });
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    const state = runTicks(sim, 30);

    composition.update(state, 1 / 60);

    for (const [index, view] of composition.snakes.entries()) {
      const snake = state.snakes[index];
      const from = snake.previousSegments[0];
      const to = snake.segments[0];
      const expected = cellToWorld(
        {
          x: from.x + (to.x - from.x) * snake.stepProgress,
          y: from.y + (to.y - from.y) * snake.stepProgress,
        },
        SETTINGS.grid,
      );
      expect(Math.abs(view.headPosition.x - expected.x)).toBeLessThan(0.02);
      expect(Math.abs(view.headPosition.z - expected.z)).toBeLessThan(0.02);
    }
  });

  it('KS-03-04 AC4: a whole round can be pushed through the scene without a console warning', () => {
    // Every frame of a whole 90-second round at 60 fps, including the growth steps, the turns and the death
    // at the end. A three.js deprecation or a bad uniform would print here, and `QA-STRATEGY §8` wants zero.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const composition = createGameplayScene({ reducedFx: true });
      const sim = new RoundSimulation({ seed: 7, players: [{ id: 'p1' }, { id: 'p2' }] });
      const turns = [DIRECTIONS.UP, DIRECTIONS.LEFT, DIRECTIONS.DOWN, DIRECTIONS.RIGHT];

      for (let frame = 0; frame < 60 * 90; frame += 1) {
        if (frame % 37 === 0) sim.applyInput('p1', turns[(frame / 37) % turns.length]);
        if (frame % 53 === 0) sim.applyInput('p2', turns[(frame / 53) % turns.length]);
        sim.advance(1 / 60);
        composition.update(sim.getState(), 1 / 60);
      }
      composition.dispose();

      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('draws nothing for a player the snapshot does not have', () => {
    const composition = createGameplayScene({ reducedFx: true, playerColors: ['red', 'blue'] });
    const sim = new RoundSimulation({
      seed: 1,
      players: [{ id: 'p1' }],
      mode: 'practice',
    });

    composition.update(sim.getState());

    expect(composition.snakes[0].segments.count).toBe(SETTINGS.startingSnakeLength);
    expect(composition.snakes[1].segments.count).toBe(0);
    expect(composition.snakes[1].drawCalls).toBe(0);
  });

  it('passes the frame time to the camera so shake and zoom decay', () => {
    const composition = createGameplayScene({ reducedFx: false });
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });

    composition.camera.shake(0.15, 0.3);
    composition.update(sim.getState(), 0.05);
    expect(composition.camera.position.distanceTo(composition.camera.basePosition)).toBeGreaterThan(
      0,
    );

    for (let i = 0; i < 10; i += 1) composition.update(sim.getState(), 0.05);
    expect(composition.camera.position.distanceTo(composition.camera.basePosition)).toBe(0);
  });

  it('adds every view to the scene, and dispose() empties it', () => {
    const composition = createGameplayScene({ reducedFx: true });
    const groups = composition.scene.children.filter((child) => child instanceof THREE.Group);
    expect(groups).toHaveLength(5); // arena, two snakes, pickups, lasers (KS-04-02)

    composition.dispose();
    expect(composition.scene.children).toHaveLength(0);
  });

  it('KS-04-02: the laser view stays hidden and costs nothing before the lasers exist', () => {
    const composition = createGameplayScene({ reducedFx: true });
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    composition.update(runTicks(sim, 60));

    expect(composition.lasers.drawCalls).toBe(0);
  });

  it('KS-04-02: the floor darkens in step with the beams once the lasers are closing', () => {
    const composition = createGameplayScene({ reducedFx: true });
    const sim = new RoundSimulation({
      seed: 1,
      players: [{ id: 'p1' }, { id: 'p2' }],
      settings: withOverrides({ godMode: true, snakeSpeed: 0 }),
    });

    // Straight to a moment well into CLOSING: `advance` runs on simulated time regardless of how many real
    // ticks that takes, so one big call reaches the same state a real round would (`core/round.js`).
    sim.advance(SETTINGS.roundDuration - 10); // 10 s remaining: inset 7 (`DESIGN-DECISIONS §2.4`)
    const state = sim.getState();
    expect(state.lasers.inset).toBe(7);

    composition.update(state);

    expect(composition.lasers.drawCalls).toBe(2); // beams + emitters; CLOSING has no arrows
    // `?reducedFx=1` skips the glide outright, so the floor is already at the sim's own inset.
    const color = new THREE.Color();
    composition.arena.floor.getColorAt(0, color); // cell (0,0): inside the dead zone at inset 6
    expect(color.getHex()).not.toBe(COLORS.floorGreen);
  });
});
