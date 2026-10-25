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
  it.each<[string, Partial<PlanNode>, ReturnType<typeof assessPartitionPruning>]>([
    ['undefined when the node has neither pstart nor pstop', {}, undefined],
    ['"none" for PARTITION RANGE ALL regardless of values', { operation: 'PARTITION RANGE ALL', pstart: '1', pstop: '12' }, 'none'],
    ['"none" for PARTITION LIST ALL', { operation: 'PARTITION LIST ALL', pstart: '1', pstop: '4' }, 'none'],
    ['"none" for PARTITION HASH ALL', { operation: 'PARTITION HASH ALL', pstart: '1', pstop: '8' }, 'none'],
    ['"static" for numeric pstart/pstop', { operation: 'PARTITION RANGE SINGLE', pstart: '9', pstop: '9' }, 'static'],
    ['"runtime" for KEY', { operation: 'PARTITION RANGE ITERATOR', pstart: 'KEY', pstop: 'KEY' }, 'runtime'],
    ['"runtime" for KEY(I)', { pstart: 'KEY(I)', pstop: 'KEY(I)' }, 'runtime'],
    ['"runtime" for KEY(SQ)', { pstart: 'KEY(SQ)', pstop: 'KEY(SQ)' }, 'runtime'],
    ['"runtime" for KEY(AP)', { pstart: 'KEY(AP)', pstop: 'KEY(AP)' }, 'runtime'],
    ['"runtime" for :BFnnnn bind-driven pruning', { pstart: ':BF0000', pstop: ':BF0000' }, 'runtime'],
    ['"runtime" when only one bound is KEY', { pstart: 'KEY', pstop: '9' }, 'runtime'],
    ['"static" for the ROW LOCATION fallback', { pstart: 'ROW LOCATION', pstop: 'ROW LOCATION' }, 'static'],
    ['"static" for the INVALID fallback', { pstart: 'INVALID', pstop: 'INVALID' }, 'static'],
    ['"static" for the ANY fallback', { pstart: 'ANY', pstop: 'ANY' }, 'static'],
  ])('returns %s', (_label, overrides, expected) => {
    expect(assessPartitionPruning(makeNode(overrides))).toBe(expected);
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
