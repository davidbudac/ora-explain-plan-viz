# Data requests

How to ask the user for data the analysis still needs, and the read-only SQL that fetches it.

## Writing a request

Ask when the answer could change a recommendation; leave out anything you would only like to know. Send every request in one numbered list. For each:

1. **What** you need.
2. **Why**: the conclusion it decides ("tells whether line 4's underestimate comes from skew or from stale statistics").
3. **The exact SQL**, with the real SQL_ID, owner and table names from the plan filled in, so the user can paste and run it unchanged in SQL*Plus or SQLcl.
4. **What to send back**: the full output, or the spooled file.

Keep requests read-only. A request that re-runs the statement (for runtime statistics) says so, since it costs a full execution; for DML, wrap it in a transaction the user rolls back.

`V$ACTIVE_SESSION_HISTORY`, the `DBA_HIST_*` views and `DISPLAY_AWR` need the Diagnostics Pack licence; SQL Monitor reports need the Tuning Pack. Ask whether the user is licensed before requesting them, and offer the licence-free alternative.

When the user works in Oracle Plan Visualizer, a new plan or metadata bundle can be loaded there and a fresh handoff exported: the app then parses it for you.

Placeholders below are `<SQL_ID>`, `<CHILD>`, `<PLAN_HASH>`, `<OWNER>`, `<TABLE>`, `<COLUMN>`.

## Runtime statistics

Needed when the plan has estimates only, or to see one execution's actual rows, time, buffers and reads per line.

```sql
-- SERVEROUTPUT must be off BEFORE the statement runs: otherwise SQL*Plus's own
-- DBMS_OUTPUT call becomes the "last statement" that DISPLAY_CURSOR(NULL, NULL) shows.
SET SERVEROUTPUT OFF LINESIZE 300 PAGESIZE 0 LONG 1000000

-- Re-run the statement once in this session, with this hint added
-- (or first: ALTER SESSION SET statistics_level = ALL;):
SELECT /*+ GATHER_PLAN_STATISTICS */ ... ;

SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(NULL, NULL, 'ADVANCED ALLSTATS LAST'));
```

For a cursor still in the shared pool that ran with statistics: `DBMS_XPLAN.DISPLAY_CURSOR('<SQL_ID>', <CHILD>, 'ADVANCED ALLSTATS LAST')`. `ADVANCED` adds the outline, peeked binds, column projection and (19c+) the hint report.

## SQL Monitor report

The best source for a long-running or parallel statement: per-line actuals, waits and parallel servers, without re-running it. Tuning Pack.

```sql
SET LONG 100000000 LONGCHUNKSIZE 100000000 LINESIZE 32767 PAGESIZE 0 TRIMSPOOL ON
SPOOL sql_monitor.html
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '<SQL_ID>', type => 'ACTIVE', report_level => 'ALL') FROM dual;
SPOOL OFF
```

`type => 'XML'` gives the same data as XML. On 11g use `DBMS_SQLTUNE.REPORT_SQL_MONITOR`. List monitored executions with `SELECT sql_exec_id, sql_exec_start, elapsed_time/1e6 AS sec, status FROM v$sql_monitor WHERE sql_id = '<SQL_ID>' ORDER BY sql_exec_start DESC;` and pass `sql_exec_id => ...` to pick one.

## Schema metadata in one step

Table, column and index statistics, histograms, partitioning, constraints, DDL, the optimizer environment, and any baselines, profiles, patches or plan directives for the statement: Oracle Plan Visualizer's gather script (in the app: Metadata, then Gather script; or `scripts/gather_plan_metadata.sql` in the project's GitHub repository). Read-only, Oracle 12.2+.

```sql
@gather_plan_metadata.sql <SQL_ID> <PLAN_HASH> bundle.json
```

The user attaches `bundle.json` to the plan in the app and exports a new handoff, or pastes the JSON.

## Table statistics

```sql
SELECT table_name, partition_name, object_type, num_rows, blocks, avg_row_len,
       last_analyzed, stale_stats, stattype_locked
FROM dba_tab_statistics
WHERE owner = '<OWNER>' AND table_name = '<TABLE>'
ORDER BY partition_position NULLS FIRST;
```

## Column statistics and histograms

```sql
SELECT column_name, num_distinct, num_nulls, density, histogram, num_buckets,
       sample_size, last_analyzed
FROM dba_tab_col_statistics
WHERE owner = '<OWNER>' AND table_name = '<TABLE>'
ORDER BY column_name;

SELECT extension_name, extension
FROM dba_stat_extensions
WHERE owner = '<OWNER>' AND table_name = '<TABLE>';
```

## Indexes

```sql
SELECT i.index_name, i.index_type, i.uniqueness, i.status, i.visibility,
       i.blevel, i.leaf_blocks, i.distinct_keys, i.clustering_factor, i.num_rows, i.last_analyzed,
       LISTAGG(c.column_name, ', ') WITHIN GROUP (ORDER BY c.column_position) AS index_columns
FROM dba_indexes i
JOIN dba_ind_columns c ON c.index_owner = i.owner AND c.index_name = i.index_name
WHERE i.table_owner = '<OWNER>' AND i.table_name = '<TABLE>'
GROUP BY i.index_name, i.index_type, i.uniqueness, i.status, i.visibility,
         i.blevel, i.leaf_blocks, i.distinct_keys, i.clustering_factor, i.num_rows, i.last_analyzed
ORDER BY i.index_name;
```

