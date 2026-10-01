import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  computeEstimatedRowTotals,
  computeHottestNodeId,
  computeSelfCosts,
  computeSelfTimes,
  planRootCost,
  rankNodesByTime,
} from '../analysis';
import { parsePlan } from '../parser';
import { runAdvisor } from '../advisor';
import type { ParsedPlan, PlanNode, PlanSource } from '../types';

interface Spec extends Partial<Omit<PlanNode, 'children' | 'id' | 'operation' | 'depth' | 'parentId'>> {
  id: number;
  op: string;
  kids?: Spec[];
}

function buildPlan(spec: Spec, source: PlanSource = 'sql_monitor_text'): ParsedPlan {
  const allNodes: PlanNode[] = [];
  const build = (s: Spec, depth: number, parentId?: number): PlanNode => {
    const { op, kids, ...rest } = s;
    const node: PlanNode = { ...rest, operation: op, depth, parentId, children: [] };
    allNodes.push(node);
    node.children = (kids ?? []).map((c) => build(c, depth + 1, s.id));
    return node;
  };
  const rootNode = build(spec, 0);
  return { rootNode, allNodes, totalCost: 0, maxRows: 0, source, hasActualStats: true };
}

const get = (plan: ParsedPlan, id: number) => plan.allNodes.find((n) => n.id === id)!;

describe('computeEstimatedRowTotals', () => {
  it('multiplies per-start E-Rows by Starts on the inner side of a nested loop', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'NESTED LOOPS', rows: 1000, actualRows: 1000, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 1000, actualRows: 1000, starts: 1 },
          { id: 3, op: 'INDEX UNIQUE SCAN', rows: 1, actualRows: 1000, starts: 1000 },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 3).estimatedRowsTotal).toBe(1000);
    expect(get(plan, 2).estimatedRowsTotal).toBe(1000);
  });

  it('treats E-Rows as already global inside a PX slave set', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [
        { id: 1, op: 'TABLE ACCESS FULL', tq: 'Q1,00', rows: 1e6, actualRows: 1e6, starts: 8 },
      ],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 1).estimatedRowsTotal).toBe(1e6);
  });

  it('treats a node under a PX ancestor as parallel even without tq', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'PX COORDINATOR', rows: 100, actualRows: 100, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 100, actualRows: 100, starts: 4 },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 2).estimatedRowsTotal).toBe(100);
  });

  it('uses the partition iterator Starts as the multiplier below PARTITION ops', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'PARTITION RANGE ALL', rows: 1200, actualRows: 1200, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 1200, actualRows: 1200, starts: 12 },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 2).estimatedRowsTotal).toBe(1200);
  });

  it('uses the topmost PARTITION op of a consecutive run', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'PARTITION RANGE ALL', rows: 10, actualRows: 10, starts: 1, kids: [{
          id: 2, op: 'PARTITION HASH ALL', rows: 10, actualRows: 10, starts: 4, kids: [
            { id: 3, op: 'TABLE ACCESS FULL', rows: 10, actualRows: 10, starts: 48 },
          ],
        }],
      }],
    });
    computeEstimatedRowTotals(plan);
    // Topmost partition op (starts 1) is the multiplier: 10 x 1
    expect(get(plan, 3).estimatedRowsTotal).toBe(10);
  });

  it('uses the iterator Starts for a partition iterator on the inner side of a nested loop', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'NESTED LOOPS', rows: 50, actualRows: 50, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 50, actualRows: 50, starts: 1 },
          {
            id: 3, op: 'PARTITION RANGE ITERATOR', rows: 2, actualRows: 100, starts: 50, kids: [
              { id: 4, op: 'TABLE ACCESS BY LOCAL INDEX ROWID', rows: 2, actualRows: 100, starts: 150 },
            ],
          },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 4).estimatedRowsTotal).toBe(100);
  });

  it('uses the node own Starts when a probe side sits between it and a partition op', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'PARTITION RANGE ALL', rows: 5, actualRows: 5, starts: 1, kids: [{
          id: 2, op: 'NESTED LOOPS', rows: 5, actualRows: 5, starts: 3, kids: [
            { id: 4, op: 'TABLE ACCESS FULL', rows: 5, actualRows: 5, starts: 3 },
            { id: 3, op: 'INDEX UNIQUE SCAN', rows: 1, actualRows: 5, starts: 5 },
          ],
        }],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 3).estimatedRowsTotal).toBe(5);
  });

  it('uses E-Rows x Starts on the probe side of a nested loop inside a PX slave set', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'PX COORDINATOR', rows: 100, actualRows: 100, starts: 1, kids: [{
          id: 2, op: 'NESTED LOOPS', tq: 'Q1,00', rows: 100, actualRows: 100, starts: 8, kids: [
            { id: 3, op: 'TABLE ACCESS FULL', tq: 'Q1,00', rows: 100, actualRows: 100, starts: 8 },
            { id: 4, op: 'INDEX UNIQUE SCAN', tq: 'Q1,00', rows: 1, actualRows: 100, starts: 100 },
          ],
        }],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 3).estimatedRowsTotal).toBe(100); // driving side: global E-Rows
    expect(get(plan, 4).estimatedRowsTotal).toBe(100); // probe side: 1 x 100 starts
  });

  it('leaves never-started operations undefined', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [
        { id: 1, op: 'TABLE ACCESS FULL', rows: 5, actualRows: 0, starts: 0 },
      ],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 1).estimatedRowsTotal).toBeUndefined();
  });

  it('leaves early-terminated rows under COUNT STOPKEY undefined', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'COUNT STOPKEY', rows: 10, actualRows: 10, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 1e6, actualRows: 10, starts: 1 },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 2).estimatedRowsTotal).toBeUndefined();
  });

  it('still sets the total under COUNT STOPKEY when A-Rows reached it', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [{
        id: 1, op: 'COUNT STOPKEY', rows: 10, actualRows: 10, starts: 1, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', rows: 10, actualRows: 10, starts: 1 },
        ],
      }],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 2).estimatedRowsTotal).toBe(10);
  });

  it('keeps a total the parser already set and skips nodes without both numbers', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', kids: [
        { id: 1, op: 'TABLE ACCESS FULL', rows: 3, actualRows: 9, starts: 3, estimatedRowsTotal: 7 },
        { id: 2, op: 'TABLE ACCESS FULL', rows: 3, starts: 3 },
      ],
    });
    computeEstimatedRowTotals(plan);
    expect(get(plan, 1).estimatedRowsTotal).toBe(7);
    expect(get(plan, 2).estimatedRowsTotal).toBeUndefined();
  });
});

