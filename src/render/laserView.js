// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { createLaserMaterial, createPlasticMaterial, COLORS } from './materials.js';

/**
 * The closing laser arena, drawn grey-box (KS-04-02; `docs/sprints/sprint-04-closing-laser-arena.md`).
 *
 * `src/core/lasers.js` already owns the whole schedule — this file only turns `RoundSimulation.getState()
 * .lasers` (`{ phase, inset, insetCells }`) into geometry. It never advances anything itself: the same
 * snapshot pushed in twice draws the same picture twice, exactly like `pickupView.js`.
 *
 * Three groups of instances, four beams, eight emitters and (during `WARNING` only) four arrows, so the
 * whole file costs three draw calls at most (`AC3`'s +6 budget) whatever the arena size:
 *
 * - **Beams**: four thin emissive boxes along the current safe-square edges (ticket spec: 0.15 wide, 0.4
 *   tall), hidden while `PARKED` and visible from `WARNING` onward.
 * - **Emitters**: placeholder grey cubes at the four corners of the safe square *and* the centre of each of
 *   its four edges — eight in all. `docs/reference/README.md` item 3 is explicit that the reference images
 *   build both, and that the centre one is "the mover that visibly pushes the beam inward"; the grey-box
 *   simplification this sprint makes is that *every* emitter, corner and centre alike, glides with the beam
 *   rather than only the centre one animating against fixed corner towers. Final art (separate fixed
 *   corner towers plus a moving centre carriage) is Sprint 09/10.
 * - **Arrows**: a flat triangle per side, pointing inward, shown only while `phase === 'WARNING'`
 *   (`05-laser-closing-phase.png`).
 *
 * **Coordinate note.** Every other view in `src/render` places things at *cell centres* via
 * `arenaView.js`'s `setWorldFromGrid` (a cell's centre is offset by 0.5 from its integer grid coordinate).
 * A beam is not at a cell centre — it runs along the *boundary line* between the last dead cell and the
 * first safe one — so this file has its own, simpler mapping with no 0.5 offset: world x is the grid-x
 * boundary unchanged, and world z is `grid.height` minus the grid-y boundary (the same axis flip
 * `arenaView.js`'s module comment explains, applied to a line instead of a cell). `arenaView.js`'s own wall
 * ring is built the identical way, for the identical reason.
 *
 * **The glide.** `update` compares the snapshot's integer `inset` against the last one it saw; a change
 * starts a tween of a *continuous* `visualInset` from wherever it currently sits to the new integer, eased
 * out over {@link GLIDE_DURATION_SECONDS} (AC2's own number). Reading only the final `inset` each call,
 * rather than consuming individual `LASER_STEP` events, is deliberate and harmless: `lasers.js`'s own doc
 * comment notes that a coarse `advance(dt)` can cross several step boundaries in one call and still be
 * correct, and a view that glides from "wherever it last was" to "wherever the sim is now" reproduces that
 * exactly, one step or nine. Under `?reducedFx=1` the tween is skipped outright and `visualInset` snaps to
 * the target immediately, the same convention `camera.js`'s shake and zoom pulse use, so a screenshot never
 * catches a half-finished glide.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/grid.js').GridSize} GridSize */

/** @typedef {{phase: string, inset: number, insetCells: number}} LaserSnapshot */

/** Beam cross-section, in world units (ticket spec: "0.15 wide, 0.4 tall"). */
const BEAM_WIDTH = 0.15;
const BEAM_HEIGHT = 0.4;

/** How long a step's glide from the old inset to the new one takes (ticket spec: "over 0.3 s (ease-out)"). */
export const GLIDE_DURATION_SECONDS = 0.3;

/** Placeholder emitter cube: bigger than the beam so it still reads as a tower next to it. Final art in S09. */
const EMITTER_SIZE = 0.5;

/** The direction arrow: a flat isoceles triangle lying on the floor, tip pointing inward. */
const ARROW_LENGTH = 1.1;
const ARROW_WIDTH = 0.7;
/** Just proud of the floor so it never z-fights with the tile beneath it. */
const ARROW_HEIGHT = 0.02;
/** How far inward of the beam the arrow sits, in cells — clear of the beam and the emitters either side of it. */
const ARROW_INSET_OFFSET = 1.6;

