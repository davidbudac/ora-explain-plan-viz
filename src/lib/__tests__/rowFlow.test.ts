import { describe, it, expect } from 'vitest';
import { computeRowFlow } from '../rowFlow';
import type { ParsedPlan, PlanNode } from '../types';

function makeNode(partial: Partial<PlanNode> & { id: number }): PlanNode {
  return { depth: 0, operation: 'OP', children: [], ...partial };
}

describe('computeRowFlow', () => {
  it('classifies source/reduction/amplification/passthrough and totals rows', () => {
    // TABLE ACCESS FULL (leaf, 1000 actual rows)
    const leaf = makeNode({ id: 2, operation: 'TABLE ACCESS FULL', actualRows: 1000, rows: 900 });
    // FILTER: input 1000, output 10 -> reduction
    const filterNode = makeNode({ id: 1, operation: 'FILTER', actualRows: 10, rows: 50, children: [leaf] });
    // HASH JOIN (root): input = filter's output (10) + a second leaf's output (5) = 15,
    // output 12 -> passthrough (12/15 = 0.8, between 1/1.5≈0.667 and 1.5)
    const leaf2 = makeNode({ id: 3, operation: 'TABLE ACCESS FULL', actualRows: 5, rows: 5 });
    const root = makeNode({ id: 0, operation: 'HASH JOIN', actualRows: 12, rows: 12, children: [filterNode, leaf2] });

    const plan: ParsedPlan = {
      rootNode: root,
      allNodes: [root, filterNode, leaf, leaf2],
      totalCost: 0,
      maxRows: 0,
      source: 'sql_monitor_xml',
      hasActualStats: true,
    };

    const flow = computeRowFlow(plan);

    const byId = (id: number) => flow.entries.find((e) => e.node.id === id)!;
    expect(byId(2).kind).toBe('source');
    expect(byId(2).input).toBe(0);
    expect(byId(2).factor).toBeUndefined();
    expect(byId(2).output).toBe(1000);
    expect(byId(2).outputIsEstimate).toBe(false);

    expect(byId(1).kind).toBe('reduction'); // 10/1000
    expect(byId(1).input).toBe(1000);
    expect(byId(1).output).toBe(10);

    expect(byId(0).input).toBe(15); // 10 + 5
    expect(byId(0).output).toBe(12);
    expect(byId(0).kind).toBe('passthrough');

    expect(flow.leafRowsRead).toBe(1005); // 1000 + 5
    expect(flow.rootRowsReturned).toBe(12);
    expect(flow.hasActuals).toBe(true);
  });

  it('classifies amplification and falls back to estimated rows when actualRows is absent', () => {
    // Estimates-only (DBMS_XPLAN) plan: NESTED LOOPS fans out 1 input row to 100 output rows.
    const leaf = makeNode({ id: 1, operation: 'INDEX RANGE SCAN', rows: 1 });
    const root = makeNode({ id: 0, operation: 'NESTED LOOPS', rows: 100, children: [leaf] });

    const plan: ParsedPlan = {
      rootNode: root,
      allNodes: [root, leaf],
      totalCost: 0,
      maxRows: 0,
      source: 'dbms_xplan',
      hasActualStats: false,
    };

    const flow = computeRowFlow(plan);
    const byId = (id: number) => flow.entries.find((e) => e.node.id === id)!;

    expect(byId(1).output).toBe(1);
    expect(byId(1).outputIsEstimate).toBe(true);
    expect(byId(0).output).toBe(100);
    expect(byId(0).input).toBe(1);
    expect(byId(0).kind).toBe('amplification'); // 100/1 = 100 > 1.5
    expect(flow.hasActuals).toBe(false);
  });

  it('handles a node whose only child has zero output (factor undefined -> passthrough)', () => {
    const leaf = makeNode({ id: 1, operation: 'TABLE ACCESS FULL', actualRows: 0 });
    const root = makeNode({ id: 0, operation: 'FILTER', actualRows: 0, children: [leaf] });
    const plan: ParsedPlan = {
      rootNode: root,
      allNodes: [root, leaf],
      totalCost: 0,
      maxRows: 0,
      source: 'sql_monitor_xml',
      hasActualStats: true,
    };
    const flow = computeRowFlow(plan);
    const rootEntry = flow.entries.find((e) => e.node.id === 0)!;
    expect(rootEntry.input).toBe(0);
    expect(rootEntry.factor).toBeUndefined();
    expect(rootEntry.kind).toBe('passthrough');
  });
});

describe('computeRowFlow on adaptive plans', () => {
  it('leaves out inactive rows and feeds the rows below them to the nearest active ancestor', () => {
    // NESTED LOOPS (ran) -> [ STATISTICS COLLECTOR (inactive) -> outer scan (ran), inner scan (ran) ],
    // next to the unused alternative: an inactive leaf that only has an estimate.
    const outer = makeNode({ id: 3, operation: 'TABLE ACCESS FULL', actualRows: 40 });
    const collector = makeNode({ id: 2, operation: 'STATISTICS COLLECTOR', inactive: true, rows: 7000, children: [outer] });
    const inner = makeNode({ id: 4, operation: 'INDEX RANGE SCAN', actualRows: 60 });
    const unused = makeNode({ id: 5, operation: 'TABLE ACCESS FULL', inactive: true, rows: 5000 });
    const root = makeNode({ id: 1, operation: 'NESTED LOOPS', actualRows: 50, children: [collector, inner, unused] });
    const plan: ParsedPlan = {
      rootNode: root,
      allNodes: [root, collector, outer, inner, unused],
      totalCost: 0,
      maxRows: 0,
      source: 'sql_monitor_xml',
      hasActualStats: true,
    };

    const flow = computeRowFlow(plan);

    expect(flow.entries.map((e) => e.node.id)).toEqual([1, 3, 4]);
    expect(flow.entries.find((e) => e.node.id === 1)!.input).toBe(100); // 40 + 60, not 7000 + 60 + 5000
    expect(flow.leafRowsRead).toBe(100); // not 5,100: the inactive leaf's estimate is not rows read
  });
});
