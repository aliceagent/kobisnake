import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createSnakeView, MAX_BEND_DEGREES } from '../../../src/render/snakeView.js';
import { cellToWorld, yawFromGridDirection } from '../../../src/render/arenaView.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { DIRECTIONS } from '../../../src/core/grid.js';
import { SETTINGS } from '../../../src/core/settings.js';

/**
 * A snake snapshot shaped exactly like `RoundSimulation.getState().snakes[i]`, so a test can pose a snake in
 * a position the simulation would take many ticks to reach.
 *
 * @param {{x: number, y: number}[]} cells - current cells, head first
 * @param {{x: number, y: number}[]} [previous] - defaults to the same cells (a snake that has not moved)
 * @param {number} [stepProgress]
 */
function snakeSnapshot(cells, previous = cells, stepProgress = 0) {
  const head = cells[0];
  const behind = cells[1] ?? head;
  return {
    id: 'p1',
    alive: true,
    direction: { dx: Math.sign(head.x - behind.x), dy: Math.sign(head.y - behind.y) },
    segments: cells.map((cell) => ({ ...cell })),
    previousSegments: previous.map((cell) => ({ ...cell })),
    stepProgress,
  };
}

/** A straight snake of `length` cells running left from `(x, y)`, i.e. travelling right. */
function straightSnake(length, x = 10, y = 10) {
  return Array.from({ length }, (_, i) => ({ x: x - i, y }));
}

/** The world-space position of instance `i` of an InstancedMesh. */
function instancePosition(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

/** The world-space scale of instance `i` of an InstancedMesh. */
function instanceScale(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix);
}

/**
 * The yaw of instance `i`, in degrees. The matrix has to be *decomposed* rather than read as a rotation
 * matrix: segments are scaled non-uniformly (0.9 x 0.7 x 0.9), and `setFromRotationMatrix` on a scaled matrix
 * reports an angle several degrees off.
 */
function instanceYawDegrees(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  const quaternion = new THREE.Quaternion();
  matrix.decompose(new THREE.Vector3(), quaternion, new THREE.Vector3());
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  return THREE.MathUtils.radToDeg(euler.y);
}

/** Run a fresh seeded round forward by whole simulation ticks. */
function runTicks(sim, ticks) {
  for (let i = 0; i < ticks; i += 1) sim.advance(1 / SETTINGS.simHz);
  return sim.getState();
}

