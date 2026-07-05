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

  it('shows E-Rows vs A-Rows in the explanation', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 5000 });
    const findings = cardinalityMismatchRule.evaluate(makeCtx(plan));
    expect(findings[0].explanation).toContain('100');
    expect(findings[0].explanation).toContain('5,000');
  });
});
