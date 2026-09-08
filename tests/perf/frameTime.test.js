// @ts-check
import { describe, expect, it } from 'vitest';

import { DRAW_CALL_BUDGET } from './drawCalls.js';
import {
  FRAME_TIME_BUDGET_MS,
  RESIDENCY_FIELDS,
  buildFrameCostFailureMessage,
  buildFrameCostTable,
  buildLeakFailureMessage,
  checkFrameCost,
  checkNoLeak,
  percentile,
  summariseFrameCost,
} from './frameTime.js';

/**
 * KI-08-03 — the Node half of the frame-time budget, against hand-built fixtures.
 *
 * Everything here is the arithmetic and the messages, proven without a browser. The measurement itself is
 * `frameTime.spec.js`'s (it needs a real page); what these tests exist for is that **both gates' red paths
 * are proven rather than demonstrated once** — a failure message nobody has seen fire is not a failure
 * message, and KI-08-04's CI gate is going to depend on these two saying something useful.
 */

/**
 * @param {{calls?: number, triangles?: number, geometries?: number, textures?: number, programs?: number,
 *   sceneNodes?: number}} [overrides]
 */
function stats(overrides = {}) {
  return {
    calls: 15,
    triangles: 4000,
    lines: 0,
    points: 0,
    geometries: 12,
    textures: 3,
    programs: 5,
    sceneNodes: 47,
    ...overrides,
  };
}

/** @param {{calls: number, triangles?: number, submitMs?: number, heapBytes?: number | null}[]} rows */
function samples(rows) {
  return rows.map((row, index) => ({
    frame: index * 60,
    state: 'PLAYING',
    stats: stats({ calls: row.calls, triangles: row.triangles ?? 4000 }),
    submitMs: row.submitMs ?? 1.2,
    heapBytes: row.heapBytes === undefined ? 10 * 1024 * 1024 : row.heapBytes,
  }));
}

