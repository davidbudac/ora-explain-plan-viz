-- Stale statistics: stats gathered while the table held 100 rows, then the
-- table grows 500x with a much wider value range. The optimizer plans for a
-- tiny table.
CREATE TABLE eval_events (
  event_id   NUMBER NOT NULL,
  event_type NUMBER NOT NULL,
  payload    VARCHAR2(100)
);

INSERT INTO eval_events (event_id, event_type, payload)
SELECT level, MOD(level, 5), RPAD('x', 80, 'x')
FROM dual CONNECT BY level <= 100;

CREATE INDEX eval_events_type_ix ON eval_events (event_type);

BEGIN
  DBMS_STATS.GATHER_TABLE_STATS(
    ownname    => USER,
    tabname    => 'EVAL_EVENTS',
    method_opt => 'FOR ALL COLUMNS SIZE 1');
END;
/

-- Grow the table AFTER gathering stats; do not re-gather.
INSERT INTO eval_events (event_id, event_type, payload)
SELECT 100 + level, MOD(level, 500), RPAD('y', 80, 'y')
FROM dual CONNECT BY level <= 50000;

COMMIT;
