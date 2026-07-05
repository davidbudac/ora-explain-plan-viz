--------------------------------------------------------------------------------
-- gather_plan_metadata.sql
--
-- Emit a `format: "ora-plan-metadata"` JSON bundle for the objects referenced
-- by a specific SQL_ID/PLAN_HASH_VALUE, or for an explicit list of objects.
--
-- The bundle is consumed by the Oracle Execution Plan Visualizer to annotate
-- plan nodes with table, column, and index statistics from the data dictionary.
--
-- Usage (SQL*Plus or SQLcl, Oracle 12.2+):
--
--   SQL> @gather_plan_metadata.sql <sql_id> [<plan_hash_value>] [<spool_file>]
--   SQL> @gather_plan_metadata.sql LIST "HR.EMPLOYEES,HR.DEPARTMENTS" [<spool_file>]
--
--   The first form gathers metadata for all objects referenced by the SQL_ID
--   (looks in V$SQL_PLAN first, then DBA_HIST_SQL_PLAN). The literal LIST
--   keyword switches to manual-object-list mode.
--
--   The script spools its own output: the bundle is written to <spool_file>
--   (default bundle.json in the current directory). No manual SPOOL needed.
--
-- Privileges:
--   The script tries DBA_* views first and degrades to ALL_* on ORA-00942.
--   Objects skipped because of insufficient privileges land in the bundle's
--   `coverage_warnings` array. Run as a DBA for full coverage.
--
-- This script is read-only against the data dictionary.
--------------------------------------------------------------------------------

SET ECHO OFF
SET HEADING OFF
SET FEEDBACK OFF
SET PAGESIZE 0
SET LINESIZE 32767
SET LONG 100000000
SET LONGCHUNKSIZE 100000
SET SERVEROUTPUT ON SIZE UNLIMITED FORMAT WRAPPED
SET TRIMSPOOL ON
SET TRIMOUT ON
SET TAB OFF
SET TERMOUT ON
SET VERIFY OFF

-- The @@GEN:...@@ marker comments delimit the sections the visualizer's
-- in-app generator swaps out when it stamps a self-contained copy of this
-- script (literal arguments, screen instead of spool output). They are
-- plain comments - running this file directly ignores them.

-- Positional arguments: SQL_ID or LIST, then either plan_hash/spool or
-- object_list/spool. Args 2 and 3 are optional - default them to empty via
-- the zero-row NEW_VALUE idiom so SQL*Plus never prompts for them.
-- @@GEN:ARGS:BEGIN@@
SET TERMOUT OFF
COLUMN 2 NEW_VALUE 2 NOPRINT
COLUMN 3 NEW_VALUE 3 NOPRINT
SELECT NULL "2", NULL "3" FROM dual WHERE 1 = 2;
SET TERMOUT ON

DEFINE arg1 = "&1"
DEFINE arg2 = "&2"
DEFINE arg3 = "&3"

-- Spool target: optional third argument, default bundle.json
SET TERMOUT OFF
COLUMN spool_target NEW_VALUE spool_target NOPRINT
SELECT NVL(TRIM('&arg3'), 'bundle.json') AS spool_target FROM dual;
SET TERMOUT ON
-- @@GEN:ARGS:END@@

-- @@GEN:OPEN:BEGIN@@
PROMPT Gathering plan metadata into &spool_target ...

-- TERMOUT OFF keeps the JSON off the screen; it still reaches the spool file.
SET TERMOUT OFF
SPOOL &spool_target
-- @@GEN:OPEN:END@@

