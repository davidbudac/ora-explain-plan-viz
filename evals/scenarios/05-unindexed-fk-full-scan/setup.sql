-- Unindexed foreign key: EVAL_CHILD.PARENT_ID references EVAL_PARENT but has
-- no index, so a lookup of one parent's children full-scans the child table.
CREATE TABLE eval_parent (
  parent_id NUMBER NOT NULL,
  label     VARCHAR2(40),
  CONSTRAINT eval_parent_pk PRIMARY KEY (parent_id)
);

CREATE TABLE eval_child (
  child_id  NUMBER NOT NULL,
  parent_id NUMBER NOT NULL,
  detail    VARCHAR2(80),
  CONSTRAINT eval_child_pk PRIMARY KEY (child_id),
  CONSTRAINT eval_child_parent_fk FOREIGN KEY (parent_id)
    REFERENCES eval_parent (parent_id)
);

INSERT INTO eval_parent (parent_id, label)
SELECT level, 'Parent ' || level
FROM dual CONNECT BY level <= 2000;

INSERT INTO eval_child (child_id, parent_id, detail)
SELECT level, MOD(level, 2000) + 1, RPAD('d', 60, 'd')
FROM dual CONNECT BY level <= 80000;

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_PARENT',
    method_opt => 'FOR ALL COLUMNS SIZE 1');
END;
/

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_CHILD',
    method_opt => 'FOR ALL COLUMNS SIZE 1');
END;
/
