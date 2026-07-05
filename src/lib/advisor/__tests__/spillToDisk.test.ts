import { describe, it, expect } from 'vitest';
import { spillToDiskRule } from '../rules/spillToDisk';
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

describe('spillToDiskRule', () => {
  it('flags a warning when tempUsed is positive but below the critical threshold', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: 1024 * 1024 });
    const findings = spillToDiskRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('MB');
  });

  it('escalates to critical at or above spillCriticalBytes', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: DEFAULT_THRESHOLDS.spillCriticalBytes });
    const findings = spillToDiskRule.evaluate(makeCtx(plan));
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag when tempUsed is zero or undefined', () => {
    const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', tempUsed: 0 });
    expect(spillToDiskRule.evaluate(makeCtx(plan))).toHaveLength(0);
    const plan2 = buildPlan({ id: 0, operation: 'SORT ORDER BY' });
    expect(spillToDiskRule.evaluate(makeCtx(plan2))).toHaveLength(0);
  });

  it('caps findings at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, operation: 'SORT ORDER BY', tempUsed: 1024 }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = spillToDiskRule.evaluate(makeCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
  });
});
