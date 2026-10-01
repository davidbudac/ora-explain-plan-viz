import { describe, it, expect } from 'vitest';
import { hashJoinBuildSideRule } from '../rules/hashJoinBuildSide';
import { buildPlan, ruleCtx, type NodeSpec } from './helpers';

const evaluate = (spec: NodeSpec) => hashJoinBuildSideRule.evaluate(ruleCtx(buildPlan(spec)));
const join = (build: Partial<NodeSpec>, probe: Partial<NodeSpec>, extra: Partial<NodeSpec> = {}): NodeSpec => ({
  id: 0, operation: 'HASH JOIN', ...extra, children: [
    { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'BIG', ...build },
    { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'SMALL', ...probe },
  ],
});

describe('hashJoinBuildSideRule', () => {
  it('flags a build side 10x+ larger than the probe side (A-Rows) as info', () => {
    const findings = evaluate(join({ actualRows: 5_000_000 }, { actualRows: 50_000 }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'hash-join-build-side', severity: 'info', nodeIds: [0] });
    expect(findings[0].explanation).toContain('5,000,000');
    expect(findings[0].explanation).toContain('A-Rows');
    expect(findings[0].suggestion).toContain('SWAP_JOIN_INPUTS');
  });

  it('is a warning when the join also spills', () => {
    const findings = evaluate(join({ actualRows: 5_000_000 }, { actualRows: 50_000 }, { tempUsed: 64 * 1024 * 1024 }));
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].explanation).toContain('64.0 MB');
  });

  it('falls back to estimates when there are no actual stats', () => {
    const findings = evaluate(join({ rows: 2_000_000 }, { rows: 1_000 }));
    expect(findings).toHaveLength(1);
    expect(findings[0].explanation).toContain('estimated');
  });

  it('ignores a build side under 100,000 rows', () => {
    expect(evaluate(join({ actualRows: 90_000 }, { actualRows: 10 }))).toHaveLength(0);
  });

  it('ignores a build side less than 10x the probe side', () => {
    expect(evaluate(join({ actualRows: 1_000_000 }, { actualRows: 150_000 }))).toHaveLength(0);
  });

  it('ignores the right order (small build, large probe) and non-hash joins', () => {
    expect(evaluate(join({ actualRows: 100 }, { actualRows: 5_000_000 }))).toHaveLength(0);
    expect(evaluate(join({ actualRows: 5_000_000 }, { actualRows: 50 }, { operation: 'MERGE JOIN' }))).toHaveLength(0);
  });

  it('handles hash join variants such as HASH JOIN OUTER', () => {
    expect(evaluate(join({ actualRows: 5_000_000 }, { actualRows: 50_000 }, { operation: 'HASH JOIN OUTER' }))).toHaveLength(1);
  });

  it('skips inactive adaptive-plan children', () => {
    const plan = buildPlan({
      id: 0, operation: 'HASH JOIN', children: [
        { id: 1, operation: 'TABLE ACCESS FULL', actualRows: 5_000_000, inactive: true },
        { id: 2, operation: 'TABLE ACCESS FULL', actualRows: 100 },
        { id: 3, operation: 'TABLE ACCESS FULL', actualRows: 100 },
      ],
    });
    expect(hashJoinBuildSideRule.evaluate(ruleCtx(plan))).toHaveLength(0);
  });
});
