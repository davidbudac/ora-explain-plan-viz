import { describe, expect, it } from 'vitest';
import { formatNodeSummary } from '../nodeSummary';
import type { PlanNode } from '../types';

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return { id: 3, depth: 1, operation: 'TABLE ACCESS FULL', children: [], ...overrides };
}

describe('formatNodeSummary', () => {
  it('lays out a fully populated SQL Monitor operation', () => {
    const text = formatNodeSummary(
      node({
        objectName: 'EMPLOYEES',
        rows: 107,
        actualRows: 105,
        cost: 3,
        bytes: 7383,
        actualTime: 10,
        starts: 1,
        accessPredicates: '"E"."DEPARTMENT_ID"=:B1',
        filterPredicates: '"E"."SALARY">1000',
      }),
      { hasActualStats: true, note: 'check the histogram' },
    );
    expect(text).toBe(
      [
        '#3 TABLE ACCESS FULL · EMPLOYEES',
        'Rows 107 est / 105 actual · Cost 3 · Bytes 7,383 · A-Time 10ms · Starts 1',
        'Access: "E"."DEPARTMENT_ID"=:B1',
        'Filter: "E"."SALARY">1000',
        'Note: check the histogram',
      ].join('\n'),
    );
  });

  it('leaves out runtime figures when the plan has no actuals', () => {
    const text = formatNodeSummary(node({ rows: 107, cost: 3, bytes: 7383, actualRows: 5, actualTime: 10, starts: 1 }));
    expect(text).toBe('#3 TABLE ACCESS FULL\nRows 107 · Cost 3 · Bytes 7,383');
  });

  it('labels a lone estimate when the plan has actuals but this operation does not', () => {
    expect(formatNodeSummary(node({ rows: 12, cost: 2 }), { hasActualStats: true })).toBe(
      '#3 TABLE ACCESS FULL\nRows 12 est · Cost 2',
    );
  });

  it('shows actual rows alone when no estimate exists', () => {
    expect(formatNodeSummary(node({ actualRows: 9 }), { hasActualStats: true })).toBe('#3 TABLE ACCESS FULL\nRows 9 actual');
  });

  it('puts thousands separators in large counts and formats time compactly', () => {
    const text = formatNodeSummary(
      node({ rows: 1234567, actualRows: 2000000, cost: 98765, actualTime: 65_000, starts: 12000 }),
      { hasActualStats: true },
    );
    expect(text).toBe(
      '#3 TABLE ACCESS FULL\nRows 1,234,567 est / 2,000,000 actual · Cost 98,765 · A-Time 1m 5.0s · Starts 12,000',
    );
  });

  it('omits the stats line entirely when there are no figures', () => {
    expect(formatNodeSummary(node({ operation: 'SELECT STATEMENT', id: 0 }))).toBe('#0 SELECT STATEMENT');
  });

  it('skips blank predicates and a whitespace-only note', () => {
    const text = formatNodeSummary(node({ accessPredicates: '  ', filterPredicates: '' }), { note: '   ' });
    expect(text).toBe('#3 TABLE ACCESS FULL');
  });

  it('trims predicates and the note', () => {
    const text = formatNodeSummary(node({ accessPredicates: ' "A"=1 ' }), { note: '\n look here \n' });
    expect(text).toBe('#3 TABLE ACCESS FULL\nAccess: "A"=1\nNote: look here');
  });
});
