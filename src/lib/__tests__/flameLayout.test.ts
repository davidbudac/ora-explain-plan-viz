import { describe, it, expect } from 'vitest';
import { computeFlameLayout, rollupMetric, getEffectiveFlameMetric } from '../flameLayout';
import type { PlanNode } from '../types';

interface NodeSpec {
  id: number;
  actualTime?: number;
  cost?: number;
  rows?: number;
  actualRows?: number;
  starts?: number;
  estimatedRowsTotal?: number;
  inactive?: boolean;
  children?: NodeSpec[];
}

function buildNode(spec: NodeSpec, depth = 0, parentId?: number): PlanNode {
  const node: PlanNode = {
    id: spec.id,
    depth,
    operation: `OP ${spec.id}`,
    actualTime: spec.actualTime,
    cost: spec.cost,
    rows: spec.rows,
    actualRows: spec.actualRows,
    starts: spec.starts,
    estimatedRowsTotal: spec.estimatedRowsTotal,
    parentId,
    inactive: spec.inactive,
    children: [],
  };
  node.children = (spec.children ?? []).map((c) => buildNode(c, depth + 1, spec.id));
  return node;
}

const byId = (rects: ReturnType<typeof computeFlameLayout>, id: number) =>
  rects.find((r) => r.node.id === id)!;

