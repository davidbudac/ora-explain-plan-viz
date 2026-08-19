# Getting a plan out of Oracle

How to produce each input format the visualizer accepts. Paste the output into the app (or drop the file onto the input box) and press **Cmd+Enter**.

| Format | Quick command | Runtime stats? | Predicates? |
|--------|---------------|:--------------:|:-----------:|
| [DBMS_XPLAN](#dbms_xplan) | `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&sql_id', NULL, 'ALLSTATS LAST'));` | With hint | Yes |
| [SQL Monitor (Text)](#sql-monitor-text) | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id=>'&sql_id', type=>'TEXT') FROM dual;` | Yes | No |
| [SQL Monitor (XML)](#sql-monitor-xml) | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id=>'&sql_id', type=>'XML', report_level=>'ALL') FROM dual;` | Yes | Yes |
| [JSON (V\$SQL_PLAN)](#json-vsql_plan) | `JSON_ARRAYAGG` query against `V$SQL_PLAN_STATISTICS_ALL` | Optional | Yes |
| [XBI (Tanel Poder)](#xbi-tanel-poder) | `@xbi &sql_id` | Yes | No |

Or skip copy/paste: [`scripts/plan_to_url.sql`](../scripts/plan_to_url.sql) builds a ready-to-click visualizer link inside the database (`@plan_to_url.sql <sql_id>`, read-only, 19c+). See [`scripts/README.md`](../scripts/README.md#plan_to_urlsql).

---

### DBMS_XPLAN

The standard Oracle execution plan output. Shows estimated rows, bytes, cost, and predicates. No runtime statistics.

**From the cursor cache** (plan must still be in memory):

```sql
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&sql_id', NULL, 'ALLSTATS LAST'));
```

To pick a specific plan when multiple child cursors exist:

```sql
-- List child cursors and their plan hash values
SELECT child_number, plan_hash_value
FROM V$SQL
WHERE sql_id = '&sql_id';

-- Then pass the child number explicitly
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&sql_id', &child_number, 'ALLSTATS LAST'));
```

**From AWR** (plan has aged out of the cursor cache but was captured by AWR):

```sql
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_AWR('&sql_id', &plan_hash_value, NULL, 'ALL'));
```

**From a plan table** (after running `EXPLAIN PLAN FOR ...`):

```sql
EXPLAIN PLAN FOR <your SQL statement>;
SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY(NULL, NULL, 'ALL'));
```

> **Tip**: The `'ALLSTATS LAST'` format includes runtime stats (actual rows, starts, buffers) if `STATISTICS_LEVEL = ALL` was set or the `/*+ GATHER_PLAN_STATISTICS */` hint was used when the statement executed.

---

### SQL Monitor (Text)

A text report with actual runtime statistics: A-Rows, A-Time, Starts, memory, temp space, and I/O. Available for statements that were monitored by Oracle (statements running longer than 5 seconds, parallel queries, or those with the `/*+ MONITOR */` hint).

**Requires**: `DBMS_SQL_MONITOR` (12c+) or `DBMS_SQLTUNE` (11g+), and the Tuning Pack license.

**By sql_id** (gets the most recent execution):

```sql
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(
  sql_id       => '&sql_id',
  type         => 'TEXT',
  report_level => 'ALL'
) FROM dual;
```

**By sql_id and specific execution** (use when the statement has run multiple times):

```sql
-- Find monitored executions
SELECT sql_exec_id, sql_exec_start, elapsed_time/1e6 AS elapsed_sec, status
FROM V$SQL_MONITOR
WHERE sql_id = '&sql_id'
ORDER BY sql_exec_start DESC;

-- Then target a specific execution
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(
  sql_id       => '&sql_id',
  sql_exec_id  => &sql_exec_id,
  type         => 'TEXT',
  report_level => 'ALL'
) FROM dual;
```

> **Note**: On 11g, use `DBMS_SQLTUNE.REPORT_SQL_MONITOR` instead of `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR` — the parameters are the same.

> **Limitation**: SQL Monitor text reports do not include access/filter predicates. If you need predicates alongside runtime stats, use the [XML format](#sql-monitor-xml) instead, or supplement with a DBMS_XPLAN call for the same `sql_id`.

---

### SQL Monitor (XML)

The richest format. Contains everything the text report has plus access/filter predicates, the full SQL text, bind variable values, and machine-readable metrics. **This is the recommended format** when you have the Tuning Pack license — it's the only SQL Monitor format that includes predicates.

**By sql_id** (most recent execution):

```sql
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(
  sql_id       => '&sql_id',
  type         => 'XML',
  report_level => 'ALL'
) FROM dual;
```

**By sql_id and specific execution**:

```sql
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(
  sql_id       => '&sql_id',
  sql_exec_id  => &sql_exec_id,
  type         => 'XML',
  report_level => 'ALL'
) FROM dual;
```

**Saving to a file** (useful for large plans that get truncated in SQL*Plus):

```sql
-- In SQL*Plus
SET LONG 10000000 LONGCHUNKSIZE 10000000 LINESIZE 32767 PAGESIZE 0 TRIMSPOOL ON
SPOOL /tmp/sql_monitor.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(
  sql_id       => '&sql_id',
  type         => 'XML',
  report_level => 'ALL'
) FROM dual;
SPOOL OFF
```

> **Note**: On 11g, use `DBMS_SQLTUNE.REPORT_SQL_MONITOR` instead.

> **Note on report size**: The `report_level` modifiers like `-ACTIVITY`, `-METRICS`, etc. [only affect `type => 'ACTIVE'`](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_SQL_MONITOR.html) (the interactive HTML report), not XML. The XML schema is fixed — Oracle always emits the full structure. For very large plans, spool to a file as shown above rather than trying to trim sections.

---

### JSON (V$SQL_PLAN)

A JSON array extracted from `V$SQL_PLAN_STATISTICS_ALL`. Compatible with formats used by [Datadog Explain Plans](https://explain.datadoghq.com) and similar tools.

**Extract plan as JSON** (requires 12c+ for JSON functions):

```sql
SELECT JSON_ARRAYAGG(
  JSON_OBJECT(
    'id'             VALUE id,
    'parent_id'      VALUE parent_id,
    'depth'          VALUE depth,
    'operation'      VALUE operation,
    'options'        VALUE options,
    'object_name'    VALUE object_name,
    'cardinality'    VALUE cardinality,
    'bytes'          VALUE bytes,
    'cost'           VALUE cost,
    'cpu_cost'       VALUE cpu_cost,
    'io_cost'        VALUE io_cost,
    'access_predicates' VALUE access_predicates,
    'filter_predicates' VALUE filter_predicates
  ) ORDER BY id
  RETURNING CLOB
)
FROM V$SQL_PLAN_STATISTICS_ALL
WHERE sql_id = '&sql_id'
  AND child_number = (
    SELECT MAX(child_number) FROM V$SQL_PLAN_STATISTICS_ALL WHERE sql_id = '&sql_id'
  );
```

---

### XBI (Tanel Poder)

Output from Tanel Poder's [`xbi.sql`](https://github.com/tanelpoder/tpt-oracle/blob/master/xbi.sql) script (eXplain Better). Includes self-elapsed time, logical/physical I/O, and memory stats per operation. Paste the SQL*Plus output directly.

**Running xbi.sql** (from Tanel Poder's TPT Oracle toolkit):

```sql
@xbi &sql_id
```

> **Prerequisite**: Download the [TPT Oracle toolkit](https://github.com/tanelpoder/tpt-oracle) and make sure it's on your SQL*Plus path.
