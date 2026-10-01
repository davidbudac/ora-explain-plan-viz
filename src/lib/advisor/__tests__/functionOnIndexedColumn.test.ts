import { describe, it, expect } from 'vitest';
import { functionOnIndexedColumnRule } from '../rules/functionOnIndexedColumn';
import { buildPlan, makeBundle, makeColumn, makeIndex, makeTable, ruleCtx, type NodeSpec } from './helpers';

const bundle = makeBundle({
  'HR.EMPLOYEES': makeTable({}, { ENAME: makeColumn({ data_type: 'VARCHAR2' }), HIRED: makeColumn({ data_type: 'DATE' }), SAL: makeColumn() }, ['HR.EMP_ENAME_IDX', 'HR.EMP_HIRED_IDX']),
  'HR.EMP_ENAME_IDX': makeIndex('HR.EMPLOYEES', ['ENAME']),
  'HR.EMP_HIRED_IDX': makeIndex('HR.EMPLOYEES', ['HIRED', 'ENAME']),
});

const evaluate = (spec: NodeSpec, b = bundle) => functionOnIndexedColumnRule.evaluate(ruleCtx(buildPlan(spec), b));
const fullScan = (filter: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES', objectAlias: 'E@SEL$1', filterPredicates: filter, ...extra,
});

describe('functionOnIndexedColumnRule', () => {
  it('flags UPPER() over the leading column of an index on a full scan', () => {
    const findings = evaluate(fullScan('UPPER("E"."ENAME")=\'SMITH\''));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'function-on-indexed-column', severity: 'warning', nodeIds: [1] });
    expect(findings[0].explanation).toContain('UPPER');
    expect(findings[0].explanation).toContain('HR.EMP_ENAME_IDX');
    expect(findings[0].suggestion).toContain('function-based index on UPPER(ENAME)');
  });

  it('flags TRUNC on an indexed date column on a table access with a filter', () => {
    const findings = evaluate({
      id: 1, operation: 'TABLE ACCESS BY INDEX ROWID BATCHED', objectName: 'EMPLOYEES', objectAlias: 'E@SEL$1',
      filterPredicates: 'TRUNC("E"."HIRED")=TO_DATE(\' 2024-01-01\', \'syyyy-mm-dd\')',
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('TRUNC');
    expect(findings[0].explanation).toContain('HR.EMP_HIRED_IDX');
  });

  it('only counts a column that LEADS an index', () => {
    // ENAME is the second column of EMP_HIRED_IDX but leads EMP_ENAME_IDX; SAL is in no index.
    expect(evaluate(fullScan('NVL("E"."SAL",0)>10'))).toHaveLength(0);
  });

  it('ignores a column of another alias (an outer table in a join predicate)', () => {
    expect(evaluate(fullScan('UPPER("D"."ENAME")="E"."DEPT"'))).toHaveLength(0);
  });

  it('ignores a function that does not wrap a column, and plain comparisons', () => {
    expect(evaluate(fullScan('"E"."ENAME"=UPPER(:B1)'))).toHaveLength(0);
    expect(evaluate(fullScan('"E"."ENAME"=\'UPPER("E"."ENAME")\''))).toHaveLength(0);
  });

  it('ignores index operations (a function-based index is being used there)', () => {
    expect(evaluate({ id: 1, operation: 'INDEX RANGE SCAN', objectName: 'EMP_ENAME_IDX', accessPredicates: 'UPPER("E"."ENAME")=\'X\'' })).toHaveLength(0);
  });

  it('stays silent when a function-based index (hidden SYS_NC column) may match', () => {
    const fbi = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { ENAME: makeColumn() }, ['HR.EMP_ENAME_IDX', 'HR.EMP_UPPER_IDX']),
      'HR.EMP_ENAME_IDX': makeIndex('HR.EMPLOYEES', ['ENAME']),
      'HR.EMP_UPPER_IDX': makeIndex('HR.EMPLOYEES', ['SYS_NC00005$']),
    });
    expect(evaluate(fullScan('UPPER("E"."ENAME")=\'SMITH\''), fbi)).toHaveLength(0);
  });

  it('skips invisible and unusable indexes', () => {
    const hidden = makeBundle({
      'HR.EMPLOYEES': makeTable({}, { ENAME: makeColumn() }, ['HR.EMP_ENAME_IDX']),
      'HR.EMP_ENAME_IDX': makeIndex('HR.EMPLOYEES', ['ENAME'], { visibility: 'INVISIBLE' }),
    });
    expect(evaluate(fullScan('UPPER("E"."ENAME")=\'SMITH\''), hidden)).toHaveLength(0);
  });

  it('does not repeat what implicit-conversion already reports for the same column', () => {
    expect(evaluate(fullScan('TO_CHAR("E"."ENAME")=\'1\''))).toHaveLength(0);
  });

  it('requires metadata', () => {
    expect(functionOnIndexedColumnRule.requiresMetadata).toBe(true);
  });
});
