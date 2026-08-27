/**
 * Minimal JS re-implementation of the metadata gather contract for the eval
 * scratch schema: reads user_tables / user_tab_cols / user_tab_col_statistics
 * / user_tab_histograms / user_indexes / user_ind_columns / user_constraints
 * and produces a valid version-3 `ora-plan-metadata` bundle.
 *
 * Only meant for the harness's own EVAL_ objects in the connected schema —
 * production gathering stays with scripts/gather_plan_metadata.sql.
 */

import type {
  ColumnStats,
  HistogramEndpoint,
  HistogramInfo,
  IndexObject,
  MetadataBundle,
  MetadataObject,
  TableConstraints,
  TableObject,
} from '../../src/lib/metadata/bundle';
import type { DbConnection } from './db';

type Row = unknown[];

async function rows(conn: DbConnection, sql: string, binds: unknown[] = []): Promise<Row[]> {
  const result = await conn.execute(sql, binds);
  return (result.rows ?? []) as Row[];
}

function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

function numOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}

function columnDataType(
  dataType: string,
  charLength: unknown,
  precision: unknown,
  scale: unknown,
): string {
  if (['VARCHAR2', 'CHAR', 'NVARCHAR2', 'NCHAR', 'RAW'].includes(dataType)) {
    return `${dataType}(${Number(charLength)})`;
  }
  if (dataType === 'NUMBER' && precision != null) {
    return scale != null && Number(scale) !== 0
      ? `NUMBER(${Number(precision)},${Number(scale)})`
      : `NUMBER(${Number(precision)})`;
  }
  return dataType;
}

async function gatherHistogram(
  conn: DbConnection,
  tableName: string,
  columnName: string,
  histogramType: string,
  numBuckets: number | null,
  isNumeric: boolean,
): Promise<HistogramInfo> {
  const type = (histogramType || 'NONE') as HistogramInfo['type'];
  const info: HistogramInfo = { type, buckets: numBuckets ?? 0 };
  if (type === 'NONE') return info;

  const endpointRows = await rows(
    conn,
    `SELECT endpoint_number, endpoint_value, endpoint_actual_value, endpoint_repeat_count
       FROM user_tab_histograms
      WHERE table_name = :1 AND column_name = :2
      ORDER BY endpoint_number
      FETCH FIRST 254 ROWS ONLY`,
    [tableName, columnName],
  );

  const endpoints: HistogramEndpoint[] = endpointRows.map((row) => {
    const [endpointNumber, endpointValue, actualValue, repeatCount] = row;
    // Same decode as the gather script: endpoint_actual_value when present,
    // else the numeric endpoint_value. Numeric columns carry numbers.
    const value: string | number = isNumeric
      ? Number(endpointValue)
      : (str(actualValue) ?? Number(endpointValue));
    const endpoint: HistogramEndpoint = {
      value,
      endpoint_number: Number(endpointNumber),
    };
    if (type === 'HYBRID' && repeatCount != null) {
      endpoint.repeat_count = Number(repeatCount);
    }
    return endpoint;
  });

  if (endpoints.length > 0) info.endpoints = endpoints;
  return info;
}