describe('planRootCost', () => {
  it('returns the root cost when defined', () => {
    const plan = buildPlan({ id: 0, op: 'SELECT STATEMENT', cost: 50, kids: [{ id: 1, op: 'X', cost: 80 }] });
    expect(planRootCost(plan.rootNode, plan.allNodes)).toBe(50);
  });

  it('falls back to the max node cost, then 0', () => {
    const plan = buildPlan({ id: 0, op: 'SELECT STATEMENT', kids: [{ id: 1, op: 'X', cost: 80 }, { id: 2, op: 'Y', cost: 20 }] });
    expect(planRootCost(plan.rootNode, plan.allNodes)).toBe(80);
    expect(planRootCost(null, [])).toBe(0);
  });
});

describe('computeSelfCosts', () => {
  it('derives cost minus children cost, clamped at 0', () => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', cost: 100, kids: [
        { id: 1, op: 'HASH JOIN', cost: 90, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', cost: 60 },
          { id: 3, op: 'TABLE ACCESS FULL', cost: 40 },
        ] },
        { id: 4, op: 'NO COST' },
      ],
    });
    computeSelfCosts(plan);
    expect(get(plan, 0).selfCost).toBe(10);
    expect(get(plan, 1).selfCost).toBe(0); // 90 - 100 clamped
    expect(get(plan, 2).selfCost).toBe(60);
    expect(get(plan, 4).selfCost).toBeUndefined();
  });
});

