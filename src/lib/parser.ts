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

// Complex SQL Monitor plan showing cardinality misestimates and parallel execution
export const COMPLEX_SQL_MONITOR_PLAN = `SQL Monitoring Report

SQL Text
------------------------------
SELECT /*+ PARALLEL(4) */
       c.customer_name, p.product_name,
       SUM(oi.quantity * oi.unit_price) as total_value
FROM customers c
JOIN orders o ON c.customer_id = o.customer_id
JOIN order_items oi ON o.order_id = oi.order_id
JOIN products p ON oi.product_id = p.product_id
WHERE o.order_date BETWEEN DATE '2023-01-01' AND DATE '2024-12-31'
  AND c.region = 'EMEA'
GROUP BY c.customer_name, p.product_name
HAVING SUM(oi.quantity * oi.unit_price) > 10000
ORDER BY total_value DESC

Global Information
------------------------------
 Status              :  DONE (ALL ROWS)
 SQL ID              :  g8h2k4m6n9p1q3
 Plan Hash           :  2847561039
 Execution Started   :  01/20/2024 14:22:10
 First Refresh       :  01/20/2024 14:22:11
 Last Refresh        :  01/20/2024 14:25:48
 Duration            :  218s
 Degree of Parallel  :  4

Global Stats
================================================================
| Elapsed |   Cpu   |  IO    |  Other  | Buffer Gets | Read Reqs |
|  Time   |  Time   | Waits  |  Waits  |             |           |
================================================================
|   218s  |   142s  |   68s  |    8s   |    2850000  |    45000  |
================================================================

SQL Plan Monitoring Details
====================================================================================================================================
| Id | Operation                          | Name         | E-Rows |  Cost  | A-Rows |   A-Time   | Starts |  Reads  | Activity |
====================================================================================================================================
|  0 | SELECT STATEMENT                   |              |        |  25840 |   2500 | 00:03:38.2 |      1 |         |          |
|  1 |  PX COORDINATOR                    |              |        |        |   2500 | 00:03:38.1 |      1 |         |      1%  |
|  2 |   PX SEND QC (ORDER)               | :TQ10003     |   1500 |        |  10000 | 00:03:35.0 |      4 |         |          |
|  3 |    SORT ORDER BY                   |              |   1500 |  25840 |  10000 | 00:03:32.5 |      4 |    8500 |      8%  |
|* 4 |     FILTER                         |              |        |        |  10000 | 00:03:28.2 |      4 |         |          |
|  5 |      HASH GROUP BY                 |              |   1500 |  25820 |  35000 | 00:03:25.1 |      4 |   12000 |     12%  |
|  6 |       PX RECEIVE                   |              |   1500 |        | 280000 | 00:02:58.4 |      4 |         |          |
|  7 |        PX SEND HASH                | :TQ10002     |   1500 |        | 280000 | 00:02:55.2 |      4 |         |      2%  |
|  8 |         HASH GROUP BY              |              |   1500 |  25820 | 280000 | 00:02:48.6 |      4 |   15000 |     15%  |
|* 9 |          HASH JOIN                 |              | 150000 |  24200 | 850000 | 00:02:15.3 |      4 |   18000 |     22%  |
| 10 |           PX RECEIVE               |              |   5000 |        |  20000 | 00:00:02.1 |      4 |         |          |
| 11 |            PX SEND BROADCAST       | :TQ10000     |   5000 |        |  20000 | 00:00:01.8 |      4 |         |          |
| 12 |             PX BLOCK ITERATOR      |              |   5000 |     85 |   5000 | 00:00:01.2 |      4 |     250 |          |
|*13 |              TABLE ACCESS FULL     | CUSTOMERS    |   5000 |     85 |   5000 | 00:00:00.9 |     16 |     250 |      1%  |
|*14 |           HASH JOIN                |              | 150000 |  24100 | 850000 | 00:02:08.5 |      4 |   17500 |     18%  |
| 15 |            PX RECEIVE              |              |  10000 |        |  40000 | 00:00:08.2 |      4 |         |          |
| 16 |             PX SEND BROADCAST      | :TQ10001     |  10000 |        |  40000 | 00:00:07.5 |      4 |         |          |
| 17 |              PX BLOCK ITERATOR     |              |  10000 |    420 |  10000 | 00:00:05.8 |      4 |     800 |      1%  |
| 18 |               TABLE ACCESS FULL    | PRODUCTS     |  10000 |    420 |  10000 | 00:00:04.2 |     16 |     800 |      1%  |
|*19 |            HASH JOIN               |              | 500000 |  23650 |1200000 | 00:01:55.2 |      4 |   16500 |     16%  |
| 20 |             PX BLOCK ITERATOR      |              | 200000 |   8500 | 180000 | 00:00:45.3 |      4 |    6200 |      8%  |
|*21 |              TABLE ACCESS FULL     | ORDERS       | 200000 |   8500 | 180000 | 00:00:42.1 |     16 |    6200 |      7%  |
| 22 |             PX BLOCK ITERATOR      |              |2500000 |  15000 |2800000 | 00:01:02.5 |      4 |   10000 |     12%  |
| 23 |              TABLE ACCESS FULL     | ORDER_ITEMS  |2500000 |  15000 |2800000 | 00:00:58.2 |     16 |   10000 |     10%  |
====================================================================================================================================

Predicate Information (identified by operation id):
---------------------------------------------------
   4 - filter(SUM("OI"."QUANTITY"*"OI"."UNIT_PRICE")>10000)
   9 - access("C"."CUSTOMER_ID"="O"."CUSTOMER_ID")
  13 - filter("C"."REGION"='EMEA')
  14 - access("OI"."PRODUCT_ID"="P"."PRODUCT_ID")
  19 - access("O"."ORDER_ID"="OI"."ORDER_ID")
  21 - filter("O"."ORDER_DATE">=TO_DATE('2023-01-01','YYYY-MM-DD')
              AND "O"."ORDER_DATE"<=TO_DATE('2024-12-31','YYYY-MM-DD'))

Note
-----
   - Degree of Parallelism is 4 because of hint`;

// Sample SQL Monitor XML format (simplified structure)
export const SAMPLE_SQL_MONITOR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<report>
  <sql_monitor>
    <sql_id>xyz789abc123</sql_id>
    <sql_text>SELECT * FROM employees WHERE department_id = 10</sql_text>
    <plan_hash>1357924680</plan_hash>
    <status>DONE</status>
    <elapsed_time>5200</elapsed_time>
    <cpu_time>4800</cpu_time>
    <buffer_gets>15000</buffer_gets>

    <plan_operations>
      <operation id="0" name="SELECT STATEMENT" depth="0"
                 cost="125" cardinality="50"
                 output_rows="45" elapsed_time="5200" starts="1">
      </operation>
      <operation id="1" parent_id="0" name="TABLE ACCESS BY INDEX ROWID BATCHED" depth="1"
                 object_name="EMPLOYEES" cost="125" cardinality="50"
                 output_rows="45" elapsed_time="3100" starts="1"
                 buffer_gets="890" physical_reads="12">
      </operation>
      <operation id="2" parent_id="1" name="INDEX RANGE SCAN" depth="2"
                 object_name="EMP_DEPT_IX" cost="2" cardinality="50"
                 output_rows="45" elapsed_time="850" starts="1"
                 buffer_gets="3" physical_reads="1"
                 access_predicates="DEPARTMENT_ID=10">
      </operation>
    </plan_operations>
  </sql_monitor>
</report>`;
