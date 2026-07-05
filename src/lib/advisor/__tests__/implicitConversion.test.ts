import { describe, it, expect } from 'vitest';
import { implicitConversionRule } from '../rules/implicitConversion';
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

describe('implicitConversionRule', () => {
  it('flags a node with an implicit conversion predicate', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', filterPredicates: 'TO_NUMBER("T"."COL")=:1' });
    const findings = implicitConversionRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'implicit-conversion', severity: 'warning', nodeIds: [0] });
  });

  it('does not flag a node without conversion predicates', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', filterPredicates: '"T"."COL"=:1' });
    expect(implicitConversionRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('caps findings at maxFindingsPerRule', () => {
    const children = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      operation: 'TABLE ACCESS FULL',
      filterPredicates: 'TO_NUMBER("T"."COL")=:1',
    }));
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children });
    const findings = implicitConversionRule.evaluate(makeCtx(plan));
    expect(findings.length).toBe(DEFAULT_THRESHOLDS.maxFindingsPerRule);
  });

  it('lists multiple hit fragments in one finding for a single node', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'TABLE ACCESS FULL',
      accessPredicates: 'INTERNAL_FUNCTION("T"."A")=:1',
      filterPredicates: 'TO_NUMBER("T"."B")=:2',
    });
    const findings = implicitConversionRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('INTERNAL_FUNCTION(A)');
    expect(findings[0].explanation).toContain('TO_NUMBER(B)');
  });
});
