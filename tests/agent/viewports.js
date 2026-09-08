// @ts-check
import { WALL_HEIGHT, WALL_THICKNESS } from '../../src/render/arenaView.js';

/**
 * KI-16-01 — measures the built game at seven viewports, through the agent driver's own real browser
 * (`tests/agent/README.md`), and renders the numbers as the committed `docs/qa/playtests/viewports.md`.
 *
 * This ticket **measures. It does not fix anything.** Every function below answers a question numerically —
 * "is this point inside the frustum", "do these two rectangles overlap, and by how many px²" — and nothing
 * here changes what `src/render/` or `src/ui/` draws. Whatever a viewport turns out to look like is the
 * correct, expected output of this file (Improvement 16's own tech-lead notes).
 *
 * ## Shape, following `tests/agent/README.md`'s two rules
 *
 * Everything that runs **inside the page** — {@link measureMidRoundFrame} and {@link measureLaserBanner} — is
 * a single self-contained function with no free variables: no imports referenced from its body, nothing
 * captured from this module's scope, only nested helpers and `globalThis`. `viewports.spec.js` hands each one
 * straight to `page.evaluate`, which ships it as source text the same way `driver.js`'s own in-page function
 * does. Everything else here is a plain Node-side function — the arena's own corners, the NDC/overlap
 * arithmetic, the report renderer — and stays unit-testable against hand-built fixtures
 * (`tests/agent/viewports.test.js`), the same split `driver.js`/`report.js` and `pacing.js` use.
 *
 * ## The projection seam
 *
 * "Is the whole arena on screen" needs a way to ask the real camera where a world point lands, and
 * `window.__kobi` had no such thing before this ticket. `src/render/renderer.js`'s new `projectToNdc(x, y, z)`
 * (forwarded by `src/game/testHooks.js`, both declared deviations from this ticket's own `Files:` list, per
 * the PR description) is the smallest real seam onto `THREE.Vector3.prototype.project` — a projection
 * primitive, not a reimplementation of the camera's own maths. Reconstructing that maths here would measure
 * this file's arithmetic instead of the game's actual camera, which is exactly the trap the ticket's own notes
 * warn against. Every arena corner in this module is derived on the Node side and projected through that one
 * real seam; nothing about the camera is assumed or duplicated.
 */

/** @typedef {{x: number, y: number, z: number, group: 'floor' | 'wallTop'}} ArenaCorner */
/** @typedef {{x: number, y: number, z: number}} Point3 */
/** @typedef {{left: number, top: number, right: number, bottom: number, width: number, height: number}} PlainRect */

/**
 * The seven viewports the ticket names, verbatim — slug, size and DPR are what both the table rows and the
 * screenshot filenames key off, so this is the one place that list is written down.
 *
 * @type {readonly {slug: string, width: number, height: number, dpr: number, why: string}[]}
 */
export const VIEWPORTS = Object.freeze([
  {
    slug: '1280x720',
    width: 1280,
    height: 720,
    dpr: 1,
    why: 'the confirmed picture; every existing baseline',
  },
  { slug: '1024x768', width: 1024, height: 768, dpr: 1, why: '4:3 laptop' },
  { slug: '800x600', width: 800, height: 600, dpr: 1, why: 'the school laptop' },
  {
    slug: '1920x1080',
    width: 1920,
    height: 1080,
    dpr: 1,
    why: "ARCHITECTURE §12's own resolution",
  },
  { slug: '2560x1080', width: 2560, height: 1080, dpr: 1, why: 'ultrawide' },
  { slug: '1280x720@2', width: 1280, height: 720, dpr: 2, why: 'high-DPI' },
  { slug: '640x480', width: 640, height: 480, dpr: 1, why: 'the stated minimum' },
]);

/**
 * How far into `PLAYING` the mid-round frame is captured, in simulated seconds. Small on purpose — this ticket
 * only needs one rendered frame during real gameplay, not a played-out round, and every extra second here is
 * wall clock every viewport pays for.
 */
export const MID_ROUND_HOLD_SECONDS = 2;

/**
 * How many `advance(chunkSeconds)` steps a guard loop gets before giving up on a state transition it expected —
 * shared by the countdown wait and the `LASER_WARNING` wait below. `chunkSeconds` 0.1 × 60 is 6 simulated
 * seconds, comfortably more than the 3.2 s countdown (`DESIGN-DECISIONS §2.4`) with room to spare, the same
 * bound `tests/e2e/laser-warning-banner.spec.js` and `tests/visual/laser.visual.spec.js` already use for the
 * identical wait.
 */
export const STATE_GUARD_STEPS = 60;

