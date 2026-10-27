export interface MetadataBundle {
  format: 'ora-plan-metadata';
  version: number;
  captured_at: string;
  source: MetadataSource;
  plan_ref: MetadataPlanRef;
  objects: Record<string, MetadataObject>;
  coverage_warnings: CoverageWarning[];
  /** v2: a handful of system-wide optimizer-relevant parameters (also emitted, unused, by v1 scripts). */
  system_params?: SystemParams;
  /** v2: non-default optimizer environment params for the SQL_ID's cached child cursor. */
  optimizer_env?: OptimizerEnvParam[];
  /** v2: SQL plan management objects (baselines/profiles/patches/directives) tied to the SQL_ID. */
  sql_management?: SqlManagement;
}

export interface SystemParams {
  db_block_size: number;
  optimizer_features_enable: string;
  optimizer_index_cost_adj: number;
  optimizer_index_caching: number;
}

export interface OptimizerEnvParam {
  name: string;
  value: string;
}

export interface SqlPlanBaselineInfo {
  plan_name: string;
  sql_handle: string;
  enabled: boolean;
  accepted: boolean;
  fixed: boolean;
  origin?: string;
  created?: string | null;
  last_modified?: string | null;
}

export interface SqlProfileInfo {
  name: string;
  category?: string | null;
  status?: string;
  force_matching?: boolean;
  created?: string | null;
}

export interface SqlPatchInfo {
  name: string;
  status?: string;
  created?: string | null;
}

export interface SqlPlanDirectiveInfo {
  /** NUMBER in the data dictionary exceeds Number.MAX_SAFE_INTEGER — carried as a string. */
  directive_id: string;
  type: string;
  state: string;
  reason?: string;
  last_used?: string | null;
  objects: SqlPlanDirectiveObject[];
}

export interface SqlPlanDirectiveObject {
  owner: string;
  object_name: string;
  subobject_name?: string | null;
  object_type: string;
}

export interface SqlManagement {
  baselines?: SqlPlanBaselineInfo[];
  profiles?: SqlProfileInfo[];
  patches?: SqlPatchInfo[];
  directives?: SqlPlanDirectiveInfo[];
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
  /** v2: PK/UK/FK/CHECK constraints. */
  constraints?: TableConstraints;
  /** v2: segment size, or null when unavailable/not owned by the current schema. */
  segment?: SegmentInfo | null;
  /** v2: physical storage properties. */
  physical?: TablePhysical;
  /** v2: extension-based extended statistics (column groups, expressions). */
  extended_stats?: ExtendedStat[];
}

export interface ConstraintInfo {
  name: string;
  columns: string[];
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  ref_owner: string;
  ref_table: string;
  ref_columns: string[];
  delete_rule: string;
}

export interface CheckConstraintInfo {
  name: string;
  condition: string | null;
  /** True for system-generated NOT NULL checks (`GENERATED NAME`) — noise the UI hides by default. */
  generated?: boolean;
}

export interface TableConstraints {
  primary_key?: ConstraintInfo | null;
  unique?: ConstraintInfo[];
  foreign_keys?: ForeignKeyInfo[];
  checks?: CheckConstraintInfo[];
}

export interface SegmentInfo {
  bytes: number;
  extents: number;
}

export interface TablePhysical {
  compression?: string;
  compress_for?: string | null;
  degree?: string;
  temporary?: boolean;
  cluster_name?: string | null;
  iot_type?: string | null;
  cache?: boolean;
}

export interface ExtendedStat {
  extension_name: string;
  extension: string;
  has_histogram?: boolean;
}

export interface IndexObject {
  type: 'INDEX';
  stats: IndexStats;
  columns: string[];
  table: string;
  ddl?: string | null;
  /** v2: segment size, or null when unavailable. */
  segment?: SegmentInfo | null;
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
  /** v2: true for virtual/extended-stats-backed columns (emitted only when true). */
  virtual?: boolean;
  /** v2: true for hidden (e.g. SYS_STU...) columns (emitted only when true). */
  hidden?: boolean;
}

export interface HistogramInfo {
  type: 'NONE' | 'FREQUENCY' | 'HEIGHT BALANCED' | 'HYBRID' | 'TOP-FREQUENCY';
  buckets: number;
  /** v3: histogram endpoints from DBA_TAB_HISTOGRAMS (capped at 254); absent when type is NONE. */
  endpoints?: HistogramEndpoint[];
}

export interface HistogramEndpoint {
  /** Endpoint value: number for numeric columns, string otherwise (already decoded by the gather script). */
  value: string | number;
  endpoint_number: number;
  /** HYBRID histograms: endpoint_repeat_count; omitted elsewhere. */
  repeat_count?: number;
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
  /** v2 fields */
  num_rows?: number | null;
  avg_leaf_blocks_per_key?: number | null;
  avg_data_blocks_per_key?: number | null;
  last_analyzed?: string | null;
  degree?: string;
  compression?: string;
}

export interface CoverageWarning {
  object: string;
  reason: string;
}

/**
 * Cheap detection of bundle content anywhere in a piece of text, before any
 * cleanup. Used to route pasted or dropped input toward the bundle pipeline
 * regardless of file extension or surrounding SQL*Plus noise. `\s*` also
 * matches line breaks, so a `"format"` / `:` / value split across lines
 * still counts.
 */
