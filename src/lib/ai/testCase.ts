/**
 * Builds a self-contained SQL*Plus / SQLcl test-case script that recreates a
 * plan's referenced objects (empty) plus their optimizer statistics in a
 * scratch schema, so the optimizer can reproduce the plan without any
 * production data. Modeled on baselineScript.ts: no on-disk template — the
 * script is assembled from string sections in TypeScript.
 *
 * The app never runs this script — it only ever hands the user text to copy
 * or download and run themselves in SQL*Plus/SQLcl against a scratch schema.
 *
 * Everything here is deterministic: same plan + bundle in, same text out.
 */

import type { ParsedPlan, BindVariable } from '../types';
import type {
  ColumnStats,
  HistogramInfo,
  IndexObject,
  MetadataBundle,
  TableObject,
} from '../metadata/bundle';
import { findObjectInBundle } from '../metadata/lookup';

/** Bundle v3 histogram endpoint (optional field on HistogramInfo). */
export interface HistogramEndpoint {
  /** Endpoint value: number for numeric columns, string otherwise (already decoded by the gather script). */
  value: string | number;
  endpoint_number: number;
  /** HYBRID histograms: endpoint_repeat_count; omitted elsewhere. */
  repeat_count?: number;
}

type HistogramWithEndpoints = HistogramInfo & { endpoints?: HistogramEndpoint[] };

export interface TestCaseScriptOptions {
  plan: ParsedPlan;
  bundle: MetadataBundle;
  /** Schema to set stats against; defaults to the connected user (USER). */
  targetSchema?: string;
}

