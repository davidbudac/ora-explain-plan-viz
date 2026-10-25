import { describe, it, expect } from 'vitest';
import { parsePlans, splitDbmsXplanPlanBatches } from '../index';

const SQL = `SELECT /*+ gather_plan_statistics */ d.department_name, COUNT(*)
  FROM departments d
  JOIN employees e ON e.department_id = d.department_id
 WHERE d.location_id = :loc
 GROUP BY d.department_name`;

const NL_PLAN = `SQL_ID  7wk3dq0p9xz2c, child number 0
-------------------------------------
${SQL}

Plan hash value: 1111111111

---------------------------------------------------------------------------------------------------------
| Id  | Operation                      | Name          | Starts | E-Rows | A-Rows |   A-Time   | Buffers |
---------------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT               |               |      1 |        |      4 |00:00:00.01 |      19 |
|   1 |  HASH GROUP BY                 |               |      1 |      4 |      4 |00:00:00.01 |      19 |
|   2 |   NESTED LOOPS                 |               |      1 |    107 |    107 |00:00:00.01 |      19 |
|*  3 |    TABLE ACCESS FULL           | DEPARTMENTS   |      1 |      4 |      4 |00:00:00.01 |       8 |
|*  4 |    INDEX RANGE SCAN            | EMP_DEPT_IX   |      4 |     27 |    107 |00:00:00.01 |      11 |
---------------------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------

   3 - filter("D"."LOCATION_ID"=:LOC)
   4 - access("E"."DEPARTMENT_ID"="D"."DEPARTMENT_ID")

`;

const HASH_PLAN = `SQL_ID  7wk3dq0p9xz2c, child number 1
-------------------------------------
${SQL}

Plan hash value: 2222222222

-------------------------------------------------------------------------------------------------------------------
| Id  | Operation            | Name        | Starts | E-Rows | A-Rows |   A-Time   | Buffers |  OMem |  1Mem | Used-Mem |
-------------------------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT     |             |      1 |        |      4 |00:00:00.01 |      15 |       |       |          |
|   1 |  HASH GROUP BY       |             |      1 |      4 |      4 |00:00:00.01 |      15 |  1024K|  1024K| 1186K (0)|
|*  2 |   HASH JOIN          |             |      1 |    107 |    107 |00:00:00.01 |      15 |  1572K|  1572K| 1534K (0)|
|*  3 |    TABLE ACCESS FULL | DEPARTMENTS |      1 |      4 |      4 |00:00:00.01 |       7 |       |       |          |
|   4 |    TABLE ACCESS FULL | EMPLOYEES   |      1 |    107 |    107 |00:00:00.01 |       8 |       |       |          |
-------------------------------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------

   2 - access("E"."DEPARTMENT_ID"="D"."DEPARTMENT_ID")
   3 - filter("D"."LOCATION_ID"=:LOC)

`;

describe('two concatenated DISPLAY_CURSOR outputs (same SQL_ID, different plan hashes)', () => {
  const input = NL_PLAN + '\n' + HASH_PLAN;

  it('splits into two batches', () => {
    expect(splitDbmsXplanPlanBatches(input)).toHaveLength(2);
  });

  it('keeps each plan\'s own SQL_ID header with it', () => {
    const [first, second] = splitDbmsXplanPlanBatches(input);
    expect(first).toContain('child number 0');
    expect(first).not.toContain('child number 1');
    expect(first).not.toContain('Plan hash value: 2222222222');
    expect(second).toContain('child number 1');
    expect(second).toContain('SQL_ID  7wk3dq0p9xz2c');
  });

  // Estimate-only (no ALLSTATS) pair of children: Rows / Bytes / Cost columns.
  const estimateHeader = (child: number) => `SQL_ID  7wk3dq0p9xz2c, child number ${child}
-------------------------------------
select * from t where id = :b1`;
  const estimateTable = (hash: string, cost: number) => `
Plan hash value: ${hash}

----------------------------------------------------------
| Id  | Operation         | Name | Rows  | Bytes | Cost  |
----------------------------------------------------------
|   0 | SELECT STATEMENT  |      |     1 |     5 |     ${cost} |
|*  1 |  TABLE ACCESS FULL| T    |     1 |     5 |     ${cost} |
----------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------

   1 - filter("ID"=:B1)
`;
  const estimateInput = `${estimateHeader(0)}\n${estimateTable('1111111111', 3)}\n${estimateHeader(1)}\n${estimateTable('2222222222', 9)}`;

  it('parses each child with its own header data, for ALLSTATS and estimate-only column sets', () => {
    const plans = parsePlans(input);
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.planHashValue)).toEqual(['1111111111', '2222222222']);
    expect(plans.map((p) => p.childNumber)).toEqual([0, 1]);
    expect(plans.map((p) => p.sqlText)).toEqual([SQL, SQL]);
    for (const plan of plans) {
      expect(plan.hasActualStats).toBe(true);
      expect(plan.sqlId).toBe('7wk3dq0p9xz2c');
      expect(plan.allNodes).toHaveLength(5);
    }
    expect(plans[0].allNodes.find((n) => n.id === 2)!.operation).toBe('NESTED LOOPS');
    expect(plans[1].allNodes.find((n) => n.id === 2)!.operation).toBe('HASH JOIN');
    expect(plans[0].allNodes.find((n) => n.id === 4)!.actualRows).toBe(107);
    expect(plans[1].allNodes.find((n) => n.id === 4)!.starts).toBe(1);

    const estimates = parsePlans(estimateInput);
    expect(estimates).toHaveLength(2);
    expect(estimates.map((p) => p.childNumber)).toEqual([0, 1]);
    expect(estimates.map((p) => p.sqlId)).toEqual(['7wk3dq0p9xz2c', '7wk3dq0p9xz2c']);
    expect(estimates.map((p) => p.planHashValue)).toEqual(['1111111111', '2222222222']);
    expect(estimates.map((p) => p.sqlText)).toEqual(['select * from t where id = :b1', 'select * from t where id = :b1']);
    expect(estimates.map((p) => p.totalCost)).toEqual([3, 9]);
  });
});
