import { describe, it, expect } from 'vitest';
import { findObjectInBundle } from '../../metadata/lookup';
import { statsIssuesRule } from '../rules/statsIssues';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeTable, makeColumn } from './helpers';
import type { RuleContext } from '../types';
import type { MetadataBundle } from '../../metadata/bundle';

function makeCtx(plan: ReturnType<typeof buildPlan>, bundle: MetadataBundle | null): RuleContext {
  return {
    plan,
    bundle,
    thresholds: DEFAULT_THRESHOLDS,
    findObject: (name) => (bundle ? findObjectInBundle(bundle, name) : null),
    usedIndexKeys: new Set(),
  };
}

describe('statsIssuesRule', () => {
  it('flags stale-stats as warning', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }) });
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    const findings = statsIssuesRule.evaluate(makeCtx(plan, bundle));
    expect(findings.some((f) => f.title.includes('stale stats') && f.severity === 'warning')).toBe(true);
  });

  it('flags missing-stats as warning', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ last_analyzed: null }) });
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    const findings = statsIssuesRule.evaluate(makeCtx(plan, bundle));
    expect(findings.some((f) => f.title.includes('missing stats') && f.severity === 'warning')).toBe(true);
  });

  it('flags mismatch-no-histogram as info', () => {
    const table = makeTable({}, { STATUS: makeColumn({ histogram: { type: 'NONE', buckets: 0 } }) });
    const bundle = makeBundle({ 'HR.EMPLOYEES': table });
    const plan = buildPlan({
      id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES',
      filterPredicates: '"E"."STATUS"=:1', rows: 100, actualRows: 5000,
    }, { hasActualStats: true });
    const findings = statsIssuesRule.evaluate(makeCtx(plan, bundle));
    const mismatch = findings.find((f) => f.title.includes('mismatch no histogram'));
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe('info');
  });

  it('groups multiple nodes referencing the same table under one finding per badge', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }) });
    const plan = buildPlan({
      id: 0, operation: 'SELECT STATEMENT',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' },
        { id: 2, operation: 'TABLE ACCESS BY INDEX ROWID', objectName: 'EMPLOYEES' },
      ],
    });
    const findings = statsIssuesRule.evaluate(makeCtx(plan, bundle));
    const staleFinding = findings.find((f) => f.title.includes('stale stats'));
    expect(staleFinding!.nodeIds.sort()).toEqual([1, 2]);
  });

  it('returns no findings for a healthy table', () => {
    const bundle = makeBundle({ 'HR.EMPLOYEES': makeTable() });
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    expect(statsIssuesRule.evaluate(makeCtx(plan, bundle))).toHaveLength(0);
  });

  it('is gated by requiresMetadata', () => {
    expect(statsIssuesRule.requiresMetadata).toBe(true);
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    expect(statsIssuesRule.evaluate(makeCtx(plan, null))).toHaveLength(0);
  });
});
