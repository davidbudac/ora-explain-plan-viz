import { describe, expect, it } from 'vitest';
import { parsePlan } from '../index';

const XPLAN_WITH_TEMPSPC = `
Plan hash value: 3456789012

------------------------------------------------------------------------------------
| Id  | Operation          | Name      | Rows  | Bytes |TempSpc| Cost (%CPU)| Time     |
------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT   |           |  1000 | 95000 |       |  15234  (2)| 00:03:03 |
|   1 |  SORT ORDER BY     |           |  1000 | 95000 |  112K |  15234  (2)| 00:03:03 |
|   2 |   TABLE ACCESS FULL| EMP       |  1000 | 95000 |       |   7420  (2)| 00:01:29 |
------------------------------------------------------------------------------------
`.trim();

const ALLSTATS_WITH_USED_TMP = `
SQL_ID  abcd1234efgh5, child number 0
-------------------------------------
select * from emp order by sal

Plan hash value: 3456789012

--------------------------------------------------------------------------------------------------------
| Id  | Operation          | Name | Starts | E-Rows | Cost (%CPU)| A-Rows |   A-Time   | Used-Mem | Used-Tmp|
--------------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT   |      |      1 |        |    30 (100)|   1000 |00:00:01.00 |          |         |
|   1 |  SORT ORDER BY     |      |      1 |   1000 |    30   (4)|   1000 |00:00:01.00 |  2048K   |  4096K  |
|   2 |   TABLE ACCESS FULL| EMP  |      1 |   1000 |    10   (0)|   1000 |00:00:00.50 |          |         |
--------------------------------------------------------------------------------------------------------
`.trim();

describe('totalCost', () => {
  it('is the root cost, not the sum of every node cost', () => {
    const plan = parsePlan(XPLAN_WITH_TEMPSPC);
    expect(plan.rootNode?.cost).toBe(15234);
    expect(plan.totalCost).toBe(15234);
  });

  it('derives selfCost after parsing', () => {
    const plan = parsePlan(XPLAN_WITH_TEMPSPC);
    const byId = (id: number) => plan.allNodes.find((n) => n.id === id)!;
    expect(byId(2).selfCost).toBe(7420);
    expect(byId(1).selfCost).toBe(15234 - 7420);
    expect(byId(0).selfCost).toBe(0);
  });
});

describe('temp space mapping', () => {
  it('maps DBMS_XPLAN TempSpc to the estimated tempSpace', () => {
    const plan = parsePlan(XPLAN_WITH_TEMPSPC);
    const sort = plan.allNodes.find((n) => n.id === 1)!;
    expect(sort.tempSpace).toBe(112 * 1024);
    expect(sort.tempUsed).toBeUndefined();
  });

  it('maps ALLSTATS Used-Tmp to the actual tempUsed', () => {
    const plan = parsePlan(ALLSTATS_WITH_USED_TMP);
    const sort = plan.allNodes.find((n) => n.id === 1)!;
    expect(sort.tempUsed).toBe(4096 * 1024);
    expect(sort.tempSpace).toBeUndefined();
  });
});

describe('post-parse estimatedRowsTotal', () => {
  it('is populated for runtime-stat plans and absent without actuals', () => {
    const withStats = parsePlan(ALLSTATS_WITH_USED_TMP);
    expect(withStats.allNodes.find((n) => n.id === 2)!.estimatedRowsTotal).toBe(1000);
    const without = parsePlan(XPLAN_WITH_TEMPSPC);
    expect(without.allNodes.every((n) => n.estimatedRowsTotal === undefined)).toBe(true);
  });
});
