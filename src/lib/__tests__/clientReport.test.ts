import { describe, it, expect } from 'vitest';
import {
  buildClientReport,
  clientReportFilename,
  DEFAULT_REPORT_SECTIONS,
  escapeHtml,
  type ClientReportInput,
  type ClientReportOptions,
} from '../clientReport';
import type { ParsedPlan, PlanNode } from '../types';
import { createEmptyAnnotationState, type AnnotationState } from '../annotations';
import type { AdvisorReport, Finding } from '../advisor';

function makeNode(partial: Partial<PlanNode> & { id: number }): PlanNode {
  return {
    depth: 0,
    operation: 'OPERATION',
    children: [],
    ...partial,
  };
}

function makePlan(overrides: Partial<ParsedPlan> = {}): ParsedPlan {
  const child = makeNode({
    id: 1,
    depth: 1,
    operation: 'TABLE ACCESS FULL',
    objectName: 'ORDERS',
    rows: 100,
    actualRows: 5000,
    cost: 40,
    actualTime: 900,
    selfTime: 900,
    starts: 1,
    parentId: 0,
    accessPredicates: '"O"."STATUS"=\'OPEN\' AND "O"."ID">10',
  });
  const root = makeNode({
    id: 0,
    operation: 'SELECT STATEMENT',
    cost: 42,
    actualRows: 5000,
    actualTime: 1000,
    selfTime: 100,
    children: [child],
  });
  return {
    rootNode: root,
    allNodes: [root, child],
    totalCost: 42,
    maxRows: 100,
    source: 'sql_monitor_text',
    hasActualStats: true,
    sqlId: 'abc123def456',
    planHashValue: '987654321',
    sqlText: 'SELECT * FROM orders WHERE status = :1',
    totalElapsedTime: 1000,
    ...overrides,
  };
}

function makeInput(overrides: Partial<ClientReportInput> = {}): ClientReportInput {
  return {
    plan: makePlan(),
    rawPlanText: '| Id | Operation | ... raw plan text ... |',
    annotations: createEmptyAnnotationState(),
    advisorReport: null,
    hottestNodeId: 1,
    sourceLabel: 'SQL Monitor (Text)',
    generatedAt: new Date('2026-08-26T12:00:00Z'),
    ...overrides,
  };
}

function makeOptions(overrides: Partial<ClientReportOptions> = {}): ClientReportOptions {
  return {
    title: 'Order Query Documentation',
    sections: { ...DEFAULT_REPORT_SECTIONS },
    ...overrides,
  };
}

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml(`<script>alert("x&y")</script>'`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;'
    );
  });
});

