-- Skewed STATUS column with a FREQUENCY histogram: 99% 'PROCESSED', a few
-- rare values. The histogram makes the optimizer full-scan for the popular
-- value despite the index.
CREATE TABLE eval_orders (
  order_id   NUMBER NOT NULL,
  status     VARCHAR2(20) NOT NULL,
  amount     NUMBER(10,2),
  created_at DATE
);

INSERT INTO eval_orders (order_id, status, amount, created_at)
SELECT level,
       CASE
         WHEN level <= 49500 THEN 'PROCESSED'
         WHEN level <= 49800 THEN 'PENDING'
         WHEN level <= 49950 THEN 'SHIPPED'
         WHEN level <= 49990 THEN 'CANCELLED'
         ELSE 'ERROR'
       END,
       MOD(level, 1000) + 0.5,
       SYSDATE - MOD(level, 365)
FROM dual CONNECT BY level <= 50000;

CREATE INDEX eval_orders_status_ix ON eval_orders (status);

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_ORDERS',
    method_opt => 'FOR ALL COLUMNS SIZE 1 FOR COLUMNS STATUS SIZE 254');
END;
/