describe('KI-08-03 frame-time budget', () => {
  describe('percentile', () => {
    it('KI-08-03: percentile is nearest-rank, so every figure it reports was actually measured', () => {
      const values = [10, 20, 30, 40];
      // Interpolation would answer 25 for the median here — a number no frame ever cost. Nearest rank
      // answers 20, which one did.
      expect(percentile(values, 50)).toBe(20);
      expect(percentile(values, 95)).toBe(40);
      expect(percentile(values, 100)).toBe(40);
    });

    it('KI-08-03: percentile clamps rather than reading past either end of the series', () => {
      expect(percentile([7], 0)).toBe(7);
      expect(percentile([7], 100)).toBe(7);
      expect(percentile([], 95)).toBe(0);
    });
  });

  describe('summariseFrameCost', () => {
    it('KI-08-03 AC1: the summary carries draw calls, triangles, milliseconds and the last residency reading', () => {
      const summary = summariseFrameCost(
        samples([
          { calls: 15, submitMs: 100 },
          { calls: 19, submitMs: 130 },
          { calls: 17, submitMs: 120 },
        ]),
      );

      expect(summary.sampleCount).toBe(3);
      expect(summary.drawCalls).toEqual({ max: 19, p95: 19, median: 17 });
      expect(summary.submitMs.max).toBe(130);
      expect(summary.residency).toEqual({
        geometries: 12,
        textures: 3,
        programs: 5,
        sceneNodes: 47,
      });
    });

    it('KI-08-03: heap is reported only where the browser offered it, never invented', () => {
      // `performance.memory` is Chromium-only. A run that could not read it must say so rather than report
      // a zero, which would read as "this round allocated nothing".
      expect(summariseFrameCost(samples([{ calls: 15, heapBytes: null }])).heapBytes).toBeNull();
      expect(summariseFrameCost(samples([{ calls: 15 }])).heapBytes).toEqual({
        first: 10 * 1024 * 1024,
        last: 10 * 1024 * 1024,
      });
    });
  });

  describe('checkFrameCost', () => {
    it("KI-08-03 AC1: the gate is the worst sampled frame against ARCHITECTURE §12's draw-call budget", () => {
      const under = summariseFrameCost(samples([{ calls: DRAW_CALL_BUDGET }]));
      expect(checkFrameCost(under).ok).toBe(true);
      expect(checkFrameCost(under).pctOfBudget).toBe(100);

      const over = summariseFrameCost(samples([{ calls: 15 }, { calls: DRAW_CALL_BUDGET + 1 }]));
      expect(checkFrameCost(over).ok).toBe(false);
      expect(checkFrameCost(over).worst).toBe(DRAW_CALL_BUDGET + 1);
    });

    it('KI-08-03 AC1: milliseconds never decide the gate, however slow the runner was', () => {
      // The whole ruling in one assertion: a round whose every frame took 800 ms on a GPU-less runner still
      // passes, because the budget this gate keys on is work done (KI-19-00, KS-07-06).
      const slow = summariseFrameCost(
        samples([
          { calls: 15, submitMs: 800 },
          { calls: 19, submitMs: 900 },
        ]),
      );
      expect(slow.submitMs.max).toBeGreaterThan(FRAME_TIME_BUDGET_MS * 40);
      expect(checkFrameCost(slow).ok).toBe(true);
    });
  });

  describe('buildFrameCostFailureMessage', () => {
    it('KI-08-03: an over-budget message names the budget, the measurement, and what to do', () => {
      const message = buildFrameCostFailureMessage(
        summariseFrameCost(samples([{ calls: DRAW_CALL_BUDGET + 30, submitMs: 140 }])),
      );

      expect(message).toContain(`${DRAW_CALL_BUDGET + 30} draw calls`);
      expect(message).toContain(`budget of ${DRAW_CALL_BUDGET}`);
      expect(message).toContain('ARCHITECTURE §12');
      expect(message).toContain('tuning-proposal');
      // And says plainly that the milliseconds it prints are not why it failed, so a red build here is never
      // misread as "the runner was slow".
      expect(message).toContain('never the cause of this failure');
    });
  });

  describe('checkNoLeak', () => {
    it('KI-08-03 AC2: residency that never moves across checkpoints is not a leak', () => {
      const readings = [0, 100, 200, 300].map((round) => ({
        round,
        stats: stats(),
        heapBytes: null,
      }));
      expect(checkNoLeak(readings).ok).toBe(true);
    });

    it('KI-08-03 AC2: any growth in any residency field is a leak, with no tolerance', () => {
      // One extra scene node after 300 rounds is a leak. There is deliberately no allowance: these counts
      // move only when something is created or disposed, and nothing about a round boundary is supposed to
      // create anything, so a tolerance could only ever hide what this check is for.
      const readings = [
        { round: 0, stats: stats(), heapBytes: null },
        { round: 200, stats: stats(), heapBytes: null },
        { round: 300, stats: stats({ sceneNodes: 48 }), heapBytes: null },
      ];
      const result = checkNoLeak(readings);

      expect(result.ok).toBe(false);
      expect(result.growth).toEqual([{ field: 'sceneNodes', from: 47, to: 48, round: 300 }]);
    });

    it('KI-08-03 AC2: per-frame cost is not mistaken for residency', () => {
      // A laser-warning frame legitimately draws more than an opening one. If `calls` or `triangles` were
      // compared across checkpoints, the game working correctly would report as a leak — which is why
      // RESIDENCY_FIELDS names only the four that cannot move on their own.
      const readings = [
        { round: 0, stats: stats({ calls: 15, triangles: 4000 }), heapBytes: null },
        { round: 100, stats: stats({ calls: 19, triangles: 9000 }), heapBytes: null },
      ];
      expect(checkNoLeak(readings).ok).toBe(true);
      expect(RESIDENCY_FIELDS).not.toContain('calls');
      expect(RESIDENCY_FIELDS).not.toContain('triangles');
    });

    it('KI-08-03: a single reading cannot prove anything, and does not claim to', () => {
      expect(checkNoLeak([{ round: 0, stats: stats(), heapBytes: null }]).growth).toEqual([]);
    });
  });

  describe('buildLeakFailureMessage', () => {
    it('KI-08-03 AC2: a leak message names the count, the movement, the round, and where to look', () => {
      const result = checkNoLeak([
        { round: 0, stats: stats(), heapBytes: null },
        { round: 400, stats: stats({ geometries: 512 }), heapBytes: null },
      ]);
      const message = buildLeakFailureMessage(result, 500);

      expect(message).toContain('geometries: 12 → 512 by round 400 (+500)');
      expect(message).toContain('500 rounds');
      expect(message).toContain('session.js');
      // A leak is a defect, never a budget to renegotiate — so this message must not offer the escape hatch
      // the two budget messages do.
      expect(message).toContain('not a budget to raise');
      expect(message).not.toContain('tuning-proposal');
    });
  });

  describe('buildFrameCostTable', () => {
    it('KI-08-03 AC1: the table marks which rows gate and which are only recorded', () => {
      const table = buildFrameCostTable(
        summariseFrameCost(samples([{ calls: 15, submitMs: 124 }])),
      );

      expect(table).toContain(`**${DRAW_CALL_BUDGET}, gated**`);
      expect(table).toContain('must not grow, gated');
      expect(table).toContain(`recorded (${FRAME_TIME_BUDGET_MS} ms needs real hardware)`);
      expect(table).toContain('recorded, never gated');
    });

    it('KI-08-03 AC1: both millisecond figures are reported, because one of them alone would mislead', () => {
      // `submitMs` brackets the JS side of `render()` and, under SwiftShader, misses the rasterisation
      // entirely — it measured 1.0 ms median on a runner that manages 7-8 fps. `wallMsPerSample` catches
      // what it misses, by `driver.js`'s own method. Reporting only the first would claim the game sits
      // comfortably inside a 16.6 ms budget on hardware that demonstrably cannot hold it.
      const table = buildFrameCostTable(
        summariseFrameCost(samples([{ calls: 15, submitMs: 1.0 }]), 300),
      );

      expect(table).toContain('Submit ms (JS side of render())');
      expect(table).toContain('Wall ms per sampled frame');
      expect(table).toContain('includes the rasterisation');
    });

    it('KI-08-03: with no wall clock measured, the wall row is absent rather than reported as zero', () => {
      const table = buildFrameCostTable(summariseFrameCost(samples([{ calls: 15 }])));
      expect(table).not.toContain('Wall ms per sampled frame');
    });
  });
});
