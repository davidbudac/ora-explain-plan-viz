-- q4_bom_explosion.sql
-- Run as PLANVIZ, connected to PDB1.
--
-- Recursive WITH (bill-of-materials explosion) over the parts/bom graph:
-- each FINISHED part (1..10) explodes down through ASSEMBLY levels to
-- COMPONENT leaves (1001..51000), 4+ levels deep.

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON
SET FEEDBACK ON
SET AUTOTRACE OFF

WITH exploded (root_part_id, part_id, ext_qty, lvl) AS (
   SELECT p.part_id, p.part_id, 1, 1
   FROM parts p
   WHERE p.part_type = 'FINISHED'
   UNION ALL
   SELECT e.root_part_id, b.child_id, e.ext_qty * b.qty, e.lvl + 1
   FROM exploded e
   JOIN bom b ON b.parent_id = e.part_id
)
SELECT /*+ MONITOR */ /* LIVETEST_Q4 */
   e.root_part_id,
   rp.part_name,
   MAX(e.lvl)                                   AS max_level,
   COUNT(*)                                      AS num_components,
   ROUND(SUM(e.ext_qty * p.unit_cost), 2)         AS total_cost
FROM exploded e
JOIN parts p  ON p.part_id  = e.part_id
JOIN parts rp ON rp.part_id = e.root_part_id
GROUP BY e.root_part_id, rp.part_name
ORDER BY 1;

EXIT
