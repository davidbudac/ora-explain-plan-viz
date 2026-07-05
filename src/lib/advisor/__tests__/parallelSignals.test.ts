import { describe, it, expect } from 'vitest';
import { parallelSignalsRule } from '../rules/parallelSignals';
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

describe('parallelSignalsRule', () => {
  it('flags a large broadcast as parallel-broadcast-large', () => {
    const plan = buildPlan({ id: 0, operation: 'PX SEND BROADCAST', pqDistrib: 'BROADCAST', rows: 200_000 });
    const findings = parallelSignalsRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'parallel-broadcast-large', severity: 'warning', nodeIds: [0] });
  });

  it('flags a P->S transition as parallel-serial-point', () => {
    const plan = buildPlan({ id: 0, operation: 'BUFFER SORT', inOut: 'P->S' });
    const findings = parallelSignalsRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('parallel-serial-point');
  });

  it('does not flag PX SEND QC as a serial point', () => {
    const plan = buildPlan({ id: 0, operation: 'PX SEND QC (RANDOM)', inOut: 'P->S' });
    expect(parallelSignalsRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('flags dop-downgrade as a plan-level finding with empty nodeIds', () => {
    const plan = buildPlan(
      { id: 0, operation: 'SELECT STATEMENT' },
      { monitorMetadata: { pxServersRequested: 8, pxServersAllocated: 4 } },
    );
    const findings = parallelSignalsRule.evaluate(makeCtx(plan));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'dop-downgrade', severity: 'warning', nodeIds: [] });
  });

  it('does not flag dop-downgrade when allocated meets requested', () => {
    const plan = buildPlan(
      { id: 0, operation: 'SELECT STATEMENT' },
      { monitorMetadata: { pxServersRequested: 8, pxServersAllocated: 8 } },
    );
    expect(parallelSignalsRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });

  it('returns no findings for a plain serial plan', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL' });
    expect(parallelSignalsRule.evaluate(makeCtx(plan))).toHaveLength(0);
  });
});
