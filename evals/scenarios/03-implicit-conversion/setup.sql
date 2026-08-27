-- Implicit datatype conversion: CUSTOMER_REF is VARCHAR2 and indexed, but the
-- query compares it to a NUMBER literal. TO_NUMBER() is applied to the column,
-- disabling the index.
CREATE TABLE eval_customers (
  customer_id  NUMBER NOT NULL,
  customer_ref VARCHAR2(20) NOT NULL,
  name         VARCHAR2(60)
);

INSERT INTO eval_customers (customer_id, customer_ref, name)
SELECT level, TO_CHAR(100000 + level), 'Customer ' || level
FROM dual CONNECT BY level <= 20000;

CREATE UNIQUE INDEX eval_customers_ref_ux ON eval_customers (customer_ref);

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_CUSTOMERS',
    method_opt => 'FOR ALL COLUMNS SIZE 1');
END;
/
