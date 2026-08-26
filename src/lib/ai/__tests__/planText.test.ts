import { describe, expect, it } from 'vitest';
import { buildPlan, byId } from '../../advisor/__tests__/helpers';
import { renderNotes, renderPlanTable, renderPredicates } from '../planText';

function estimatePlan() {
  const plan = buildPlan(
    {
      id: 0,
      operation: 'SELECT STATEMENT',
      children: [
        {
          id: 1,
          operation: 'NESTED LOOPS',
          rows: 10,
          children: [
            { id: 2, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 1000, filterPredicates: '"E"."DEPTNO"=10' },
            { id: 3, operation: 'INDEX UNIQUE SCAN', objectName: 'PK_DEPT', rows: 1, accessPredicates: '"D"."DEPTNO"="E"."DEPTNO"' },
          ],
        },
      ],
    },
    { source: 'dbms_xplan', hasActualStats: false },
  );
  byId(plan, 0).cost = 42;
  byId(plan, 1).cost = 42;
  byId(plan, 2).cost = 40;
  byId(plan, 3).cost = 1;
  return plan;
}

describe('renderPlanTable', () => {
  it('renders a fixed-width estimates-only table without actuals columns', () => {
    const table = renderPlanTable(estimatePlan());
    expect(table).toContain('| Id |');
    expect(table).toContain('E-Rows');
    expect(table).toContain('Cost');
    expect(table).not.toContain('A-Rows');
    expect(table).not.toContain('A-Time');
    expect(table).not.toContain('Starts');
    // Depth indentation on operations.
    expect(table).toMatch(/\|\s+2 \| {3}TABLE ACCESS FULL/);
    expect(table).toContain('EMP');
    // Abbreviated numbers.
    expect(table).toContain('1.0K');
    // All rows are pipe-framed and equal width.
    const lines = table.split('\n');
    const widths = new Set(lines.map((l) => l.length));
    expect(widths.size).toBe(1);
  });

  it('includes actuals columns (Starts/A-Rows/A-Time/A-Self) when the plan has runtime stats', () => {
    const plan = buildPlan(
      {
        id: 0,
        operation: 'SELECT STATEMENT',
        children: [
          { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'EMP', rows: 10, actualRows: 5000, starts: 1 },
        ],
      },
      { source: 'sql_monitor_text', hasActualStats: true },
    );
    byId(plan, 0).actualTime = 3000;
    byId(plan, 1).actualTime = 3000;
    const table = renderPlanTable(plan);
    expect(table).toContain('Starts');
    expect(table).toContain('A-Rows');
    expect(table).toContain('A-Time');
    expect(table).toContain('A-Self');
    expect(table).toContain('5.0K');
    expect(table).toContain('3.00s');
    // computeSelfTimes was run: parent self time is 0ms, child carries the 3s.
    expect(byId(plan, 0).selfTime).toBe(0);
    expect(byId(plan, 1).selfTime).toBe(3000);
  });

  it('drops columns that are empty for every row', () => {
    const table = renderPlanTable(estimatePlan());
    expect(table).not.toContain('Pstart');
    expect(table).not.toContain('Mem');
  });
});

describe('renderPredicates', () => {
  it('lists access and filter predicates by operation id', () => {
    const text = renderPredicates(estimatePlan());
    expect(text).toContain('Predicate Information');
    expect(text).toContain('2 - filter("E"."DEPTNO"=10)');
    expect(text).toContain('3 - access("D"."DEPTNO"="E"."DEPTNO")');
  });

  it('returns empty string when the plan has no predicates', () => {
    const plan = buildPlan({ id: 0, operation: 'SELECT STATEMENT' }, { hasActualStats: false });
    expect(renderPredicates(plan)).toBe('');
  });
});

describe('renderNotes', () => {
  it('renders note lines as bullets', () => {
    const plan = estimatePlan();
    plan.notes = { rawLines: ['dynamic statistics used: dynamic sampling (level=2)'] };
    expect(renderNotes(plan)).toBe(
      'Note:\n- dynamic statistics used: dynamic sampling (level=2)',
    );
  });

  it('returns empty string without notes', () => {
    expect(renderNotes(estimatePlan())).toBe('');
  });
});