describe('computeFlameLayout', () => {
  it('spans root over [0, width] with contiguous, non-overlapping, in-bounds children', () => {
    const root = buildNode({
      id: 0,
      actualTime: 1000,
      children: [
        { id: 1, actualTime: 400 },
        { id: 2, actualTime: 600 },
      ],
    });
    const rects = computeFlameLayout(root, 'actualTime', { width: 500 });
    const r0 = byId(rects, 0);
    expect(r0.x0).toBe(0);
    expect(r0.x1).toBe(500);

    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    expect(r1.x0).toBeGreaterThanOrEqual(r0.x0);
    expect(r2.x1).toBeLessThanOrEqual(r0.x1);
    expect(r1.x1).toBeCloseTo(r2.x0, 5); // contiguous
    expect(r1.x0).toBeGreaterThanOrEqual(0);
    expect(r2.x1).toBeLessThanOrEqual(500);
  });

  it('sizes widths proportional to actualTime and leaves parent leftover as selfValue', () => {
    const root = buildNode({
      id: 0,
      actualTime: 1000,
      children: [
        { id: 1, actualTime: 300 },
        { id: 2, actualTime: 300 },
      ],
    });
    // childSum = 600, parent value stays 1000 (raw >= childSum), selfValue = 400
    const rects = computeFlameLayout(root, 'actualTime', { width: 1000 });
    const r0 = byId(rects, 0);
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    expect(r0.selfValue).toBe(400);
    expect(r1.x1 - r1.x0).toBeCloseTo(300, 5);
    expect(r2.x1 - r2.x0).toBeCloseTo(300, 5);
    // children occupy [0,600] out of [0,1000], leaving 400px of parent's own span unused by children
    expect(r1.x0).toBeCloseTo(0, 5);
    expect(r2.x1).toBeCloseTo(600, 5);
  });

  it('grows parent value to child sum when children exceed parent (selfValue = 0, children fit exactly)', () => {
    const root = buildNode({
      id: 0,
      actualTime: 100, // less than child sum
      children: [
        { id: 1, actualTime: 300 },
        { id: 2, actualTime: 300 },
      ],
    });
    const values = rollupMetric(root, 'actualTime');
    expect(values.get(0)).toBe(600); // grown to childSum

    const rects = computeFlameLayout(root, 'actualTime', { width: 600 });
    const r0 = byId(rects, 0);
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    expect(r0.selfValue).toBe(0);
    expect(r1.x0).toBeCloseTo(0, 5);
    expect(r1.x1).toBeCloseTo(300, 5);
    expect(r2.x0).toBeCloseTo(300, 5);
    expect(r2.x1).toBeCloseTo(600, 5);
  });

  it('treats undefined actualTime as 0 own-value but still spans descendants rollup', () => {
    const root = buildNode({
      id: 0,
      // actualTime undefined
      children: [{ id: 1, actualTime: 500 }],
    });
    const values = rollupMetric(root, 'actualTime');
    expect(values.get(0)).toBe(500);

    const rects = computeFlameLayout(root, 'actualTime', { width: 500 });
    const r0 = byId(rects, 0);
    const r1 = byId(rects, 1);
    expect(r0.selfValue).toBe(0);
    expect(r1.x0).toBeCloseTo(0, 5);
    expect(r1.x1).toBeCloseTo(500, 5);
  });

  it('gives a zero-value node among large siblings exactly minWidthPx, shrinking larger siblings', () => {
    const root = buildNode({
      id: 0,
      actualTime: 1000, // == childSum, so selfValue is exactly 0
      children: [
        { id: 1, actualTime: 500 },
        { id: 2, actualTime: 0 },
        { id: 3, actualTime: 500 },
      ],
    });
    const rects = computeFlameLayout(root, 'actualTime', { width: 100, minWidthPx: 2 });
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    const r3 = byId(rects, 3);
    const w2 = r2.x1 - r2.x0;
    expect(w2).toBeCloseTo(2, 2);
    const w1 = r1.x1 - r1.x0;
    const w3 = r3.x1 - r3.x0;
    // larger siblings shrink below their pure-proportional ideal (50px each out of 100)
    expect(w1).toBeLessThan(50);
    expect(w3).toBeLessThan(50);
    // children still sum to parent's span (parent selfValue is 0 here: childSum == parent value,
    // so the entire parent width is partitioned among children)
    expect(w1 + w2 + w3).toBeCloseTo(100, 2);
  });

  it('falls back to proportional allocation with no minimum when parent is too narrow', () => {
    const root = buildNode({
      id: 0,
      actualTime: 300,
      children: [
        { id: 1, actualTime: 100 },
        { id: 2, actualTime: 100 },
        { id: 3, actualTime: 100 },
      ],
    });
    // parentWidth (4px) < children.length (3) * minWidthPx (2) = 6
    const rects = computeFlameLayout(root, 'actualTime', { width: 4, minWidthPx: 2 });
    const r0 = byId(rects, 0);
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    const r3 = byId(rects, 3);
    for (const r of [r1, r2, r3]) {
      expect(r.x1 - r.x0).toBeGreaterThanOrEqual(0);
      expect(r.x0).toBeGreaterThanOrEqual(r0.x0);
      expect(r.x1).toBeLessThanOrEqual(r0.x1);
    }
    // equal values -> equal proportional widths
    expect(r1.x1 - r1.x0).toBeCloseTo((r2.x1 - r2.x0), 5);
    expect(r2.x1 - r2.x0).toBeCloseTo((r3.x1 - r3.x0), 5);
  });

  it('works with cost metric on a plan without actual stats', () => {
    const root = buildNode({
      id: 0,
      cost: 100,
      children: [
        { id: 1, cost: 40 },
        { id: 2, cost: 60 },
      ],
    });
    const rects = computeFlameLayout(root, 'cost', { width: 100 });
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    expect(r1.x1 - r1.x0).toBeCloseTo(40, 5);
    expect(r2.x1 - r2.x0).toBeCloseTo(60, 5);
  });

  it('actualRows metric uses A-Rows as-is (already cumulative over starts), falling back to the total estimate', () => {
    const root = buildNode({
      id: 0,
      actualRows: 10,
      starts: 1,
      children: [
        { id: 1, actualRows: 5, starts: 3 }, // A-Rows already covers all 3 starts -> 5, not 15
        { id: 2, rows: 4, starts: 5, estimatedRowsTotal: 20 }, // no A-Rows -> estimatedRowsTotal
        { id: 3, rows: 7 }, // no A-Rows, no total -> rows
      ],
    });
    const values = rollupMetric(root, 'actualRows');
    expect(values.get(1)).toBe(5);
    expect(values.get(2)).toBe(20);
    expect(values.get(3)).toBe(7);
    // root raw = 10, childSum = 32, so rolled-up root value = 32
    expect(values.get(0)).toBe(32);

    const rects = computeFlameLayout(root, 'actualRows', { width: 32 });
    expect(byId(rects, 1).x1 - byId(rects, 1).x0).toBeCloseTo(5, 5);
    expect(byId(rects, 2).x1 - byId(rects, 2).x0).toBeCloseTo(20, 5);
  });

  it('rows metric uses the total estimate over all starts, falling back to per-start rows', () => {
    const root = buildNode({
      id: 0,
      rows: 1,
      children: [
        { id: 1, rows: 4, starts: 5, estimatedRowsTotal: 20 },
        { id: 2, rows: 7 },
      ],
    });
    const values = rollupMetric(root, 'rows');
    expect(values.get(1)).toBe(20);
    expect(values.get(2)).toBe(7);
    expect(values.get(0)).toBe(27);
  });

  it('getEffectiveFlameMetric falls back to cost when actual stats are absent', () => {
    expect(getEffectiveFlameMetric('actualTime', false)).toBe('cost');
    expect(getEffectiveFlameMetric('actualTime', true)).toBe('actualTime');
    expect(getEffectiveFlameMetric('cost', false)).toBe('cost');
    expect(getEffectiveFlameMetric('actualRows', false)).toBe('cost');
    expect(getEffectiveFlameMetric('actualRows', true)).toBe('actualRows');
  });

  it('zooms: passing a subtree root yields depth 0 at that node and full width for it', () => {
    const root = buildNode({
      id: 0,
      actualTime: 1000,
      children: [
        {
          id: 1,
          actualTime: 600,
          children: [{ id: 2, actualTime: 400 }, { id: 3, actualTime: 200 }],
        },
      ],
    });
    const subtreeRoot = root.children[0];
    const rects = computeFlameLayout(subtreeRoot, 'actualTime', { width: 300 });
    const r1 = byId(rects, 1);
    expect(r1.depth).toBe(0);
    expect(r1.x0).toBe(0);
    expect(r1.x1).toBe(300);
    const r2 = byId(rects, 2);
    const r3 = byId(rects, 3);
    expect(r2.depth).toBe(1);
    expect(r3.depth).toBe(1);
  });

  it('handles a degenerate all-zero plan with equal splits and no NaN anywhere', () => {
    const root = buildNode({
      id: 0,
      actualTime: 0,
      children: [
        { id: 1, actualTime: 0 },
        { id: 2, actualTime: 0, children: [{ id: 3, actualTime: 0 }] },
      ],
    });
    const rects = computeFlameLayout(root, 'actualTime', { width: 100 });
    for (const r of rects) {
      expect(Number.isFinite(r.x0)).toBe(true);
      expect(Number.isFinite(r.x1)).toBe(true);
      expect(Number.isNaN(r.x0)).toBe(false);
      expect(Number.isNaN(r.x1)).toBe(false);
      expect(r.x1).toBeGreaterThanOrEqual(r.x0);
    }
    const r1 = byId(rects, 1);
    const r2 = byId(rects, 2);
    expect(r1.x1 - r1.x0).toBeCloseTo(50, 5);
    expect(r2.x1 - r2.x0).toBeCloseTo(50, 5);
  });

  it('produces a rollup map keyed by node id covering the whole subtree', () => {
    const root = buildNode({
      id: 0,
      actualTime: 10,
      children: [{ id: 1, actualTime: 5 }, { id: 2, actualTime: 5 }],
    });
    const values = rollupMetric(root, 'actualTime');
    expect(values.size).toBe(3);
    expect(values.get(0)).toBe(10);
    expect(values.get(1)).toBe(5);
    expect(values.get(2)).toBe(5);
  });
});