async function gatherColumns(
  conn: DbConnection,
  tableName: string,
): Promise<Record<string, ColumnStats>> {
  const colRows = await rows(
    conn,
    `SELECT c.column_name, c.data_type, c.char_length, c.data_precision, c.data_scale,
            c.nullable,
            s.num_distinct, s.num_nulls, s.density, s.histogram, s.num_buckets,
            CASE WHEN c.data_type = 'NUMBER' THEN TO_CHAR(UTL_RAW.CAST_TO_NUMBER(s.low_value))
                 WHEN c.data_type IN ('VARCHAR2','CHAR') THEN UTL_RAW.CAST_TO_VARCHAR2(s.low_value)
                 ELSE RAWTOHEX(s.low_value) END AS low_value,
            CASE WHEN c.data_type = 'NUMBER' THEN TO_CHAR(UTL_RAW.CAST_TO_NUMBER(s.high_value))
                 WHEN c.data_type IN ('VARCHAR2','CHAR') THEN UTL_RAW.CAST_TO_VARCHAR2(s.high_value)
                 ELSE RAWTOHEX(s.high_value) END AS high_value
       FROM user_tab_cols c
       LEFT JOIN user_tab_col_statistics s
         ON s.table_name = c.table_name AND s.column_name = c.column_name
      WHERE c.table_name = :1 AND c.hidden_column = 'NO'
      ORDER BY c.column_id`,
    [tableName],
  );

  const columns: Record<string, ColumnStats> = {};
  for (const row of colRows) {
    const [
      columnName, dataType, charLength, precision, scale, nullable,
      numDistinct, numNulls, density, histogramType, numBuckets, lowValue, highValue,
    ] = row;
    const name = String(columnName);
    const isNumeric = String(dataType) === 'NUMBER';
    columns[name] = {
      data_type: columnDataType(String(dataType), charLength, precision, scale),
      nullable: String(nullable) === 'Y',
      num_distinct: numOrNull(numDistinct),
      num_nulls: numOrNull(numNulls),
      low_value: str(lowValue),
      high_value: str(highValue),
      density: numOrNull(density),
      histogram: await gatherHistogram(
        conn, tableName, name, str(histogramType) ?? 'NONE', numOrNull(numBuckets), isNumeric,
      ),
    };
  }
  return columns;
}

interface ConstraintGather {
  constraints: TableConstraints;
  /** Names of indexes backing PK/UNIQUE constraints (excluded from `indexes`). */
  constraintIndexes: Set<string>;
}

async function gatherConstraints(conn: DbConnection, tableName: string): Promise<ConstraintGather> {
  const consRows = await rows(
    conn,
    `SELECT c.constraint_name, c.constraint_type, c.index_name, c.search_condition_vc,
            c.generated, c.delete_rule, r.owner AS ref_owner, r.table_name AS ref_table,
            c.r_constraint_name
       FROM user_constraints c
       LEFT JOIN all_constraints r
         ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name
      WHERE c.table_name = :1 AND c.constraint_type IN ('P','U','R','C')
      ORDER BY c.constraint_name`,
    [tableName],
  );

  const colsFor = async (constraintName: string, owner?: string): Promise<string[]> => {
    const view = owner ? 'all_cons_columns' : 'user_cons_columns';
    const where = owner ? 'owner = :2 AND ' : '';
    const binds = owner ? [constraintName, owner] : [constraintName];
    const colRows = await rows(
      conn,
      `SELECT column_name FROM ${view} WHERE ${where}constraint_name = :1 ORDER BY position`,
      binds,
    );
    return colRows.map((r) => String(r[0]));
  };

  const constraints: TableConstraints = { unique: [], foreign_keys: [], checks: [] };
  const constraintIndexes = new Set<string>();

  for (const row of consRows) {
    const [name, type, indexName, condition, generated, deleteRule, refOwner, refTable, refConstraint] = row;
    const constraintName = String(name);
    if (type === 'P' || type === 'U') {
      if (indexName != null) constraintIndexes.add(String(indexName));
      const entry = { name: constraintName, columns: await colsFor(constraintName) };
      if (type === 'P') constraints.primary_key = entry;
      else constraints.unique!.push(entry);
    } else if (type === 'R') {
      constraints.foreign_keys!.push({
        name: constraintName,
        columns: await colsFor(constraintName),
        ref_owner: str(refOwner) ?? '',
        ref_table: str(refTable) ?? '',
        ref_columns: refConstraint != null && refOwner != null
          ? await colsFor(String(refConstraint), String(refOwner))
          : [],
        delete_rule: str(deleteRule) ?? 'NO ACTION',
      });
    } else if (type === 'C') {
      constraints.checks!.push({
        name: constraintName,
        condition: str(condition),
        generated: String(generated) === 'GENERATED NAME',
      });
    }
  }
  return { constraints, constraintIndexes };
}

