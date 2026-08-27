import { describe, expect, it } from 'vitest';
import { parsePlan } from '../../src/lib/parser';
import { planShape, shapesMatch } from '../lib/planShape';

const PLAN_A = `
Plan hash value: 1111111111

------------------------------------------------------------------------------------------
| Id  | Operation                   | Name                  | Rows  | Bytes | Cost (%CPU)|
------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT            |                       |     1 |    20 |     5   (0)|
|   1 |  NESTED LOOPS               |                       |     1 |    20 |     5   (0)|
|   2 |   TABLE ACCESS FULL         | EVAL_PARENT           |     1 |    10 |     3   (0)|
|*  3 |   INDEX RANGE SCAN          | EVAL_CHILD_IX         |     1 |    10 |     2   (0)|
------------------------------------------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------
   3 - access("C"."PARENT_ID"="P"."PARENT_ID")
`;

// Same shape, different plan hash and schema-qualified, un-prefixed names.
const PLAN_B = PLAN_A
  .replace('1111111111', '2222222222')
  .replace('EVAL_PARENT ', 'SCOTT.PARENT')
  .replace('EVAL_CHILD_IX', 'CHILD_IX     ');

const PLAN_C = PLAN_A.replace('NESTED LOOPS ', 'HASH JOIN    ');

describe('planShape', () => {
  it('normalizes operation and object name per line', () => {
    const shape = planShape(parsePlan(PLAN_A));
    expect(shape).toEqual([
      'SELECT STATEMENT',
      'NESTED LOOPS',
      'TABLE ACCESS FULL|PARENT',
      'INDEX RANGE SCAN|CHILD_IX',
    ]);
  });

  it('strips schema qualifiers and the EVAL_ prefix', () => {
    expect(planShape(parsePlan(PLAN_A))).toEqual(planShape(parsePlan(PLAN_B)));
  });
});

describe('shapesMatch', () => {
  it('matches identical shapes regardless of plan hash', () => {
    expect(shapesMatch(planShape(parsePlan(PLAN_A)), planShape(parsePlan(PLAN_B)))).toBe(true);
  });

  it('rejects a different operation', () => {
    expect(shapesMatch(planShape(parsePlan(PLAN_A)), planShape(parsePlan(PLAN_C)))).toBe(false);
  });

  it('rejects shapes of different length', () => {
    expect(shapesMatch(['A'], ['A', 'B'])).toBe(false);
  });
});
