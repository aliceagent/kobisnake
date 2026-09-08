// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SETTINGS } from '../../src/core/settings.js';
import { WALL_HEIGHT, WALL_THICKNESS } from '../../src/render/arenaView.js';
import {
  LASER_WARNING_OFFSET_SECONDS,
  VIEWPORTS,
  arenaCorners,
  buildViewportRow,
  isFullyOnScreen,
  laserWarningOverrides,
  ndcBounds,
  ndcBoundsToCssRect,
  rectOverlap,
  renderViewportsReport,
  splitCornersByGroup,
} from './viewports.js';

/**
 * KI-16-01 — two jobs, `pacing.test.js`'s own split (see that file's module doc for why the split exists):
 *
 * 1. **`viewports.js`'s pure functions, against hand-built fixtures.** Nothing here touches a browser —
 *    `measureMidRoundFrame`/`measureLaserBanner` are the in-page half and are proved instead by
 *    `viewports.spec.js` actually running them against the real game.
 * 2. **The committed document's machine-readable block, diffed.** What can honestly be checked without a
 *    browser: that it parses, that every viewport in {@link VIEWPORTS} has a row, and that the rendered table
 *    matches the block it was rendered from. It cannot recompute the browser-derived numbers themselves.
 */

/** @param {Partial<import('./viewports.js').ViewportRow>} overrides */
function row(overrides = {}) {
  return /** @type {import('./viewports.js').ViewportRow} */ ({
    slug: '1280x720',
    width: 1280,
    height: 720,
    dpr: 1,
    why: 'the confirmed picture; every existing baseline',
    ndcBounds: { minX: -0.9, maxX: 0.9, minY: -0.9, maxY: 0.9 },
    onScreen: true,
    floorNdcBounds: { minX: -0.8, maxX: 0.8, minY: -0.8, maxY: 0.8 },
    floorOnScreen: true,
    wallTopNdcBounds: { minX: -0.7, maxX: 0.7, minY: -0.7, maxY: 0.7 },
    wallTopOnScreen: true,
    canvasBackingWidth: 1280,
    canvasBackingHeight: 720,
    canvasCssWidth: 1280,
    canvasCssHeight: 720,
    devicePixelRatio: 1,
    p1OverlapsArena: { overlaps: false, areaPx2: 0 },
    p2OverlapsArena: { overlaps: false, areaPx2: 0 },
    laserWarningReached: true,
    bannerOverlapsP1: { overlaps: false, areaPx2: 0 },
    bannerOverlapsP2: { overlaps: false, areaPx2: 0 },
    bannerOverlapsAnyPill: false,
    ...overrides,
  });
}

describe('KI-16-01 · the viewport list', () => {
  it('KI-16-01: is exactly the seven viewports the ticket names', () => {
    expect(VIEWPORTS.map((v) => v.slug)).toEqual([
      '1280x720',
      '1024x768',
      '800x600',
      '1920x1080',
      '2560x1080',
      '1280x720@2',
      '640x480',
    ]);
  });

  it('KI-16-01: every viewport has a positive width/height and a DPR of 1 or 2', () => {
    for (const viewport of VIEWPORTS) {
      expect(viewport.width).toBeGreaterThan(0);
      expect(viewport.height).toBeGreaterThan(0);
      expect([1, 2]).toContain(viewport.dpr);
      expect(viewport.why.length).toBeGreaterThan(0);
    }
  });

  it('KI-16-01: exactly one viewport is the DPR-2 row, and it is the 1280x720 size', () => {
    const dprRows = VIEWPORTS.filter((v) => v.dpr === 2);
    expect(dprRows).toHaveLength(1);
    expect(dprRows[0]).toMatchObject({ width: 1280, height: 720 });
  });
});

