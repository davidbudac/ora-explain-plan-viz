-- q2_cardinality_trap.sql
-- Run as PLANVIZ, connected to PDB1.
--
-- Demonstrates a cardinality estimation trap: ship_country / ship_currency /
-- ship_language on ORDERS are perfectly correlated (all derived from the same
-- MOD(rownum,25) value in setup/01_tables.sql), but stats were gathered with
-- 'FOR ALL COLUMNS SIZE 1' (no histograms, no extended/column-group stats).
-- The optimizer multiplies the three predicates' selectivities independently
-- and estimates roughly 500000/25/25/25 =~ 32 rows, while the real number of
-- matching orders is ~20000 (500000/25), joining to ~80000 order_items.
--
-- No join hints are used deliberately -- the point is to observe whatever
-- join method the optimizer picks (typically nested loops) given the bad
-- cardinality estimate.
--
-- Literal values below correspond to MOD(rownum,25) = 0 rows produced by
-- setup/01_tables.sql: ship_country = 'COUNTRY_0', ship_currency = 'CURRENCY_0',
-- ship_language = 'LANG_0'.

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON
SET FEEDBACK ON
SET AUTOTRACE OFF

SELECT /*+ MONITOR */ /* LIVETEST_Q2 */
   o.ship_country,
   COUNT(*)              AS num_items,
   SUM(i.line_amount)      AS total_line_amount,
   MAX(i.line_amount)      AS max_line_amount
FROM orders o
JOIN order_items i ON i.order_id = o.order_id
WHERE o.ship_country  = 'COUNTRY_0'
  AND o.ship_currency = 'CURRENCY_0'
  AND o.ship_language = 'LANG_0'
GROUP BY o.ship_country;

EXIT
