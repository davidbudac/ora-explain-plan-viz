import { describe, it, expect } from 'vitest';
import { buildTestCaseScript, testCaseScriptFilename } from '../testCase';
import type { HistogramEndpoint } from '../testCase';
import type { ParsedPlan } from '../../types';
import type { HistogramInfo, MetadataBundle } from '../../metadata/bundle';
import {
  buildPlan,
  makeBundle,
  makeColumn,
  makeIndex,
  makeTable,
} from '../../advisor/__tests__/helpers';

type HistogramWithEndpoints = HistogramInfo & { endpoints?: HistogramEndpoint[] };

function histogram(
  type: HistogramInfo['type'],
  buckets: number,
  endpoints?: HistogramEndpoint[],
): HistogramWithEndpoints {
  return { type, buckets, endpoints };
}

function fixture(): { plan: ParsedPlan; bundle: MetadataBundle } {
  const plan = buildPlan({
    id: 0,
    operation: 'SELECT STATEMENT',
    children: [
      {
        id: 1,
        operation: 'HASH JOIN',
        children: [
          { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP' },
          {
            id: 3,
            operation: 'TABLE ACCESS BY INDEX ROWID',
            objectName: 'DEPT',
            children: [{ id: 4, operation: 'INDEX RANGE SCAN', objectName: 'DEPT_PK' }],
          },
        ],
      },
    ],
  });
  plan.sqlId = 'abc123def4567';
  plan.planHashValue = '987654321';
  plan.sqlText = 'SELECT * FROM emp e JOIN dept d ON e.deptno = d.deptno WHERE e.sal > :min_sal';
  plan.bindVariables = [
    { name: ':min_sal', type: 'NUMBER', value: '5000' },
    { name: ':name', type: 'VARCHAR2(30)', value: null },
  ];

  const emp = makeTable(
    { num_rows: 14, blocks: 4, avg_row_len: 40 },
    {
      EMPNO: makeColumn({ num_distinct: 14, num_nulls: 0, density: 0.0714 }),
      DEPTNO: makeColumn({
        num_distinct: 3,
        histogram: histogram('FREQUENCY', 3, [
          { value: 10, endpoint_number: 3 },
          { value: 20, endpoint_number: 8 },
          { value: 30, endpoint_number: 14 },
        ]),
      }),
      ENAME: makeColumn({
        data_type: 'VARCHAR2(50)',
        nullable: true,
        histogram: histogram('HYBRID', 2, [
          { value: 'A_VERY_LONG_STRING_VALUE_THAT_GOES_ON_AND_ON', endpoint_number: 5, repeat_count: 2 },
          { value: 'ZED', endpoint_number: 14, repeat_count: 1 },
        ]),
      }),
    },
    ['EMP_IDX'],
  );

  const dept = makeTable(
    { num_rows: 4, blocks: 1, avg_row_len: 20 },
    { DEPTNO: makeColumn({ num_distinct: 4 }) },
    ['DEPT_PK'],
  );
  dept.constraints = {
    primary_key: { name: 'DEPT_PK_CON', columns: ['DEPTNO'] },
    foreign_keys: [
      {
        name: 'DEPT_FK_REGION',
        columns: ['REGION_ID'],
        ref_owner: 'SCOTT',
        ref_table: 'REGIONS',
        ref_columns: ['REGION_ID'],
        delete_rule: 'NO ACTION',
      },
    ],
  };

  const bundle = makeBundle({
    'SCOTT.EMP': emp,
    'SCOTT.DEPT': dept,
    'SCOTT.EMP_IDX': makeIndex('SCOTT.EMP', ['DEPTNO'], {
      num_rows: 14,
      leaf_blocks: 2,
      distinct_keys: 3,
      clustering_factor: 7,
      blevel: 1,
    }),
    'SCOTT.DEPT_PK': makeIndex('SCOTT.DEPT', ['DEPTNO'], { uniqueness: 'UNIQUE' }),
    // Not referenced by the plan — must not appear in the script.
    'SCOTT.BONUS': makeTable({}, { EMPNO: makeColumn() }),
  });
  bundle.plan_ref = { sql_id: 'abc123def4567', plan_hash_value: 987654321 };
  bundle.optimizer_env = [
    { name: 'optimizer_index_cost_adj', value: '50' },
    { name: 'optimizer_mode', value: 'FIRST_ROWS_10' },
    { name: '_optimizer_use_feedback', value: 'FALSE' },
  ];
  return { plan, bundle };
}

describe('buildTestCaseScript', () => {
  it('includes only objects referenced by the plan (plus their indexes)', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('EMP');
    expect(script).toContain('DEPT');
    expect(script).toContain('EMP_IDX');
    expect(script).toContain('DEPT_PK');
    expect(script).not.toContain('BONUS');
  });

  it('synthesizes CREATE TABLE / CREATE INDEX when the bundle has no DDL', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('CREATE TABLE EMP (');
    expect(script).toContain('EMPNO NUMBER NOT NULL');
    expect(script).toContain('ENAME VARCHAR2(50)');
    expect(script).toContain('CREATE UNIQUE INDEX DEPT_PK ON DEPT (DEPTNO);');
    expect(script).toContain('CREATE INDEX EMP_IDX ON EMP (DEPTNO);');
  });

  it('uses bundle DDL verbatim when present', () => {
    const { plan, bundle } = fixture();
    const table = bundle.objects['SCOTT.EMP'];
    if (table.type === 'TABLE') table.ddl = 'CREATE TABLE EMP (EMPNO NUMBER PRIMARY KEY)';
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('CREATE TABLE EMP (EMPNO NUMBER PRIMARY KEY);');
    expect(script).not.toContain('CREATE TABLE EMP (\n');
  });

  it('emits constraints, skipping FKs to tables outside the script', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('ALTER TABLE DEPT ADD CONSTRAINT DEPT_PK_CON PRIMARY KEY (DEPTNO);');
    expect(script).toContain('-- Skipped FK DEPT_FK_REGION on DEPT: references REGIONS');
    expect(script).not.toContain('REFERENCES REGIONS');
  });

  it('emits SET_TABLE_STATS / SET_INDEX_STATS / SET_COLUMN_STATS with bundle numbers', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain("DBMS_STATS.SET_TABLE_STATS(ownname => USER, tabname => 'EMP',");
    expect(script).toContain('numrows => 14, numblks => 4, avgrlen => 40');
    expect(script).toContain("DBMS_STATS.SET_INDEX_STATS(ownname => USER, indname => 'EMP_IDX',");
    expect(script).toContain('numrows => 14, numlblks => 2, numdist => 3,');
    expect(script).toContain('clstfct => 7, indlevel => 1');
    expect(script).toContain("colname => 'EMPNO',");
    expect(script).toContain('distcnt => 14, nullcnt => 0, density => 0.0714');
  });

  it('honors targetSchema for the stats owner', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle, targetSchema: 'scratch' });
    expect(script).toContain("ownname => 'SCRATCH', tabname => 'EMP'");
    expect(script).not.toContain('ownname => USER');
  });

  it('emits PREPARE_COLUMN_VALUES only for columns with histogram endpoints', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    // NUMARRAY for numeric FREQUENCY column, bkvals from endpoint_number deltas.
    expect(script).toContain('DBMS_STATS.NUMARRAY(10, 20, 30)');
    expect(script).toContain('l_srec.bkvals := DBMS_STATS.NUMARRAY(3, 5, 6);');
    expect(script).toContain('-- Histogram for EMP.DEPTNO: FREQUENCY (3 buckets)');
    // CHARARRAY for the string HYBRID column, values truncated to 32 chars.
    expect(script).toContain("DBMS_STATS.CHARARRAY('A_VERY_LONG_STRING_VALUE_THAT_GO', 'ZED')");
    expect(script).toContain('-- HYBRID endpoint repeat counts: 2, 1');
    // Exactly two PREPARE blocks — EMPNO / DEPT.DEPTNO have no endpoints.
    expect(script.match(/PREPARE_COLUMN_VALUES/g)).toHaveLength(2);
  });

  it('emits ALTER SESSION for optimizer_env, commenting out underscore params', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('ALTER SESSION SET "optimizer_index_cost_adj" = 50;');
    expect(script).toContain('ALTER SESSION SET "optimizer_mode" = \'FIRST_ROWS_10\';');
    expect(script).toContain('-- ALTER SESSION SET "_optimizer_use_feedback" = FALSE;');
    expect(script).not.toMatch(/^ALTER SESSION SET "_optimizer_use_feedback"/m);
  });

  it('emits VARIABLE/EXEC bind stubs and the SQL text', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('VARIABLE min_sal NUMBER');
    expect(script).toContain('EXEC :min_sal := 5000;');
    expect(script).toContain('VARIABLE name VARCHAR2(4000)');
    expect(script).toContain('-- EXEC :name := ...;');
    expect(script).toContain(
      'SELECT * FROM emp e JOIN dept d ON e.deptno = d.deptno WHERE e.sal > :min_sal;',
    );
  });

  it('emits the EXPLAIN PLAN verification block with the original plan hash', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('EXPLAIN PLAN FOR');
    expect(script).toContain("SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(FORMAT => 'ALL'));");
    expect(script).toContain('-- Compare against the original plan hash value: 987654321');
  });

  it('includes source db / sql_id / plan hash and a safety note in the banner', () => {
    const { plan, bundle } = fixture();
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('-- Source database : X (Oracle 19.0, container C)');
    expect(script).toContain('-- SQL_ID          : abc123def4567');
    expect(script).toContain('-- Plan hash value : 987654321');
    expect(script).toContain('run this ONLY in an empty scratch schema');
  });

  it('falls back to a placeholder when the plan has no SQL text', () => {
    const { plan, bundle } = fixture();
    delete plan.sqlText;
    delete plan.bindVariables;
    const script = buildTestCaseScript({ plan, bundle });
    expect(script).toContain('-- No SQL text captured with this plan');
    expect(script).toContain('-- EXPLAIN PLAN FOR <re-run the SQL statement');
    expect(script).not.toContain('VARIABLE ');
  });

  it('matches the full-script snapshot for the main fixture', () => {
    const { plan, bundle } = fixture();
    expect(buildTestCaseScript({ plan, bundle })).toMatchSnapshot();
  });

  it('is deterministic — two calls produce identical output', () => {
    const { plan, bundle } = fixture();
    const a = buildTestCaseScript({ plan, bundle });
    const b = buildTestCaseScript({ plan, bundle });
    expect(a).toBe(b);
  });
});

describe('testCaseScriptFilename', () => {
  it('builds a filename from sql_id and plan hash', () => {
    const { plan } = fixture();
    expect(testCaseScriptFilename(plan)).toBe('test_case_abc123def4567_987654321.sql');
  });

  it('falls back to "unknown" for missing identifiers', () => {
    const { plan } = fixture();
    delete plan.sqlId;
    delete plan.planHashValue;
    expect(testCaseScriptFilename(plan)).toBe('test_case_unknown_unknown.sql');
  });
});