DECLARE
  g_mode            VARCHAR2(16);             -- 'SQL_ID' or 'LIST'
  g_sql_id          VARCHAR2(32) := NULL;
  g_plan_hash       NUMBER := NULL;
  g_manual_list     VARCHAR2(4000) := NULL;

  g_container       VARCHAR2(128);
  g_db_name         VARCHAR2(128);
  g_oracle_version  VARCHAR2(128);

  g_use_dba_tables  BOOLEAN := TRUE;
  g_use_dba_indexes BOOLEAN := TRUE;
  g_use_dba_cols    BOOLEAN := TRUE;
  g_use_dba_constr  BOOLEAN := TRUE;
  g_use_dba_part    BOOLEAN := TRUE;

  TYPE t_object_rec IS RECORD (
    owner     VARCHAR2(128),
    name      VARCHAR2(128),
    type      VARCHAR2(64)
  );
  TYPE t_object_tab IS TABLE OF t_object_rec INDEX BY PLS_INTEGER;
  l_objects t_object_tab;

  TYPE t_warning_rec IS RECORD (
    object VARCHAR2(257),
    reason VARCHAR2(4000)
  );
  TYPE t_warning_tab IS TABLE OF t_warning_rec INDEX BY PLS_INTEGER;
  l_warnings t_warning_tab;

  l_warn_count PLS_INTEGER := 0;

  -- Output buffer. Declared here because PL/SQL requires item declarations
  -- to precede subprogram bodies in a declarative part.
  l_buffer CLOB;

  PROCEDURE add_warning(p_object IN VARCHAR2, p_reason IN VARCHAR2) IS
  BEGIN
    l_warn_count := l_warn_count + 1;
    l_warnings(l_warn_count).object := SUBSTR(p_object, 1, 257);
    l_warnings(l_warn_count).reason := SUBSTR(p_reason, 1, 4000);
  END;

  -- JSON-safe quoting for an arbitrary string value.
  FUNCTION js_string(p_value IN VARCHAR2) RETURN VARCHAR2 IS
    l_out VARCHAR2(32767);
  BEGIN
    IF p_value IS NULL THEN
      RETURN 'null';
    END IF;
    l_out := p_value;
    l_out := REPLACE(l_out, '\', '\\');
    l_out := REPLACE(l_out, '"', '\"');
    l_out := REPLACE(l_out, CHR(10), '\n');
    l_out := REPLACE(l_out, CHR(13), '\r');
    l_out := REPLACE(l_out, CHR(9), '\t');
    RETURN '"' || l_out || '"';
  END;

  FUNCTION js_number(p_value IN NUMBER) RETURN VARCHAR2 IS
    l_out VARCHAR2(64);
  BEGIN
    IF p_value IS NULL THEN RETURN 'null'; END IF;
    l_out := TO_CHAR(p_value, 'TM', 'NLS_NUMERIC_CHARACTERS=''.,''');
    -- TM format drops the leading zero (.5 / -.5), which is invalid JSON.
    IF SUBSTR(l_out, 1, 1) = '.' THEN
      l_out := '0' || l_out;
    ELSIF SUBSTR(l_out, 1, 2) = '-.' THEN
      l_out := '-0' || SUBSTR(l_out, 2);
    END IF;
    RETURN l_out;
  END;

  FUNCTION js_bool(p_value IN BOOLEAN) RETURN VARCHAR2 IS
  BEGIN
    IF p_value IS NULL THEN RETURN 'null'; END IF;
    RETURN CASE WHEN p_value THEN 'true' ELSE 'false' END;
  END;

  FUNCTION js_iso_ts(p_value IN DATE) RETURN VARCHAR2 IS
  BEGIN
    IF p_value IS NULL THEN RETURN 'null'; END IF;
    RETURN '"' || TO_CHAR(p_value, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || '"';
  END;

  FUNCTION js_iso_ts(p_value IN TIMESTAMP) RETURN VARCHAR2 IS
  BEGIN
    IF p_value IS NULL THEN RETURN 'null'; END IF;
    RETURN '"' || TO_CHAR(p_value, 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"') || '"';
  END;

  -- Try the DBA_/ALL_ pair. Returns TRUE if DBA_ succeeded, FALSE if it fell
  -- back to ALL_. Raises any error other than ORA-00942.
  FUNCTION probe_dba_view(p_view IN VARCHAR2) RETURN BOOLEAN IS
    l_dummy NUMBER;
  BEGIN
    EXECUTE IMMEDIATE 'SELECT COUNT(*) FROM ' || p_view || ' WHERE ROWNUM = 1'
      INTO l_dummy;
    RETURN TRUE;
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLCODE = -942 THEN
        RETURN FALSE;
      END IF;
      RAISE;
  END;

  -- Decode a RAW low_value/high_value to its native textual representation.
  FUNCTION decode_raw_value(
    p_raw       IN RAW,
    p_data_type IN VARCHAR2
  ) RETURN VARCHAR2 IS
    l_num NUMBER;
    l_vc  VARCHAR2(4000);
    l_dt  DATE;
  BEGIN
    IF p_raw IS NULL THEN RETURN NULL; END IF;
    IF UPPER(p_data_type) LIKE 'NUMBER%'
       OR UPPER(p_data_type) IN ('FLOAT', 'BINARY_FLOAT', 'BINARY_DOUBLE') THEN
      DBMS_STATS.CONVERT_RAW_VALUE(p_raw, l_num);
      RETURN TO_CHAR(l_num, 'TM', 'NLS_NUMERIC_CHARACTERS=''.,''');
    ELSIF UPPER(p_data_type) IN ('CHAR', 'VARCHAR2', 'NCHAR', 'NVARCHAR2') THEN
      DBMS_STATS.CONVERT_RAW_VALUE(p_raw, l_vc);
      RETURN l_vc;
    ELSIF UPPER(p_data_type) = 'DATE' THEN
      DBMS_STATS.CONVERT_RAW_VALUE(p_raw, l_dt);
      RETURN TO_CHAR(l_dt, 'YYYY-MM-DD"T"HH24:MI:SS');
    ELSIF UPPER(p_data_type) LIKE 'TIMESTAMP%' THEN
      -- DBMS_STATS.CONVERT_RAW_VALUE has no TIMESTAMP overload. The first
      -- 7 bytes of a timestamp raw use the DATE encoding, so decode those
      -- (fractional seconds are not needed for low/high display).
      DBMS_STATS.CONVERT_RAW_VALUE(UTL_RAW.SUBSTR(p_raw, 1, 7), l_dt);
      RETURN TO_CHAR(l_dt, 'YYYY-MM-DD"T"HH24:MI:SS');
    END IF;
    RETURN RAWTOHEX(p_raw);
  EXCEPTION
    WHEN OTHERS THEN
      RETURN RAWTOHEX(p_raw);
  END;

  PROCEDURE add_object(p_owner IN VARCHAR2, p_name IN VARCHAR2, p_type IN VARCHAR2) IS
    l_idx PLS_INTEGER := l_objects.COUNT + 1;
    l_dup BOOLEAN := FALSE;
  BEGIN
    -- Dedup
    FOR i IN 1 .. l_objects.COUNT LOOP
      IF l_objects(i).owner = p_owner AND l_objects(i).name = p_name THEN
        l_dup := TRUE;
        EXIT;
      END IF;
    END LOOP;
    IF NOT l_dup THEN
      l_objects(l_idx).owner := p_owner;
      l_objects(l_idx).name := p_name;
      l_objects(l_idx).type := p_type;
    END IF;
  END;

  -- Resolve referenced objects from a plan-source view (V$SQL_PLAN or
  -- DBA_HIST_SQL_PLAN). Uses native dynamic SQL on purpose: a plain schema
  -- owner has no SELECT on these views, and a *static* reference would make
  -- the whole anonymous block fail to COMPILE (ORA-06550) before any
  -- EXCEPTION handler can run. Dynamic SQL turns the missing view into a
  -- catchable runtime ORA-00942, which we downgrade to a coverage warning.
  PROCEDURE resolve_from_plan_view(
    p_view     IN VARCHAR2,
    p_warn_obj IN VARCHAR2,
    p_warn_msg IN VARCHAR2
  ) IS
    l_cur   SYS_REFCURSOR;
    l_owner VARCHAR2(128);
    l_name  VARCHAR2(128);
    l_type  VARCHAR2(128);
    l_sql   VARCHAR2(1000);
  BEGIN
    l_sql := 'SELECT DISTINCT object_owner, object_name, object_type '
          || 'FROM ' || p_view || ' '
          || 'WHERE sql_id = :a '
          || 'AND (:b IS NULL OR plan_hash_value = :c) '
          || 'AND object_owner IS NOT NULL AND object_name IS NOT NULL';
    OPEN l_cur FOR l_sql USING g_sql_id, g_plan_hash, g_plan_hash;
    LOOP
      FETCH l_cur INTO l_owner, l_name, l_type;
      EXIT WHEN l_cur%NOTFOUND;
      add_object(l_owner, l_name, l_type);
    END LOOP;
    CLOSE l_cur;
  EXCEPTION
    WHEN OTHERS THEN
      IF l_cur%ISOPEN THEN CLOSE l_cur; END IF;
      IF SQLCODE = -942 THEN
        add_warning(p_warn_obj, p_warn_msg);
      ELSE
        RAISE;
      END IF;
  END;

  PROCEDURE resolve_objects_for_sql_id IS
  BEGIN
    resolve_from_plan_view('v$sql_plan', 'V$SQL_PLAN',
      'No SELECT on V$SQL_PLAN - cannot resolve referenced objects from cursor cache. '
      || 'Re-run as a user with SELECT_CATALOG_ROLE, or use LIST mode with explicit OWNER.OBJECT names.');

    IF l_objects.COUNT = 0 THEN
      resolve_from_plan_view('dba_hist_sql_plan', 'DBA_HIST_SQL_PLAN',
        'No SELECT on DBA_HIST_SQL_PLAN - cannot resolve referenced objects from AWR history.');
    END IF;
  END;

  PROCEDURE resolve_objects_from_list IS
    l_remaining VARCHAR2(4000) := g_manual_list;
    l_token     VARCHAR2(257);
    l_pos       PLS_INTEGER;
    l_dot       PLS_INTEGER;
  BEGIN
    WHILE l_remaining IS NOT NULL LOOP
      l_pos := INSTR(l_remaining, ',');
      IF l_pos > 0 THEN
        l_token := TRIM(SUBSTR(l_remaining, 1, l_pos - 1));
        l_remaining := SUBSTR(l_remaining, l_pos + 1);
      ELSE
        l_token := TRIM(l_remaining);
        l_remaining := NULL;
      END IF;
      IF l_token IS NOT NULL THEN
        l_dot := INSTR(l_token, '.');
        IF l_dot > 0 THEN
          add_object(
            UPPER(SUBSTR(l_token, 1, l_dot - 1)),
            UPPER(SUBSTR(l_token, l_dot + 1)),
            'UNKNOWN'
          );
        ELSE
          add_warning(l_token, 'Manual list entry has no owner - expected OWNER.OBJECT.');
        END IF;
      END IF;
    END LOOP;
  END;

  PROCEDURE write_table_stats(
    p_owner    IN VARCHAR2,
    p_name     IN VARCHAR2,
    p_buffer   IN OUT NOCOPY CLOB
  ) IS
    l_num_rows      NUMBER;
    l_blocks        NUMBER;
    l_avg_row_len   NUMBER;
    l_last_analyzed DATE;
    l_stale         VARCHAR2(3);
    l_partitioned   VARCHAR2(3);
    l_partition_cnt NUMBER;
    l_view          VARCHAR2(64);
    l_part_view     VARCHAR2(64);
    l_stmt          VARCHAR2(1000);
  BEGIN
    l_view := CASE WHEN g_use_dba_tables THEN 'dba_tab_statistics' ELSE 'all_tab_statistics' END;
    l_stmt := 'SELECT num_rows, blocks, avg_row_len, last_analyzed, stale_stats '
           || 'FROM ' || l_view || ' '
           || 'WHERE owner = :1 AND table_name = :2 AND object_type = ''TABLE''';
    BEGIN
      EXECUTE IMMEDIATE l_stmt
        INTO l_num_rows, l_blocks, l_avg_row_len, l_last_analyzed, l_stale
        USING p_owner, p_name;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        add_warning(p_owner || '.' || p_name, 'No row in ' || l_view || ' - table stats not gathered.');
      WHEN OTHERS THEN
        IF SQLCODE = -942 AND g_use_dba_tables THEN
          g_use_dba_tables := FALSE;
          write_table_stats(p_owner, p_name, p_buffer);
          RETURN;
        END IF;
        add_warning(p_owner || '.' || p_name, 'Table stats query failed: ' || SQLERRM);
    END;

    -- Partitioned flag and count
    BEGIN
      l_view := CASE WHEN g_use_dba_tables THEN 'dba_tables' ELSE 'all_tables' END;
      EXECUTE IMMEDIATE
        'SELECT partitioned FROM ' || l_view || ' WHERE owner = :1 AND table_name = :2'
        INTO l_partitioned USING p_owner, p_name;
      IF l_partitioned = 'YES' THEN
        l_part_view := CASE WHEN g_use_dba_part THEN 'dba_tab_partitions' ELSE 'all_tab_partitions' END;
        BEGIN
          EXECUTE IMMEDIATE
            'SELECT COUNT(*) FROM ' || l_part_view || ' WHERE table_owner = :1 AND table_name = :2'
            INTO l_partition_cnt USING p_owner, p_name;
        EXCEPTION
          WHEN OTHERS THEN
            IF SQLCODE = -942 AND g_use_dba_part THEN
              g_use_dba_part := FALSE;
              l_part_view := 'all_tab_partitions';
              BEGIN
                EXECUTE IMMEDIATE
                  'SELECT COUNT(*) FROM ' || l_part_view || ' WHERE table_owner = :1 AND table_name = :2'
                  INTO l_partition_cnt USING p_owner, p_name;
              EXCEPTION WHEN OTHERS THEN l_partition_cnt := NULL;
              END;
            ELSE
              l_partition_cnt := NULL;
            END IF;
        END;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        l_partitioned := NULL;
    END;

    DBMS_LOB.APPEND(p_buffer,
      '"stats":{'
      || '"num_rows":' || js_number(l_num_rows)
      || ',"blocks":' || js_number(l_blocks)
      || ',"avg_row_len":' || js_number(l_avg_row_len)
      || ',"last_analyzed":' || js_iso_ts(l_last_analyzed)
      || ',"stale_stats":' || CASE WHEN l_stale IS NULL THEN 'null' ELSE js_string(l_stale) END
      || ',"partitioned":' || js_bool(l_partitioned = 'YES')
      || CASE WHEN l_partition_cnt IS NOT NULL THEN ',"partition_count":' || js_number(l_partition_cnt) ELSE '' END
      || '}'
    );
  END;

  PROCEDURE write_columns(
    p_owner   IN VARCHAR2,
    p_name    IN VARCHAR2,
    p_buffer  IN OUT NOCOPY CLOB
  ) IS
    l_view    VARCHAR2(64);
    l_first   BOOLEAN := TRUE;
    l_stmt    VARCHAR2(2000);
    TYPE t_col IS RECORD (
      col_name      VARCHAR2(128),
      data_type     VARCHAR2(128),
      nullable      VARCHAR2(1),
      num_distinct  NUMBER,
      num_nulls     NUMBER,
      low_value     RAW(2000),
      high_value    RAW(2000),
      density       NUMBER,
      histogram     VARCHAR2(32),
      hist_buckets  NUMBER
    );
    TYPE t_col_tab IS TABLE OF t_col;
    l_cols    t_col_tab;
    l_low_dec VARCHAR2(4000);
    l_high_dec VARCHAR2(4000);
  BEGIN
    l_view := CASE WHEN g_use_dba_cols THEN 'dba_tab_columns' ELSE 'all_tab_columns' END;
    l_stmt := 'SELECT c.column_name, c.data_type, c.nullable, '
           || '       c.num_distinct, c.num_nulls, c.low_value, c.high_value, c.density, '
           || '       NVL(c.histogram, ''NONE''), NVL(c.num_buckets, 0) '
           || 'FROM ' || l_view || ' c '
           || 'WHERE c.owner = :1 AND c.table_name = :2 '
           || 'ORDER BY c.column_id';

    BEGIN
      EXECUTE IMMEDIATE l_stmt BULK COLLECT INTO l_cols USING p_owner, p_name;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -942 AND g_use_dba_cols THEN
          g_use_dba_cols := FALSE;
          write_columns(p_owner, p_name, p_buffer);
          RETURN;
        END IF;
        add_warning(p_owner || '.' || p_name, 'Column stats query failed: ' || SQLERRM);
        DBMS_LOB.APPEND(p_buffer, '"columns":{}');
        RETURN;
    END;

    DBMS_LOB.APPEND(p_buffer, '"columns":{');
    FOR i IN 1 .. l_cols.COUNT LOOP
      l_low_dec  := decode_raw_value(l_cols(i).low_value,  l_cols(i).data_type);
      l_high_dec := decode_raw_value(l_cols(i).high_value, l_cols(i).data_type);
      IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
      l_first := FALSE;
      DBMS_LOB.APPEND(p_buffer,
        js_string(l_cols(i).col_name) || ':{'
        || '"data_type":' || js_string(l_cols(i).data_type)
        || ',"nullable":' || js_bool(l_cols(i).nullable = 'Y')
        || ',"num_distinct":' || js_number(l_cols(i).num_distinct)
        || ',"num_nulls":' || js_number(l_cols(i).num_nulls)
        || ',"low_value":' || js_string(l_low_dec)
        || ',"high_value":' || js_string(l_high_dec)
        || ',"density":' || js_number(l_cols(i).density)
        || ',"histogram":{'
        || '"type":' || js_string(l_cols(i).histogram)
        || ',"buckets":' || js_number(l_cols(i).hist_buckets)
        || '}'
        || '}'
      );
    END LOOP;
    DBMS_LOB.APPEND(p_buffer, '}');
  END;

  PROCEDURE write_indexes_list(
    p_owner   IN VARCHAR2,
    p_name    IN VARCHAR2,
    p_buffer  IN OUT NOCOPY CLOB
  ) IS
    l_view   VARCHAR2(64);
    l_stmt   VARCHAR2(2000);
    l_first  BOOLEAN := TRUE;
    TYPE t_idx IS TABLE OF VARCHAR2(257);
    l_idx_keys t_idx;
  BEGIN
    l_view := CASE WHEN g_use_dba_indexes THEN 'dba_indexes' ELSE 'all_indexes' END;
    l_stmt := 'SELECT owner || ''.'' || index_name FROM ' || l_view
           || ' WHERE table_owner = :1 AND table_name = :2 ORDER BY index_name';
    BEGIN
      EXECUTE IMMEDIATE l_stmt BULK COLLECT INTO l_idx_keys USING p_owner, p_name;
    EXCEPTION
      WHEN OTHERS THEN
        IF SQLCODE = -942 AND g_use_dba_indexes THEN
          g_use_dba_indexes := FALSE;
          write_indexes_list(p_owner, p_name, p_buffer);
          RETURN;
        END IF;
        DBMS_LOB.APPEND(p_buffer, '"indexes":[]');
        RETURN;
    END;
    DBMS_LOB.APPEND(p_buffer, '"indexes":[');
    FOR i IN 1 .. l_idx_keys.COUNT LOOP
      IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
      l_first := FALSE;
      DBMS_LOB.APPEND(p_buffer, js_string(l_idx_keys(i)));
      add_object(SUBSTR(l_idx_keys(i), 1, INSTR(l_idx_keys(i), '.') - 1),
                 SUBSTR(l_idx_keys(i), INSTR(l_idx_keys(i), '.') + 1),
                 'INDEX');
    END LOOP;
    DBMS_LOB.APPEND(p_buffer, ']');
  END;

  PROCEDURE write_index_object(
    p_owner   IN VARCHAR2,
    p_name    IN VARCHAR2,
    p_buffer  IN OUT NOCOPY CLOB
  ) IS
    l_view        VARCHAR2(64);
    l_uniqueness  VARCHAR2(32);
    l_index_type  VARCHAR2(64);
    l_status      VARCHAR2(32);
    l_visibility  VARCHAR2(32);
    l_partitioned VARCHAR2(3);
    l_cf          NUMBER;
    l_blevel      NUMBER;
    l_leaf        NUMBER;
    l_distinct    NUMBER;
    l_table_owner VARCHAR2(128);
    l_table_name  VARCHAR2(128);
    l_stmt        VARCHAR2(2000);
    l_cols_stmt   VARCHAR2(2000);
    l_cols_view   VARCHAR2(64);
    l_cols        SYS.ODCIVARCHAR2LIST;
    l_first       BOOLEAN := TRUE;
  BEGIN
    l_view := CASE WHEN g_use_dba_indexes THEN 'dba_indexes' ELSE 'all_indexes' END;
    l_stmt := 'SELECT uniqueness, index_type, status, visibility, partitioned, '
           || '       clustering_factor, blevel, leaf_blocks, distinct_keys, '
           || '       table_owner, table_name '
           || 'FROM ' || l_view || ' WHERE owner = :1 AND index_name = :2';
    BEGIN
      EXECUTE IMMEDIATE l_stmt
        INTO l_uniqueness, l_index_type, l_status, l_visibility, l_partitioned,
             l_cf, l_blevel, l_leaf, l_distinct,
             l_table_owner, l_table_name
        USING p_owner, p_name;
    EXCEPTION
      WHEN NO_DATA_FOUND THEN
        add_warning(p_owner || '.' || p_name, 'Index not found in ' || l_view);
        RETURN;
      WHEN OTHERS THEN
        IF SQLCODE = -942 AND g_use_dba_indexes THEN
          g_use_dba_indexes := FALSE;
          write_index_object(p_owner, p_name, p_buffer);
          RETURN;
        END IF;
        add_warning(p_owner || '.' || p_name, 'Index stats query failed: ' || SQLERRM);
        RETURN;
    END;

    l_cols_view := CASE WHEN g_use_dba_indexes THEN 'dba_ind_columns' ELSE 'all_ind_columns' END;
    l_cols_stmt := 'SELECT column_name FROM ' || l_cols_view
                || ' WHERE index_owner = :1 AND index_name = :2 ORDER BY column_position';
    BEGIN
      EXECUTE IMMEDIATE l_cols_stmt BULK COLLECT INTO l_cols USING p_owner, p_name;
    EXCEPTION
      WHEN OTHERS THEN l_cols := SYS.ODCIVARCHAR2LIST();
    END;

    DBMS_LOB.APPEND(p_buffer,
      '"' || p_owner || '.' || p_name || '":{'
      || '"type":"INDEX"'
      || ',"stats":{'
      || '"uniqueness":' || js_string(l_uniqueness)
      || ',"index_type":' || js_string(l_index_type)
      || ',"status":' || js_string(l_status)
      || ',"visibility":' || js_string(l_visibility)
      || ',"partitioned":' || js_bool(l_partitioned = 'YES')
      || ',"clustering_factor":' || js_number(l_cf)
      || ',"blevel":' || js_number(l_blevel)
      || ',"leaf_blocks":' || js_number(l_leaf)
      || ',"distinct_keys":' || js_number(l_distinct)
      || '}'
      || ',"columns":['
    );
    FOR i IN 1 .. l_cols.COUNT LOOP
      IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
      l_first := FALSE;
      DBMS_LOB.APPEND(p_buffer, js_string(l_cols(i)));
    END LOOP;
    DBMS_LOB.APPEND(p_buffer, ']');
    DBMS_LOB.APPEND(p_buffer,
      ',"table":' || js_string(l_table_owner || '.' || l_table_name)
      || '}'
    );
  END;

  PROCEDURE write_table_object(
    p_owner   IN VARCHAR2,
    p_name    IN VARCHAR2,
    p_buffer  IN OUT NOCOPY CLOB
  ) IS
  BEGIN
    DBMS_LOB.APPEND(p_buffer,
      '"' || p_owner || '.' || p_name || '":{'
      || '"type":"TABLE",'
    );
    write_table_stats(p_owner, p_name, p_buffer);
    DBMS_LOB.APPEND(p_buffer, ',');
    write_columns(p_owner, p_name, p_buffer);
    DBMS_LOB.APPEND(p_buffer, ',');
    write_indexes_list(p_owner, p_name, p_buffer);
    DBMS_LOB.APPEND(p_buffer, '}');
  END;

  PROCEDURE write_objects(p_buffer IN OUT NOCOPY CLOB) IS
    l_first   BOOLEAN := TRUE;
    l_count   PLS_INTEGER;
    l_type    VARCHAR2(64);
  BEGIN
    DBMS_LOB.APPEND(p_buffer, '"objects":{');
    -- Tables first. V$SQL_PLAN object_type carries decorations like
    -- 'TABLE (TEMP)' or 'INDEX (UNIQUE)', so match by prefix, not equality.
    l_count := l_objects.COUNT;
    FOR i IN 1 .. l_count LOOP
      l_type := l_objects(i).type;
      IF l_type LIKE 'TABLE%' OR l_type LIKE 'MAT_VIEW%' OR l_type = 'UNKNOWN' THEN
        IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
        l_first := FALSE;
        write_table_object(l_objects(i).owner, l_objects(i).name, p_buffer);
      END IF;
    END LOOP;
    -- Indexes (may have grown the collection above)
    l_count := l_objects.COUNT;
    FOR i IN 1 .. l_count LOOP
      l_type := l_objects(i).type;
      IF l_type LIKE 'INDEX%' THEN
        IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
        l_first := FALSE;
        write_index_object(l_objects(i).owner, l_objects(i).name, p_buffer);
      END IF;
    END LOOP;
    DBMS_LOB.APPEND(p_buffer, '}');
  END;

  PROCEDURE write_warnings(p_buffer IN OUT NOCOPY CLOB) IS
    l_first BOOLEAN := TRUE;
  BEGIN
    DBMS_LOB.APPEND(p_buffer, '"coverage_warnings":[');
    FOR i IN 1 .. l_warnings.COUNT LOOP
      IF NOT l_first THEN DBMS_LOB.APPEND(p_buffer, ','); END IF;
      l_first := FALSE;
      DBMS_LOB.APPEND(p_buffer,
        '{"object":' || js_string(l_warnings(i).object)
        || ',"reason":' || js_string(l_warnings(i).reason)
        || '}'
      );
    END LOOP;
    DBMS_LOB.APPEND(p_buffer, ']');
  END;

  PROCEDURE write_system_params(p_buffer IN OUT NOCOPY CLOB) IS
    l_block_size  VARCHAR2(64);
    l_ofe         VARCHAR2(64);
    l_index_cost  VARCHAR2(64);
    l_index_cache VARCHAR2(64);

    -- Dynamic so a non-privileged user (no SELECT on V$PARAMETER) degrades to
    -- null values at runtime instead of an ORA-06550 compile failure. The
    -- function body must follow the item declarations above (PL/SQL rule).
    FUNCTION get_param(p_name IN VARCHAR2) RETURN VARCHAR2 IS
      l_val VARCHAR2(512);
    BEGIN
      EXECUTE IMMEDIATE 'SELECT value FROM v$parameter WHERE name = :1'
        INTO l_val USING p_name;
      RETURN l_val;
    EXCEPTION WHEN OTHERS THEN RETURN NULL;
    END;
  BEGIN
    l_block_size  := get_param('db_block_size');
    l_ofe         := get_param('optimizer_features_enable');
    l_index_cost  := get_param('optimizer_index_cost_adj');
    l_index_cache := get_param('optimizer_index_caching');

    DBMS_LOB.APPEND(p_buffer,
      '"system_params":{'
      || '"db_block_size":' || CASE WHEN l_block_size IS NULL THEN 'null' ELSE l_block_size END
      || ',"optimizer_features_enable":' || js_string(l_ofe)
      || ',"optimizer_index_cost_adj":' || CASE WHEN l_index_cost IS NULL THEN 'null' ELSE l_index_cost END
      || ',"optimizer_index_caching":' || CASE WHEN l_index_cache IS NULL THEN 'null' ELSE l_index_cache END
      || '}'
    );
  END;

BEGIN
  ----------------------------------------------------------------------------
  -- Parse arguments
  ----------------------------------------------------------------------------
  IF '&arg1' = 'LIST' OR '&arg1' = 'list' THEN
    g_mode := 'LIST';
    g_manual_list := '&arg2';
  ELSE
    g_mode := 'SQL_ID';
    g_sql_id := '&arg1';
    BEGIN
      g_plan_hash := TO_NUMBER('&arg2');
    EXCEPTION WHEN OTHERS THEN g_plan_hash := NULL; END;
  END IF;

  ----------------------------------------------------------------------------
  -- Source metadata
  ----------------------------------------------------------------------------
  SELECT SYS_CONTEXT('USERENV', 'CON_NAME') INTO g_container FROM DUAL;
  -- Dynamic SQL for the dictionary/dynamic-performance views below: a plain
  -- schema owner may lack SELECT on V$DATABASE and PRODUCT_COMPONENT_VERSION,
  -- and a static reference would fail the whole block at COMPILE time.
  BEGIN
    EXECUTE IMMEDIATE 'SELECT name FROM v$database' INTO g_db_name;
  EXCEPTION WHEN OTHERS THEN g_db_name := NULL; END;
  BEGIN
    EXECUTE IMMEDIATE 'SELECT version_full FROM product_component_version WHERE ROWNUM = 1'
      INTO g_oracle_version;
  EXCEPTION
    WHEN OTHERS THEN
      BEGIN
        EXECUTE IMMEDIATE 'SELECT version FROM product_component_version WHERE ROWNUM = 1'
          INTO g_oracle_version;
      EXCEPTION WHEN OTHERS THEN g_oracle_version := NULL; END;
  END;

  DBMS_LOB.CREATETEMPORARY(l_buffer, TRUE);

  DBMS_LOB.APPEND(l_buffer,
    '{'
    || '"format":"ora-plan-metadata"'
    || ',"version":1'
    || ',"captured_at":' || js_iso_ts(CAST(SYSTIMESTAMP AS TIMESTAMP))
    || ',"source":{'
    || '"db_name":' || js_string(g_db_name)
    || ',"oracle_version":' || js_string(g_oracle_version)
    || ',"container_name":' || js_string(g_container)
    || '}'
    || ',"plan_ref":{'
    || '"sql_id":' || CASE WHEN g_mode = 'SQL_ID' THEN js_string(g_sql_id) ELSE 'null' END
    || ',"plan_hash_value":' || js_number(g_plan_hash)
    || '}'
    || ','
  );

  ----------------------------------------------------------------------------
  -- Container check - refuse to gather from CDB$ROOT
  ----------------------------------------------------------------------------
  IF g_container = 'CDB$ROOT' THEN
    add_warning('CDB$ROOT',
      'Connected to CDB$ROOT - object statistics live inside PDBs. '
      || 'Reconnect to the appropriate PDB and re-run this script.');
    write_objects(l_buffer);
    DBMS_LOB.APPEND(l_buffer, ',');
    write_warnings(l_buffer);
    DBMS_LOB.APPEND(l_buffer, ',');
    write_system_params(l_buffer);
    DBMS_LOB.APPEND(l_buffer, '}');
  ELSE
    ----------------------------------------------------------------------------
    -- Resolve object set
    ----------------------------------------------------------------------------
    g_use_dba_tables  := probe_dba_view('dba_tab_statistics');
    g_use_dba_cols    := probe_dba_view('dba_tab_columns');
    g_use_dba_indexes := probe_dba_view('dba_indexes');
    g_use_dba_constr  := probe_dba_view('dba_constraints');
    g_use_dba_part    := probe_dba_view('dba_tab_partitions');

    IF g_mode = 'SQL_ID' THEN
      resolve_objects_for_sql_id;
      IF l_objects.COUNT = 0 THEN
        add_warning(NVL(g_sql_id, '(no sql_id)'),
          'No objects resolved for this SQL_ID - not found in V$SQL_PLAN or DBA_HIST_SQL_PLAN. '
          || 'The cursor may have aged out of the shared pool; re-run the statement first, '
          || 'or use LIST mode with explicit OWNER.OBJECT names.');
      END IF;
    ELSE
      resolve_objects_from_list;
      IF l_objects.COUNT = 0 THEN
        add_warning('LIST', 'Manual object list is empty - nothing gathered.');
      END IF;
    END IF;

    write_objects(l_buffer);
    DBMS_LOB.APPEND(l_buffer, ',');
    write_warnings(l_buffer);
    DBMS_LOB.APPEND(l_buffer, ',');
    write_system_params(l_buffer);
    DBMS_LOB.APPEND(l_buffer, '}');
  END IF;

  ----------------------------------------------------------------------------
  -- Emit
  ----------------------------------------------------------------------------
  -- DBMS_OUTPUT is line-buffered; emit the bundle in chunks. Each PUT_LINE
  -- inserts a line break at an arbitrary position (possibly mid-string) -
  -- the visualizer strips raw newlines on import, and all legitimate
  -- newlines in values are escaped as \n by js_string. Chunks stay well
  -- under PUT_LINE's 32767-BYTE limit even for multibyte characters.
  DECLARE
    l_amount   INTEGER;
    l_offset   INTEGER := 1;
    l_total    INTEGER := DBMS_LOB.GETLENGTH(l_buffer);
    l_chunk    VARCHAR2(32767);
  BEGIN
    WHILE l_offset <= l_total LOOP
      l_amount := LEAST(8000, l_total - l_offset + 1);
      l_chunk := DBMS_LOB.SUBSTR(l_buffer, l_amount, l_offset);
      DBMS_OUTPUT.PUT_LINE(l_chunk);
      l_offset := l_offset + l_amount;
    END LOOP;
  END;

  DBMS_LOB.FREETEMPORARY(l_buffer);
END;
/

-- @@GEN:CLOSE:BEGIN@@
SPOOL OFF
SET TERMOUT ON
PROMPT Done. Wrote &spool_target - paste its contents into the visualizer's
PROMPT input box (or drop the file onto the input panel) to attach it.
-- @@GEN:CLOSE:END@@

-- Restore SQL*Plus factory defaults for the settings this script changed.
SET HEADING ON
SET FEEDBACK 6
SET PAGESIZE 14
SET LINESIZE 80
SET VERIFY ON
-- @@GEN:CLEANUP:BEGIN@@
UNDEFINE arg1
UNDEFINE arg2
UNDEFINE arg3
UNDEFINE spool_target
UNDEFINE 1
UNDEFINE 2
UNDEFINE 3
-- @@GEN:CLEANUP:END@@
