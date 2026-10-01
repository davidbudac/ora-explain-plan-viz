import { describe, it, expect } from 'vitest';
import { matchNodes, computeComparisonSummary, getNodeMetricValue, createEmptySlot, buildComparisonRows, rowHasVisibleChange } from '../../compare';
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
    const typeOrder = { 'exact-id': 0, 'heuristic': 1, 'access-changed': 2, 'unmatched': 3 };
    for (let i = 1; i < types.length; i++) {
      expect(typeOrder[types[i]]).toBeGreaterThanOrEqual(typeOrder[types[i - 1]]);
    }
  });
});

describe('matchNodes: object-aware matching', () => {
  const pairs = (matches: ReturnType<typeof matchNodes>, type: string) =>
    matches.filter(m => m.matchType === type).map(m => [m.planANode?.id, m.planBNode?.id]);

  it('does not pair same-id nodes that differ in object or operation', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    expect(pairs(matches, 'exact-id')).toEqual([[0, 0]]);
    expect(pairs(matches, 'heuristic')).toEqual([[1, 2], [2, 1]]);
    expect(matches.filter(m => m.matchType === 'unmatched')).toHaveLength(0);
  });

  it('does not pair operations that only share a first word', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'SORT ORDER BY', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'SORT AGGREGATE', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    expect(pairs(matches, 'exact-id')).toEqual([[0, 0]]);
    expect(matches.filter(m => m.matchType === 'unmatched')).toHaveLength(2);
  });

  it('compares objects case-insensitively and treats two missing objects as equal', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS  FULL', objectName: 'emp', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);
    expect(matchNodes(planA, planB).every(m => m.matchType === 'exact-id')).toBe(true);
  });

  it('keeps pairing correctly when an inserted BUFFER SORT shifts later ids', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'HASH JOIN', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2 }),
      makeNode({ id: 3, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', depth: 2 }),
      makeNode({ id: 4, operation: 'SORT ORDER BY', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'HASH JOIN', depth: 1 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 2 }),
      makeNode({ id: 3, operation: 'BUFFER SORT', depth: 2 }),
      makeNode({ id: 4, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', depth: 3 }),
      makeNode({ id: 5, operation: 'SORT ORDER BY', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    expect(pairs(matches, 'exact-id')).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(pairs(matches, 'heuristic')).toEqual([[3, 4], [4, 5]]);
    const unmatched = matches.filter(m => m.matchType === 'unmatched');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].planBNode?.operation).toBe('BUFFER SORT');
  });

  it('pairs an access path change on the same table as access-changed', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS BY INDEX ROWID BATCHED', objectName: 'EMP', depth: 1 }),
    ]);

    const matches = matchNodes(planA, planB);
    expect(pairs(matches, 'access-changed')).toEqual([[1, 1]]);
    expect(matches.filter(m => m.matchType === 'unmatched')).toHaveLength(0);
    expect(computeComparisonSummary(planA, planB, matches).matchedCount).toBe(2);
  });

  it('pairs index scan variants on the same index by object name', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'INDEX RANGE SCAN', objectName: 'EMP_IX', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 5, operation: 'INDEX FULL SCAN', objectName: 'EMP_IX', depth: 3 }),
    ]);
    expect(pairs(matchNodes(planA, planB), 'access-changed')).toEqual([[1, 5]]);
  });

  it('prefers the same object name when a table and its index share an alias', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', objectAlias: 'E@SEL$1', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS BY INDEX ROWID', objectName: 'EMP', objectAlias: 'E@SEL$1', depth: 2 }),
      makeNode({ id: 2, operation: 'INDEX RANGE SCAN', objectName: 'EMP_IX', objectAlias: 'E@SEL$1', depth: 1 }),
    ]);
    const matches = matchNodes(planA, planB);
    expect(pairs(matches, 'access-changed')).toEqual([[1, 1]]);
    expect(matches.filter(m => m.matchType === 'unmatched').map(m => m.planBNode?.id)).toEqual([2]);
  });

  it('never pairs nodes without an object in the access-changed pass', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'HASH JOIN', depth: 1 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'NESTED LOOPS', depth: 1 }),
    ]);
    const matches = matchNodes(planA, planB);
    expect(matches.filter(m => m.matchType === 'access-changed')).toHaveLength(0);
    expect(matches.filter(m => m.matchType === 'unmatched')).toHaveLength(2);
  });

  it('prefers a matching alias over closer depth in the heuristic pass', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', objectAlias: 'E1@SEL$1', depth: 2 }),
      makeNode({ id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', objectAlias: 'E2@SEL$2', depth: 3 }),
    ]);
    const planB = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 5, operation: 'TABLE ACCESS FULL', objectName: 'EMP', objectAlias: 'E2@SEL$2', depth: 2 }),
      makeNode({ id: 6, operation: 'TABLE ACCESS FULL', objectName: 'EMP', objectAlias: 'E1@SEL$1', depth: 3 }),
    ]);
    expect(pairs(matchNodes(planA, planB), 'heuristic')).toEqual([[1, 6], [2, 5]]);
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

