import { describe, it, expect } from 'vitest';
import { nestedLoopVolumeRule } from '../rules/nestedLoopVolume';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan } from './helpers';
import type { RuleContext } from '../types';

function makeCtx(plan: ReturnType<typeof buildPlan>): RuleContext {
  return {
    plan,
    bundle: null,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: () => null,
    usedIndexKeys: new Set(),
  };
}

describe('nestedLoopVolumeRule', () => {
  it('flags a warning-tier nested loop with high probe count and inner volume', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 10_000 },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID', starts: 10_000, actualRows: 100_000 },
      ],
    });
    const findings = nestedLoopVolumeRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].nodeIds).toEqual([0]);
  });

  it('escalates to critical at the critical tiers', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 100_000 },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID', starts: 100_000, actualRows: 1_000_000 },
      ],
    });
    const findings = nestedLoopVolumeRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('critical');
  });

  it('does not flag when below thresholds', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 100 },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID', starts: 100, actualRows: 100 },
      ],
    });
    expect(nestedLoopVolumeRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('does not flag non-nested-loop joins', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'HASH JOIN',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 1_000_000 },
        { id: 2, operation: 'TABLE ACCESS FULL', starts: 1_000_000, actualRows: 2_000_000 },
      ],
    });
    expect(nestedLoopVolumeRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('is gated by requiresActualStats via the engine (rule itself needs actual stats fields to fire)', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL' },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID' },
      ],
    });
    expect(nestedLoopVolumeRule.evaluate(makeCtx(plan))).toHaveLength(0);
    expect(nestedLoopVolumeRule.requiresActualStats).toBe(true);
  });

  it('falls back to outer actualRows for probe count when inner starts is undefined', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 10_000 },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID', actualRows: 100_000 },
      ],
    });
    const findings = nestedLoopVolumeRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
  });

  it('ignores nodes with fewer than 2 children', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'NESTED LOOPS',
      children: [{ id: 1, operation: 'TABLE ACCESS FULL', actualRows: 1_000_000 }],
    });
    expect(nestedLoopVolumeRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });
});