Function-based index expressions are in `DBA_IND_EXPRESSIONS`.

## Data distribution

Settles whether a column is skewed. This reads table data: on a large table keep the `SAMPLE` clause and warn the user about the cost.

```sql
SELECT <COLUMN>, COUNT(*) AS cnt
FROM <OWNER>.<TABLE> SAMPLE (1)
GROUP BY <COLUMN>
ORDER BY cnt DESC
FETCH FIRST 20 ROWS ONLY;
```

## Execution history and child cursors

Executions, time and work per execution, and plan control in use, per child cursor:

```sql
SELECT child_number, plan_hash_value, executions,
       ROUND(elapsed_time / NULLIF(executions, 0) / 1e6, 3) AS sec_per_exec,
       ROUND(buffer_gets / NULLIF(executions, 0)) AS gets_per_exec,
       ROUND(rows_processed / NULLIF(executions, 0)) AS rows_per_exec,
       is_bind_sensitive, is_bind_aware, sql_plan_baseline, sql_profile, sql_patch, last_active_time
FROM v$sql
WHERE sql_id = '<SQL_ID>'
ORDER BY last_active_time DESC;
```

Why child cursors split: `SELECT * FROM v$sql_shared_cursor WHERE sql_id = '<SQL_ID>';` (columns set to `Y` name the reason).

## Plan history (regressions)

Per-snapshot performance by plan hash value. Diagnostics Pack.

```sql
SELECT s.snap_id, TO_CHAR(sn.begin_interval_time, 'YYYY-MM-DD HH24:MI') AS snap_time,
       s.plan_hash_value, s.executions_delta AS execs,
       ROUND(s.elapsed_time_delta / NULLIF(s.executions_delta, 0) / 1e6, 3) AS sec_per_exec,
       ROUND(s.buffer_gets_delta / NULLIF(s.executions_delta, 0)) AS gets_per_exec,
       ROUND(s.rows_processed_delta / NULLIF(s.executions_delta, 0)) AS rows_per_exec
FROM dba_hist_sqlstat s
JOIN dba_hist_snapshot sn
  ON sn.snap_id = s.snap_id AND sn.dbid = s.dbid AND sn.instance_number = s.instance_number
WHERE s.sql_id = '<SQL_ID>'
ORDER BY s.snap_id;
```

An older plan: `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_AWR('<SQL_ID>', <PLAN_HASH>, NULL, 'ADVANCED'));`

## Bind values

```sql
SELECT child_number, position, name, datatype_string, value_string, last_captured
FROM v$sql_bind_capture
WHERE sql_id = '<SQL_ID>'
ORDER BY child_number, position;
```

Captures are sampled (at most every 15 minutes by default); the peeked values the plan was built with come from `DISPLAY_CURSOR` with `+PEEKED_BINDS` (part of `ADVANCED`).

## Optimizer environment

Non-default optimizer parameters the cursor was built with:

```sql
SELECT name, value
FROM v$sql_optimizer_env
WHERE sql_id = '<SQL_ID>' AND child_number = <CHILD> AND isdefault = 'NO'
ORDER BY name;
```

## Waits per plan line

Where a statement waited, by plan line, over the last hour. Diagnostics Pack.

```sql
SELECT sql_plan_line_id, sql_plan_operation || ' ' || sql_plan_options AS operation,
       NVL(event, 'ON CPU') AS event, COUNT(*) AS samples
FROM v$active_session_history
WHERE sql_id = '<SQL_ID>' AND sample_time > SYSTIMESTAMP - INTERVAL '1' HOUR
GROUP BY sql_plan_line_id, sql_plan_operation, sql_plan_options, event
ORDER BY samples DESC
FETCH FIRST 20 ROWS ONLY;
```

## Plan control objects

Baselines, profiles and patches matching the statement:

```sql
SELECT 'BASELINE' AS kind, plan_name AS name, enabled, accepted AS status, created
FROM dba_sql_plan_baselines
WHERE signature = (SELECT exact_matching_signature FROM v$sql WHERE sql_id = '<SQL_ID>' AND ROWNUM = 1)
UNION ALL
SELECT 'PROFILE', name, NULL, status, created
FROM dba_sql_profiles
WHERE signature = (SELECT exact_matching_signature FROM v$sql WHERE sql_id = '<SQL_ID>' AND ROWNUM = 1)
UNION ALL
SELECT 'PATCH', name, NULL, status, created
FROM dba_sql_patches
WHERE signature = (SELECT exact_matching_signature FROM v$sql WHERE sql_id = '<SQL_ID>' AND ROWNUM = 1);
```

## Questions only the user can answer

- How is the statement called: from which application, how many times per request, with what fetch size?
- What changed when it got slow: a release, a statistics job, data growth, an upgrade?
- What is acceptable: a target elapsed time, or "as fast as it was last week"?
- Can the SQL text be changed, or only plan control (patch, baseline, profile) and statistics?
