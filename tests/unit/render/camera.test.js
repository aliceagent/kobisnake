import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameplayCamera, solveCameraDistance } from '../../../src/render/camera.js';
import { SETTINGS } from '../../../src/core/settings.js';

/**
 * Where the arena's floor corners are in world space, with `extra` world units of padding on every side.
 * `extra = 0` gives the arena itself; `extra = SETTINGS.camera.margin` gives the framing the design asks to
 * be visible around it.
 *
 * @param {number} extra
 */
function floorCorners(extra = 0) {
  const { width, height } = SETTINGS.grid;
  return [
    new THREE.Vector3(-extra, 0, -extra),
    new THREE.Vector3(width + extra, 0, -extra),
    new THREE.Vector3(-extra, 0, height + extra),
    new THREE.Vector3(width + extra, 0, height + extra),
  ];
}

/**
 * Project world points into normalised device coordinates, where the viewport is exactly [-1, 1] on both
 * axes. This is the whole of "is it on screen?" and needs no WebGL — only the camera's matrices.
 *
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Vector3[]} points
 */
function projectAll(camera, points) {
  camera.updateMatrixWorld(true);
  return points.map((point) => point.clone().project(camera));
}

describe('createGameplayCamera', () => {
  it('KS-03-03 AC1: at 16:9 the projected arena corners lie within the viewport with the specified margin', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });

    // The arena itself is comfortably inside the frame...
    for (const corner of projectAll(camera, floorCorners(0))) {
      expect(Math.abs(corner.x)).toBeLessThan(1);
      expect(Math.abs(corner.y)).toBeLessThan(1);
    }

    // ...and so is the arena grown by `camera.margin` on every side, which is what "plus one wall thickness
    // of margin" (DESIGN-DECISIONS §1 row 24) asks to be framed.
    const framed = projectAll(camera, floorCorners(SETTINGS.camera.margin));
    for (const corner of framed) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
    }

    // And the fit is tight rather than merely safe: the near edge — the closest to the camera and so the
    // largest on screen — sits exactly on the bottom of the frame. A camera that framed the arena from a
    // kilometre away would pass the two loops above and fail this one.
    const nearEdgeY = Math.min(...framed.map((corner) => corner.y));
    expect(nearEdgeY).toBeCloseTo(-1, 9);
  });

  it('KS-03-03 AC1: the near wall is fully visible and the far wall sits just under the top of the frame', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });
    const { width, height } = SETTINGS.grid;

    // The wall ring is one cell thick outside the play area (DESIGN-DECISIONS §3), so the near wall's outer
    // face is at z = height + 1 and the far wall's outer face at z = -1.
    const [nearWall, farWall] = projectAll(camera, [
      new THREE.Vector3(width / 2, 0, height + 1),
      new THREE.Vector3(width / 2, 0, -1),
    ]);

    expect(nearWall.y).toBeGreaterThan(-1);
    expect(farWall.y).toBeLessThan(1);
    // "Just under the HUD line" of `02-standard-gameplay-camera.png`: the far wall is near the top of the
    // frame with a sliver of room above it, not floating in the middle of the picture.
    expect(farWall.y).toBeGreaterThan(0.8);
  });

  it('KS-03-03 AC2: at 4:3 the arena still fits', () => {
    const camera = createGameplayCamera({ aspect: 4 / 3, reducedFx: false });

    for (const corner of projectAll(camera, floorCorners(SETTINGS.camera.margin))) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('KS-03-03 AC2: distance never shrinks as the viewport narrows, and grows once width binds', () => {
    const distanceAt = (aspect) => createGameplayCamera({ aspect, reducedFx: false }).distance;

    const wide = distanceAt(21 / 9);
    const sixteenNine = distanceAt(16 / 9);
    const fourThree = distanceAt(4 / 3);
    const square = distanceAt(1);
    const portrait = distanceAt(3 / 4);

    expect(sixteenNine).toBeGreaterThanOrEqual(wide - 1e-9);
    expect(fourThree).toBeGreaterThanOrEqual(sixteenNine - 1e-9);
    expect(square).toBeGreaterThan(fourThree);
    expect(portrait).toBeGreaterThan(square);

    // Why 4:3 is not *strictly* further back than 16:9, unlike the ticket's parenthetical. The vertical field
    // of view is fixed at 32°, so the height constraint does not move with the aspect at all; only the width
    // constraint does. At a 78° pitch the arena is 24 units wide but only 24·sin(78°) ≈ 23.5 units tall on
    // screen, so width only becomes the binding constraint below an aspect of about 1.022 — and 4:3 is 1.333.
    // Both 16:9 and 4:3 are therefore solved by the same height constraint, which is the correct answer: the
    // arena fits at 4:3, which is what the criterion requires.
    const { camera: cameraSettings, grid } = SETTINGS;
    const crossover =
      (grid.width / 2 + cameraSettings.margin) /
      ((grid.height / 2 + cameraSettings.margin) *
        Math.sin(THREE.MathUtils.degToRad(cameraSettings.pitchDegrees)));
    expect(crossover).toBeGreaterThan(1);
    expect(crossover).toBeLessThan(4 / 3);
    expect(distanceAt(crossover * 0.99)).toBeGreaterThan(distanceAt(crossover * 1.01));
  });

  it('KS-03-03 AC3: pitch is exactly 78° below horizontal', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });
    camera.updateMatrixWorld(true);

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const down = new THREE.Vector3(0, -1, 0);

    // The angle between the view direction and straight down is 90° − pitch, so a dot product of sin(78°)
    // is the criterion. Asserted both ways so a sign slip cannot pass.
    const angleFromDownDegrees = THREE.MathUtils.radToDeg(Math.acos(forward.dot(down)));
    expect(90 - angleFromDownDegrees).toBeCloseTo(SETTINGS.camera.pitchDegrees, 9);
    expect(forward.dot(down)).toBeCloseTo(
      Math.sin(THREE.MathUtils.degToRad(SETTINGS.camera.pitchDegrees)),
      9,
    );
    expect(SETTINGS.camera.pitchDegrees).toBe(78);
  });

  it('KS-03-03 AC3: yaw is zero — the camera hangs straight in front of the arena centre', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });

    expect(camera.position.x).toBeCloseTo(SETTINGS.grid.width / 2, 9);
    expect(camera.position.z).toBeGreaterThan(SETTINGS.grid.height / 2);
    expect(camera.position.y).toBeGreaterThan(0);

    camera.updateMatrixWorld(true);
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    expect(forward.x).toBeCloseTo(0, 9);
  });

  it('uses the field of view the design locked', () => {
    const camera = createGameplayCamera({ reducedFx: false });

    expect(camera.fov).toBe(SETTINGS.camera.fov);
    expect(camera.fov).toBe(32);
  });

  it('re-frames on resize and leaves the arena fitted at the new aspect', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });
    const wideDistance = camera.distance;

    camera.setAspect(1 / 2);

    expect(camera.aspect).toBeCloseTo(0.5, 9);
    expect(camera.distance).toBeGreaterThan(wideDistance);
    for (const corner of projectAll(camera, floorCorners(SETTINGS.camera.margin))) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('survives a degenerate aspect ratio rather than dividing by zero', () => {
    const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });

    camera.setAspect(0);

    expect(Number.isFinite(camera.distance)).toBe(true);
    expect(Number.isFinite(camera.position.y)).toBe(true);
  });

  it('frames a non-square arena from its own centre', () => {
    const camera = createGameplayCamera({
      grid: { width: 40, height: 10 },
      aspect: 16 / 9,
      reducedFx: false,
    });

    expect(camera.position.x).toBeCloseTo(20, 9);
    camera.updateMatrixWorld(true);
    const corners = [
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(40, 0, 0),
      new THREE.Vector3(0, 0, 10),
      new THREE.Vector3(40, 0, 10),
    ].map((point) => point.project(camera));
    for (const corner of corners) {
      expect(Math.abs(corner.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(corner.y)).toBeLessThanOrEqual(1);
    }
  });

  describe('shake', () => {
    it('moves the camera off its base pose and decays back to it exactly', () => {
      const camera = createGameplayCamera({ reducedFx: false });
      const base = camera.basePosition.clone();

      camera.shake(0.15, 0.3);
      camera.update(0.05);
      const displaced = camera.position.distanceTo(base);
      expect(displaced).toBeGreaterThan(0);
      expect(displaced).toBeLessThanOrEqual(0.15 * Math.SQRT2 + 1e-9);

      for (let i = 0; i < 10; i += 1) camera.update(0.05);
      expect(camera.position.distanceTo(base)).toBe(0);
    });

    it('shakes across the screen, never along the view direction', () => {
      const camera = createGameplayCamera({ reducedFx: false });
      camera.updateMatrixWorld(true);
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);

      camera.shake(0.5, 0.3);
      camera.update(0.02);
      const offset = camera.position.clone().sub(camera.basePosition);

      expect(offset.length()).toBeGreaterThan(0);
      expect(offset.dot(forward)).toBeCloseTo(0, 9);
    });

    it('gets weaker over its life, and a weaker second shake does not calm a stronger one', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.shake(1, 1);
      camera.update(0.1);
      const early = camera.shakeDecay();
      camera.shake(0.01, 1);
      camera.update(0.4);
      const late = camera.shakeDecay();

      expect(late).toBeLessThan(early);
      expect(camera.shakeState.amplitude).toBe(1);
    });

    it('ignores a shake with no amplitude or no duration', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.shake(0, 0.3);
      camera.shake(0.2, 0);
      camera.update(0.016);

      expect(camera.position.distanceTo(camera.basePosition)).toBe(0);
    });
  });

  describe('zoomPulse', () => {
    it('narrows the field of view and returns it exactly', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.zoomPulse(2, 0.5);
      camera.update(0.25);

      expect(camera.fov).toBeLessThan(camera.baseFov);
      expect(camera.fov).toBeCloseTo(camera.baseFov * 0.98, 6);

      for (let i = 0; i < 5; i += 1) camera.update(0.1);
      expect(camera.fov).toBe(camera.baseFov);
    });

    it('starts and ends at the base field of view rather than snapping', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.zoomPulse(2, 0.4);
      camera.update(0.001);
      expect(camera.fov).toBeGreaterThan(camera.baseFov * 0.995);

      camera.update(0.398);
      expect(camera.fov).toBeGreaterThan(camera.baseFov * 0.995);
    });

    it('ignores a pulse with no size or no duration', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.zoomPulse(0, 0.5);
      camera.zoomPulse(2, 0);
      camera.update(0.016);

      expect(camera.fov).toBe(camera.baseFov);
    });
  });

  describe('pulseLaserWarning', () => {
    it('KS-04-03: pulses the zoom twice, 0.4 s each, back-to-back', () => {
      const camera = createGameplayCamera({ reducedFx: false });

      camera.pulseLaserWarning();

      // Mid first pulse: zoomed in, same as a lone `zoomPulse(2, 0.4)` would be at this point.
      camera.update(0.2);
      const midFirstPulse = camera.fov;
      expect(midFirstPulse).toBeCloseTo(camera.baseFov * 0.98, 6);

      // End of the first pulse / start of the second: back at the base FOV for exactly this frame.
      camera.update(0.2);
      expect(camera.fov).toBe(camera.baseFov);

      // Mid second pulse: zoomed in again — the "twice" the ticket asks for, not one pulse fading out.
      camera.update(0.2);
      expect(camera.fov).toBeCloseTo(camera.baseFov * 0.98, 6);

      // End of the second pulse: back to base and staying there.
      camera.update(0.2);
      expect(camera.fov).toBe(camera.baseFov);
      camera.update(0.1);
      expect(camera.fov).toBe(camera.baseFov);
    });

    it('KS-04-03: is a no-op under ?reducedFx=1, same as a lone zoomPulse', () => {
      const camera = createGameplayCamera({ reducedFx: true });

      camera.pulseLaserWarning();
      camera.update(0.2);
      camera.update(0.2);
      camera.update(0.2);

      expect(camera.fov).toBe(camera.baseFov);
      expect(camera.queuedZoomPulses).toBe(0);
    });
  });

  describe('?reducedFx=1', () => {
    it('makes shake and zoomPulse no-ops so screenshots compare identical frames', () => {
      const camera = createGameplayCamera({ reducedFx: true });

      camera.shake(1, 1);
      camera.zoomPulse(2, 1);
      camera.update(0.1);
      camera.update(0.1);

      expect(camera.position.equals(camera.basePosition)).toBe(true);
      expect(camera.fov).toBe(camera.baseFov);
    });

    it('is read from the query string when it is not passed explicitly', () => {
      const globals = /** @type {any} */ (globalThis);
      const saved = globals.location;
      try {
        globals.location = { search: '?test=1&seed=1&reducedFx=1' };
        expect(createGameplayCamera().reducedFx).toBe(true);

        globals.location = { search: '?seed=1' };
        expect(createGameplayCamera().reducedFx).toBe(false);

        delete globals.location;
        expect(createGameplayCamera().reducedFx).toBe(false);
      } finally {
        if (saved === undefined) delete globals.location;
        else globals.location = saved;
      }
    });
  });

  describe('solveCameraDistance', () => {
    it('takes whichever of the height and width constraints needs more room', () => {
      const common = { halfWidth: 13.5, halfDepth: 13.5, fovDegrees: 32, pitchDegrees: 78 };

      // Very wide: height binds, so the aspect makes no difference.
      expect(solveCameraDistance({ ...common, aspect: 4 })).toBeCloseTo(
        solveCameraDistance({ ...common, aspect: 2 }),
        9,
      );
      // Very narrow: width binds, and halving the aspect roughly doubles the width term.
      expect(solveCameraDistance({ ...common, aspect: 0.25 })).toBeGreaterThan(
        solveCameraDistance({ ...common, aspect: 0.5 }),
      );
    });

    it('stands further back for a bigger arena and for a narrower field of view', () => {
      const base = {
        halfWidth: 13.5,
        halfDepth: 13.5,
        fovDegrees: 32,
        pitchDegrees: 78,
        aspect: 16 / 9,
      };

      expect(solveCameraDistance({ ...base, halfDepth: 27 })).toBeGreaterThan(
        solveCameraDistance(base),
      );
      expect(solveCameraDistance({ ...base, fovDegrees: 16 })).toBeGreaterThan(
        solveCameraDistance(base),
      );
    });
  });
});
