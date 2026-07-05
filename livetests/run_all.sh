#!/usr/bin/env bash
#
# run_all.sh
#
# Orchestrates the full live-test run: (re)creates the PLANVIZ schema, runs
# the four tagged queries, waits for SQL Monitor to finalize the monitoring
# entries, then captures TEXT + XML SQL Monitor reports into reports/.
#
# Run this ON the database host, as the oracle OS user (or any user with
# sqlplus and ORACLE_HOME/ORACLE_SID already set), from the livetests/
# directory:
#
#   cd livetests
#   ./run_all.sh
#
# Adjust the PDB connection string below if your PDB is not named PDB1 or
# is not reachable via //localhost:1521/pdb1.

set -euo pipefail

# Override with e.g.: PDB_CONNECT='planviz/planviz@//myhost:1521/pdb1.world' ./run_all.sh
PDB_CONNECT="${PDB_CONNECT:-planviz/planviz@//localhost:1521/pdb1}"

echo "==> [1/7] Creating reports/ directory"
mkdir -p reports

echo "==> [2/7] Creating PLANVIZ user (as SYSDBA)"
sqlplus -S -L / as sysdba @setup/00_create_user.sql

echo "==> [3/7] Building schema and gathering stats (as PLANVIZ)"
sqlplus -S -L "${PDB_CONNECT}" @setup/01_tables.sql

echo "==> [4/7] Running Q1: star schema rollup"
sqlplus -S -L "${PDB_CONNECT}" @queries/q1_star_rollup.sql

echo "==> [4/7] Running Q2: cardinality trap"
sqlplus -S -L "${PDB_CONNECT}" @queries/q2_cardinality_trap.sql

echo "==> [4/7] Running Q3: window spill to disk"
sqlplus -S -L "${PDB_CONNECT}" @queries/q3_window_spill.sql

echo "==> [4/7] Running Q4: BOM explosion (recursive WITH)"
sqlplus -S -L "${PDB_CONNECT}" @queries/q4_bom_explosion.sql

echo "==> [4/7] Running Q5: partition pruning (parallel, interval-partitioned)"
sqlplus -S -L "${PDB_CONNECT}" @queries/q5_partition_prune.sql

echo "==> [4/7] Running Q6: partition range iterator (serial, interval-partitioned)"
sqlplus -S -L "${PDB_CONNECT}" @queries/q6_partition_iterator.sql

echo "==> [5/7] Waiting for SQL Monitor entries to finalize"
sleep 2

echo "==> [6/7] Capturing SQL Monitor reports (as SYSDBA)"
sqlplus -S -L / as sysdba @capture/capture_all.sql

echo "==> [7/7] Done. Reports:"
ls -la reports/
