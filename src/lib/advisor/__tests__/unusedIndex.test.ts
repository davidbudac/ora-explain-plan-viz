import { describe, it, expect } from 'vitest';
import { findObjectInBundle } from '../../metadata/lookup';
import { findUsedIndexKeys } from '../../metadata/indexes';
import { unusedIndexRule } from '../rules/unusedIndex';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeTable, makeIndex, makeColumn } from './helpers';
import type { RuleContext } from '../types';
import type { MetadataBundle } from '../../metadata/bundle';
import type { PlanNode } from '../../types';

function makeCtx(plan: ReturnType<typeof buildPlan>, bundle: MetadataBundle | null): RuleContext {
  return {
    plan,
    bundle,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: (name) => (bundle ? findObjectInBundle(bundle, name) : null),
    usedIndexKeys: bundle ? findUsedIndexKeys(bundle, plan.allNodes as PlanNode[]) : new Set(),
  };
}

describe('unusedIndexRule', () => {
  it('flags an unused index whose leading column matches a predicate column', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { STATUS: makeColumn() }, ['HR.EMP_STATUS_IDX']),
      'HR.EMP_STATUS_IDX': makeIndex('HR.EMPLOYEES', ['STATUS']),
    });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1',
    });
    const findings = unusedIndexRule.evaluate(makeCtx(plan, bundle));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'index-exists-unused', severity: 'warning', nodeIds: [0] });
    expect(findings[0].explanation).toContain('HR.EMP_STATUS_IDX');
  });

  it('does not flag an index that is already used by the plan', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { STATUS: makeColumn() }, ['HR.EMP_STATUS_IDX']),
      'HR.EMP_STATUS_IDX': makeIndex('HR.EMPLOYEES', ['STATUS']),
    });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS BY INDEX ROWID', objectName: 'EMPLOYEES', filterPredicates: '"E"."STATUS"=:1',
      children: [{ id: 1, operation: 'INDEX RANGE SCAN', objectName: 'EMP_STATUS_IDX', accessPredicates: '"E"."STATUS"=:1' }],
    });
    expect(unusedIndexRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('does not flag an index whose status is not VALID', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { STATUS: makeColumn() }, ['HR.EMP_STATUS_IDX']),
      'HR.EMP_STATUS_IDX': makeIndex('HR.EMPLOYEES', ['STATUS'], { status: 'UNUSABLE' }),
    });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1',
    });
    expect(unusedIndexRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('does not flag an invisible index', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { STATUS: makeColumn() }, ['HR.EMP_STATUS_IDX']),
      'HR.EMP_STATUS_IDX': makeIndex('HR.EMPLOYEES', ['STATUS'], { visibility: 'INVISIBLE' }),
    });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1',
    });
    expect(unusedIndexRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('does not flag when the leading column is not among predicate columns', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { DEPT_ID: makeColumn() }, ['HR.EMP_DEPT_IDX']),
      'HR.EMP_DEPT_IDX': makeIndex('HR.EMPLOYEES', ['DEPT_ID']),
    });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1',
    });
    expect(unusedIndexRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('is gated by requiresMetadata (no bundle -> no findings via engine gate)', () => {
    expect(unusedIndexRule.requiresMetadata).toBe(true);
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1',
    });
    expect(unusedIndexRule.evaluate(makeCtx(plan, null))).toHaveLength(0);
  });
});
