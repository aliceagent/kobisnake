import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createGameplayCamera, solveCameraDistance } from '../../../src/render/camera.js';
import { WALL_HEIGHT, WALL_THICKNESS } from '../../../src/render/arenaView.js';
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

  describe('KI-15-03: prefers-reduced-motion', () => {
    afterEach(() => {
      const globals = /** @type {any} */ (globalThis);
      delete globals.location;
      delete globals.matchMedia;
    });

    it('KI-15-03 AC1: with the media query emulated (no ?reducedFx=1), the crash shake produces no camera displacement — asserted numerically', () => {
      const globals = /** @type {any} */ (globalThis);
      globals.location = { search: '?test=1' };
      globals.matchMedia = (query) => ({ matches: query === '(prefers-reduced-motion: reduce)' });

      const camera = createGameplayCamera();
      expect(camera.reducedFx).toBe(true);

      // DESIGN-DECISIONS §3's own crash shake numbers, driven straight through `camera.js` (not through
      // `session.js`, which never calls `shake()` for a crash today — see this ticket's PR notes).
      camera.shake(0.15, 0.3);
      camera.update(0.05);

      expect(camera.position.distanceTo(camera.basePosition)).toBe(0);
    });

    it('resolves reducedFx to false under the ordinary (non-reduced) media query', () => {
      const globals = /** @type {any} */ (globalThis);
      globals.location = { search: '' };
      globals.matchMedia = () => ({ matches: false });

      expect(createGameplayCamera().reducedFx).toBe(false);
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
  /**
   * KI-16-02 — the framing rule (`DESIGN-DECISIONS §1 row 31`), asserted numerically at every viewport
   * `docs/qa/playtests/viewports.md` measures rather than only at the one the design was confirmed at.
   *
   * The rule this proves is the one row 31 states: the whole arena plus one wall thickness of camera margin
   * is inside the frame at any aspect ratio, fitted to whichever axis binds, with pitch and yaw untouched —
   * and at 16:9 it resolves to exactly the confirmed picture of row 24. Nothing here is a new behaviour;
   * `solveCameraDistance` already took whichever of the two constraints needed more room. What was missing
   * was any assertion that it holds anywhere but 16:9 and 4:3, which is how it came to be believed and never
   * checked (Improvement 16's own origin: "everything is proven at 1280×720 and nowhere else").
   */
  describe('KI-16-02: the framing rule at every measured viewport', () => {
    /** The seven KI-16-01 measured, plus three shapes deliberately outside anything the ticket named. */
    const VIEWPORTS = [
      { slug: '1280x720', width: 1280, height: 720 },
      { slug: '1024x768', width: 1024, height: 768 },
      { slug: '800x600', width: 800, height: 600 },
      { slug: '1920x1080', width: 1920, height: 1080 },
      { slug: '2560x1080', width: 2560, height: 1080 },
      // DPR does not reach the camera at all — it changes the drawing buffer, never the aspect — so the
      // `1280x720@2` row of the matrix is the `1280x720` row here, and that is worth stating rather than
      // silently omitting.
      { slug: '640x480', width: 640, height: 480 },
      // Beyond the list: a portrait split, an ultra-short letterbox, and a square. The rule claims "any
      // aspect ratio", and the two constraints swap over at roughly 1.023, so the portrait and square cases
      // are the only ones that exercise the *width* constraint at all.
      { slug: '720x1280 (portrait)', width: 720, height: 1280 },
      { slug: '1280x400 (letterbox)', width: 1280, height: 400 },
      { slug: '900x900 (square)', width: 900, height: 900 },
    ];

    /**
     * The wall ring's own eight top corners, at its real extent — `arenaView.js` puts the slabs one
     * `WALL_THICKNESS` outside the grid on every side, standing `WALL_HEIGHT` tall.
     *
     * These are deliberately *not* the camera-margin box raised to wall height. That point is in empty
     * framing headroom where no geometry stands, and projecting it reports an overflow that does not exist —
     * the mistake KI-16-01's first draft made, which would have sent this ticket to move the camera and
     * break AC2 (see that PR's review). The margin box is a framing target; the wall ring is a thing.
     */
    function wallTopCorners() {
      const { width, height } = SETTINGS.grid;
      return [-WALL_THICKNESS, width + WALL_THICKNESS].flatMap((x) =>
        [-WALL_THICKNESS, height + WALL_THICKNESS].map((z) => new THREE.Vector3(x, WALL_HEIGHT, z)),
      );
    }

    it.each(VIEWPORTS)(
      'KI-16-02 AC1: at $slug the arena and its margin are inside the frame',
      ({ width, height }) => {
        const camera = createGameplayCamera({ aspect: width / height, reducedFx: false });

        // The framing target of row 24: the floor rectangle grown by `camera.margin` on every side.
        for (const corner of projectAll(camera, floorCorners(SETTINGS.camera.margin))) {
          expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
        }

        // And the geometry the player actually sees, which must never be cut off at any size.
        for (const corner of projectAll(camera, wallTopCorners())) {
          expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
          expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
        }
      },
    );

    it('KI-16-02 AC1: the fit is exact, not merely safe — the binding edge touches the frame', () => {
      // Stated as its own assertion because "inside the frame" alone is satisfied by a camera a kilometre
      // away, and because the zero slack is the reason row 31 records the confirmed picture as a *minimum*:
      // there is no room to give any viewport less arena than 16:9 gets.
      for (const { width, height } of VIEWPORTS) {
        const camera = createGameplayCamera({ aspect: width / height, reducedFx: false });
        const framed = projectAll(camera, floorCorners(SETTINGS.camera.margin));
        const worst = Math.max(
          ...framed.flatMap((corner) => [Math.abs(corner.x), Math.abs(corner.y)]),
        );
        expect(worst).toBeCloseTo(1, 9);
      }
    });

    it('KI-16-02 AC1: which axis binds is the shorter one, and it swaps at the stated crossover', () => {
      // The rule is "fit to the shorter axis". Above the crossover the arena's height is what does not fit
      // and the distance is aspect-independent; below it, the width takes over and the camera retreats.
      const { camera: cameraSettings, grid } = SETTINGS;
      const crossover =
        (grid.width / 2 + cameraSettings.margin) /
        ((grid.height / 2 + cameraSettings.margin) *
          Math.sin(THREE.MathUtils.degToRad(cameraSettings.pitchDegrees)));

      const distanceAt = (aspect) => createGameplayCamera({ aspect, reducedFx: false }).distance;
      const wide = distanceAt(2560 / 1080);
      const fourThree = distanceAt(4 / 3);

      // Every landscape viewport in the matrix is above the crossover, so they share one distance exactly —
      // which is why `viewports.md` reports the same near-edge NDC y for all of them.
      expect(crossover).toBeLessThan(4 / 3);
      expect(fourThree).toBe(wide);
      expect(distanceAt(1280 / 720)).toBe(wide);
      expect(distanceAt(640 / 480)).toBe(wide);

      // Below it, the width binds and the camera has to stand further back.
      expect(distanceAt(crossover * 0.9)).toBeGreaterThan(wide);
      expect(distanceAt(720 / 1280)).toBeGreaterThan(distanceAt(1));
    });

    /**
     * AC2, the constraint the whole ticket is fenced by: **at 1280×720 nothing moved.**
     *
     * Written as literal expected numbers rather than as a comparison against another camera built the same
     * way, which would pass however wrong both of them were. These are the confirmed picture of row 24, and
     * a change to the solve that alters them by a millimetre has to come here and say so deliberately.
     */
    it('KI-16-02 AC2: at 1280×720 every camera parameter is unchanged', () => {
      const camera = createGameplayCamera({ aspect: 1280 / 720, reducedFx: false });

      expect(camera.fov).toBe(32);
      expect(camera.near).toBe(0.1);
      expect(camera.far).toBe(500);
      expect(camera.aspect).toBe(16 / 9);

      expect(camera.distance).toBeCloseTo(48.8580897846397, 12);
      expect(camera.position.x).toBeCloseTo(12, 12);
      expect(camera.position.y).toBeCloseTo(47.79042329928218, 12);
      expect(camera.position.z).toBeCloseTo(22.158168057250343, 12);
      expect(camera.target.toArray()).toEqual([12, 0, 12]);

      // Row 24's own two figures, measured off the projected arena rather than restated: "the arena fills
      // ≈ 84 % of the frame height and ≈ 48 % of its width". The height is exact. The width measures 50.8 %,
      // which is recorded in row 31 and raised with the design lead on #245 — row 24 is not edited here.
      const arena = projectAll(camera, floorCorners(0));
      const heightFraction =
        (Math.max(...arena.map((c) => c.y)) - Math.min(...arena.map((c) => c.y))) / 2;
      const widthFraction =
        (Math.max(...arena.map((c) => c.x)) - Math.min(...arena.map((c) => c.x))) / 2;
      expect(heightFraction).toBeCloseTo(0.84, 3);
      expect(widthFraction).toBeCloseTo(0.5077, 3);
    });

    it('KI-16-02: a non-finite aspect is refused rather than poisoning the projection', () => {
      // A canvas that is not laid out yet, or one in a minimised window, measures 0 × 0 — and `0 / 0` is
      // NaN. Before this ticket that NaN reached `updateProjectionMatrix`, after which every later frame at
      // a perfectly ordinary size drew nothing, with nothing anywhere to say why.
      const camera = createGameplayCamera({ aspect: 16 / 9, reducedFx: false });
      const before = camera.distance;

      camera.setAspect(Number.NaN);
      expect(camera.aspect).toBe(16 / 9);
      expect(camera.distance).toBe(before);
      expect(Number.isFinite(camera.projectionMatrix.elements[0])).toBe(true);

      camera.setAspect(Number.POSITIVE_INFINITY);
      expect(camera.aspect).toBe(16 / 9);

      // A real, finite aspect still applies normally afterwards.
      camera.setAspect(4 / 3);
      expect(camera.aspect).toBe(4 / 3);
    });

    it("KI-16-02: a camera *built* at a non-finite aspect falls back to the design's own shape", () => {
      // The case with nothing to fall back to: the canvas measured 0 × 0 at construction time, so
      // `super()` has already stored the NaN and there is no previous good aspect to keep. 16:9 — the shape
      // row 24 confirmed the picture at — is the only defensible answer.
      const camera = createGameplayCamera({ aspect: Number.NaN, reducedFx: false });

      expect(camera.aspect).toBe(16 / 9);
      expect(Number.isFinite(camera.distance)).toBe(true);
      for (const corner of projectAll(camera, floorCorners(SETTINGS.camera.margin))) {
        expect(Math.abs(corner.x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(corner.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  });
});