describe('KI-16-01 · arenaCorners', () => {
  it('KI-16-01: eight points — a floor-plus-margin group and a wall-ring-geometry group, four corners each', () => {
    const corners = arenaCorners(SETTINGS);
    expect(corners).toHaveLength(8);

    const floor = corners.filter((c) => c.group === 'floor');
    const wallTop = corners.filter((c) => c.group === 'wallTop');
    expect(floor).toHaveLength(4);
    expect(wallTop).toHaveLength(4);

    // The floor group sits at y=0, spanning the camera-margin box — DESIGN-DECISIONS row 24's own framing
    // target, and exactly what render/camera.js's solveCameraDistance was solved to fit.
    const { margin } = SETTINGS.camera;
    const { width, height } = SETTINGS.grid;
    expect(new Set(floor.map((c) => c.y))).toEqual(new Set([0]));
    expect([...new Set(floor.map((c) => c.x))].sort((a, b) => a - b)).toEqual([
      -margin,
      width + margin,
    ]);
    expect([...new Set(floor.map((c) => c.z))].sort((a, b) => a - b)).toEqual([
      -margin,
      height + margin,
    ]);

    // The wall-top group sits at y=WALL_HEIGHT, spanning the wall ring's own real outer footprint
    // (WALL_THICKNESS) — never the camera-margin box, which is empty framing headroom, not wall geometry
    // (tech-lead correction on this ticket's PR: an earlier draft conflated the two).
    expect(new Set(wallTop.map((c) => c.y))).toEqual(new Set([WALL_HEIGHT]));
    expect([...new Set(wallTop.map((c) => c.x))].sort((a, b) => a - b)).toEqual([
      -WALL_THICKNESS,
      width + WALL_THICKNESS,
    ]);
    expect([...new Set(wallTop.map((c) => c.z))].sort((a, b) => a - b)).toEqual([
      -WALL_THICKNESS,
      height + WALL_THICKNESS,
    ]);

    // The margin is strictly wider than one wall thickness (1.5 > 1 in the shipping settings), so the two
    // groups' boxes are genuinely different, not the same box relabelled.
    expect(margin).toBeGreaterThan(WALL_THICKNESS);
  });
});

describe('KI-16-01 · splitCornersByGroup', () => {
  it("KI-16-01: floor corners and wall-top corners split into their own NDC lists, in order, by 'group'", () => {
    const corners = arenaCorners(SETTINGS);
    // A stand-in NDC point per corner, tagged with its index so the split can be checked positionally.
    const ndcPoints = corners.map((corner, i) => ({ x: i, y: i, z: 0 }));

    const { floorNdc, wallTopNdc } = splitCornersByGroup(corners, ndcPoints);

    expect(floorNdc).toHaveLength(4);
    expect(wallTopNdc).toHaveLength(4);
    // arenaCorners lists every floor corner before every wall-top corner, so the split NDC lists are exactly
    // the first four and the last four indices.
    expect(floorNdc.map((p) => p.x)).toEqual([0, 1, 2, 3]);
    expect(wallTopNdc.map((p) => p.x)).toEqual([4, 5, 6, 7]);
  });

  it('KI-16-01: an untagged corner (no group field) is treated as wallTop, never silently dropped', () => {
    const corners = /** @type {import('./viewports.js').ArenaCorner[]} */ ([
      { x: 0, y: 0, z: 0, group: 'floor' },
      { x: 1, y: 1, z: 1, group: /** @type {any} */ (undefined) },
    ]);
    const ndcPoints = [
      { x: 10, y: 10, z: 0 },
      { x: 20, y: 20, z: 0 },
    ];
    const { floorNdc, wallTopNdc } = splitCornersByGroup(corners, ndcPoints);
    expect(floorNdc).toHaveLength(1);
    expect(wallTopNdc).toHaveLength(1);
  });
});

describe('KI-16-01 · laserWarningOverrides', () => {
  it('KI-16-01: laserStartTime is roundDuration minus the offset', () => {
    expect(laserWarningOverrides(SETTINGS)).toEqual({
      laserStartTime: SETTINGS.roundDuration - LASER_WARNING_OFFSET_SECONDS,
    });
  });

  it('KI-16-01: never edits src/core/settings.js — the override is a plain hypothetical tree', () => {
    const before = SETTINGS.laserStartTime;
    laserWarningOverrides(SETTINGS);
    expect(SETTINGS.laserStartTime).toBe(before);
  });
});

