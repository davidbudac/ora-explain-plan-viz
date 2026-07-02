import { describe, it, expect } from 'vitest';
import { computeSelfTimes, computeHottestNodeId, walkPlanTree } from '../analysis';
import type { ParsedPlan, PlanNode, PlanSource } from '../types';

interface NodeSpec {
  id: number;
  actualTime?: number;
  children?: NodeSpec[];
}

function buildPlan(spec: NodeSpec, source: PlanSource = 'sql_monitor_text'): ParsedPlan {
  const allNodes: PlanNode[] = [];
  const build = (s: NodeSpec, depth: number, parentId?: number): PlanNode => {
    const node: PlanNode = {
      id: s.id,
      depth,
      operation: `OP ${s.id}`,
      actualTime: s.actualTime,
      parentId,
      children: [],
    };
    allNodes.push(node);
    node.children = (s.children ?? []).map((c) => build(c, depth + 1, s.id));
    return node;
  };
  const rootNode = build(spec, 0);
  return {
    rootNode,
    allNodes,
    totalCost: 0,
    maxRows: 0,
    source,
    hasActualStats: allNodes.some((n) => n.actualTime !== undefined),
  };
}

const byId = (plan: ParsedPlan, id: number) => plan.allNodes.find((n) => n.id === id)!;

describe('walkPlanTree', () => {
  it('visits parent before children, depth-first', () => {
    const plan = buildPlan({ id: 0, children: [{ id: 1, children: [{ id: 2 }] }, { id: 3 }] });
    const order: number[] = [];
    walkPlanTree(plan.rootNode!, (n) => order.push(n.id));
    expect(order).toEqual([0, 1, 2, 3]);
  });
});

describe('computeSelfTimes (cumulative sources)', () => {
  it('derives self time as actualTime minus children sum', () => {
    const plan = buildPlan({
      id: 0,
      actualTime: 1000,
      children: [
        { id: 1, actualTime: 900, children: [{ id: 2, actualTime: 700 }] },
      ],
    });
    computeSelfTimes(plan);
    expect(byId(plan, 0).selfTime).toBe(100);
    expect(byId(plan, 1).selfTime).toBe(200);
    expect(byId(plan, 2).selfTime).toBe(700); // leaf: self == cumulative
    expect(plan.maxSelfTime).toBe(700);
  });

  it('clamps negative self time to 0 (parallel/rounding artifacts)', () => {
    const plan = buildPlan({
      id: 0,
      actualTime: 500,
      children: [{ id: 1, actualTime: 400 }, { id: 2, actualTime: 300 }],
    });
    computeSelfTimes(plan);
    expect(byId(plan, 0).selfTime).toBe(0);
  });

  it('leaves selfTime undefined when actualTime is missing', () => {
    const plan = buildPlan({
      id: 0,
      children: [{ id: 1, actualTime: 100 }],
    });
    computeSelfTimes(plan);
    expect(byId(plan, 0).selfTime).toBeUndefined();
    expect(byId(plan, 1).selfTime).toBe(100);
  });

  it('treats children without actualTime as zero', () => {
    const plan = buildPlan({
      id: 0,
      actualTime: 300,
      children: [{ id: 1 }, { id: 2, actualTime: 100 }],
    });
    computeSelfTimes(plan);
    expect(byId(plan, 0).selfTime).toBe(200);
  });

  it('handles a single-node plan', () => {
    const plan = buildPlan({ id: 0, actualTime: 50 });
    computeSelfTimes(plan);
    expect(byId(plan, 0).selfTime).toBe(50);
    expect(plan.maxSelfTime).toBe(50);
  });
});

describe('computeSelfTimes (xbi source)', () => {
  it('rolls self times up to cumulative and preserves the plan-totals root', () => {
    // xbi: non-root actualTime is SELF time; root row is the plan total.
    const plan = buildPlan(
      {
        id: 0,
        actualTime: 600, // >>> Plan totals >>>
        children: [
          { id: 1, actualTime: 100, children: [{ id: 2, actualTime: 500 }] },
        ],
      },
      'xbi'
    );
    computeSelfTimes(plan);
    expect(byId(plan, 2).selfTime).toBe(500);
    expect(byId(plan, 2).actualTime).toBe(500);
    expect(byId(plan, 1).selfTime).toBe(100);
    expect(byId(plan, 1).actualTime).toBe(600); // rolled up
    expect(byId(plan, 0).selfTime).toBe(0);     // total − children
    expect(byId(plan, 0).actualTime).toBe(600); // unchanged plan total
    expect(plan.totalElapsedTime).toBe(600);
  });

  it('recomputes activityPercent from self time', () => {
    const plan = buildPlan(
      {
        id: 0,
        actualTime: 1000,
        children: [
          { id: 1, actualTime: 250, children: [{ id: 2, actualTime: 750 }] },
        ],
      },
      'xbi'
    );
    computeSelfTimes(plan);
    expect(byId(plan, 1).activityPercent).toBeCloseTo(25, 5);
    expect(byId(plan, 2).activityPercent).toBeCloseTo(75, 5);
    expect(byId(plan, 0).activityPercent).toBeUndefined(); // root skipped
  });
});

describe('computeHottestNodeId', () => {
  it('returns the non-root node with highest self time', () => {
    const plan = buildPlan({
      id: 0,
      actualTime: 1000,
      children: [
        { id: 1, actualTime: 900, children: [{ id: 2, actualTime: 200 }] },
        { id: 3, actualTime: 90 },
      ],
    });
    computeSelfTimes(plan);
    // self times: 1 → 700, 2 → 200, 3 → 90; cumulative would have picked 1 too,
    // but with the parent-dominates shape the leaf must win:
    const leafHot = buildPlan({
      id: 0,
      actualTime: 1000,
      children: [{ id: 1, actualTime: 990, children: [{ id: 2, actualTime: 980 }] }],
    });
    computeSelfTimes(leafHot);
    expect(computeHottestNodeId(plan)).toBe(1);
    expect(computeHottestNodeId(leafHot)).toBe(2); // cumulative ranking would say 1
  });

  it('returns null without actual stats or plan', () => {
    const plan = buildPlan({ id: 0, children: [{ id: 1 }] });
    computeSelfTimes(plan);
    expect(computeHottestNodeId(plan)).toBeNull();
    expect(computeHottestNodeId(null)).toBeNull();
  });
});