// Identifiers and values land in DDL, PL/SQL literals and comments; strip
// anything that could escape those contexts. This is a backstop — bundle
// content comes from the data dictionary and is normally already clean.
function sanitize(value: string): string {
  return value.replace(/["'&\r\n]/g, '');
}

/** Strip a leading "OWNER." from a bundle object key, keeping the bare name. */
function bareName(key: string): string {
  const dot = key.lastIndexOf('.');
  return sanitize(dot === -1 ? key : key.slice(dot + 1));
}

function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

interface SelectedObjects {
  tables: { key: string; object: TableObject }[];
  indexes: { key: string; object: IndexObject }[];
}

/**
 * Same selection logic as metadataProjection.ts: objects directly referenced
 * by plan lines, plus the indexes of referenced tables.
 */
function selectObjects(bundle: MetadataBundle, plan: ParsedPlan): SelectedObjects {
  const keys = new Set<string>();
  for (const node of plan.allNodes) {
    const found = findObjectInBundle(bundle, node.objectName);
    if (found) keys.add(found.key);
  }
  for (const key of [...keys]) {
    const object = bundle.objects[key];
    if (object.type !== 'TABLE') continue;
    for (const indexName of object.indexes) {
      const found = findObjectInBundle(bundle, indexName);
      if (found) keys.add(found.key);
    }
  }
  const tables: SelectedObjects['tables'] = [];
  const indexes: SelectedObjects['indexes'] = [];
  for (const key of [...keys].sort()) {
    const object = bundle.objects[key];
    if (object.type === 'TABLE') tables.push({ key, object });
    else indexes.push({ key, object });
  }
  return { tables, indexes };
}

// ---------------------------------------------------------------------------
// Section 1 — banner
// ---------------------------------------------------------------------------

function bannerLines(plan: ParsedPlan, bundle: MetadataBundle): string[] {
  const sqlId = bundle.plan_ref.sql_id ?? plan.sqlId ?? 'unknown';
  const planHash =
    bundle.plan_ref.plan_hash_value != null
      ? String(bundle.plan_ref.plan_hash_value)
      : plan.planHashValue ?? 'unknown';
  return [
    '-- Synthetic test case script, stamped by the Oracle Plan Visualizer.',
    '--',
    '-- What this does: recreates the tables and indexes referenced by the plan',
    '-- (EMPTY - no data) and sets their optimizer statistics from a gathered',
    '-- metadata bundle, so the optimizer can reproduce the original plan in a',
    '-- scratch schema without touching production data.',
    '--',
    `-- Source database : ${sanitize(bundle.source.db_name)} (Oracle ${sanitize(bundle.source.oracle_version)}, container ${sanitize(bundle.source.container_name)})`,
    `-- SQL_ID          : ${sanitize(sqlId)}`,
    `-- Plan hash value : ${sanitize(planHash)}`,
    '--',
    '-- SAFETY: run this ONLY in an empty scratch schema. It creates objects',
    '-- and overwrites their dictionary statistics; never run it in a schema',
    '-- that holds real objects of the same names.',
  ];
}

// ---------------------------------------------------------------------------
// Section 2 — DDL
// ---------------------------------------------------------------------------

function synthesizeCreateTable(name: string, object: TableObject): string[] {
  const cols = Object.entries(object.columns).map(([colName, stats], i, arr) => {
    const notNull = stats.nullable ? '' : ' NOT NULL';
    const comma = i < arr.length - 1 ? ',' : '';
    return `  ${sanitize(colName)} ${sanitize(stats.data_type)}${notNull}${comma}`;
  });
  return [
    `-- No DDL in the bundle for ${name}; synthesized from column metadata.`,
    `CREATE TABLE ${name} (`,
    ...cols,
    ');',
  ];
}

function synthesizeCreateIndex(name: string, object: IndexObject): string[] {
  const unique = object.stats.uniqueness === 'UNIQUE' ? 'UNIQUE ' : '';
  const cols = object.columns.map(sanitize).join(', ');
  return [
    `-- No DDL in the bundle for ${name}; synthesized from index columns.`,
    `CREATE ${unique}INDEX ${name} ON ${bareName(object.table)} (${cols});`,
  ];
}

function verbatimDdl(ddl: string): string[] {
  const trimmed = ddl.trim();
  return [trimmed.endsWith(';') || trimmed.endsWith('/') ? trimmed : `${trimmed};`];
}

function ddlLines(selected: SelectedObjects): string[] {
  const lines: string[] = ['PROMPT === Object DDL (empty tables + indexes) ==='];
  const tableNames = new Set(selected.tables.map((t) => bareName(t.key)));

  for (const { key, object } of selected.tables) {
    const name = bareName(key);
    lines.push('');
    if (object.ddl) lines.push(...verbatimDdl(object.ddl));
    else lines.push(...synthesizeCreateTable(name, object));
  }

  // Constraints after all tables exist, so FKs can resolve.
  for (const { key, object } of selected.tables) {
    const name = bareName(key);
    const c = object.constraints;
    if (!c) continue;
    if (c.primary_key) {
      lines.push(
        '',
        `ALTER TABLE ${name} ADD CONSTRAINT ${sanitize(c.primary_key.name)} PRIMARY KEY (${c.primary_key.columns.map(sanitize).join(', ')});`,
      );
    }
    for (const u of c.unique ?? []) {
      lines.push(
        '',
        `ALTER TABLE ${name} ADD CONSTRAINT ${sanitize(u.name)} UNIQUE (${u.columns.map(sanitize).join(', ')});`,
      );
    }
    for (const fk of c.foreign_keys ?? []) {
      const refTable = sanitize(fk.ref_table);
      if (!tableNames.has(refTable)) {
        lines.push(
          '',
          `-- Skipped FK ${sanitize(fk.name)} on ${name}: references ${refTable}, which is not part of this test case.`,
        );
        continue;
      }
      lines.push(
        '',
        `ALTER TABLE ${name} ADD CONSTRAINT ${sanitize(fk.name)} FOREIGN KEY (${fk.columns.map(sanitize).join(', ')}) REFERENCES ${refTable} (${fk.ref_columns.map(sanitize).join(', ')});`,
      );
    }
  }

  for (const { key, object } of selected.indexes) {
    const name = bareName(key);
    lines.push('');
    if (object.ddl) lines.push(...verbatimDdl(object.ddl));
    else lines.push(...synthesizeCreateIndex(name, object));
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Section 3 — statistics
// ---------------------------------------------------------------------------

function num(value: number | null | undefined): string {
  return value == null ? 'NULL' : String(value);
}

const MAX_CHAR_ENDPOINT = 32;

function histogramBlockLines(
  owner: string,
  tableName: string,
  colName: string,
  stats: ColumnStats,
  endpoints: HistogramEndpoint[],
): string[] {
  const hist = stats.histogram as HistogramWithEndpoints;
  const isNumeric = endpoints.every((e) => typeof e.value === 'number');
  const isString = endpoints.every((e) => typeof e.value === 'string');
  if (!isNumeric && !isString) {
    return [
      `-- Skipped histogram for ${tableName}.${colName}: mixed/unsupported endpoint value types.`,
    ];
  }

  // bkvals: per-bucket counts from endpoint_number deltas (cumulative in the dictionary).
  const bkvals: number[] = [];
  let prev = 0;
  for (const e of endpoints) {
    bkvals.push(e.endpoint_number - prev);
    prev = e.endpoint_number;
  }

  const valuesExpr = isNumeric
    ? `DBMS_STATS.NUMARRAY(${endpoints.map((e) => String(e.value)).join(', ')})`
    : `DBMS_STATS.CHARARRAY(${endpoints
        .map((e) => quoteSqlString(sanitize(String(e.value)).slice(0, MAX_CHAR_ENDPOINT)))
        .join(', ')})`;

  const lines = [
    `-- Histogram for ${tableName}.${colName}: ${hist.type} (${hist.buckets} buckets)`,
  ];
  if (hist.type === 'HYBRID' && endpoints.some((e) => e.repeat_count !== undefined)) {
    lines.push(
      `-- HYBRID endpoint repeat counts: ${endpoints.map((e) => e.repeat_count ?? 0).join(', ')}`,
    );
  }
  lines.push(
    'DECLARE',
    '  l_srec    DBMS_STATS.STATREC;',
    '  l_distcnt NUMBER;',
    '  l_density NUMBER;',
    '  l_nullcnt NUMBER;',
    '  l_avgclen NUMBER;',
    'BEGIN',
    `  DBMS_STATS.GET_COLUMN_STATS(ownname => ${owner}, tabname => '${tableName}', colname => '${colName}',`,
    '    distcnt => l_distcnt, density => l_density, nullcnt => l_nullcnt, srec => l_srec, avgclen => l_avgclen);',
    `  l_srec.bkvals := DBMS_STATS.NUMARRAY(${bkvals.join(', ')});`,
    '  l_srec.epc    := ' + String(endpoints.length) + ';',
    '  DBMS_STATS.PREPARE_COLUMN_VALUES(l_srec,',
    `    ${valuesExpr});`,
    `  DBMS_STATS.SET_COLUMN_STATS(ownname => ${owner}, tabname => '${tableName}', colname => '${colName}',`,
    '    distcnt => l_distcnt, density => l_density, nullcnt => l_nullcnt, srec => l_srec, avgclen => l_avgclen);',
    'END;',
    '/',
  );
  return lines;
}

function statsLines(selected: SelectedObjects, targetSchema?: string): string[] {
  const owner = targetSchema ? quoteSqlString(sanitize(targetSchema).toUpperCase()) : 'USER';
  const lines: string[] = ['PROMPT === Optimizer statistics ==='];

  for (const { key, object } of selected.tables) {
    const tableName = bareName(key);
    lines.push(
      '',
      'BEGIN',
      `  DBMS_STATS.SET_TABLE_STATS(ownname => ${owner}, tabname => '${tableName}',`,
      `    numrows => ${num(object.stats.num_rows)}, numblks => ${num(object.stats.blocks)}, avgrlen => ${num(object.stats.avg_row_len)});`,
      'END;',
      '/',
    );

    for (const [colName, stats] of Object.entries(object.columns)) {
      const safeCol = sanitize(colName);
      lines.push(
        '',
        'BEGIN',
        `  DBMS_STATS.SET_COLUMN_STATS(ownname => ${owner}, tabname => '${tableName}', colname => '${safeCol}',`,
        `    distcnt => ${num(stats.num_distinct)}, nullcnt => ${num(stats.num_nulls)}, density => ${num(stats.density)});`,
        'END;',
        '/',
      );
      const endpoints = (stats.histogram as HistogramWithEndpoints).endpoints;
      if (endpoints && endpoints.length > 0) {
        lines.push('', ...histogramBlockLines(owner, tableName, safeCol, stats, endpoints));
      }
    }
  }

  for (const { key, object } of selected.indexes) {
    const indexName = bareName(key);
    lines.push(
      '',
      'BEGIN',
      `  DBMS_STATS.SET_INDEX_STATS(ownname => ${owner}, indname => '${indexName}',`,
      `    numrows => ${num(object.stats.num_rows)}, numlblks => ${num(object.stats.leaf_blocks)}, numdist => ${num(object.stats.distinct_keys)},`,
      `    clstfct => ${num(object.stats.clustering_factor)}, indlevel => ${num(object.stats.blevel)});`,
      'END;',
      '/',
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Section 4 — optimizer environment
// ---------------------------------------------------------------------------

function needsQuoting(value: string): boolean {
  return !/^(\d+|TRUE|FALSE)$/i.test(value);
}

function optimizerEnvLines(bundle: MetadataBundle): string[] {
  const params = bundle.optimizer_env ?? [];
  const lines: string[] = ['PROMPT === Optimizer environment (non-default parameters) ==='];
  if (params.length === 0) {
    lines.push('-- No non-default optimizer environment parameters in the bundle.');
    return lines;
  }
  for (const param of params) {
    const name = sanitize(param.name);
    const rawValue = sanitize(param.value);
    const value = needsQuoting(rawValue) ? quoteSqlString(rawValue) : rawValue;
    if (name.startsWith('_')) {
      lines.push(
        '',
        `-- Underscore (hidden) parameter - review before enabling; left commented out.`,
        `-- ALTER SESSION SET "${name}" = ${value};`,
      );
      continue;
    }
    lines.push(
      '',
      `-- ${name} = ${rawValue}`,
      `ALTER SESSION SET "${name}" = ${value};`,
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Section 5 — the SQL + binds
// ---------------------------------------------------------------------------

function bindVariableType(type: string | undefined): string {
  const t = (type ?? '').toUpperCase();
  if (t.includes('NUMBER') || t.includes('FLOAT') || t.includes('BINARY')) return 'NUMBER';
  if (t.includes('DATE') || t.includes('TIMESTAMP')) return 'VARCHAR2(64)';
  if (t.includes('NVARCHAR')) return 'NVARCHAR2(4000)';
  if (t.includes('CLOB')) return 'CLOB';
  return 'VARCHAR2(4000)';
}

function bindLines(binds: BindVariable[]): string[] {
  const lines: string[] = [];
  for (const bind of binds) {
    const name = sanitize(bind.name).replace(/^:/, '');
    const sqlPlusType = bindVariableType(bind.type);
    lines.push(`VARIABLE ${name} ${sqlPlusType}`);
    if (bind.value != null) {
      const isNumber = sqlPlusType === 'NUMBER';
      const value = isNumber ? sanitize(bind.value) : quoteSqlString(bind.value);
      lines.push(`EXEC :${name} := ${value};`);
    } else {
      lines.push(`-- EXEC :${name} := ...;  (no captured value - fill in a representative one)`);
    }
  }
  return lines;
}

function sqlLines(plan: ParsedPlan): string[] {
  const lines: string[] = ['PROMPT === The SQL statement ==='];
  const binds = plan.bindVariables ?? [];
  if (binds.length > 0) {
    lines.push('', ...bindLines(binds));
  }
  lines.push('');
  if (plan.sqlText) {
    const sql = plan.sqlText.trim();
    lines.push(sql.endsWith(';') ? sql : `${sql};`);
  } else {
    lines.push('-- No SQL text captured with this plan - paste the statement here.');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Section 6 — verification
// ---------------------------------------------------------------------------

function verificationLines(plan: ParsedPlan, bundle: MetadataBundle): string[] {
  const planHash =
    bundle.plan_ref.plan_hash_value != null
      ? String(bundle.plan_ref.plan_hash_value)
      : plan.planHashValue ?? 'unknown';
  const lines: string[] = [
    'PROMPT === Verification: does the optimizer reproduce the plan? ===',
    '',
  ];
  if (plan.sqlText) {
    const sql = plan.sqlText.trim().replace(/;\s*$/, '');
    lines.push('EXPLAIN PLAN FOR', `${sql};`);
  } else {
    lines.push('-- EXPLAIN PLAN FOR <re-run the SQL statement from the section above>;');
  }
  lines.push(
    '',
    "SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(FORMAT => 'ALL'));",
    '',
    `-- Compare against the original plan hash value: ${sanitize(planHash)}`,
    '-- Plan hash values can differ across environments even for the same plan',
    '-- shape - compare operations, join order and access paths, not just the hash.',
  );
  return lines;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildTestCaseScript(opts: TestCaseScriptOptions): string {
  const { plan, bundle, targetSchema } = opts;
  const selected = selectObjects(bundle, plan);

  const lines: string[] = [
    ...bannerLines(plan, bundle),
    '',
    'SET SERVEROUTPUT ON SIZE UNLIMITED',
    'SET LINESIZE 200',
    'SET VERIFY OFF',
    '',
    ...ddlLines(selected),
    '',
    ...statsLines(selected, targetSchema),
    '',
    ...optimizerEnvLines(bundle),
    '',
    ...sqlLines(plan),
    '',
    ...verificationLines(plan, bundle),
  ];
  return lines.join('\n');
}

export function testCaseScriptFilename(plan: ParsedPlan): string {
  const sqlId = sanitize(plan.sqlId ?? '').toLowerCase() || 'unknown';
  const planHash = sanitize(plan.planHashValue ?? '') || 'unknown';
  return `test_case_${sqlId}_${planHash}.sql`;
}
