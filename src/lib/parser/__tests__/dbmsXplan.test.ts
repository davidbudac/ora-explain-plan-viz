import { describe, expect, it } from 'vitest';
import { extractDbmsXplanSegments, parseDbmsXplanPlans } from '../dbmsXplanParser';
import { readFileSync } from 'fs';
import { join } from 'path';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../../examples', filename), 'utf-8');
}

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

describe('Pstart/Pstop columns', () => {
  const PARTITION_PLAN = `
Plan hash value: 999888777

------------------------------------------------------------------------------------------------
| Id | Operation                | Name    | Rows | Cost (%CPU)| Time     | Pstart |  Pstop |
------------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT         |         | 1000 |   850   (3)| 00:00:11 |        |        |
|  1 |  PARTITION RANGE ALL     |         | 1000 |   850   (3)| 00:00:11 |      1 |     12 |
|  2 |   TABLE ACCESS FULL      | SALES   | 1000 |   850   (3)| 00:00:11 |      1 |     12 |
|  3 |  PARTITION RANGE SINGLE  |         |  200 |   120   (2)| 00:00:02 |      9 |      9 |
|  4 |   TABLE ACCESS FULL      | SALES_Q |  200 |   120   (2)| 00:00:02 |      9 |      9 |
|  5 |  TABLE ACCESS BY INDEX ROWID | ORD | 50   |    12   (0)| 00:00:01 | KEY    | KEY    |
|  6 |   INDEX RANGE SCAN       | ORD_IX  |   50 |     3   (0)| 00:00:01 | KEY(I) | KEY(I) |
|  7 |  TABLE ACCESS BY INDEX ROWID | REG | 20   |     5   (0)| 00:00:01 | :BF0000| :BF0000|
`.trim();

  it('parses numeric, KEY, KEY(I), and :BFnnnn Pstart/Pstop values while keeping rows/cost/time intact', () => {
    const [plan] = parseDbmsXplanPlans(PARTITION_PLAN);

    const partitionAll = plan.allNodes.find((n) => n.id === 1)!;
    expect(partitionAll.pstart).toBe('1');
    expect(partitionAll.pstop).toBe('12');
    expect(partitionAll.rows).toBe(1000);
    expect(partitionAll.cost).toBe(850);
    expect(partitionAll.time).toBe('00:00:11');

    const partitionSingle = plan.allNodes.find((n) => n.id === 3)!;
    expect(partitionSingle.pstart).toBe('9');
    expect(partitionSingle.pstop).toBe('9');

    const keyRow = plan.allNodes.find((n) => n.id === 5)!;
    expect(keyRow.pstart).toBe('KEY');
    expect(keyRow.pstop).toBe('KEY');

    const keyIRow = plan.allNodes.find((n) => n.id === 6)!;
    expect(keyIRow.pstart).toBe('KEY(I)');
    expect(keyIRow.pstop).toBe('KEY(I)');

    const bfRow = plan.allNodes.find((n) => n.id === 7)!;
    expect(bfRow.pstart).toBe(':BF0000');
    expect(bfRow.pstop).toBe(':BF0000');
  });

  it('leaves pstart/pstop undefined for non-partitioned rows', () => {
    const [plan] = parseDbmsXplanPlans(PARTITION_PLAN);
    const root = plan.allNodes.find((n) => n.id === 0)!;
    expect(root.pstart).toBeUndefined();
    expect(root.pstop).toBeUndefined();
  });
});

describe('TQ / IN-OUT / PQ Distrib columns', () => {
  const PARALLEL_PLAN = `
Plan hash value: 555666777

-----------------------------------------------------------------------------------------------
| Id | Operation             | Name     | Rows | Cost (%CPU)| Time     |    TQ | IN-OUT | PQ Distrib |
-----------------------------------------------------------------------------------------------
|  0 | SELECT STATEMENT      |          | 1000 |   850   (3)| 00:00:11 |       |        |            |
|  1 |  PX COORDINATOR       |          | 1000 |   850   (3)| 00:00:11 |       |   S->P |            |
|  2 |   PX SEND QC (RANDOM) | :TQ10000 | 1000 |   850   (3)| 00:00:11 | Q1,00 |   P->S |  QC (RAND) |
|  3 |    HASH JOIN          |          | 1000 |   850   (3)| 00:00:11 | Q1,00 |   PCWP |            |
|  4 |     TABLE ACCESS FULL | CUST     |  500 |   300   (2)| 00:00:04 | Q1,00 |   PCWP |            |
`.trim();

  it('parses TQ, IN-OUT, and PQ Distrib values', () => {
    const [plan] = parseDbmsXplanPlans(PARALLEL_PLAN);
    const send = plan.allNodes.find((n) => n.id === 2)!;
    expect(send.tq).toBe('Q1,00');
    expect(send.inOut).toBe('P->S');
    expect(send.pqDistrib).toBe('QC (RAND)');

    const hashJoin = plan.allNodes.find((n) => n.id === 3)!;
    expect(hashJoin.tq).toBe('Q1,00');
    expect(hashJoin.inOut).toBe('PCWP');
  });

  it('leaves TQ/IN-OUT/PQ Distrib undefined for serial rows', () => {
    const [plan] = parseDbmsXplanPlans(PARALLEL_PLAN);
    const root = plan.allNodes.find((n) => n.id === 0)!;
    expect(root.tq).toBeUndefined();
    expect(root.inOut).toBeUndefined();
    expect(root.pqDistrib).toBeUndefined();
  });
});