/**
 * The grid direction each of the four arrows points — inward, toward the arena centre — in the same
 * left/right/far/near order {@link LaserView#updateBeamsAndEmitters} and {@link LaserView#updateArrows} both
 * use. `yawTowardGridDirection` turns each into the yaw a mesh built pointing local +z needs.
 *
 * @type {{inwardDx: number, inwardDy: number}[]}
 */
const INWARD_DIRECTIONS = [
  { inwardDx: 1, inwardDy: 0 }, // left: the boundary at world x = inset; inward is grid +x.
  { inwardDx: -1, inwardDy: 0 }, // right: the boundary at world x = width - inset; inward is grid -x.
  { inwardDx: 0, inwardDy: -1 }, // far: world z = inset (the grid-y = height side); inward is grid -y.
  { inwardDx: 0, inwardDy: 1 }, // near: world z = height - inset (the grid-y = 0 side); inward is grid +y.
];

/**
 * True when the page asked for reduced effects (`ARCHITECTURE §11`). Mirrors `camera.js`'s own helper
 * (not exported there) so the glide can be a no-op for the same reason the camera's shake and zoom are.
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
 * `atan2(dx, -dy)`: the yaw that turns a mesh built pointing local +z toward the grid direction `(dx, dy)`.
 * Identical to `arenaView.js`'s `yawFromGridDirection`, kept local so this file's arrows do not have to
 * import a cell-centred helper module purely for one piece of trigonometry it does not otherwise need.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
function yawTowardGridDirection(dx, dy) {
  return Math.atan2(dx, -dy);
}

/**
 * Ease-out cubic: starts fast, settles into the target. The ticket's own word for the glide.
 *
 * @param {number} t - 0..1
 * @returns {number}
 */
function easeOutCubic(t) {
  const inverse = 1 - t;
  return 1 - inverse * inverse * inverse;
}

/**
 * A flat isoceles triangle in the local XZ plane, tip at local +z, base at local -z — the shape
 * `yawTowardGridDirection` above turns to face inward. Lying flat (`y = 0` for every vertex) is what makes
 * it read as a marking on the floor rather than a standing sign, matching the low, wide arrows in
 * `05-laser-closing-phase.png`.
 *
 * @returns {THREE.BufferGeometry}
 */
