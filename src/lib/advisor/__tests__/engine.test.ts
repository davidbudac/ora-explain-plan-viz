import { describe, it, expect } from 'vitest';
import { runAdvisor } from '../engine';
import { DEFAULT_THRESHOLDS } from '../config';
import { ALL_RULES } from '../rules';
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
    // An always-firing probe: only the engine's gate can suppress it.
    const probe = {
      id: 'probe-metadata',
      requiresMetadata: true,
      evaluate: () => [{ ruleId: 'probe-metadata', severity: 'info', nodeIds: [0], title: 'probe', explanation: '', suggestion: '' }],
    };
    const plan = buildPlan({ id: 0, operation: 'TABLE ACCESS FULL', objectName: 'EMPLOYEES' });
    ALL_RULES.push(probe as never);
    try {
      expect(runAdvisor(plan, null, { ...DEFAULT_THRESHOLDS }).findings.some((f) => f.ruleId === 'probe-metadata')).toBe(false);
      const withBundle = runAdvisor(plan, makeBundle({ 'HR.EMPLOYEES': makeTable({ stale_stats: 'YES' }) }), { ...DEFAULT_THRESHOLDS });
      expect(withBundle.findings.some((f) => f.ruleId === 'probe-metadata')).toBe(true);
      expect(withBundle.findings.some((f) => f.ruleId === 'stats-issues')).toBe(true);
    } finally {
      ALL_RULES.pop();
    }
  });

  it('gates requiresActualStats rules when plan has no actual stats', () => {
    // A 20x mismatch that cardinality-mismatch reports once the plan claims actual stats.
    const spec = { id: 0, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 2000, starts: 1 };
    expect(runAdvisor(buildPlan(spec), null).findings.some((f) => f.ruleId === 'cardinality-mismatch')).toBe(true);
    const gated = runAdvisor(buildPlan(spec, { hasActualStats: false }), null);
    expect(gated.findings.some((f) => f.ruleId === 'cardinality-mismatch')).toBe(false);
  });

  it('declares the expected data requirements for every rule', () => {
    const expected: Record<string, { actualStats?: true; metadata?: true }> = {
      'implicit-conversion': {},
      'nested-loop-volume': { actualStats: true },
      'merge-join-cartesian': {},
      'selective-full-scan': {},
      'index-exists-unused': { metadata: true },
      'cardinality-mismatch': { actualStats: true },
      'spill-to-disk': {},
      'stats-issues': { metadata: true },
      'partition-no-pruning': {},
      'parallel-signals': {},
      'per-row-reexecution': { actualStats: true },
      'index-rows-discarded': { actualStats: true },
      'buffer-gets-per-row': { actualStats: true },
      'plan-notes': {},
      'function-on-indexed-column': { metadata: true },
      'hash-join-build-side': {},
      'px-skew': {},
    };
    const actual = Object.fromEntries(ALL_RULES.map((r) => [r.id, {
      ...(r.requiresActualStats ? { actualStats: true } : {}),
      ...(r.requiresMetadata ? { metadata: true } : {}),
    }]));
    expect(actual).toEqual(expected);
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

  describe('inactive adaptive-plan rows', () => {
    const adaptivePlan = () => buildPlan({
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        // inactive (unused alternative): would be a critical cardinality mismatch and a spill
        { id: 1, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 50_000, tempUsed: DEFAULT_THRESHOLDS.spillCriticalBytes, inactive: true },
        // active and equally bad
        { id: 2, operation: 'TABLE ACCESS FULL', rows: 100, actualRows: 50_000 },
      ],
    });

    it('produces no findings for inactive nodes', () => {
      const report = runAdvisor(adaptivePlan(), null);
      expect(report.findingsByNodeId.has(1)).toBe(false);
      expect(report.findings.some((f) => f.nodeIds.includes(1))).toBe(false);
      expect(report.findingsByNodeId.get(2)?.length).toBeGreaterThan(0);
    });

    it('hands rules a plan without inactive nodes', () => {
      const seen: number[][] = [];
      const rule = { id: 'probe', evaluate: (ctx: { plan: { allNodes: Array<{ id: number }> } }) => { seen.push(ctx.plan.allNodes.map((n) => n.id)); return []; } };
      ALL_RULES.push(rule as never);
      try {
        runAdvisor(adaptivePlan(), null, { ...DEFAULT_THRESHOLDS });
      } finally {
        ALL_RULES.pop();
      }
      expect(seen).toEqual([[0, 2]]);
    });

    it('drops a finding that points only at an inactive node and strips inactive ids from mixed ones', () => {
      const rule = {
        id: 'probe',
        evaluate: () => [
          { ruleId: 'probe', severity: 'info', nodeIds: [1], title: 'only inactive', explanation: '', suggestion: '' },
          { ruleId: 'probe', severity: 'info', nodeIds: [1, 2], title: 'mixed', explanation: '', suggestion: '' },
          { ruleId: 'probe', severity: 'info', nodeIds: [], title: 'plan level', explanation: '', suggestion: '' },
        ],
      };
      ALL_RULES.push(rule as never);
      try {
        const report = runAdvisor(adaptivePlan(), null, { ...DEFAULT_THRESHOLDS });
        const titles = report.findings.filter((f) => f.ruleId === 'probe').map((f) => f.title).sort();
        expect(titles).toEqual(['mixed', 'plan level']);
        expect(report.findings.find((f) => f.title === 'mixed')?.nodeIds).toEqual([2]);
      } finally {
        ALL_RULES.pop();
      }
    });
  });
});
