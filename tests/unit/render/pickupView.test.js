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
