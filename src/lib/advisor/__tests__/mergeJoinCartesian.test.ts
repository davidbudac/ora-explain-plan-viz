import { describe, it, expect } from 'vitest';
import { mergeJoinCartesianRule } from '../rules/mergeJoinCartesian';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan } from './helpers';
import type { RuleContext } from '../types';

function makeCtx(plan: ReturnType<typeof buildPlan>): RuleContext {
  return {
    plan,
    bundle: null,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: () => null,
    usedIndexKeys: new Set(),
  };
}

describe('mergeJoinCartesianRule', () => {
  it('flags a warning-tier cartesian join', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN CARTESIAN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 200 },
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 200 },
      ],
    });
    const findings = mergeJoinCartesianRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('escalates to critical when the row product exceeds the threshold', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN CARTESIAN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 5000 },
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 5000 },
      ],
    });
    const findings = mergeJoinCartesianRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('skips when either side is at or below the minimum side rows', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN CARTESIAN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 50 },
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 5000 },
      ],
    });
    expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('prefers actualRows over rows when present', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN CARTESIAN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 50, actualRows: 200 },
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 200 },
      ],
    });
    expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))).toHaveLength(1);
  });

  it('does not flag non-cartesian merge joins', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 5000 },
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 5000 },
      ],
    });
    expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('ignores nodes without exactly 2 children', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'MERGE JOIN CARTESIAN',
      children: [{ id: 1, operation: 'TABLE ACCESS FULL', rows: 5000 }],
    });
    expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  describe('BUFFER SORT replay', () => {
    const n = (v: number) => v.toLocaleString();

    it('uses the buffered set, not the replayed A-Rows, with actual stats', () => {
      // Outer 1,000 rows; BUFFER SORT is started once per outer row and returns 1,000 x 1,000 rows.
      const plan = buildPlan({
        id: 0, operation: 'MERGE JOIN CARTESIAN', rows: 1_000_000, actualRows: 1_000_000, starts: 1,
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', rows: 1000, actualRows: 1000, starts: 1 },
          {
            id: 2, operation: 'BUFFER SORT', rows: 1000, actualRows: 1_000_000, starts: 1000,
            children: [{ id: 3, operation: 'TABLE ACCESS FULL', rows: 1000, actualRows: 1000, starts: 1 }],
          },
        ],
      });
      const findings = mergeJoinCartesianRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      // 1e9 (1,000 x 1,000,000) would be critical; the real product is 1e6.
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].explanation).toContain(`combines ${n(1000)} rows with ${n(1000)} rows`);
      expect(findings[0].explanation).toContain(`producing ${n(1_000_000)} rows`);
      expect(findings[0].explanation).not.toContain('up to');
    });

    it('derives the buffered size from A-Rows / Starts when the BUFFER SORT child has no actuals', () => {
      const plan = buildPlan({
        id: 0, operation: 'MERGE JOIN CARTESIAN', actualRows: 250_000, starts: 1,
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 500, starts: 1 },
          { id: 2, operation: 'BUFFER SORT', actualRows: 250_000, starts: 500, children: [{ id: 3, operation: 'TABLE ACCESS FULL', rows: 500 }] },
        ],
      });
      const findings = mergeJoinCartesianRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0].explanation).toContain(`combines ${n(500)} rows with ${n(500)} rows`);
    });

    it('does not flag when the buffered set is small even though replayed A-Rows is large', () => {
      // 5,000 outer rows x 10 buffered rows: BUFFER SORT A-Rows = 50,000 but the buffered set is tiny.
      const plan = buildPlan({
        id: 0, operation: 'MERGE JOIN CARTESIAN', actualRows: 50_000, starts: 1,
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 5000, starts: 1 },
          { id: 2, operation: 'BUFFER SORT', actualRows: 50_000, starts: 5000, children: [{ id: 3, operation: 'TABLE ACCESS FULL', actualRows: 10, starts: 1 }] },
        ],
      });
      expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('escalates on the actual join output', () => {
      const plan = buildPlan({
        id: 0, operation: 'MERGE JOIN CARTESIAN', actualRows: 25_000_000, starts: 1,
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 5000, starts: 1 },
          { id: 2, operation: 'BUFFER SORT', actualRows: 25_000_000, starts: 5000, children: [{ id: 3, operation: 'TABLE ACCESS FULL', actualRows: 5000, starts: 1 }] },
        ],
      });
      expect(mergeJoinCartesianRule.evaluate(makeCtx(plan))[0].severity).toBe('critical');
    });

    it('with estimates only, treats the BUFFER SORT E-Rows as the per-start buffered size', () => {
      const plan = buildPlan({
        id: 0, operation: 'MERGE JOIN CARTESIAN',
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', rows: 200 },
          { id: 2, operation: 'BUFFER SORT', rows: 300, children: [{ id: 3, operation: 'TABLE ACCESS FULL', rows: 300 }] },
        ],
      });
      const findings = mergeJoinCartesianRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0].explanation).toContain(`producing up to ${n(60_000)} rows`);
    });
  });
});
