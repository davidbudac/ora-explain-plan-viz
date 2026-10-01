import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  timeShareDenominator,
  timeShare,
  nextSortState,
  ariaSortFor,
  DEFAULT_SORT,
  buildTabularTsv,
  sanitizeTsvCell,
  collapseAllIds,
} from '../tabularHelpers';
import { parsePlan } from '../parser';
import type { PlanNode } from '../types';

function node(overrides: Partial<PlanNode> = {}): PlanNode {
  return { id: 0, depth: 0, operation: 'SELECT STATEMENT', children: [], ...overrides };
}

describe('timeShareDenominator / timeShare', () => {
  it('uses the reported elapsed time when it covers every line', () => {
    const nodes = [node({ actualTime: 100 }), node({ id: 1, actualTime: 40 })];
    expect(timeShareDenominator(500, nodes)).toBe(500);
    expect(timeShare(40, 500)).toBeCloseTo(0.08);
  });

  it('falls back to the largest line A-Time when it exceeds the elapsed time', () => {
    const nodes = [node({ actualTime: 1000 }), node({ id: 1, actualTime: 400 })];
    const denom = timeShareDenominator(325.716, nodes);
    expect(denom).toBe(1000);
    expect(timeShare(1000, denom)).toBe(1);
    expect(timeShare(400, denom)).toBeCloseTo(0.4);
  });

  it('works when the plan reports no elapsed time at all', () => {
    const nodes = [node({ actualTime: 220000 }), node({ id: 1, actualTime: 1000 })];
    expect(timeShareDenominator(undefined, nodes)).toBe(220000);
    expect(timeShareDenominator(0, nodes)).toBe(220000);
  });

  it('ignores missing / non-finite values and never exceeds 100%', () => {
    const nodes = [node({ actualTime: undefined }), node({ id: 1, actualTime: Infinity }), node({ id: 2, actualTime: NaN })];
    expect(timeShareDenominator(undefined, nodes)).toBe(0);
    expect(timeShare(10, 0)).toBe(0);
    expect(timeShare(undefined, 100)).toBe(0);
    expect(timeShare(150, 100)).toBe(1);
    expect(timeShare(-5, 100)).toBe(0);
  });

  it('keeps every line of the "Partitioned Star Query" example within 0–100%', () => {
    const text = readFileSync(join(__dirname, '../../examples', '27-sql_monitor-Partitioned Star Query.txt'), 'utf-8');
    const plan = parsePlan(text);
    const denom = timeShareDenominator(plan.totalElapsedTime, plan.allNodes);
    // Sanity check the regression: the reported elapsed time alone is too small.
    const maxLine = Math.max(...plan.allNodes.map((n) => n.actualTime ?? 0));
    expect(maxLine).toBeGreaterThan(plan.totalElapsedTime ?? 0);
    for (const n of plan.allNodes) {
      const share = timeShare(n.actualTime, denom);
      expect(share).toBeGreaterThanOrEqual(0);
      expect(share).toBeLessThanOrEqual(1);
    }
  });
});

describe('nextSortState / ariaSortFor', () => {
  it('cycles asc → desc → plan order', () => {
    let state = DEFAULT_SORT;
    state = nextSortState(state, 'cost');
    expect(state).toEqual({ column: 'cost', direction: 'asc' });
    state = nextSortState(state, 'cost');
    expect(state).toEqual({ column: 'cost', direction: 'desc' });
    state = nextSortState(state, 'cost');
    expect(state).toEqual(DEFAULT_SORT);
  });

  it('switching column starts ascending', () => {
    expect(nextSortState({ column: 'cost', direction: 'desc' }, 'actualTime')).toEqual({ column: 'actualTime', direction: 'asc' });
  });

  it('Id itself toggles desc then back to plan order', () => {
    const desc = nextSortState(DEFAULT_SORT, 'id');
    expect(desc).toEqual({ column: 'id', direction: 'desc' });
    expect(nextSortState(desc, 'id')).toEqual(DEFAULT_SORT);
  });

  it('reports aria-sort for the active column only', () => {
    expect(ariaSortFor('id', DEFAULT_SORT)).toBe('ascending');
    expect(ariaSortFor('cost', DEFAULT_SORT)).toBe('none');
    const costDesc = { column: 'cost', direction: 'desc' } as const;
    expect(ariaSortFor('cost', costDesc)).toBe('descending');
    expect(ariaSortFor('id', costDesc)).toBe('none');
    // After the third click the column is back to "none".
    expect(ariaSortFor('cost', nextSortState(costDesc, 'cost'))).toBe('none');
  });
});

