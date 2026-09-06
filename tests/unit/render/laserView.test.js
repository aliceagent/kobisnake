import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  createLaserView,
  GLIDE_DURATION_SECONDS,
  LaserView,
} from '../../../src/render/laserView.js';
import { COLORS } from '../../../src/render/materials.js';
import { RoundSimulation } from '../../../src/core/round.js';
import { SETTINGS, withOverrides } from '../../../src/core/settings.js';

/** How many steps the shipping settings take to reach the 6x6 minimum (`DESIGN-DECISIONS §2.4`: nine). */
const MAX_STEPS = 9;

function instanceMatrix(mesh, i) {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(i, matrix);
  return matrix;
}

function instancePosition(mesh, i) {
  return new THREE.Vector3().setFromMatrixPosition(instanceMatrix(mesh, i));
}

function instanceScale(mesh, i) {
  return new THREE.Vector3().setFromMatrixScale(instanceMatrix(mesh, i));
}

/** A frozen round nobody can lose (`tests/unit/core/lasers.test.js`'s own convention), fast-forwarded to
 * exactly `timeRemaining` seconds left in one call. */
function frozenRoundAt(timeRemaining) {
  const sim = new RoundSimulation({
    seed: 1,
    players: [{ id: 'p1' }, { id: 'p2' }],
    settings: withOverrides({ snakeSpeed: 0, godMode: true }),
  });
  sim.advance(SETTINGS.roundDuration - timeRemaining);
  return sim.getState();
}

