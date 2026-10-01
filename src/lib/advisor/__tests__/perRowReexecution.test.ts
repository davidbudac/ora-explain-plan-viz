import { describe, it, expect } from 'vitest';
import { perRowReexecutionRule } from '../rules/perRowReexecution';
import { buildPlan, ruleCtx, type NodeSpec } from './helpers';

const evaluate = (spec: NodeSpec) => perRowReexecutionRule.evaluate(ruleCtx(buildPlan(spec)));

describe('perRowReexecutionRule', () => {
  const filterPlan = (subqueryStarts: number): NodeSpec => ({
    id: 0, operation: 'SELECT STATEMENT', actualRows: 5, starts: 1, children: [{
      id: 1, operation: 'FILTER', actualRows: 5, starts: 1, children: [
        { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', actualRows: 50_000, starts: 1 },
        { id: 3, operation: 'INDEX RANGE SCAN', objectName: 'SAL_IDX', actualRows: 5, starts: subqueryStarts },
      ],
    }],
  });

  it('flags a FILTER whose subquery side runs once per row', () => {
    const findings = evaluate(filterPlan(50_000));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'per-row-reexecution', severity: 'warning', nodeIds: [1] });
    expect(findings[0].explanation).toContain('50,000');
    expect(findings[0].explanation).toContain('operation 3');
  });

  it('escalates to critical at the critical starts tier', () => {
    expect(evaluate(filterPlan(100_000))[0].severity).toBe('critical');
  });

  it('ignores a FILTER whose subquery runs a few times', () => {
    expect(evaluate(filterPlan(50))).toHaveLength(0);
  });

  it('ignores a FILTER with a single child (a plain post-filter)', () => {
    expect(evaluate({
      id: 0, operation: 'FILTER', children: [{ id: 1, operation: 'TABLE ACCESS FULL', actualRows: 1_000_000, starts: 1_000_000 }],
    })).toHaveLength(0);
  });

  it('flags scalar subqueries that precede the main row source under the statement root', () => {
    const findings = evaluate({
      id: 0, operation: 'SELECT STATEMENT', actualRows: 20_000, starts: 1, children: [
        { id: 1, operation: 'SORT AGGREGATE', actualRows: 20_000, starts: 20_000, children: [
          { id: 2, operation: 'INDEX RANGE SCAN', actualRows: 20_000, starts: 20_000 },
        ] },
        { id: 3, operation: 'TABLE ACCESS FULL', objectName: 'ORDERS', actualRows: 20_000, starts: 1 },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].nodeIds).toEqual([1]);
    expect(findings[0].title).toContain('Scalar subquery');
    expect(findings[0].explanation).toContain('20,000');
  });

  it('does not treat the main row source as a scalar subquery', () => {
    expect(evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [{ id: 1, operation: 'TABLE ACCESS FULL', actualRows: 1_000_000, starts: 1_000_000 }],
    })).toHaveLength(0);
  });

  describe('remote operations', () => {
    const remotePlan = (starts: number, nlRows = 10): NodeSpec => ({
      id: 0, operation: 'SELECT STATEMENT', children: [{
        id: 1, operation: 'NESTED LOOPS', actualRows: nlRows, starts: 1, children: [
          { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'LOCAL_T', actualRows: starts, starts: 1 },
          { id: 3, operation: 'REMOTE', objectName: 'REMOTE_T', actualRows: nlRows, starts },
        ],
      }],
    });

    it('flags a REMOTE on a nested-loop inner side at a low starts threshold', () => {
      const findings = evaluate(remotePlan(200));
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ severity: 'warning', nodeIds: [3] });
      expect(findings[0].explanation).toContain('round trip');
    });

    it('is critical from 1,000 starts', () => {
      expect(evaluate(remotePlan(1_000))[0].severity).toBe('critical');
    });

    it('stays quiet below the remote threshold', () => {
      expect(evaluate(remotePlan(20))).toHaveLength(0);
    });

    it('does not flag a REMOTE read once', () => {
      expect(evaluate({ id: 0, operation: 'SELECT STATEMENT', children: [{ id: 1, operation: 'REMOTE', actualRows: 1_000_000, starts: 1 }] })).toHaveLength(0);
    });

    it('flags a REMOTE under a FILTER subquery and not the FILTER itself', () => {
      const findings = evaluate({
        id: 0, operation: 'SELECT STATEMENT', children: [{
          id: 1, operation: 'FILTER', starts: 1, children: [
            { id: 2, operation: 'TABLE ACCESS FULL', actualRows: 50_000, starts: 1 },
            { id: 3, operation: 'REMOTE', actualRows: 1, starts: 50_000 },
          ],
        }],
      });
      expect(findings).toHaveLength(1);
      expect(findings[0].nodeIds).toEqual([3]);
      expect(findings[0].severity).toBe('critical');
    });

    it('leaves a high-volume nested loop to nested-loop-volume', () => {
      // The NL itself is flagged by nested-loop-volume (which mentions the remote side); no second finding here.
      expect(evaluate(remotePlan(100_000, 1_000_000))).toHaveLength(0);
    });
  });

  it('is gated by requiresActualStats', () => {
    expect(perRowReexecutionRule.requiresActualStats).toBe(true);
  });
});
