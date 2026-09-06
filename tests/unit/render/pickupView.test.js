import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createPickupView } from '../../../src/render/pickupView.js';
import { cellToWorld } from '../../../src/render/arenaView.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { SETTINGS } from '../../../src/core/settings.js';

function instancePosition(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

describe('PickupView', () => {
  it('draws one apple per apple in the snapshot, at its cell', () => {
    const view = createPickupView();
    const apples = [
      { x: 0, y: 0 },
      { x: 23, y: 23 },
      { x: 12, y: 5 },
      { x: 3, y: 18 },
    ];
    view.update({ apples });

    expect(view.apples.count).toBe(4);
    apples.forEach((apple, i) => {
      const expected = cellToWorld(apple, SETTINGS.grid);
      const drawn = instancePosition(view.apples, i);
      expect(drawn.x).toBeCloseTo(expected.x, 5);
      expect(drawn.z).toBeCloseTo(expected.z, 5);
      expect(drawn.y).toBeGreaterThan(0);
    });
  });

  it('follows the four apples of a real seeded round', () => {
    const view = createPickupView();
    const sim = new RoundSimulation({ seed: 1, players: [{ id: 'p1' }, { id: 'p2' }] });
    const state = sim.getState();

    view.update(state);

    expect(state.apples).toHaveLength(SETTINGS.foodCount);
    expect(view.apples.count).toBe(SETTINGS.foodCount);
    const first = cellToWorld(state.apples[0], SETTINGS.grid);
    expect(instancePosition(view.apples, 0).x).toBeCloseTo(first.x, 5);
  });

  it('sits the leaf above its apple', () => {
    const view = createPickupView();
    view.update({ apples: [{ x: 10, y: 10 }] });

    const apple = instancePosition(view.apples, 0);
    const leaf = instancePosition(view.leaves, 0);
    expect(leaf.y).toBeGreaterThan(apple.y);
    expect(leaf.x).toBeCloseTo(apple.x, 5);
    expect(leaf.z).toBeCloseTo(apple.z, 5);
  });

  it('draws the leaf double-sided, so a tilted disc is never invisible from above', () => {
    const view = createPickupView();
    expect(view.materials.leaf.side).toBe(THREE.DoubleSide);
  });

  it('costs two draw calls whatever the apple count', () => {
    const view = createPickupView({ maxApples: 8 });
    for (const count of [1, 4, 8]) {
      view.update({ apples: Array.from({ length: count }, (_, i) => ({ x: i, y: i })) });
      expect(view.drawCalls).toBe(2);
    }
  });

  it('draws nothing when there are no apples, rather than a stale one', () => {
    const view = createPickupView();
    view.update({ apples: [{ x: 4, y: 4 }] });
    expect(view.apples.count).toBe(1);

    // `DESIGN-DECISIONS §2.3`: in the shrunken endgame a slot can legitimately have nowhere to go.
    view.update({ apples: [] });
    expect(view.apples.count).toBe(0);
    expect(view.leaves.count).toBe(0);
    expect(view.drawCalls).toBe(0);
  });

  it('never writes past the buffer it allocated', () => {
    const view = createPickupView({ maxApples: 2 });
    view.update({
      apples: [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
      ],
    });

    expect(view.apples.count).toBe(2);
  });

  it('survives a snapshot with no apples field at all', () => {
    const view = createPickupView();
    expect(() => view.update({})).not.toThrow();
    expect(view.apples.count).toBe(0);
  });

  it('takes its red and green from the catalogue', () => {
    const view = createPickupView();
    expect(`#${view.materials.body.color.getHexString()}`.toUpperCase()).toBe(SETTINGS.colors.red);
    expect(`#${view.materials.leaf.color.getHexString()}`.toUpperCase()).toBe(
      SETTINGS.colors.green,
    );
  });

  it('builds and updates without logging anything to the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = createPickupView();
      view.update({ apples: [{ x: 1, y: 1 }] });
      view.dispose();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('dispose() releases its geometry and materials', () => {
    const view = createPickupView();
    const disposed = [];
    for (const target of [
      view.appleGeometry,
      view.leafGeometry,
      view.materials.body,
      view.materials.leaf,
    ]) {
      target.addEventListener('dispose', () => disposed.push(target));
    }

    view.dispose();
    expect(disposed).toHaveLength(4);
  });
});

/**
 * KS-06-02: the power-up pedestals. Grey-box per the ticket's own spec — a box (blue for SPEED, ice-white for
 * SLOW) with a floating canvas-textured icon plane that bobs and spins (`DESIGN-DECISIONS §3` "Power-up
 * sheet") — drawn from `snapshot.powerUps.pickups`, the KS-06-01 contract this file did not exist to read
 * before this ticket.
 */
describe('PickupView — KS-06-02 power-up pedestals', () => {
  it("draws a pedestal and an icon at a SPEED pickup's cell", () => {
    const view = createPickupView({ reducedFx: true });
    view.update({ apples: [], powerUps: { pickups: [{ cell: { x: 3, y: 9 }, type: 'SPEED' }] } });

    expect(view.powerUps.SPEED.pedestal.count).toBe(1);
    expect(view.powerUps.SPEED.icon.count).toBe(1);
    expect(view.powerUps.SLOW.pedestal.count).toBe(0);
    expect(view.powerUps.SLOW.icon.count).toBe(0);

    const expected = cellToWorld({ x: 3, y: 9 }, SETTINGS.grid);
    const pedestal = instancePosition(view.powerUps.SPEED.pedestal, 0);
    const icon = instancePosition(view.powerUps.SPEED.icon, 0);
    expect(pedestal.x).toBeCloseTo(expected.x, 5);
    expect(pedestal.z).toBeCloseTo(expected.z, 5);
    expect(pedestal.y).toBeGreaterThan(0);
    // The icon floats above the pedestal, not through or under it.
    expect(icon.y).toBeGreaterThan(pedestal.y);
  });

  it('draws a SLOW pickup on the SLOW meshes only, in its own colours', () => {
    const view = createPickupView({ reducedFx: true });
    view.update({ apples: [], powerUps: { pickups: [{ cell: { x: 20, y: 4 }, type: 'SLOW' }] } });

    expect(view.powerUps.SLOW.pedestal.count).toBe(1);
    expect(view.powerUps.SLOW.icon.count).toBe(1);
    expect(view.powerUps.SPEED.pedestal.count).toBe(0);
    expect(view.powerUps.SPEED.icon.count).toBe(0);
    // SPEED reuses the player-blue catalogue colour outright (never a hex literal in this file).
    expect(`#${view.powerUpMaterials.speedPedestal.color.getHexString()}`.toUpperCase()).toBe(
      SETTINGS.colors.blue,
    );
  });

  it('draws nothing on an empty board, and clears a pickup that is gone next frame', () => {
    const view = createPickupView({ reducedFx: true });
    view.update({ apples: [], powerUps: { pickups: [{ cell: { x: 1, y: 1 }, type: 'SPEED' }] } });
    expect(view.powerUps.SPEED.pedestal.count).toBe(1);

    view.update({ apples: [], powerUps: { pickups: [] } });
    expect(view.powerUps.SPEED.pedestal.count).toBe(0);
    expect(view.powerUps.SPEED.icon.count).toBe(0);
    expect(view.drawCalls).toBe(0);
  });

  it('survives a snapshot with no powerUps field at all', () => {
    const view = createPickupView();
    expect(() => view.update({ apples: [] })).not.toThrow();
    expect(view.powerUps.SPEED.pedestal.count).toBe(0);
    expect(view.powerUps.SLOW.pedestal.count).toBe(0);
  });

  it('bobs and spins the icon over time, and freezes both under reducedFx', () => {
    const pickups = { pickups: [{ cell: { x: 10, y: 10 }, type: 'SPEED' }] };

    const animated = createPickupView({ reducedFx: false });
    animated.update({ apples: [], powerUps: pickups }, 0);
    const start = instancePosition(animated.powerUps.SPEED.icon, 0);
    // A quarter of the 1.2 s bob period: the sine wave is nowhere near either endpoint or its start.
    animated.update({ apples: [], powerUps: pickups }, 0.3);
    const moved = instancePosition(animated.powerUps.SPEED.icon, 0);
    expect(moved.y).not.toBeCloseTo(start.y, 3);

    const frozen = createPickupView({ reducedFx: true });
    frozen.update({ apples: [], powerUps: pickups }, 0);
    const frozenStart = instancePosition(frozen.powerUps.SPEED.icon, 0);
    frozen.update({ apples: [], powerUps: pickups }, 5);
    frozen.update({ apples: [], powerUps: pickups }, 5);
    const frozenLater = instancePosition(frozen.powerUps.SPEED.icon, 0);
    expect(frozenLater.y).toBeCloseTo(frozenStart.y, 10);
  });

  it('costs one draw call per non-empty mesh, and none for an empty board', () => {
    const view = createPickupView({ reducedFx: true });
    expect(view.drawCalls).toBe(0);

    view.update({ apples: [], powerUps: { pickups: [{ cell: { x: 5, y: 5 }, type: 'SPEED' }] } });
    // 2 for the pedestal + icon; apples/leaves stay at 0 since none were drawn.
    expect(view.drawCalls).toBe(2);
  });

  it('dispose() releases the power-up geometry, materials and textures too', () => {
    const view = createPickupView();
    const disposed = [];
    for (const target of [
      view.pedestalGeometry,
      view.iconGeometry,
      view.powerUpMaterials.speedPedestal,
      view.powerUpMaterials.slowPedestal,
      view.boltMaterial,
      view.snowflakeMaterial,
      view.boltTexture,
      view.snowflakeTexture,
    ]) {
      target.addEventListener('dispose', () => disposed.push(target));
    }

    view.dispose();
    expect(disposed).toHaveLength(8);
  });
});
