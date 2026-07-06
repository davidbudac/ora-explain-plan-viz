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
  ddl?: string | null;
}

export interface IndexObject {
  type: 'INDEX';
  stats: IndexStats;
  columns: string[];
  table: string;
  ddl?: string | null;
}

export interface TableStats {
  num_rows: number | null;
  blocks: number | null;
  avg_row_len: number | null;
  last_analyzed: string | null;
  stale_stats: 'YES' | 'NO' | null;
  partitioned: boolean;
  partition_count?: number;
  /** "RANGE" | "LIST" | "HASH" | "REFERENCE" | "SYSTEM" */
  partition_type?: string | null;
  /** "NONE" | "RANGE" | "LIST" | "HASH" | null */
  subpartition_type?: string | null;
  /** Interval expression when INTERVAL partitioning is in use, else null. */
  interval?: string | null;
  /** Ordered partition key columns; may be [] or absent. */
  partition_key?: string[];
  /** Ordered subpartition key columns; may be [] or absent. */
  subpartition_key?: string[];
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
  partition_type?: string | null;
  locality?: 'LOCAL' | 'GLOBAL' | null;
  partition_key?: string[];
}

export interface CoverageWarning {
  object: string;
  reason: string;
}

/**
 * Cheap detection of bundle content anywhere in a piece of text, before any
 * cleanup. Used to route pasted or dropped input toward the bundle pipeline
 * regardless of file extension or surrounding SQL*Plus noise.
 */
export function looksLikeMetadataBundle(text: string): boolean {
  return /"format"\s*:\s*"ora-plan-metadata"/.test(text);
}

const SQLPLUS_NOISE = [
  /^\s*SQL>/,
  /^\s*Enter value for /i,
  /^\s*old\s+\d+:/,
  /^\s*new\s+\d+:/,
  /^\s*PL\/SQL procedure successfully completed/i,
  /^\s*SP2-\d+/,
  /^\s*$/,
];

/**
 * Recover the JSON payload from a SQL*Plus spool file. Spool output is rarely
 * clean JSON: interactive prompts leave `SQL> ...` / `Enter value for ...`
 * lines around the payload, and the gather script emits the bundle through
 * DBMS_OUTPUT in fixed-size chunks, which inserts a line break every N
 * characters — including inside string values. All legitimate newlines in the
 * payload are escaped (`\n`) by the script, so raw line breaks carry no
 * information and joining the payload lines back together is lossless.
 */
function extractBundleJson(text: string): string {
  let lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  // The bundle always opens with `{"format"`. When output is copied from a
  // live terminal session, the first chunk can share its line with prompt
  // echo (`SQL> SQL>   2   3 ... {"format":...`), and the noise filter below
  // would throw that whole line away \u2014 so locate the payload start inside
  // lines first and cut the prefix off.
  const startLine = lines.findIndex((line) => line.includes('{"format"'));
  if (startLine !== -1) {
    lines = lines.slice(startLine);
    lines[0] = lines[0].slice(lines[0].indexOf('{"format"'));
  }
  const content = lines.filter((line) => !SQLPLUS_NOISE.some((re) => re.test(line)));
  const start = content.findIndex((line) => line.trimStart().startsWith('{'));
  if (start === -1) return text.trim();
  let end = -1;
  for (let i = content.length - 1; i >= start; i--) {
    if (content[i].trimEnd().endsWith('}')) {
      end = i;
      break;
    }
  }
  if (end === -1) return text.trim();
  const parts = content.slice(start, end + 1);
  parts[0] = parts[0].trimStart();
  parts[parts.length - 1] = parts[parts.length - 1].trimEnd();
  return parts.join('');
}

/**
 * Warning to surface when a structurally valid bundle carries no objects —
 * typically the gather script found nothing for the given SQL_ID.
 */
export function emptyBundleWarning(bundle: MetadataBundle): string | null {
  if (Object.keys(bundle.objects).length > 0) return null;
  return bundle.coverage_warnings.length > 0
    ? 'Bundle contains no objects — see its coverage warnings for why the gather came back empty.'
    : 'Bundle contains no objects — the SQL_ID may have aged out of the cursor cache and AWR when the script ran.';
}

export function parseBundle(input: string): MetadataBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (strictErr) {
    try {
      parsed = JSON.parse(extractBundleJson(input));
    } catch {
      const detail = strictErr instanceof Error ? strictErr.message : String(strictErr);
      throw new Error(`Bundle is not valid JSON: ${detail}`);
    }
  }
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
  if (obj.version !== 1) {
    throw new Error(
      `Bundle has unsupported version: ${String(obj.version)} (this build supports version 1)`,
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
