# Scripts

## plan_to_url.sql

Given a `sql_id`, fetches the execution plan, gzip-compresses and
base64url-encodes it **inside the database**, and prints a ready-to-click URL
that opens the Oracle Execution Plan Visualizer with the plan pre-loaded. No
copying plan text into the app required.

```sql
-- From the shared-cursor cache (default source, no extra license)
SQL> @plan_to_url.sql an05rsj1up1k5

-- Pick a specific child cursor
SQL> @plan_to_url.sql an05rsj1up1k5 1

-- From a SQL Monitor report instead (skip the child-number argument with "")
SQL> @plan_to_url.sql an05rsj1up1k5 "" MONITOR
```

**Arguments:**

| # | Name | Required | Default | Notes |
|---|------|----------|---------|-------|
| 1 | `sql_id` | Yes | - | The `V$SQL.SQL_ID` of the statement. |
| 2 | `child_number` | No | `0` | Only used with `CURSOR` source; ignored for `MONITOR`. Pass `""` to skip it. |
| 3 | `source` | No | `CURSOR` | `CURSOR` reads `DBMS_XPLAN.DISPLAY_CURSOR('ALLSTATS LAST')`. `MONITOR` reads a `DBMS_SQLTUNE.REPORT_SQL_MONITOR` TEXT report. |

**Privileges:**

- `CURSOR` (default): read access to `V$SQL_PLAN` / `V$SQL_PLAN_STATISTICS_ALL`
  for the target cursor (e.g. via `SELECT_CATALOG_ROLE` for cursors opened by
  other sessions - your own session's cursors need no extra grant).
  `DBMS_XPLAN.DISPLAY_CURSOR` itself is granted to `PUBLIC`.
- `MONITOR`: `EXECUTE` on `DBMS_SQLTUNE`, **and an active Oracle Diagnostics
  and Tuning Pack license** - `DBMS_SQLTUNE.REPORT_SQL_MONITOR` is a licensed
  feature. The script prints a one-line reminder whenever you use this
  source. Check your licensing before running it against a production system.

The script is entirely read-only: it only calls `DBMS_XPLAN.DISPLAY_CURSOR` /
`DBMS_SQLTUNE.REPORT_SQL_MONITOR`, works in session-private temporary LOBs it
frees itself, and writes to the screen via `DBMS_OUTPUT`. No spool file, no
DML, no DDL.

**Base URL:** the script points at the public GitHub Pages deployment by
default. Self-hosting the visualizer? Edit the `DEFINE base_url = ...` line
near the top of the script to point at your own deployment instead.

**Known limitations:**

- The plan must still be in the cursor cache (`CURSOR` source) or have been
  captured by SQL Monitor (`MONITOR` source, needs the Tuning Pack). There's
  no AWR source yet.
- URLs longer than roughly 2,000 characters may get truncated by some chat or
  email clients when pasted as plain text - clicking the link, or copying the
  whole line, works fine. Measured across the bundled example plans, real
  URLs run about 0.6-6K characters.
- Opening the link requires a browser new enough for `DecompressionStream`
  (Chrome 80+, Firefox 113+, Safari 16.4+).
- The plan's SQL text ends up encoded in the URL. The hash fragment
  (`#gz=...`) is never sent to a server by the browser, but the URL is still
  shareable data - treat it the same way you'd treat the plan text itself.

## gather_plan_metadata.sql

Generates a `format: "ora-plan-metadata"` JSON bundle for use with the Oracle
Execution Plan Visualizer's metadata feature.

**Easiest path:** use the visualizer's gather dialog (Metadata section of the
node detail panel). It stamps your SQL_ID / object list into the script and
gives you a one-shot artifact — either a paste-ready script that prints the
JSON straight to the terminal between `==== PLAN-METADATA BUNDLE ... ====`
markers (copy it back into the dialog), or a downloadable `.sql` that needs
no arguments and writes `bundle.json` itself.

This file is the canonical template behind that dialog. The
`-- @@GEN:...@@` marker comments delimit the sections the in-app generator
swaps out; they are plain comments and don't affect direct execution.

**Two modes when run directly:**

```sql
-- Mode 1: gather for a specific SQL_ID (and optional PLAN_HASH_VALUE)
SQL> @gather_plan_metadata.sql an05rsj1up1k5

-- Mode 2: explicit object list
SQL> @gather_plan_metadata.sql LIST "HR.EMPLOYEES,HR.DEPARTMENTS"
```

**Requirements:** Oracle 12.2+, SQL*Plus or SQLcl. The script is read-only
against the database (it only writes the local spool file).

**Privileges:** The script tries `DBA_*` views first and degrades to `ALL_*`
on `ORA-00942`. Objects skipped because of insufficient privileges land in
the bundle's `coverage_warnings` array. Run as a DBA for full coverage.
Note: the AWR fallback (`DBA_HIST_SQL_PLAN`, used when the cursor has aged
out of the shared pool) requires the Diagnostics Pack license.

**Non-DBA users — use LIST mode.** SQL_ID mode (Mode 1) resolves the object
list from `V$SQL_PLAN` / `DBA_HIST_SQL_PLAN`, which a plain schema owner
usually can't read. In that case the script still emits a valid bundle, but an
empty one whose `coverage_warnings` tell you to switch to LIST mode. If you
don't have `SELECT_CATALOG_ROLE`, gather your own tables directly with Mode 2:

```sql
SQL> @gather_plan_metadata.sql LIST "MYSCHEMA.ORDERS,MYSCHEMA.CUSTOMERS"
```

Table, column, and index statistics come from `ALL_*` views (everything you
own), so a LIST-mode bundle is complete for your own objects. Only the
`source.db_name` and `system_params` fields require `V$` access and come back
`null` without it — harmless for the plan-annotation use case. (Note: bundles
gathered this way have no `sql_id`, so you attach them to a plan by hand rather
than by auto-pairing.)

**Output:** The script spools the JSON bundle itself — by default to
`bundle.json` in the current directory. Pass a different file name as the
last argument to override:

```sql
SQL> @gather_plan_metadata.sql an05rsj1up1k5 3001234567 my_bundle.json
SQL> @gather_plan_metadata.sql LIST "HR.EMPLOYEES" my_bundle.json
```

Then paste the file's contents into the visualizer's input box (or into the
gather dialog), or drop the file onto the input panel. The importer strips
SQL*Plus noise (prompt lines, chunked line breaks) automatically, so a raw
spool file works as-is.

**Container databases:** When run inside `CDB$ROOT`, the script emits a
warning and stops — object statistics live inside PDBs.
