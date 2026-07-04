-- q3_window_spill.sql
-- Run as PLANVIZ, connected to PDB1.
--
-- Forces a WINDOW SORT over the 2,000,000-row SALES fact table to spill to
-- temp by combining a small, session-level manual workarea (2 MB) with two
-- windowed analytic functions (ROW_NUMBER + a running SUM).

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON
SET FEEDBACK ON
SET AUTOTRACE OFF

ALTER SESSION SET workarea_size_policy = MANUAL;
ALTER SESSION SET sort_area_size = 2000000;
ALTER SESSION SET hash_area_size = 2000000;

SELECT /*+ MONITOR */ /* LIVETEST_Q3 */
   COUNT(*)                        AS num_rows,
   ROUND(SUM(running_total), 2)     AS sum_running_total,
   ROUND(AVG(amount), 2)             AS avg_amount
FROM (
   SELECT
      s.customer_id,
      s.sale_date,
      s.amount,
      ROW_NUMBER() OVER (PARTITION BY s.customer_id ORDER BY s.sale_date DESC)      AS rn,
      SUM(s.amount) OVER (PARTITION BY s.customer_id ORDER BY s.sale_date)          AS running_total
   FROM sales s
)
WHERE rn <= 3;

EXIT
