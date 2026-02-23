import { describe, it, expect } from 'vitest';
import { matchNodes, computeComparisonSummary, getNodeMetricValue, createEmptySlot } from '../../compare';
import type { ParsedPlan, PlanNode } from '../../types';

function makeNode(overrides: Partial<PlanNode> & { id: number; operation: string }): PlanNode {
  return {
    depth: 0,
    children: [],
    ...overrides,
  };
}

function makePlan(nodes: PlanNode[], overrides?: Partial<ParsedPlan>): ParsedPlan {
  // Set parentId based on tree structure for realistic plans
  return {
    rootNode: nodes[0] ?? null,
    allNodes: nodes,
    totalCost: nodes.reduce((sum, n) => sum + (n.cost ?? 0), 0),
    maxRows: Math.max(0, ...nodes.map(n => n.rows ?? 0)),
    source: 'dbms_xplan',
    hasActualStats: nodes.some(n => n.actualRows !== undefined),
    ...overrides,
  };
}

describe('matchNodes', () => {
  it('matches nodes with same IDs and similar operations', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0, cost: 100 }),
      makeNode({ id: 1, operation: 'NESTED LOOPS', depth: 1, cost: 50 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2, cost: 30 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0, cost: 80 }),
      makeNode({ id: 1, operation: 'NESTED LOOPS', depth: 1, cost: 40 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2, cost: 20 }),
    ]);

    const matches = matchNodes(planA, planB);

    expect(matches).toHaveLength(3);
    expect(matches.every(m => m.matchType === 'exact-id')).toBe(true);
    expect(matches[0].planANode?.id).toBe(0);
    expect(matches[0].planBNode?.id).toBe(0);
  });

  it('uses heuristic matching when plan structures differ', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'HASH JOIN', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2 }),
    ]);

    const matches = matchNodes(planA, planB);

    // ID 0 matches exactly (both SELECT STATEMENT)
    const exactMatches = matches.filter(m => m.matchType === 'exact-id');
    expect(exactMatches.length).toBe(1);
    expect(exactMatches[0].planANode?.id).toBe(0);

    // ID 1 in plan A (TABLE ACCESS FULL EMP) should NOT match ID 1 in plan B (HASH JOIN)
    // Instead it should heuristic-match to ID 2 in plan B (TABLE ACCESS FULL EMP)
    const heuristicMatches = matches.filter(m => m.matchType === 'heuristic');
    expect(heuristicMatches.length).toBe(1);
    expect(heuristicMatches[0].planANode?.id).toBe(1);
    expect(heuristicMatches[0].planBNode?.id).toBe(2);

    // HASH JOIN (ID 1 in B) is unmatched
    const unmatched = matches.filter(m => m.matchType === 'unmatched');
    expect(unmatched.length).toBe(1);
    expect(unmatched[0].planBNode?.id).toBe(1);
  });

  it('handles nodes only in Plan A', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'FILTER', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    const unmatched = matches.filter(m => m.matchType === 'unmatched');
    expect(unmatched.length).toBe(1);
    expect(unmatched[0].planANode?.id).toBe(1);
    expect(unmatched[0].planBNode).toBeNull();
  });

  it('handles nodes only in Plan B', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
      makeNode({ id: 2, operation: 'INDEX RANGE SCAN', objectName: 'EMP_IDX', depth: 2 }),
    ]);

    const matches = matchNodes(planA, planB);
    const unmatched = matches.filter(m => m.matchType === 'unmatched');
    expect(unmatched.length).toBe(1);
    expect(unmatched[0].planANode).toBeNull();
    expect(unmatched[0].planBNode?.id).toBe(2);
  });

  it('handles empty plans', () => {
    const emptyPlan = makePlan([]);
    const matches = matchNodes(emptyPlan, emptyPlan);
    expect(matches).toHaveLength(0);
  });

  it('handles identical plans', () => {
    const nodes = [
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0, cost: 10 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1, cost: 10 }),
    ];
    const planA = makePlan(nodes);
    const planB = makePlan(nodes);

    const matches = matchNodes(planA, planB);
    expect(matches).toHaveLength(2);
    expect(matches.every(m => m.matchType === 'exact-id')).toBe(true);
    expect(matches.filter(m => m.matchType === 'unmatched')).toHaveLength(0);
  });

  it('sorts matches: exact-id first, then heuristic, then unmatched', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 5, operation: 'FILTER', depth: 1 }),
      makeNode({ id: 10, operation: 'TABLE ACCESS FULL', objectName: 'X', depth: 2 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 3, operation: 'HASH JOIN', depth: 1 }),
      makeNode({ id: 7, operation: 'TABLE ACCESS FULL', objectName: 'X', depth: 2 }),
    ]);

    const matches = matchNodes(planA, planB);
    const types = matches.map(m => m.matchType);
    const typeOrder = { 'exact-id': 0, 'heuristic': 1, 'unmatched': 2 };
    for (let i = 1; i < types.length; i++) {
      expect(typeOrder[types[i]]).toBeGreaterThanOrEqual(typeOrder[types[i - 1]]);
    }
  });
});

