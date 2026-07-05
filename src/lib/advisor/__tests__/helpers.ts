import type { ParsedPlan, PlanNode, PlanSource, SqlMonitorMetadata } from '../../types';
import type { MetadataBundle, MetadataObject, TableObject, IndexObject, ColumnStats } from '../../metadata/bundle';

export interface NodeSpec {
  id: number;
  operation: string;
  objectName?: string;
  accessPredicates?: string;
  filterPredicates?: string;
  rows?: number;
  actualRows?: number;
  starts?: number;
  tempUsed?: number;
  logicalReads?: number;
  pstart?: string;
  pstop?: string;
  pqDistrib?: string;
  inOut?: string;
  children?: NodeSpec[];
}

export function buildPlan(
  spec: NodeSpec,
  options: { source?: PlanSource; hasActualStats?: boolean; monitorMetadata?: SqlMonitorMetadata } = {},
): ParsedPlan {
  const allNodes: PlanNode[] = [];
  const build = (s: NodeSpec, depth: number, parentId?: number): PlanNode => {
    const node: PlanNode = {
      id: s.id,
      depth,
      operation: s.operation,
      objectName: s.objectName,
      accessPredicates: s.accessPredicates,
      filterPredicates: s.filterPredicates,
      rows: s.rows,
      actualRows: s.actualRows,
      starts: s.starts,
      tempUsed: s.tempUsed,
      logicalReads: s.logicalReads,
      pstart: s.pstart,
      pstop: s.pstop,
      pqDistrib: s.pqDistrib,
      inOut: s.inOut,
      parentId,
      children: [],
    };
    allNodes.push(node);
    node.children = (s.children ?? []).map((c) => build(c, depth + 1, s.id));
    return node;
  };
  const rootNode = build(spec, 0);
  return {
    rootNode,
    allNodes,
    totalCost: 0,
    maxRows: 0,
    source: options.source ?? 'sql_monitor_text',
    hasActualStats: options.hasActualStats ?? allNodes.some((n) => n.actualRows !== undefined),
    monitorMetadata: options.monitorMetadata,
  };
}

export function byId(plan: ParsedPlan, id: number): PlanNode {
  const node = plan.allNodes.find((n) => n.id === id);
  if (!node) throw new Error(`node ${id} not found`);
  return node;
}

export function makeColumn(overrides: Partial<ColumnStats> = {}): ColumnStats {
  return {
    data_type: 'NUMBER',
    nullable: false,
    num_distinct: 100,
    num_nulls: 0,
    low_value: null,
    high_value: null,
    density: 0.01,
    histogram: { type: 'NONE', buckets: 0 },
    ...overrides,
  };
}

export function makeTable(overrides: Partial<TableObject['stats']> = {}, columns: Record<string, ColumnStats> = {}, indexes: string[] = []): TableObject {
  return {
    type: 'TABLE',
    stats: {
      num_rows: 1000,
      blocks: 10,
      avg_row_len: 50,
      last_analyzed: '2026-05-01T00:00:00Z',
      stale_stats: 'NO',
      partitioned: false,
      ...overrides,
    },
    columns,
    indexes,
  };
}

export function makeIndex(table: string, columns: string[], overrides: Partial<IndexObject['stats']> = {}): IndexObject {
  return {
    type: 'INDEX',
    stats: {
      uniqueness: 'NONUNIQUE',
      index_type: 'NORMAL',
      status: 'VALID',
      visibility: 'VISIBLE',
      partitioned: false,
      clustering_factor: 100,
      blevel: 1,
      leaf_blocks: 10,
      distinct_keys: 50,
      ...overrides,
    },
    columns,
    table,
  };
}

export function makeBundle(objects: Record<string, MetadataObject>): MetadataBundle {
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