describe('KI-16-01 · ndcBounds / isFullyOnScreen', () => {
  it('KI-16-01: min/max over a handful of points', () => {
    const points = [
      { x: -0.5, y: 0.2, z: 0 },
      { x: 0.9, y: -0.7, z: 0 },
      { x: 0.1, y: 0.99, z: 0 },
    ];
    expect(ndcBounds(points)).toEqual({ minX: -0.5, maxX: 0.9, minY: -0.7, maxY: 0.99 });
  });

  it('KI-16-01: an empty point list has no finite bounds (never a real input — arenaCorners always returns eight)', () => {
    const bounds = ndcBounds([]);
    expect(bounds.minX).toBe(Infinity);
    expect(bounds.maxX).toBe(-Infinity);
    expect(bounds.minY).toBe(Infinity);
    expect(bounds.maxY).toBe(-Infinity);
    // Vacuously true — an inverted, empty box satisfies every bound comparison. Not a real usage
    // (`measureMidRoundFrame` always projects `arenaCorners`' own eight points), documented rather than
    // special-cased so the function stays the simple min/max reduction it is.
    expect(isFullyOnScreen(bounds)).toBe(true);
  });

  it('KI-16-01: on screen iff every bound is within [-1, 1]', () => {
    expect(isFullyOnScreen({ minX: -1, maxX: 1, minY: -1, maxY: 1 })).toBe(true);
    expect(isFullyOnScreen({ minX: -1.001, maxX: 1, minY: -1, maxY: 1 })).toBe(false);
    expect(isFullyOnScreen({ minX: -1, maxX: 1, minY: -1, maxY: 1.2 })).toBe(false);
  });

  it('KI-16-01: floating-point noise at the exact boundary still counts as on screen', () => {
    // render/camera.js's own framing solve fits the floor's near edge to the frustum by an equality, which
    // is what actually produces a bound like this in the real measurement (docs/qa/playtests/viewports.md) —
    // a few Number.EPSILONs past -1, not a real overflow.
    expect(isFullyOnScreen({ minX: -1, maxX: 1, minY: -1.0000000000000002, maxY: 1 })).toBe(true);
    // A real, meaningfully sized deviation still fails — the epsilon is float-noise-scale, not a real margin.
    expect(isFullyOnScreen({ minX: -1, maxX: 1, minY: -1.0056147275031564, maxY: 1 })).toBe(false);
  });
});

describe('KI-16-01 · ndcBoundsToCssRect', () => {
  it('KI-16-01: full-frame NDC bounds map onto exactly the canvas rect', () => {
    const canvasRect = { left: 10, top: 20, right: 1290, bottom: 740, width: 1280, height: 720 };
    const rect = ndcBoundsToCssRect({ minX: -1, maxX: 1, minY: -1, maxY: 1 }, canvasRect);
    expect(rect).toEqual({ left: 10, top: 20, right: 1290, bottom: 740, width: 1280, height: 720 });
  });

  it('KI-16-01: NDC y is flipped against CSS top (maxY is the smallest CSS top)', () => {
    const canvasRect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    // The top-right quarter of NDC space: x in [0, 1], y in [0, 1].
    const rect = ndcBoundsToCssRect({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, canvasRect);
    expect(rect).toEqual({ left: 50, top: 0, right: 100, bottom: 50, width: 50, height: 50 });
  });
});

describe('KI-16-01 · rectOverlap', () => {
  it('KI-16-01: overlapping rects report true and the intersection area', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
    const b = { left: 5, top: 5, right: 15, bottom: 15, width: 10, height: 10 };
    expect(rectOverlap(a, b)).toEqual({ overlaps: true, areaPx2: 25 });
  });

  it('KI-16-01: disjoint rects report false and zero area, never negative', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
    const b = { left: 20, top: 20, right: 30, bottom: 30, width: 10, height: 10 };
    expect(rectOverlap(a, b)).toEqual({ overlaps: false, areaPx2: 0 });
  });

  it('KI-16-01: rects that only touch at an edge do not overlap (zero-area intersection)', () => {
    const a = { left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 };
    const b = { left: 10, top: 0, right: 20, bottom: 10, width: 10, height: 10 };
    expect(rectOverlap(a, b)).toEqual({ overlaps: false, areaPx2: 0 });
  });
});

