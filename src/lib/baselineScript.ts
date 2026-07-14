/**
 * Builds a self-contained SQL*Plus / SQLcl script that creates a SQL Plan
 * Baseline (via DBMS_SPM) for a given SQL_ID + plan hash value. Unlike
 * gatherScript.ts, there is no on-disk .sql template — the script is
 * assembled entirely from string sections in TypeScript, since its shape
 * (pre-checks, load block, verification, crib sheet) varies enough across
 * the three sources that a single template with swap regions would be more
 * confusing than helpful.
 *
 * The app never runs this script — it only ever hands the user text to copy
 * or download and run themselves in SQL*Plus/SQLcl against their database.
 */

export type BaselineSource = 'cursor_cache' | 'awr' | 'awr_sts';

export interface BaselineScriptOptions {
  sqlId: string;
  planHash: string;
  source: BaselineSource;
  fixed: boolean;
  enabled: boolean;
}

// Values land inside `DEFINE x = "..."` and `'&x'` / q'[...]' PL/SQL
// literals; strip anything that could escape either context. UI validation
// (SQL_ID: /^[a-z0-9]{1,13}$/i, plan hash: /^\d+$/) is stricter — this is a
// backstop, not the gatekeeper.
function sanitize(value: string): string {
  return value.replace(/["'&\r\n]/g, '');
}

function yesNo(flag: boolean): 'YES' | 'NO' {
  return flag ? 'YES' : 'NO';
}

function bannerLines(opts: BaselineScriptOptions): string[] {
  const lines = [
    '-- SQL Plan Baseline creation script, stamped by the Oracle Plan Visualizer.',
    '--',
    '-- What this does: loads the plan for the SQL_ID / plan hash value below',
    '-- into a SQL Plan Baseline via DBMS_SPM, so the optimizer prefers this',
    '-- exact plan shape for future executions of the statement.',
    '--',
    '-- Requires the ADMINISTER SQL MANAGEMENT OBJECT privilege.',
  ];
  if (opts.source === 'awr') {
    lines.push(
      '-- This AWR-direct variant additionally requires Oracle 19c or newer',
      '-- (DBMS_SPM.LOAD_PLANS_FROM_AWR) and the Diagnostics Pack license.',
    );
  } else if (opts.source === 'awr_sts') {
    lines.push(
      '-- This AWR-via-SQL-Tuning-Set variant works on Oracle 11.2 and newer',
      '-- and requires the Diagnostics Pack license.',
    );
  }
  lines.push('--', '-- Run this in SQL*Plus or SQLcl connected to the target database.');
  return lines;
}

function preCheckLines(opts: BaselineScriptOptions): string[] {
  const lines: string[] = [];

  if (opts.source === 'cursor_cache') {
    lines.push(
      'PROMPT === Pre-check: is the plan still in the cursor cache? ===',
      'SELECT sql_id, plan_hash_value, child_number, executions,',
      "       TO_CHAR(last_active_time, 'YYYY-MM-DD HH24:MI:SS') AS last_active",
      'FROM   v$sql',
      "WHERE  sql_id = '&sql_id'",
      'AND    plan_hash_value = &plan_hash;',
      '',
      'PROMPT If no rows came back above, the cursor has aged out of the shared',
      'PROMPT pool - re-generate this script with the AWR source instead.',
      '',
    );
  } else {
    // The two AWR routes read *different* AWR stores when connected to a
    // multitenant PDB (verified on 19.27): LOAD_PLANS_FROM_AWR accepts only
    // PDB-local (AWR_PDB) snapshots, while the STS route's
    // SELECT_WORKLOAD_REPOSITORY reads the CDB-root (AWR_ROOT) snapshots.
    // DBA_HIST_* shows both, so filter by dbid to list only usable ones.
    // In a non-CDB (and in CDB$ROOT) both contexts return the same dbid.
    const dbidContext = opts.source === 'awr' ? 'CON_DBID' : 'DBID';
    lines.push(
      'PROMPT === Pre-check: AWR snapshots containing this SQL_ID / plan ===',
      ...(opts.source === 'awr'
        ? [
            'PROMPT In a multitenant PDB only PDB-local (AWR_PDB) snapshots can be',
            'PROMPT loaded by DBMS_SPM.LOAD_PLANS_FROM_AWR - CDB-root snapshots are',
            'PROMPT excluded below. If the list is empty, create PDB snapshots with',
            'PROMPT DBMS_WORKLOAD_REPOSITORY.CREATE_SNAPSHOT while the statement runs,',
            'PROMPT or use the "AWR via SQL Tuning Set" variant, which reads the',
            'PROMPT CDB-root AWR instead.',
          ]
        : [
            'PROMPT In a multitenant PDB this variant reads the CDB-root AWR',
            'PROMPT (SELECT_WORKLOAD_REPOSITORY) - PDB-local snapshots are excluded',
            'PROMPT below.',
          ]),
      'SELECT s.snap_id,',
      "       TO_CHAR(sn.begin_interval_time, 'YYYY-MM-DD HH24:MI') AS begin_time,",
      "       TO_CHAR(sn.end_interval_time,   'YYYY-MM-DD HH24:MI') AS end_time,",
      '       s.plan_hash_value,',
      '       s.executions_delta',
      'FROM   dba_hist_sqlstat s',
      'JOIN   dba_hist_snapshot sn',
      '       ON sn.snap_id = s.snap_id AND sn.dbid = s.dbid AND sn.instance_number = s.instance_number',
      "WHERE  s.sql_id = '&sql_id'",
      'AND    s.plan_hash_value = &plan_hash',
      `AND    s.dbid = SYS_CONTEXT('USERENV', '${dbidContext}')`,
      'ORDER  BY s.snap_id;',
      '',
      "ACCEPT begin_snap NUMBER PROMPT 'Begin snapshot id (from the list above): '",
      "ACCEPT end_snap   NUMBER PROMPT 'End snapshot id: '",
      '',
    );
  }

  lines.push(
    'PROMPT === Existing baselines for this statement (if any) ===',
    'SELECT sql_handle, plan_name, enabled, accepted, fixed, origin,',
    "       TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS') AS created",
    'FROM   dba_sql_plan_baselines',
    'WHERE  signature IN (SELECT exact_matching_signature',
    '                     FROM   v$sql',
    "                     WHERE  sql_id = '&sql_id');",
  );

  if (opts.source !== 'cursor_cache') {
    lines.push(
      '',
      'PROMPT No rows here just means the cursor is no longer cached - the load',
      'PROMPT step below does not depend on it.',
    );
  }

  return lines;
}

function loadBlockLines(opts: BaselineScriptOptions): string[] {
  const fixed = yesNo(opts.fixed);
  const enabled = yesNo(opts.enabled);

  if (opts.source === 'cursor_cache') {
    return [
      'PROMPT === Loading the plan into a SQL Plan Baseline ===',
      'DECLARE',
      '  l_loaded  PLS_INTEGER;',
      'BEGIN',
      '  l_loaded := DBMS_SPM.LOAD_PLANS_FROM_CURSOR_CACHE(',
      "                sql_id          => '&sql_id',",
      '                plan_hash_value => &plan_hash,',
      `                fixed           => '${fixed}',`,
      `                enabled         => '${enabled}');`,
      "  DBMS_OUTPUT.PUT_LINE('Baseline plans loaded: ' || l_loaded);",
      '  IF l_loaded = 0 THEN',
      "    DBMS_OUTPUT.PUT_LINE('Nothing loaded - the cursor is probably no longer in the shared pool.');",
      "    DBMS_OUTPUT.PUT_LINE('Re-generate this script with the AWR source instead.');",
      '  END IF;',
      'END;',
      '/',
    ];
  }

  if (opts.source === 'awr') {
    return [
      'PROMPT === Loading the plan into a SQL Plan Baseline (from AWR) ===',
      'DECLARE',
      '  l_loaded  PLS_INTEGER;',
      'BEGIN',
      '  l_loaded := DBMS_SPM.LOAD_PLANS_FROM_AWR(',
      '                begin_snap   => &begin_snap,',
      '                end_snap     => &end_snap,',
      "                basic_filter => q'[sql_id = '&sql_id' AND plan_hash_value = &plan_hash]',",
      `                fixed        => '${fixed}',`,
      `                enabled      => '${enabled}');`,
      "  DBMS_OUTPUT.PUT_LINE('Baseline plans loaded: ' || l_loaded);",
      'END;',
      '/',
    ];
  }

  // awr_sts
  return [
    'PROMPT === Loading the plan into a SQL Plan Baseline (via temporary SQL Tuning Set) ===',
    'DECLARE',
    "  l_sts_name  VARCHAR2(128) := 'PLANVIZ_BL_&sql_id';",
    '  l_cursor    DBMS_SQLTUNE.SQLSET_CURSOR;',
    '  l_loaded    PLS_INTEGER;',
    'BEGIN',
    '  -- start clean if a previous run left the STS behind',
    '  BEGIN',
    '    DBMS_SQLTUNE.DROP_SQLSET(sqlset_name => l_sts_name);',
    '  EXCEPTION WHEN OTHERS THEN NULL;',
    '  END;',
    '',
    '  DBMS_SQLTUNE.CREATE_SQLSET(',
    '    sqlset_name => l_sts_name,',
    "    description => 'Temporary STS for plan baseline (Oracle Plan Visualizer)');",
    '',
    '  OPEN l_cursor FOR',
    '    SELECT VALUE(p)',
    '    FROM   TABLE(DBMS_SQLTUNE.SELECT_WORKLOAD_REPOSITORY(',
    '                   begin_snap     => &begin_snap,',
    '                   end_snap       => &end_snap,',
    "                   basic_filter   => q'[sql_id = '&sql_id' AND plan_hash_value = &plan_hash]',",
    "                   attribute_list => 'ALL')) p;",
    '',
    '  DBMS_SQLTUNE.LOAD_SQLSET(sqlset_name => l_sts_name, populate_cursor => l_cursor);',
    '',
    '  l_loaded := DBMS_SPM.LOAD_PLANS_FROM_SQLSET(',
    '                sqlset_name  => l_sts_name,',
    "                basic_filter => q'[plan_hash_value = &plan_hash]',",
    `                fixed        => '${fixed}',`,
    `                enabled      => '${enabled}');`,
    "  DBMS_OUTPUT.PUT_LINE('Baseline plans loaded: ' || l_loaded);",
    '',
    '  DBMS_SQLTUNE.DROP_SQLSET(sqlset_name => l_sts_name);',
    'END;',
    '/',
  ];
}

function verificationLines(): string[] {
  return [
    'PROMPT === Verification: baselines now present for this statement ===',
    'SELECT sql_handle, plan_name, enabled, accepted, fixed, origin,',
    "       TO_CHAR(created, 'YYYY-MM-DD HH24:MI:SS') AS created",
    'FROM   dba_sql_plan_baselines',
    'WHERE  created > SYSDATE - 1/24',
    'ORDER  BY created DESC;',
  ];
}

function cribSheetLines(): string[] {
  return [
    '-- ---------------------------------------------------------------------',
    '-- Managing this baseline later (informational - not executed by this script)',
    '-- ---------------------------------------------------------------------',
    '--',
    '-- Confirm a baseline is actually being used by a statement:',
    "--   SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_SQL_PLAN_BASELINE(sql_handle => 'SYS_SQL_...'));",
    "--   -- look for the note: \"SQL plan baseline SYS_SQL_PLAN_... used for this statement\"",
    '--   -- in DBMS_XPLAN.DISPLAY_CURSOR output for the statement.',
    '--',
    '-- Evolve a baseline (accept a better plan the optimizer has found):',
    '--   DECLARE',
    '--     l_report CLOB;',
    '--   BEGIN',
    "--     l_report := DBMS_SPM.EVOLVE_SQL_PLAN_BASELINE(sql_handle => 'SYS_SQL_...');",
    '--     DBMS_OUTPUT.PUT_LINE(l_report);',
    '--   END;',
    '--   /',
    '--',
    '-- Disable a baseline plan without dropping it:',
    '--   DECLARE',
    '--     l_count PLS_INTEGER;',
    '--   BEGIN',
    '--     l_count := DBMS_SPM.ALTER_SQL_PLAN_BASELINE(',
    "--                  sql_handle    => 'SYS_SQL_...',",
    "--                  plan_name     => 'SYS_SQL_PLAN_...',",
    "--                  attribute_name  => 'enabled',",
    "--                  attribute_value => 'NO');",
    '--   END;',
    '--   /',
    '--',
    '-- Drop a baseline plan:',
    '--   DECLARE',
    '--     l_count PLS_INTEGER;',
    '--   BEGIN',
    '--     l_count := DBMS_SPM.DROP_SQL_PLAN_BASELINE(',
    "--                  sql_handle => 'SYS_SQL_...',",
    "--                  plan_name  => 'SYS_SQL_PLAN_...');",
    '--   END;',
    '--   /',
  ];
}

export function buildBaselineScript(opts: BaselineScriptOptions): string {
  const sqlId = sanitize(opts.sqlId);
  const planHash = sanitize(opts.planHash);

  const lines: string[] = [
    ...bannerLines(opts),
    '',
    'SET SERVEROUTPUT ON SIZE UNLIMITED',
    'SET LINESIZE 200',
    'SET VERIFY OFF',
    '',
    `DEFINE sql_id    = "${sqlId}"`,
    `DEFINE plan_hash = "${planHash}"`,
    '',
    ...preCheckLines(opts),
    '',
    ...loadBlockLines(opts),
    '',
    ...verificationLines(),
    '',
    ...cribSheetLines(),
    '',
    'UNDEFINE sql_id',
    'UNDEFINE plan_hash',
  ];

  if (opts.source !== 'cursor_cache') {
    lines.push('UNDEFINE begin_snap', 'UNDEFINE end_snap');
  }

  return lines.join('\n');
}

export function baselineScriptFilename(opts: BaselineScriptOptions): string {
  const sqlId = sanitize(opts.sqlId).toLowerCase() || 'unknown';
  const planHash = sanitize(opts.planHash) || 'unknown';
  return `create_baseline_${sqlId}_${planHash}.sql`;
}
