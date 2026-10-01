import { describe, expect, it } from 'vitest';
import { computeSelectionStats, outermostNodes } from '../selectionStats';
import { computeSelfCosts, computeSelfTimes } from '../analysis';
import type { ParsedPlan, PlanNode } from '../types';

function node(id: number, parentId: number | undefined, extra: Partial<PlanNode> = {}): PlanNode {
  return { id, depth: parentId === undefined ? 0 : 1, operation: `OP ${id}`, parentId, children: [], ...extra };
}

/** 0 SELECT (cost 10, 100 ms, 100 buffers) → 1 HASH JOIN → 2 + 3 scans. */
function samplePlan(source: ParsedPlan['source']): ParsedPlan {
  const root = node(0, undefined, { cost: 10, actualTime: 1000, logicalReads: 100, physicalReads: 20, actualRows: 5, starts: 1 });
  const join = node(1, 0, { cost: 10, actualTime: 1000, logicalReads: 100, physicalReads: 20, actualRows: 5, starts: 1 });
  const a = node(2, 1, { cost: 3, actualTime: 300, logicalReads: 30, physicalReads: 5, actualRows: 50, starts: 1 });
  const b = node(3, 1, { cost: 4, actualTime: 400, logicalReads: 40, physicalReads: 5, actualRows: 80, starts: 7 });
  root.children = [join];
  join.children = [a, b];
  const plan: ParsedPlan = {
    rootNode: root,
    allNodes: [root, join, a, b],
    totalCost: 10,
    maxRows: 0,
    source,
    hasActualStats: true,
  };
  computeSelfCosts(plan);
  computeSelfTimes(plan);
  return plan;
}

describe('computeSelectionStats', () => {
  it('sums self cost, self time and self buffers, so selecting a whole subtree equals the root totals', () => {
    const plan = samplePlan('dbms_xplan');
    const stats = computeSelectionStats(plan.allNodes, plan.allNodes, plan.source);
    expect(stats.sumSelfCost).toBe(10); // not 10 + 10 + 3 + 4
    expect(stats.sumActualTime).toBe(1000); // not 1000 + 1000 + 300 + 400
    expect(stats.actualTimeLabel).toBe('Self time');
    expect(stats.sumSelfBuffers).toBe(100);
    expect(stats.sumSelfPhysicalReads).toBe(20);
  });

  it('counts a selected ancestor and descendant once', () => {
    const plan = samplePlan('dbms_xplan');
    const [, join, a] = plan.allNodes;
    const stats = computeSelectionStats([join, a], plan.allNodes, plan.source);
    // join self = 10 - (3 + 4) = 3, a self = 3
    expect(stats.sumSelfCost).toBe(6);
    expect(stats.sumActualTime).toBe(300 + 300); // join self 1000 - 700, a self 300
    expect(stats.sumSelfBuffers).toBe(30 + 30); // join 100 - 70, a 30
  });

  it('does not sum Starts and reports the largest A-Rows / Starts instead', () => {
    const plan = samplePlan('dbms_xplan');
    const stats = computeSelectionStats(plan.allNodes.slice(2), plan.allNodes, plan.source);
    expect(stats.maxStarts).toBe(7);
    expect(stats.maxActualRows).toBe(80);
    expect(stats.sumActualRows).toBe(130);
    expect('sumStarts' in stats).toBe(false);
  });

  it('takes SQL Monitor per-line buffers as already exclusive', () => {
    const plan = samplePlan('sql_monitor_xml');
    const stats = computeSelectionStats(plan.allNodes, plan.allNodes, plan.source);
    expect(stats.sumSelfBuffers).toBe(100 + 100 + 30 + 40);
  });

  it('falls back to the outermost cumulative A-Time when self time is unavailable', () => {
    const plan = samplePlan('dbms_xplan');
    const [, join, a] = plan.allNodes;
    for (const n of plan.allNodes) n.selfTime = undefined;
    const stats = computeSelectionStats([join, a], plan.allNodes, plan.source);
    expect(stats.actualTimeLabel).toBe('A-Time');
    expect(stats.sumActualTime).toBe(1000); // the join includes a
    expect(outermostNodes([join, a], plan.allNodes).map((n) => n.id)).toEqual([1]);
  });

  it('never goes negative when a child exceeds its parent', () => {
    const plan = samplePlan('dbms_xplan');
    plan.allNodes[1].logicalReads = 10; // less than its children's 70
    const stats = computeSelectionStats([plan.allNodes[1]], plan.allNodes, plan.source);
    expect(stats.sumSelfBuffers).toBe(0);
  });
});
