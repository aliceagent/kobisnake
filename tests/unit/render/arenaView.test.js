import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  cellToWorld,
  createArenaView,
  FLOOR_THICKNESS,
  setWorldFromGrid,
  WALL_HEIGHT,
  yawFromGridDirection,
} from '../../../src/render/arenaView.js';
import { COLORS } from '../../../src/render/materials.js';
import { SETTINGS } from '../../../src/core/settings.js';
import { DIRECTIONS } from '../../../src/core/grid.js';

function instanceMatrix(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return matrix;
}

describe('cellToWorld', () => {
  it('puts a cell at the centre of its square', () => {
    const position = cellToWorld({ x: 0, y: 0 }, { width: 24, height: 24 });
    expect(position.x).toBe(0.5);
    expect(position.z).toBe(23.5);
  });

  it('flips the grid y axis so "up the board" is "up the screen"', () => {
    const grid = { width: 24, height: 24 };
    const low = cellToWorld({ x: 5, y: 0 }, grid);
    const high = cellToWorld({ x: 5, y: 23 }, grid);

    // The camera stands on the +z side looking toward −z (`render/camera.js`), so a larger grid y must give a
    // smaller world z or the board would be drawn upside down.
    expect(high.z).toBeLessThan(low.z);
  });

  it('keeps the whole board inside the square the camera frames', () => {
    const grid = SETTINGS.grid;
    for (const cell of [
      { x: 0, y: 0 },
      { x: grid.width - 1, y: grid.height - 1 },
    ]) {
      const position = cellToWorld(cell, grid);
      expect(position.x).toBeGreaterThan(0);
      expect(position.x).toBeLessThan(grid.width);
      expect(position.z).toBeGreaterThan(0);
      expect(position.z).toBeLessThan(grid.height);
    }
  });

  it('setWorldFromGrid agrees with cellToWorld and takes fractional cells', () => {
    const grid = SETTINGS.grid;
    const out = new THREE.Vector3();
    setWorldFromGrid(out, 5, 12, grid, 0.35);
    const expected = cellToWorld({ x: 5, y: 12 }, grid, 0.35);
    expect(out.toArray()).toEqual(expected.toArray());

    setWorldFromGrid(out, 5.5, 12, grid);
    expect(out.x).toBe(6);
  });
});

describe('yawFromGridDirection', () => {
  it('turns each grid direction into a heading a mesh can face', () => {
    const yawOf = (dir) => yawFromGridDirection(dir.dx, dir.dy);
    const forward = (yaw) =>
      new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

    // Grid RIGHT is world +x; grid UP is world −z (the flipped axis).
    expect(forward(yawOf(DIRECTIONS.RIGHT)).x).toBeCloseTo(1, 9);
    expect(forward(yawOf(DIRECTIONS.LEFT)).x).toBeCloseTo(-1, 9);
    expect(forward(yawOf(DIRECTIONS.UP)).z).toBeCloseTo(-1, 9);
    expect(forward(yawOf(DIRECTIONS.DOWN)).z).toBeCloseTo(1, 9);
  });
});