describe('computeHottestNodeId / rankNodesByTime for SQL Monitor sources', () => {
  const make = (source: PlanSource) => {
    const plan = buildPlan({
      id: 0, op: 'SELECT STATEMENT', actualTime: 1000, kids: [
        { id: 1, op: 'HASH JOIN', actualTime: 900, activityPercent: 10, kids: [
          { id: 2, op: 'TABLE ACCESS FULL', actualTime: 100, activityPercent: 80 },
        ] },
      ],
    }, source);
    computeSelfTimes(plan);
    return plan;
  };

  it('prefers ASH activityPercent over (overlapping) self time', () => {
    const plan = make('sql_monitor_xml');
    // self time would pick node 1 (800 ms); activity picks node 2
    expect(computeHottestNodeId(plan)).toBe(2);
    expect(rankNodesByTime(plan).map((n) => n.id)).toEqual([2, 1]);
  });

  it('keeps self-time ranking for non-Monitor sources', () => {
    const plan = make('dbms_xplan');
    expect(computeHottestNodeId(plan)).toBe(1);
    expect(rankNodesByTime(plan).map((n) => n.id)).toEqual([1, 2]);
  });

  it('falls back to self time when a Monitor plan has no activity data', () => {
    const plan = make('sql_monitor_text');
    for (const n of plan.allNodes) n.activityPercent = undefined;
    expect(computeHottestNodeId(plan)).toBe(1);
  });

  it('excludes nodes with no measure from the ranking', () => {
    const plan = buildPlan({ id: 0, op: 'S', kids: [{ id: 1, op: 'A', actualTime: 5 }, { id: 2, op: 'B' }] }, 'dbms_xplan');
    computeSelfTimes(plan);
    expect(rankNodesByTime(plan).map((n) => n.id)).toEqual([1]);
  });
});

describe('estimatedRowsTotal on real plans', () => {
  const fixture = (name: string) => readFileSync(join(__dirname, '../parser/__tests__/fixtures', name), 'utf-8');
  const example = (name: string) => readFileSync(join(__dirname, '../../examples', name), 'utf-8');

  it('uses the index scan Starts for the rowid fetch after NLJ batching', () => {
    const plan = parsePlan(fixture('allstats-nlj-batching.txt'));
    expect(get(plan, 7).estimatedRowsTotal).toBe(835); // 5 per outer row x 167 outer rows
    expect(get(plan, 5).estimatedRowsTotal).toBe(166);
    expect(get(plan, 6).estimatedRowsTotal).toBe(835);
  });

  it('uses the index scan Starts for a BATCHED rowid fetch above the nested loop', () => {
    const plan = parsePlan(fixture('allstats-batched-rowid.txt'));
    expect(get(plan, 2).estimatedRowsTotal).toBe(835);
    expect(get(plan, 5).estimatedRowsTotal).toBe(166);
    expect(get(plan, 6).estimatedRowsTotal).toBe(835);
  });

  it('handles the skewed parallel example (probe sides inside a slave set)', () => {
    const plan = parsePlan(example('18-sql_monitor-Skewed Parallel (J. Lewis).txt'));
    expect(get(plan, 32).estimatedRowsTotal).toBe(39_000_000);
    expect(get(plan, 7).estimatedRowsTotal).toBe(781);
    expect(get(plan, 30).estimatedRowsTotal).toBe(19 * 6465);
    expect(get(plan, 22).estimatedRowsTotal).toBe(63 * 43);
  });

  it('handles the cardinality-trap example and flags only the real misestimate', () => {
    const plan = parsePlan(example('22-sql_monitor-Cardinality Trap (NL).txt'));
    expect(get(plan, 5).estimatedRowsTotal).toBe(80000);
    expect(get(plan, 6).estimatedRowsTotal).toBe(80000);
    const flagged = runAdvisor(plan, null).findings
      .filter((f) => f.ruleId === 'cardinality-mismatch')
      .flatMap((f) => f.nodeIds);
    expect(flagged).toContain(4);
    expect(flagged).not.toContain(5);
    expect(flagged).not.toContain(6);
  });
});
