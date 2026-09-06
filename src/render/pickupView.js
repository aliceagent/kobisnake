// @ts-check
import * as THREE from 'three';
import { SETTINGS } from '../core/settings.js';
import { createAppleMaterials, createPowerUpMaterials } from './materials.js';
import { setWorldFromGrid } from './arenaView.js';

/**
 * The things lying on the arena waiting to be picked up: apples (Sprint 03) and, since KS-06-02, power-up
 * pedestals. The toy-brick apple of `DESIGN-DECISIONS §1 row 1` and the two-tier art pedestal of row 20 are
 * Sprint 09's job; this file draws both grey-box, per each ticket's own spec.
 *
 * Apples never move, but they do respawn: `FoodState` keeps exactly `foodCount` of them and replaces one the
 * moment it is eaten (`DESIGN-DECISIONS §1 row 19`). So this view redraws from the snapshot each frame rather
 * than reacting to events — it costs four matrix writes and it cannot drift out of step with the simulation.
 * Power-up pedestals follow the same rule: `powerUps.pickups` (`core/powerups.js`'s own contract — "at most
 * one, ever") is drawn as a list for the same reason apples are, and it costs nothing extra.
 *
 * The pedestal's floating icon is a `THREE.CanvasTexture` painted at construction time with the 2D canvas
 * API — a lightning bolt for SPEED, a snowflake for SLOW (tech-lead note on KS-06-02: no image files, no
 * CDN). `createIconCanvas` below works from a real `document.createElement('canvas')` in a browser and from
 * a tiny no-op stand-in under Vitest's `environment: 'node'` (`ARCHITECTURE §2`'s render coverage floor —
 * every view here has to stay testable in plain Node, and Node has no DOM at all), the same way
 * `camera.js`'s `reducedFxFromLocation` reads a browser-only global and answers something sane where there
 * is none.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/grid.js').GridSize} GridSize */
/** @typedef {import('../core/grid.js').Cell} Cell */
/** @typedef {'SPEED' | 'SLOW'} PowerUpType */

/** Radius of the apple body, in world units — a little under half a cell, so apples never touch. */
const APPLE_RADIUS = 0.36;

/** The leaf: a flat disc above the apple, tilted so it reads from the gameplay camera. */
const LEAF_RADIUS = 0.21;
const LEAF_TILT_DEGREES = 18;

const APPLE_WIDTH_SEGMENTS = 14;
const APPLE_HEIGHT_SEGMENTS = 10;
const LEAF_SEGMENTS = 10;

/** The pedestal: an 0.8-unit box (ticket spec), one per power-up type so each can carry its own colour. */
const PEDESTAL_SIZE = 0.8;

/** How many power-ups of *each* type this view can draw at once. `core/powerups.js` promises at most one on
 * the whole board, ever, but a snapshot is drawn as a list either way (see the module doc comment above), so
 * this is a small buffer rather than a hard "1" — the same reasoning `pickupView`'s apples already use. */
const MAX_POWERUPS_PER_TYPE = 2;

/**
 * The icon plane's side length — bigger than `PEDESTAL_SIZE` (0.8) itself, not "a little under a cell" (this
 * constant's old value, 0.6, was): at the gameplay camera's actual distance, a 0.6-unit plane's fine detail —
 * the snowflake's spokes especially — minifies down to a soft, illegible blur, a second readability bug this
 * fix's own screenshot review found sitting behind the occlusion one (see `ICON_FLOAT_GAP`'s comment). Once
 * the icon was no longer hidden inside the pedestal, it was still too small to read as a bolt or a snowflake
 * rather than a pale smudge; this is the fix for that half of it.
 */
const ICON_SIZE = 0.9;
/**
 * Tilt off horizontal, matching the apple leaf's own reasoning: the gameplay camera looks down from 78°
 * below horizontal (`DESIGN-DECISIONS §1 row 24`), close enough to overhead that a mostly flat icon — tilted
 * only a little toward the camera — reads far better than one standing upright edge-on to it.
 */
