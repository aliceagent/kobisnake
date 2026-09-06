// @ts-check
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { SETTINGS } from '../core/settings.js';
import { createEyeMaterials, createSnakeMaterial } from './materials.js';
import { setWorldFromGrid, yawFromGridDirection } from './arenaView.js';

/**
 * One snake, drawn from a `RoundSimulation` snapshot.
 *
 * This is the file `09-snake-turning-animation.png` is about: **grid logic, smooth visuals**. The simulation
 * moves in whole cells; this view never does. Every segment is drawn at
 * `lerp(previousSegments[i], segments[i], stepProgress)`, so each brick follows the exact path of the brick
 * in front of it and the chain glides rather than snapping (`ARCHITECTURE §5`).
 *
 * Three things the sprint file calls out as where glitches hide, handled explicitly:
 *
 * - **Growth.** `Snake.commitStep` duplicates the old tail cell into `previousSegments` for a new segment, so
 *   the two arrays are always the same length and the new brick is stationary for its first step. This view
 *   spots that duplicate and scales the brick from 0 to 1 across that step, so it grows out of the tail
 *   instead of popping into existence (`DESIGN-DECISIONS §3`, "new segment appears at the tail").
 * - **Death.** A snake that dies never commits its step: `alive` goes false with `segments` still on the last
 *   cells it legally occupied and `stepProgress` back at ~0. Rendering the snapshot as given therefore
 *   freezes the snake exactly where it died, which is what the ticket asks for, and the head never slides
 *   into the wall it hit.
 * - **Corners.** A segment whose neighbours are not collinear is turning. Its box is rotated toward the
 *   bisector of the two directions, capped at {@link MAX_BEND_DEGREES}, so the chain reads as a curve
 *   without the bricks ever leaving their cells.
 *
 * Draw calls: three per snake, whatever the snake's length (AC2). The body and the head share one
 * `InstancedMesh` — the head is instance 0, and an instance matrix carries scale, so "the head is bigger" costs
 * nothing — and the eye whites and the pupils are one instanced pair each.
 */

/** @typedef {import('../core/settings.js').Settings} Settings */
/** @typedef {import('../core/grid.js').GridSize} GridSize */

/**
 * A snake as `RoundSimulation.getState()` reports it.
 *
 * @typedef {object} SnakeSnapshot
 * @property {string} id
 * @property {boolean} alive
 * @property {{dx: number, dy: number}} direction
 * @property {{x: number, y: number}[]} segments
 * @property {{x: number, y: number}[]} previousSegments
 * @property {number} stepProgress
 */

/** Body segment: 0.9 units square, 0.7 tall (ticket spec). */
const SEGMENT_SIZE = 0.9;
const SEGMENT_HEIGHT = 0.7;

/** Head: 1.0 units square and 0.85 tall, so it reads as the front of the snake at a glance (ticket spec). */
const HEAD_SIZE = 1;
const HEAD_HEIGHT = 0.85;

/** How far a corner segment may rotate toward the bisector. The ticket's cap: "keep it subtle (≤ 20°)". */
export const MAX_BEND_DEGREES = 20;

/** Corner radius of a brick, as a fraction of a unit cube. */
const BRICK_RADIUS = 0.14;
const BRICK_SEGMENTS = 2;

/** Eyes: two white spheres with black pupils (`07-snake-character-sheet.png`). */
const EYE_RADIUS = 0.17;
const PUPIL_RADIUS = 0.085;
/**
 * Eye placement in head-local space: sideways, up from the head's centre, and forward toward the face.
 *
 * They sit on the head's **top front corner**, proud of both surfaces, rather than flat on the front face.
 * The gameplay camera looks down from 78° (`DESIGN-DECISIONS §1 row 24`), so it sees the top of the head and
 * barely any of its front: eyes on the front face alone are invisible from the only angle the game is ever
 * played at, which is why every gameplay image shows them from above.
 */
const EYE_SIDEWAYS = 0.26;
const EYE_UP = 0.3;
const EYE_FORWARD = 0.34;

/** Sphere tessellation. Low, because these are 14 cm balls seen from 49 units away. */
const EYE_WIDTH_SEGMENTS = 12;
const EYE_HEIGHT_SEGMENTS = 8;

