import { describe, it, expect } from 'vitest';
import type { MetadataBundle } from '../bundle';
import type { PlanSlot } from '../../compare';
import type { ParsedPlan } from '../../types';
import { pairBundleWithSlots } from '../pairing';
import { createEmptyAnnotationState } from '../../annotations';

function makeBundle(opts: { sqlId: string | null; planHash: number | null }): MetadataBundle {
  return {
    format: 'ora-plan-metadata',
    version: 1,
    captured_at: '2026-01-01T00:00:00Z',
    source: { db_name: 'X', oracle_version: '19.0', container_name: 'C' },
    plan_ref: { sql_id: opts.sqlId, plan_hash_value: opts.planHash },
    objects: {},
    coverage_warnings: [],
  };
}

function makeSlot(id: string, parsedPlan: ParsedPlan | null): PlanSlot {
  return {
    id,
    label: `Plan ${id}`,
    rawInput: '',
    parsedPlan,
    error: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    annotations: createEmptyAnnotationState(),
    metadataBundle: null,
  };
}

function makeParsedPlan(opts: { sqlId?: string; planHash?: string }): ParsedPlan {
  return {
    rootNode: null,
    allNodes: [],
    totalCost: 0,
    maxRows: 0,
    source: 'dbms_xplan',
    hasActualStats: false,
    sqlId: opts.sqlId,
    planHashValue: opts.planHash,
  };
}

describe('pairBundleWithSlots', () => {
  it('returns no-targets when no slots have a loaded plan', () => {
    const bundle = makeBundle({ sqlId: 'abc', planHash: 1 });
    const slots = [makeSlot('a', null), makeSlot('b', null)];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('no-targets');
  });

  it('auto-attaches with no warning when sql_id and plan_hash both match', () => {
    const bundle = makeBundle({ sqlId: 'abc', planHash: 12345 });
    const slots = [
      makeSlot('a', makeParsedPlan({ sqlId: 'abc', planHash: '12345' })),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision).toEqual({ kind: 'auto-attach', slotIndex: 0, warning: null });
  });

  it('auto-attaches with a warning when sql_id matches but plan_hash differs', () => {
    const bundle = makeBundle({ sqlId: 'abc', planHash: 99999 });
    const slots = [
      makeSlot('a', makeParsedPlan({ sqlId: 'abc', planHash: '12345' })),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('auto-attach');
    if (decision.kind === 'auto-attach') {
      expect(decision.slotIndex).toBe(0);
      expect(decision.warning).toMatch(/plan_hash/i);
      expect(decision.warning).toContain('12345');
      expect(decision.warning).toContain('99999');
    }
  });

  it('returns needs-choice when bundle sql_id matches no loaded plan', () => {
    const bundle = makeBundle({ sqlId: 'xyz', planHash: 1 });
    const slots = [
      makeSlot('a', makeParsedPlan({ sqlId: 'abc', planHash: '12345' })),
      makeSlot('b', null),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('needs-choice');
    if (decision.kind === 'needs-choice') {
      expect(decision.candidateIndices).toEqual([0]);
    }
  });

  it('returns needs-choice when bundle has no sql_id', () => {
    const bundle = makeBundle({ sqlId: null, planHash: 1 });
    const slots = [
      makeSlot('a', makeParsedPlan({ sqlId: 'abc', planHash: '12345' })),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('needs-choice');
    if (decision.kind === 'needs-choice') {
      expect(decision.candidateIndices).toEqual([0]);
    }
  });

  it('returns needs-choice when active plan has no sql_id at all', () => {
    const bundle = makeBundle({ sqlId: 'abc', planHash: 1 });
    const slots = [
      makeSlot('a', makeParsedPlan({})),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('needs-choice');
    if (decision.kind === 'needs-choice') {
      expect(decision.candidateIndices).toEqual([0]);
    }
  });

  it('excludes empty slots from candidate list', () => {
    const bundle = makeBundle({ sqlId: 'xyz', planHash: 1 });
    const slots = [
      makeSlot('a', null),
      makeSlot('b', makeParsedPlan({ sqlId: 'abc' })),
      makeSlot('c', null),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision.kind).toBe('needs-choice');
    if (decision.kind === 'needs-choice') {
      expect(decision.candidateIndices).toEqual([1]);
    }
  });

  it('treats no warning as needed when bundle plan_hash is null', () => {
    const bundle = makeBundle({ sqlId: 'abc', planHash: null });
    const slots = [
      makeSlot('a', makeParsedPlan({ sqlId: 'abc', planHash: '12345' })),
    ];
    const decision = pairBundleWithSlots(bundle, slots);
    expect(decision).toEqual({ kind: 'auto-attach', slotIndex: 0, warning: null });
  });
});
