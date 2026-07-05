import { describe, it, expect } from 'vitest';
import { runAdvisor } from '../engine';
import { DEFAULT_THRESHOLDS } from '../config';
import { buildPlan, makeBundle, makeTable } from './helpers';

describe('runAdvisor', () => {
  it('sorts findings critical -> warning -> info, then by nodeIds[0]', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        // node 1: cardinality warning (3x)
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 300 },
        // node 2: spill critical
        { id: 2, operation: 'SORT ORDER BY', tempUsed: DEFAULT_THRESHOLDS.spillCriticalBytes },
        // node 3: cardinality critical (20x)
        { id: 3, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 2000 },
      ],
    });
    const report = runAdvisor(plan, null);
    expect(report.findings.length).toBeGreaterThan(0);
    for (let i = 1; i < report.findings.length; i++) {
      const rank = (s: string) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2);
      expect(rank(report.findings[i - 1].severity)).toBeLessThanOrEqual(rank(report.findings[i].severity));
    }
  });

  it('builds findingsByNodeId and maxSeverityByNodeId correctly', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 2000 }, // critical cardinality
      ],
    });
    const report = runAdvisor(plan, null);
    expect(report.findingsByNodeId.get(1)?.length).toBeGreaterThan(0);
    expect(report.maxSeverityByNodeId.get(1)).toBe('critical');
  });

  it('computes counts per severity', () => {
    const plan = buildPlan({
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 300 }, // warning
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 2000 }, // critical
      ],
    });
    const report = runAdvisor(plan, null);
    expect(report.counts.critical).toBeGreaterThanOrEqual(1);
    expect(report.counts.warning).toBeGreaterThanOrEqual(1);
    expect(report.counts.critical + report.counts.warning + report.counts.info).toBe(report.findings.length);
  });

  it('gates requiresMetadata rules when bundle is null', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }),
    });
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });

    const withoutBundle = runAdvisor(plan, null);
    expect(withoutBundle.findings.some((f) => f.ruleId === 'stats-issues')).toBe(false);

    const withBundle = runAdvisor(plan, bundle, { ...DEFAULT_THRESHOLDS });
    expect(withBundle.findings.some((f) => f.ruleId === 'stats-issues')).toBe(true);
  });

  it('gates requiresActualStats rules when plan has no actual stats', () => {
    const plan = buildPlan(
      { id: 0, operation: 'TABLE ACCESS FULL', rows: 100 },
      { hasActualStats: false },
    );
    const report = runAdvisor(plan, null);
    expect(report.findings.some((f) => f.ruleId === 'cardinality-mismatch')).toBe(false);
  });

  it('caches by identity: same plan+bundle+thresholds refs return the same report object', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 300 });
    const report1 = runAdvisor(plan, null, DEFAULT_THRESHOLDS);
    const report2 = runAdvisor(plan, null, DEFAULT_THRESHOLDS);
    expect(report1).toBe(report2);
  });

  it('recomputes when bundle reference differs', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    const bundleA = makeBundle({ 'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }) });
    const bundleB = makeBundle({ 'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }) });
    const reportA = runAdvisor(plan, bundleA);
    const reportB = runAdvisor(plan, bundleB);
    expect(reportA).not.toBe(reportB);
  });

  it('recomputes when thresholds reference differs', () => {
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 300 });
    const report1 = runAdvisor(plan, null, DEFAULT_THRESHOLDS);
    const report2 = runAdvisor(plan, null, { ...DEFAULT_THRESHOLDS });
    expect(report1).not.toBe(report2);
  });

  it('never throws when nodes are missing optional fields', () => {
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT', children: [{ id: 1, operation: 'TABLE ACCESS FULL' }] });
    expect(() => runAdvisor(plan, null)).not.toThrow();
  });
});