describe('Note section attachment', () => {
  it('attaches the Note block to the correct segment in a multi-plan paste', () => {
    const PLAN_WITH_NOTE_A = `${PLAN_A}

Note
-----
   - dynamic statistics used: dynamic sampling (level=2)`;

    const PLAN_WITH_NOTE_B = `${PLAN_B}

Note
-----
   - this is an adaptive plan`;

    const combined = `${PLAN_WITH_NOTE_A}\n\n${PLAN_WITH_NOTE_B}`;
    const plans = parseDbmsXplanPlans(combined);

    expect(plans).toHaveLength(2);
    expect(plans[0].notes?.dynamicSampling).toBe(true);
    expect(plans[0].notes?.dynamicSamplingLevel).toBe(2);
    expect(plans[0].notes?.adaptivePlan).toBeUndefined();

    expect(plans[1].notes?.adaptivePlan).toBe(true);
    expect(plans[1].notes?.dynamicSampling).toBeUndefined();
  });

  it('leaves notes undefined when there is no Note block', () => {
    const [plan] = parseDbmsXplanPlans(PLAN_A);
    expect(plan.notes).toBeUndefined();
  });
});

describe('Adaptive plan inactive row marker', () => {
  it('keeps both id and star flag for a "-" prefixed inactive row', () => {
    const ADAPTIVE_PLAN = `
Plan hash value: 111222333

-------------------------------------------------------------------
|   Id | Operation            | Name | Rows | Bytes | Cost (%CPU) |
-------------------------------------------------------------------
|    0 | SELECT STATEMENT     |      |   10 |   500 |    25   (4) |
|    1 |  HASH JOIN           |      |   10 |   500 |    25   (4) |
| -  2 |   NESTED LOOPS       |      |    5 |   150 |    12   (0) |
| -* 3 |    TABLE ACCESS FULL |  EMP |    5 |   100 |    7    (0) |
-------------------------------------------------------------------
`.trim();

    const [plan] = parseDbmsXplanPlans(ADAPTIVE_PLAN);
    expect(plan.allNodes).toHaveLength(4);

    const inactiveNoStar = plan.allNodes.find((n) => n.id === 2)!;
    expect(inactiveNoStar).toBeDefined();

    const inactiveWithStar = plan.allNodes.find((n) => n.id === 3)!;
    expect(inactiveWithStar).toBeDefined();
    expect(inactiveWithStar.operation).toBe('TABLE ACCESS FULL');
  });
});

describe('New example files (parser pack)', () => {
  it('parses the Partitioned Query example cleanly with pruning columns and a Note block', () => {
    const raw = readExample('25-dbms_xplan-Partitioned Query.txt');
    const [plan] = parseDbmsXplanPlans(raw);

    expect(plan.rootNode).not.toBeNull();
    expect(plan.allNodes.length).toBeGreaterThan(5);

    const partitionAll = plan.allNodes.find((n) => n.operation === 'PARTITION RANGE ALL');
    expect(partitionAll?.pstart).toBe('1');
    expect(partitionAll?.pstop).toBe('12');

    const keyNode = plan.allNodes.find((n) => n.pstart === 'KEY(I)');
    expect(keyNode).toBeDefined();

    const bfNode = plan.allNodes.find((n) => n.pstart === ':BF0000');
    expect(bfNode).toBeDefined();

    expect(plan.notes?.dynamicSampling).toBe(true);
    expect(plan.notes?.dynamicSamplingLevel).toBe(2);
  });

  it('parses the Parallel Query example cleanly with TQ/IN-OUT/PQ Distrib and a Note block', () => {
    const raw = readExample('26-dbms_xplan-Parallel Query.txt');
    const [plan] = parseDbmsXplanPlans(raw);

    expect(plan.rootNode).not.toBeNull();
    expect(plan.allNodes.length).toBeGreaterThan(5);

    const broadcastNode = plan.allNodes.find((n) => n.pqDistrib === 'BROADCAST');
    expect(broadcastNode).toBeDefined();

    const serialPoint = plan.allNodes.find((n) => n.inOut === 'P->S');
    expect(serialPoint?.operation).toContain('PX SEND QC');

    expect(plan.notes?.adaptivePlan).toBe(true);
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