describe('SnakeView', () => {
  it('KS-03-04 AC1: snakes glide — the head sits at the lerp of its previous and current cells', () => {
    const view = createSnakeView({ colorName: 'red' });
    const cells = straightSnake(4);
    const previous = cells.map((cell) => ({ x: cell.x - 1, y: cell.y }));

    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      view.update(snakeSnapshot(cells, previous, progress));
      const expectedGridX = previous[0].x + (cells[0].x - previous[0].x) * progress;
      const expected = cellToWorld({ x: expectedGridX, y: cells[0].y }, SETTINGS.grid);

      expect(view.headPosition.x).toBeCloseTo(expected.x, 9);
      expect(view.headPosition.z).toBeCloseTo(expected.z, 9);
      // The ticket's tolerance, stated as the ticket states it.
      expect(Math.abs(view.headPosition.x - expected.x)).toBeLessThan(0.02);
    }
  });

  it('KS-03-04 AC1: the head glides at stepProgress 0.25/0.5/0.75 of a real seeded round', () => {
    // The same assertion, but with the simulation rather than a hand-built snapshot behind it, so an
    // interpolation that only works for tidy synthetic input cannot pass. At 6 cells/s and 120 Hz a step is
    // one cell every 20 ticks, so tick 5, 10 and 15 of a step are exactly 0.25, 0.5 and 0.75 through it.
    const view = createSnakeView({ colorName: 'red' });
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    runTicks(sim, 20); // finish one whole step, so `previousSegments` is a real previous position

    for (const ticksIntoStep of [5, 10, 15]) {
      const state = runTicks(sim, ticksIntoStep === 5 ? 5 : 5);
      const snake = state.snakes[0];
      expect(snake.stepProgress).toBeCloseTo(ticksIntoStep / 20, 9);

      view.update(snake);
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

  it('KS-03-04 AC1: every segment follows the path of the segment in front of it', () => {
    // The key principle of `09-snake-turning-animation.png`. Half way through a step, each segment should be
    // exactly half way between where the segment behind it is and where it is going.
    const view = createSnakeView();
    const cells = straightSnake(5);
    const previous = cells.map((cell) => ({ x: cell.x - 1, y: cell.y }));
    view.update(snakeSnapshot(cells, previous, 0.5));

    for (let i = 0; i < cells.length; i += 1) {
      const expected = cellToWorld({ x: cells[i].x - 0.5, y: cells[i].y }, SETTINGS.grid);
      const drawn = instancePosition(view.segments, i);
      expect(drawn.x).toBeCloseTo(expected.x, 5);
      expect(drawn.z).toBeCloseTo(expected.z, 5);
    }
  });

  it('KS-03-04 AC2: a 20-segment snake renders in 3 draw calls', () => {
    const view = createSnakeView();
    view.update(snakeSnapshot(straightSnake(20)));

    expect(view.segments.count).toBe(20);
    expect(view.drawCalls).toBe(3);
    expect(view.drawCalls).toBeLessThanOrEqual(3);
    // The head is instance 0 of the same InstancedMesh as the body — that is what keeps it to three.
    expect(view.group.children).toHaveLength(3);
  });

  it('KS-03-04 AC2: the draw-call count does not grow with the snake', () => {
    const view = createSnakeView();
    for (const length of [4, 20, 60, 200]) {
      view.update(snakeSnapshot(straightSnake(length, 220, 10)));
      expect(view.drawCalls).toBe(3);
    }
  });

  it('KS-03-04 AC3: the eyes face the direction of travel on the same frame as the turn', () => {
    const view = createSnakeView();
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    runTicks(sim, 20);

    // Travelling right: the head faces +x.
    view.update(sim.getState().snakes[0]);
    expect(view.headYaw).toBeCloseTo(yawFromGridDirection(1, 0), 9);

    // Turn up. The very next state after the step commits must already show the new heading — that is what
    // "within one frame" means, and it holds because the yaw is derived from the snapshot rather than eased.
    sim.applyInput('p1', DIRECTIONS.UP);
    const before = sim.getState().snakes[0].segments[0];
    let turned = null;
    for (let i = 0; i < 25 && turned === null; i += 1) {
      sim.advance(1 / SETTINGS.simHz);
      const snake = sim.getState().snakes[0];
      if (snake.segments[0].y !== before.y) turned = snake;
    }
    expect(turned).not.toBeNull();

    view.update(turned);
    expect(view.headYaw).toBeCloseTo(yawFromGridDirection(0, 1), 9);

    // And the eyes really are on the leading face: both sit ahead of the head along the new heading.
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      view.headYaw,
    );
    for (const eye of [0, 1]) {
      const offset = instancePosition(view.eyes, eye).sub(view.headPosition);
      expect(offset.dot(forward)).toBeGreaterThan(0);
      // Grid +y is world −z, so "facing up the board" is facing −z.
      expect(offset.z).toBeLessThan(0);
    }
  });

  it('KS-03-04 AC3: pupils sit in front of the eye whites, not inside them', () => {
    const view = createSnakeView();
    view.update(snakeSnapshot(straightSnake(4)));

    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      view.headYaw,
    );
    for (const eye of [0, 1]) {
      const white = instancePosition(view.eyes, eye);
      const pupil = instancePosition(view.pupils, eye);
      expect(pupil.clone().sub(white).dot(forward)).toBeGreaterThan(0);
      expect(instanceScale(view.pupils, eye).x).toBeLessThan(instanceScale(view.eyes, eye).x);
    }
  });

  it('KS-03-04 AC4: building and updating a view logs nothing to the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = createSnakeView({ colorName: 'blue' });
      view.update(snakeSnapshot(straightSnake(20)));
      view.dispose();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  describe('corner bending (09-snake-turning-animation.png)', () => {
    it('leaves a straight segment pointing straight down its own direction', () => {
      const view = createSnakeView();
      view.update(snakeSnapshot(straightSnake(5)));

      const straightYaw = THREE.MathUtils.radToDeg(yawFromGridDirection(1, 0));
      expect(instanceYawDegrees(view.segments, 2)).toBeCloseTo(straightYaw, 4);
    });

    it('rotates a corner segment toward the bisector, and never past the 20° cap', () => {
      const view = createSnakeView();
      // Turning up: head at (10,12), then (10,11), then the body trails away to the left.
      const cells = [
        { x: 10, y: 12 },
        { x: 10, y: 11 },
        { x: 9, y: 11 },
        { x: 8, y: 11 },
      ];
      view.update(snakeSnapshot(cells));

      const cornerYaw = instanceYawDegrees(view.segments, 1);
      const outgoing = THREE.MathUtils.radToDeg(yawFromGridDirection(0, 1));
      const bend = Math.abs(cornerYaw - outgoing);

      expect(bend).toBeGreaterThan(0);
      expect(bend).toBeCloseTo(MAX_BEND_DEGREES, 4);
      expect(bend).toBeLessThanOrEqual(MAX_BEND_DEGREES + 1e-4);
      // The straight segment behind the corner is not bent at all. A segment points the way it is heading —
      // toward the segment in front of it — so a body trailing away to the left points right.
      expect(instanceYawDegrees(view.segments, 2)).toBeCloseTo(
        THREE.MathUtils.radToDeg(yawFromGridDirection(1, 0)),
        4,
      );
    });

    it('bends the other way for the opposite turn', () => {
      const view = createSnakeView();
      const up = [
        { x: 10, y: 12 },
        { x: 10, y: 11 },
        { x: 9, y: 11 },
      ];
      const down = [
        { x: 10, y: 10 },
        { x: 10, y: 11 },
        { x: 9, y: 11 },
      ];

      view.update(snakeSnapshot(up));
      const upBend =
        instanceYawDegrees(view.segments, 1) - THREE.MathUtils.radToDeg(yawFromGridDirection(0, 1));
      view.update(snakeSnapshot(down));
      const downBend =
        instanceYawDegrees(view.segments, 1) -
        THREE.MathUtils.radToDeg(yawFromGridDirection(0, -1));

      expect(Math.sign(upBend)).toBe(-Math.sign(downBend));
      expect(Math.abs(upBend)).toBeCloseTo(Math.abs(downBend), 4);
    });
  });

  describe('growth', () => {
    it('scales a new tail segment from 0 to 1 across its first step', () => {
      const view = createSnakeView();
      // What `Snake.commitStep` produces on a growth step: the old tail cell is duplicated into
      // `previousSegments`, so the new segment is stationary and the two arrays stay the same length.
      const cells = [
        { x: 11, y: 10 },
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 },
      ];
      const previous = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 8, y: 10 },
        { x: 8, y: 10 },
      ];

      const scales = [0, 0.5, 1].map((progress) => {
        view.update(snakeSnapshot(cells, previous, progress));
        return instanceScale(view.segments, cells.length - 1).x;
      });

      expect(scales[0]).toBeCloseTo(0, 6);
      expect(scales[1]).toBeCloseTo(scales[2] / 2, 6);
      expect(scales[2]).toBeCloseTo(0.9, 6);
      expect(scales[1]).toBeGreaterThan(scales[0]);
    });

    it('grows the new segment out of the tail rather than from somewhere else', () => {
      const view = createSnakeView();
      const cells = [
        { x: 11, y: 10 },
        { x: 10, y: 10 },
        { x: 9, y: 10 },
      ];
      const previous = [
        { x: 10, y: 10 },
        { x: 9, y: 10 },
        { x: 9, y: 10 },
      ];
      view.update(snakeSnapshot(cells, previous, 0.5));

      const expected = cellToWorld({ x: 9, y: 10 }, SETTINGS.grid);
      const drawn = instancePosition(view.segments, 2);
      expect(drawn.x).toBeCloseTo(expected.x, 5);
      expect(drawn.z).toBeCloseTo(expected.z, 5);
    });

    it('does not shrink an ordinary tail segment', () => {
      const view = createSnakeView();
      const cells = straightSnake(4);
      const previous = cells.map((cell) => ({ x: cell.x - 1, y: cell.y }));
      view.update(snakeSnapshot(cells, previous, 0.5));

      expect(instanceScale(view.segments, 3).x).toBeCloseTo(0.9, 6);
    });
  });

  describe('death', () => {
    it('leaves a dead snake frozen on the last cells it legally occupied', () => {
      const view = createSnakeView();
      const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
      // The no-input round: both snakes run into opposite walls on the same step, at tick 380.
      for (let i = 0; i < 400 && sim.phase === 'PLAYING'; i += 1) sim.advance(1 / SETTINGS.simHz);
      const dead = sim.getState().snakes[0];

      expect(dead.alive).toBe(false);
      view.update(dead);

      // The head is inside the arena, not in the wall it hit: the fatal step was never committed.
      expect(dead.segments[0].x).toBeLessThan(SETTINGS.grid.width);
      const expected = cellToWorld(dead.segments[0], SETTINGS.grid);
      expect(view.headPosition.x).toBeCloseTo(expected.x, 6);
      expect(view.segments.count).toBe(dead.segments.length);
    });
  });

  describe('sizes and materials', () => {
    it('draws the head bigger than a body segment, at the sizes the ticket fixes', () => {
      const view = createSnakeView();
      view.update(snakeSnapshot(straightSnake(4)));

      const head = instanceScale(view.segments, 0);
      const body = instanceScale(view.segments, 1);
      expect(head.x).toBeCloseTo(1, 6);
      expect(head.y).toBeCloseTo(0.85, 6);
      expect(body.x).toBeCloseTo(0.9, 6);
      expect(body.y).toBeCloseTo(0.7, 6);
    });

    it('stands every brick on the floor rather than half-sunk into it', () => {
      const view = createSnakeView();
      view.update(snakeSnapshot(straightSnake(4)));

      expect(instancePosition(view.segments, 0).y).toBeCloseTo(0.425, 6);
      expect(instancePosition(view.segments, 1).y).toBeCloseTo(0.35, 6);
    });

    it('takes its colour from the catalogue, by name', () => {
      const red = createSnakeView({ colorName: 'red' });
      const blue = createSnakeView({ colorName: 'blue' });

      expect(`#${red.bodyMaterial.color.getHexString()}`.toUpperCase()).toBe(SETTINGS.colors.red);
      expect(`#${blue.bodyMaterial.color.getHexString()}`.toUpperCase()).toBe(SETTINGS.colors.blue);
    });

    it('rejects a colour that is not in the catalogue', () => {
      expect(() => createSnakeView({ colorName: 'chartreuse' })).toThrow(/SETTINGS.colors/);
    });
  });

  it('dispose() releases the geometry and materials it owns', () => {
    const view = createSnakeView();
    const disposed = [];
    for (const target of [view.segments.geometry, view.eyeGeometry, view.bodyMaterial]) {
      target.addEventListener('dispose', () => disposed.push(target));
    }

    view.dispose();

    expect(disposed).toHaveLength(3);
    expect(view.group.children).toHaveLength(0);
  });
});