describe('buildTabularTsv', () => {
  const nodes: PlanNode[] = [
    node({ id: 0, depth: 0, operation: 'SELECT STATEMENT', rows: 10, estimatedRowsTotal: 10, cost: 5, actualRows: 12, actualTime: 30 }),
    node({
      id: 1,
      depth: 1,
      operation: 'TABLE ACCESS FULL',
      objectName: 'EMP',
      rows: 10,
      estimatedRowsTotal: 10,
      cost: 5,
      actualRows: 1000,
      actualTime: 25.5,
      accessPredicates: undefined,
      filterPredicates: '"E"."NAME"=\'A\tB\'\nAND "E"."ID">1',
    }),
  ];

  it('emits a header plus one line per row with raw numbers', () => {
    const tsv = buildTabularTsv(nodes, ['id', 'operation', 'rows', 'cost', 'actualRows', 'actualTime', 'cardinality'], { hasActualStats: true });
    const lines = tsv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0].split('\t')).toEqual([
      'Id', 'Operation', 'Object', 'E-Rows', 'Cost', 'A-Rows', 'A-Time (ms)', 'A-Rows / Est. total rows', 'Access Predicates', 'Filter Predicates',
    ]);
    const row1 = lines[2].split('\t');
    expect(row1[0]).toBe('1');
    expect(row1[1]).toBe('  TABLE ACCESS FULL');
    expect(row1[2]).toBe('EMP');
    expect(row1[6]).toBe('25.5');
    expect(row1[7]).toBe('100');
    expect(row1[8]).toBe('');
    // Tabs / newlines inside predicates cannot break the grid.
    expect(row1[9]).toBe('"E"."NAME"=\'A B\' AND "E"."ID">1');
    expect(row1).toHaveLength(10);
  });

  it('labels estimated rows "Rows" for plans without runtime stats and can omit predicates', () => {
    const tsv = buildTabularTsv(nodes, ['id', 'operation', 'rows'], { includePredicates: false });
    expect(tsv.split('\n')[0]).toBe('Id\tOperation\tObject\tRows');
  });

  it('leaves missing values empty and keeps rows in the given order', () => {
    const tsv = buildTabularTsv([nodes[1], node({ id: 7, depth: 2, operation: 'INDEX RANGE SCAN' })], ['id', 'operation', 'cost']);
    const lines = tsv.split('\n');
    expect(lines[1].startsWith('1\t')).toBe(true);
    expect(lines[2].split('\t').slice(0, 4)).toEqual(['7', '    INDEX RANGE SCAN', '', '']);
  });

  it('sanitizeTsvCell collapses control whitespace', () => {
    expect(sanitizeTsvCell(' a\tb\r\nc ')).toBe('a b c');
  });

  it('adds a Storage Predicates column only when some row has one', () => {
    const without = buildTabularTsv(nodes, ['id'], {}).split('\n')[0].split('\t');
    expect(without).not.toContain('Storage Predicates');

    const withStorage = [...nodes, node({ id: 2, depth: 2, operation: 'TABLE ACCESS STORAGE FULL', storagePredicates: '"C"<3' })];
    const lines = buildTabularTsv(withStorage, ['id'], {}).split('\n');
    const header = lines[0].split('\t');
    expect(header[header.length - 1]).toBe('Storage Predicates');
    expect(lines[lines.length - 1].split('\t').pop()).toBe('"C"<3');
    expect(lines[1].split('\t').pop()).toBe('');
  });
});

describe('collapseAllIds', () => {
  it('collapses every parent except the root', () => {
    const leaf = node({ id: 3, depth: 2, parentId: 2 });
    const mid = node({ id: 2, depth: 1, parentId: 0, children: [leaf] });
    const leaf2 = node({ id: 1, depth: 1, parentId: 0 });
    const root = node({ id: 0, depth: 0, children: [leaf2, mid] });
    expect([...collapseAllIds([root, leaf2, mid, leaf])]).toEqual([2]);
  });

  it('is empty for a single-node plan', () => {
    expect(collapseAllIds([node()]).size).toBe(0);
  });
});