describe('adaptive plans: inactive operations', () => {
  const adaptive = () =>
    buildNode({
      id: 0,
      actualTime: 100,
      cost: 50,
      children: [
        {
          id: 1,
          actualTime: 90,
          cost: 40,
          inactive: true, // not used; carries estimates only
          children: [
            { id: 2, actualTime: 60, cost: 30 }, // active, under the inactive join
            { id: 3, inactive: true, cost: 25, rows: 500, actualTime: 5 },
          ],
        },
        { id: 4, actualTime: 10, cost: 5 },
      ],
    });

  it('gives inactive nodes no value of their own, so only active descendants roll up through them', () => {
    const time = rollupMetric(adaptive(), 'actualTime');
    expect(time.get(3)).toBe(0);
    expect(time.get(1)).toBe(60); // = active child 2, not its own 90
    expect(time.get(0)).toBe(100);

    const cost = rollupMetric(adaptive(), 'cost');
    expect(cost.get(3)).toBe(0);
    expect(cost.get(1)).toBe(30);
    expect(cost.get(0)).toBe(50);
  });

  it('shows an inactive node with zero self value and keeps the active descendant sized', () => {
    const rects = computeFlameLayout(adaptive(), 'actualTime', { width: 1000 });
    expect(byId(rects, 1).selfValue).toBe(0);
    expect(byId(rects, 3).selfValue).toBe(0);
    const width = (id: number) => byId(rects, id).x1 - byId(rects, id).x0;
    expect(width(1)).toBeCloseTo(600, 5); // = the active descendant's 60 of 100
    expect(width(3)).toBeLessThanOrEqual(2); // the unused leaf is a hairline at most
    expect(width(2) + width(3)).toBeCloseTo(width(1), 5);
    expect(width(2)).toBeGreaterThan(590);
  });
});
