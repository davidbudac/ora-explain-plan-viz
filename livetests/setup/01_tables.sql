-- 01_tables.sql
-- Run as PLANVIZ, connected to PDB1
-- (e.g. sqlplus -S -L planviz/planviz@//localhost:1521/pdb1 @setup/01_tables.sql)
--
-- Builds three independent datasets used by the live test queries:
--   1. Star schema:            dim_products, dim_stores, dim_customers, sales
--   2. Cardinality-trap schema: orders, order_items
--   3. BOM schema:              parts, bom
--
-- No ampersands anywhere in this script (SQL*Plus substitution is left at
-- its default ON, and a stray & would trigger a prompt and hang a -S -L run).

WHENEVER SQLERROR EXIT FAILURE
SET TIMING ON FEEDBACK ON

-----------------------------------------------------------------------------
-- Cleanup (idempotent re-run support)
-----------------------------------------------------------------------------
BEGIN
   FOR t IN (SELECT table_name FROM user_tables
             WHERE table_name IN ('SALES','DIM_PRODUCTS','DIM_STORES','DIM_CUSTOMERS',
                                   'ORDER_ITEMS','ORDERS','BOM','PARTS'))
   LOOP
      EXECUTE IMMEDIATE 'DROP TABLE ' || t.table_name || ' CASCADE CONSTRAINTS PURGE';
   END LOOP;
END;
/

-----------------------------------------------------------------------------
-- 1. STAR SCHEMA
-----------------------------------------------------------------------------

-- dim_products: 1000 rows, 8 categories
CREATE TABLE dim_products AS
SELECT
   n                                                     AS product_id,
   'Product ' || n                                       AS product_name,
   CASE MOD(n, 8)
      WHEN 0 THEN 'Electronics'
      WHEN 1 THEN 'Grocery'
      WHEN 2 THEN 'Apparel'
      WHEN 3 THEN 'Home'
      WHEN 4 THEN 'Sports'
      WHEN 5 THEN 'Toys'
      WHEN 6 THEN 'Beauty'
      ELSE 'Automotive'
   END                                                    AS category,
   ROUND(DBMS_RANDOM.VALUE(5, 500), 2)                    AS list_price
FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000);

ALTER TABLE dim_products ADD CONSTRAINT pk_dim_products PRIMARY KEY (product_id);

-- dim_stores: 200 rows, 10 countries, 5 regions
CREATE TABLE dim_stores AS
SELECT
   n                                                      AS store_id,
   'Store ' || n                                          AS store_name,
   'COUNTRY_' || MOD(n, 10)                                AS country,
   CASE MOD(n, 5)
      WHEN 0 THEN 'North'
      WHEN 1 THEN 'South'
      WHEN 2 THEN 'East'
      WHEN 3 THEN 'West'
      ELSE 'Central'
   END                                                     AS region
FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 200);

ALTER TABLE dim_stores ADD CONSTRAINT pk_dim_stores PRIMARY KEY (store_id);

-- dim_customers: 50000 rows, 4 segments, signup_date over past 5 years
CREATE TABLE dim_customers AS
SELECT
   n                                                      AS customer_id,
   'Customer ' || n                                       AS cust_name,
   CASE MOD(n, 4)
      WHEN 0 THEN 'Consumer'
      WHEN 1 THEN 'Corporate'
      WHEN 2 THEN 'SMB'
      ELSE 'Public'
   END                                                     AS segment,
   TRUNC(SYSDATE) - 1826 + MOD(n, 1826)                    AS signup_date
FROM (
   SELECT (a.n - 1) * 50 + b.n AS n
   FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000) a,
        (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 50) b
);

ALTER TABLE dim_customers ADD CONSTRAINT pk_dim_customers PRIMARY KEY (customer_id);

-- sales (fact): 2,000,000 rows, no indexes
CREATE TABLE sales AS
SELECT
   rn                                                                 AS sale_id,
   TRUNC(DBMS_RANDOM.VALUE(1, 50001))                                 AS customer_id,
   TRUNC(DBMS_RANDOM.VALUE(1, 1001))                                  AS product_id,
   TRUNC(DBMS_RANDOM.VALUE(1, 201))                                   AS store_id,
   DATE '2024-01-01' + TRUNC(DBMS_RANDOM.VALUE(0, 730))               AS sale_date,
   TRUNC(DBMS_RANDOM.VALUE(1, 11))                                    AS quantity,
   ROUND(DBMS_RANDOM.VALUE(5, 2000), 2)                                AS amount
FROM (
   SELECT (a.n - 1) * 1000 + b.n AS rn
   FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 2000) a,
        (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000) b
);

-----------------------------------------------------------------------------
-- 2. CARDINALITY-TRAP SCHEMA
-----------------------------------------------------------------------------

-- orders: 500,000 rows. ship_country / ship_currency / ship_language are all
-- perfectly correlated (same MOD(rownum,25) driver) but stats are gathered
-- without histograms or extended stats, so the optimizer treats them as
-- independent and multiplies selectivities -- badly underestimating rows.
CREATE TABLE orders AS
SELECT
   rn                                                     AS order_id,
   'COUNTRY_' || MOD(rn, 25)                                AS ship_country,
   'CURRENCY_' || MOD(rn, 25)                               AS ship_currency,
   'LANG_' || MOD(rn, 25)                                    AS ship_language,
   DATE '2024-01-01' + MOD(rn, 730)                          AS order_date,
   MOD(rn, 5)                                                AS status
FROM (
   SELECT (a.n - 1) * 1000 + b.n AS rn
   FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 500) a,
        (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000) b
);

ALTER TABLE orders ADD CONSTRAINT pk_orders PRIMARY KEY (order_id);

