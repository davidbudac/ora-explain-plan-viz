import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { computeHottestNodeId, usesActivityRanking } from '../analysis';
import { parsePlan } from '../parser';

const example = (name: string) => parsePlan(readFileSync(join(__dirname, '../../examples', name), 'utf-8'));

// [file, ranked by ASH activity?, total elapsed ms, hottest node id, its selfTime ms, Σ selfTime of non-root nodes ms]
const CURRENT: Array<[string, boolean, number, number, number, number]> = [
  ['17-sql_monitor-Exadata Cell Offload (K. Osborne).txt', true, 1000, 4, 0, 13000],
  ['18-sql_monitor-Skewed Parallel (J. Lewis).txt', true, 0, 30, 1000, 1100000],
  ['21-sql_monitor-Star Schema Rollup.txt', false, 399.675, 3, 1000, 4000],
  ['22-sql_monitor-Cardinality Trap (NL).txt', false, 146.466, 4, 1000, 3000],
  ['23-sql_monitor-Window Sort Spill.txt', true, 8531.237, 4, 5000, 8000],
  ['24-sql_monitor-Recursive BOM.txt', false, 137.51, 5, 1000, 6000],
  ['27-sql_monitor-Partitioned Star Query.txt', false, 325.716, 8, 1000, 3000],
  ['28-sql_monitor-Partition Range Iterator.txt', false, 123.014, 3, 1000, 3000],
];

describe('SQL Monitor time: characterisation of the current behaviour', () => {
  it.each(CURRENT)('%s', (name, ash, totalMs, hottest, hottestSelf, selfSum) => {
    const plan = example(name);
    expect(usesActivityRanking(plan)).toBe(ash);
    expect(plan.totalElapsedTime).toBeCloseTo(totalMs, 3);
    expect(computeHottestNodeId(plan)).toBe(hottest);
    expect(plan.allNodes.find((n) => n.id === hottest)!.selfTime).toBe(hottestSelf);
    const sum = plan.allNodes.filter((n) => n.parentId !== undefined).reduce((s, n) => s + (n.selfTime ?? 0), 0);
    expect(sum).toBe(selfSum);
  });
});