function createArrowGeometry() {
  const geometry = new THREE.BufferGeometry();
  // Wound so the computed normal points to +y (up), the only side the gameplay camera ever sees.
  const positions = new Float32Array([
    0,
    0,
    ARROW_LENGTH / 2,
    -ARROW_WIDTH / 2,
    0,
    -ARROW_LENGTH / 2,
    ARROW_WIDTH / 2,
    0,
    -ARROW_LENGTH / 2,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export class LaserView {
  /**
   * @param {object} [options]
   * @param {Settings} [options.settings]
   * @param {GridSize} [options.grid]
   * @param {boolean} [options.reducedFx] - defaults to reading `?reducedFx=1` from the URL
   */
  constructor({ settings = SETTINGS, grid, reducedFx } = {}) {
    /** @type {Settings} */
    this.settings = settings;
    /** @type {GridSize} */
    this.grid = grid ?? settings.grid;
    /** @type {boolean} */
    this.reducedFx = reducedFx ?? reducedFxFromLocation();

    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    this.group.name = 'lasers';

    this.beamMaterial = createLaserMaterial();
    /** Four beams, one draw call. @type {THREE.InstancedMesh} */
    this.beams = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.beamMaterial, 4);
    this.beams.name = 'laserBeams';
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.group.add(this.beams);

    // Placeholder grey towers (`04-clean-arena-design.png`'s corner detail; final art in Sprint 09) — the
    // arena's own wall grey, not an invented shade.
    this.emitterMaterial = createPlasticMaterial(COLORS.wallGrey);
    /** Four corners plus four wall-centre movers, one draw call. @type {THREE.InstancedMesh} */
    this.emitters = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      this.emitterMaterial,
      8,
    );
    this.emitters.name = 'laserEmitters';
    this.emitters.castShadow = true;
    this.emitters.frustumCulled = false;
    this.emitters.count = 0;
    this.group.add(this.emitters);

    this.arrowGeometry = createArrowGeometry();
    this.arrowMaterial = createLaserMaterial();
    this.arrowMaterial.side = THREE.DoubleSide;
    /** Four inward arrows, one draw call, `WARNING` only. @type {THREE.InstancedMesh} */
    this.arrows = new THREE.InstancedMesh(this.arrowGeometry, this.arrowMaterial, 4);
    this.arrows.name = 'laserArrows';
    this.arrows.frustumCulled = false;
    this.arrows.count = 0;
    this.group.add(this.arrows);

    /**
     * The eased, continuous inset the view is currently drawn at — 0 while parked, gliding toward
     * `targetInset` after every change (see the module doc comment). Read by `arenaView.js`'s
     * `setDeadZoneInset` (via the scene composition) so the floor darkens in step with the beams, and by
     * tests proving AC2.
     * @type {number}
     */
    this.visualInset = 0;
    /** Where the current glide started. @type {number} */
    this.fromInset = 0;
    /** Where the current glide is headed — the last `inset` the snapshot reported. @type {number} */
    this.targetInset = 0;
    /** Seconds into the current glide. @type {number} */
    this.glideElapsed = GLIDE_DURATION_SECONDS;

    /** The last phase drawn, for tests and for the composition's own book-keeping. @type {string} */
    this.phase = 'PARKED';

    this.scratch = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    };
  }

  /** Draw calls this view costs right now: 0 while parked, up to 3 from `WARNING` onward (AC3). @returns {number} */
  get drawCalls() {
    return [this.beams, this.emitters, this.arrows].filter((mesh) => mesh.count > 0).length;
  }

  /**
   * Redraw from a round snapshot.
   *
   * @param {{lasers?: LaserSnapshot}} snapshot - `RoundSimulation.getState()`
   * @param {number} [dt] - seconds since the previous frame, for the glide
   * @returns {this}
   */
  update(snapshot, dt = 0) {
    const lasers = snapshot.lasers ?? { phase: 'PARKED', inset: 0, insetCells: 0 };
    this.phase = lasers.phase;

    if (lasers.inset !== this.targetInset) {
      // A new step (or a jump of several, per the module doc comment): glide from wherever the view is
      // right now, not from the old target, so a second step arriving mid-glide does not jump backward.
      this.fromInset = this.visualInset;
      this.targetInset = lasers.inset;
      this.glideElapsed = 0;
    }

    if (this.reducedFx) {
      this.visualInset = this.targetInset;
    } else {
      this.glideElapsed = Math.min(this.glideElapsed + Math.max(dt, 0), GLIDE_DURATION_SECONDS);
      const progress = this.glideElapsed / GLIDE_DURATION_SECONDS;
      this.visualInset =
        progress >= 1
          ? this.targetInset
          : this.fromInset + (this.targetInset - this.fromInset) * easeOutCubic(progress);
    }

    const visible = this.phase !== 'PARKED';
    this.beams.count = visible ? 4 : 0;
    this.emitters.count = visible ? 8 : 0;
    this.arrows.count = this.phase === 'WARNING' ? 4 : 0;

    if (visible) {
      this.updateBeamsAndEmitters();
      if (this.phase === 'WARNING') this.updateArrows();
    }

    return this;
  }

  /**
   * World x of the grid-x boundary `x = insetVisual` (no cell-centre offset — see the module doc comment).
   * @returns {number}
   */
  leftX() {
    return this.visualInset;
  }

  /** World x of the grid-x boundary `x = width - insetVisual`. @returns {number} */
  rightX() {
    return this.grid.width - this.visualInset;
  }

  /** World z of the grid-y boundary `y = height - insetVisual` (small y, "far" from the camera). @returns {number} */
  farZ() {
    return this.visualInset;
  }

  /** World z of the grid-y boundary `y = insetVisual` (large y, "near" the camera). @returns {number} */
  nearZ() {
    return this.grid.height - this.visualInset;
  }

  /** Lay out the four beams and the eight emitters at the current `visualInset`. */
  updateBeamsAndEmitters() {
    const { matrix, position, scale } = this.scratch;
    const left = this.leftX();
    const right = this.rightX();
    const far = this.farZ();
    const near = this.nearZ();
    const midX = (left + right) / 2;
    const midZ = (far + near) / 2;
    const lengthX = right - left;
    const lengthZ = near - far;

    /** @type {[number, number, number, number, number][]} beam index -> [x, z, scaleX, scaleY, scaleZ] */
    const beams = [
      [left, midZ, BEAM_WIDTH, BEAM_HEIGHT, lengthZ], // left
      [right, midZ, BEAM_WIDTH, BEAM_HEIGHT, lengthZ], // right
      [midX, far, lengthX, BEAM_HEIGHT, BEAM_WIDTH], // far
      [midX, near, lengthX, BEAM_HEIGHT, BEAM_WIDTH], // near
    ];
    beams.forEach(([x, z, sx, sy, sz], i) => {
      position.set(x, sy / 2, z);
      scale.set(sx, sy, sz);
      matrix.compose(position, new THREE.Quaternion(), scale);
      this.beams.setMatrixAt(i, matrix);
    });
    this.beams.instanceMatrix.needsUpdate = true;

    /** @type {[number, number][]} the eight emitter positions: four corners, then four wall centres. */
    const emitters = [
      [left, far],
      [right, far],
      [left, near],
      [right, near],
      [left, midZ],
      [right, midZ],
      [midX, far],
      [midX, near],
    ];
    scale.set(EMITTER_SIZE, EMITTER_SIZE, EMITTER_SIZE);
    emitters.forEach(([x, z], i) => {
      position.set(x, EMITTER_SIZE / 2, z);
      matrix.compose(position, new THREE.Quaternion(), scale);
      this.emitters.setMatrixAt(i, matrix);
    });
    this.emitters.instanceMatrix.needsUpdate = true;
  }

  /** Lay out the four inward-pointing arrows, `WARNING` only. */
  updateArrows() {
    const { matrix, position, quaternion, scale, up } = this.scratch;
    const left = this.leftX();
    const right = this.rightX();
    const far = this.farZ();
    const near = this.nearZ();
    const midX = (left + right) / 2;
    const midZ = (far + near) / 2;

    const [l, r, f, n] = INWARD_DIRECTIONS;
    /** @type {[number, number, number, number][]} [x, z, inwardDx, inwardDy] */
    const arrows = [
      [left + ARROW_INSET_OFFSET, midZ, l.inwardDx, l.inwardDy],
      [right - ARROW_INSET_OFFSET, midZ, r.inwardDx, r.inwardDy],
      [midX, far + ARROW_INSET_OFFSET, f.inwardDx, f.inwardDy],
      [midX, near - ARROW_INSET_OFFSET, n.inwardDx, n.inwardDy],
    ];
    scale.set(1, 1, 1);
    arrows.forEach(([x, z, dx, dy], i) => {
      position.set(x, ARROW_HEIGHT, z);
      quaternion.setFromAxisAngle(up, yawTowardGridDirection(dx, dy));
      matrix.compose(position, quaternion, scale);
      this.arrows.setMatrixAt(i, matrix);
    });
    this.arrows.instanceMatrix.needsUpdate = true;
  }

  /** Free every GPU resource this view owns. */
  dispose() {
    this.beams.geometry.dispose();
    this.beamMaterial.dispose();
    this.beams.dispose();
    this.emitters.geometry.dispose();
    this.emitterMaterial.dispose();
    this.emitters.dispose();
    this.arrowGeometry.dispose();
    this.arrowMaterial.dispose();
    this.arrows.dispose();
    this.group.clear();
  }
}

/**
 * Build the laser view.
 *
 * @param {object} [options] - see {@link LaserView}
 * @param {Settings} [options.settings]
 * @param {GridSize} [options.grid]
 * @param {boolean} [options.reducedFx]
 * @returns {LaserView}
 */
export function createLaserView(options = {}) {
  return new LaserView(options);
}