-- order_items: 2,000,000 rows
CREATE TABLE order_items AS
SELECT
   rn                                                     AS item_id,
   MOD(rn, 500000) + 1                                     AS order_id,
   ROUND(DBMS_RANDOM.VALUE(1, 500), 2)                      AS line_amount,
   TRUNC(DBMS_RANDOM.VALUE(1, 1001))                        AS product_id
FROM (
   SELECT (a.n - 1) * 1000 + b.n AS rn
   FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 2000) a,
        (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000) b
);

CREATE INDEX order_items_ix ON order_items (order_id);

-----------------------------------------------------------------------------
-- 3. BOM SCHEMA
-----------------------------------------------------------------------------

-- parts: 51000 rows
--   part_id 1..10       -> FINISHED
--   part_id 11..1000    -> ASSEMBLY
--   part_id 1001..51000 -> COMPONENT
CREATE TABLE parts AS
SELECT
   n                                                      AS part_id,
   CASE
      WHEN n <= 10   THEN 'FINISHED'
      WHEN n <= 1000 THEN 'ASSEMBLY'
      ELSE 'COMPONENT'
   END                                                     AS part_type,
   'Part ' || n                                            AS part_name,
   ROUND(DBMS_RANDOM.VALUE(0.5, 100), 2)                    AS unit_cost
FROM (
   SELECT (a.n - 1) * 1000 + b.n AS n
   FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 51) a,
        (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 1000) b
   WHERE (a.n - 1) * 1000 + b.n <= 51000
);

ALTER TABLE parts ADD CONSTRAINT pk_parts PRIMARY KEY (part_id);

-- bom edges: deterministic, parent_id < child_id always (acyclic), depth 4+.
--
-- Level 1: each FINISHED part f in 1..10 gets 20 ASSEMBLY children:
--          children = 11 + (f-1)*20 .. 10 + f*20   (covers assemblies 11..210)
--
-- Level 2: each ASSEMBLY a in 11..210 gets:
--          - 10 children among assemblies 211..1000 (spread via MOD)
--          - 5 children among components 1001..51000 (spread via MOD)
--
-- Level 3: each ASSEMBLY a in 211..1000 gets:
--          - 12 children among components 1001..51000 (spread via MOD)
--
-- qty cycles 1..4 via MOD.

CREATE TABLE bom (
   parent_id NUMBER NOT NULL,
   child_id  NUMBER NOT NULL,
   qty       NUMBER NOT NULL
);

-- Level 1: FINISHED (1..10) -> ASSEMBLY (11..210), 20 children each
INSERT INTO bom (parent_id, child_id, qty)
SELECT
   f.n                                                    AS parent_id,
   10 + (f.n - 1) * 20 + c.n                               AS child_id,
   MOD((f.n - 1) * 20 + c.n, 4) + 1                        AS qty
FROM (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 10) f,
     (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 20) c;

-- Level 2a: ASSEMBLY (11..210) -> ASSEMBLY (211..1000), 10 children each,
-- spread deterministically via MOD so children fan out across the range.
INSERT INTO bom (parent_id, child_id, qty)
SELECT
   a.n                                                                        AS parent_id,
   211 + MOD((a.n - 11) * 10 + c.n - 1, 790)                                  AS child_id,
   MOD((a.n - 11) * 10 + c.n, 4) + 1                                          AS qty
FROM (SELECT LEVEL + 10 n FROM dual CONNECT BY LEVEL <= 200) a,
     (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 10) c;

-- Level 2b: ASSEMBLY (11..210) -> COMPONENT (1001..51000), 5 children each,
-- spread deterministically via MOD.
INSERT INTO bom (parent_id, child_id, qty)
SELECT
   a.n                                                                        AS parent_id,
   1001 + MOD((a.n - 11) * 5 + c.n - 1, 50000)                                AS child_id,
   MOD((a.n - 11) * 5 + c.n, 4) + 1                                           AS qty
FROM (SELECT LEVEL + 10 n FROM dual CONNECT BY LEVEL <= 200) a,
     (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 5) c;

-- Level 3: ASSEMBLY (211..1000) -> COMPONENT (1001..51000), 12 children each,
-- spread deterministically via MOD so the full component range is covered.
INSERT INTO bom (parent_id, child_id, qty)
SELECT
   a.n                                                                        AS parent_id,
   1001 + MOD((a.n - 211) * 12 + c.n - 1, 50000)                              AS child_id,
   MOD((a.n - 211) * 12 + c.n, 4) + 1                                         AS qty
FROM (SELECT LEVEL + 210 n FROM dual CONNECT BY LEVEL <= 790) a,
     (SELECT LEVEL n FROM dual CONNECT BY LEVEL <= 12) c;

ALTER TABLE bom ADD CONSTRAINT pk_bom PRIMARY KEY (parent_id, child_id, qty);
CREATE INDEX bom_parent_ix ON bom (parent_id);

-----------------------------------------------------------------------------
-- Stats
-----------------------------------------------------------------------------

BEGIN
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'DIM_PRODUCTS');
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'DIM_STORES');
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'DIM_CUSTOMERS');
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'SALES');

   -- CRITICAL: no histograms, no extended stats on ORDERS so the optimizer
   -- multiplies the three correlated predicates' selectivities independently
   -- and drastically underestimates the actual matching row count.
   DBMS_STATS.GATHER_TABLE_STATS(
      ownname    => 'PLANVIZ',
      tabname    => 'ORDERS',
      method_opt => 'FOR ALL COLUMNS SIZE 1'
   );

   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'ORDER_ITEMS');
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'PARTS');
   DBMS_STATS.GATHER_TABLE_STATS(ownname => 'PLANVIZ', tabname => 'BOM');
END;
/

EXIT
