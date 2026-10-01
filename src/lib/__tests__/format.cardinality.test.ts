import { describe, expect, it } from 'vitest';
import { computeCardinalityRatio, formatCardinalityRatio, nodeCardinalityRatio } from '../format';
import type { PlanNode } from '../types';

const node = (over: Partial<PlanNode>): PlanNode => ({ id: 1, depth: 1, operation: 'X', children: [], ...over });

describe('computeCardinalityRatio', () => {
  it('floors both operands at 1 so zero actuals are not an infinite underestimate', () => {
    expect(computeCardinalityRatio(1, 0)).toBe(1);
    expect(computeCardinalityRatio(1000, 0)).toBe(0.001);
    expect(computeCardinalityRatio(0, 5)).toBe(5);
    expect(computeCardinalityRatio(0, 0)).toBe(1);
  });

  it('never returns Infinity or 0', () => {
    for (const [e, a] of [[0, 1e9], [0, 0], [1e9, 0], [1, 0]] as const) {
      const r = computeCardinalityRatio(e, a)!;
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(0);
    }
  });

  it('is undefined when either side is missing', () => {
    expect(computeCardinalityRatio(undefined, 5)).toBeUndefined();
    expect(computeCardinalityRatio(5, undefined)).toBeUndefined();
  });

  it('formats a finite ratio', () => {
    expect(formatCardinalityRatio(computeCardinalityRatio(1, 0))).toBe('accurate');
    expect(formatCardinalityRatio(computeCardinalityRatio(1000, 0))).toBe('1000x under');
  });
});

describe('nodeCardinalityRatio', () => {
  it('compares A-Rows with the all-starts estimate, not per-start E-Rows', () => {
    const n = node({ rows: 1, starts: 1000, actualRows: 1000, estimatedRowsTotal: 1000 });
    expect(nodeCardinalityRatio(n)).toBe(1);
  });

  it('is undefined without an estimatedRowsTotal', () => {
    expect(nodeCardinalityRatio(node({ rows: 1, actualRows: 1000 }))).toBeUndefined();
  });
});
