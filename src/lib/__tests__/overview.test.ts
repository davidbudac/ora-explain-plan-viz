import { describe, expect, it } from 'vitest';
import { buildOverview, truncateWhy, OVERVIEW_WHY_MAX } from '../overview';
import { runAdvisor } from '../advisor';
import type { AdvisorReport, Finding } from '../advisor';
import { buildPlan } from '../advisor/__tests__/helpers';
import type { ParsedPlan } from '../types';

function finding(overrides: Partial<Finding> & Pick<Finding, 'ruleId'>): Finding {
  return {
    severity: 'warning',
    nodeIds: [],
    title: overrides.ruleId,
    explanation: 'Something happened.',
    suggestion: '',
    ...overrides,
  };
}

function reportOf(findings: Finding[]): AdvisorReport {
  return {
    findings,
    findingsByNodeId: new Map(),
    counts: { info: 0, warning: 0, critical: 0 },
    maxSeverityByNodeId: new Map(),
  };
}

/** SELECT > HASH JOIN > two scans; no actual stats. */
function estimateOnlyPlan(): ParsedPlan {
  return buildPlan({
    id: 0,
    operation: 'SELECT STATEMENT',
    children: [
      {
        id: 1,
        operation: 'HASH JOIN',
        children: [
          { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 100 },
          { id: 3, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', rows: 10 },
        ],
      },
    ],
  }, { hasActualStats: false });
}

const NO_BUNDLE = { hasBundle: false, hottestNodeId: null };

describe('buildOverview', () => {
  it('returns nothing for a null plan or when nothing is notable', () => {
    expect(buildOverview(null, null, NO_BUNDLE)).toEqual([]);
    expect(buildOverview(estimateOnlyPlan(), reportOf([]), NO_BUNDLE)).toEqual([]);
  });

  it('ranks findings by severity, then engine order, and keeps the top three', () => {
    const plan = estimateOnlyPlan();
    const report = reportOf([
      finding({ ruleId: 'a-info', severity: 'info', nodeIds: [2] }),
      finding({ ruleId: 'b-warn', severity: 'warning', nodeIds: [3] }),
      finding({ ruleId: 'c-crit', severity: 'critical', nodeIds: [1] }),
      finding({ ruleId: 'd-warn', severity: 'warning', nodeIds: [2] }),
    ]);
    const items = buildOverview(plan, report, NO_BUNDLE);
    expect(items.map((i) => i.title)).toEqual(['c-crit', 'b-warn', 'd-warn']);
    expect(items.every((i) => i.kind === 'finding')).toBe(true);
  });

  it('describes the affected operation and focuses the first node', () => {
    const plan = estimateOnlyPlan();
    const [item] = buildOverview(plan, reportOf([finding({ ruleId: 'x', nodeIds: [2, 3] })]), NO_BUNDLE);
    expect(item.nodeId).toBe(2);
    expect(item.nodeLabel).toBe('#2 TABLE ACCESS FULL EMP +1 more');
  });

  it('keeps plan-level findings without a node to focus', () => {
    const [item] = buildOverview(estimateOnlyPlan(), reportOf([finding({ ruleId: 'plan-notes', severity: 'info' })]), NO_BUNDLE);
    expect(item.nodeId).toBeNull();
    expect(item.nodeLabel).toBeNull();
  });

  it('truncates the explanation to one line', () => {
    const long = 'word '.repeat(100);
    const [item] = buildOverview(estimateOnlyPlan(), reportOf([finding({ ruleId: 'x', explanation: long })]), NO_BUNDLE);
    expect(item.why.length).toBeLessThanOrEqual(OVERVIEW_WHY_MAX);
    expect(item.why.endsWith('…')).toBe(true);
    expect(truncateWhy('short  text\nhere')).toBe('short text here');
  });

  it('offers metadata only for stats/index findings and only without a bundle', () => {
    const report = reportOf([
      finding({ ruleId: 'cardinality-mismatch', nodeIds: [2], explanation: 'Gather fresh statistics on EMP.' }),
      finding({ ruleId: 'spill-to-disk', nodeIds: [3], explanation: 'Sort spilled to temp.' }),
    ]);
    const without = buildOverview(estimateOnlyPlan(), report, NO_BUNDLE);
    expect(without.map((i) => i.needsMetadata)).toEqual([true, false]);
    const withBundle = buildOverview(estimateOnlyPlan(), report, { hasBundle: true, hottestNodeId: null });
    expect(withBundle.every((i) => !i.needsMetadata)).toBe(true);
  });

  describe('fallbacks with actual stats', () => {
    function actualPlan(): ParsedPlan {
      const plan = buildPlan({
        id: 0,
        operation: 'SELECT STATEMENT',
        actualRows: 10,
        children: [
          {
            id: 1,
            operation: 'HASH JOIN',
            rows: 10,
            actualRows: 10,
            starts: 1,
            children: [
              { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 10, actualRows: 5000, starts: 1 },
              { id: 3, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', rows: 10, actualRows: 10, starts: 1 },
            ],
          },
        ],
      });
      plan.allNodes.find((n) => n.id === 3)!.selfTime = 900;
      plan.allNodes.find((n) => n.id === 2)!.selfTime = 100;
      return plan;
    }

    it('tops up with the hottest operation and the worst mismatch', () => {
      const items = buildOverview(actualPlan(), reportOf([]), { hasBundle: false, hottestNodeId: 3 });
      expect(items.map((i) => [i.kind, i.nodeId])).toEqual([['hotspot', 3], ['mismatch', 2]]);
      expect(items[0].nodeLabel).toBe('#3 TABLE ACCESS FULL DEPT');
      expect(items[1].needsMetadata).toBe(true);
    });

    it('de-duplicates by node against findings', () => {
      const report = reportOf([finding({ ruleId: 'cardinality-mismatch', nodeIds: [2] })]);
      const items = buildOverview(actualPlan(), report, { hasBundle: false, hottestNodeId: 2 });
      // Node 2 is already covered by the finding: no hotspot for it, no mismatch item either.
      expect(items.map((i) => i.kind)).toEqual(['finding']);
    });

    it('skips the mismatch fallback when a cardinality finding names the root cause (ancestors only inherit it)', () => {
      const plan = buildPlan({
        id: 0,
        operation: 'SELECT STATEMENT',
        actualRows: 5000,
        children: [
          {
            id: 2,
            operation: 'NESTED LOOPS',
            rows: 10,
            actualRows: 5000,
            starts: 1,
            children: [{ id: 4, operation: 'TABLE ACCESS FULL', objectName: 'T', rows: 10, actualRows: 5000, starts: 1 }],
          },
        ],
      });
      const report = reportOf([finding({ ruleId: 'cardinality-mismatch', severity: 'critical', nodeIds: [4] })]);
      const items = buildOverview(plan, report, NO_BUNDLE);
      expect(items.map((i) => [i.kind, i.nodeId])).toEqual([['finding', 4]]);
    });

    it('still falls back to the worst mismatch when the findings are about something else', () => {
      const report = reportOf([finding({ ruleId: 'spill-to-disk', nodeIds: [3] })]);
      const items = buildOverview(actualPlan(), report, NO_BUNDLE);
      expect(items.map((i) => i.kind)).toEqual(['finding', 'mismatch']);
    });

    it('does not top up when three findings fill the card', () => {
      const report = reportOf([1, 2, 3].map((n) => finding({ ruleId: `r${n}`, nodeIds: [n] })));
      const items = buildOverview(actualPlan(), report, { hasBundle: false, hottestNodeId: 3 });
      expect(items).toHaveLength(3);
      expect(items.every((i) => i.kind === 'finding')).toBe(true);
    });

    it('skips the hotspot when hotspots are disabled (null) but still reports the mismatch', () => {
      const items = buildOverview(actualPlan(), reportOf([]), NO_BUNDLE);
      expect(items.map((i) => i.kind)).toEqual(['mismatch']);
    });

    it('works with the real advisor report', () => {
      const plan = actualPlan();
      const items = buildOverview(plan, runAdvisor(plan, null), { hasBundle: false, hottestNodeId: 3 });
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThanOrEqual(3);
    });
  });
});