export function looksLikeMetadataBundle(text: string): boolean {
  return /"format"\s*:\s*"ora-plan-metadata"/.test(text);
}

const BUNDLE_OPENER = '{"format"';

function isWhitespace(code: number): boolean {
  return code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0xfeff;
}

/** Index of the `{` that opens the bundle, or -1 when there is none. */
function findBundleStart(text: string): number {
  // Terminals can hard-wrap anywhere, so `{"for` / `mat"` may sit on two
  // lines: compare the opener while skipping all whitespace.
  for (let i = text.indexOf('{'); i !== -1; i = text.indexOf('{', i + 1)) {
    let k = 1;
    let j = i + 1;
    while (k < BUNDLE_OPENER.length && j < text.length) {
      const c = text.charCodeAt(j);
      if (isWhitespace(c)) {
        j++;
        continue;
      }
      if (c !== BUNDLE_OPENER.charCodeAt(k)) break;
      k++;
      j++;
    }
    if (k === BUNDLE_OPENER.length) return i;
  }
  // No recognisable opener: fall back to the first `{` that starts a line.
  const m = /^[ \t]*\{/m.exec(text);
  return m ? m.index + m[0].length - 1 : -1;
}

/** Drop every raw line break together with the spaces/tabs padding before it. */
function joinLines(text: string): string {
  const parts: string[] = [];
  let from = 0;
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9) {
      let j = i + 1;
      while (j < text.length && (text.charCodeAt(j) === 32 || text.charCodeAt(j) === 9)) j++;
      const next = j < text.length ? text.charCodeAt(j) : -1;
      if (next === 10 || next === 13) {
        parts.push(text.slice(from, i));
        i = j;
        from = j;
      } else {
        i = j;
      }
    } else if (c === 10 || c === 13) {
      parts.push(text.slice(from, i));
      i++;
      from = i;
    } else {
      i++;
    }
  }
  parts.push(text.slice(from));
  return parts.join('');
}

interface BundleScan {
  /** Cleaned JSON text: the top-level object only (or everything left, when `closed` is false). */
  json: string;
  /** Whether the top-level object's closing brace was found. */
  closed: boolean;
}

/** Locate and clean the bundle JSON inside arbitrary text; null when no bundle starts. */
function scanBundle(text: string): BundleScan | null {
  const src = text.replace(/^\uFEFF/, '');
  const start = findBundleStart(src);
  if (start === -1) return null;
  const s = joinLines(src.slice(start));
  const parts: string[] = [];
  let from = 0;
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (c === 92) {
        escaped = true;
      } else if (c === 34) {
        inString = false;
      } else if (c < 0x20) {
        // A stray control character (form feed, NUL, tab...) is illegal raw in a JSON string.
        parts.push(s.slice(from, i), `\\u${c.toString(16).padStart(4, '0')}`);
        from = i + 1;
      }
    } else if (c === 34) {
      inString = true;
    } else if (c === 123 || c === 91) {
      depth++;
    } else if (c === 125 || c === 93) {
      depth--;
      if (depth === 0) {
        parts.push(s.slice(from, i + 1));
        return { json: parts.join(''), closed: true };
      }
    }
  }
  parts.push(s.slice(from));
  return { json: parts.join(''), closed: false };
}

/**
 * Recover the bundle JSON from pasted terminal output or a SQL*Plus spool
 * file, or null when no bundle start is found. Such text is rarely clean
 * JSON: prompt echo (`SQL> SQL>   2   3 ...`) can share a line with the
 * payload, marker and status lines sit around it, and the gather script emits
 * the bundle through DBMS_OUTPUT in chunks, so raw line breaks land inside the
 * JSON (even mid-string); terminals may also hard-wrap long lines and pad them
 * with trailing spaces. All legitimate newlines and tabs in values are escaped
 * (`\n`, `\t`) by the script, so raw line breaks carry no information and
 * removing them is lossless.
 *
 * The start is the first `{` followed (ignoring whitespace) by `"format"`,
 * else the first `{` that opens a line. From there line breaks and the
 * spaces/tabs before them are removed, then a JSON-aware scan finds the brace
 * that closes the top-level object and drops everything after it, escaping
 * raw control characters inside strings. When the object never closes, the
 * cleaned remainder is returned and `parseBundle` reports it as cut off.
 */
export function extractBundleJson(text: string): string | null {
  return scanBundle(text)?.json ?? null;
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

export const SUPPORTED_BUNDLE_VERSIONS = [1, 2, 3];

export function parseBundle(input: string): MetadataBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    const scan = scanBundle(input);
    if (!scan) {
      throw new Error(
        'No metadata bundle found in the pasted text — expected JSON starting with {"format":"ora-plan-metadata"…',
      );
    }
    if (!scan.closed) {
      throw new Error(
        'Metadata bundle looks cut off — the JSON ends before its closing brace. Copy everything up to the END marker (or the whole bundle.json).',
      );
    }
    try {
      parsed = JSON.parse(scan.json);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
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
  if (!SUPPORTED_BUNDLE_VERSIONS.includes(obj.version as number)) {
    throw new Error(
      `Bundle has unsupported version: ${String(obj.version)} (this build supports versions ${SUPPORTED_BUNDLE_VERSIONS.join(', ')})`,
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