describe('KI-16-01 · buildViewportRow', () => {
  it('KI-16-01: combines raw in-page measurements into the derived yes/no + numeric fields', () => {
    const canvasRect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
    const built = buildViewportRow({
      slug: '1280x720',
      width: 1280,
      height: 720,
      dpr: 1,
      why: 'the confirmed picture; every existing baseline',
      // Two floor corners and one wall-top corner, world coordinates unused by this test beyond their `group`.
      corners: [
        { x: 0, y: 0, z: 0, group: 'floor' },
        { x: -1, y: 0, z: 0, group: 'floor' },
        { x: 1, y: 1, z: 0, group: 'wallTop' },
      ],
      midRound: {
        // A point at the exact centre of the frame in NDC (0, 0) plus one just inside each edge — safely
        // on screen — and a canvas rect equal to the CSS viewport.
        ndcPoints: [
          { x: 0, y: 0, z: 0 },
          { x: -0.8, y: -0.8, z: 0 },
          { x: 0.8, y: 0.8, z: 0 },
        ],
        canvasRect,
        canvasBackingWidth: 1280,
        canvasBackingHeight: 720,
        devicePixelRatio: 1,
        // Placed in the very top-left corner, far from the on-screen bounds above, so it must not overlap.
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        timerRect: { left: 600, top: 0, right: 680, bottom: 40, width: 80, height: 40 },
      },
      laser: {
        reached: true,
        bannerRect: { left: 500, top: 100, right: 780, bottom: 140, width: 280, height: 40 },
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 500, top: 100, right: 600, bottom: 140, width: 100, height: 40 },
      },
    });

    expect(built.onScreen).toBe(true);
    expect(built.canvasBackingWidth).toBe(1280);
    expect(built.p1OverlapsArena.overlaps).toBe(false);
    expect(built.laserWarningReached).toBe(true);
    expect(built.bannerOverlapsP1.overlaps).toBe(false);
    expect(built.bannerOverlapsP2.overlaps).toBe(true);
    expect(built.bannerOverlapsAnyPill).toBe(true);
    expect(built.floorOnScreen).toBe(true);
    expect(built.wallTopOnScreen).toBe(true);
  });

  it('KI-16-01: a point outside the frustum makes the whole viewport not on screen', () => {
    const canvasRect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
    const built = buildViewportRow({
      slug: '640x480',
      width: 640,
      height: 480,
      dpr: 1,
      why: 'the stated minimum',
      corners: [
        { x: 0, y: 0, z: 0, group: 'floor' },
        { x: 1, y: 0, z: 0, group: 'floor' },
      ],
      midRound: {
        ndcPoints: [
          { x: 0, y: 0, z: 0 },
          { x: 1.4, y: 0, z: 0 }, // outside the frame on the right
        ],
        canvasRect,
        canvasBackingWidth: 640,
        canvasBackingHeight: 480,
        devicePixelRatio: 1,
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        timerRect: { left: 300, top: 0, right: 340, bottom: 20, width: 40, height: 20 },
      },
      laser: {
        reached: false,
        bannerRect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
      },
    });

    expect(built.onScreen).toBe(false);
    expect(built.floorOnScreen).toBe(false);
    expect(built.laserWarningReached).toBe(false);
    expect(built.bannerOverlapsAnyPill).toBe(false);
  });

  it('KI-16-01: distinguishes which group overflows — floor framing, the wall ring, or neither (the real 1280x720 shape is "neither")', () => {
    const canvasRect = { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 };
    const baseArgs = {
      slug: 'x',
      width: 1280,
      height: 720,
      dpr: 1,
      why: 'x',
      corners: /** @type {import('./viewports.js').ArenaCorner[]} */ ([
        { x: 0, y: 0, z: 0, group: 'floor' },
        { x: 1, y: 0, z: 0, group: 'floor' },
        { x: 0, y: 1, z: 0, group: 'wallTop' },
      ]),
      laser: {
        reached: true,
        bannerRect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
      },
    };

    // The real 1280x720 shape, after this ticket's own correction: the floor's near edge sits exactly on the
    // boundary and the wall ring's own (correctly measured, WALL_THICKNESS-extent) top corner sits safely
    // inside it — nothing overflows.
    const neitherOverflows = buildViewportRow({
      ...baseArgs,
      midRound: {
        ndcPoints: [
          { x: -0.5, y: -1, z: 0 },
          { x: 0.5, y: -1, z: 0 },
          { x: -0.4, y: -0.9655, z: 0 },
        ],
        canvasRect,
        canvasBackingWidth: 1280,
        canvasBackingHeight: 720,
        devicePixelRatio: 1,
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        timerRect: { left: 600, top: 0, right: 680, bottom: 40, width: 80, height: 40 },
      },
    });
    expect(neitherOverflows.onScreen).toBe(true);
    expect(neitherOverflows.floorOnScreen).toBe(true);
    expect(neitherOverflows.wallTopOnScreen).toBe(true);

    // A hypothetical where the wall ring's own geometry (not the floor framing) is what overflows.
    const wallOnly = buildViewportRow({
      ...baseArgs,
      midRound: {
        ndcPoints: [
          { x: -0.5, y: -1, z: 0 },
          { x: 0.5, y: -1, z: 0 },
          { x: -0.4, y: -1.02, z: 0 },
        ],
        canvasRect,
        canvasBackingWidth: 1280,
        canvasBackingHeight: 720,
        devicePixelRatio: 1,
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        timerRect: { left: 600, top: 0, right: 680, bottom: 40, width: 80, height: 40 },
      },
    });
    expect(wallOnly.onScreen).toBe(false);
    expect(wallOnly.floorOnScreen).toBe(true);
    expect(wallOnly.wallTopOnScreen).toBe(false);

    // A hypothetical where the floor framing itself is what overflows.
    const floorToo = buildViewportRow({
      ...baseArgs,
      midRound: {
        ndcPoints: [
          { x: -0.5, y: -1.02, z: 0 },
          { x: 0.5, y: -1, z: 0 },
          { x: -0.4, y: -0.9655, z: 0 },
        ],
        canvasRect,
        canvasBackingWidth: 1280,
        canvasBackingHeight: 720,
        devicePixelRatio: 1,
        p1Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        p2Rect: { left: 0, top: 0, right: 5, bottom: 5, width: 5, height: 5 },
        timerRect: { left: 600, top: 0, right: 680, bottom: 40, width: 80, height: 40 },
      },
    });
    expect(floorToo.onScreen).toBe(false);
    expect(floorToo.floorOnScreen).toBe(false);
    expect(floorToo.wallTopOnScreen).toBe(true);
  });
});

