// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { COLORS, createInstanceColoredMaterial, createPlasticMaterial } from './materials.js';

/**
 * The arena: a floor of tiles, a wall ring around it and the lighting rig, all grey-box
 * (`sprint-03` "In scope"; the studded tiles, brick walls, emitter towers and decoration are Sprint 09).
 *
 * This module also owns the **cell-to-world mapping**, because the arena is what defines the coordinate
 * space everything else stands in. The simulation's grid has its origin bottom-left with `y` increasing
 * upward (`DESIGN-DECISIONS §2.1`); the camera looks down the world's −z axis (`render/camera.js`), so a
 * simulation `y` that increased with world `z` would put the top of the board at the bottom of the screen.
 * The mapping therefore flips it: cell `(x, y)` sits at world `(x + 0.5, ·, height − y − 0.5)`, which puts
 * cell `(0, 0)` at the near-left corner and makes "up" on the grid "up" on the screen.
 *
 * Nothing here reads the simulation: the arena is the same every frame.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/grid.js').Cell} Cell */
/** @typedef {import('../core/grid.js').GridSize} GridSize */

/**
 * Thickness of the floor slab. The slab's **top** is y = 0, so everything that stands on the arena has its
 * base at y = 0 and no view needs to know the floor is a solid at all.
 */
export const FLOOR_THICKNESS = 0.2;

/** Height of the wall ring, in world units — one cell, so it reads as a brick course around the board. */
export const WALL_HEIGHT = 1;

/** Thickness of the wall ring: "a one-cell-thick grey wall ring". */
export const WALL_THICKNESS = 1;

/**
 * Tiles butt up against each other with no gap. A gap was tried and rejected: the floor is a single layer of
 * tiles with nothing underneath, so any gap lets the scene background show through as bright grout lines. The
 * checkerboard of two greens is what makes the grid readable, which is exactly what the ticket asks for
 * ("flat green tiles, slightly alternating shades") — no seam is needed to read the squares.
 */
const TILE_GAP = 0;

/**
 * How far a dead-zone floor tile's colour is multiplied down (KS-04-02 ticket spec: "Floor tiles in the
 * dead zone darken (material colour × 0.35) as the beam passes"). Not a colour itself — a plain scalar — so
 * it lives beside the code that uses it rather than in `materials.js`, which "never write a hex colour
 * outside" governs.
 */
const DEAD_ZONE_DARKEN = 0.35;

/**
 * The world position of the centre of a grid cell.
 *
 * @param {Cell} cell
 * @param {GridSize} grid
 * @param {number} [y] - height above the floor
 * @returns {THREE.Vector3}
 */
export function cellToWorld(cell, grid, y = 0) {
  return new THREE.Vector3(cell.x + 0.5, y, grid.height - cell.y - 0.5);
}

/**
 * Write the world position of a (possibly fractional) grid position into `out`, without allocating. The
 * renderer calls this once per segment per frame, which is a few hundred times a frame with two long snakes.
 *
 * @param {THREE.Vector3} out
 * @param {number} x - grid x, may be fractional mid-step
 * @param {number} y - grid y, may be fractional mid-step
 * @param {GridSize} grid
 * @param {number} [height]
 * @returns {THREE.Vector3} `out`
 */
export function setWorldFromGrid(out, x, y, grid, height = 0) {
  return out.set(x + 0.5, height, grid.height - y - 0.5);
}

/**
 * A grid direction as a world-space heading. The grid's +y is the world's −z (see the module comment), which
 * is the whole of the conversion.
 *
 * @param {number} dx
 * @param {number} dy
 * @returns {number} yaw in radians about the world y axis, such that a mesh's local +z points along the
 *   direction of travel
 */
export function yawFromGridDirection(dx, dy) {
  return Math.atan2(dx, -dy);
}