describe('buildComparisonRows', () => {
  it('computes deltas when both values are defined', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 60 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    expect(rows).toHaveLength(1);
    const costDelta = rows[0].deltas.cost!;
    expect(costDelta.valueA).toBe(100);
    expect(costDelta.valueB).toBe(60);
    expect(costDelta.delta).toBe(-40);
    expect(costDelta.deltaPercent).toBe(-40);
    expect(costDelta.changed).toBe(true);
  });

  it('flags one-sided values as changed without a numeric delta', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100, tempSpace: 4096 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    const temp = rows[0].deltas.tempSpace!;
    expect(temp.valueA).toBe(4096);
    expect(temp.valueB).toBeUndefined();
    expect(temp.delta).toBeUndefined();
    expect(temp.changed).toBe(true);
  });

  it('marks equal and both-undefined metrics as unchanged', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    expect(rows[0].deltas.cost!.changed).toBe(false);
    expect(rows[0].deltas.actualRows!.changed).toBe(false); // undefined on both sides
  });

  it('leaves deltaPercent undefined when valueA is zero', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 0 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 50 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    expect(rows[0].deltas.cost!.delta).toBe(50);
    expect(rows[0].deltas.cost!.deltaPercent).toBeUndefined();
  });

  it('builds stable keys from match type and both node ids', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'ONLY_IN_A', depth: 1 }),
    ]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    expect(rows.map((r) => r.key)).toEqual(['exact-id:0:0', 'unmatched:1:-']);
    expect(rows.map((r) => r.originalIndex)).toEqual([0, 1]);
  });

  it('includes selfTime as a comparable metric', () => {
    const nodeA = makeNode({ id: 0, operation: 'SELECT STATEMENT', selfTime: 400 });
    const nodeB = makeNode({ id: 0, operation: 'SELECT STATEMENT', selfTime: 100 });
    const rows = buildComparisonRows(matchNodes(makePlan([nodeA]), makePlan([nodeB])));

    expect(rows[0].deltas.selfTime!.delta).toBe(-300);
    expect(getNodeMetricValue(nodeA, 'selfTime')).toBe(400);
  });
});

describe('rowHasVisibleChange', () => {
  it('always counts unmatched rows as changed', () => {
    const planA = makePlan([
      makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 }),
      makeNode({ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'ONLY_IN_A', depth: 1 }),
    ]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', depth: 0 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));
    const unmatchedRow = rows.find((r) => r.match.matchType === 'unmatched')!;

    expect(rowHasVisibleChange(unmatchedRow, ['cost'])).toBe(true);
  });

  it('respects the visible metric set', () => {
    const planA = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100, rows: 10 })]);
    const planB = makePlan([makeNode({ id: 0, operation: 'SELECT STATEMENT', cost: 100, rows: 99 })]);
    const rows = buildComparisonRows(matchNodes(planA, planB));

    expect(rowHasVisibleChange(rows[0], ['cost'])).toBe(false);
    expect(rowHasVisibleChange(rows[0], ['cost', 'rows'])).toBe(true);
  });
});
