/**
 * Re-export from the new parser module for backward compatibility.
 * The parsePlan function now supports multiple input formats with auto-detection.
 */
export { parsePlan as parseExplainPlan, parsePlan, detectFormat, hasRuntimeStats, getSourceDisplayName } from './parser/index';

// Sample plans for demonstration

export const SAMPLE_PLAN = `Plan hash value: 1234567890

--------------------------------------------------------------------------------
| Id  | Operation                    | Name       | Rows  | Bytes | Cost (%CPU)|
--------------------------------------------------------------------------------
|   0 | SELECT STATEMENT             |            |    10 |   500 |    25   (4)|
|   1 |  HASH JOIN                   |            |    10 |   500 |    25   (4)|
|   2 |   NESTED LOOPS               |            |     5 |   150 |    12   (0)|
|   3 |    TABLE ACCESS BY INDEX ROWID| EMPLOYEES |     5 |   100 |     7   (0)|
|*  4 |     INDEX RANGE SCAN         | EMP_DEPT_IX|     5 |       |     2   (0)|
|   5 |    TABLE ACCESS BY INDEX ROWID| JOBS      |     1 |    10 |     1   (0)|
|*  6 |     INDEX UNIQUE SCAN        | JOB_ID_PK  |     1 |       |     0   (0)|
|   7 |   TABLE ACCESS FULL          | DEPARTMENTS|    27 |   540 |    12   (0)|
--------------------------------------------------------------------------------

Query Block Name / Object Alias (identified by operation id):
-------------------------------------------------------------
   1 - SEL$1
   2 - SEL$1
   3 - SEL$1 / E@SEL$1
   4 - SEL$1 / E@SEL$1
   5 - SEL$1 / J@SEL$1
   6 - SEL$1 / J@SEL$1
   7 - SEL$1 / D@SEL$1

Predicate Information (identified by operation id):
---------------------------------------------------
   4 - access("E"."DEPARTMENT_ID"=:dept_id)
   6 - access("E"."JOB_ID"="J"."JOB_ID")`;

export const COMPLEX_SAMPLE_PLAN = `Plan hash value: 3456789012

-------------------------------------------------------------------------------------------------------
| Id  | Operation                      | Name            | Rows  | Bytes |TempSpc| Cost (%CPU)| Time     |
-------------------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT               |                 |  1000 | 95000 |       | 15234  (2)| 00:03:03 |
|   1 |  SORT ORDER BY                 |                 |  1000 | 95000 |   112K| 15234  (2)| 00:03:03 |
|*  2 |   HASH JOIN                    |                 |  1000 | 95000 |       | 15210  (2)| 00:03:03 |
|   3 |    VIEW                        | VW_NSO_1        |   500 | 23500 |       |  7600  (2)| 00:01:31 |
|   4 |     HASH GROUP BY              |                 |   500 | 19500 |       |  7600  (2)| 00:01:31 |
|*  5 |      HASH JOIN                 |                 | 50000 |  1904K|       |  7580  (2)| 00:01:31 |
|   6 |       TABLE ACCESS FULL        | CUSTOMERS       |  5000 |   102K|       |   120  (0)| 00:00:02 |
|*  7 |       HASH JOIN                |                 | 50000 |   878K|       |  7458  (2)| 00:01:30 |
|   8 |        TABLE ACCESS FULL       | PRODUCTS        |   100 |   900 |       |     3  (0)| 00:00:01 |
|*  9 |        TABLE ACCESS FULL       | ORDER_ITEMS     |500000 |  4394K|       |  7420  (2)| 00:01:29 |
|  10 |    VIEW                        | VW_NSO_2        |   200 |  4200 |       |  7600  (2)| 00:01:31 |
|  11 |     HASH GROUP BY              |                 |   200 |  5000 |       |  7600  (2)| 00:01:31 |
|* 12 |      HASH JOIN                 |                 | 25000 |   610K|       |  7580  (2)| 00:01:31 |
|  13 |       TABLE ACCESS FULL        | REGIONS         |     5 |    50 |       |     3  (0)| 00:00:01 |
|* 14 |       HASH JOIN                |                 | 25000 |   366K|       |  7575  (2)| 00:01:31 |
|  15 |        TABLE ACCESS FULL       | COUNTRIES       |    25 |   175 |       |     3  (0)| 00:00:01 |
|* 16 |        TABLE ACCESS FULL       | ORDERS          |500000 |  3906K|       |  7420  (2)| 00:01:29 |
-------------------------------------------------------------------------------------------------------

Query Block Name / Object Alias (identified by operation id):
-------------------------------------------------------------
   1 - SEL$1
   2 - SEL$1
   3 - SEL$2 / VW_NSO_1@SEL$1
   4 - SEL$2
   5 - SEL$2
   6 - SEL$2 / C@SEL$2
   7 - SEL$2
   8 - SEL$2 / P@SEL$2
   9 - SEL$2 / OI@SEL$2
  10 - SEL$3 / VW_NSO_2@SEL$1
  11 - SEL$3
  12 - SEL$3
  13 - SEL$3 / R@SEL$3
  14 - SEL$3
  15 - SEL$3 / CO@SEL$3
  16 - SEL$3 / O@SEL$3

Predicate Information (identified by operation id):
---------------------------------------------------
   2 - access("V1"."CUSTOMER_ID"="V2"."CUSTOMER_ID")
   5 - access("C"."CUSTOMER_ID"="OI"."CUSTOMER_ID")
   7 - access("P"."PRODUCT_ID"="OI"."PRODUCT_ID")
   9 - filter("OI"."QUANTITY">0)
  12 - access("R"."REGION_ID"="O"."REGION_ID")
  14 - access("CO"."COUNTRY_ID"="O"."COUNTRY_ID")
  16 - filter("O"."ORDER_STATUS"='COMPLETED')`;