/**
 * @typedef {object} ArenaView
 * @property {THREE.Group} group - add this to the scene
 * @property {THREE.DirectionalLight} keyLight - the one shadow-casting light (`ARCHITECTURE §7`)
 * @property {THREE.InstancedMesh} floor
 * @property {THREE.InstancedMesh} walls
 * @property {(insetContinuous: number) => void} setDeadZoneInset - KS-04-02: darken every floor tile the
 *   lasers have swept past
 * @property {() => void} dispose
 */

/**
 * Build the arena.
 *
 * @param {object} [options]
 * @param {Settings} [options.settings]
 * @param {GridSize} [options.grid]
 * @param {number} [options.shadowMapSize] - see `renderer.js`
 * @returns {ArenaView}
 */
export function createArenaView({
  settings = SETTINGS,
  grid = settings.grid,
  shadowMapSize = 2048,
} = {}) {
  const group = new THREE.Group();
  group.name = 'arena';

  // --- floor -------------------------------------------------------------------------------------------
  // One InstancedMesh for the whole 24x24 board: 576 tiles in a single draw call (ARCHITECTURE §7 asks for
  // the arena to be merged or instanced). The two greens alternate as a checkerboard, which is the
  // "slightly alternating shades" the ticket asks for and what `02-standard-gameplay-camera.png` shows. The
  // 70/30 random mix and the 4 % grey tiles of the materials bible are arena art, and belong to Sprint 09.
  const tileGeometry = new THREE.BoxGeometry(1 - TILE_GAP, FLOOR_THICKNESS, 1 - TILE_GAP);
  const floor = new THREE.InstancedMesh(
    tileGeometry,
    createInstanceColoredMaterial(),
    grid.width * grid.height,
  );
  floor.name = 'floor';
  floor.receiveShadow = true;
  // Tiles are flat on the ground and never move; nothing else in the scene will be behind them.
  floor.castShadow = false;

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const tileColor = new THREE.Color();
  let index = 0;
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      setWorldFromGrid(position, x, y, grid, -FLOOR_THICKNESS / 2);
      matrix.makeTranslation(position.x, position.y, position.z);
      floor.setMatrixAt(index, matrix);
      tileColor.setHex((x + y) % 2 === 0 ? COLORS.floorGreen : COLORS.floorGreenAlt);
      floor.setColorAt(index, tileColor);
      index += 1;
    }
  }
  floor.instanceMatrix.needsUpdate = true;
  if (floor.instanceColor) floor.instanceColor.needsUpdate = true;
  group.add(floor);

  // --- wall ring ---------------------------------------------------------------------------------------
  // Four slabs, one per side, as four instances of a unit cube — one draw call for the whole ring. The two
  // long sides are two cells longer than the board so the corners are filled without an extra instance.
  const walls = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    createPlasticMaterial(COLORS.wallGrey),
    4,
  );
  walls.name = 'walls';
  walls.castShadow = true;
  walls.receiveShadow = true;

  const wallY = WALL_HEIGHT / 2;
  const outerWidth = grid.width + 2 * WALL_THICKNESS;
  /** @type {{position: [number, number, number], scale: [number, number, number]}[]} */
  const slabs = [
    // far (grid y = height) and near (grid y = -1), spanning the corners
    {
      position: [grid.width / 2, wallY, -WALL_THICKNESS / 2],
      scale: [outerWidth, WALL_HEIGHT, WALL_THICKNESS],
    },
    {
      position: [grid.width / 2, wallY, grid.height + WALL_THICKNESS / 2],
      scale: [outerWidth, WALL_HEIGHT, WALL_THICKNESS],
    },
    // left (grid x = -1) and right (grid x = width)
    {
      position: [-WALL_THICKNESS / 2, wallY, grid.height / 2],
      scale: [WALL_THICKNESS, WALL_HEIGHT, grid.height],
    },
    {
      position: [grid.width + WALL_THICKNESS / 2, wallY, grid.height / 2],
      scale: [WALL_THICKNESS, WALL_HEIGHT, grid.height],
    },
  ];
  slabs.forEach((slab, slabIndex) => {
    matrix.compose(
      new THREE.Vector3(...slab.position),
      new THREE.Quaternion(),
      new THREE.Vector3(...slab.scale),
    );
    walls.setMatrixAt(slabIndex, matrix);
  });
  walls.instanceMatrix.needsUpdate = true;
  group.add(walls);

  // --- lighting ----------------------------------------------------------------------------------------
  // The rig from the materials bible (DESIGN-DECISIONS §3): one warm key light casts every shadow in the
  // game, a hemisphere fill keeps nothing pitch black. ARCHITECTURE §7: "Nothing else casts."
  const keyLight = new THREE.DirectionalLight(COLORS.keyLight, 2.2);
  keyLight.name = 'keyLight';
  keyLight.position.set(grid.width * 0.25, 30, grid.height * 0.9);
  keyLight.target.position.set(grid.width / 2, 0, grid.height / 2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  // The shadow camera is an orthographic box that has to contain everything that casts; the arena plus its
  // walls is the whole of it.
  keyLight.shadow.camera.left = -grid.width;
  keyLight.shadow.camera.right = grid.width;
  keyLight.shadow.camera.top = grid.height;
  keyLight.shadow.camera.bottom = -grid.height;
  keyLight.shadow.camera.far = 100;
  // Without a bias, a flat floor lit at this angle self-shadows into stripes ("shadow acne") at a 2048 map.
  keyLight.shadow.bias = -0.0005;
  group.add(keyLight);
  group.add(keyLight.target);

  const fill = new THREE.HemisphereLight(COLORS.skyFill, COLORS.groundFill, 0.8);
  fill.name = 'fill';
  group.add(fill);

  // Scratch for `setDeadZoneInset`, reused every call so the laser phase — which calls it every frame while
  // the beams are gliding — allocates nothing. `lastInset` skips the recompute entirely once the glide
  // settles (in particular, the common case of `null` while parked never touches the floor at all).
  const deadZoneColor = new THREE.Color();
  /** @type {number | null} */
  let lastDeadZoneInset = null;

  return {
    group,
    keyLight,
    floor,
    walls,
    /**
     * Darken every floor tile the lasers have swept past, and restore every tile they have not
     * (`DESIGN-DECISIONS §2.4`'s dead zone: `x < inset`, `x >= width − inset`, and the same for `y`).
     * `insetContinuous` is a float — `laserView.js`'s eased `visualInset` — so a tile flips the instant the
     * glide's boundary line crosses it, which is what makes the darkening sweep with the beam rather than
     * jump in one step (ticket spec: "darken … as the beam passes").
     *
     * @param {number} insetContinuous
     */
    setDeadZoneInset(insetContinuous) {
      if (insetContinuous === lastDeadZoneInset) return;
      lastDeadZoneInset = insetContinuous;

      let i = 0;
      for (let y = 0; y < grid.height; y += 1) {
        for (let x = 0; x < grid.width; x += 1) {
          const dead =
            x < insetContinuous ||
            x >= grid.width - insetContinuous ||
            y < insetContinuous ||
            y >= grid.height - insetContinuous;
          deadZoneColor.setHex((x + y) % 2 === 0 ? COLORS.floorGreen : COLORS.floorGreenAlt);
          if (dead) deadZoneColor.multiplyScalar(DEAD_ZONE_DARKEN);
          floor.setColorAt(i, deadZoneColor);
          i += 1;
        }
      }
      if (floor.instanceColor) floor.instanceColor.needsUpdate = true;
    },
    dispose() {
      floor.geometry.dispose();
      /** @type {THREE.Material} */ (floor.material).dispose();
      floor.dispose();
      walls.geometry.dispose();
      /** @type {THREE.Material} */ (walls.material).dispose();
      walls.dispose();
      keyLight.dispose();
      fill.dispose();
      group.clear();
    },
  };
}
