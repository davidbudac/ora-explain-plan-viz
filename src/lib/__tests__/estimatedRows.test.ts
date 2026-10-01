import { describe, expect, it } from 'vitest';
import { effectiveExecutions, formatEstimatedRows } from '../format';
import { planNodeAriaLabel } from '../nodeAriaLabel';
import type { PlanNode } from '../types';

const node = (over: Partial<PlanNode>): PlanNode => ({ id: 1, depth: 1, operation: 'X', children: [], ...over });

describe('formatEstimatedRows', () => {
  it('reads E-Rows × executions on a nested-loop inner side', () => {
    const r = formatEstimatedRows(node({ rows: 4, estimatedRowsTotal: 80000, actualRows: 80000, starts: 20000 }));
    expect(r.text).toBe('4 × 20K');
    expect(r.title).toBe(
      '4 rows per execution × 20,000 executions = 80,000 estimated in total (A-Rows is the total over all executions)',
    );
  });

  it('strips a trailing .0 from the execution count only', () => {
    expect(formatEstimatedRows(node({ rows: 2, estimatedRowsTotal: 3000 })).text).toBe('2 × 1.5K');
    expect(formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 2000000 })).text).toBe('1 × 2M');
    expect(formatEstimatedRows(node({ rows: 1500, estimatedRowsTotal: 3000 })).text).toBe('1.5K × 2');
  });

  it('uses the singular for one row per execution', () => {
    const r = formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 500 }));
    expect(r.text).toBe('1 × 500');
    expect(r.title).toContain('1 row per execution × 500 executions');
  });

  it('is the plain number for a single execution', () => {
    expect(formatEstimatedRows(node({ rows: 1500, estimatedRowsTotal: 1500 }))).toEqual({ text: '1.5K' });
  });

  it('is the plain number for a PX slave set (total equals E-Rows)', () => {
    expect(formatEstimatedRows(node({ rows: 1000, estimatedRowsTotal: 1000, starts: 8 }))).toEqual({ text: '1.0K' });
  });

  it('is the plain number when there is no comparable total', () => {
    expect(formatEstimatedRows(node({ rows: 7, starts: 0 }))).toEqual({ text: '7' });
    expect(formatEstimatedRows(node({ rows: 7, estimatedRowsTotal: undefined, actualRows: 3 }))).toEqual({ text: '7' });
  });

  it('handles zero or missing rows', () => {
    expect(formatEstimatedRows(node({ rows: 0, estimatedRowsTotal: 0 }))).toEqual({ text: '0' });
    expect(formatEstimatedRows(node({ rows: 0, estimatedRowsTotal: 50 }))).toEqual({ text: '0' });
    expect(formatEstimatedRows(node({}))).toEqual({ text: '—' });
    expect(formatEstimatedRows(node({ estimatedRowsTotal: 50 }))).toEqual({ text: '—' });
  });

  it('absorbs floating noise in the execution count', () => {
    const r = formatEstimatedRows(node({ rows: 3, estimatedRowsTotal: 3 * 1234.0000000001 }));
    expect(r.text).toBe('3 × 1.2K');
    expect(r.title).toContain('1,234 executions');
  });

  it('keeps a genuinely fractional multiplier to one decimal', () => {
    const r = formatEstimatedRows(node({ rows: 4, estimatedRowsTotal: 10 }));
    expect(r.text).toBe('4 × 2.5');
    expect(r.title).toContain('2.5 executions');
  });

  it('ignores the total when the plan has no actual stats', () => {
    expect(formatEstimatedRows(node({ rows: 4, estimatedRowsTotal: 80000 }), false)).toEqual({ text: '4' });
  });
});

describe('effectiveExecutions', () => {
  it('is undefined for one execution or fewer, or missing inputs', () => {
    expect(effectiveExecutions({ rows: 5, estimatedRowsTotal: 5 })).toBeUndefined();
    expect(effectiveExecutions({ rows: 5, estimatedRowsTotal: 2 })).toBeUndefined();
    expect(effectiveExecutions({ rows: 0, estimatedRowsTotal: 9 })).toBeUndefined();
    expect(effectiveExecutions({ rows: 5 })).toBeUndefined();
    expect(effectiveExecutions({ estimatedRowsTotal: 5 })).toBeUndefined();
  });

  it('is total ÷ E-Rows', () => {
    expect(effectiveExecutions({ rows: 4, estimatedRowsTotal: 80000 })).toBe(20000);
  });
});

describe('planNodeAriaLabel estimate', () => {
  const base = { id: 3, operation: 'INDEX RANGE SCAN', rows: 4, estimatedRowsTotal: 80000, actualRows: 80000 };

  it('spells out executions when the operation ran more than once', () => {
    expect(planNodeAriaLabel(base, { hasActualStats: true })).toContain(
      'estimated 4 rows per execution × 20,000 executions',
    );
  });

  it('stays plain for a single execution or without actual stats', () => {
    expect(planNodeAriaLabel({ ...base, estimatedRowsTotal: 4 }, { hasActualStats: true })).toContain('estimated 4 rows,');
    expect(planNodeAriaLabel(base, { hasActualStats: false })).toContain('estimated 4 rows');
    expect(planNodeAriaLabel(base, { hasActualStats: false })).not.toContain('executions');
  });
});
