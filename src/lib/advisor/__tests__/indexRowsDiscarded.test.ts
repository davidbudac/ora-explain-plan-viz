import { describe, it, expect } from 'vitest';
import { indexRowsDiscardedRule } from '../rules/indexRowsDiscarded';
import { buildPlan, makeBundle, makeIndex, makeTable, makeColumn, ruleCtx, type NodeSpec } from './helpers';

const plan = (indexRows: number, tableRows: number, filter = '"E"."STATUS"=\'OPEN\''): NodeSpec => ({
  id: 0, operation: 'SELECT STATEMENT', children: [{
    id: 1, operation: 'TABLE ACCESS BY INDEX ROWID BATCHED', objectName: 'ORDERS', filterPredicates: filter,
    actualRows: tableRows, starts: 1, children: [
      { id: 2, operation: 'INDEX RANGE SCAN', objectName: 'ORD_CUST_IDX', accessPredicates: '"E"."CUST_ID"=:1', actualRows: indexRows, starts: 1 },
    ],
  }],
});

describe('indexRowsDiscardedRule', () => {
  it('flags a table access that discards most of what the index returned and names the filter column', () => {
    const findings = indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(500_000, 100))));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ ruleId: 'index-rows-discarded', severity: 'warning', nodeIds: [1, 2] });
    expect(findings[0].explanation).toContain('500,000');
    expect(findings[0].explanation).toContain('100');
    expect(findings[0].suggestion).toContain('STATUS');
    expect(findings[0].suggestion).toContain('ORD_CUST_IDX');
  });

  it('is critical when a million or more rows are discarded', () => {
    const findings = indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(2_000_000, 10))));
    expect(findings[0].severity).toBe('critical');
  });

  it('needs a 10x ratio', () => {
    expect(indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(50_000, 20_000))))).toHaveLength(0);
  });

  it('needs at least 1,000 discarded rows', () => {
    expect(indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(900, 1))))).toHaveLength(0);
  });

  it('needs a filter predicate on the table access', () => {
    expect(indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(500_000, 100, ''))))).toHaveLength(0);
  });

  it('ignores bind names and literals when naming filter columns', () => {
    const findings = indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(500_000, 100, '"E"."STATUS"=:B1 AND "E"."KIND"=\'X_Y\''))));
    expect(findings[0].suggestion).toContain('STATUS, KIND');
    expect(findings[0].suggestion).not.toContain('B1');
  });

  it('skips filter columns the index already has when a bundle is attached', () => {
    const bundle = makeBundle({
      'S.ORDERS': makeTable({}, { CUST_ID: makeColumn(), STATUS: makeColumn() }, ['S.ORD_CUST_IDX']),
      'S.ORD_CUST_IDX': makeIndex('S.ORDERS', ['CUST_ID', 'REGION']),
    });
    const findings = indexRowsDiscardedRule.evaluate(ruleCtx(buildPlan(plan(500_000, 100, '"E"."REGION"=\'EU\' AND "E"."STATUS"=\'OPEN\'')), bundle));
    expect(findings[0].suggestion).toContain('Add STATUS to');
    expect(findings[0].suggestion).not.toContain('REGION');
  });

  it('is gated by requiresActualStats', () => {
    expect(indexRowsDiscardedRule.requiresActualStats).toBe(true);
  });
});
