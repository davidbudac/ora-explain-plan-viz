import { describe, expect, it } from 'vitest';
import type { ParsedPlan, PlanNode } from '../types';
import { computeSelfCosts, computeSelfTimes, effectiveChildren } from '../analysis';

const mk = (id: number, over: Partial<PlanNode> = {}): PlanNode => ({
  id,
  depth: 0,
  operation: `OP ${id}`,
  children: [],
  ...over,
});

/**
 * 3 UNION-ALL (cost 100, 100 ms)
 * ├─ 4 FILTER (cost 60, 60 ms)
 * └─ 27 HASH JOIN, inactive (cost 40, 40 ms)
 *    ├─ 28 NESTED LOOPS (cost 10, 10 ms)
 *    │  └─ 29 STATISTICS COLLECTOR, inactive (cost 4, 4 ms)
 *    │     └─ 30 INDEX FULL SCAN (cost 3, 3 ms)
 *    └─ 32 INDEX FULL SCAN, inactive (cost 1, 1 ms)
 */
function adaptivePlan(): ParsedPlan {
  const n30 = mk(30, { cost: 3, actualTime: 3, parentId: 29 });
  const n29 = mk(29, { cost: 4, actualTime: 4, inactive: true, parentId: 28, children: [n30] });
  const n28 = mk(28, { cost: 10, actualTime: 10, parentId: 27, children: [n29] });
  const n32 = mk(32, { cost: 1, actualTime: 1, inactive: true, parentId: 27 });
  const n27 = mk(27, { cost: 40, actualTime: 40, inactive: true, parentId: 3, children: [n28, n32] });
  const n4 = mk(4, { cost: 60, actualTime: 60, parentId: 3 });
  const n3 = mk(3, { cost: 100, actualTime: 100, children: [n4, n27] });
  return {
    rootNode: n3,
    allNodes: [n3, n4, n27, n28, n29, n30, n32],
    totalCost: 100,
    maxRows: 0,
    source: 'dbms_xplan',
    hasActualStats: true,
  };
}

const byId = (plan: ParsedPlan, id: number) => plan.allNodes.find((n) => n.id === id)!;

describe('effectiveChildren', () => {
  it('keeps active children and looks through inactive ones', () => {
    const plan = adaptivePlan();
    expect(effectiveChildren(byId(plan, 3)).map((n) => n.id)).toEqual([4, 28]);
    expect(effectiveChildren(byId(plan, 28)).map((n) => n.id)).toEqual([30]);
    expect(effectiveChildren(byId(plan, 4))).toEqual([]);
  });
});

describe('self numbers in adaptive plans', () => {
  it('self time subtracts only active work', () => {
    const plan = adaptivePlan();
    computeSelfTimes(plan);
    expect(byId(plan, 3).selfTime).toBe(30); // 100 − 60 (4) − 10 (28), not − 40 (27)
    expect(byId(plan, 28).selfTime).toBe(7); // 10 − 3 (30), not − 4 (29)
    expect(byId(plan, 30).selfTime).toBe(3);
    for (const id of [27, 29, 32]) expect(byId(plan, id).selfTime).toBeUndefined();
    expect(plan.maxSelfTime).toBe(60); // leaf FILTER 4
  });

  it('self cost subtracts only active work', () => {
    const plan = adaptivePlan();
    computeSelfCosts(plan);
    expect(byId(plan, 3).selfCost).toBe(30);
    expect(byId(plan, 28).selfCost).toBe(7);
    for (const id of [27, 29, 32]) expect(byId(plan, id).selfCost).toBeUndefined();
  });
});