async function gatherIndexes(
  conn: DbConnection,
  tableName: string,
  constraintIndexes: Set<string>,
): Promise<Record<string, IndexObject>> {
  const indexRows = await rows(
    conn,
    `SELECT index_name, uniqueness, index_type, status, visibility, partitioned,
            clustering_factor, blevel, leaf_blocks, distinct_keys, num_rows,
            TO_CHAR(last_analyzed, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_analyzed
       FROM user_indexes
      WHERE table_name = :1
      ORDER BY index_name`,
    [tableName],
  );

  const indexes: Record<string, IndexObject> = {};
  for (const row of indexRows) {
    const [name, uniqueness, indexType, status, visibility, partitioned,
      clusteringFactor, blevel, leafBlocks, distinctKeys, numRows, lastAnalyzed] = row;
    const indexName = String(name);
    if (constraintIndexes.has(indexName)) continue;
    const colRows = await rows(
      conn,
      `SELECT column_name FROM user_ind_columns WHERE index_name = :1 ORDER BY column_position`,
      [indexName],
    );
    indexes[indexName] = {
      type: 'INDEX',
      table: tableName,
      columns: colRows.map((r) => String(r[0])),
      stats: {
        uniqueness: String(uniqueness) as IndexObject['stats']['uniqueness'],
        index_type: String(indexType),
        status: String(status),
        visibility: String(visibility) as IndexObject['stats']['visibility'],
        partitioned: String(partitioned) === 'YES',
        clustering_factor: numOrNull(clusteringFactor),
        blevel: numOrNull(blevel),
        leaf_blocks: numOrNull(leafBlocks),
        distinct_keys: numOrNull(distinctKeys),
        num_rows: numOrNull(numRows),
        last_analyzed: str(lastAnalyzed),
      },
    };
  }
  return indexes;
}

/**
 * Gather a version-3 metadata bundle for the given tables in the connected
 * (eval scratch) schema.
 */
export async function gatherBundle(
  conn: DbConnection,
  tableNames: string[],
): Promise<MetadataBundle> {
  const sourceRows = await rows(
    conn,
    `SELECT SYS_CONTEXT('userenv','db_name'), SYS_CONTEXT('userenv','con_name') FROM dual`,
  );
  let oracleVersion = 'unknown';
  try {
    const versionRows = await rows(
      conn,
      `SELECT version_full FROM product_component_version FETCH FIRST 1 ROWS ONLY`,
    );
    if (versionRows[0]?.[0] != null) oracleVersion = String(versionRows[0][0]);
  } catch {
    // View or column unavailable — keep 'unknown'.
  }

  const objects: Record<string, MetadataObject> = {};
  const coverageWarnings: MetadataBundle['coverage_warnings'] = [];

  for (const rawName of tableNames) {
    const tableName = rawName.toUpperCase();
    const tableRows = await rows(
      conn,
      `SELECT num_rows, blocks, avg_row_len, partitioned,
              TO_CHAR(last_analyzed, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_analyzed
         FROM user_tables WHERE table_name = :1`,
      [tableName],
    );
    if (tableRows.length === 0) {
      coverageWarnings.push({ object: tableName, reason: 'Table not found in USER_TABLES' });
      continue;
    }
    const [numRows, blocks, avgRowLen, partitioned, lastAnalyzed] = tableRows[0];
    const { constraints, constraintIndexes } = await gatherConstraints(conn, tableName);
    const indexes = await gatherIndexes(conn, tableName, constraintIndexes);

    const table: TableObject = {
      type: 'TABLE',
      stats: {
        num_rows: numOrNull(numRows),
        blocks: numOrNull(blocks),
        avg_row_len: numOrNull(avgRowLen),
        last_analyzed: str(lastAnalyzed),
        stale_stats: null,
        partitioned: String(partitioned) === 'YES',
      },
      columns: await gatherColumns(conn, tableName),
      indexes: Object.keys(indexes),
      constraints,
    };
    objects[tableName] = table;
    for (const [indexName, index] of Object.entries(indexes)) {
      objects[indexName] = index;
    }
  }

  return {
    format: 'ora-plan-metadata',
    version: 3,
    captured_at: new Date().toISOString(),
    source: {
      db_name: str(sourceRows[0]?.[0]) ?? 'unknown',
      oracle_version: oracleVersion,
      container_name: str(sourceRows[0]?.[1]) ?? '',
    },
    plan_ref: { sql_id: null, plan_hash_value: null },
    objects,
    coverage_warnings: coverageWarnings,
  };
}
