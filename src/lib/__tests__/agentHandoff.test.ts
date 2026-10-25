import { describe, expect, it } from 'vitest';
import { buildPlan, byId, makeBundle, makeColumn, makeTable } from '../advisor/__tests__/helpers';
import { createEmptyAnnotationState, type AnnotationState } from '../annotations';
import type { ParsedPlan } from '../types';
import {
  agentHandoffFilename,
  buildAgentHandoff,
  buildHandoffParts,
  HANDOFF_MARKER,
  RAW_PLAN_DEFAULT_MAX_CHARS,
  renderAnnotations,
  type HandoffPlanInput,
  type HandoffSource,
} from '../agentHandoff';

const AT = new Date('2026-10-25T12:00:00Z');

function monitoredPlan(): ParsedPlan {
  const plan = buildPlan(
    {
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        {
          id: 1,
          operation: 'NESTED LOOPS',
          rows: 10,
          actualRows: 80_000,
          starts: 1,
          children: [
            { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'ORDERS', rows: 32, actualRows: 20_000, starts: 1, logicalReads: 4_000, filterPredicates: '"O"."STATUS"=:B1' },
            { id: 3, operation: 'INDEX RANGE SCAN', objectName: 'ITEMS_IX', rows: 4, actualRows: 80_000, starts: 20_000, logicalReads: 60_000, accessPredicates: '"I"."ORDER_ID"="O"."ORDER_ID"' },
          ],
        },
      ],
    },
    { source: 'dbms_xplan', hasActualStats: true },
  );
  plan.sqlId = 'abc123def4567';
  plan.planHashValue = '2058068615';
  plan.sqlText = 'SELECT * FROM orders o JOIN items i ON i.order_id = o.order_id WHERE o.status = :b1';
  plan.bindVariables = [{ name: ':B1', type: 'VARCHAR2(10)', value: "'OPEN'" }];
  return plan;
}

function input(plan: ParsedPlan, overrides: Partial<HandoffPlanInput> = {}): HandoffPlanInput {
  return {
    plan,
    label: 'Plan A',
    rawText: 'Plan hash value: 2058068615\n| Id | Operation |',
    annotations: createEmptyAnnotationState(),
    bundle: null,
    advisorReport: null,
    ...overrides,
  };
}

function handoff(source: HandoffSource, options: Parameters<typeof buildAgentHandoff>[2] = {}) {
  return buildAgentHandoff(source, buildHandoffParts(source), { generatedAt: AT, ...options });
}

function analyze(plan: ParsedPlan = monitoredPlan(), overrides: Partial<HandoffPlanInput> = {}): HandoffSource {
  return { mode: 'analyze', plan: input(plan, overrides) };
}