describe('KI-16-01 · renderViewportsReport', () => {
  it('KI-16-01: renders a table row and a JSON block entry for every given row', () => {
    const rows = [row(), row({ slug: '640x480', width: 640, height: 480 })];
    const markdown = renderViewportsReport({
      meta: {
        date: '2026-09-08',
        command: 'KI_VIEWPORTS=1 npm run test:agent:viewports',
        wallSeconds: 42,
      },
      rows,
    });

    expect(markdown).toContain('| 1280x720 |');
    expect(markdown).toContain('| 640x480 |');
    expect(markdown).toContain('KI_VIEWPORTS=1 npm run test:agent:viewports');

    const jsonMatch = markdown.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(/** @type {RegExpMatchArray} */ (jsonMatch)[1]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows.map((/** @type {{slug: string}} */ r) => r.slug)).toEqual([
      '1280x720',
      '640x480',
    ]);
  });

  it("KI-16-01: names AC1's own question — a false overflow/overlap is reported plainly, not hidden", () => {
    const markdown = renderViewportsReport({
      meta: { date: '2026-09-08', command: 'x', wallSeconds: 1 },
      rows: [row({ onScreen: false, slug: '2560x1080', width: 2560, height: 1080 })],
    });
    expect(markdown).toMatch(/Arena framing runs outside the frame at 1 of 1 viewports/);
  });

  it('KI-16-01: with no overflow anywhere, states the framing is correct and the zero-slack fit, by number', () => {
    const markdown = renderViewportsReport({
      meta: { date: '2026-09-08', command: 'x', wallSeconds: 1 },
      rows: [row()],
    });
    expect(markdown).toMatch(/Arena framing is correct at every measured viewport/);
    expect(markdown).toMatch(/near-edge fit has zero slack/);
  });

  it('KI-16-01: table rows name which group — floor framing or the wall ring — actually overflows', () => {
    const markdown = renderViewportsReport({
      meta: { date: '2026-09-08', command: 'x', wallSeconds: 1 },
      rows: [
        row({ onScreen: false, floorOnScreen: true, wallTopOnScreen: false, slug: '1280x720' }),
        row({
          onScreen: false,
          floorOnScreen: false,
          wallTopOnScreen: true,
          slug: '800x600',
          width: 800,
          height: 600,
        }),
      ],
    });
    expect(markdown).toContain("*(the wall ring's own geometry outside)*");
    expect(markdown).toContain('*(floor framing outside)*');
  });

  it('KI-16-01: the Floor near-edge NDC y column carries full float precision, not a rounded value', () => {
    const markdown = renderViewportsReport({
      meta: { date: '2026-09-08', command: 'x', wallSeconds: 1 },
      rows: [
        row({ floorNdcBounds: { minX: -0.5, maxX: 0.5, minY: -1.0000000000000002, maxY: 0.9 } }),
      ],
    });
    expect(markdown).toContain('-1.0000000000000002');
  });
});

