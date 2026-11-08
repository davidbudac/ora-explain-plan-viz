--------------------------------------------------------------------------------
-- plan_to_url.sql
--
-- Fetch an Oracle execution plan for a sql_id, gzip-compress and
-- base64url-encode it INSIDE THE DATABASE, and print a ready-to-click URL
-- that opens the Oracle Execution Plan Visualizer with the plan pre-loaded.
-- No copy/paste of plan text required.
--
-- The plan bytes never leave the database except as part of the printed
-- URL, and they travel in the URL's hash fragment (#gz=...), which browsers
-- never send to a server - only the visualizer's own JavaScript reads it.
--
-- Usage (SQL*Plus or SQLcl, Oracle 19c+; should also work on 12.2+):
--
--   SQL> @plan_to_url.sql <sql_id>
--   SQL> @plan_to_url.sql <sql_id> <child_number>
--   SQL> @plan_to_url.sql <sql_id> "" MONITOR
--   SQL> @plan_to_url.sql <sql_id> "" MONITOR <sql_exec_id>
--   SQL> @plan_to_url.sql <sql_id> "" AWR
--   SQL> @plan_to_url.sql <sql_id> "" AWR <plan_hash_value>
--
--   URL only, straight to the clipboard (QUIET goes after any other
--   argument; the script then EXITs SQL*Plus, so run it from the shell):
--
--   $ sqlplus -s user@db @plan_to_url.sql <sql_id> QUIET | pbcopy
--   $ sqlplus -s user@db @plan_to_url.sql <sql_id> "" AWR QUIET | pbcopy
--
--   Arguments:
--     1. sql_id        Required. The V$SQL.SQL_ID of the statement.
--     2. child_number   Optional, default 0. Only used when source=CURSOR;
--                        ignored for MONITOR and AWR. Pass "" to skip it.
--     3. source         Optional, default CURSOR. CURSOR reads the plan from
--                        the shared-cursor cache via DBMS_XPLAN.DISPLAY_CURSOR
--                        (no extra license). MONITOR reads a SQL Monitor TEXT
--                        report via DBMS_SQLTUNE.REPORT_SQL_MONITOR (requires
--                        the Oracle Tuning Pack license). AWR reads a plan the
--                        Workload Repository captured, via
--                        DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY 'ADVANCED'
--                        (requires the Oracle Diagnostics Pack license) - use
--                        it when the cursor has aged out of the shared pool.
--                        AWR keeps optimizer estimates only: no A-Rows,
--                        A-Time or Starts.
--     4. sql_exec_id /  Optional. MONITOR: picks one specific monitored
--        plan_hash_value execution (V$SQL_MONITOR.SQL_EXEC_ID). When omitted,
--                        Oracle reports the LAST monitored execution of the
--                        sql_id - possibly one that is still running. If more
--                        than one execution is still in GV$SQL_MONITOR, the
--                        script lists them (newest first) so you can re-run
--                        with the sql_exec_id you actually want.
--                        AWR: picks one plan_hash_value. When omitted, the
--                        script uses the plan AWR saw most recently and, if
--                        AWR holds more than one plan for the sql_id, lists
--                        them all (with executions and average elapsed time)
--                        so you can re-run with the one you want.
--     QUIET             Optional, last argument. Prints the URL and nothing
--                        else (no progress line, summary, notes or listings),
--                        then EXITs SQL*Plus - exit code 0 on success, 1 on
--                        failure, when the one line printed is the error.
--                        A URL over 32767 chars still comes out as several
--                        1000-char lines (no markers); Chrome's address bar
--                        drops the line breaks on paste, or pipe through
--                        tr -d '\n' first.
--
-- Privileges needed:
--   CURSOR (default): read access to V$SQL_PLAN / V$SQL_PLAN_STATISTICS_ALL,
--     e.g. via SELECT_CATALOG_ROLE. DBMS_XPLAN.DISPLAY_CURSOR itself is
--     granted to PUBLIC, but it queries those V$ views internally.
--   MONITOR: EXECUTE on DBMS_SQLTUNE, and an active Oracle Diagnostics and
--     Tuning Pack license (DBMS_SQLTUNE.REPORT_SQL_MONITOR is a licensed
--     feature - see Oracle's licensing guide before using it). Listing the
--     available executions additionally needs SELECT on GV$SQL_MONITOR
--     (e.g. via SELECT_CATALOG_ROLE); if that is missing the listing is
--     silently skipped and the report itself still works.
--   AWR: SELECT on DBA_HIST_SQL_PLAN, DBA_HIST_SQLSTAT and DBA_HIST_SNAPSHOT
--     (e.g. via SELECT_CATALOG_ROLE), and an active Oracle Diagnostics Pack
--     license (AWR is a licensed feature). In a PDB the script reads both
--     the CDB-level AWR and the PDB's own AWR snapshots; from CDB$ROOT it
--     sees only the CDB-level AWR.
--
-- Self-hosting the visualizer? Point base_url below at your own deployment
-- instead of the public GitHub Pages instance.
--
-- Read-only guarantee: this script only reads via DBMS_XPLAN.DISPLAY_CURSOR
-- / DBMS_SQLTUNE.REPORT_SQL_MONITOR / DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY
-- and SELECTs on GV$SQL_MONITOR / DBA_HIST_* views, allocates temporary (session-private)
-- LOBs it frees itself, and writes to the screen via DBMS_OUTPUT. It makes
-- no DML, DDL, or SPOOL writes.
--------------------------------------------------------------------------------

-- Base URL for the visualizer app. Self-hosters: override this to point at
-- your own deployment, e.g.:
--   DEFINE base_url = 'https://your-domain.example/ora-explain-plan-viz/'
DEFINE base_url = 'https://davidbudac.github.io/ora-explain-plan-viz/'

SET ECHO OFF
SET HEADING OFF
SET FEEDBACK OFF
SET PAGESIZE 0
SET LINESIZE 32767
SET SERVEROUTPUT ON SIZE UNLIMITED FORMAT WRAPPED
SET TRIMOUT ON
SET TAB OFF
SET TERMOUT ON
SET VERIFY OFF

-- Positional arguments: sql_id (required), child_number, source and
-- sql_exec_id (all optional), plus a trailing QUIET flag. Default args 2-5
-- via the zero-row NEW_VALUE idiom so SQL*Plus never prompts for them when
-- omitted.
SET TERMOUT OFF
COLUMN 2 NEW_VALUE 2 NOPRINT
COLUMN 3 NEW_VALUE 3 NOPRINT
COLUMN 4 NEW_VALUE 4 NOPRINT
COLUMN 5 NEW_VALUE 5 NOPRINT
SELECT NULL "2", NULL "3", NULL "4", NULL "5" FROM dual WHERE 1 = 2;

-- QUIET may sit in any of positions 2-5 (it goes after whatever arguments
-- are given); blank it out wherever it is so the positional parsing below
-- never sees it. A substitution variable can't be a command name, so
-- QUIET switches behaviour through command arguments instead: TERMOUT for
-- the progress line, WHENEVER SQLERROR for the exit at the end.
COLUMN quiet     NEW_VALUE quiet     NOPRINT
COLUMN termout   NEW_VALUE termout   NOPRINT
COLUMN on_error  NEW_VALUE on_error  NOPRINT
COLUMN a2 NEW_VALUE arg2 NOPRINT
COLUMN a3 NEW_VALUE arg3 NOPRINT
COLUMN a4 NEW_VALUE arg4 NOPRINT
COLUMN a5 NEW_VALUE arg5 NOPRINT
SELECT q quiet,
       DECODE(q, 'Y', 'OFF', 'ON')                      termout,
       DECODE(q, 'Y', 'EXIT :plan_to_url_rc', 'CONTINUE') on_error,
       DECODE(UPPER(TRIM('&2')), 'QUIET', NULL, '&2')   a2,
       DECODE(UPPER(TRIM('&3')), 'QUIET', NULL, '&3')   a3,
       DECODE(UPPER(TRIM('&4')), 'QUIET', NULL, '&4')   a4,
       DECODE(UPPER(TRIM('&5')), 'QUIET', NULL, '&5')   a5
  FROM (SELECT CASE WHEN 'QUIET' IN (UPPER(TRIM('&2')), UPPER(TRIM('&3')),
                                     UPPER(TRIM('&4')), UPPER(TRIM('&5')))
                    THEN 'Y' ELSE 'N' END q
          FROM dual);
SET TERMOUT ON

DEFINE arg1 = "&1"

VARIABLE plan_to_url_rc NUMBER

SET TERMOUT &termout
PROMPT Building a share URL for sql_id &arg1 ...
SET TERMOUT ON

DECLARE
  -- Parsed/defaulted arguments
  g_sql_id    VARCHAR2(32);
  g_child     NUMBER;
  g_source    VARCHAR2(16);
  g_exec_id   NUMBER;               -- MONITOR only: specific SQL_EXEC_ID
  g_exec_note VARCHAR2(64);         -- what the summary line reports for it
  g_phv       NUMBER;               -- AWR only: plan_hash_value to report
  g_phv_note  VARCHAR2(64);         -- what the summary line reports for it
  g_base_url  VARCHAR2(4000) := '&base_url';
  g_quiet     BOOLEAN := '&quiet' = 'Y';  -- QUIET: print the URL only

  -- Friendly-abort plumbing: raised whenever we want to stop and print a
  -- one-line, non-technical explanation instead of an unhandled error.
  e_friendly_abort EXCEPTION;
  l_abort_msg VARCHAR2(4000);

  -- Pipeline state
  l_plan_clob  CLOB;
  l_line_count PLS_INTEGER := 0;
  l_blob       BLOB;
  l_gzip       BLOB;
  l_encoded    CLOB;
  l_url        CLOB;

  l_raw_bytes  INTEGER;
  l_gzip_bytes INTEGER;
  l_url_len    INTEGER;
  l_ratio      NUMBER;

  ------------------------------------------------------------------------
  -- Free every temporary LOB we may have allocated. Safe to call at any
  -- point, including before some of the LOBs were ever created (a NULL or
  -- non-temporary locator makes ISTEMPORARY return 0/NULL, so we simply
  -- skip it) - wrapped per-LOB so one failure doesn't skip the rest.
  ------------------------------------------------------------------------
  ------------------------------------------------------------------------
  -- Everything except the URL and error messages goes through say(), so
  -- QUIET mode prints the URL alone.
  ------------------------------------------------------------------------
  PROCEDURE say(p_text IN VARCHAR2) IS
  BEGIN
    IF NOT g_quiet THEN
      DBMS_OUTPUT.PUT_LINE(p_text);
    END IF;
  END say;

  PROCEDURE cleanup_lobs IS
  BEGIN
    BEGIN
      IF DBMS_LOB.ISTEMPORARY(l_plan_clob) = 1 THEN DBMS_LOB.FREETEMPORARY(l_plan_clob); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      IF DBMS_LOB.ISTEMPORARY(l_blob) = 1 THEN DBMS_LOB.FREETEMPORARY(l_blob); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      IF DBMS_LOB.ISTEMPORARY(l_gzip) = 1 THEN DBMS_LOB.FREETEMPORARY(l_gzip); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      IF DBMS_LOB.ISTEMPORARY(l_encoded) = 1 THEN DBMS_LOB.FREETEMPORARY(l_encoded); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      IF DBMS_LOB.ISTEMPORARY(l_url) = 1 THEN DBMS_LOB.FREETEMPORARY(l_url); END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END cleanup_lobs;

  ------------------------------------------------------------------------
  -- Count newline-delimited lines in a CLOB, chunk by chunk (no single
  -- DBMS_LOB.SUBSTR call is required to exceed a 32767-char window).
  ------------------------------------------------------------------------
  FUNCTION count_lines(p_clob IN CLOB) RETURN PLS_INTEGER IS
    l_len   INTEGER := DBMS_LOB.GETLENGTH(p_clob);
    l_off   INTEGER := 1;
    l_amt   INTEGER;
    l_chunk VARCHAR2(32767);
    l_count PLS_INTEGER := 0;
    l_pos   PLS_INTEGER;
  BEGIN
    IF l_len IS NULL OR l_len = 0 THEN
      RETURN 0;
    END IF;
    WHILE l_off <= l_len LOOP
      l_amt   := LEAST(32767, l_len - l_off + 1);
      l_chunk := DBMS_LOB.SUBSTR(p_clob, l_amt, l_off);
      l_pos := 0;
      LOOP
        l_pos := INSTR(l_chunk, CHR(10), l_pos + 1);
        EXIT WHEN l_pos = 0;
        l_count := l_count + 1;
      END LOOP;
      l_off := l_off + l_amt;
    END LOOP;
    RETURN l_count;
  END count_lines;

  ------------------------------------------------------------------------
  -- Base64url-encode a BLOB into an existing temporary CLOB, in
  -- 12,000-byte chunks. 12,000 is a multiple of 48 (and of 3), so every
  -- chunk except possibly the last encodes to exactly 16,000 chars with no
  -- '=' padding and no seam artifacts between chunks - only the true final
  -- chunk (if the compressed length isn't a multiple of 12,000) can carry
  -- trailing '=' padding, and only at the very end of the whole string.
  -- UTL_ENCODE.BASE64_ENCODE inserts CRLF every 64 output characters; those
  -- are stripped per chunk before the '+/' -> '-_' base64url translation.
  ------------------------------------------------------------------------
  PROCEDURE encode_base64url(p_src IN BLOB, p_dest IN OUT NOCOPY CLOB) IS
    l_len     INTEGER := DBMS_LOB.GETLENGTH(p_src);
    l_off     INTEGER := 1;
    l_amt     INTEGER;
    l_raw     RAW(12000);
    l_enc_raw RAW(32767);
    l_enc     VARCHAR2(32767);
  BEGIN
    IF l_len IS NULL OR l_len = 0 THEN
      RETURN;
    END IF;
    WHILE l_off <= l_len LOOP
      l_amt     := LEAST(12000, l_len - l_off + 1);
      l_raw     := DBMS_LOB.SUBSTR(p_src, l_amt, l_off);
      l_enc_raw := UTL_ENCODE.BASE64_ENCODE(l_raw);
      l_enc     := UTL_RAW.CAST_TO_VARCHAR2(l_enc_raw);
      l_enc     := REPLACE(l_enc, CHR(13), NULL);
      l_enc     := REPLACE(l_enc, CHR(10), NULL);
      l_enc     := TRANSLATE(l_enc, '+/', '-_');
      DBMS_LOB.APPEND(p_dest, l_enc);
      l_off := l_off + l_amt;
    END LOOP;
  END encode_base64url;

  ------------------------------------------------------------------------
  -- Print a (potentially very large) URL. Under the 32767-char single-line
  -- limit it prints as one unbroken PUT_LINE, framed by blank lines so
  -- terminals linkify it cleanly. Above that (practically never for real
  -- plans - see the ratio/length summary this script also prints) it wraps
  -- across 1000-char lines between join markers.
  ------------------------------------------------------------------------
  PROCEDURE print_url(p_url IN CLOB) IS
    l_total  INTEGER := DBMS_LOB.GETLENGTH(p_url);
    l_off    INTEGER := 1;
    l_amt    INTEGER;
  BEGIN
    say(' ');
    IF l_total <= 32767 THEN
      DBMS_OUTPUT.PUT_LINE(DBMS_LOB.SUBSTR(p_url, l_total, 1));
    ELSE
      say('----8<---- join every line below into one URL, no spaces ----8<----');
      WHILE l_off <= l_total LOOP
        l_amt := LEAST(1000, l_total - l_off + 1);
        DBMS_OUTPUT.PUT_LINE(DBMS_LOB.SUBSTR(p_url, l_amt, l_off));
        l_off := l_off + l_amt;
      END LOOP;
      say('----8<---- end - join the lines above, in order, with nothing between them ----8<----');
    END IF;
    say(' ');
  END print_url;

BEGIN
  ----------------------------------------------------------------------
  -- Parse and validate arguments
  ----------------------------------------------------------------------
  :plan_to_url_rc := 0;

  IF TRIM('&arg5') IS NOT NULL THEN
    l_abort_msg := 'Unexpected fifth argument "&arg5" - the only thing allowed after '
      || 'the fourth argument is QUIET.';
    RAISE e_friendly_abort;
  END IF;

  g_sql_id := TRIM('&arg1');
  IF g_sql_id IS NULL THEN
    l_abort_msg := 'Missing required sql_id argument. Usage: @plan_to_url.sql <sql_id> [<child_no>] [CURSOR|MONITOR|AWR] [<sql_exec_id>|<plan_hash_value>]';
    RAISE e_friendly_abort;
  END IF;

  BEGIN
    g_child := TO_NUMBER(NVL(TRIM('&arg2'), '0'));
  EXCEPTION
    WHEN OTHERS THEN
      l_abort_msg := 'Invalid child number "&arg2" - expected an integer (or leave it blank / "").';
      RAISE e_friendly_abort;
  END;

  g_source := UPPER(NVL(TRIM('&arg3'), 'CURSOR'));
  IF g_source NOT IN ('CURSOR', 'MONITOR', 'AWR') THEN
    l_abort_msg := 'Unknown source "' || g_source || '" - expected CURSOR (default), MONITOR or AWR.';
    RAISE e_friendly_abort;
  END IF;

  -- Argument 4 is source-specific: sql_exec_id for MONITOR,
  -- plan_hash_value for AWR, not allowed for CURSOR.
  DECLARE
    l_arg4 NUMBER;
  BEGIN
    BEGIN
      l_arg4 := TO_NUMBER(TRIM('&arg4'));
    EXCEPTION
      WHEN OTHERS THEN
        l_abort_msg := 'Invalid fourth argument "&arg4" - expected an integer '
          || '(a sql_exec_id for MONITOR, a plan_hash_value for AWR), or leave it blank.';
        RAISE e_friendly_abort;
    END;
    IF l_arg4 IS NOT NULL AND g_source = 'CURSOR' THEN
      l_abort_msg := 'The fourth argument only applies to the MONITOR (sql_exec_id) and AWR '
        || '(plan_hash_value) sources. Usage: @plan_to_url.sql <sql_id> "" MONITOR <sql_exec_id>'
        || ' or @plan_to_url.sql <sql_id> "" AWR <plan_hash_value>';
      RAISE e_friendly_abort;
    END IF;
    IF g_source = 'MONITOR' THEN
      g_exec_id := l_arg4;
    ELSIF g_source = 'AWR' THEN
      g_phv := l_arg4;
    END IF;
  END;

  ----------------------------------------------------------------------
  -- 1. Fetch the plan text
  ----------------------------------------------------------------------
  DBMS_LOB.CREATETEMPORARY(l_plan_clob, TRUE);

  IF g_source = 'CURSOR' THEN
    DECLARE
      l_row_num PLS_INTEGER := 0;
    BEGIN
      FOR rec IN (
        SELECT plan_table_output
        FROM TABLE(DBMS_XPLAN.DISPLAY_CURSOR(g_sql_id, g_child, 'ALLSTATS LAST'))
      ) LOOP
        l_row_num := l_row_num + 1;
        -- Two ways DISPLAY_CURSOR says there is no plan: "... cannot be found"
        -- near the top, or "NOTE: cannot fetch plan for SQL_ID ..." after the
        -- SQL text (any length; also printed for PL/SQL blocks, which have none).
        IF (l_row_num <= 5 AND rec.plan_table_output LIKE '%cannot be found%')
           OR rec.plan_table_output LIKE 'NOTE: cannot fetch plan for SQL_ID%' THEN
          l_abort_msg := 'No plan found in the cursor cache for sql_id=' || g_sql_id
            || ', child=' || g_child || '. The cursor has likely aged out of the shared pool - '
            || 're-run the statement so it is reparsed, then try again. If an AWR snapshot '
            || 'captured it, pass AWR as the third argument (Diagnostics Pack): '
            || '@plan_to_url.sql ' || g_sql_id || ' "" AWR. If the statement was SQL-Monitored, '
            || 'pass MONITOR instead.';
          RAISE e_friendly_abort;
        END IF;
        DBMS_LOB.APPEND(l_plan_clob, rec.plan_table_output || CHR(10));
      END LOOP;
    END;
  ELSIF g_source = 'MONITOR' THEN
    -- MONITOR source. Dynamic SQL on purpose: a static reference to
    -- DBMS_SQLTUNE would make this whole anonymous block fail to compile
    -- for a user without EXECUTE on it, before any exception handler could
    -- run. Dynamic SQL turns that into a catchable runtime error instead.
    DECLARE
      l_report CLOB;
    BEGIN
      -- No sql_exec_id given: REPORT_SQL_MONITOR will silently pick the LAST
      -- monitored execution of this sql_id (possibly one still running). If
      -- several executions are still in GV$SQL_MONITOR, list them so the
      -- choice is visible and repeatable. Dynamic SQL for the same reason as
      -- the report call below: a static reference to GV$SQL_MONITOR would
      -- fail the whole block at compile time for users without access, so
      -- missing SELECT privilege just skips the listing instead.
      IF g_exec_id IS NULL THEN
        DECLARE
          l_cur        SYS_REFCURSOR;
          l_exec_id    NUMBER;
          l_exec_start DATE;
          l_status     VARCHAR2(30);
          l_phv        NUMBER;
          l_elapsed_s  NUMBER;
          l_user       VARCHAR2(128);
          l_rows       PLS_INTEGER := 0;
          l_first_row  VARCHAR2(400);
          l_row        VARCHAR2(400);
        BEGIN
          -- process_name = 'ora' keeps one row per execution (parallel
          -- executions add one row per PX slave process).
          OPEN l_cur FOR
            'SELECT sql_exec_id, sql_exec_start, status, sql_plan_hash_value, '
            || 'ROUND(elapsed_time / 1e6, 1), username '
            || 'FROM gv$sql_monitor '
            -- last_refresh_time DESC (not sql_exec_start) so the top row
            -- matches what REPORT_SQL_MONITOR's default "last monitored
            -- execution" actually picks - e.g. a long runner that started
            -- earlier but is still executing.
            || 'WHERE sql_id = :sid AND process_name = ''ora'' '
            || 'ORDER BY last_refresh_time DESC, sql_exec_start DESC, sql_exec_id DESC'
            USING g_sql_id;
          LOOP
            FETCH l_cur INTO l_exec_id, l_exec_start, l_status, l_phv, l_elapsed_s, l_user;
            EXIT WHEN l_cur%NOTFOUND;
            l_rows := l_rows + 1;
            l_row := RPAD(TO_CHAR(l_exec_id), 13)
              || RPAD(TO_CHAR(l_exec_start, 'YYYY-MM-DD HH24:MI:SS'), 21)
              || RPAD(NVL(l_status, '?'), 18)
              || RPAD(NVL(TO_CHAR(l_phv), '?'), 12)
              || RPAD(NVL(TO_CHAR(l_elapsed_s), '?'), 11)
              || NVL(l_user, '?');
            IF l_rows = 1 THEN
              -- The newest execution is the one Oracle's default reports on.
              -- Hold its line back until we know whether a listing is needed.
              g_exec_note := TO_CHAR(l_exec_id) || ' (latest)';
              l_first_row := l_row;
            ELSE
              IF l_rows = 2 THEN
                say(' ');
                say('Multiple monitored executions found for sql_id=' || g_sql_id
                  || ' (most recently active first, * = the one this report uses):');
                say('  ' || RPAD('sql_exec_id', 13) || RPAD('started', 21)
                  || RPAD('status', 18) || RPAD('plan_hash', 12) || RPAD('elapsed_s', 11) || 'user');
                say('* ' || l_first_row);
              END IF;
              say('  ' || l_row);
            END IF;
          END LOOP;
          CLOSE l_cur;
          IF l_rows > 1 THEN
            say('To share a different execution, re-run with its sql_exec_id:');
            say('  @plan_to_url.sql ' || g_sql_id || ' "" MONITOR <sql_exec_id>');
            say(' ');
          END IF;
        EXCEPTION
          WHEN OTHERS THEN
            -- No SELECT on GV$SQL_MONITOR (or similar): skip the listing,
            -- the report call below still works on its own.
            BEGIN
              IF l_cur%ISOPEN THEN CLOSE l_cur; END IF;
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
        END;
      ELSE
        g_exec_note := TO_CHAR(g_exec_id);
      END IF;

      BEGIN
        IF g_exec_id IS NOT NULL THEN
          EXECUTE IMMEDIATE
            'BEGIN :rpt := DBMS_SQLTUNE.REPORT_SQL_MONITOR(sql_id => :sid, sql_exec_id => :xid, type => ''TEXT'', report_level => ''ALL''); END;'
            USING OUT l_report, IN g_sql_id, IN g_exec_id;
        ELSE
          EXECUTE IMMEDIATE
            'BEGIN :rpt := DBMS_SQLTUNE.REPORT_SQL_MONITOR(sql_id => :sid, type => ''TEXT'', report_level => ''ALL''); END;'
            USING OUT l_report, IN g_sql_id;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          l_abort_msg := 'Could not generate a SQL Monitor report - this usually means you lack '
            || 'EXECUTE on DBMS_SQLTUNE, or the Oracle Tuning Pack is not licensed here. '
            || 'Database said: ' || SUBSTR(SQLERRM, 1, 300);
          RAISE e_friendly_abort;
      END;

      IF l_report IS NULL OR DBMS_LOB.GETLENGTH(l_report) < 50 THEN
        IF g_exec_id IS NOT NULL THEN
          l_abort_msg := 'No usable SQL Monitor report for sql_id=' || g_sql_id
            || ', sql_exec_id=' || g_exec_id || ' - that execution may have aged out of '
            || 'V$SQL_MONITOR, or the sql_exec_id is wrong. Re-run without the sql_exec_id '
            || 'argument to list the executions that are still available.';
        ELSE
          l_abort_msg := 'No usable SQL Monitor report for sql_id=' || g_sql_id
            || ' - the statement does not appear to have been monitored (it must run at least '
            || '5 seconds, run parallel, or use the /*+ MONITOR */ hint).';
        END IF;
        RAISE e_friendly_abort;
      END IF;

      DECLARE
        l_head VARCHAR2(500) := LOWER(DBMS_LOB.SUBSTR(l_report, 500, 1));
      BEGIN
        IF l_head LIKE '%no data found%'
           OR l_head LIKE '%not found%'
           OR l_head LIKE '%no sql statement%'
           OR l_head LIKE '%no monitoring information%' THEN
          IF g_exec_id IS NOT NULL THEN
            l_abort_msg := 'No SQL Monitor report is available for sql_id=' || g_sql_id
              || ', sql_exec_id=' || g_exec_id || ' - that execution may have aged out, or the '
              || 'sql_exec_id is wrong. Re-run without it to list the available executions.';
          ELSE
            l_abort_msg := 'No SQL Monitor report is available for sql_id=' || g_sql_id
              || ' - the statement does not appear to have been monitored.';
          END IF;
          RAISE e_friendly_abort;
        END IF;
      END;

      DBMS_LOB.APPEND(l_plan_clob, l_report);
      BEGIN
        IF DBMS_LOB.ISTEMPORARY(l_report) = 1 THEN
          DBMS_LOB.FREETEMPORARY(l_report);
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END;
  ELSE
    -- AWR source. Dynamic SQL throughout, like MONITOR: static references
    -- to DBA_HIST_* or DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY would make the
    -- whole block fail to compile for a user without access to them.
    --
    -- Where AWR keeps a plan matters. DBA_HIST_SQL_PLAN shows CDB-level AWR
    -- rows (dbid = the CDB's DBID) and, inside a PDB, also the PDB's own AWR
    -- snapshots (dbid = the PDB's CON_DBID). DISPLAY_WORKLOAD_REPOSITORY
    -- needs the row's dbid / con_dbid plus awr_location => 'AWR_PDB' for the
    -- latter; its defaults find neither a PDB statement from CDB$ROOT nor a
    -- PDB-AWR plan from inside the PDB (verified on 19.27).
    DECLARE
      l_cur         SYS_REFCURSOR;
      l_my_dbid     NUMBER := TO_NUMBER(SYS_CONTEXT('USERENV', 'DBID'));
      l_my_con_dbid NUMBER := TO_NUMBER(SYS_CONTEXT('USERENV', 'CON_DBID'));
      l_phv         NUMBER;
      l_dbid        NUMBER;
      l_con_dbid    NUMBER;
      l_last_seen   DATE;
      l_execs       NUMBER;
      l_avg_s       NUMBER;
      l_use_dbid    NUMBER;
      l_use_con     NUMBER;
      l_location    VARCHAR2(16);
      l_rows        PLS_INTEGER := 0;
      l_first_row   VARCHAR2(400);
      l_row         VARCHAR2(400);
      l_line        VARCHAR2(4000);
    BEGIN
      -- One row per plan_hash_value, most recently seen first. When the same
      -- plan sits in both the CDB-level and the PDB's own AWR, keep the copy
      -- seen last (CDB-level on a tie). Plans with no DBA_HIST_SQLSTAT row
      -- (rare: stats purged before the plan) sort last.
      BEGIN
        OPEN l_cur FOR
          'WITH p AS ('
          || '  SELECT dbid, con_dbid, plan_hash_value phv, MIN(timestamp) parsed'
          || '  FROM dba_hist_sql_plan'
          || '  WHERE sql_id = :sid AND plan_hash_value <> 0'
          || '    AND (:phv1 IS NULL OR plan_hash_value = :phv2)'
          || '  GROUP BY dbid, con_dbid, plan_hash_value), '
          || 's AS ('
          || '  SELECT st.dbid, st.con_dbid, st.plan_hash_value phv,'
          || '         SUM(st.executions_delta) execs, SUM(st.elapsed_time_delta) ela,'
          || '         MAX(sn.end_interval_time) last_seen'
          || '  FROM dba_hist_sqlstat st'
          || '  JOIN dba_hist_snapshot sn'
          || '    ON sn.dbid = st.dbid AND sn.snap_id = st.snap_id'
          || '   AND sn.instance_number = st.instance_number'
          || '  WHERE st.sql_id = :sid2'
          || '  GROUP BY st.dbid, st.con_dbid, st.plan_hash_value) '
          || 'SELECT phv, dbid, con_dbid, CAST(last_seen AS DATE), execs,'
          || '       ROUND(ela / 1e6 / NULLIF(execs, 0), 3) '
          || 'FROM ('
          || '  SELECT p.phv, p.dbid, p.con_dbid, p.parsed, s.execs, s.ela, s.last_seen,'
          || '         ROW_NUMBER() OVER (PARTITION BY p.phv ORDER BY s.last_seen DESC NULLS LAST,'
          || '           CASE WHEN p.dbid = :mydbid THEN 0 ELSE 1 END) rn'
          || '  FROM p LEFT JOIN s'
          || '    ON s.dbid = p.dbid AND s.con_dbid = p.con_dbid AND s.phv = p.phv) '
          || 'WHERE rn = 1 '
          || 'ORDER BY last_seen DESC NULLS LAST, parsed DESC, phv'
          USING g_sql_id, g_phv, g_phv, g_sql_id, l_my_dbid;
      EXCEPTION
        WHEN OTHERS THEN
          l_abort_msg := 'Could not read AWR - this usually means you lack SELECT on '
            || 'DBA_HIST_SQL_PLAN / DBA_HIST_SQLSTAT / DBA_HIST_SNAPSHOT (e.g. via '
            || 'SELECT_CATALOG_ROLE). Database said: ' || SUBSTR(SQLERRM, 1, 300);
          RAISE e_friendly_abort;
      END;

      LOOP
        FETCH l_cur INTO l_phv, l_dbid, l_con_dbid, l_last_seen, l_execs, l_avg_s;
        EXIT WHEN l_cur%NOTFOUND;
        l_rows := l_rows + 1;
        l_row := RPAD(TO_CHAR(l_phv), 17)
          || RPAD(NVL(TO_CHAR(l_last_seen, 'YYYY-MM-DD HH24:MI'), '?'), 18)
          || RPAD(NVL(TO_CHAR(l_execs), '?'), 12)
          || RPAD(NVL(TO_CHAR(l_avg_s, 'FM999999990.000'), '?'), 15)
          || CASE WHEN l_dbid <> l_my_dbid THEN 'PDB' ELSE 'CDB' END;
        IF l_rows = 1 THEN
          -- The most recently seen plan is the one this run reports on.
          -- Hold its line back until we know whether a listing is needed.
          g_phv      := l_phv;
          l_use_dbid := l_dbid;
          l_use_con  := l_con_dbid;
          l_first_row := l_row;
        ELSE
          IF l_rows = 2 THEN
            say(' ');
            say('AWR holds more than one plan for sql_id=' || g_sql_id
              || ' (most recently seen first, * = the one this run uses):');
            say('  ' || RPAD('plan_hash_value', 17) || RPAD('last seen', 18)
              || RPAD('executions', 12) || RPAD('avg elapsed_s', 15) || 'awr');
            say('* ' || l_first_row);
          END IF;
          say('  ' || l_row);
        END IF;
      END LOOP;
      CLOSE l_cur;

      IF l_rows = 0 THEN
        IF g_phv IS NOT NULL THEN
          l_abort_msg := 'AWR has no plan with plan_hash_value=' || g_phv || ' for sql_id='
            || g_sql_id || '. Re-run without the plan_hash_value to list the plans AWR holds.';
        ELSE
          l_abort_msg := 'AWR has no plan for sql_id=' || g_sql_id || '. AWR snapshots keep '
            || 'only the top SQL of each interval (DBMS_WORKLOAD_REPOSITORY.ADD_COLORED_SQL '
            || 'forces capture), and old plans are purged with the AWR retention.'
            || CASE WHEN SYS_CONTEXT('USERENV', 'CON_NAME') = 'CDB$ROOT'
                 THEN ' From CDB$ROOT only the CDB-level AWR is visible: if the statement ran '
                   || 'in a PDB that takes its own AWR snapshots, run this from that PDB.' END;
        END IF;
        RAISE e_friendly_abort;
      END IF;

      IF l_rows > 1 THEN
        say('To share a different plan, re-run with its plan_hash_value:');
        say('  @plan_to_url.sql ' || g_sql_id || ' "" AWR <plan_hash_value>');
        say(' ');
        g_phv_note := TO_CHAR(g_phv) || ' (latest)';
      ELSE
        g_phv_note := TO_CHAR(g_phv);
      END IF;

      -- A PDB's own AWR has dbid = its CON_DBID, which differs from the CDB's
      -- DBID; everything else (CDB-level AWR, non-CDB) is AWR_ROOT.
      l_location := CASE
                      WHEN l_use_dbid <> l_my_dbid AND l_use_dbid = l_my_con_dbid THEN 'AWR_PDB'
                      ELSE 'AWR_ROOT'
                    END;

      BEGIN
        OPEN l_cur FOR
          'SELECT plan_table_output FROM TABLE(DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY('
          || 'sql_id => :sid, plan_hash_value => :phv, format => ''ADVANCED'', '
          || 'dbid => :dbid, con_dbid => :con_dbid, awr_location => :loc))'
          USING g_sql_id, g_phv, l_use_dbid, l_use_con, l_location;
        LOOP
          FETCH l_cur INTO l_line;
          EXIT WHEN l_cur%NOTFOUND;
          DBMS_LOB.APPEND(l_plan_clob, l_line || CHR(10));
        END LOOP;
        CLOSE l_cur;
      EXCEPTION
        WHEN OTHERS THEN
          BEGIN
            IF l_cur%ISOPEN THEN CLOSE l_cur; END IF;
          EXCEPTION WHEN OTHERS THEN NULL;
          END;
          l_abort_msg := 'Could not read the plan from AWR with DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY '
            || '(Oracle 12.2+; needs the Diagnostics Pack enabled - CONTROL_MANAGEMENT_PACK_ACCESS). '
            || 'Database said: ' || SUBSTR(SQLERRM, 1, 300);
          RAISE e_friendly_abort;
      END;

      IF DBMS_LOB.GETLENGTH(l_plan_clob) = 0 THEN
        l_abort_msg := 'DBMS_XPLAN.DISPLAY_WORKLOAD_REPOSITORY returned nothing for sql_id='
          || g_sql_id || ', plan_hash_value=' || g_phv || ' (' || l_location || ', dbid '
          || l_use_dbid || ', con_dbid ' || l_use_con || ').';
        RAISE e_friendly_abort;
      END IF;
    END;
  END IF;

  IF DBMS_LOB.GETLENGTH(l_plan_clob) = 0 THEN
    l_abort_msg := 'The plan text came back empty - nothing to share.';
    RAISE e_friendly_abort;
  END IF;

  l_line_count := count_lines(l_plan_clob);

  ----------------------------------------------------------------------
  -- 2. CLOB -> BLOB (force UTF-8 bytes regardless of DB charset, so the
  --    browser's Response.text() decode always matches)
  ----------------------------------------------------------------------
  DBMS_LOB.CREATETEMPORARY(l_blob, TRUE);
  DECLARE
    l_dest_offset INTEGER := 1;
    l_src_offset  INTEGER := 1;
    l_lang_ctx    INTEGER := DBMS_LOB.DEFAULT_LANG_CTX;
    l_warning     INTEGER;
  BEGIN
    DBMS_LOB.CONVERTTOBLOB(
      dest_lob     => l_blob,
      src_clob     => l_plan_clob,
      amount       => DBMS_LOB.LOBMAXSIZE,
      dest_offset  => l_dest_offset,
      src_offset   => l_src_offset,
      blob_csid    => NLS_CHARSET_ID('AL32UTF8'),
      lang_context => l_lang_ctx,
      warning      => l_warning
    );
  END;

  ----------------------------------------------------------------------
  -- 3. Compress (gzip / RFC 1952, matches the browser's DecompressionStream)
  ----------------------------------------------------------------------
  l_gzip := UTL_COMPRESS.LZ_COMPRESS(src => l_blob, quality => 9);

  ----------------------------------------------------------------------
  -- 4. Base64url-encode
  ----------------------------------------------------------------------
  DBMS_LOB.CREATETEMPORARY(l_encoded, TRUE);
  encode_base64url(l_gzip, l_encoded);

  -- Strip trailing '=' padding from the fully assembled string only (never
  -- mid-stream - see encode_base64url).
  DECLARE
    l_len INTEGER := DBMS_LOB.GETLENGTH(l_encoded);
  BEGIN
    WHILE l_len > 0 AND DBMS_LOB.SUBSTR(l_encoded, 1, l_len) = '=' LOOP
      l_len := l_len - 1;
    END LOOP;
    DBMS_LOB.TRIM(l_encoded, l_len);
  END;

  ----------------------------------------------------------------------
  -- 5. Assemble and print the URL
  ----------------------------------------------------------------------
  DBMS_LOB.CREATETEMPORARY(l_url, TRUE);
  DBMS_LOB.APPEND(l_url, g_base_url);
  DBMS_LOB.APPEND(l_url, '#gz=');
  DBMS_LOB.APPEND(l_url, l_encoded);

  l_raw_bytes  := DBMS_LOB.GETLENGTH(l_blob);
  l_gzip_bytes := DBMS_LOB.GETLENGTH(l_gzip);
  l_url_len    := DBMS_LOB.GETLENGTH(l_url);
  l_ratio      := ROUND(l_raw_bytes / NULLIF(l_gzip_bytes, 0), 1);

  print_url(l_url);

  say('sql_id: ' || g_sql_id
    || CASE
         WHEN g_source = 'MONITOR' THEN '   sql_exec_id: ' || NVL(g_exec_note, '(latest)')
         WHEN g_source = 'AWR' THEN '   plan_hash_value: ' || g_phv_note
         ELSE '   child: ' || g_child
       END
    || '   source: ' || g_source);
  say('plan lines: ' || l_line_count);
  say('raw bytes: ' || l_raw_bytes
    || '   gzip bytes: ' || l_gzip_bytes
    || '   ratio: ' || NVL(TO_CHAR(l_ratio), '?') || 'x');
  say('URL length: ' || l_url_len || ' chars');

  IF l_url_len > 32767 THEN
    say('Note: the URL is longer than one terminal line, so it was printed '
      || 'above as 1000-char lines between "----8<----" markers. Chrome needs no extra step: '
      || 'copy all the lines between the markers and paste them into the address bar - it '
      || 'drops the line breaks itself. Other browsers may need the lines joined in order, '
      || 'with nothing in between, first.');
  ELSIF l_url_len > 2000 THEN
    say('Note: this URL is long (' || l_url_len || ' chars) and may get cut off '
      || 'if pasted as plain text into some chat or email clients. Clicking the link, or '
      || 'copying the whole line, works fine.');
  END IF;

  IF g_source = 'MONITOR' THEN
    say('Reminder: SQL Monitor requires an active Oracle Diagnostics and Tuning Pack license.');
  ELSIF g_source = 'AWR' THEN
    say('Note: AWR keeps optimizer estimates only - the plan has no A-Rows, A-Time or Starts.');
    say('Reminder: AWR requires an active Oracle Diagnostics Pack license.');
  END IF;

  cleanup_lobs;
EXCEPTION
  WHEN e_friendly_abort THEN
    :plan_to_url_rc := 1;
    say(' ');
    DBMS_OUTPUT.PUT_LINE('plan_to_url.sql: ' || l_abort_msg);
    say(' ');
    cleanup_lobs;
  WHEN OTHERS THEN
    :plan_to_url_rc := 1;
    say(' ');
    DBMS_OUTPUT.PUT_LINE('plan_to_url.sql failed: ' || SQLERRM);
    say('If this looks like a privilege issue, see the privileges note in the header comment.');
    say(' ');
    cleanup_lobs;
END;
/

-- QUIET: leave SQL*Plus so `sqlplus -s ... | pbcopy` doesn't sit waiting
-- for input (exit code 1 when the block reported an error): a deliberate,
-- silenced error trips WHENEVER SQLERROR EXIT. Without QUIET the block is a
-- no-op and on_error is CONTINUE (the SQL*Plus default).
WHENEVER SQLERROR &on_error
SET TERMOUT OFF
BEGIN
  IF '&quiet' = 'Y' THEN
    RAISE_APPLICATION_ERROR(-20000, 'plan_to_url.sql QUIET exit');
  END IF;
END;
/
SET TERMOUT ON
WHENEVER SQLERROR CONTINUE

-- Restore SQL*Plus factory defaults for the settings this script changed.
SET HEADING ON
SET FEEDBACK 6
SET PAGESIZE 14
SET LINESIZE 80
SET VERIFY ON
UNDEFINE base_url
UNDEFINE arg1
UNDEFINE arg2
UNDEFINE arg3
UNDEFINE arg4
UNDEFINE arg5
UNDEFINE quiet
UNDEFINE termout
UNDEFINE on_error
UNDEFINE 1
UNDEFINE 2
UNDEFINE 3
UNDEFINE 4
UNDEFINE 5
