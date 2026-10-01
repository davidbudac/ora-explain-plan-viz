import { describe, it, expect } from 'vitest';
import { computeWorstNodes } from '../worstNodes';
import type { ParsedPlan, PlanNode } from '../types';

const node = (overrides: Partial<PlanNode> & { id: number }): PlanNode => ({
  depth: 0,
  operation: `OP ${overrides.id}`,
  children: [],
  ...overrides,
});

const plan = (nodes: PlanNode[], overrides?: Partial<ParsedPlan>): ParsedPlan => ({
  rootNode: nodes[0],
  allNodes: nodes,
  totalCost: nodes[0]?.cost ?? 0,
  maxRows: 0,
  source: 'dbms_xplan',
  hasActualStats: false,
  ...overrides,
});

describe('computeWorstNodes', () => {
  it('ranks Highest Cost by own cost, not cumulative cost', () => {
    const nodes = [
      node({ id: 0, cost: 100, selfCost: 0 }),
      node({ id: 1, parentId: 0, cost: 100, selfCost: 5 }), // big cumulative, tiny own
      node({ id: 2, parentId: 1, cost: 90, selfCost: 90 }),
    ];
    const { byCost } = computeWorstNodes(plan(nodes));
    expect(byCost.map((n) => n.id)).toEqual([2, 1]);
  });

  it('ranks Slowest by self time and reports time as the measure', () => {
    const nodes = [
      node({ id: 0, actualTime: 10 }),
      node({ id: 1, parentId: 0, actualTime: 10, selfTime: 1 }),
      node({ id: 2, parentId: 1, actualTime: 9, selfTime: 9 }),
    ];
    const worst = computeWorstNodes(plan(nodes, { hasActualStats: true }));
    expect(worst.byTime.map((n) => n.id)).toEqual([2, 1]);
    expect(worst.timeBy).toBe('time');
  });

  it('ranks SQL Monitor plans with ASH data by activity', () => {
    const nodes = [
      node({ id: 0 }),
      node({ id: 1, parentId: 0, actualTime: 50, activityPercent: 10 }),
      node({ id: 2, parentId: 1, actualTime: 5, activityPercent: 70 }),
    ];
    const worst = computeWorstNodes(plan(nodes, { hasActualStats: true, source: 'sql_monitor_xml' }));
    expect(worst.byTime.map((n) => n.id)).toEqual([2, 1]);
    expect(worst.timeBy).toBe('activity');
  });

  it('returns nothing for no plan, and no time list without actual stats', () => {
    expect(computeWorstNodes(null).byCost).toEqual([]);
    const nodes = [node({ id: 0 }), node({ id: 1, parentId: 0, selfCost: 3, cost: 3 })];
    expect(computeWorstNodes(plan(nodes)).byTime).toEqual([]);
  });
});
