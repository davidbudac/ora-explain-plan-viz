-- Missing join-column index: a selective driving filter would favor a nested
-- loop into EVAL_LINE_ITEMS, but LINE ITEMS has no index on ORDER_ID, so the
-- optimizer hash-joins with a full scan of the big table.
CREATE TABLE eval_po (
  po_id    NUMBER NOT NULL,
  region   VARCHAR2(10) NOT NULL,
  po_date  DATE
);

CREATE TABLE eval_line_items (
  item_id  NUMBER NOT NULL,
  po_id    NUMBER NOT NULL,
  qty      NUMBER,
  price    NUMBER(10,2)
);

INSERT INTO eval_po (po_id, region, po_date)
SELECT level,
       CASE WHEN MOD(level, 1000) = 0 THEN 'RARE' ELSE 'COMMON' END,
       SYSDATE - MOD(level, 730)
FROM dual CONNECT BY level <= 5000;

INSERT INTO eval_line_items (item_id, po_id, qty, price)
SELECT level, MOD(level, 5000) + 1, MOD(level, 10) + 1, MOD(level, 500) + 0.99
FROM dual CONNECT BY level <= 100000;

CREATE INDEX eval_po_region_ix ON eval_po (region);

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_PO',
    method_opt => 'FOR ALL COLUMNS SIZE 254');
END;
/

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_LINE_ITEMS',
    method_opt => 'FOR ALL COLUMNS SIZE 1');
END;
/
