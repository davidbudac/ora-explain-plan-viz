import { describe, it, expect } from 'vitest';
import { partitionPruningRule } from '../rules/partitionPruning';
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

describe('partitionPruningRule', () => {
  it('flags a PARTITION RANGE ALL node as no pruning', () => {
    const plan = buildPlan({ id: 0, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12' });
    const findings = partitionPruningRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
  });

  it('does not flag static pruning', () => {
    const plan = buildPlan({ id: 0, operation: 'PARTITION RANGE SINGLE', pstart: '9', pstop: '9' });
    expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('does not flag runtime pruning', () => {
    const plan = buildPlan({ id: 0, operation: 'PARTITION RANGE ITERATOR', pstart: 'KEY', pstop: 'KEY' });
    expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('does not flag nodes without pstart/pstop', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL' });
    expect(partitionPruningRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('caps findings at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1, operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12',
    }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = partitionPruningRule.evaluate(makeCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
  });
});