/**
 * Signed shortest angle from `from` to `to`, in radians — i.e. the turn that gets you there the short way
 * round rather than the long way.
 *
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function shortestAngleTo(from, to) {
  let delta = (to - from) % (2 * Math.PI);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return delta;
}

export class SnakeView {
  /**
   * @param {object} options
   * @param {string} [options.colorName] - a key of `SETTINGS.colors`; defaults to red
   * @param {Settings} [options.settings]
   * @param {GridSize} [options.grid]
   */
  constructor({ colorName = 'red', settings = SETTINGS, grid } = {}) {
    /** @type {Settings} */
    this.settings = settings;
    /** @type {GridSize} */
    this.grid = grid ?? settings.grid;
    /** @type {string} */
    this.colorName = colorName;

    // A snake can never be longer than the board has cells, so this is the true upper bound and the buffer
    // is allocated once. Only `count` changes as the snake grows.
    const maxSegments = this.grid.width * this.grid.height;

    /** @type {THREE.Group} */
    this.group = new THREE.Group();
    this.group.name = `snake:${colorName}`;

    this.bodyMaterial = createSnakeMaterial(colorName, settings);
    /** Head and body in one draw call; instance 0 is the head (AC2). @type {THREE.InstancedMesh} */
    this.segments = new THREE.InstancedMesh(
      new RoundedBoxGeometry(1, 1, 1, BRICK_SEGMENTS, BRICK_RADIUS),
      this.bodyMaterial,
      maxSegments,
    );
    this.segments.name = 'segments';
    this.segments.castShadow = true;
    this.segments.receiveShadow = true;
    this.segments.frustumCulled = false;
    this.segments.count = 0;
    this.group.add(this.segments);

    const eyeMaterials = createEyeMaterials();
    const eyeGeometry = new THREE.SphereGeometry(1, EYE_WIDTH_SEGMENTS, EYE_HEIGHT_SEGMENTS);
    /** @type {THREE.InstancedMesh} */
    this.eyes = new THREE.InstancedMesh(eyeGeometry, eyeMaterials.white, 2);
    this.eyes.name = 'eyes';
    this.eyes.frustumCulled = false;
    /** @type {THREE.InstancedMesh} */
    this.pupils = new THREE.InstancedMesh(eyeGeometry, eyeMaterials.pupil, 2);
    this.pupils.name = 'pupils';
    this.pupils.frustumCulled = false;
    this.eyeMaterials = eyeMaterials;
    this.eyeGeometry = eyeGeometry;
    this.group.add(this.eyes);
    this.group.add(this.pupils);

    /** Where the head was drawn last frame, in world space. Read by the `__kobi` test hooks. */
    this.headPosition = new THREE.Vector3();
    /** The yaw the head was drawn at last frame, in radians. */
    this.headYaw = 0;

    // Scratch, reused every frame so a 60-segment snake at 60 fps allocates nothing.
    this.scratch = {
      matrix: new THREE.Matrix4(),
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      scale: new THREE.Vector3(),
      offset: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
    };
  }

  /**
   * Draw calls this view costs. The ticket's AC2 budget is three per snake.
   *
   * @returns {number}
   */
  get drawCalls() {
    return [this.segments, this.eyes, this.pupils].filter((mesh) => mesh.count > 0).length;
  }

  /**
   * Redraw from a snapshot of one snake.
   *
   * @param {SnakeSnapshot} snake - one entry of `RoundSimulation.getState().snakes`
   * @returns {this}
   */
  update(snake) {
    const { segments, previousSegments, stepProgress } = snake;
    const length = segments.length;
    const { matrix, position, quaternion, scale, up } = this.scratch;

    // A growth step duplicates the old tail cell into `previousSegments`, so the last two previous cells are
    // identical exactly when the last segment is brand new. That is the whole detection: no frame-to-frame
    // state, so a view built mid-round is identical to one that has been running since the first tick.
    const grew =
      length > 1 &&
      previousSegments[length - 1].x === previousSegments[length - 2].x &&
      previousSegments[length - 1].y === previousSegments[length - 2].y;
    // A dead snake is drawn at its cells outright, not at `stepProgress`. When a snake dies it never commits
    // its step, so `segments` still holds the last cells it legally occupied — but `Snake.accumulate` has
    // already wrapped `stepProgress` back to ~0 for the step that killed it. Lerping with that would snap the
    // whole snake a cell backwards on the frame it dies, which is the "interpolation across a death step"
    // glitch the sprint file warns about. Alpha 1 freezes it exactly where the last frame drew it.
    const alpha = snake.alive === false ? 1 : Math.min(Math.max(stepProgress, 0), 1);

    for (let i = 0; i < length; i += 1) {
      const from = previousSegments[i];
      const to = segments[i];
      const gridX = from.x + (to.x - from.x) * alpha;
      const gridY = from.y + (to.y - from.y) * alpha;

      const isHead = i === 0;
      const size = isHead ? HEAD_SIZE : SEGMENT_SIZE;
      const height = isHead ? HEAD_HEIGHT : SEGMENT_HEIGHT;
      const yaw = isHead ? this.headYawFor(snake) : this.bendYawFor(segments, i);

      // A brand-new tail brick swells out of the tail across its first step rather than popping in.
      const growth = grew && i === length - 1 ? alpha : 1;

      setWorldFromGrid(position, gridX, gridY, this.grid, (height * growth) / 2);
      quaternion.setFromAxisAngle(up, yaw);
      scale.set(size * growth, height * growth, size * growth);
      matrix.compose(position, quaternion, scale);
      this.segments.setMatrixAt(i, matrix);

      if (isHead) {
        this.headPosition.copy(position);
        this.headYaw = yaw;
      }
    }

    this.segments.count = length;
    this.segments.instanceMatrix.needsUpdate = true;

    this.updateEyes();
    return this;
  }

  /**
   * The yaw of the head: the direction the snake is travelling in.
   *
   * The head's own movement this step is used where there is one, because that is what the player sees the
   * head doing; `direction` is the fallback for the frame before the first step, when the two agree anyway.
   * Reading it from the snapshot every frame is what makes AC3 true — the eyes turn on the same frame the
   * simulation commits the turn, not one later.
   *
   * @param {SnakeSnapshot} snake
   * @returns {number} yaw in radians
   */
  headYawFor(snake) {
    const from = snake.previousSegments[0];
    const to = snake.segments[0];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx !== 0 || dy !== 0) return yawFromGridDirection(dx, dy);
    return yawFromGridDirection(snake.direction.dx, snake.direction.dy);
  }

  /**
   * The yaw of body segment `i`, bent toward the bisector when it is on a corner
   * (`09-snake-turning-animation.png`).
   *
   * A segment points the way it is heading — toward the segment in front of it. When the segment behind it
   * came from a different direction, the segment is on a corner, and rotating it half way toward that
   * incoming direction (capped at {@link MAX_BEND_DEGREES}) is what turns four right-angled bricks into a
   * readable curve. A 90° corner would want 45°; the cap keeps it subtle, as the ticket asks.
   *
   * @param {{x: number, y: number}[]} cells - the snake's current cells, head first
   * @param {number} i
   * @returns {number} yaw in radians
   */
  bendYawFor(cells, i) {
    const ahead = cells[i - 1];
    const here = cells[i];
    const outgoing = yawFromGridDirection(ahead.x - here.x, ahead.y - here.y);

    const behind = cells[i + 1];
    if (behind === undefined) return outgoing;
    const incomingDx = here.x - behind.x;
    const incomingDy = here.y - behind.y;
    // The duplicated cell of a growth step, or the frozen tail of a snake that has not moved yet.
    if (incomingDx === 0 && incomingDy === 0) return outgoing;

    const incoming = yawFromGridDirection(incomingDx, incomingDy);
    const turn = shortestAngleTo(outgoing, incoming);
    const cap = THREE.MathUtils.degToRad(MAX_BEND_DEGREES);
    return outgoing + THREE.MathUtils.clamp(turn / 2, -cap, cap);
  }

  /**
   * Put the four eye spheres on the front of the head, facing the way it is going.
   */
  updateEyes() {
    if (this.segments.count === 0) {
      this.eyes.count = 0;
      this.pupils.count = 0;
      return;
    }
    const { matrix, position, quaternion, scale, offset, up } = this.scratch;
    quaternion.setFromAxisAngle(up, this.headYaw);

    for (let eye = 0; eye < 2; eye += 1) {
      const sideways = eye === 0 ? -EYE_SIDEWAYS : EYE_SIDEWAYS;

      offset.set(sideways, EYE_UP, EYE_FORWARD).applyQuaternion(quaternion);
      position.copy(this.headPosition).add(offset);
      scale.setScalar(EYE_RADIUS);
      matrix.compose(position, quaternion, scale);
      this.eyes.setMatrixAt(eye, matrix);

      // The pupil sits just proud of its eye white, up and forward, so it faces the camera as well as the
      // way the snake is going and never z-fights with the white behind it.
      offset
        .set(sideways, EYE_UP + EYE_RADIUS * 0.5, EYE_FORWARD + EYE_RADIUS * 0.62)
        .applyQuaternion(quaternion);
      position.copy(this.headPosition).add(offset);
      scale.setScalar(PUPIL_RADIUS);
      matrix.compose(position, quaternion, scale);
      this.pupils.setMatrixAt(eye, matrix);
    }

    this.eyes.count = 2;
    this.pupils.count = 2;
    this.eyes.instanceMatrix.needsUpdate = true;
    this.pupils.instanceMatrix.needsUpdate = true;
  }

  /** Free every GPU resource this view owns. */
  dispose() {
    this.segments.geometry.dispose();
    this.bodyMaterial.dispose();
    this.segments.dispose();
    this.eyeGeometry.dispose();
    this.eyeMaterials.white.dispose();
    this.eyeMaterials.pupil.dispose();
    this.eyes.dispose();
    this.pupils.dispose();
    this.group.clear();
  }
}

/**
 * Build a snake view.
 *
 * @param {object} [options] - see {@link SnakeView}
 * @param {string} [options.colorName]
 * @param {Settings} [options.settings]
 * @param {GridSize} [options.grid]
 * @returns {SnakeView}
 */
export function createSnakeView(options = {}) {
  return new SnakeView(options);
}
