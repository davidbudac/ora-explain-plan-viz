import { describe, it, expect } from 'vitest';
import { bufferEfficiencyRule } from '../rules/bufferEfficiency';
import { buildPlan, ruleCtx, type NodeSpec } from './helpers';

const evaluate = (spec: NodeSpec) => bufferEfficiencyRule.evaluate(ruleCtx(buildPlan(spec)));

describe('bufferEfficiencyRule', () => {
  it('flags an access operation with very many self buffer gets per returned row', () => {
    const findings = evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        { id: 1, operation: 'INDEX RANGE SCAN', objectName: 'IDX', actualRows: 50, starts: 1, logicalReads: 20_000 },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'buffer-gets-per-row', severity: 'warning', nodeIds: [1] });
    expect(findings[0].explanation).toContain('400 buffer gets per returned row');
  });

  it('uses self buffers: gets already counted in the children do not count against the parent', () => {
    // Parent total 1,000,000 but 999,990 of it is the child scan; the parent itself only did 10.
    const findings = evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [{
        id: 1, operation: 'TABLE ACCESS BY INDEX ROWID', objectName: 'T', actualRows: 100, starts: 1, logicalReads: 1_000_000, children: [
          { id: 2, operation: 'INDEX RANGE SCAN', objectName: 'IDX', actualRows: 100, starts: 1, logicalReads: 999_990 },
        ],
      }],
    });
    // The child scan does 9,999 gets per row: flagged; the parent is not.
    expect(findings.map((f) => f.nodeIds[0])).toEqual([2]);
  });

  it('is critical from a million self gets', () => {
    const findings = evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        { id: 1, operation: 'INDEX RANGE SCAN', actualRows: 100, starts: 1, logicalReads: 2_000_000 },
      ],
    });
    expect(findings[0].severity).toBe('critical');
  });

  it('flags repeated probes that each read many blocks for few rows', () => {
    const findings = evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        // 100 starts x 2,000 gets, 5 rows per start: 20 gets per row (below the per-row bar) but 2,000 per start.
        { id: 1, operation: 'INDEX RANGE SCAN', actualRows: 500, starts: 100, logicalReads: 200_000 },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('per start');
  });

  it('stays quiet on a healthy index probe loop', () => {
    expect(evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        { id: 1, operation: 'INDEX RANGE SCAN', actualRows: 100_000, starts: 20_000, logicalReads: 100_000 },
      ],
    })).toHaveLength(0);
  });

  it('stays quiet below the minimum self gets', () => {
    expect(evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        { id: 1, operation: 'INDEX RANGE SCAN', actualRows: 1, starts: 1, logicalReads: 5_000 },
      ],
    })).toHaveLength(0);
  });

  it('leaves full scans to selective-full-scan', () => {
    expect(evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [
        { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'T', actualRows: 1, starts: 1, logicalReads: 5_000_000 },
      ],
    })).toHaveLength(0);
  });

  it('leaves rows-discarded-after-index table accesses to index-rows-discarded', () => {
    expect(evaluate({
      id: 0, operation: 'SELECT STATEMENT', children: [{
        id: 1, operation: 'TABLE ACCESS BY INDEX ROWID', objectName: 'T', filterPredicates: '"T"."A"=1',
        actualRows: 10, starts: 1, logicalReads: 500_000 + 3_000, children: [
          { id: 2, operation: 'INDEX RANGE SCAN', actualRows: 500_000, starts: 1, logicalReads: 3_000 },
        ],
      }],
    })).toHaveLength(0);
  });

  it('is gated by requiresActualStats', () => {
    expect(bufferEfficiencyRule.requiresActualStats).toBe(true);
  });
});
