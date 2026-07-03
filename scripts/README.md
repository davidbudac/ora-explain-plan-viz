# Scripts

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
