export interface MetadataBundle {
  format: 'ora-plan-metadata';
  version: number;
  captured_at: string;
  source: MetadataSource;
  plan_ref: MetadataPlanRef;
  objects: Record<string, MetadataObject>;
  coverage_warnings: CoverageWarning[];
}

export interface MetadataSource {
  db_name: string;
  oracle_version: string;
  container_name: string;
}

export interface MetadataPlanRef {
  sql_id: string | null;
  plan_hash_value: number | null;
}

export type MetadataObject = TableObject | IndexObject;

export interface TableObject {
  type: 'TABLE';
  stats: TableStats;
  columns: Record<string, ColumnStats>;
  indexes: string[];
}

export interface IndexObject {
  type: 'INDEX';
  stats: IndexStats;
  columns: string[];
  table: string;
}

export interface TableStats {
  num_rows: number | null;
  blocks: number | null;
  avg_row_len: number | null;
  last_analyzed: string | null;
  stale_stats: 'YES' | 'NO' | null;
  partitioned: boolean;
  partition_count?: number;
}

export interface ColumnStats {
  data_type: string;
  nullable: boolean;
  num_distinct: number | null;
  num_nulls: number | null;
  low_value: string | null;
  high_value: string | null;
  density: number | null;
  histogram: HistogramInfo;
}

export interface HistogramInfo {
  type: 'NONE' | 'FREQUENCY' | 'HEIGHT BALANCED' | 'HYBRID' | 'TOP-FREQUENCY';
  buckets: number;
}

export interface IndexStats {
  uniqueness: 'UNIQUE' | 'NONUNIQUE' | 'BITMAP';
  index_type: string;
  status: string;
  visibility: 'VISIBLE' | 'INVISIBLE';
  partitioned: boolean;
  clustering_factor: number | null;
  blevel: number | null;
  leaf_blocks: number | null;
  distinct_keys: number | null;
}

export interface CoverageWarning {
  object: string;
  reason: string;
}

export function parseBundle(input: string): MetadataBundle {
  const parsed = JSON.parse(input);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Bundle is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.format !== 'string') {
    throw new Error('Bundle is missing required field: format');
  }
  if (obj.format !== 'ora-plan-metadata') {
    throw new Error(
      `Bundle has unexpected format: "${obj.format}" (expected "ora-plan-metadata")`,
    );
  }
  if (typeof obj.plan_ref !== 'object' || obj.plan_ref === null) {
    throw new Error('Bundle is missing required field: plan_ref');
  }
  if (typeof obj.objects !== 'object' || obj.objects === null) {
    throw new Error('Bundle is missing required field: objects');
  }
  return parsed as MetadataBundle;
}
