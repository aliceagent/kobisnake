// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';

/**
 * The gameplay camera, which the design locked and this file only solves for (`DESIGN-DECISIONS §1 row 24`):
 * a perspective camera at vertical FOV 32°, pitched 78° below horizontal, yaw 0, looking at the arena centre,
 * standing back far enough that the whole arena plus `camera.margin` of framing fits. That is panel **C** of
 * `docs/reference/images/03-camera-angle-comparison.png` and the framing of
 * `02-standard-gameplay-camera.png`. Nothing here chooses an angle; the only free variable is distance, and
 * distance is solved from the arena size, the FOV, the pitch and the current aspect ratio.
 *
 * The two effects the design allows on this camera also live here: a small shake on a crash and a ≤ 2 % zoom
 * pulse on the laser warning. Neither rotates the camera — row 24 says "no rotation" — and both are no-ops
 * under `?reducedFx=1` so screenshot baselines compare identical frames (`ARCHITECTURE §11`).
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/settings.js').GridSettings} GridSettings */

/** Near plane. Small enough never to clip the near wall, large enough to keep depth precision sane. */
const NEAR_PLANE = 0.1;

/** Far plane. The camera stands ~49 units back from a 24-cell arena, so 500 is generous. */
const FAR_PLANE = 500;

/**
 * Frequencies of the two decaying sinusoids the shake is built from, in hertz. Two different, non-harmonic
 * frequencies on the two screen axes read as a rattle rather than as a diagonal wobble.
 */
const SHAKE_FREQUENCY_X = 17;
const SHAKE_FREQUENCY_Y = 13;

/**
 * The camera's reaction to `LASER_WARNING` (ticket KS-04-03): two zoom pulses, back-to-back. The size and
 * count are the ticket's own numbers, not a `SETTINGS` value — `DESIGN-DECISIONS §1 row 24` only caps the
 * size ("≤ 2 % zoom pulse on laser warning, no rotation"); the "0.4 s, twice" shape is this ticket's call.
 */
const LASER_WARNING_ZOOM_PERCENT = 2;
const LASER_WARNING_PULSE_SECONDS = 0.4;
const LASER_WARNING_PULSE_COUNT = 2;

/**
 * Solve the camera distance that fits `halfWidth` x `halfDepth` of arena (margin already included) into the
 * frustum, at this pitch and this aspect.
 *
 * The derivation, because it is short and the alternative is a magic number. Put the camera at
 * `centre + d·(0, sin θ, cos θ)` looking at `centre`, θ being the pitch below horizontal. For a floor point
 * offset `(a, b)` from the centre (a across, b toward the camera):
 *
 * - depth along the view axis is `d − b·cos θ`
 * - its height in camera space is `−b·sin θ`
 * - its sideways offset in camera space is `a`
 *
 * So the near edge (`b = +halfDepth`, the closest and therefore the biggest on screen) fits vertically when
 * `halfDepth·sin θ ≤ (d − halfDepth·cos θ)·tan(fov/2)`, and the near corners fit horizontally when
 * `halfWidth ≤ (d − halfDepth·cos θ)·tan(fov/2)·aspect`. Take whichever needs the camera further back.
 *
 * @param {object} options
 * @param {number} options.halfWidth - half the arena's x extent plus margin, in world units
 * @param {number} options.halfDepth - half the arena's z extent plus margin, in world units
 * @param {number} options.fovDegrees - vertical field of view
 * @param {number} options.pitchDegrees - pitch below horizontal
 * @param {number} options.aspect - viewport width / height
 * @returns {number} distance from the arena centre to the camera, in world units
 */
export function solveCameraDistance({ halfWidth, halfDepth, fovDegrees, pitchDegrees, aspect }) {
  const pitch = THREE.MathUtils.degToRad(pitchDegrees);
  const halfFovTangent = Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2);
  const safeAspect = Math.max(aspect, Number.EPSILON);

  // Both constraints are measured at the near edge, whose depth is `d − halfDepth·cos(pitch)`; that shared
  // term is added back once at the end.
  const depthOfNearEdge = halfDepth * Math.cos(pitch);
  const distanceForHeight = (halfDepth * Math.sin(pitch)) / halfFovTangent;
  const distanceForWidth = halfWidth / (halfFovTangent * safeAspect);

  return depthOfNearEdge + Math.max(distanceForHeight, distanceForWidth);
}

/**
 * True when the page asked for reduced effects (`ARCHITECTURE §11`). Reads the URL where there is one and
 * says "no" everywhere else, so importing this module in Node never throws.
 *
 * @returns {boolean}
 */
function reducedFxFromLocation() {
  const search = /** @type {{search?: string} | undefined} */ (
    /** @type {any} */ (globalThis).location
  )?.search;
  return typeof search === 'string' && new URLSearchParams(search).get('reducedFx') === '1';
}

