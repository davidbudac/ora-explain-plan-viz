# Oracle Execution Plan Visualizer

**[Open the App](https://davidbudac.github.io/ora-explain-plan-viz/)** - runs entirely in your browser, no data leaves your machine.

Turn Oracle execution plans into interactive visualizations. Paste your DBMS_XPLAN output, SQL Monitor report, or JSON plan data - the tool auto-detects the format and renders it instantly.

> No backend. No account. No data upload. Everything stays in your browser.

---

## Supported Input Formats

Paste any of the formats below directly into the input panel and press **Cmd+Enter** (or click Parse). The tool auto-detects the format.

| Format | Quick command | Runtime stats? | Predicates? |
|--------|---------------|:--------------:|:-----------:|
| [DBMS_XPLAN](#dbms_xplan) | `SELECT * FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR('&sql_id', NULL, 'ALLSTATS LAST'));` | With hint | Yes |
| [SQL Monitor (Text)](#sql-monitor-text) | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id=>'&sql_id', type=>'TEXT') FROM dual;` | Yes | No |
| [SQL Monitor (XML)](#sql-monitor-xml) | `SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id=>'&sql_id', type=>'XML', report_level=>'ALL') FROM dual;` | Yes | Yes |
| [JSON (V\$SQL_PLAN)](#json-vsql_plan) | `JSON_ARRAYAGG` query against `V$SQL_PLAN_STATISTICS_ALL` — [see details](#json-vsql_plan) | Optional | Yes |
| [XBI (Tanel Poder)](#xbi-tanel-poder) | `@xbi &sql_id` | Yes | No |

Don't have a plan handy? Pick one from the **Examples** dropdown to try the tool immediately.

### Generate a link from the database

Skip copy/paste entirely: [`scripts/plan_to_url.sql`](scripts/plan_to_url.sql)
fetches a plan for a `sql_id`, compresses and encodes it inside the database,
and prints a ready-to-click URL that opens straight into the visualizer with
the plan pre-loaded.

```sql
SQL> @plan_to_url.sql an05rsj1up1k5
```

It's fully read-only (SQL*Plus/SQLcl, Oracle 19c+) and supports both the
cursor cache (default) and SQL Monitor reports (`@plan_to_url.sql <sql_id> "" MONITOR`,
requires the Tuning Pack license). See [`scripts/README.md`](scripts/README.md#plan_to_urlsql)
for arguments, privileges, and limitations.

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

## What You Can Do

### Visualize

Five ways to look at your plan:

- **Tree View** - interactive hierarchical layout with animated edges showing data flow. Drag nodes, zoom, pan, and navigate with arrow keys.
- **Sankey Diagram** - flow visualization showing data volume between operations. Toggle between Rows, Cost, A-Rows, or A-Time to see where work concentrates.
- **Table View** - sortable spreadsheet with inline bar charts for cost and time. Collapse subtrees to focus on specific branches. Hover operations to see predicates.
- **Plan Text** - the raw plan output for quick reference and copy-paste.
- **SQL Tab** - see the full SQL text when available from SQL Monitor input.

### Find Problems Fast

**Quick Analysis** surfaces issues automatically when runtime stats are available:

- **Hotspot detection** - the slowest node gets a red ring and "Hotspot" badge so it's immediately visible in the tree. The side panel shows the top 5 nodes by time and cost.
- **Cardinality mismatches** - nodes where actual rows diverge significantly from estimated rows are flagged with severity badges (warning at 3x, bad at 10x). Use the filter slider to isolate only mismatched nodes.
- **Spill-to-disk warnings** - nodes using temp space are badged so you can spot memory pressure.
- **Operation tooltips** - hover any node to see an expert description of what that Oracle operation does.

### Compare Two Plans

Load a plan into Plan A, then switch to Plan B and load another. Click **Compare** to see them side by side:

- Nodes are automatically matched between plans (by ID and heuristic matching)
- Delta calculations show improvements and regressions across cost, rows, bytes, A-Rows, A-Time, starts, temp space, and memory
- Split tree view shows both plans simultaneously with matched nodes aligned

### Annotate and Share

Build up an analysis and share it with your team:

- **Highlight nodes** with colors (red, orange, yellow, green, blue, purple, pink) in multiple visual styles: circle, tint, glow, dot, underline, or hachure
- **Add text notes** to individual nodes with timestamps
- **Group nodes** into named annotation groups with a shared color and description
- **Multi-select** nodes with Cmd/Ctrl-click to highlight or annotate in bulk
- **Export** the full annotated plan as JSON - import it on another machine to see the same analysis
- **Export as PNG** to share a snapshot of the visualization
- **Share via URL** to send a plan link that opens with your data pre-loaded

### Filter and Search

- **Search** by operation name, object name, or predicate text - matches are highlighted in the tree
- **Filter by operation type** - show only joins, table accesses, sorts, etc.
- **Filter by metric ranges** - cost, rows, A-Rows, A-Time sliders to narrow down to expensive operations
- **Filter by predicate type** - show only nodes with access or filter predicates
- **Cardinality mismatch slider** - set a threshold to show only nodes where estimates diverge from actuals

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Cmd+K** | Open command palette (search all actions) |
| **Cmd+Enter** | Parse the plan input |
| **F** | Maximize / restore the visualization |
| **Arrow keys** | Navigate between nodes (tree and table views) |
| **Cmd/Ctrl+Click** | Multi-select nodes |
| **Escape** | Deselect all nodes |

The **Cmd+K command palette** is the fastest way to access everything: switch views, toggle display options, change themes, export, and more. It stays open after toggling so you can change multiple settings in one go.

## Customize the Display

Open **Customize View** (or press Cmd+K) to control what's shown on each node:

- **Node fields**: operation name, object name, rows, cost, bytes, predicates, query blocks
- **Runtime fields**: A-Rows, A-Time, starts (only when actual stats are available)
- **Warning badges**: hotspot indicator, spill-to-disk, cardinality mismatch
- **Annotation visibility**: show or hide highlights and notes
- **Node metric badges**: pick what number appears on each node (cost, A-Rows, A-Time, starts, activity %)

Four color schemes are available: **Muted** (default), **Vibrant**, **Professional**, **Readable** (high-contrast with bold left-border stripes), and **Monochrome**. Switch between light and dark mode with the theme toggle.

All preferences are saved to your browser and persist between sessions.

## Run It Locally

```bash
git clone https://github.com/davidbudac/ora-explain-plan-viz.git
cd ora-explain-plan-viz
npm install
npm run dev
```

Open http://localhost:5173/

## Connect to a Database (optional, self-hosted builds)

Instead of copy/pasting plan text, self-hosted and dev builds can fetch plans
(and object metadata) straight from your Oracle database through
[`oraplanviz-agent`](https://github.com/davidbudac/oraplanviz-agent) — a small
Python companion you run on **your own machine**:

```bash
pipx install oraplanviz-agent   # single dependency: python-oracledb (thin mode)
oraplanviz-agent                # prints a URL + bearer token
```

Build or run the app with the feature flag, then use the **DB Connect** panel
(or the "Connect to database…" command in the palette):

```bash
VITE_ENABLE_DB_AGENT=1 npm run dev
```

**Privacy:** the agent binds to `127.0.0.1` only. Your credentials and your
plan data flow between your browser and your own local agent process —
they never touch any server, including the GitHub Pages deployment (which is
built without the flag and contains none of this UI).

**Licensing:** the cursor-cache source (`DBMS_XPLAN.DISPLAY_CURSOR`) is free;
the SQL Monitor source requires the Oracle Tuning Pack and AWR requires the
Diagnostics Pack — the panel labels these. "Attach DB metadata" enriches
loaded plans with table/column/index statistics via the same bundle format as
`scripts/gather_plan_metadata.sql`.

## Deploy with Docker

Build and run the production image locally:

```bash
npm run docker:build
npm run docker:run
```

Then open http://localhost:8080/

Or use Docker Compose:

```bash
npm run docker:compose:up
```

Stop it with:

```bash
npm run docker:compose:down
```

### Base Path Configuration

The app now supports a build-time `APP_BASE_PATH` environment variable for production builds:

- Unset or `/` builds for root deployment, which is the default for Docker and self-hosting.
- `/ora-explain-plan-viz/` builds for GitHub Pages.

GitHub Pages still uses the existing subpath deployment via the Actions workflow, which now runs:

```bash
npm run build:pages
```

For a subpath deployment behind a reverse proxy, rebuild with a custom base path:

```bash
APP_BASE_PATH=/ora-explain-plan-viz/ docker compose up --build
```

`APP_BASE_PATH` is a build-time setting. If you change it, rebuild the app image or rerun the production build.

## License

MIT
