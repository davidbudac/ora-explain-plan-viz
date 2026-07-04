-- q1_star_rollup.sql
-- Run as PLANVIZ, connected to PDB1.
-- Star-schema join + ROLLUP aggregation. Tagged for SQL Monitor capture.

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON
SET FEEDBACK ON
SET AUTOTRACE OFF

SELECT /*+ MONITOR */ /* LIVETEST_Q1 */
   p.category,
   st.region,
   COUNT(*)                    AS num_sales,
   SUM(s.amount)                AS total_amount,
   ROUND(AVG(s.amount), 2)       AS avg_amount,
   SUM(s.quantity)               AS total_quantity
FROM sales s
JOIN dim_products  p  ON p.product_id  = s.product_id
JOIN dim_stores    st ON st.store_id   = s.store_id
JOIN dim_customers c  ON c.customer_id = s.customer_id
WHERE s.sale_date >= DATE '2025-01-01'
  AND c.segment IN ('Consumer', 'Corporate')
  AND p.category IN ('Electronics', 'Grocery', 'Apparel', 'Home')
GROUP BY ROLLUP(p.category, st.region)
ORDER BY p.category, st.region;

EXIT