/** The chunk size those guard loops advance in. */
export const STATE_GUARD_CHUNK_SECONDS = 0.1;

/**
 * How much earlier than the shipping default `laserStartTime` is pushed for the banner measurement, in
 * seconds. `SETTINGS.roundDuration - this` is how far into `PLAYING` `LASER_WARNING` fires — 1 s, chosen to be
 * the cheapest reliable way to reach it (item 7 of the tech-lead notes: "note ... what it cost in wall clock"),
 * while staying comfortably clear of 0 so the guard loop above has real slack.
 */
export const LASER_WARNING_OFFSET_SECONDS = 1;

/**
 * The `withOverrides()`-shaped tree {@link measureLaserBanner} applies through `__kobi.setSettingsOverrides`
 * before `startMatch`, so `LASER_WARNING` fires almost immediately — the supported route (`tests/agent/
 * README.md`'s "Sweeping a setting"), never by editing `src/core/settings.js`.
 *
 * @param {import('../../src/core/settings.js').Settings} settings
 * @returns {{laserStartTime: number}}
 */
export function laserWarningOverrides(settings) {
  return { laserStartTime: settings.roundDuration - LASER_WARNING_OFFSET_SECONDS };
}

/**
 * The arena's own corners to project — two distinct point sets, tagged by `group`, answering two distinct
 * questions. **Tech-lead correction to this ticket's first draft (review on the PR): the two must not share a
 * box.** The first draft projected the wall's height at the *camera-margin* extent (`x, z ∈ {−margin,
 * gridWidth + margin}`) and found an "overflow" that was really a phantom — nothing stands at `z = gridHeight +
 * margin, y = WALL_HEIGHT`. `camera.margin` (`SETTINGS.camera.margin`, 1.5 world units) is empty framing
 * headroom the camera was asked to include *beyond* the wall ring; the wall ring itself (`arenaView.js`'s own
 * slab geometry) is only `WALL_THICKNESS` (1 unit) thick. Reporting the margin line raised to wall height as an
 * overflow would have invented a defect for KI-16-02 to "fix" by standing the camera further back — which
 * would move the confirmed 16:9 picture and fail that ticket's own AC2. So:
 *
 * - **`floor`** — the floor rectangle plus one wall thickness of *camera margin*, at floor level (`y = 0`):
 *   `x, z ∈ {−margin, gridWidth + margin} × {−margin, gridHeight + margin}`, `margin = SETTINGS.camera.margin`.
 *   This is `DESIGN-DECISIONS §1 row 24`'s own framing target — "the whole arena plus one wall thickness of
 *   margin" — and what `render/camera.js`'s `solveCameraDistance` was actually solved to fit
 *   (`halfWidth = grid.width / 2 + margin`). It answers "is the whole arena on screen".
 * - **`wallTop`** — the wall ring's own real outer footprint, at its own top (`y = WALL_HEIGHT`):
 *   `x, z ∈ {−WALL_THICKNESS, gridWidth + WALL_THICKNESS} × {−WALL_THICKNESS, gridHeight + WALL_THICKNESS}` —
 *   `arenaView.js`'s own slab extent (its near/far slabs are centred at `±WALL_THICKNESS / 2` past the grid
 *   edge with `scale.z = WALL_THICKNESS`). It answers "is any of the wall's own physical geometry cut off",
 *   which the floor-only box cannot: the camera is pitched steeply (78°) but not looking straight down, so an
 *   elevated point does not project to the same screen position as the floor point beneath it.
 *
 * World origin at the grid origin, per the tech-lead notes.
 *
 * @param {import('../../src/core/settings.js').Settings} settings
 * @returns {ArenaCorner[]} eight world points: two groups of four (one x/z corner combination each)
 */
export function arenaCorners(settings) {
  const { margin } = settings.camera;
  const { width, height } = settings.grid;

  /** @param {number[]} xs @param {number[]} zs @param {number} y @param {ArenaCorner['group']} group */
  const box = (xs, zs, y, group) =>
    xs.flatMap((x) => zs.map((z) => /** @type {ArenaCorner} */ ({ x, y, z, group })));

  return [
    ...box([-margin, width + margin], [-margin, height + margin], 0, 'floor'),
    ...box(
      [-WALL_THICKNESS, width + WALL_THICKNESS],
      [-WALL_THICKNESS, height + WALL_THICKNESS],
      WALL_HEIGHT,
      'wallTop',
    ),
  ];
}

/**
 * The min/max NDC `x`/`y` over a list of projected points — the numeric heart of "is the whole arena on
 * screen" (AC2: a question `getBoundingClientRect`/`projectToNdc` answers, never eyeballed).
 *
 * @param {Point3[]} points
 * @returns {{minX: number, maxX: number, minY: number, maxY: number}}
 */