describe('buildClientReport', () => {
  it('produces a complete standalone HTML document', () => {
    const html = buildClientReport(makeInput(), makeOptions());
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>Order Query Documentation</title>');
    expect(html).toContain('Execution Plan');
    expect(html).toContain('TABLE ACCESS FULL');
    expect(html).toContain('ORDERS');
    // no external resources — the document must be fully self-contained
    expect(html).not.toMatch(/src="http|href="http/);
  });

  it('shows header metadata: SQL ID, plan hash, date', () => {
    const html = buildClientReport(makeInput(), makeOptions());
    expect(html).toContain('abc123def456');
    expect(html).toContain('987654321');
    expect(html).toContain('2026-08-26');
  });

  it('has no executive summary section', () => {
    const html = buildClientReport(makeInput(), makeOptions());
    expect(html).not.toContain('Executive Summary');
  });

  it('includes node annotations, highlights and groups', () => {
    const annotations: AnnotationState = createEmptyAnnotationState();
    annotations.nodeAnnotations.set(1, {
      nodeId: 1,
      text: 'This full scan reads 5000 rows to return 12 — add an index on STATUS.',
      createdAt: '2026-08-26T10:00:00Z',
      updatedAt: '2026-08-26T10:00:00Z',
    });
    annotations.nodeHighlights.set(1, { nodeId: 1, color: 'red' });
    annotations.groups.push({
      id: 'g1',
      name: 'Problem area',
      nodeIds: [1],
      color: 'orange',
      note: 'The expensive part of the plan.',
    });

    const html = buildClientReport(makeInput({ annotations }), makeOptions());
    expect(html).toContain('Consultant Notes');
    expect(html).toContain('add an index on STATUS');
    expect(html).toContain('Problem area');
    expect(html).toContain('The expensive part of the plan.');
    // the note marker also appears inline in the plan table
    expect(html).toContain('note-row');
  });

  it('escapes HTML in user-provided notes and SQL text', () => {
    const annotations = createEmptyAnnotationState();
    annotations.nodeAnnotations.set(1, {
      nodeId: 1,
      text: '<img src=x onerror=alert(1)>',
      createdAt: '2026-08-26T10:00:00Z',
      updatedAt: '2026-08-26T10:00:00Z',
    });
    const plan = makePlan({ sqlText: 'SELECT 1 FROM t WHERE a < 2 AND b > 3' });
    const html = buildClientReport(makeInput({ annotations, plan }), makeOptions());
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('a &lt; 2 AND b &gt; 3');
  });

  it('includes advisor findings with severity and recommendation', () => {
    const finding: Finding = {
      ruleId: 'cardinality-mismatch',
      severity: 'critical',
      nodeIds: [1],
      title: 'Large cardinality misestimate',
      explanation: 'The optimizer expected 100 rows but 5000 were produced.',
      suggestion: 'Gather fresh statistics on ORDERS.',
    };
    const advisorReport: AdvisorReport = {
      findings: [finding],
      findingsByNodeId: new Map([[1, [finding]]]),
      counts: { critical: 1, warning: 0, info: 0 },
      maxSeverityByNodeId: new Map([[1, 'critical']]),
    };
    const html = buildClientReport(makeInput({ advisorReport }), makeOptions());
    expect(html).toContain('Automated Findings');
    expect(html).toContain('Large cardinality misestimate');
    expect(html).toContain('Critical');
    // findings state facts only — suggestions/recommendations are not included
    expect(html).not.toContain('Gather fresh statistics on ORDERS.');
    expect(html).not.toContain('Recommendation');
  });

  it('marks the hottest node and reports hotspots and cardinality mismatches', () => {
    const html = buildClientReport(makeInput(), makeOptions());
    expect(html).toContain('Hotspot');
    expect(html).toContain('Where the Time Went');
    expect(html).toContain('Optimizer Estimate Accuracy');
    // 5000 actual vs 100 estimated = 50x over
    expect(html).toContain('50.0x over');
  });

  it('omits sections that are toggled off', () => {
    const options = makeOptions();
    options.sections = { ...options.sections, rawPlan: false, predicates: false, findings: false };
    const html = buildClientReport(makeInput(), options);
    expect(html).not.toContain('Appendix: Raw Plan');
    expect(html).not.toContain('raw plan text');
    expect(html).not.toContain('>Predicates<');
  });

  it('omits actual-stats sections for estimate-only plans', () => {
    const plan = makePlan({ hasActualStats: false, totalElapsedTime: undefined, source: 'dbms_xplan' });
    for (const node of plan.allNodes) {
      node.actualRows = undefined;
      node.actualTime = undefined;
      node.selfTime = undefined;
      node.starts = undefined;
    }
    const html = buildClientReport(makeInput({ plan, hottestNodeId: null }), makeOptions());
    expect(html).not.toContain('Where the Time Went');
    expect(html).not.toContain('Optimizer Estimate Accuracy');
    expect(html).not.toContain('A-Rows');
  });

  it('includes environment details and bind variables when present', () => {
    const plan = makePlan({
      monitorMetadata: {
        status: 'DONE (ALL ROWS)',
        user: 'APP_USER',
        module: 'JDBC Thin Client',
        dbVersion: '19.0.0.0.0',
        duration: 2,
        cpuTime: 1_500_000,
        userIoWaitTime: 400_000,
      },
      bindVariables: [{ name: ':1', type: 'VARCHAR2', value: 'OPEN' }],
    });
    const html = buildClientReport(makeInput({ plan }), makeOptions());
    expect(html).toContain('Execution environment');
    expect(html).toContain('APP_USER');
    expect(html).toContain('19.0.0.0.0');
    expect(html).toContain('Database time breakdown');
    expect(html).toContain('Bind variables');
    expect(html).toContain('VARCHAR2');
    expect(html).toContain('OPEN');
  });

  it('renders plan-note tags in the execution details', () => {
    const plan = makePlan({
      notes: {
        rawLines: [],
        dynamicSampling: true,
        dynamicSamplingLevel: 2,
        adaptivePlan: true,
        sqlProfile: 'my_profile',
      },
    });
    const html = buildClientReport(makeInput({ plan }), makeOptions());
    expect(html).toContain('Dynamic sampling (level 2)');
    expect(html).toContain('Adaptive plan');
    expect(html).toContain('SQL profile &quot;my_profile&quot;');
  });
});

describe('clientReportFilename', () => {
  it('uses sql id and plan hash when available', () => {
    expect(clientReportFilename(makePlan())).toBe('abc123def456-987654321-report.html');
  });

  it('falls back to a generic name', () => {
    const plan = makePlan({ sqlId: undefined, planHashValue: undefined });
    expect(clientReportFilename(plan)).toBe('plan-report.html');
  });
});