/**
 * The gameplay camera. A `THREE.PerspectiveCamera` — the ticket's return type, and what
 * `renderer.render(scene, camera)` wants — with the four things the game needs to drive it: re-frame on
 * resize, advance the effects each frame, shake, and pulse.
 */
export class GameplayCamera extends THREE.PerspectiveCamera {
  /**
   * @param {object} options
   * @param {Settings} [options.settings] - defaults to the shipping `SETTINGS`
   * @param {GridSettings} [options.grid] - defaults to `settings.grid`
   * @param {number} [options.aspect] - viewport width / height; defaults to 16:9
   * @param {boolean} [options.reducedFx] - defaults to reading `?reducedFx=1` from the URL
   */
  constructor({ settings = SETTINGS, grid, aspect = 16 / 9, reducedFx } = {}) {
    super(settings.camera.fov, aspect, NEAR_PLANE, FAR_PLANE);

    const resolvedGrid = grid ?? settings.grid;

    /** @type {Settings} */
    this.settings = settings;
    /** @type {GridSettings} */
    this.grid = resolvedGrid;
    /** Effects are off entirely under `?reducedFx=1` (`ARCHITECTURE §11`). @type {boolean} */
    this.reducedFx = reducedFx ?? reducedFxFromLocation();

    /**
     * The FOV the framing was solved for. `zoomPulse` moves `this.fov` away from it and back, so the base has
     * to be remembered rather than read off the camera.
     * @type {number}
     */
    this.baseFov = settings.camera.fov;

    /** The point on the floor the camera looks at: the arena's centre. @type {THREE.Vector3} */
    this.target = new THREE.Vector3(resolvedGrid.width / 2, 0, resolvedGrid.height / 2);

    /** Camera position with no shake applied. @type {THREE.Vector3} */
    this.basePosition = new THREE.Vector3();

    /** Screen-right in world space. Yaw is 0, so it is simply +x. @type {THREE.Vector3} */
    this.screenRight = new THREE.Vector3(1, 0, 0);
    /**
     * Screen-up in world space: perpendicular to the view direction, in the plane of the view and world up.
     * Shake offsets along these two so a crash rattles the picture rather than dollying the camera.
     * @type {THREE.Vector3}
     */
    this.screenUp = new THREE.Vector3();

    /** @type {{amplitude: number, remaining: number, duration: number}} */
    this.shakeState = { amplitude: 0, remaining: 0, duration: 0 };
    /** @type {{percent: number, remaining: number, duration: number}} */
    this.zoomState = { percent: 0, remaining: 0, duration: 0 };
    /**
     * Extra zoom pulses still owed once the current one finishes. A lone `zoomPulse()` call never sets
     * this; only `pulseLaserWarning()` (KS-04-03) chains pulses back-to-back.
     * @type {number}
     */
    this.queuedZoomPulses = 0;

    this.setAspect(aspect);
  }

  /** Distance from the arena centre to the camera, in world units. @returns {number} */
  get distance() {
    return this.basePosition.distanceTo(this.target);
  }

  /**
   * Re-frame for a new viewport shape. Called on every resize (`ARCHITECTURE §7`): the vertical FOV is fixed,
   * so a narrower viewport can only be fitted by standing further back.
   *
   * @param {number} aspect - viewport width / height
   * @returns {this}
   */
  setAspect(aspect) {
    this.aspect = Math.max(aspect, Number.EPSILON);
    this.frame();
    return this;
  }

  /**
   * Put the camera where the design says, for the current aspect. Yaw 0 means it hangs on the +z side of the
   * arena and tips down toward the centre.
   *
   * @returns {this}
   */
  frame() {
    const { camera } = this.settings;
    const pitch = THREE.MathUtils.degToRad(camera.pitchDegrees);
    const distance = solveCameraDistance({
      halfWidth: this.grid.width / 2 + camera.margin,
      halfDepth: this.grid.height / 2 + camera.margin,
      fovDegrees: this.baseFov,
      pitchDegrees: camera.pitchDegrees,
      aspect: this.aspect,
    });

    this.basePosition.set(
      this.target.x,
      this.target.y + distance * Math.sin(pitch),
      this.target.z + distance * Math.cos(pitch),
    );
    // Screen-up is the view direction rotated a quarter turn toward world up; at pitch θ that is
    // (0, cos θ, −sin θ), which is perpendicular to the forward vector (0, −sin θ, −cos θ).
    this.screenUp.set(0, Math.cos(pitch), -Math.sin(pitch));

    this.position.copy(this.basePosition);
    this.lookAt(this.target);
    this.updateProjectionMatrix();
    return this;
  }