// Sample SQL Monitor plan with actual runtime statistics
export const SAMPLE_SQL_MONITOR_PLAN = `SQL Monitoring Report

SQL Text
------------------------------
SELECT e.employee_name, d.department_name, SUM(s.amount)
FROM employees e
JOIN departments d ON e.dept_id = d.dept_id
JOIN sales s ON e.emp_id = s.emp_id
WHERE s.sale_date >= DATE '2024-01-01'
GROUP BY e.employee_name, d.department_name

Global Information
------------------------------
 Status              :  DONE
 SQL ID              :  abc123def456
 Plan Hash           :  987654321
 Execution Started   :  01/15/2024 10:30:45
 First Refresh       :  01/15/2024 10:30:46
 Last Refresh        :  01/15/2024 10:31:02

Global Stats
===========================================
| Elapsed |   Cpu   |  IO    | Buffer Gets |
|  Time   |  Time   | Waits  |             |
===========================================
|   17s   |   12s   |   5s   |     125000  |
===========================================

SQL Plan Monitoring Details
==========================================================================================================
| Id | Operation                     | Name        | E-Rows | Cost | A-Rows |   A-Time   | Starts | Activity |
==========================================================================================================
|  0 | SELECT STATEMENT              |             |        |  850 |    500 | 00:00:17.2 |      1 |          |
|  1 |  HASH GROUP BY                |             |    500 |  850 |    500 | 00:00:02.1 |      1 |    12%   |
|* 2 |   HASH JOIN                   |             |  10000 |  800 |  15000 | 00:00:08.5 |      1 |    50%   |
|  3 |    TABLE ACCESS FULL          | DEPARTMENTS |     50 |   10 |     50 | 00:00:00.1 |      1 |     1%   |
|* 4 |    HASH JOIN                  |             |  10000 |  780 |  15000 | 00:00:06.2 |      1 |    36%   |
|  5 |     TABLE ACCESS FULL         | EMPLOYEES   |   1000 |   50 |   1000 | 00:00:00.5 |      1 |     3%   |
|* 6 |     TABLE ACCESS FULL         | SALES       | 100000 |  700 |  85000 | 00:00:05.5 |      1 |    32%   |
==========================================================================================================

Predicate Information (identified by operation id):
---------------------------------------------------
   2 - access("E"."DEPT_ID"="D"."DEPT_ID")
   4 - access("E"."EMP_ID"="S"."EMP_ID")
   6 - filter("S"."SALE_DATE">=TO_DATE('2024-01-01','YYYY-MM-DD'))`;
