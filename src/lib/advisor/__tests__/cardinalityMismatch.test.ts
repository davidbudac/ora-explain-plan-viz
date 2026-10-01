import { describe, it, expect } from 'vitest';
import { cardinalityMismatchRule } from '../rules/cardinalityMismatch';
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

describe('cardinalityMismatchRule', () => {
  it('flags warn-tier mismatch as warning', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 500 });
    const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('flags bad-tier mismatch as critical', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 5000 });
    const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag accurate estimates', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 110 });
    expect(cardinalityMismatchRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('sorts findings by deviation descending and caps at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      operation: 'TABLE ACCESS FULL',
      rows: 100,
      actualRows: 100 * (i + 4), // deviations: 4x..13x
    }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
    // highest deviation (13x, node 10) should come first
    expect(findings[0].nodeIds).toEqual([10]);
  });

  it('is gated by requiresActualStats', () => {
    expect(cardinalityMismatchRule.requiresActualStats).toBe(true);
  });

  it('shows the estimate and A-Rows in the explanation', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 5000 });
    const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
    expect(findings[0].explanation).toContain('100');
    expect(findings[0].explanation).toContain('5,000');
  });

  describe('starts-aware estimates', () => {
    const nlPlan = (inner: { rows: number; starts: number; actualRows: number }) => buildPlan({
      id: 0, operation: 'SELECT STATEMENT', children: [{
        id: 1, operation: 'NESTED LOOPS', rows: 1000, actualRows: 1000, starts: 1, children: [
          { id: 2, operation: 'TABLE ACCESS FULL', rows: 1000, actualRows: 1000, starts: 1 },
          { id: 3, operation: 'INDEX UNIQUE SCAN', ...inner },
        ],
      }],
    });

    it('does not flag a nested-loop inner scan whose per-start estimate is right', () => {
      const plan = nlPlan({ rows: 1, starts: 1000, actualRows: 1000 });
      expect(cardinalityMismatchRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('flags the inner scan when the all-starts estimate is far off, explaining the multiplication', () => {
      const plan = nlPlan({ rows: 1, starts: 1000, actualRows: 250000 });
      const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0].nodeIds).toEqual([3]);
      expect(findings[0].severity).toBe('critical');
      expect(findings[0].explanation).toBe(
        'Estimated 1 row per start × 1,000 starts = 1,000 rows but actually produced 250,000 rows (A-Rows), a 250.0x deviation.',
      );
    });

    it('does not flag E-Rows 1 with A-Rows 0', () => {
      const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 1, actualRows: 0, starts: 1 });
      expect(cardinalityMismatchRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('suppresses mismatches below the minimum row delta', () => {
      // 12x ratio, but only 55 rows apart
      const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 5, actualRows: 60, starts: 1 });
      expect(cardinalityMismatchRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('does not flag never-started operations', () => {
      const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 1, actualRows: 0, starts: 0 });
      expect(cardinalityMismatchRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });
  });
});
