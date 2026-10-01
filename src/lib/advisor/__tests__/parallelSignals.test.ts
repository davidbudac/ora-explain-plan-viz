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

  describe('serialization points (P->S)', () => {
    it('flags a non-QC P->S send such as PX SEND 1 SLAVE, with its row count', () => {
      const plan = buildPlan({ id: 0, operation: 'PX SEND 1 SLAVE', inOut: 'P->S', actualRows: 5000 });
      const findings = parallelSignalsRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0].ruleId).toBe('parallel-serial-point');
      expect(findings[0].explanation).toContain((5000).toLocaleString());
    });

    it('infers P->S from PX SEND 1 SLAVE when the plan has no IN-OUT column (SQL Monitor)', () => {
      const plan = buildPlan({ id: 0, operation: 'PX SEND 1 SLAVE' });
      expect(parallelSignalsRule.evaluate(makeCtx(plan)).map((f) => f.ruleId)).toEqual(['parallel-serial-point']);
    });

    it('accepts a spelled-out transition from other sources', () => {
      const plan = buildPlan({ id: 0, operation: 'SORT ORDER BY', inOut: 'PARALLEL_TO_SERIAL' });
      expect(parallelSignalsRule.evaluate(makeCtx(plan)).map((f) => f.ruleId)).toEqual(['parallel-serial-point']);
    });

    const funnelPlan = (consumer: string, rows: number) => buildPlan({
      id: 0, operation: 'SELECT STATEMENT',
      children: [{
        id: 1, operation: consumer,
        children: [{
          id: 2, operation: 'PX COORDINATOR',
          children: [{ id: 3, operation: 'PX SEND QC (RANDOM)', inOut: 'P->S', actualRows: rows }],
        }],
      }],
    });

    it('flags the QC send when a large row set is then sorted serially above the coordinator', () => {
      const findings = parallelSignalsRule.evaluate(makeCtx(funnelPlan('SORT ORDER BY', 2_000_000)));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ ruleId: 'parallel-serial-point', nodeIds: [3] });
      expect(findings[0].explanation).toContain('SORT ORDER BY');
    });

    it('does not flag a small row set through the coordinator', () => {
      expect(parallelSignalsRule.evaluate(makeCtx(funnelPlan('SORT ORDER BY', 1000)))).toHaveLength(0);
    });

    it('does not flag a large row set when the coordinator only feeds the statement or a SORT AGGREGATE', () => {
      expect(parallelSignalsRule.evaluate(makeCtx(funnelPlan('SORT AGGREGATE', 2_000_000)))).toHaveLength(0);
      const plain = buildPlan({
        id: 0, operation: 'SELECT STATEMENT',
        children: [{ id: 1, operation: 'PX COORDINATOR', children: [{ id: 2, operation: 'PX SEND QC (RANDOM)', inOut: 'P->S', actualRows: 2_000_000 }] }],
      });
      expect(parallelSignalsRule.evaluate(makeCtx(plain))).toHaveLength(0);
    });
  });

  describe('serial feed (S->P)', () => {
    it('flags a serial row source feeding a parallel set as a warning', () => {
      const plan = buildPlan({ id: 0, operation: 'PX SEND BROADCAST', inOut: 'S->P', pqDistrib: 'BROADCAST', rows: 500 });
      const findings = parallelSignalsRule.evaluate(makeCtx(plan));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ ruleId: 'parallel-serial-feed', severity: 'warning', nodeIds: [0] });
      expect(findings[0].explanation).toContain('serial');
    });

    it('does not flag the PX COORDINATOR row itself', () => {
      const plan = buildPlan({ id: 0, operation: 'PX COORDINATOR', inOut: 'S->P' });
      expect(parallelSignalsRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });

    it('does not flag P->P or PCWP rows', () => {
      const plan = buildPlan({
        id: 0, operation: 'PX SEND HASH', inOut: 'P->P',
        children: [{ id: 1, operation: 'TABLE ACCESS FULL', inOut: 'PCWP' }],
      });
      expect(parallelSignalsRule.evaluate(makeCtx(plan))).toHaveLength(0);
    });
  });
});