const ICON_TILT_DEGREES = 32;
/**
 * How far clear of the pedestal's own top face the icon floats, before the bob is added — the gap the
 * "floating" in "a floating glowing yellow lightning bolt" (`docs/reference/README.md` note 5) is asking for.
 * `01-master-visual.png`'s pedestal is the calibration: its ring-and-bolt hovers a good pedestal-height clear
 * of the small pillar underneath, not resting on or inside it.
 *
 * This used to be folded into one constant — `ICON_REST_HEIGHT = PEDESTAL_SIZE * 0.85` — used directly as the
 * icon's absolute world height. Because `0.85 < 1`, that put the icon's centre *below* `PEDESTAL_SIZE` (the
 * pedestal's own top face, at y = 0.8), not above it: the plane sat inside the box's own volume. At this
 * camera's 78°-below-horizontal pitch (`DESIGN-DECISIONS §1 row 24`) — close enough to overhead that a point
 * directly above another almost fully occludes it — the pedestal's flat top face then hid nearly all of the
 * icon standing inside it, leaving only the sliver a screenshot review correctly flagged as unreadable. This
 * is now two constants precisely so "above the pedestal's own top" is arithmetic (`PEDESTAL_SIZE + gap`)
 * rather than a fraction of the pedestal's own height that quietly reads as "above" while computing "inside".
 */
const ICON_FLOAT_GAP = PEDESTAL_SIZE * 0.75;
/** The icon's absolute idle height (world Y), before the bob is added: clear of the pedestal's own top face. */
const ICON_REST_HEIGHT = PEDESTAL_SIZE + ICON_FLOAT_GAP;

/** Idle bob: ±0.1 units over 1.2 s (`DESIGN-DECISIONS §3` "Power-up sheet"). */
const BOB_AMPLITUDE = 0.1;
const BOB_PERIOD_SECONDS = 1.2;
/** Slow spin: 30°/s (`DESIGN-DECISIONS §3` "Power-up sheet"). */
const SPIN_DEGREES_PER_SECOND = 30;

/** Canvas resolution the icon textures are painted at. Small: these are flat, few-colour glyphs. */
const ICON_CANVAS_SIZE = 128;

/**
 * True when the page asked for reduced effects (`ARCHITECTURE §11`). Mirrors `camera.js`'s own
 * `reducedFxFromLocation` rather than importing it — that function is module-private there, and duplicating
 * four lines is cheaper than widening `camera.js`'s exports for a `renderer.js` call site this ticket may not
 * touch beyond the one line the tech lead already authorised (see `renderer.js`'s own comment on that line).
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
 * A `document.createElement('canvas')` where there is a `document`, and a minimal stand-in where there is
 * not (Vitest's `environment: 'node'` — see the module doc comment). The stand-in answers every call the
 * drawing functions below make with nothing, via a `Proxy` rather than a hand-listed method table: nothing
 * in a unit test inspects pixels, only that a texture and the mesh matrices that carry it come out right.
 *
 * @param {number} size
 * @returns {{ width: number, height: number, getContext: (kind: string) => any }}
 */
function createIconCanvas(size) {
  const doc = /** @type {{createElement?: (tag: string) => any} | undefined} */ (
    /** @type {any} */ (globalThis).document
  );
  if (doc?.createElement) {
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }
  const noop2d = new Proxy(/** @type {Record<string, unknown>} */ ({}), {
    get(store, prop) {
      return prop in store ? store[/** @type {string} */ (prop)] : () => {};
    },
    set(store, prop, value) {
      store[/** @type {string} */ (prop)] = value;
      return true;
    },
  });
  return { width: size, height: size, getContext: () => noop2d };
}

/**
 * Paints a lightning bolt on a fresh canvas and returns it as a texture — SPEED's icon (`DESIGN-DECISIONS §1
 * row 20`: "yellow lightning bolt"), inside the cyan ring row 20 also names. Both colours are handed in
 * rather than looked up here, so this file never writes a hex literal of its own (`CLAUDE.md`'s "never" list)
 * — `materials.js`'s `createPowerUpMaterials` is the one place that names them.
 *
 * @param {string} boltColor
 * @param {string} ringColor
 * @returns {THREE.CanvasTexture}
 */
