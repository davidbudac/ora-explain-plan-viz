import { describe, expect, it } from 'vitest';
import { buildPlan, byId, makeBundle, makeColumn, makeIndex, makeTable } from '../../advisor/__tests__/helpers';
import { assembleContext, buildAnalyzeSections, buildCompareSections, estimateTokens } from '../context';
import { projectMetadata } from '../metadataProjection';

function monitoredPlan() {
  const plan = buildPlan(
    {
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        {
          id: 1,
          operation: 'HASH JOIN',
          rows: 100,
          actualRows: 90,
          children: [
            { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 10, actualRows: 50_000, filterPredicates: '"E"."SAL">1000' },
            { id: 3, operation: 'TABLE ACCESS FULL', objectName: 'DEPT', rows: 4, actualRows: 4 },
          ],
        },
      ],
    },
    { source: 'sql_monitor_xml', hasActualStats: true },
  );
  plan.sqlId = 'abc123def456';
  plan.planHashValue = '987654321';
  plan.sqlText = 'SELECT * FROM emp e JOIN dept d ON e.deptno = d.deptno WHERE e.sal > 1000';
  plan.bindVariables = [{ name: ':B1', type: 'NUMBER', value: '1000' }];
  byId(plan, 0).actualTime = 5000;
  byId(plan, 1).actualTime = 5000;
  byId(plan, 2).actualTime = 4000;
  byId(plan, 3).actualTime = 100;
  return plan;
}

describe('buildAnalyzeSections + assembleContext', () => {
  it('produces a core with header and plan table, and only sections that have data', () => {
    const plan = monitoredPlan();
    const { core, sections } = buildAnalyzeSections(plan, null, null);

    expect(core).toContain('SQL_ID: abc123def456');
    expect(core).toContain('Plan hash value: 987654321');
    expect(core).toContain('with runtime statistics');
    expect(core).toContain('HASH JOIN');

    const ids = sections.map((s) => s.id);
    expect(ids).toContain('sql');
    expect(ids).toContain('predicates');
    expect(ids).toContain('binds');
    // No ASH timeline, notes, monitor metadata, signals, advisor, or bundle.
    expect(ids).not.toContain('ash');
    expect(ids).not.toContain('notes');
    expect(ids).not.toContain('monitorMeta');
    expect(ids).not.toContain('metadata');
  });

  it('is deterministic', () => {
    const plan = monitoredPlan();
    const a = assembleContext(...spread(buildAnalyzeSections(plan, null, null)));
    const b = assembleContext(...spread(buildAnalyzeSections(plan, null, null)));
    expect(a.userMessage).toBe(b.userMessage);
    expect(a.tokenEstimate).toBe(b.tokenEstimate);
  });

  it('toggling a section off changes the message and token estimate', () => {
    const plan = monitoredPlan();
    const { core, sections } = buildAnalyzeSections(plan, null, null);
    const full = assembleContext(core, sections);
    const withoutSql = assembleContext(
      core,
      sections.map((s) => (s.id === 'sql' ? { ...s, included: false } : s)),
    );
    expect(full.userMessage).toContain('=== SQL TEXT ===');
    expect(withoutSql.userMessage).not.toContain('=== SQL TEXT ===');
    expect(withoutSql.tokenEstimate).toBeLessThan(full.tokenEstimate);
    expect(withoutSql.tokenEstimate).toBe(estimateTokens(withoutSql.userMessage));
  });

  it('includes projected metadata when a bundle is attached', () => {
    const plan = monitoredPlan();
    const bundle = makeBundle({
      'SCOTT.EMP': makeTable({}, { SAL: makeColumn(), UNRELATED: makeColumn() }, ['SCOTT.EMP_IX']),
      'SCOTT.EMP_IX': makeIndex('SCOTT.EMP', ['SAL']),
      'SCOTT.BONUS': makeTable(),
    });
    const { sections } = buildAnalyzeSections(plan, bundle, null);
    const metadata = sections.find((s) => s.id === 'metadata');
    expect(metadata).toBeDefined();
    expect(metadata!.text).toContain('SCOTT.EMP');
    // Index of a referenced table rides along; unreferenced table does not.
    expect(metadata!.text).toContain('SCOTT.EMP_IX');
    expect(metadata!.text).not.toContain('SCOTT.BONUS');
    // Column stats restricted to predicate columns.
    expect(metadata!.text).toContain('"SAL"');
    expect(metadata!.text).not.toContain('UNRELATED');
  });
});

describe('projectMetadata', () => {
  it('drops DDL and returns empty string when nothing is referenced', () => {
    const plan = monitoredPlan();
    const bundle = makeBundle({ 'SCOTT.EMP': { ...makeTable(), ddl: 'CREATE TABLE emp (...)' } });
    expect(projectMetadata(bundle, plan)).not.toContain('CREATE TABLE');

    const emptyBundle = makeBundle({ 'SCOTT.OTHER': makeTable() });
    expect(projectMetadata(emptyBundle, plan)).toBe('');
  });
});

describe('buildCompareSections', () => {
  it('renders both plan tables and a match digest with metric transitions', () => {
    const planA = monitoredPlan();
    const planB = monitoredPlan();
    // Plan B's EMP scan got much faster and returns fewer rows.
    byId(planB, 2).actualRows = 1000;
    byId(planB, 2).actualTime = 500;
    byId(planB, 0).actualTime = 1500;
    byId(planB, 1).actualTime = 1500;

    const { core } = buildCompareSections(planA, planB);
    expect(core).toContain('=== PLAN A');
    expect(core).toContain('=== PLAN B');
    expect(core).toContain('=== NODE MATCH DIGEST');
    expect(core).toContain('A#2 -> B#2 TABLE ACCESS FULL EMP');
    expect(core).toContain('aRows 50.0K->1.0K');
    expect(core).toContain('totals:');
  });

  it('lists unmatched nodes per side', () => {
    const planA = monitoredPlan();
    const planB = buildPlan(
      {
        id: 0,
        operation: 'SELECT STATEMENT',
        children: [{ id: 1, operation: 'INDEX RANGE SCAN', objectName: 'EMP_IX', rows: 10, actualRows: 10 }],
      },
      { hasActualStats: true },
    );
    const { core } = buildCompareSections(planA, planB);
    expect(core).toContain('only in A:');
    expect(core).toContain('only in B: #1 INDEX RANGE SCAN EMP_IX');
  });
});

function spread(sc: { core: string; sections: Parameters<typeof assembleContext>[1] }) {
  return [sc.core, sc.sections] as const;
}