describe('KI-16-01 AC1/AC2: the committed document', () => {
  const docPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'docs',
    'qa',
    'playtests',
    'viewports.md',
  );

  it('KI-16-01 AC1: docs/qa/playtests/viewports.md exists and carries a row + a screenshot link per viewport', () => {
    expect(existsSync(docPath)).toBe(true);
    const markdown = readFileSync(docPath, 'utf8');
    for (const viewport of VIEWPORTS) {
      expect(markdown).toContain(`| ${viewport.slug} |`);
      expect(markdown).toContain(`(viewports/${viewport.slug}.png)`);
    }
  });

  it('KI-16-01 AC2: every row in the committed JSON block carries the getBoundingClientRect-derived fields', () => {
    const markdown = readFileSync(docPath, 'utf8');
    const jsonMatch = markdown.match(/```json\n([\s\S]+?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsed = JSON.parse(/** @type {RegExpMatchArray} */ (jsonMatch)[1]);

    expect(parsed.rows.map((/** @type {{slug: string}} */ r) => r.slug)).toEqual(
      VIEWPORTS.map((v) => v.slug),
    );
    for (const committedRow of parsed.rows) {
      expect(typeof committedRow.onScreen).toBe('boolean');
      expect(typeof committedRow.floorOnScreen).toBe('boolean');
      expect(typeof committedRow.floorNdcBounds.minY).toBe('number');
      expect(typeof committedRow.wallTopOnScreen).toBe('boolean');
      expect(typeof committedRow.wallTopNdcBounds.minY).toBe('number');
      expect(typeof committedRow.p1OverlapsArena.overlaps).toBe('boolean');
      expect(typeof committedRow.p1OverlapsArena.areaPx2).toBe('number');
      expect(typeof committedRow.p2OverlapsArena.overlaps).toBe('boolean');
      expect(typeof committedRow.bannerOverlapsAnyPill).toBe('boolean');
      expect(typeof committedRow.canvasBackingWidth).toBe('number');
      expect(typeof committedRow.canvasBackingHeight).toBe('number');
    }

    // Re-rendering the committed rows must reproduce the committed table exactly — a hand-edited document
    // that drifted from what the harness produced fails here, the same job `pacing.test.js` does for
    // `round-pacing.md` (this file's own module doc, job 2).
    const rerendered = renderViewportsReport({
      meta: { date: 'x', command: 'x', wallSeconds: 0 },
      rows: parsed.rows,
    });
    const tableSection = (/** @type {string} */ text) =>
      text.slice(text.indexOf('## The matrix'), text.indexOf('## Screenshots'));
    expect(tableSection(rerendered)).toBe(tableSection(markdown));
  });

  it('KI-16-01: the 1280x720 DPR-1 row shows a 1:1 backing buffer, and the DPR-2 row shows the doubled buffer', () => {
    const markdown = readFileSync(docPath, 'utf8');
    const jsonMatch = markdown.match(/```json\n([\s\S]+?)\n```/);
    const parsed = JSON.parse(/** @type {RegExpMatchArray} */ (jsonMatch)[1]);
    const baseline = parsed.rows.find((/** @type {{slug: string}} */ r) => r.slug === '1280x720');
    const dprRow = parsed.rows.find((/** @type {{slug: string}} */ r) => r.slug === '1280x720@2');

    expect(baseline.canvasBackingWidth).toBe(baseline.canvasCssWidth * baseline.devicePixelRatio);
    expect(dprRow.devicePixelRatio).toBe(2);
    expect(dprRow.canvasBackingWidth).toBe(dprRow.canvasCssWidth * 2);
    expect(dprRow.canvasBackingHeight).toBe(dprRow.canvasCssHeight * 2);
  });

  it('KI-16-01: the corrected run finds no overflow at any viewport, and the floor near-edge fit is the same one-ULP gap everywhere', () => {
    const markdown = readFileSync(docPath, 'utf8');
    const jsonMatch = markdown.match(/```json\n([\s\S]+?)\n```/);
    const parsed = JSON.parse(/** @type {RegExpMatchArray} */ (jsonMatch)[1]);

    for (const committedRow of parsed.rows) {
      expect(committedRow.onScreen, committedRow.slug).toBe(true);
      expect(committedRow.floorOnScreen, committedRow.slug).toBe(true);
      expect(committedRow.wallTopOnScreen, committedRow.slug).toBe(true);
    }

    // The vertical framing constraint binds regardless of aspect ratio here (every measured viewport is 4:3
    // or wider, comfortably past the ~1.023 breakpoint), so the near-edge NDC y should be identical across
    // every row — the numeric signature of "the camera distance is identical at every landscape viewport".
    const nearEdges = new Set(
      parsed.rows.map((/** @type {{floorNdcBounds: {minY: number}}} */ r) => r.floorNdcBounds.minY),
    );
    expect(nearEdges.size).toBe(1);
  });
});
