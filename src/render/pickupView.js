// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { createAppleMaterials } from './materials.js';
import { setWorldFromGrid } from './arenaView.js';

/**
 * The things lying on the arena waiting to be picked up. In Sprint 03 that is apples only, grey-box: a red
 * sphere with a green disc leaf (ticket spec). The toy-brick apple of `DESIGN-DECISIONS §1 row 1` and the
 * power-up pedestals of row 20 are Sprint 06 and Sprint 09; this file is the seam they will grow from.
 *
 * Apples never move, but they do respawn: `FoodState` keeps exactly `foodCount` of them and replaces one the
 * moment it is eaten (`DESIGN-DECISIONS §1 row 19`). So this view redraws from the snapshot each frame rather
 * than reacting to events — it costs four matrix writes and it cannot drift out of step with the simulation.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/grid.js').GridSize} GridSize */
/** @typedef {import('../core/grid.js').Cell} Cell */

/** Radius of the apple body, in world units — a little under half a cell, so apples never touch. */
const APPLE_RADIUS = 0.36;

/** The leaf: a flat disc above the apple, tilted so it reads from the gameplay camera. */
const LEAF_RADIUS = 0.21;
const LEAF_TILT_DEGREES = 18;

const APPLE_WIDTH_SEGMENTS = 14;
const APPLE_HEIGHT_SEGMENTS = 10;
const LEAF_SEGMENTS = 10;

export class PickupView {
  /**
   * @param {object} [options]
   * @param {Settings} [options.settings]
   * @param {GridSize} [options.grid]
   * @param {number} [options.maxApples] - buffer size; defaults to `settings.foodCount`
   */
  constructor({ settings = SETTINGS, grid, maxApples } = {}) {
    /** @type {Settings} */
    this.settings = settings;
    /** @type {GridSize} */
    this.grid = grid ?? settings.grid;

    const capacity = maxApples ?? settings.foodCount;

    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    this.group.name = 'pickups';

    this.materials = createAppleMaterials(settings);

    this.appleGeometry = new THREE.SphereGeometry(
      APPLE_RADIUS,
      APPLE_WIDTH_SEGMENTS,
      APPLE_HEIGHT_SEGMENTS,
    );
    /** @type {THREE.InstancedMesh} */
    this.apples = new THREE.InstancedMesh(this.appleGeometry, this.materials.body, capacity);
    this.apples.name = 'apples';
    this.apples.castShadow = true;
    this.apples.frustumCulled = false;
    this.apples.count = 0;
    this.group.add(this.apples);

    this.leafGeometry = new THREE.CircleGeometry(LEAF_RADIUS, LEAF_SEGMENTS);
    // A disc is a single-sided plane; from a 78° camera a leaf tilted away would otherwise vanish.
    this.materials.leaf.side = THREE.DoubleSide;
    /** @type {THREE.InstancedMesh} */
    this.leaves = new THREE.InstancedMesh(this.leafGeometry, this.materials.leaf, capacity);
    this.leaves.name = 'leaves';
    this.leaves.frustumCulled = false;
    this.leaves.count = 0;
    this.group.add(this.leaves);

    this.scratch = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(1, 1, 1),
      leafRotation: new THREE.Euler(
        -Math.PI / 2 + THREE.MathUtils.degToRad(LEAF_TILT_DEGREES),
        0,
        0,
      ),
    };
  }

  /** Draw calls this view costs. @returns {number} */
  get drawCalls() {
    return [this.apples, this.leaves].filter((mesh) => mesh.count > 0).length;
  }

  /**
   * Redraw from a round snapshot.
   *
   * @param {{apples: Cell[]}} snapshot - `RoundSimulation.getState()`
   * @returns {this}
   */
  update(snapshot) {
    const apples = snapshot.apples ?? [];
    const { matrix, position, quaternion, scale, leafRotation } = this.scratch;
    // In the shrunken endgame an apple slot can legitimately be empty (`DESIGN-DECISIONS §2.3`: "the slot
    // stays empty and is retried every tick"), so never assume there are exactly `foodCount` of them.
    const count = Math.min(apples.length, this.apples.instanceMatrix.count);

    quaternion.setFromEuler(leafRotation);
    for (let i = 0; i < count; i += 1) {
      setWorldFromGrid(position, apples[i].x, apples[i].y, this.grid, APPLE_RADIUS);
      matrix.compose(position, new THREE.Quaternion(), scale);
      this.apples.setMatrixAt(i, matrix);

      // Clear of the sphere altogether: anything lower and the disc is swallowed by the apple it sits on,
      // reading as a dark notch in the fruit rather than as a leaf.
      position.y += APPLE_RADIUS * 1.15;
      matrix.compose(position, quaternion, scale);
      this.leaves.setMatrixAt(i, matrix);
    }

    this.apples.count = count;
    this.leaves.count = count;
    this.apples.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
    return this;
  }

  /** Free every GPU resource this view owns. */
  dispose() {
    this.appleGeometry.dispose();
    this.leafGeometry.dispose();
    this.materials.body.dispose();
    this.materials.leaf.dispose();
    this.apples.dispose();
    this.leaves.dispose();
    this.group.clear();
  }
}

/**
 * Build the pickup view.
 *
 * @param {object} [options] - see {@link PickupView}
 * @param {Settings} [options.settings]
 * @param {GridSize} [options.grid]
 * @param {number} [options.maxApples]
 * @returns {PickupView}
 */
export function createPickupView(options = {}) {
  return new PickupView(options);
}