/** The Markdown between `## title` and the next heading of the same or a higher level. */
function sectionOf(markdown: string, title: string): string {
  const start = markdown.indexOf(`\n${title}\n`);
  if (start < 0) return '';
  const level = title.match(/^#+/)![0].length;
  const rest = markdown.slice(start + title.length + 2).replace(/^\n+/, '');
  const next = rest.search(new RegExp(`\\n#{1,${level}} `));
  return next < 0 ? rest : rest.slice(0, next);
}

describe('buildAgentHandoff (single plan)', () => {
  it('opens with the marker, the statement, the task and the user\'s question', () => {
    const md = handoff(analyze(), { question: 'Why 40 s?\nIt used to take 2 s.' });
    expect(md.startsWith(`${HANDOFF_MARKER}\n`)).toBe(true);
    expect(md).toContain('# Oracle execution plan review: SQL_ID `abc123def4567`, plan hash value `2058068615`');
    expect(md).toContain('Exported from Oracle Plan Visualizer on 2026-10-25 (source format: DBMS_XPLAN)');
    expect(md).toContain('> Why 40 s?\n> It used to take 2 s.');
    expect(md).toContain('If the `oracle-plan-analysis` skill is available');
  });

  it('asks for a general review when no question is given', () => {
    expect(handoff(analyze(), { question: '   ' })).toContain('No specific question: review the statement\'s performance as a whole.');
  });

  it('puts the instructions first and the fenced plan data last', () => {
    const md = handoff(analyze());
    const order = ['## Task', '## Reading the numbers', '## What this handoff contains', '## Asking for more data', '## Answer with', '# Plan data', '## Plan', '## SQL text', '## Predicates', '## Bind variables'];
    const positions = order.map((heading) => md.indexOf(`\n${heading}\n`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);

    const plan = sectionOf(md, '## Plan');
    expect(plan).toMatch(/^```text\nSQL_ID: abc123def4567/);
    expect(plan).toContain('Buffers');
    expect(sectionOf(md, '## SQL text')).toMatch(/^```sql\nSELECT \* FROM orders/);
  });

  it('inventories what is present and says how to get what is missing', () => {
    const contents = sectionOf(handoff(analyze()), '## What this handoff contains');
    expect(contents).toContain('- [x] Runtime statistics (Starts, A-Rows, A-Time, Buffers)');
    expect(contents).toContain('- [x] Predicates (access / filter)');
    expect(contents).toContain('- [x] Bind values (1 bind)');
    expect(contents).toMatch(/- \[ \] Schema metadata .* — not attached\. To get it: .*`@gather_plan_metadata\.sql abc123def4567 2058068615`/);
    expect(contents).toContain('- [ ] Outline / hint report — not available. To get it:');
  });

  it('lists a section the user turned off as withheld and leaves its data out', () => {
    const md = handoff(analyze(), { included: { binds: false } });
    expect(md).not.toContain('## Bind variables');
    expect(md).not.toContain("'OPEN'");
    expect(sectionOf(md, '## What this handoff contains')).toContain('- [ ] Bind values — withheld by the user; ask for it if a conclusion depends on it');
  });

  it('warns about estimates-only plans and says how to get runtime statistics for this SQL_ID', () => {
    const plan = buildPlan(
      { id: 0, operation: 'SELECT STATEMENT', children: [{ id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 14 }] },
      { source: 'dbms_xplan', hasActualStats: false },
    );
    plan.sqlId = 'f00dfeed12345';
    const md = handoff(analyze(plan));
    expect(md).toContain('**This plan has optimizer estimates only.**');
    const contents = sectionOf(md, '## What this handoff contains');
    expect(contents).toContain('- [ ] Runtime statistics — not available (optimizer estimates only). To get them:');
    expect(contents).toContain("sql_id => 'f00dfeed12345'");
    expect(contents).toContain("- [ ] SQL text — not available. To get it: `SELECT sql_fulltext FROM v$sql WHERE sql_id = 'f00dfeed12345'");
  });

  it('asks for bind values only when the statement uses binds', () => {
    const plan = monitoredPlan();
    plan.bindVariables = undefined;
    expect(sectionOf(handoff(analyze(plan)), '## What this handoff contains')).toContain('- [ ] Bind values — the statement uses binds, but their values are not here.');

    plan.sqlText = 'SELECT 1 FROM dual';
    byId(plan, 2).filterPredicates = '"O"."STATUS"=\'OPEN\'';
    expect(handoff(analyze(plan))).not.toContain('Bind values');
  });

  it('explains the inactive-row prefix when the plan is adaptive', () => {
    const plan = monitoredPlan();
    byId(plan, 3).inactive = true;
    const md = handoff(analyze(plan));
    expect(md).toContain('An Id prefixed with `-` is an inactive adaptive-plan row');
    expect(sectionOf(md, '## Plan')).toMatch(/\| +- 3 \| +INDEX RANGE SCAN/);
  });

  it('flags coarse SQL Monitor A-Time', () => {
    const plan = monitoredPlan();
    plan.source = 'sql_monitor_xml';
    expect(handoff(analyze(plan))).toContain('In SQL Monitor sources a line\'s A-Time is usually its active duration in whole seconds');
    expect(handoff(analyze())).not.toContain('In SQL Monitor sources');
  });

  it('includes projected schema metadata as JSON when a bundle covers the plan', () => {
    const bundle = makeBundle({ 'APP.ORDERS': makeTable({ num_rows: 1_000_000 }, { STATUS: makeColumn({ num_distinct: 3 }) }) });
    const md = handoff(analyze(monitoredPlan(), { bundle }));
    expect(sectionOf(md, '## Schema metadata')).toMatch(/^```json\n/);
    expect(sectionOf(md, '## What this handoff contains')).toContain('- [x] Schema metadata');
  });

  it('embeds the playbook between the instructions and the plan data', () => {
    const md = handoff(analyze(), { playbook: '## Oracle plan analysis\n\nWalk down to the first divergence.' });
    expect(md).toContain('Follow the playbook below (the `oracle-plan-analysis` skill');
    const playbookAt = md.indexOf('# Playbook: the `oracle-plan-analysis` skill');
    expect(playbookAt).toBeGreaterThan(md.indexOf('## Answer with'));
    expect(playbookAt).toBeLessThan(md.indexOf('# Plan data'));
    expect(md).toContain('Walk down to the first divergence.');
  });

  it('fences data so backticks inside it cannot break out', () => {
    const plan = monitoredPlan();
    plan.sqlText = 'SELECT \'```\' AS ticks FROM dual';
    const sql = sectionOf(handoff(analyze(plan)), '## SQL text');
    expect(sql.startsWith('````sql\n')).toBe(true);
    expect(sql.trimEnd().endsWith('````')).toBe(true);
  });
});

describe('original plan text', () => {
  const rawSection = (source: HandoffSource) => buildHandoffParts(source).sections.find((s) => s.id === 'rawPlan');

  it('starts included for a small text-format plan', () => {
    const section = rawSection(analyze());
    expect(section?.defaultIncluded).toBe(true);
    expect(handoff(analyze())).toContain('## Original plan text\n\n```text\nPlan hash value: 2058068615');
  });

  it('starts excluded for machine formats and oversized text, and the inventory says so', () => {
    const xml = monitoredPlan();
    xml.source = 'sql_monitor_xml';
    const xmlSource = analyze(xml, { rawText: '<report/>' });
    expect(rawSection(xmlSource)?.defaultIncluded).toBe(false);
    const md = handoff(xmlSource);
    expect(md).not.toContain('## Original plan text');
    expect(md).toContain('The original plan text is not attached');

    const big = analyze(monitoredPlan(), { rawText: 'x'.repeat(RAW_PLAN_DEFAULT_MAX_CHARS + 1) });
    expect(rawSection(big)?.defaultIncluded).toBe(false);
    expect(rawSection(big)?.note).toMatch(/large/);
    expect(handoff(big, { included: { rawPlan: true } })).toContain('## Original plan text\n\n```text\nxxx');
  });
});

describe('renderAnnotations', () => {
  it('lists notes, highlights and groups by plan line', () => {
    const plan = monitoredPlan();
    const annotations: AnnotationState = createEmptyAnnotationState();
    annotations.nodeAnnotations.set(3, { nodeId: 3, text: 'Too many\nstarts', createdAt: 0, updatedAt: 0 } as never);
    annotations.nodeHighlights.set(3, { nodeId: 3, color: 'red' });
    annotations.nodeHighlights.set(2, { nodeId: 2, color: 'yellow' });
    annotations.groups.push({ id: 'g', name: 'Driving set', nodeIds: [3, 2], color: 'blue', note: 'check stats' });
    expect(renderAnnotations(plan, annotations)).toBe([
      '- Line 2 (TABLE ACCESS FULL ORDERS) [highlighted yellow]',
      '- Line 3 (INDEX RANGE SCAN ITEMS_IX): Too many starts [highlighted red]',
      '- Group "Driving set" (lines 2, 3): check stats',
    ].join('\n'));
    expect(handoff(analyze(plan, { annotations }))).toContain('## Analyst notes\n\n- Line 2');
  });

  it('is empty without annotations', () => {
    expect(renderAnnotations(monitoredPlan(), createEmptyAnnotationState())).toBe('');
  });
});

describe('buildAgentHandoff (compare)', () => {
  function compareSource(): HandoffSource {
    const a = monitoredPlan();
    const b = monitoredPlan();
    b.sqlId = 'zzz999yyy8887';
    b.planHashValue = '111';
    byId(b, 1).operation = 'HASH JOIN';
    return { mode: 'compare', planA: input(a), planB: input(b, { label: 'After stats' }) };
  }

  it('frames a baseline-vs-candidate comparison and warns when the SQL_IDs differ', () => {
    const md = handoff(compareSource());
    expect(md).toContain('# Oracle execution plan comparison: Plan A vs After stats');
    expect(md).toContain('Plan A is the baseline, Plan B (After stats) the candidate');
    expect(md).toContain('different SQL_IDs (A: `abc123def4567`, B: `zzz999yyy8887`)');
    expect(md).toContain('## Plans and node match digest');
    expect(md).toContain('=== NODE MATCH DIGEST (A -> B) ===');
    const contents = sectionOf(md, '## What this handoff contains');
    expect(contents).toContain('Plan A:\n\n- [x] Runtime statistics');
    expect(contents).toContain('Plan B (After stats):');
    expect(md).toContain('2. **What changed**');
  });

  it('labels raw text per plan and keeps it off by default only when large', () => {
    const md = handoff(compareSource());
    expect(md).toContain('## Original plan text\n\nPlan A:\n\n```text');
    expect(md).toContain('Plan B:\n\n```text');
  });
});

describe('agentHandoffFilename', () => {
  it('names the file after the SQL_ID, or both for a comparison', () => {
    expect(agentHandoffFilename(analyze())).toBe('agent-handoff-abc123def4567.md');
    const plan = monitoredPlan();
    plan.sqlId = undefined;
    plan.planHashValue = undefined;
    expect(agentHandoffFilename(analyze(plan))).toBe('agent-handoff-plan.md');
    const b = monitoredPlan();
    b.sqlId = 'other1234567';
    expect(agentHandoffFilename({ mode: 'compare', planA: input(monitoredPlan()), planB: input(b) }))
      .toBe('agent-handoff-compare-abc123def4567-vs-other1234567.md');
    expect(agentHandoffFilename({ mode: 'compare', planA: input(monitoredPlan()), planB: input(monitoredPlan()) }))
      .toBe('agent-handoff-compare-abc123def4567.md');
  });
});
