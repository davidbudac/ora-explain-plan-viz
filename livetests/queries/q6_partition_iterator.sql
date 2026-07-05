-- q6_partition_iterator.sql
-- Run as PLANVIZ, connected to PDB1.
--
-- Serial (non-parallel) analytic query over the interval-partitioned SALES_PART
-- fact table (one range partition per month, 2024-01 .. 2025-12). The WHERE
-- clause pins sale_date to a six-month window (2025-03 .. 2025-08), so the
-- optimizer prunes to a contiguous subset of partitions and drives the scan with
-- a PARTITION RANGE ITERATOR (Pstart=15 / Pstop=20) feeding a TABLE ACCESS FULL.
--
-- This is the serial counterpart to q5 (which is parallel, DOP=4, and uses a
-- PX BLOCK ITERATOR instead of an explicit PARTITION RANGE ITERATOR). NO_PARALLEL
-- keeps the plan serial so the partition-iterator operator is guaranteed.

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON
SET FEEDBACK ON
SET AUTOTRACE OFF

SELECT /*+ MONITOR NO_PARALLEL */ /* LIVETEST_Q6 */
   p.category,
   st.region,
   TO_CHAR(sp.sale_date, 'YYYY-MM')            AS sale_month,
   COUNT(*)                                     AS num_sales,
   ROUND(SUM(sp.amount), 2)                      AS total_amount,
   ROUND(AVG(sp.amount), 2)                       AS avg_amount,
   SUM(sp.quantity)                              AS total_quantity
FROM sales_part sp
JOIN dim_products p  ON p.product_id = sp.product_id
JOIN dim_stores   st ON st.store_id  = sp.store_id
WHERE sp.sale_date >= DATE '2025-03-01'
  AND sp.sale_date <  DATE '2025-09-01'
  AND p.category IN ('Electronics', 'Grocery', 'Apparel', 'Home')
GROUP BY p.category, st.region, TO_CHAR(sp.sale_date, 'YYYY-MM')
ORDER BY p.category, st.region, sale_month;

EXIT
