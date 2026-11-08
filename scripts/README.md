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

-- Pick one specific monitored execution by its V$SQL_MONITOR.SQL_EXEC_ID
SQL> @plan_to_url.sql an05rsj1up1k5 "" MONITOR 16777216

-- From AWR, once the cursor has aged out of the shared pool
SQL> @plan_to_url.sql an05rsj1up1k5 "" AWR

-- Pick one specific plan from AWR by its plan_hash_value
SQL> @plan_to_url.sql an05rsj1up1k5 "" AWR 2468804666
```

**URL only, straight to the clipboard:** add `QUIET` after the other
arguments and run the script from the shell. It prints the URL and nothing
else, then exits SQL*Plus, so the output can go into a pipe:

```bash
sqlplus -s user@db @plan_to_url.sql an05rsj1up1k5 QUIET | pbcopy
sqlplus -s user@db @plan_to_url.sql an05rsj1up1k5 "" AWR QUIET | pbcopy

# Linux: | xclip -selection clipboard  (or | wl-copy)
```

Exit code is 0 on success and 1 on failure. On failure the one line
printed, which is what ends up on the clipboard, is the error message. The
script exits inside an interactive SQL*Plus session too, so leave `QUIET` off
there. A URL over 32,767 characters still comes out as several 1,000-character
lines. Chrome's address bar drops the line breaks when you paste, and for
other browsers you can pipe through `tr -d '\n'` first.

**Arguments:**

| # | Name | Required | Default | Notes |
|---|------|----------|---------|-------|
| 1 | `sql_id` | Yes | - | The `V$SQL.SQL_ID` of the statement. |
| 2 | `child_number` | No | `0` | Only used with `CURSOR` source; ignored for `MONITOR` and `AWR`. Pass `""` to skip it. |
| 3 | `source` | No | `CURSOR` | `CURSOR` reads `DBMS_XPLAN.DISPLAY_CURSOR('ALLSTATS LAST')`. `MONITOR` reads a `DBMS_SQLTUNE.REPORT_SQL_MONITOR` TEXT report. `AWR` reads `DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY('ADVANCED')`: plan, predicates, outline and peeked binds as AWR captured them, but optimizer estimates only (no A-Rows / A-Time / Starts). |
| 4 | `sql_exec_id` / `plan_hash_value` | No | latest | `MONITOR`: picks one specific monitored execution (`V$SQL_MONITOR.SQL_EXEC_ID`). When omitted, Oracle reports the *last* monitored execution; if several are still in `GV$SQL_MONITOR`, the script lists them (newest first) so you can re-run with the one you want. `AWR`: picks one `plan_hash_value`. When omitted, the script uses the plan AWR saw most recently and, if AWR holds several, lists them (last seen, executions, average elapsed time) so you can re-run with the one you want. |
| last | `QUIET` | No | - | Print the URL only (no progress line, summary, notes or listings) and exit SQL*Plus. For piping into `pbcopy`. See above. |

**Privileges:**

- `CURSOR` (default): read access to `V$SQL_PLAN` / `V$SQL_PLAN_STATISTICS_ALL`
  for the target cursor (e.g. via `SELECT_CATALOG_ROLE` for cursors opened by
  other sessions - your own session's cursors need no extra grant).
  `DBMS_XPLAN.DISPLAY_CURSOR` itself is granted to `PUBLIC`.
- `MONITOR`: `EXECUTE` on `DBMS_SQLTUNE`, **and an active Oracle Diagnostics
  and Tuning Pack license** - `DBMS_SQLTUNE.REPORT_SQL_MONITOR` is a licensed
  feature. The script prints a one-line reminder whenever you use this
  source. Check your licensing before running it against a production system.
  Listing the available executions additionally needs `SELECT` on
  `GV$SQL_MONITOR` (e.g. via `SELECT_CATALOG_ROLE`); without it the listing
  is silently skipped and the report itself still works.
- `AWR`: `SELECT` on `DBA_HIST_SQL_PLAN`, `DBA_HIST_SQLSTAT` and
  `DBA_HIST_SNAPSHOT` (e.g. via `SELECT_CATALOG_ROLE`), **and an active Oracle
  Diagnostics Pack license** - AWR is a licensed feature. The script prints a
  one-line reminder whenever you use this source.

**AWR in a multitenant database:** inside a PDB, the script finds plans in
both the CDB-level AWR and the PDB's own AWR snapshots, and passes the right
`dbid` / `con_dbid` / `awr_location` to `DISPLAY_WORKLOAD_REPOSITORY` (its
defaults find neither a PDB statement from `CDB$ROOT` nor a PDB-AWR plan from
inside the PDB). From `CDB$ROOT` only the CDB-level AWR is visible, so run it
from the PDB if that PDB takes its own snapshots. The listing's `awr` column
says which repository each plan came from.

The script is entirely read-only: it only calls `DBMS_XPLAN.DISPLAY_CURSOR` /
`DBMS_SQLTUNE.REPORT_SQL_MONITOR` / `DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY`
and selects from `GV$SQL_MONITOR` / `DBA_HIST_*`, works in session-private temporary LOBs it
frees itself, and writes to the screen via `DBMS_OUTPUT`. No spool file, no
DML, no DDL.

**Base URL:** the script points at the public GitHub Pages deployment by
default. Self-hosting the visualizer? Edit the `DEFINE base_url = ...` line
near the top of the script to point at your own deployment instead.

**Known limitations:**

- The plan must still be in the cursor cache (`CURSOR` source), have been
  captured by SQL Monitor (`MONITOR`, needs the Tuning Pack), or have been
  captured by an AWR snapshot (`AWR`, needs the Diagnostics Pack). AWR keeps
  only the top SQL of each snapshot interval
  (`DBMS_WORKLOAD_REPOSITORY.ADD_COLORED_SQL` forces capture) and purges with
  its retention.
- The `AWR` source needs Oracle 12.2+ (`DISPLAY_WORKLOAD_REPOSITORY`).
- URLs longer than roughly 2,000 characters may get truncated by some chat or
  email clients when pasted as plain text - clicking the link, or copying the
  whole line, works fine. Measured across the bundled example plans, real
  URLs run about 0.6-6K characters.
- Opening the link requires a browser new enough for `DecompressionStream`
  (Chrome 80+, Firefox 113+, Safari 16.4+).
- The plan's SQL text ends up encoded in the URL. The hash fragment
  (`#gz=...`) is never sent to a server by the browser, but the URL is still
  shareable data - treat it the same way you'd treat the plan text itself.

