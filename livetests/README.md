# Oracle Live Test Suite

This directory contains a reproducible, self-contained set of SQL*Plus scripts that
generate **real** Oracle SQL Monitor reports against a live Oracle 19c database. The
captured reports (TEXT + XML) are meant to be copied into `src/examples/` as examples
21-24, giving the Oracle Execution Plan Visualizer real-world plans that exercise
star-schema joins/rollups, cardinality misestimation, workarea spills to disk, and
recursive CONNECT-BY-style (`WITH ... UNION ALL`) BOM explosion.

## Purpose

Hand-written or lightly-edited example plans are useful, but nothing beats a plan
captured straight from `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR`. This suite:

1. Creates a dedicated `PLANVIZ` schema with four purpose-built datasets.
2. Runs four SQL statements, each tagged with `/*+ MONITOR */` so SQL Monitor
   always captures them, and each carrying a unique text tag (`LIVETEST_Q1` .. `LIVETEST_Q4`)
   so the capture step can find the right `sql_id` reliably.
3. Captures both the `TEXT` and `XML` SQL Monitor reports for each statement into
   `livetests/reports/`.

Those report files can then be copied/renamed into `src/examples/` following the
project's `NN-category-Name.txt` (or `.xml`) naming convention (see the project's
`CLAUDE.md`), for example:

The XML reports captured on 2026-07-04 against the `dbmint` test database
(Oracle 19.27, PDB1) are committed both here in `reports/` and as these examples:

```
src/examples/21-sql_monitor-Live Star Schema Rollup.txt
src/examples/22-sql_monitor-Live Cardinality Trap (NL).txt
src/examples/23-sql_monitor-Live Window Sort Spill.txt
src/examples/24-sql_monitor-Live Recursive BOM.txt
```

## Prerequisites

- Oracle Database **19c** or later (tested against a 19c CDB).
- A pluggable database named **PDB1** (adjust connection strings in `run_all.sh`
  and `setup/00_create_user.sql` if your PDB is named differently).
- OS/SYSDBA access to the database host (or an equivalent `/ as sysdba` /
  privileged connection) to create the `PLANVIZ` user and to run
  `DBMS_SQL_MONITOR.REPORT_SQL_MONITOR`.
- **Oracle Tuning Pack license** — SQL Monitor (`V$SQL_MONITOR`,
  `DBMS_SQL_MONITOR`) requires the Diagnostics + Tuning Pack. Only run this
  suite against a database where you are licensed to use these features
  (e.g. a personal/test environment).
- `sqlplus` on the `PATH` with `ORACLE_HOME` / `ORACLE_SID` (or an `orapki`/TNS
  setup that lets `//localhost:1521/pdb1` resolve) already configured in the
  shell environment that runs `run_all.sh`.

## WARNING

`setup/00_create_user.sql` **drops and recreates** the `PLANVIZ` user (`DROP USER
planviz CASCADE`) every time it runs. Do not point this at a database where a
`PLANVIZ` schema already holds data you care about.

## How to run

### Option A: one shot

On the database host, as the `oracle` OS user (or any user with `sqlplus` and
`ORACLE_HOME`/`ORACLE_SID` set), from this directory:

```bash
cd livetests
./run_all.sh
```

If your PDB service is not reachable as `//localhost:1521/pdb1`, override the
connect string (this is what was used on the `dbmint` host, where the listener
registers the service as `pdb1.world` on the host name):

```bash
PDB_CONNECT='planviz/planviz@//poug-dg1.localdomain:1521/pdb1.world' ./run_all.sh
```

This creates `reports/`, rebuilds the schema, runs all four queries, waits for
SQL Monitor to finalize the monitoring entries, then captures TEXT + XML
reports for each query into `reports/`.

### Option B: step by step

```bash
cd livetests
mkdir -p reports

sqlplus -S -L / as sysdba @setup/00_create_user.sql
sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @setup/01_tables.sql

sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @queries/q1_star_rollup.sql
sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @queries/q2_cardinality_trap.sql
sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @queries/q3_window_spill.sql
sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @queries/q4_bom_explosion.sql

sqlplus -S -L / as sysdba @capture/capture_all.sql
```

Reports land in `livetests/reports/`.

## What each scenario demonstrates

| # | Script | Demonstrates |
|---|--------|--------------|
| Q1 | `queries/q1_star_rollup.sql` | Classic star-schema join (fact `sales` + three dimensions) with a `GROUP BY ROLLUP(category, region)` aggregation. Good baseline plan with hash joins and a rollup aggregation, small result set. |
| Q2 | `queries/q2_cardinality_trap.sql` | A cardinality estimation trap: `orders` has three columns (`ship_country`, `ship_currency`, `ship_language`) that are perfectly correlated (all derived from the same `mod(rownum,25)`), but stats are gathered without histograms or extended stats. The optimizer multiplies the three independent selectivities and drastically underestimates the row count (~32 estimated vs. ~20,000 actual orders / ~80,000 items), which typically results in a nested-loops plan that performs badly at runtime — a great example of the app's cardinality-mismatch detection. |
| Q3 | `queries/q3_window_spill.sql` | Forces a `WINDOW SORT` (via `ROW_NUMBER()` and a windowed `SUM() OVER`) over the 2,000,000-row `sales` fact table with `workarea_size_policy = MANUAL` and a tiny 2 MB sort/hash area, guaranteeing a spill to temp — exercises the app's spill-to-disk / temp-space badges. |
| Q4 | `queries/q4_bom_explosion.sql` | A recursive `WITH ... UNION ALL` bill-of-materials explosion over a 4+ level `parts`/`bom` graph (10 finished goods exploding down through assemblies to ~51,000 components), showing recursive `WITH` / `CONNECT BY`-style plan shapes with multiple join back-references. |

## Files

```
livetests/
├── README.md                       # this file
├── run_all.sh                      # orchestrates the full run
├── setup/
│   ├── 00_create_user.sql          # (re)creates the PLANVIZ user  — run as SYSDBA
│   └── 01_tables.sql               # builds all schemas + gathers stats — run as PLANVIZ
├── queries/
│   ├── q1_star_rollup.sql
│   ├── q2_cardinality_trap.sql
│   ├── q3_window_spill.sql
│   └── q4_bom_explosion.sql
├── capture/
│   └── capture_all.sql             # finds sql_id per tag, spools TEXT + XML reports
└── reports/                        # output directory (SQL Monitor reports land here)
```