describe('createArenaView', () => {
  it('lays one tile per cell, in a single instanced draw call', () => {
    const arena = createArenaView();

    expect(arena.floor.count).toBe(SETTINGS.grid.width * SETTINGS.grid.height);
    expect(arena.floor.count).toBe(576);
    expect(arena.floor).toBeInstanceOf(THREE.InstancedMesh);
  });

  it('alternates the two floor greens from the materials bible', () => {
    const arena = createArenaView();
    const color = new THREE.Color();

    // Cell (0,0) is instance 0 and cell (1,0) is instance 1: neighbours, so they must differ.
    arena.floor.getColorAt(0, color);
    expect(color.getHex()).toBe(COLORS.floorGreen);
    arena.floor.getColorAt(1, color);
    expect(color.getHex()).toBe(COLORS.floorGreenAlt);

    // And the material itself is white, or three would multiply the tint into the instance colours.
    expect(arena.floor.material.color.getHex()).toBe(COLORS.instanceBase);
  });

  it('puts the top of the floor at y = 0, so everything else stands on zero', () => {
    const arena = createArenaView();
    const position = new THREE.Vector3().setFromMatrixPosition(instanceMatrix(arena.floor, 0));

    expect(position.y).toBeCloseTo(-FLOOR_THICKNESS / 2, 6);
    expect(position.y + FLOOR_THICKNESS / 2).toBeCloseTo(0, 6);
  });

  it('rings the board with four wall slabs in one draw call, corners covered', () => {
    const arena = createArenaView();
    expect(arena.walls.count).toBe(4);

    const scales = [0, 1, 2, 3].map((i) =>
      new THREE.Vector3().setFromMatrixScale(instanceMatrix(arena.walls, i)),
    );
    // The two slabs running along x are two cells longer than the board, which is what fills the corners.
    expect(scales[0].x).toBe(SETTINGS.grid.width + 2);
    expect(scales[1].x).toBe(SETTINGS.grid.width + 2);
    expect(scales[2].z).toBe(SETTINGS.grid.height);
    expect(scales[3].z).toBe(SETTINGS.grid.height);
    for (const scale of scales) expect(scale.y).toBe(WALL_HEIGHT);
  });

  it('stands the walls just outside the play area, never on a playable cell', () => {
    const arena = createArenaView();
    const grid = SETTINGS.grid;
    const positions = [0, 1, 2, 3].map((i) =>
      new THREE.Vector3().setFromMatrixPosition(instanceMatrix(arena.walls, i)),
    );

    expect(positions[0].z).toBeLessThan(0);
    expect(positions[1].z).toBeGreaterThan(grid.height);
    expect(positions[2].x).toBeLessThan(0);
    expect(positions[3].x).toBeGreaterThan(grid.width);
  });

  it('has exactly one shadow-casting light (ARCHITECTURE §7: "nothing else casts")', () => {
    const arena = createArenaView();
    const casters = [];
    arena.group.traverse((object) => {
      if (object instanceof THREE.Light && object.castShadow) casters.push(object);
    });

    expect(casters).toHaveLength(1);
    expect(casters[0]).toBe(arena.keyLight);
    expect(arena.keyLight.shadow.mapSize.width).toBe(2048);
    expect(arena.keyLight.color.getHex()).toBe(COLORS.keyLight);
    expect(arena.keyLight.intensity).toBe(2.2);
  });

  it('fills with a hemisphere light at the materials-bible colours and intensity', () => {
    const arena = createArenaView();
    const fill = arena.group.children.find((child) => child instanceof THREE.HemisphereLight);

    expect(fill).toBeDefined();
    expect(fill.color.getHex()).toBe(COLORS.skyFill);
    expect(fill.groundColor.getHex()).toBe(COLORS.groundFill);
    expect(fill.intensity).toBe(0.8);
  });

  it('receives shadows on the floor and casts them from the walls', () => {
    const arena = createArenaView();
    expect(arena.floor.receiveShadow).toBe(true);
    expect(arena.walls.castShadow).toBe(true);
  });

  it('builds without logging anything to the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      createArenaView().dispose();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('scales to a different arena size without hard-coded 24s', () => {
    const arena = createArenaView({ grid: { width: 6, height: 6 } });
    expect(arena.floor.count).toBe(36);
    const scale = new THREE.Vector3().setFromMatrixScale(instanceMatrix(arena.walls, 0));
    expect(scale.x).toBe(8);
  });

  it('dispose() releases its geometry and materials', () => {
    const arena = createArenaView();
    const disposed = [];
    for (const target of [arena.floor.geometry, arena.walls.geometry, arena.floor.material]) {
      target.addEventListener('dispose', () => disposed.push(target));
    }

    arena.dispose();
    expect(disposed).toHaveLength(3);
  });
});