## plan_to_json.sql

Given a `sql_id`, fetches the execution plan **and the schema metadata of
the objects it touches**, and prints both as one JSON document between
`==== ORAPLANVIZ PLAN JSON BEGIN ====` / `END` marker lines. Paste it into
the visualizer's input box (or save it as a `.json` file and drop it on the
app) and the plan loads with its metadata bundle already attached - no
separate `gather_plan_metadata.sql` run.

```sql
-- Cursor cache, child 0, with metadata (the default)
SQL> @plan_to_json.sql an05rsj1up1k5

-- Same sources and arguments as plan_to_url.sql
SQL> @plan_to_json.sql an05rsj1up1k5 1
SQL> @plan_to_json.sql an05rsj1up1k5 "" MONITOR [<sql_exec_id>]
SQL> @plan_to_json.sql an05rsj1up1k5 "" AWR [<plan_hash_value>]

-- Plan only: NOMETA in place of any optional argument
SQL> @plan_to_json.sql an05rsj1up1k5 NOMETA
SQL> @plan_to_json.sql an05rsj1up1k5 "" AWR NOMETA
```

**Arguments:** `sql_id`, `child_number`, `source` and `sql_exec_id` /
`plan_hash_value` work exactly as in [plan_to_url.sql](#plan_to_urlsql),
plus the optional `NOMETA` keyword. To skip the metadata by default, set
`DEFINE include_metadata = 'N'` near the top of the script.

**Differences from plan_to_url.sql:**

- The `CURSOR` source reads `DISPLAY_CURSOR('ADVANCED ALLSTATS LAST')`, so
  outline data, peeked binds, column projection and query-block aliases come
  along (there is no URL length to stay under).
- The metadata gather is the same bundle `gather_plan_metadata.sql <sql_id>
  <plan_hash_value>` writes, with the plan hash value read from the fetched
  plan. Its privileges are the gather script's: `DBA_*` views where granted,
  `ALL_*` otherwise, unreadable objects listed in `coverage_warnings`. From
  `CDB$ROOT` the bundle holds only a warning - connect to the PDB.
- If the gather fails outright, the JSON carries `"metadataBundle":null`
  and the error is printed after the END marker; the plan still loads.

**Output format:** the visualizer's annotated-plan JSON (version 2, the
format *Save annotated plan* writes), with no annotations. DBMS_OUTPUT
prints lines and a JSON string cannot hold a raw line break, so the plan
text is printed one plan line per terminal line; the visualizer joins them
back (every real newline is escaped as `\n`). Copying the whole terminal
output works too - status lines and markers are ignored. Other JSON tools
need the raw line breaks removed first.

**Self-contained:** the metadata code is a verbatim copy of
`gather_plan_metadata.sql`'s PL/SQL block, so `plan_to_json.sql` runs on its
own. After editing the gather script, run `node scripts/sync-plan-to-json.mjs`
(`npm test` fails while the copies differ).

The script is read-only, like the other two: it writes to the screen via
`DBMS_OUTPUT` only (no spool file, no DML, no DDL).

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
gather dialog), or drop the file onto the input panel. The importer finds the
JSON by itself: it drops any prompt echo, markers and status lines before and
after it and rejoins chunked or hard-wrapped lines, so a raw spool file or a
whole terminal copy works as-is.

**Container databases:** When run inside `CDB$ROOT`, the script emits a
warning and stops — object statistics live inside PDBs.
