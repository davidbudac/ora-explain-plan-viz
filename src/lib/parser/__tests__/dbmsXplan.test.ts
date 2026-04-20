import { describe, expect, it } from 'vitest';
import { extractDbmsXplanSegments, parseDbmsXplanPlans } from '../dbmsXplanParser';

const PLAN_A = `
Plan hash value: 111111111

--------------------------------------------------------------------------------
| Id  | Operation         | Name | Rows | Bytes | Cost (%CPU)| Time     |
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT  |      |    1 |    14 |     3   (0)| 00:00:01 |
|*  1 | TABLE ACCESS FULL | EMP  |    1 |    14 |     3   (0)| 00:00:01 |
--------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------

   1 - filter("EMP"."DEPTNO"=10)
`.trim();

const PLAN_B = `
Plan hash value: 222222222

--------------------------------------------------------------------------------
| Id  | Operation          | Name    | Rows | Bytes | Cost (%CPU)| Time     |
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT   |         |    1 |    26 |     4   (0)| 00:00:01 |
|   1 | TABLE ACCESS FULL  | DEPT    |    1 |    13 |     2   (0)| 00:00:01 |
|   2 | INDEX RANGE SCAN   | EMP_PK  |    1 |       |     2   (0)| 00:00:01 |
--------------------------------------------------------------------------------
`.trim();

describe('extractDbmsXplanSegments', () => {
  it('returns one segment for a single DBMS_XPLAN input', () => {
    expect(extractDbmsXplanSegments(PLAN_A)).toEqual([PLAN_A]);
  });

  it('splits repeated plan hash blocks into separate DBMS_XPLAN segments', () => {
    const combinedInput = `${PLAN_A}\n\n${PLAN_B}`;
    expect(extractDbmsXplanSegments(combinedInput)).toEqual([PLAN_A, PLAN_B]);
  });
});

describe('parseDbmsXplanPlans', () => {
  it('parses multiple DBMS_XPLAN plans from one pasted input', () => {
    const plans = parseDbmsXplanPlans(`${PLAN_A}\n\n${PLAN_B}`);

    expect(plans).toHaveLength(2);
    expect(plans[0].planHashValue).toBe('111111111');
    expect(plans[0].allNodes).toHaveLength(2);
    expect(plans[0].allNodes[1].filterPredicates).toContain('"EMP"."DEPTNO"=10');
    expect(plans[1].planHashValue).toBe('222222222');
    expect(plans[1].allNodes).toHaveLength(3);
    expect(plans[1].allNodes[2].operation).toBe('INDEX RANGE SCAN');
  });
});

describe('SQL text extraction', () => {
  it('extracts SQL_ID and SQL text from DISPLAY_CURSOR header', () => {
    const input = [
      'SQL_ID  dvuvg3u3z13bg, child number 0',
      '-------------------------------------',
      'SELECT e.last_name, d.department_name',
      'FROM employees e, departments d',
      'WHERE e.department_id = d.department_id',
      '',
      PLAN_A,
    ].join('\n');

    const [plan] = parseDbmsXplanPlans(input);
    expect(plan.sqlId).toBe('dvuvg3u3z13bg');
    expect(plan.sqlText).toBe(
      'SELECT e.last_name, d.department_name\nFROM employees e, departments d\nWHERE e.department_id = d.department_id',
    );
    expect(plan.planHashValue).toBe('111111111');
  });

  it('extracts SQL text from SQL*Plus prompt with line-number continuation', () => {
    const input = [
      'SQL> SELECT *',
      '  2    FROM emp',
      '  3   WHERE deptno = 10;',
      '',
      PLAN_A,
    ].join('\n');

    const [plan] = parseDbmsXplanPlans(input);
    expect(plan.sqlText).toBe('SELECT *\nFROM emp\nWHERE deptno = 10');
    expect(plan.sqlId).toBeUndefined();
  });

  it('extracts bare SQL placed above the plan', () => {
    const input = [
      'select name from emp where deptno = 10',
      '',
      PLAN_A,
    ].join('\n');

    const [plan] = parseDbmsXplanPlans(input);
    expect(plan.sqlText).toBe('select name from emp where deptno = 10');
  });

  it('returns no SQL text when the preamble has none', () => {
    const [plan] = parseDbmsXplanPlans(PLAN_A);
    expect(plan.sqlText).toBeUndefined();
    expect(plan.sqlId).toBeUndefined();
  });
});