describe('computeComparisonSummary', () => {
  it('computes cost deltas', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0, cost: 100 }),
    ], { totalCost: 100 });
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0, cost: 150 }),
    ], { totalCost: 150 });

    const matches = matchNodes(planA, planB);
    const summary = computeComparisonSummary(planA, planB, matches);

    expect(summary.totalCostA).toBe(100);
    expect(summary.totalCostB).toBe(150);
    expect(summary.costDelta).toBe(50);
    expect(summary.costDeltaPercent).toBe(50);
  });

  it('computes time deltas when available', () => {
    const planA = makePlan(
      [makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })],
      { totalElapsedTime: 1000 }
    );
    const planB = makePlan(
      [makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })],
      { totalElapsedTime: 500 }
    );

    const matches = matchNodes(planA, planB);
    const summary = computeComparisonSummary(planA, planB, matches);

    expect(summary.totalElapsedTimeA).toBe(1000);
    expect(summary.totalElapsedTimeB).toBe(500);
    expect(summary.timeDelta).toBe(-500);
    expect(summary.timeDeltaPercent).toBe(-50);
  });

  it('leaves time undefined when not available', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })]);

    const matches = matchNodes(planA, planB);
    const summary = computeComparisonSummary(planA, planB, matches);

    expect(summary.timeDelta).toBeUndefined();
    expect(summary.timeDeltaPercent).toBeUndefined();
  });

  it('counts matched and unmatched nodes', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'FILTER', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 2, operation: 'HASH JOIN', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    const summary = computeComparisonSummary(planA, planB, matches);

    expect(summary.matchedCount).toBe(1); // ID 0 matches
    expect(summary.unmatchedACount).toBe(1); // FILTER only in A
    expect(summary.unmatchedBCount).toBe(1); // HASH JOIN only in B
  });
});

describe('getNodeMetricValue', () => {
  it('returns the correct metric values', () => {
    const node = makeNode({
      id: 1,
      operation: 'TABLE ACCESS FULL',
      cost: 100,
      rows: 500,
      bytes: 1000,
      actualRows: 600,
      actualTime: 250,
      starts: 3,
      tempUsed: 4096,
      memoryUsed: 8192,
    });

    expect(getNodeMetricValue(node, 'cost')).toBe(100);
    expect(getNodeMetricValue(node, 'rows')).toBe(500);
    expect(getNodeMetricValue(node, 'bytes')).toBe(1000);
    expect(getNodeMetricValue(node, 'actualRows')).toBe(600);
    expect(getNodeMetricValue(node, 'actualTime')).toBe(250);
    expect(getNodeMetricValue(node, 'starts')).toBe(3);
    expect(getNodeMetricValue(node, 'tempSpace')).toBe(4096);
    expect(getNodeMetricValue(node, 'memoryUsed')).toBe(8192);
  });

  it('returns undefined for missing metrics', () => {
    const node = makeNode({ id: 1, operation: 'SELECT STATEMENT' });
    expect(getNodeMetricValue(node, 'cost')).toBeUndefined();
    expect(getNodeMetricValue(node, 'actualRows')).toBeUndefined();
  });
});

describe('createEmptySlot', () => {
  it('creates slot with correct label', () => {
    const slot0 = createEmptySlot(0);
    expect(slot0.id).toBe('plan-0');
    expect(slot0.label).toBe('Plan A');
    expect(slot0.rawInput).toBe('');
    expect(slot0.parsedPlan).toBeNull();

    const slot1 = createEmptySlot(1);
    expect(slot1.id).toBe('plan-1');
    expect(slot1.label).toBe('Plan B');
  });
});