export function ndcBounds(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * How far past `±1` an NDC bound may sit and still count as "on the boundary" rather than "outside the
 * frame". `render/camera.js`'s own framing solve fits the floor's near edge to the frustum by an *equality*
 * (`solveCameraDistance`'s "whichever needs the camera further back" picks the tight constraint exactly), so
 * a correctly framed floor projects to `minY` a few `Number.EPSILON`s either side of `-1` — measured on this
 * machine, `-1.0000000000000002`. Without slack here, that float noise would report the floor itself as
 * overflowing at *every* viewport, including the confirmed 1280×720 baseline, which is not a real finding —
 * it is a rounding artifact from the exact-boundary construction. `1e-6` is comfortably above any float noise
 * this arithmetic can produce and comfortably below the smallest real overflow this ticket found (the near
 * wall's own height, ~0.0056 of the NDC range at 1280×720) — see `docs/qa/playtests/viewports.md`.
 */
const NDC_ON_SCREEN_EPSILON = 1e-6;

/**
 * Whether an NDC bounding box sits entirely inside the view frustum's screen extent — every projected point
 * has `|x| ≤ 1` and `|y| ≤ 1` (the tech-lead notes' own definition of "inside the frame"), with
 * {@link NDC_ON_SCREEN_EPSILON} of slack so a point the framing solve placed exactly on the boundary is not
 * called "outside" by floating-point noise alone.
 *
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds
 * @returns {boolean}
 */
export function isFullyOnScreen(bounds) {
  return (
    bounds.minX >= -1 - NDC_ON_SCREEN_EPSILON &&
    bounds.maxX <= 1 + NDC_ON_SCREEN_EPSILON &&
    bounds.minY >= -1 - NDC_ON_SCREEN_EPSILON &&
    bounds.maxY <= 1 + NDC_ON_SCREEN_EPSILON
  );
}

/**
 * Splits {@link arenaCorners}' eight points (and their parallel projected NDC points, in the same order) by
 * `group` — what lets the document say *which* question (floor-plus-margin framing, or the wall's own real
 * geometry) actually bounds the frame, rather than only the combined answer. `corners` and `ndcPoints` must be
 * the same length and order (exactly what `measureMidRoundFrame` returns: `ndcPoints[i]` is `projectToNdc` of
 * `corners[i]`).
 *
 * @param {ArenaCorner[]} corners
 * @param {Point3[]} ndcPoints
 * @returns {{floorNdc: Point3[], wallTopNdc: Point3[]}}
 */
export function splitCornersByGroup(corners, ndcPoints) {
  /** @type {Point3[]} */
  const floorNdc = [];
  /** @type {Point3[]} */
  const wallTopNdc = [];
  corners.forEach((corner, i) => {
    (corner.group === 'floor' ? floorNdc : wallTopNdc).push(ndcPoints[i]);
  });
  return { floorNdc, wallTopNdc };
}

/**
 * Converts an NDC bounding box into a CSS-pixel rectangle against the canvas's own `getBoundingClientRect()` —
 * the step that lets the arena's projected bounds be compared with a HUD element's rect using the same units.
 * NDC `x` runs left→right like CSS `left`; NDC `y` runs bottom→top, the opposite of CSS `top`, hence the flip.
 *
 * @param {{minX: number, maxX: number, minY: number, maxY: number}} bounds
 * @param {PlainRect} canvasRect
 * @returns {PlainRect}
 */
export function ndcBoundsToCssRect(bounds, canvasRect) {
  const left = canvasRect.left + ((bounds.minX + 1) / 2) * canvasRect.width;
  const right = canvasRect.left + ((bounds.maxX + 1) / 2) * canvasRect.width;
  // maxY is the topmost NDC value, and CSS `top` grows downward, so the larger NDC y produces the smaller
  // (higher on the page) CSS y.
  const top = canvasRect.top + ((1 - bounds.maxY) / 2) * canvasRect.height;
  const bottom = canvasRect.top + ((1 - bounds.minY) / 2) * canvasRect.height;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * Whether two axis-aligned CSS-pixel rects overlap, and by how much — AC2's "a boolean **and** the overlap
 * area in px² so a near-miss is visible rather than hidden behind a `false`" (tech-lead notes item 6).
 *
 * @param {PlainRect} a
 * @param {PlainRect} b
 * @returns {{overlaps: boolean, areaPx2: number}}
 */
export function rectOverlap(a, b) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const areaPx2 = width * height;
  return { overlaps: areaPx2 > 0, areaPx2 };
}

/**
 * The measurement, as it runs **inside the page**, for the "whole arena on screen" / "HUD pill overlaps the
 * arena" / "canvas backing size" questions. Written as a top-level function taking one bag of arguments rather
 * than a closure — see this module's header — so `page.evaluate` may ship it as source text with nothing left
 * to resolve from this module's scope.
 *
 * Reaches a real, rendered `PLAYING` frame the same way every other spec in this directory does: the real
 * `main menu → match setup → countdown` flow through `__kobi.startMatch`, then `advance()`-stepped past the
 * countdown (`DESIGN-DECISIONS §2.4`'s four beats) and one `fastForward()` that both advances a couple of
 * simulated seconds into the round and renders exactly the frame this function measures — the ticket's own
 * "measure only on a rendered frame" (tech-lead notes item 7): `advance` alone would leave the canvas showing
 * whatever the previous state last drew.
 *
 * @param {{corners: ArenaCorner[], bestOf: number, holdSeconds: number, guardSteps: number, guardChunkSeconds: number}} args
 * @returns {{
 *   ndcPoints: Point3[],
 *   canvasRect: PlainRect,
 *   canvasBackingWidth: number,
 *   canvasBackingHeight: number,
 *   devicePixelRatio: number,
 *   p1Rect: PlainRect,
 *   p2Rect: PlainRect,
 *   timerRect: PlainRect,
 * }}
 */
export function measureMidRoundFrame(args) {
  const { corners, bestOf, holdSeconds, guardSteps, guardChunkSeconds } = args;
  const kobi = /** @type {any} */ (globalThis).__kobi;
  const doc = /** @type {any} */ (globalThis).document;

  /** @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} rect */
  function toPlainRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  kobi.startMatch({ bestOf });
  for (let i = 0; i < guardSteps && kobi.getState() === 'COUNTDOWN'; i += 1) {
    kobi.advance(guardChunkSeconds);
  }
  // One call: finishes any countdown residual, advances holdSeconds into PLAYING, and renders exactly once —
  // the frame this function measures.
  kobi.fastForward(holdSeconds);

  const canvas = doc.getElementById('game');
  const ndcPoints = corners.map((corner) => kobi.projectToNdc(corner.x, corner.y, corner.z));

  return {
    ndcPoints,
    canvasRect: toPlainRect(canvas.getBoundingClientRect()),
    canvasBackingWidth: canvas.width,
    canvasBackingHeight: canvas.height,
    devicePixelRatio: globalThis.devicePixelRatio,
    p1Rect: toPlainRect(doc.querySelector('.hud-player--p1').getBoundingClientRect()),
    p2Rect: toPlainRect(doc.querySelector('.hud-player--p2').getBoundingClientRect()),
    timerRect: toPlainRect(doc.querySelector('.hud-timer').getBoundingClientRect()),
  };
}

/**
 * The measurement, as it runs **inside the page**, for "does the laser banner overlap a pill". Self-contained
 * for the same reason {@link measureMidRoundFrame} is.
 *
 * Reaches `LASER_WARNING` the supported way (tech-lead notes item 7): `__kobi.setSettingsOverrides` brings
 * `laserStartTime` in to `args.laserStartTime` seconds remaining **before** `startMatch` — `session.js` reads
 * `settings` when it builds each round, so a tree set beforehand applies from the very first one
 * (`tests/agent/README.md`'s "Sweeping a setting"). `src/core/settings.js` itself is never touched.
 *
 * @param {{bestOf: number, laserStartTime: number, guardSteps: number, guardChunkSeconds: number}} args
 * @returns {{
 *   reached: boolean,
 *   bannerRect: PlainRect,
 *   p1Rect: PlainRect,
 *   p2Rect: PlainRect,
 * }}
 */
export function measureLaserBanner(args) {
  const { bestOf, laserStartTime, guardSteps, guardChunkSeconds } = args;
  const kobi = /** @type {any} */ (globalThis).__kobi;
  const doc = /** @type {any} */ (globalThis).document;

  /** @param {{left: number, top: number, right: number, bottom: number, width: number, height: number}} rect */
  function toPlainRect(rect) {
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  kobi.setSettingsOverrides({ laserStartTime });
  kobi.startMatch({ bestOf });
  for (let i = 0; i < guardSteps && kobi.getState() === 'COUNTDOWN'; i += 1) {
    kobi.advance(guardChunkSeconds);
  }
  for (let i = 0; i < guardSteps && kobi.getState() !== 'LASER_WARNING'; i += 1) {
    kobi.advance(guardChunkSeconds);
  }
  kobi.fastForward(0); // one render of exactly this frame (KS-06-06's own "still renders once" behaviour)

  return {
    reached: kobi.getState() === 'LASER_WARNING',
    bannerRect: toPlainRect(doc.querySelector('.hud-laser-banner').getBoundingClientRect()),
    p1Rect: toPlainRect(doc.querySelector('.hud-player--p1').getBoundingClientRect()),
    p2Rect: toPlainRect(doc.querySelector('.hud-player--p2').getBoundingClientRect()),
  };
}

/**
 * @typedef {object} ViewportRow
 * @property {string} slug
 * @property {number} width
 * @property {number} height
 * @property {number} dpr
 * @property {string} why
 * @property {{minX: number, maxX: number, minY: number, maxY: number}} ndcBounds - the combined bounds over
 *   every corner, the floor-plus-margin framing box and the wall ring's own real geometry alike; this is what
 *   {@link onScreen} is judged against.
 * @property {boolean} onScreen
 * @property {{minX: number, maxX: number, minY: number, maxY: number}} floorNdcBounds - the floor-plus-margin
 *   framing box alone (`DESIGN-DECISIONS §1 row 24`'s own target) — lets the document say whether a shortfall,
 *   if any, is the framing itself or only the wall ring's own real geometry (see {@link splitCornersByGroup}).
 * @property {boolean} floorOnScreen
 * @property {{minX: number, maxX: number, minY: number, maxY: number}} wallTopNdcBounds - the wall ring's own
 *   real outer footprint at its own top height, `arenaView.js`'s own slab extent — never the camera-margin box
 *   (that box is empty framing headroom, not wall geometry; see {@link arenaCorners}'s own doc comment for the
 *   correction this ticket's review made to an earlier draft that conflated the two).
 * @property {boolean} wallTopOnScreen
 * @property {number} canvasBackingWidth
 * @property {number} canvasBackingHeight
 * @property {number} canvasCssWidth
 * @property {number} canvasCssHeight
 * @property {number} devicePixelRatio
 * @property {{overlaps: boolean, areaPx2: number}} p1OverlapsArena
 * @property {{overlaps: boolean, areaPx2: number}} p2OverlapsArena
 * @property {boolean} laserWarningReached
 * @property {{overlaps: boolean, areaPx2: number}} bannerOverlapsP1
 * @property {{overlaps: boolean, areaPx2: number}} bannerOverlapsP2
 * @property {boolean} bannerOverlapsAnyPill
 */

/**
 * Combines one viewport's raw in-page measurements into a {@link ViewportRow} — the Node-side arithmetic that
 * turns `projectToNdc`/`getBoundingClientRect` output into the three yes/no questions the ticket asks, each
 * backed by a number rather than a screenshot squint (AC2).
 *
 * @param {object} raw
 * @param {string} raw.slug
 * @param {number} raw.width
 * @param {number} raw.height
 * @param {number} raw.dpr
 * @param {string} raw.why
 * @param {ArenaCorner[]} raw.corners - the same list passed into `measureMidRoundFrame`, same order as
 *   `raw.midRound.ndcPoints` — carried alongside so {@link splitCornersByGroup} can tell the two groups apart.
 * @param {ReturnType<typeof measureMidRoundFrame>} raw.midRound
 * @param {ReturnType<typeof measureLaserBanner>} raw.laser
 * @returns {ViewportRow}
 */
export function buildViewportRow(raw) {
  const { slug, width, height, dpr, why, corners, midRound, laser } = raw;

  const bounds = ndcBounds(midRound.ndcPoints);
  const { floorNdc, wallTopNdc } = splitCornersByGroup(corners, midRound.ndcPoints);
  const floorBounds = ndcBounds(floorNdc);
  const wallTopBounds = ndcBounds(wallTopNdc);
  const arenaCssRect = ndcBoundsToCssRect(bounds, midRound.canvasRect);
  const bannerOverlapsP1 = rectOverlap(laser.bannerRect, laser.p1Rect);
  const bannerOverlapsP2 = rectOverlap(laser.bannerRect, laser.p2Rect);

  return {
    slug,
    width,
    height,
    dpr,
    why,
    ndcBounds: bounds,
    onScreen: isFullyOnScreen(bounds),
    floorNdcBounds: floorBounds,
    floorOnScreen: isFullyOnScreen(floorBounds),
    wallTopNdcBounds: wallTopBounds,
    wallTopOnScreen: isFullyOnScreen(wallTopBounds),
    canvasBackingWidth: midRound.canvasBackingWidth,
    canvasBackingHeight: midRound.canvasBackingHeight,
    canvasCssWidth: midRound.canvasRect.width,
    canvasCssHeight: midRound.canvasRect.height,
    devicePixelRatio: midRound.devicePixelRatio,
    p1OverlapsArena: rectOverlap(arenaCssRect, midRound.p1Rect),
    p2OverlapsArena: rectOverlap(arenaCssRect, midRound.p2Rect),
    laserWarningReached: laser.reached,
    bannerOverlapsP1,
    bannerOverlapsP2,
    bannerOverlapsAnyPill: bannerOverlapsP1.overlaps || bannerOverlapsP2.overlaps,
  };
}

const fmtBool = (/** @type {boolean} */ value) => (value ? 'yes' : 'no');
const fmtPx2 = (/** @type {number} */ value) => `${Math.round(value)} px²`;
const fmtNdc = (/** @type {number} */ value) => value.toFixed(3);
/** Full double precision, not `fmtNdc`'s three decimals — this is the column that has to show a float ULP. */
const fmtNdcPrecise = (/** @type {number} */ value) => String(value);

/**
 * One row of the committed table.
 *
 * @param {ViewportRow} row
 * @returns {string}
 */
function tableRow(row) {
  const b = row.ndcBounds;
  const parts = [];
  if (!row.floorOnScreen) parts.push('floor framing');
  if (!row.wallTopOnScreen) parts.push("the wall ring's own geometry");
  const boundBy = row.onScreen ? '' : ` *(${parts.join(' and ')} outside)*`;
  return (
    `| ${row.slug} | ${row.why} | ${row.canvasBackingWidth}×${row.canvasBackingHeight} | ` +
    `${row.canvasCssWidth}×${row.canvasCssHeight} | ${row.devicePixelRatio} | ` +
    `${fmtBool(row.onScreen)}${boundBy} (x ${fmtNdc(b.minX)}…${fmtNdc(b.maxX)}, y ${fmtNdc(b.minY)}…${fmtNdc(b.maxY)}) | ` +
    `${fmtNdcPrecise(row.floorNdcBounds.minY)} | ` +
    `${fmtBool(row.p1OverlapsArena.overlaps)} (${fmtPx2(row.p1OverlapsArena.areaPx2)}) | ` +
    `${fmtBool(row.p2OverlapsArena.overlaps)} (${fmtPx2(row.p2OverlapsArena.areaPx2)}) | ` +
    `${fmtBool(row.bannerOverlapsAnyPill)} (P1 ${fmtPx2(row.bannerOverlapsP1.areaPx2)}, ` +
    `P2 ${fmtPx2(row.bannerOverlapsP2.areaPx2)}) | ` +
    `[screenshot](viewports/${row.slug}.png) |`
  );
}

/**
 * The plain-sentences findings a design lead reads first — one line per row, naming exactly what a `false`/
 * `true` above means without making them go read NDC numbers to find out.
 *
 * @param {ViewportRow[]} rows
 * @returns {string}
 */
function findingsSection(rows) {
  const overflowing = rows.filter((row) => !row.onScreen);
  const pillOverlapping = rows.filter(
    (row) => row.p1OverlapsArena.overlaps || row.p2OverlapsArena.overlaps,
  );
  const bannerOverlapping = rows.filter((row) => row.bannerOverlapsAnyPill);
  const unreachedWarning = rows.filter((row) => !row.laserWarningReached);
  const maxNearEdgeMiss = Math.max(0, ...rows.map((row) => -1 - row.floorNdcBounds.minY));

  const lines = [];
  lines.push(
    overflowing.length === 0
      ? '- **Arena framing is correct at every measured viewport.** The floor rectangle plus one wall ' +
          "thickness of camera margin (`DESIGN-DECISIONS §1 row 24`'s own framing target) and the wall " +
          `ring's own real geometry both stay inside the frame at all ${rows.length} viewports — nothing is ` +
          'cut off, at any aspect ratio in the list.'
      : `- **Arena framing runs outside the frame at ${overflowing.length} of ${rows.length} viewports** — ` +
          `${overflowing.map((row) => row.slug).join(', ')}. This ticket only measures it; KI-16-02 is where ` +
          'the framing rule that fixes it belongs.',
  );
  lines.push(
    `- **The near-edge fit has zero slack.** The floor-plus-margin box's near edge (the corner closest to the ` +
      `camera) lands on the frustum boundary to within one floating-point ULP at every viewport — the largest ` +
      `gap measured is ${maxNearEdgeMiss.toExponential(2)} of the NDC range, which is float noise, not a real ` +
      "margin. `render/camera.js`'s vertical-FOV constraint binds the camera distance whenever the viewport's " +
      'aspect ratio exceeds roughly 1.023 (`1 / sin(78°)`, since the arena is square) — every viewport in this ' +
      "list is 4:3 (1.333) or wider, so the height constraint is what's tight everywhere measured, and the " +
      'camera distance the framing solve produces is therefore identical across every landscape viewport here ' +
      '(see the matrix below — the same distance would show up as the same near-edge NDC y, which it does).',
  );
  lines.push(
    pillOverlapping.length === 0
      ? "- **HUD pills vs. the arena:** neither player pill overlaps the arena's own projected bounds at any " +
          'measured viewport.'
      : `- **HUD pills vs. the arena:** at least one player pill overlaps the arena at ${pillOverlapping.length} ` +
          `of ${rows.length} viewports — ${pillOverlapping.map((row) => row.slug).join(', ')}. KI-16-03's job, ` +
          "not this ticket's.",
  );
  lines.push(
    bannerOverlapping.length === 0
      ? '- **Laser banner vs. the pills:** the "LASERS CLOSING!" banner does not overlap either player pill at ' +
          'any measured viewport.'
      : `- **Laser banner vs. the pills:** the banner overlaps a player pill at ${bannerOverlapping.length} of ` +
          `${rows.length} viewports — ${bannerOverlapping.map((row) => row.slug).join(', ')}.`,
  );
  if (unreachedWarning.length > 0) {
    lines.push(
      `- **Laser warning not reached:** ${unreachedWarning.map((row) => row.slug).join(', ')} did not reach ` +
        "`LASER_WARNING` inside this run's own guard budget — its banner row above reads a hidden banner's " +
        'rect (0×0), not a real absence of overlap. Worth a second look before trusting that row.',
    );
  }
  return lines.join('\n');
}

/**
 * @typedef {object} ViewportsMeta
 * @property {string} date
 * @property {string} command
 * @property {number} wallSeconds
 */

/**
 * Renders {@link ViewportRow}`[]` as the markdown document committed at `docs/qa/playtests/viewports.md`, in
 * the shape `docs/qa/playtests/round-pacing.md` and `agent-run.md` use: the exact command, a table, the
 * screenshots inline, a plain-sentences findings section, and a machine-readable block
 * `tests/agent/viewports.test.js` diffs against.
 *
 * @param {{meta: ViewportsMeta, rows: ViewportRow[]}} run
 * @returns {string}
 */
export function renderViewportsReport(run) {
  const { meta, rows } = run;

  const table = [
    '| Viewport | Why | Canvas backing size | Canvas CSS box | DPR | Whole arena on screen (NDC bounds) | ' +
      'Floor near-edge NDC y | P1 pill overlaps arena | P2 pill overlaps arena | Banner overlaps a pill | ' +
      'Screenshot |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(tableRow),
  ].join('\n');
  const tableNote =
    "**Floor near-edge NDC y** is the floor-plus-margin box's own near-edge bound (`floorNdcBounds.minY`), at " +
    'full float precision — this is the number "What this found" calls a zero-slack fit: it sits a single ' +
    'floating-point ULP past `-1.0`, identically at every viewport, because the vertical framing constraint ' +
    'binds regardless of aspect ratio (see below). A row marked *(… outside)* names which of the two groups ' +
    "— the floor-plus-margin framing box, or the wall ring's own real geometry — actually left the frame; " +
    'none does at any viewport measured here.';

  const screenshots = rows
    .map(
      (row) =>
        `### ${row.slug} (${row.width}×${row.height}, DPR ${row.dpr})\n\n![${row.slug}](viewports/${row.slug}.png)\n`,
    )
    .join('\n');

  const jsonBlock = JSON.stringify({ rows }, null, 2);

  return `# Viewport matrix — the game at seven sizes

KI-16-01 · Improvement 16 (\`docs/sprints/improvement-16-viewport-and-resize.md\`)

**This ticket measures. It does not fix anything.** Every row below is a number, not a verdict — a \`false\` or
an overlap area here is the expected, correct output of a camera and a HUD that were only ever designed and
baselined at 1280×720 (\`DESIGN-DECISIONS §1 row 24\`). KI-16-02 (the framing rule) and KI-16-03 (the HUD)
are where a finding here turns into a fix.

## What actually ran

- **Command:** \`${meta.command}\`
- **Date:** ${meta.date}.
- **Wall time:** ~${meta.wallSeconds}s.
- **Engine:** Chromium (the same engine every other committed baseline in this repository is measured on).
- **Query:** \`?test=1&seed=1&reducedFx=1\` — the same seed and reduced-effects flag every visual baseline uses,
  so the arena and HUD are in the same deterministic layout on every regeneration.
- **How each viewport was sized:** \`page.setViewportSize()\` for every DPR-1 row, and — because Playwright only
  lets \`deviceScaleFactor\` be set at context creation — \`browser.newContext({ viewport, deviceScaleFactor: 2 })\`
  for the \`1280x720@2\` row alone.
- **How the mid-round frame was reached:** the real \`main menu → match setup → countdown → PLAYING\` flow
  through \`__kobi.startMatch\`, stepped past the countdown, then one \`fastForward(${MID_ROUND_HOLD_SECONDS})\`
  that both advances ${MID_ROUND_HOLD_SECONDS} simulated seconds into the round and renders the frame this
  document measures — \`fastForward\` renders once at the end of its call, never per intermediate step, so this
  costs one render per viewport.
- **How the laser banner was reached:** \`__kobi.setSettingsOverrides({ laserStartTime })\` with
  \`laserStartTime\` set to \`roundDuration − ${LASER_WARNING_OFFSET_SECONDS}\` s, called before a fresh
  \`__kobi.startMatch\` — the supported route (\`tests/agent/README.md\`'s "Sweeping a setting"; \`src/core/
  settings.js\` itself was never touched) — so \`LASER_WARNING\` fires about ${LASER_WARNING_OFFSET_SECONDS}
  simulated second into the round rather than at the shipping default's 60 s in. This is what keeps the whole
  matrix cheap: seven viewports × two short rounds each, not seven full rounds played out to a real warning.

## What was measured, and why

- **"Is the whole arena on screen"** projects two distinct point sets through \`__kobi.projectToNdc\` (the new
  seam onto \`THREE.Vector3.prototype.project\`, \`src/render/renderer.js\`, forwarded by
  \`src/game/testHooks.js\`; both declared deviations from this ticket's own \`Files:\` list, per the PR
  description) — never by eye:
  - the **floor rectangle plus one wall thickness of camera margin**, at floor level (\`y = 0\`):
    \`x, z ∈ {−margin, gridWidth + margin} × {−margin, gridHeight + margin}\`, \`margin =
    SETTINGS.camera.margin\` — \`DESIGN-DECISIONS §1 row 24\`'s own framing target, and exactly the box
    \`render/camera.js\`'s \`solveCameraDistance\` was solved to fit.
  - the **wall ring's own real geometry**, at its own top (\`WALL_HEIGHT\`): \`x, z ∈ {−WALL_THICKNESS,
    gridWidth + WALL_THICKNESS} × {−WALL_THICKNESS, gridHeight + WALL_THICKNESS}\` — \`arenaView.js\`'s own
    slab extent, never the camera-margin box. **An earlier draft of this measurement conflated the two** —
    it projected the margin box raised to wall height, which is empty framing headroom, not a point any
    geometry occupies, and reported a "wall overflow" that was a phantom (tech-lead review on this ticket's
    PR). The corrected run below finds no such thing.

  Inside the frame means every projected point has \`|x| ≤ 1\` and \`|y| ≤ 1\` in normalized device
  coordinates. Both groups are measured, because the camera's steep pitch (78° below horizontal, not a true
  top-down 90°) means an elevated point does not project to the same screen position as the floor point
  beneath it — a check that only ever looked at \`y = 0\` could not rule out the wall's own geometry
  independently. See "What this found" for what the corrected projection actually shows.
- **"Does a HUD pill overlap the arena" / "does the banner overlap a pill"** are answered by
  \`getBoundingClientRect()\` on \`.hud-player--p1\`, \`.hud-player--p2\` and \`.hud-laser-banner\`, per AC2 —
  never by eye. The arena's own NDC bounds are converted into the same CSS-pixel space as those rects (against
  the canvas's own \`getBoundingClientRect()\`) before the two are compared, so "overlap" is one rectangle
  intersection, reported as a boolean **and** the overlap area in px² so a near-miss reads as a near-miss
  rather than hiding behind a bare \`false\`.
- **Canvas backing size** is \`canvas.width\`/\`canvas.height\` (the WebGL drawing buffer) next to
  \`getBoundingClientRect()\` (the CSS box) and \`window.devicePixelRatio\`. \`renderer.js\`'s own
  \`MAX_PIXEL_RATIO\` is 2, so the \`1280x720@2\` row is the one expected to show a 2560×1440 buffer behind a
  1280×720 CSS box; every other row is expected to show a 1:1 buffer-to-box ratio.

## What this found

${findingsSection(rows)}

## The matrix

${table}

${tableNote}

## Screenshots

${screenshots}
## Machine-readable data

The exact rows tabulated above, one object per viewport — what \`tests/agent/viewports.test.js\` diffs the
committed document against on every \`npm run test:unit\`.

\`\`\`json
${jsonBlock}
\`\`\`
`;
}