  /**
   * Start a screen shake (`DESIGN-DECISIONS §3` "Crash & laser death": 0.3 s, amplitude 0.15 units).
   *
   * A shake already running is replaced only by a stronger one, so a second crash cannot make the picture
   * calmer than the first left it.
   *
   * @param {number} amplitude - peak offset in world units
   * @param {number} seconds - how long it takes to decay to nothing
   * @returns {this}
   */
  shake(amplitude, seconds) {
    if (this.reducedFx || amplitude <= 0 || seconds <= 0) return this;
    const currentPeak = this.shakeState.amplitude * this.shakeDecay();
    if (amplitude < currentPeak) return this;
    this.shakeState = { amplitude, remaining: seconds, duration: seconds };
    return this;
  }

  /**
   * Start a zoom pulse: push in by `percent` of the base FOV and come back, over `seconds`. Row 24 caps this
   * at 2 % and uses it on the laser warning.
   *
   * @param {number} percent - peak zoom, in percent of the base field of view
   * @param {number} seconds
   * @returns {this}
   */
  zoomPulse(percent, seconds) {
    if (this.reducedFx || percent === 0 || seconds <= 0) return this;
    this.zoomState = { percent, remaining: seconds, duration: seconds };
    return this;
  }

  /**
   * The camera's whole reaction to `LASER_WARNING` (ticket KS-04-03): `zoomPulse(2 %, 0.4 s)` twice,
   * back-to-back, so the picture "breathes" rather than pulsing once. A no-op under `?reducedFx=1`, same as
   * a lone `zoomPulse` call — `queuedZoomPulses` staying at 0 in that case means `update()` never chains a
   * second pulse it was never asked to play.
   *
   * @returns {this}
   */
  pulseLaserWarning() {
    if (this.reducedFx) return this;
    this.queuedZoomPulses = LASER_WARNING_PULSE_COUNT - 1;
    this.zoomPulse(LASER_WARNING_ZOOM_PERCENT, LASER_WARNING_PULSE_SECONDS);
    return this;
  }

  /** How much of the current shake is left, 0..1. @returns {number} */
  shakeDecay() {
    const { remaining, duration } = this.shakeState;
    return duration > 0 ? Math.max(remaining, 0) / duration : 0;
  }

  /**
   * Advance the effects by one frame and write the result onto the camera. Called every frame by the
   * renderer; with nothing running it costs one copy and returns the camera to its base pose exactly, so a
   * finished shake can never leave the picture a millimetre off.
   *
   * @param {number} dt - seconds since the previous frame
   * @returns {this}
   */
  update(dt) {
    this.position.copy(this.basePosition);

    if (this.shakeState.remaining > 0) {
      this.shakeState.remaining -= dt;
      const decay = this.shakeDecay();
      if (decay <= 0) {
        this.shakeState = { amplitude: 0, remaining: 0, duration: 0 };
      } else {
        // Elapsed time drives the oscillation, decay drives its size: a rattle that fades, not a slowing wobble.
        const elapsed = this.shakeState.duration - this.shakeState.remaining;
        const size = this.shakeState.amplitude * decay;
        this.position.addScaledVector(
          this.screenRight,
          size * Math.sin(2 * Math.PI * SHAKE_FREQUENCY_X * elapsed),
        );
        this.position.addScaledVector(
          this.screenUp,
          size * Math.cos(2 * Math.PI * SHAKE_FREQUENCY_Y * elapsed),
        );
      }
    }

    let fov = this.baseFov;
    if (this.zoomState.remaining > 0) {
      this.zoomState.remaining -= dt;
      if (this.zoomState.remaining <= 0) {
        if (this.queuedZoomPulses > 0) {
          // Chain straight into the next queued pulse (`pulseLaserWarning`'s "twice"), carrying over the
          // slice of `dt` that ran past this one's end so back-to-back pulses do not drift apart when a
          // frame does not divide 0.4 s evenly. The chained pulse's own envelope is picked up next frame.
          const overshoot = -this.zoomState.remaining;
          const { percent, duration } = this.zoomState;
          this.queuedZoomPulses -= 1;
          this.zoomState = { percent, remaining: duration - overshoot, duration };
        } else {
          this.zoomState = { percent: 0, remaining: 0, duration: 0 };
        }
      } else {
        // A half-sine envelope: starts at zero, peaks halfway, returns to zero. Zooming *in* is a narrower
        // field of view, hence the subtraction.
        const progress = 1 - this.zoomState.remaining / this.zoomState.duration;
        const envelope = Math.sin(Math.PI * progress);
        fov = this.baseFov * (1 - (this.zoomState.percent / 100) * envelope);
      }
    }
    if (fov !== this.fov) {
      this.fov = fov;
      this.updateProjectionMatrix();
    }

    this.lookAt(this.target);
    return this;
  }
}

/**
 * Build the gameplay camera (`ARCHITECTURE §3`: `render/camera.js`).
 *
 * @param {object} [options] - see {@link GameplayCamera}
 * @param {Settings} [options.settings]
 * @param {GridSettings} [options.grid]
 * @param {number} [options.aspect]
 * @param {boolean} [options.reducedFx]
 * @returns {GameplayCamera}
 */
export function createGameplayCamera(options = {}) {
  return new GameplayCamera(options);
}
