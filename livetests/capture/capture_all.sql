-- capture_all.sql
-- Run as SYSDBA, e.g.:
--   sqlplus -S -L / as sysdba @capture/capture_all.sql
--
-- Finds the sql_id for each LIVETEST_Q1..Q4 tagged statement in
-- V$SQL_MONITOR and spools both TEXT and XML SQL Monitor reports into
-- ../reports/ (paths below are relative to livetests/, since run_all.sh
-- invokes sqlplus from the livetests/ directory).

WHENEVER SQLERROR EXIT FAILURE
ALTER SESSION SET CONTAINER = PDB1;

SET LONG 100000000
SET LONGCHUNKSIZE 32767
SET LINESIZE 32767
SET PAGESIZE 0
SET HEADING OFF
SET FEEDBACK OFF
SET ECHO OFF
SET VERIFY OFF
SET TRIMSPOOL ON
SET TRIMOUT ON
SET TERMOUT OFF
SET TAB OFF

-----------------------------------------------------------------------------
-- Q1: star_rollup
-----------------------------------------------------------------------------
COLUMN sid_q1 NEW_VALUE sqlid_q1
SELECT sql_id sid_q1 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q1%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q1_star_rollup.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q1', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q1_star_rollup.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q1', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

-----------------------------------------------------------------------------
-- Q2: cardinality_trap
-----------------------------------------------------------------------------
COLUMN sid_q2 NEW_VALUE sqlid_q2
SELECT sql_id sid_q2 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q2%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q2_cardinality_trap.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q2', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q2_cardinality_trap.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q2', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

-----------------------------------------------------------------------------
-- Q3: window_spill
-----------------------------------------------------------------------------
COLUMN sid_q3 NEW_VALUE sqlid_q3
SELECT sql_id sid_q3 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q3%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q3_window_spill.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q3', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q3_window_spill.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q3', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

-----------------------------------------------------------------------------
-- Q4: bom_explosion
-----------------------------------------------------------------------------
COLUMN sid_q4 NEW_VALUE sqlid_q4
SELECT sql_id sid_q4 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q4%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q4_bom_explosion.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q4', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q4_bom_explosion.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q4', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

-----------------------------------------------------------------------------
-- Q5: partition_prune
-----------------------------------------------------------------------------
COLUMN sid_q5 NEW_VALUE sqlid_q5
SELECT sql_id sid_q5 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q5%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q5_partition_prune.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q5', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q5_partition_prune.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q5', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

-----------------------------------------------------------------------------
-- Q6: partition_iterator
-----------------------------------------------------------------------------
COLUMN sid_q6 NEW_VALUE sqlid_q6
SELECT sql_id sid_q6 FROM (
   SELECT sql_id FROM v$sql_monitor
   WHERE sql_text LIKE '%LIVETEST_Q6%' AND sql_text NOT LIKE '%v$sql_monitor%'
   ORDER BY last_refresh_time DESC
) WHERE ROWNUM = 1;

SPOOL reports/q6_partition_iterator.sqlmon.txt
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q6', type => 'TEXT', report_level => 'ALL') FROM dual;
SPOOL OFF

SPOOL reports/q6_partition_iterator.sqlmon.xml
SELECT DBMS_SQL_MONITOR.REPORT_SQL_MONITOR(sql_id => '&sqlid_q6', type => 'XML', report_level => 'ALL') FROM dual;
SPOOL OFF

EXIT
