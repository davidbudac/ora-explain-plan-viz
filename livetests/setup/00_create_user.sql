-- 00_create_user.sql
-- Run as SYSDBA (e.g. sqlplus -S -L / as sysdba @setup/00_create_user.sql)
-- (Re)creates the PLANVIZ schema used by the live test suite.
--
-- WARNING: this drops the PLANVIZ user (and all its objects) if it exists.

WHENEVER SQLERROR EXIT FAILURE

ALTER SESSION SET CONTAINER = PDB1;

BEGIN
   EXECUTE IMMEDIATE 'DROP USER planviz CASCADE';
EXCEPTION
   WHEN OTHERS THEN
      IF SQLCODE != -1918 THEN
         RAISE;
      END IF;
END;
/

CREATE USER planviz IDENTIFIED BY planviz;

GRANT CREATE SESSION TO planviz;
GRANT CREATE TABLE TO planviz;
GRANT CREATE VIEW TO planviz;
GRANT UNLIMITED TABLESPACE TO planviz;

EXIT
