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

  describe('table alias', () => {
    const bundle = () => makeBundle({
      'HR.EMPLOYEES': makeTable({}, { DEPTNO: makeColumn(), STATUS: makeColumn() }, ['HR.EMP_DEPT_IDX']),
      'HR.EMP_DEPT_IDX': makeIndex('HR.EMPLOYEES', ['DEPTNO']),
    });
    const scan = (filter: string, objectAlias?: string) => buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES', objectAlias, filterPredicates: filter,
    });

    it('flags a predicate on the scanned alias', () => {
      const plan = scan('"E"."DEPTNO"=:B1', 'E@SEL$1');
      expect(unusedIndexRule.evaluate(makeCtx(plan, bundle()))).toHaveLength(1);
    });

    it('resolves a quoted object alias', () => {
      const plan = scan('"E"."DEPTNO"=:B1', '"E"@"SEL$1"');
      expect(unusedIndexRule.evaluate(makeCtx(plan, bundle()))).toHaveLength(1);
    });

    it('ignores a same-named column of another alias (join / correlated reference)', () => {
      // E is scanned; DEPTNO here belongs to D.
      const plan = scan('"E"."STATUS"="D"."DEPTNO"', 'E@SEL$1');
      expect(unusedIndexRule.evaluate(makeCtx(plan, bundle()))).toHaveLength(0);
      const correlated = scan('"D"."DEPTNO"=:B1', 'E@SEL$1');
      expect(unusedIndexRule.evaluate(makeCtx(correlated, bundle()))).toHaveLength(0);
    });

    it('still counts the scanned alias side of a join predicate', () => {
      const plan = scan('"E"."DEPTNO"="D"."DEPTNO"', 'E@SEL$1');
      expect(unusedIndexRule.evaluate(makeCtx(plan, bundle()))).toHaveLength(1);
    });

    it('without an alias section, takes the only qualifier as the scanned alias', () => {
      expect(unusedIndexRule.evaluate(makeCtx(scan('"X"."DEPTNO"=:1'), bundle()))).toHaveLength(1);
    });

    it('without an alias section and ambiguous qualifiers, prefers the table name and otherwise skips', () => {
      expect(unusedIndexRule.evaluate(makeCtx(scan('"EMPLOYEES"."STATUS"=:1 AND "D"."DEPTNO"=:2'), bundle()))).toHaveLength(0);
      expect(unusedIndexRule.evaluate(makeCtx(scan('"EMPLOYEES"."DEPTNO"=:1 AND "D"."DEPTNO"=:2'), bundle()))).toHaveLength(1);
      expect(unusedIndexRule.evaluate(makeCtx(scan('"X"."DEPTNO"=:1 AND "D"."DEPTNO"=:2'), bundle()))).toHaveLength(0);
    });

    it('accepts an unqualified column', () => {
      expect(unusedIndexRule.evaluate(makeCtx(scan('"DEPTNO"=:1', 'E@SEL$1'), bundle()))).toHaveLength(1);
    });
  });

  describe('predicate shape', () => {
    const bundle = (indexColumns = ['DEPTNO'], indexOverrides = {}) => makeBundle({
      'HR.EMPLOYEES': makeTable({}, { DEPTNO: makeColumn(), SAL: makeColumn(), NAME: makeColumn({ data_type: 'VARCHAR2' }) }, ['HR.EMP_IDX']),
      'HR.EMP_IDX': makeIndex('HR.EMPLOYEES', indexColumns, indexOverrides),
    });
    const flagged = (filter: string, b = bundle()) => unusedIndexRule.evaluate(makeCtx(
      buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES', objectAlias: 'E@SEL$1', filterPredicates: filter }), b,
    )).length;

    it.each([
      ['equality', '"E"."DEPTNO"=:1'],
      ['range', '"E"."DEPTNO">10'],
      ['BETWEEN', '"E"."DEPTNO" BETWEEN 10 AND 20'],
      ['IN list', '"E"."DEPTNO" IN (10, 20, 30)'],
      ['IS NOT NULL', '"E"."DEPTNO" IS NOT NULL'],
      ['reversed comparison', ':1="E"."DEPTNO"'],
      ['parenthesised AND with another column', '("E"."SAL">100 AND "E"."DEPTNO"=:1)'],
      ['OR on the same column', '("E"."DEPTNO"=10 OR "E"."DEPTNO"=20)'],
    ])('flags a sargable predicate: %s', (_label, filter) => {
      expect(flagged(filter)).toBe(1);
    });

    it('flags a LIKE with a trailing wildcard only', () => {
      const b = bundle(['NAME']);
      expect(flagged('"E"."NAME" LIKE \'SMI%\'', b)).toBe(1);
      expect(flagged('"E"."NAME" LIKE :1', b)).toBe(1);
      expect(flagged('"E"."NAME" LIKE \'%MITH\'', b)).toBe(0);
      expect(flagged('"E"."NAME" LIKE \'_MITH%\'', b)).toBe(0);
    });

    it.each([
      ['UPPER()', 'UPPER("E"."NAME")=\'SMITH\'', 'NAME'],
      ['TRUNC()', 'TRUNC("E"."DEPTNO")=10', 'DEPTNO'],
      ['NVL()', 'NVL("E"."DEPTNO",0)=10', 'DEPTNO'],
      ['arithmetic on the column', '"E"."DEPTNO"+1=10', 'DEPTNO'],
      ['implicit INTERNAL_FUNCTION', 'INTERNAL_FUNCTION("E"."DEPTNO")>10', 'DEPTNO'],
      ['TO_CHAR()', 'TO_CHAR("E"."DEPTNO")=\'10\'', 'DEPTNO'],
      ['<>', '"E"."DEPTNO"<>10', 'DEPTNO'],
      ['!=', '"E"."DEPTNO"!=10', 'DEPTNO'],
      ['NOT IN', '"E"."DEPTNO" NOT IN (10, 20)', 'DEPTNO'],
      ['NOT LIKE', '"E"."NAME" NOT LIKE \'SMI%\'', 'NAME'],
      ['NOT BETWEEN', '"E"."DEPTNO" NOT BETWEEN 10 AND 20', 'DEPTNO'],
      ['OR across different columns', '("E"."DEPTNO"=10 OR "E"."SAL">100)', 'DEPTNO'],
      ['same-alias column compared with column', '"E"."DEPTNO"="E"."SAL"', 'DEPTNO'],
    ])('ignores a non-sargable predicate: %s', (_label, filter, leading) => {
      expect(flagged(filter, bundle([leading]))).toBe(0);
    });

    it('lets a sargable conjunct count even when another conjunct on the column is not', () => {
      expect(flagged('"E"."DEPTNO">10 AND NVL("E"."DEPTNO",0)<50')).toBe(1);
    });

    it('does not treat a column inside a function on the other side as a reason to ignore the predicate', () => {
      expect(flagged('"E"."DEPTNO"=TO_NUMBER(:1)')).toBe(1);
    });

    it('IS NULL does not justify a single-column B-tree index', () => {
      expect(flagged('"E"."DEPTNO" IS NULL')).toBe(0);
    });

    it('IS NULL does justify a composite index or a bitmap index', () => {
      expect(flagged('"E"."DEPTNO" IS NULL', bundle(['DEPTNO', 'SAL']))).toBe(1);
      expect(flagged('"E"."DEPTNO" IS NULL', bundle(['DEPTNO'], { uniqueness: 'BITMAP' }))).toBe(1);
    });
  });
});
