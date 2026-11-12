import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { computeHottestNodeId, rankNodesByTime, usesActivityRanking } from '../analysis';
import { parsePlan } from '../parser';

const example = (name: string) => parsePlan(readFileSync(join(__dirname, '../../examples', name), 'utf-8'));

// Bundled SQL Monitor examples, split by whether the report carries ASH activity per operation.
const WITHOUT_ASH = [
  '21-sql_monitor-Star Schema Rollup.txt',
  '22-sql_monitor-Cardinality Trap (NL).txt',
  '24-sql_monitor-Recursive BOM.txt',
  '27-sql_monitor-Partitioned Star Query.txt',
  '28-sql_monitor-Partition Range Iterator.txt',
];
const WITH_ASH: Array<[string, number]> = [
  ['17-sql_monitor-Exadata Cell Offload (K. Osborne).txt', 4],
  ['18-sql_monitor-Skewed Parallel (J. Lewis).txt', 30],
  ['23-sql_monitor-Window Sort Spill.txt', 4],
];

describe('SQL Monitor time (active windows are not self time)', () => {
  it.each(WITHOUT_ASH)('%s: no ASH activity, so no self time, no hotspot and no time ranking', (name) => {
    const plan = example(name);
    expect(plan.timeIsActiveWindow).toBe(true);
    expect(usesActivityRanking(plan)).toBe(false);
    expect(plan.allNodes.every((n) => n.selfTime === undefined)).toBe(true);
    expect(plan.maxSelfTime).toBe(0);
    expect(computeHottestNodeId(plan)).toBeNull();
    expect(rankNodesByTime(plan)).toEqual([]);
    // The active window itself is still there for display.
    expect(plan.allNodes.some((n) => n.actualTime !== undefined)).toBe(true);
  });

  it.each(WITH_ASH)('%s: ranked by ASH activity (hotspot %i), still without derived self time', (name, hottest) => {
    const plan = example(name);
    expect(plan.timeIsActiveWindow).toBe(true);
    expect(usesActivityRanking(plan)).toBe(true);
    expect(computeHottestNodeId(plan)).toBe(hottest);
    expect(rankNodesByTime(plan)[0].id).toBe(hottest);
    expect(plan.allNodes.every((n) => n.selfTime === undefined)).toBe(true);
  });

  it('keeps self time and the hotspot for a bare A-Rows table, whose A-Time is cumulative', () => {
    const plan = parsePlan([
      '| Id | Operation          | Name | Starts | E-Rows | A-Rows |   A-Time   |',
      '|  0 | SELECT STATEMENT   |      |      1 |        |     10 |00:00:02.50 |',
      '|  1 |  HASH JOIN         |      |      1 |    100 |     10 |00:00:02.50 |',
      '|  2 |   TABLE ACCESS FULL| T1   |      1 |    100 |    100 |00:00:00.50 |',
      '|  3 |   TABLE ACCESS FULL| T2   |      1 |   1000 |   1000 |00:00:01.50 |',
    ].join('\n'));
    expect(plan.source).toBe('sql_monitor_text');
    expect(plan.timeIsActiveWindow).toBeUndefined();
    expect(plan.allNodes.map((n) => n.selfTime)).toEqual([0, 500, 500, 1500]);
    expect(computeHottestNodeId(plan)).toBe(3);
  });
});
