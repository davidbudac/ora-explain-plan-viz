import { describe, it, expect } from 'vitest';
import {
  assessPartitionPruning,
  computeParallelSignals,
  getDopDowngrade,
  BROADCAST_LARGE_ROWS,
} from '../planSignals';
import type { ParsedPlan, PlanNode, SqlMonitorMetadata } from '../types';

function makeNode(overrides: Partial<PlanNode>): PlanNode {
  return {
    id: 0,
    depth: 0,
    operation: 'TABLE ACCESS FULL',
    children: [],
    ...overrides,
  };
}

function makePlan(nodes: PlanNode[]): ParsedPlan {
  return {
    rootNode: nodes[0] ?? null,
    allNodes: nodes,
    totalCost: 0,
    maxRows: 0,
    source: 'dbms_xplan',
    hasActualStats: nodes.some((n) => n.actualRows !== undefined),
  };
}

describe('assessPartitionPruning', () => {
  it('returns undefined when node has neither pstart nor pstop', () => {
    const node = makeNode({});
    expect(assessPartitionPruning(node)).toBeUndefined();
  });

  it('returns "none" for PARTITION RANGE ALL regardless of values', () => {
    const node = makeNode({ operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12' });
    expect(assessPartitionPruning(node)).toBe('none');
  });

  it('returns "none" for PARTITION LIST ALL', () => {
    const node = makeNode({ operation: 'PARTITION LIST ALL', pstart: '1', pstop: '4' });
    expect(assessPartitionPruning(node)).toBe('none');
  });

  it('returns "none" for PARTITION HASH ALL', () => {
    const node = makeNode({ operation: 'PARTITION HASH ALL', pstart: '1', pstop: '8' });
    expect(assessPartitionPruning(node)).toBe('none');
  });

  it('returns "static" for numeric pstart/pstop', () => {
    const node = makeNode({ operation: 'PARTITION RANGE SINGLE', pstart: '9', pstop: '9' });
    expect(assessPartitionPruning(node)).toBe('static');
  });

  it('returns "runtime" for KEY', () => {
    const node = makeNode({ operation: 'PARTITION RANGE ITERATOR', pstart: 'KEY', pstop: 'KEY' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "runtime" for KEY(I)', () => {
    const node = makeNode({ pstart: 'KEY(I)', pstop: 'KEY(I)' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "runtime" for KEY(SQ)', () => {
    const node = makeNode({ pstart: 'KEY(SQ)', pstop: 'KEY(SQ)' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "runtime" for KEY(AP)', () => {
    const node = makeNode({ pstart: 'KEY(AP)', pstop: 'KEY(AP)' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "runtime" for :BFnnnn bind-driven pruning on either bound', () => {
    const node = makeNode({ pstart: ':BF0000', pstop: ':BF0000' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "runtime" when only one bound is KEY', () => {
    const node = makeNode({ pstart: 'KEY', pstop: '9' });
    expect(assessPartitionPruning(node)).toBe('runtime');
  });

  it('returns "static" for ROW LOCATION fallback', () => {
    const node = makeNode({ pstart: 'ROW LOCATION', pstop: 'ROW LOCATION' });
    expect(assessPartitionPruning(node)).toBe('static');
  });

  it('returns "static" for INVALID fallback', () => {
    const node = makeNode({ pstart: 'INVALID', pstop: 'INVALID' });
    expect(assessPartitionPruning(node)).toBe('static');
  });

  it('returns "static" for ANY fallback', () => {
    const node = makeNode({ pstart: 'ANY', pstop: 'ANY' });
    expect(assessPartitionPruning(node)).toBe('static');
  });
});

describe('computeParallelSignals', () => {
  it('flags a broadcast distribution exceeding the row threshold using E-Rows', () => {
    const node = makeNode({ id: 5, operation: 'PX SEND BROADCAST', pqDistrib: 'BROADCAST', rows: BROADCAST_LARGE_ROWS + 1 });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ nodeId: 5, kind: 'broadcast-large' });
  });

  it('flags a broadcast distribution exceeding the row threshold using A-Rows over E-Rows', () => {
    const node = makeNode({
      id: 5,
      operation: 'PX SEND BROADCAST',
      pqDistrib: 'BROADCAST',
      rows: 10,
      actualRows: BROADCAST_LARGE_ROWS + 1,
    });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(1);
    expect(signals[0].kind).toBe('broadcast-large');
  });

  it('does not flag broadcast at or below the threshold', () => {
    const node = makeNode({ id: 5, operation: 'PX SEND BROADCAST', pqDistrib: 'BROADCAST', rows: BROADCAST_LARGE_ROWS });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(0);
  });

  it('does not flag non-broadcast distributions', () => {
    const node = makeNode({ id: 5, operation: 'PX SEND HASH', pqDistrib: 'HASH', rows: BROADCAST_LARGE_ROWS + 1 });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(0);
  });

  it('flags a serial point on P->S transitions', () => {
    const node = makeNode({ id: 7, operation: 'BUFFER SORT', inOut: 'P->S' });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ nodeId: 7, kind: 'serial-point' });
  });

  it('exempts PX SEND QC from the serial-point signal', () => {
    const node = makeNode({ id: 8, operation: 'PX SEND QC (RANDOM)', inOut: 'P->S' });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(0);
  });

  it('does not flag serial rows without P->S', () => {
    const node = makeNode({ id: 9, operation: 'TABLE ACCESS FULL', inOut: 'PCWP' });
    const signals = computeParallelSignals(makePlan([node]));
    expect(signals).toHaveLength(0);
  });

  it('returns multiple signals across a plan', () => {
    const plan = makePlan([
      makeNode({ id: 1, operation: 'PX SEND BROADCAST', pqDistrib: 'BROADCAST', rows: BROADCAST_LARGE_ROWS + 5 }),
      makeNode({ id: 2, operation: 'BUFFER SORT', inOut: 'P->S' }),
    ]);
    const signals = computeParallelSignals(plan);
    expect(signals).toHaveLength(2);
  });
});

describe('getDopDowngrade', () => {
  it('returns null when metadata is undefined', () => {
    expect(getDopDowngrade(undefined)).toBeNull();
  });

  it('returns null when either field is missing', () => {
    expect(getDopDowngrade({ pxServersRequested: 8 } as SqlMonitorMetadata)).toBeNull();
    expect(getDopDowngrade({ pxServersAllocated: 4 } as SqlMonitorMetadata)).toBeNull();
  });

  it('returns null when allocated equals requested', () => {
    expect(getDopDowngrade({ pxServersRequested: 8, pxServersAllocated: 8 })).toBeNull();
  });

  it('returns null when allocated exceeds requested', () => {
    expect(getDopDowngrade({ pxServersRequested: 4, pxServersAllocated: 8 })).toBeNull();
  });

  it('returns the requested/allocated pair when downgraded', () => {
    expect(getDopDowngrade({ pxServersRequested: 8, pxServersAllocated: 4 })).toEqual({
      requested: 8,
      allocated: 4,
    });
  });
});