function createBoltTexture(boltColor, ringColor) {
  const canvas = createIconCanvas(ICON_CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  const c = ICON_CANVAS_SIZE / 2;

  ctx.clearRect(0, 0, ICON_CANVAS_SIZE, ICON_CANVAS_SIZE);

  ctx.strokeStyle = ringColor;
  ctx.lineWidth = ICON_CANVAS_SIZE * 0.06;
  ctx.beginPath();
  ctx.arc(c, c, ICON_CANVAS_SIZE * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // A simple zigzag bolt silhouette, drawn in canvas-pixel space (0,0 top-left) and centred by eye.
  ctx.fillStyle = boltColor;
  ctx.beginPath();
  ctx.moveTo(c + ICON_CANVAS_SIZE * 0.08, c - ICON_CANVAS_SIZE * 0.3);
  ctx.lineTo(c - ICON_CANVAS_SIZE * 0.18, c + ICON_CANVAS_SIZE * 0.05);
  ctx.lineTo(c - ICON_CANVAS_SIZE * 0.02, c + ICON_CANVAS_SIZE * 0.05);
  ctx.lineTo(c - ICON_CANVAS_SIZE * 0.1, c + ICON_CANVAS_SIZE * 0.32);
  ctx.lineTo(c + ICON_CANVAS_SIZE * 0.22, c - ICON_CANVAS_SIZE * 0.02);
  ctx.lineTo(c + ICON_CANVAS_SIZE * 0.04, c - ICON_CANVAS_SIZE * 0.02);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(/** @type {any} */ (canvas));
  texture.needsUpdate = true;
  return texture;
}

/**
 * Paints a snowflake on a fresh canvas — SLOW's icon (`docs/reference/README.md` note 5: "the SLOW power-up
 * must reuse the same pedestal system... with a snowflake"), inside its own pale-blue ring.
 *
 * @param {string} snowflakeColor
 * @param {string} ringColor
 * @returns {THREE.CanvasTexture}
 */
function createSnowflakeTexture(snowflakeColor, ringColor) {
  const canvas = createIconCanvas(ICON_CANVAS_SIZE);
  const ctx = canvas.getContext('2d');
  const c = ICON_CANVAS_SIZE / 2;
  const arm = ICON_CANVAS_SIZE * 0.36;
  const twig = arm * 0.4;

  ctx.clearRect(0, 0, ICON_CANVAS_SIZE, ICON_CANVAS_SIZE);

  ctx.strokeStyle = ringColor;
  ctx.lineWidth = ICON_CANVAS_SIZE * 0.06;
  ctx.beginPath();
  ctx.arc(c, c, ICON_CANVAS_SIZE * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = snowflakeColor;
  // Thicker than the SPEED bolt needs to be, and thicker than this line's own first pass (0.07): a filled
  // bolt shape survives being minified onto a ~20 px pedestal, but a *white* glyph on the "ice-white" pedestal
  // row 20 also asks for (`materials.js`'s own note on `COLORS.powerUpSlowPedestal`) has far less colour
  // contrast to lean on than SPEED's yellow-on-blue does, so its silhouette has to do more of the work reading
  // as "snowflake" rather than a pale blur — hence the heavier stroke here, not a colour change (row 20's
  // white-on-ice-white is the locked spec, not this ticket's choice to revisit).
  ctx.lineWidth = ICON_CANVAS_SIZE * 0.12;
  ctx.lineCap = 'round';
  // Six spokes, each with a short pair of twigs partway along it — a simple, unmistakably "snowflake"
  // silhouette at this size (`DESIGN-DECISIONS §1 row 20`'s "never rely on colour alone").
  for (let arm_i = 0; arm_i < 6; arm_i += 1) {
    const angle = (Math.PI / 3) * arm_i;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + dx * arm, c + dy * arm);
    ctx.stroke();

    const tx = c + dx * arm * 0.6;
    const ty = c + dy * arm * 0.6;
    const perpX = -dy;
    const perpY = dx;
    ctx.beginPath();
    ctx.moveTo(tx - perpX * twig, ty - perpY * twig);
    ctx.lineTo(tx + perpX * twig, ty + perpY * twig);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(/** @type {any} */ (canvas));
  texture.needsUpdate = true;
  return texture;
}

export class PickupView {
  /**
   * @param {object} [options]
   * @param {Settings} [options.settings]
   * @param {GridSize} [options.grid]
   * @param {number} [options.maxApples] - buffer size; defaults to `settings.foodCount`
   * @param {boolean} [options.reducedFx] - freezes the pedestal's bob and spin; defaults to reading
   *   `?reducedFx=1` from the URL, same as `camera.js` and `laserView.js`
   */
  constructor({ settings = SETTINGS, grid, maxApples, reducedFx } = {}) {
    /** @type {Settings} */
    this.settings = settings;
    /** @type {GridSize} */
    this.grid = grid ?? settings.grid;
    /** Bob and spin are no-ops under `?reducedFx=1`, same as the camera's own effects (`ARCHITECTURE §11`) —
     * a frozen frame (`__kobi.pause()`) is otherwise still one `dt` away from a slightly different bob/spin
     * phase, which is exactly what a screenshot baseline cannot tolerate. @type {boolean} */
    this.reducedFx = reducedFx ?? reducedFxFromLocation();
    /** Seconds of animation time accumulated so far; frozen at 0 under `reducedFx`. @type {number} */
    this.elapsed = 0;

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

    // Power-up pedestals (KS-06-02): a box per type (blue for SPEED, ice-white for SLOW — ticket spec), each
    // carrying its own floating icon plane. Two InstancedMeshes per part rather than one shared pair, because
    // an InstancedMesh has exactly one material and the two types are drawn in two different colours.
    this.powerUpMaterials = createPowerUpMaterials(settings);
    // Shared between both types' InstancedMeshes — same box, same plane, only the material differs — and
    // kept on `this` so `dispose()` frees each exactly once rather than guessing which type "owns" it.
    this.pedestalGeometry = new THREE.BoxGeometry(PEDESTAL_SIZE, PEDESTAL_SIZE, PEDESTAL_SIZE);
    this.iconGeometry = new THREE.PlaneGeometry(ICON_SIZE, ICON_SIZE);
    const pedestalGeometry = this.pedestalGeometry;
    const iconGeometry = this.iconGeometry;

    this.boltTexture = createBoltTexture(
      this.powerUpMaterials.speedIconColor,
      this.powerUpMaterials.speedRingColor,
    );
    this.snowflakeTexture = createSnowflakeTexture(
      this.powerUpMaterials.slowIconColor,
      this.powerUpMaterials.slowRingColor,
    );
    const iconMaterialOptions = { transparent: true, side: THREE.DoubleSide };
    this.boltMaterial = new THREE.MeshBasicMaterial({
      map: this.boltTexture,
      ...iconMaterialOptions,
    });
    this.snowflakeMaterial = new THREE.MeshBasicMaterial({
      map: this.snowflakeTexture,
      ...iconMaterialOptions,
    });

    /** @type {Record<PowerUpType, {pedestal: THREE.InstancedMesh, icon: THREE.InstancedMesh}>} */
    this.powerUps = {
      SPEED: {
        pedestal: new THREE.InstancedMesh(
          pedestalGeometry,
          this.powerUpMaterials.speedPedestal,
          MAX_POWERUPS_PER_TYPE,
        ),
        icon: new THREE.InstancedMesh(iconGeometry, this.boltMaterial, MAX_POWERUPS_PER_TYPE),
      },
      SLOW: {
        pedestal: new THREE.InstancedMesh(
          pedestalGeometry,
          this.powerUpMaterials.slowPedestal,
          MAX_POWERUPS_PER_TYPE,
        ),
        icon: new THREE.InstancedMesh(iconGeometry, this.snowflakeMaterial, MAX_POWERUPS_PER_TYPE),
      },
    };
    for (const [type, view] of Object.entries(this.powerUps)) {
      view.pedestal.name = `powerUpPedestal:${type}`;
      view.pedestal.castShadow = true;
      view.pedestal.frustumCulled = false;
      view.pedestal.count = 0;
      view.icon.name = `powerUpIcon:${type}`;
      view.icon.frustumCulled = false;
      view.icon.count = 0;
      this.group.add(view.pedestal, view.icon);
    }

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
      // Same convention as the apple leaf above: `-90°` lays the plane flat (normal pointing up), and the
      // tilt then lifts its far edge toward the camera. `'YXZ'` order so `.y` (the spin) rotates the whole
      // tilted disc about the world's vertical axis instead of about its own now-tilted local axis.
      iconTilt: new THREE.Euler(
        -Math.PI / 2 + THREE.MathUtils.degToRad(ICON_TILT_DEGREES),
        0,
        0,
        'YXZ',
      ),
    };
  }

  /** Draw calls this view costs. @returns {number} */
  get drawCalls() {
    return [
      this.apples,
      this.leaves,
      this.powerUps.SPEED.pedestal,
      this.powerUps.SPEED.icon,
      this.powerUps.SLOW.pedestal,
      this.powerUps.SLOW.icon,
    ].filter((mesh) => mesh.count > 0).length;
  }

  /**
   * Redraw from a round snapshot.
   *
   * @param {{apples?: Cell[], powerUps?: {pickups: {cell: Cell, type: PowerUpType}[]}}} snapshot -
   *   `RoundSimulation.getState()`
   * @param {number} [dt] - seconds since the previous frame, for the pedestal's bob and spin
   * @returns {this}
   */
  update(snapshot, dt = 0) {
    if (!this.reducedFx) this.elapsed += dt;

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

    this.updatePowerUps(snapshot.powerUps?.pickups ?? []);
    return this;
  }

  /**
   * Redraws the power-up pedestals from this frame's pickups, bucketed by type since each type is its own
   * pair of `InstancedMesh`es (see the constructor).
   *
   * @param {{cell: Cell, type: PowerUpType}[]} pickups
   */
  updatePowerUps(pickups) {
    const { matrix, position, quaternion, scale, iconTilt } = this.scratch;
    const bySpeed = pickups.filter((p) => p.type === 'SPEED');
    const bySlow = pickups.filter((p) => p.type === 'SLOW');

    const bob = BOB_AMPLITUDE * Math.sin((2 * Math.PI * this.elapsed) / BOB_PERIOD_SECONDS);
    const spin = THREE.MathUtils.degToRad(SPIN_DEGREES_PER_SECOND) * this.elapsed;

    /** @param {{cell: Cell, type: PowerUpType}[]} list @param {THREE.InstancedMesh} pedestal @param {THREE.InstancedMesh} icon */
    const draw = (list, pedestal, icon) => {
      const drawCount = Math.min(list.length, pedestal.instanceMatrix.count);
      for (let i = 0; i < drawCount; i += 1) {
        setWorldFromGrid(position, list[i].cell.x, list[i].cell.y, this.grid, PEDESTAL_SIZE / 2);
        matrix.compose(position, new THREE.Quaternion(), scale);
        pedestal.setMatrixAt(i, matrix);

        setWorldFromGrid(
          position,
          list[i].cell.x,
          list[i].cell.y,
          this.grid,
          ICON_REST_HEIGHT + bob,
        );
        iconTilt.y = spin;
        quaternion.setFromEuler(iconTilt);
        matrix.compose(position, quaternion, scale);
        icon.setMatrixAt(i, matrix);
      }
      pedestal.count = drawCount;
      icon.count = drawCount;
      pedestal.instanceMatrix.needsUpdate = true;
      icon.instanceMatrix.needsUpdate = true;
    };

    draw(bySpeed, this.powerUps.SPEED.pedestal, this.powerUps.SPEED.icon);
    draw(bySlow, this.powerUps.SLOW.pedestal, this.powerUps.SLOW.icon);
  }

  /** Free every GPU resource this view owns. */
  dispose() {
    this.appleGeometry.dispose();
    this.leafGeometry.dispose();
    this.materials.body.dispose();
    this.materials.leaf.dispose();
    this.apples.dispose();
    this.leaves.dispose();
    for (const view of Object.values(this.powerUps)) {
      view.pedestal.dispose();
      view.icon.dispose();
    }
    this.pedestalGeometry.dispose();
    this.iconGeometry.dispose();
    this.powerUpMaterials.speedPedestal.dispose();
    this.powerUpMaterials.slowPedestal.dispose();
    this.boltMaterial.dispose();
    this.snowflakeMaterial.dispose();
    this.boltTexture.dispose();
    this.snowflakeTexture.dispose();
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
 * @param {boolean} [options.reducedFx]
 * @returns {PickupView}
 */
export function createPickupView(options = {}) {
  return new PickupView(options);
}