describe('LaserView', () => {
  it('KS-04-02 AC1: hidden while PARKED, visible from WARNING', () => {
    const view = createLaserView({ reducedFx: true });

    view.update({ lasers: { phase: 'PARKED', inset: 0, insetCells: 0 } });
    expect(view.drawCalls).toBe(0);
    expect(view.beams.count).toBe(0);
    expect(view.emitters.count).toBe(0);
    expect(view.arrows.count).toBe(0);

    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });
    expect(view.beams.count).toBe(4);
    expect(view.emitters.count).toBe(8);
    expect(view.arrows.count).toBe(4);
    expect(view.drawCalls).toBe(3);
  });

  it('a snapshot with no lasers field at all draws as PARKED', () => {
    const view = createLaserView({ reducedFx: true });
    view.update({});
    expect(view.drawCalls).toBe(0);
  });

  it('draws the arrows only during WARNING, not CLOSING or STOPPED', () => {
    const view = createLaserView({ reducedFx: true });

    view.update({ lasers: { phase: 'CLOSING', inset: 3, insetCells: 3 } });
    expect(view.arrows.count).toBe(0);
    expect(view.beams.count).toBe(4);

    view.update({ lasers: { phase: 'STOPPED', inset: 9, insetCells: 9 } });
    expect(view.arrows.count).toBe(0);
    expect(view.beams.count).toBe(4);
  });

  it('KS-04-02 AC3: never more than 3 draw calls, whatever the phase', () => {
    const view = createLaserView({ reducedFx: true });
    for (const phase of ['PARKED', 'WARNING', 'CLOSING', 'STOPPED']) {
      view.update({ lasers: { phase, inset: 2, insetCells: 2 } });
      expect(view.drawCalls).toBeLessThanOrEqual(3);
      // AC3's own budget has headroom to spare: 3 is well inside "beyond +6".
      expect(view.drawCalls).toBeLessThanOrEqual(6);
    }
  });

  it('places the four beams along the wall line at inset 0, spanning the whole side', () => {
    const view = createLaserView({ reducedFx: true, grid: { width: 24, height: 24 } });
    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });

    const left = instancePosition(view.beams, 0);
    const right = instancePosition(view.beams, 1);
    const far = instancePosition(view.beams, 2);
    const near = instancePosition(view.beams, 3);

    expect(left.x).toBeCloseTo(0, 9);
    expect(right.x).toBeCloseTo(24, 9);
    expect(far.z).toBeCloseTo(0, 9);
    expect(near.z).toBeCloseTo(24, 9);

    // Vertical beams span the full height, horizontal beams the full width, at inset 0.
    expect(instanceScale(view.beams, 0).z).toBeCloseTo(24, 9);
    expect(instanceScale(view.beams, 2).x).toBeCloseTo(24, 9);
    expect(instanceScale(view.beams, 0).x).toBeCloseTo(0.15, 5); // ticket spec: 0.15 wide
    expect(instanceScale(view.beams, 0).y).toBeCloseTo(0.4, 5); // ticket spec: 0.4 tall
  });

  it('steps the beams inward with the sim once glided, one cell per side per LASER_STEP', () => {
    const view = createLaserView({ reducedFx: true, grid: { width: 24, height: 24 } });
    view.update({ lasers: { phase: 'CLOSING', inset: 3, insetCells: 3 } });

    const left = instancePosition(view.beams, 0);
    const right = instancePosition(view.beams, 1);
    const far = instancePosition(view.beams, 2);
    const near = instancePosition(view.beams, 3);

    expect(left.x).toBeCloseTo(3, 9);
    expect(right.x).toBeCloseTo(21, 9);
    expect(far.z).toBeCloseTo(3, 9);
    expect(near.z).toBeCloseTo(21, 9);
    expect(instanceScale(view.beams, 0).z).toBeCloseTo(18, 9); // 24 - 2*3
  });

  it('lays out the eight emitters at the four corners and the four wall centres', () => {
    const view = createLaserView({ reducedFx: true, grid: { width: 24, height: 24 } });
    view.update({ lasers: { phase: 'CLOSING', inset: 2, insetCells: 2 } });

    expect(view.emitters.count).toBe(8);
    const positions = Array.from({ length: 8 }, (_, i) => instancePosition(view.emitters, i));

    // Four corners of the safe square [2, 22).
    for (const [x, z] of [
      [2, 2],
      [22, 2],
      [2, 22],
      [22, 22],
    ]) {
      expect(positions.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6)).toBe(
        true,
      );
    }
    // Four wall-centre movers (`docs/reference/README.md` item 3).
    for (const [x, z] of [
      [2, 12],
      [22, 12],
      [12, 2],
      [12, 22],
    ]) {
      expect(positions.some((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.z - z) < 1e-6)).toBe(
        true,
      );
    }
  });

  it('points each warning arrow inward, toward the arena centre', () => {
    const view = createLaserView({ reducedFx: true, grid: { width: 24, height: 24 } });
    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });

    const forward = (matrix) => {
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
      return new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    };

    // Left arrow (index 0) points inward: world +x.
    expect(forward(instanceMatrix(view.arrows, 0)).x).toBeCloseTo(1, 9);
    // Right arrow (index 1) points inward: world -x.
    expect(forward(instanceMatrix(view.arrows, 1)).x).toBeCloseTo(-1, 9);
    // Far arrow (index 2, small z) points inward: world +z.
    expect(forward(instanceMatrix(view.arrows, 2)).z).toBeCloseTo(1, 9);
    // Near arrow (index 3, large z) points inward: world -z.
    expect(forward(instanceMatrix(view.arrows, 3)).z).toBeCloseTo(-1, 9);
  });

  it('KS-04-02 AC2: under ?reducedFx=1 the beam snaps straight to the sim, no glide', () => {
    const view = createLaserView({ reducedFx: true });
    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });
    view.update({ lasers: { phase: 'CLOSING', inset: 1, insetCells: 1 } }, 0);

    expect(view.visualInset).toBe(1);
  });

  it("KS-04-02 AC2: the glide takes the ticket's own 0.3 s and never overshoots", () => {
    const view = createLaserView({ reducedFx: false });
    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });

    // The instant the step lands, the beam has not moved yet — it starts the glide from where it was.
    view.update({ lasers: { phase: 'CLOSING', inset: 1, insetCells: 1 } }, 0);
    expect(view.visualInset).toBe(0);

    // Partway through the glide it is strictly between the old and the new inset.
    view.update(
      { lasers: { phase: 'CLOSING', inset: 1, insetCells: 1 } },
      GLIDE_DURATION_SECONDS / 2,
    );
    expect(view.visualInset).toBeGreaterThan(0);
    expect(view.visualInset).toBeLessThan(1);

    // AC2's own wording: "never lags the sim by more than one frame after the 0.3 s ease" — once the total
    // elapsed time reaches the glide's duration, the beam and the sim agree exactly, not approximately.
    view.update(
      { lasers: { phase: 'CLOSING', inset: 1, insetCells: 1 } },
      GLIDE_DURATION_SECONDS / 2,
    );
    expect(view.visualInset).toBe(1);
  });

  it('a step arriving mid-glide restarts the glide from wherever the beam currently is, not from 0', () => {
    const view = createLaserView({ reducedFx: false });
    view.update({ lasers: { phase: 'CLOSING', inset: 1, insetCells: 1 } });
    view.update(
      { lasers: { phase: 'CLOSING', inset: 2, insetCells: 2 } },
      GLIDE_DURATION_SECONDS / 2,
    );
    const midway = view.visualInset;
    expect(midway).toBeGreaterThan(1);
    expect(midway).toBeLessThan(2);

    // A second step lands before the first glide finished: the new glide starts from `midway`, not from 1.
    view.update({ lasers: { phase: 'CLOSING', inset: 3, insetCells: 3 } }, 0);
    expect(view.visualInset).toBeCloseTo(midway, 9);

    view.update({ lasers: { phase: 'CLOSING', inset: 3, insetCells: 3 } }, GLIDE_DURATION_SECONDS);
    expect(view.visualInset).toBe(3);
  });

  it('KS-04-02 AC1: dead-zone tile count matches width² − safe² at every checkpoint', () => {
    // (timeRemaining, expected inset, expected dead-zone tile count) — the ticket's own four moments.
    // Safe side = 24 − 2·inset; dead-zone count = 24² − safe² (AC1's own formula).
    const checkpoints = [
      [30, 0, 0], // WARNING: beams at the wall line, nothing swept yet
      [24, 1, 92], // one step: 22×22 safe
      [10, 7, 476], // seven steps: 10×10 safe
      [3, MAX_STEPS, 540], // STOPPED: 6×6 safe
    ];
    for (const [timeRemaining, expectedInset, expectedDeadTiles] of checkpoints) {
      const state = frozenRoundAt(timeRemaining);
      expect(state.lasers.inset).toBe(expectedInset);

      const view = createLaserView({ reducedFx: true });
      view.update(state);
      expect(view.visualInset).toBe(expectedInset);

      let deadTiles = 0;
      const { width, height } = SETTINGS.grid;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (
            x < view.visualInset ||
            x >= width - view.visualInset ||
            y < view.visualInset ||
            y >= height - view.visualInset
          ) {
            deadTiles += 1;
          }
        }
      }
      const safeSide = width - 2 * expectedInset;
      expect(width ** 2 - safeSide ** 2).toBe(expectedDeadTiles);
      expect(deadTiles).toBe(expectedDeadTiles);
    }
  });

  it('builds without logging anything to the console', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const view = createLaserView({ reducedFx: true });
      view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });
      view.dispose();
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it('draws in the laser red from the materials catalogue, never an invented shade', () => {
    const view = createLaserView({ reducedFx: true });
    expect(view.beamMaterial.color.getHex()).toBe(COLORS.laserRed);
    expect(view.beamMaterial.emissive.getHex()).toBe(COLORS.laserRed);
    expect(view.emitterMaterial.color.getHex()).toBe(COLORS.wallGrey);
  });

  it('scales to a different arena size without hard-coded 24s', () => {
    const view = createLaserView({ reducedFx: true, grid: { width: 6, height: 6 } });
    view.update({ lasers: { phase: 'WARNING', inset: 0, insetCells: 0 } });
    expect(instancePosition(view.beams, 1).x).toBeCloseTo(6, 9);
  });

  it('dispose() releases its geometry and materials', () => {
    const view = createLaserView({ reducedFx: true });
    const disposed = [];
    for (const target of [
      view.beams.geometry,
      view.beamMaterial,
      view.emitters.geometry,
      view.emitterMaterial,
      view.arrowGeometry,
      view.arrowMaterial,
    ]) {
      target.addEventListener('dispose', () => disposed.push(target));
    }
    view.dispose();
    expect(disposed).toHaveLength(6);
  });

  it('createLaserView returns a LaserView instance', () => {
    expect(createLaserView({ reducedFx: true })).toBeInstanceOf(LaserView);
  });

  it('reads ?reducedFx=1 from the query string when it is not passed explicitly', () => {
    const globals = /** @type {any} */ (globalThis);
    const saved = globals.location;
    try {
      globals.location = { search: '?test=1&seed=1&reducedFx=1' };
      expect(createLaserView().reducedFx).toBe(true);

      globals.location = { search: '?seed=1' };
      expect(createLaserView().reducedFx).toBe(false);

      delete globals.location;
      expect(createLaserView().reducedFx).toBe(false);
    } finally {
      if (saved === undefined) delete globals.location;
      else globals.location = saved;
    }
  });
});
