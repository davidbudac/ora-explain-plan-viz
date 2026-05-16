import { describe, it, expect } from 'vitest';
import type { MetadataBundle, IndexObject, TableObject } from '../bundle';
import type { PlanNode } from '../../types';
import { resolveIndexesForBlock, findUsedIndexKeys } from '../indexes';

function makeTable(indexes: string[]): TableObject {
  return {
    type: 'TABLE',
    stats: {
      num_rows: 100, blocks: 10, avg_row_len: 50,
      last_analyzed: '2026-01-01', stale_stats: 'NO', partitioned: false,
    },
    columns: {},
    indexes,
  };
}

function makeIndex(table: string): IndexObject {
  return {
    type: 'INDEX',
    stats: {
      uniqueness: 'NONUNIQUE', index_type: 'NORMAL', status: 'VALID',
      visibility: 'VISIBLE', partitioned: false,
      clustering_factor: 100, blevel: 1, leaf_blocks: 10, distinct_keys: 50,
    },
    columns: ['ID'],
    table,
  };
}

function makeBundle(objects: Record<string, TableObject | IndexObject>): MetadataBundle {
  return {
    format: 'ora-plan-metadata',
    version: 1,
    captured_at: '2026-01-01T00:00:00Z',
    source: { db_name: 'X', oracle_version: '19.0', container_name: 'C' },
    plan_ref: { sql_id: null, plan_hash_value: null },
    objects,
    coverage_warnings: [],
  };
}

function makeNode(id: number, operation: string, objectName?: string): PlanNode {
  return { id, depth: 0, operation, objectName, children: [] };
}

describe('resolveIndexesForBlock', () => {
  it('returns empty list when selected table has no indexes', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable([]),
    });
    const match = { key: 'HR.EMPLOYEES', object: bundle.objects['HR.EMPLOYEES'] };
    const result = resolveIndexesForBlock(match, bundle);
    expect(result.tableKey).toBe('HR.EMPLOYEES');
    expect(result.indexes).toEqual([]);
  });

  it('lists all indexes when selected match is a TABLE', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable(['HR.EMP_PK', 'HR.EMP_DEPT_IDX']),
      'HR.EMP_PK': makeIndex('HR.EMPLOYEES'),
      'HR.EMP_DEPT_IDX': makeIndex('HR.EMPLOYEES'),
    });
    const match = { key: 'HR.EMPLOYEES', object: bundle.objects['HR.EMPLOYEES'] };
    const result = resolveIndexesForBlock(match, bundle);
    expect(result.tableKey).toBe('HR.EMPLOYEES');
    expect(result.indexes.map((i) => i.key)).toEqual(['HR.EMP_PK', 'HR.EMP_DEPT_IDX']);
  });

  it('skips index keys that are missing from the bundle', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable(['HR.EMP_PK', 'HR.MISSING']),
      'HR.EMP_PK': makeIndex('HR.EMPLOYEES'),
    });
    const match = { key: 'HR.EMPLOYEES', object: bundle.objects['HR.EMPLOYEES'] };
    const result = resolveIndexesForBlock(match, bundle);
    expect(result.indexes.map((i) => i.key)).toEqual(['HR.EMP_PK']);
  });

  it('resolves other indexes on the underlying table when match is an INDEX', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable(['HR.EMP_PK', 'HR.EMP_DEPT_IDX']),
      'HR.EMP_PK': makeIndex('HR.EMPLOYEES'),
      'HR.EMP_DEPT_IDX': makeIndex('HR.EMPLOYEES'),
    });
    const match = { key: 'HR.EMP_PK', object: bundle.objects['HR.EMP_PK'] };
    const result = resolveIndexesForBlock(match, bundle);
    expect(result.tableKey).toBe('HR.EMPLOYEES');
    expect(result.indexes.map((i) => i.key)).toEqual(['HR.EMP_DEPT_IDX']);
  });

  it('returns empty list when the index back-reference table is missing', () => {
    const bundle = makeBundle({
      'HR.EMP_PK': makeIndex('HR.MISSING_TABLE'),
    });
    const match = { key: 'HR.EMP_PK', object: bundle.objects['HR.EMP_PK'] };
    const result = resolveIndexesForBlock(match, bundle);
    expect(result.tableKey).toBeNull();
    expect(result.indexes).toEqual([]);
  });
});

describe('findUsedIndexKeys', () => {
  it('returns empty set when no plan nodes reference an index', () => {
    const bundle = makeBundle({
      'HR.EMP_PK': makeIndex('HR.EMPLOYEES'),
    });
    const nodes = [makeNode(0, 'SELECT STATEMENT'), makeNode(1, 'TABLE ACCESS FULL', 'EMPLOYEES')];
    expect(findUsedIndexKeys(bundle, nodes).size).toBe(0);
  });

  it('detects bundle index keys referenced by plan nodes', () => {
    const bundle = makeBundle({
      'HR.EMP_PK': makeIndex('HR.EMPLOYEES'),
      'HR.EMP_DEPT_IDX': makeIndex('HR.EMPLOYEES'),
    });
    const nodes = [
      makeNode(0, 'SELECT STATEMENT'),
      makeNode(1, 'INDEX RANGE SCAN', 'EMP_DEPT_IDX'),
    ];
    const used = findUsedIndexKeys(bundle, nodes);
    expect(used.has('HR.EMP_DEPT_IDX')).toBe(true);
    expect(used.has('HR.EMP_PK')).toBe(false);
  });

  it('ignores table-type bundle objects even if referenced by plan nodes', () => {
    const bundle = makeBundle({
      'HR.EMPLOYEES': makeTable([]),
    });
    const nodes = [makeNode(1, 'TABLE ACCESS FULL', 'EMPLOYEES')];
    expect(findUsedIndexKeys(bundle, nodes).size).toBe(0);
  });
});
