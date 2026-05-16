# Scripts

## gather_plan_metadata.sql

Generates a `format: "ora-plan-metadata"` JSON bundle for use with the Oracle
Execution Plan Visualizer's metadata feature.

**Two modes:**

```sql
-- Mode 1: gather for a specific SQL_ID (and optional PLAN_HASH_VALUE)
SQL> @gather_plan_metadata.sql an05rsj1up1k5

-- Mode 2: explicit object list
SQL> @gather_plan_metadata.sql LIST "HR.EMPLOYEES,HR.DEPARTMENTS"
```

**Requirements:** Oracle 12.2+, SQL*Plus or SQLcl. The script is read-only.

**Privileges:** The script tries `DBA_*` views first and degrades to `ALL_*`
on `ORA-00942`. Objects skipped because of insufficient privileges land in
the bundle's `coverage_warnings` array. Run as a DBA for full coverage.

**Output:** JSON written to `DBMS_OUTPUT`. Capture it with `SPOOL`:

```sql
SET SERVEROUTPUT ON SIZE UNLIMITED
SPOOL bundle.json
@gather_plan_metadata.sql an05rsj1up1k5
SPOOL OFF
```

Then drop `bundle.json` onto the plan input area in the visualizer.

**Container databases:** When run inside `CDB$ROOT`, the script emits a
warning and stops — object statistics live inside PDBs.
