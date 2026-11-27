import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import { computeComparisonSummary, matchNodes } from '../../compare';

const MEASURED = parsePlan(readFileSync(
  join(__dirname, '../../../examples/12-json-JSON Plan (TPC-DS Hash Joins).txt'),
  'utf8',
));
const MEASURED_ROOT_MS = 12074670 / 1000;

const rows = (runtime: Record<string, unknown>) => [
  { ID: 0, PARENT_ID: null, OPERATION: 'SELECT STATEMENT', CARDINALITY: 263, COST: 15234, ...runtime },
  { ID: 1, PARENT_ID: 0, POSITION: 1, OPERATION: 'TABLE ACCESS', OPTIONS: 'FULL', OBJECT_NAME: 'WEB_SALES', CARDINALITY: 263, COST: 15234, ...runtime },
];
const ESTIMATE_JSON = JSON.stringify(rows({}));
const ESTIMATE_CSV = 'ID,PARENT_ID,POSITION,OPERATION,OPTIONS,OBJECT_NAME,CARDINALITY,COST\n0,,1,SELECT STATEMENT,,,263,15234\n1,0,1,TABLE ACCESS,FULL,WEB_SALES,263,15234';

const summary = (b: ReturnType<typeof parsePlan>) => computeComparisonSummary(MEASURED, b, matchNodes(MEASURED, b));

describe('V$SQL_PLAN imports without runtime statistics', () => {
  it.each([['JSON', ESTIMATE_JSON], ['CSV', ESTIMATE_CSV]])('%s estimate-only plan has no elapsed time and no runtime delta', (_, input) => {
    const plan = parsePlan(input);
    expect(plan.hasActualStats).toBe(false);
    expect(plan.allNodes.map(n => n.actualTime)).toEqual([undefined, undefined]);
    expect(plan.totalElapsedTime).toBeUndefined();

    const s = summary(plan);
    expect(s.totalElapsedTimeA).toBe(MEASURED_ROOT_MS);
    expect(s.totalElapsedTimeB).toBeUndefined();
    expect(s.timeDelta).toBeUndefined();
    expect(s.timeDeltaPercent).toBeUndefined();
  });

  it('a measured zero elapsed time is kept and compared', () => {
    const plan = parsePlan(JSON.stringify(rows({ LAST_STARTS: 1, LAST_OUTPUT_ROWS: 263, LAST_ELAPSED_TIME: 0 })));
    expect(plan.totalElapsedTime).toBe(0);
    const s = summary(plan);
    expect(s.totalElapsedTimeB).toBe(0);
    expect(s.timeDelta).toBeCloseTo(-MEASURED_ROOT_MS);
    expect(s.timeDeltaPercent).toBeCloseTo(-100);
  });
});
