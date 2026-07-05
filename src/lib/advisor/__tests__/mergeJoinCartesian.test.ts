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
});
