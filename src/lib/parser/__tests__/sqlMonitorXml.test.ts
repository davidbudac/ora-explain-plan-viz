import { describe, it, expect } from 'vitest';
import { sqlMonitorXmlParser } from '../sqlMonitorParser';
import { readFileSync } from 'fs';
import { join } from 'path';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../../examples', filename), 'utf-8');
}

describe('sqlMonitorXmlParser - Real Oracle XML Format', () => {
  describe('canParse', () => {
    it('detects real Oracle SQL Monitor XML', () => {
      const xml = '<?xml version="1.0"?><report><sql_monitor_report></sql_monitor_report></report>';
      expect(sqlMonitorXmlParser.canParse(xml)).toBe(true);
    });

    it('detects XML with plan_monitor tag', () => {
      const xml = '<report><plan_monitor><operation id="0"/></plan_monitor></report>';
      expect(sqlMonitorXmlParser.canParse(xml)).toBe(true);
    });

    it('does not detect plain text', () => {
      expect(sqlMonitorXmlParser.canParse('SELECT * FROM employees')).toBe(false);
    });

    it('does not detect DBMS_XPLAN text', () => {
      const text = `
Plan hash value: 123456
-----------------------------------------
| Id | Operation       | Name | Rows |
-----------------------------------------
|  0 | SELECT STATEMENT|      |    1 |
-----------------------------------------`;
      expect(sqlMonitorXmlParser.canParse(text)).toBe(false);
    });
  });

  describe('Hash Join example (05-sql_monitor-SQL Monitor XML (Hash Join).txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('05-sql_monitor-SQL Monitor XML (Hash Join).txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('extracts SQL ID from report_parameters', () => {
      expect(result.sqlId).toBe('an05rsj1up1k5');
    });

    it('extracts plan hash from target attribute', () => {
      expect(result.planHashValue).toBe('2341252972');
    });

    it('extracts SQL text from target/sql_fulltext', () => {
      expect(result.sqlText).toContain('select');
      expect(result.sqlText).toContain('employees');
    });

    it('parses all 6 operations', () => {
      expect(result.allNodes).toHaveLength(6);
    });

    it('builds correct tree structure', () => {
      expect(result.rootNode!.id).toBe(0);
      expect(result.rootNode!.operation).toBe('SELECT STATEMENT');
      expect(result.rootNode!.children).toHaveLength(1); // HASH JOIN id=1
      expect(result.rootNode!.children[0].id).toBe(1);
      expect(result.rootNode!.children[0].operation).toBe('HASH JOIN');
      expect(result.rootNode!.children[0].children).toHaveLength(2); // HASH JOIN id=2, TABLE ACCESS id=5
    });

    it('combines name + options into full operation name', () => {
      const tableAccess = result.allNodes.find(n => n.id === 3);
      expect(tableAccess?.operation).toBe('TABLE ACCESS FULL');
    });

    it('extracts object names from nested <object><name> elements', () => {
      const departments = result.allNodes.find(n => n.id === 3);
      expect(departments?.objectName).toBe('DEPARTMENTS');

      const employees = result.allNodes.find(n => n.id === 4);
      expect(employees?.objectName).toBe('EMPLOYEES');

      const roles = result.allNodes.find(n => n.id === 5);
      expect(roles?.objectName).toBe('ROLES');
    });

    it('extracts actual rows (cardinality stat) from plan_monitor', () => {
      const root = result.allNodes.find(n => n.id === 0);
      expect(root?.actualRows).toBe(1);

      const hashJoin1 = result.allNodes.find(n => n.id === 1);
      expect(hashJoin1?.actualRows).toBe(1);

      const hashJoin2 = result.allNodes.find(n => n.id === 2);
      expect(hashJoin2?.actualRows).toBe(2);

      const employees = result.allNodes.find(n => n.id === 4);
      expect(employees?.actualRows).toBe(10);
    });

    it('extracts starts from plan_monitor stats', () => {
      const root = result.allNodes.find(n => n.id === 0);
      expect(root?.starts).toBe(1);
    });

    it('extracts max_memory from plan_monitor stats', () => {
      const hashJoin1 = result.allNodes.find(n => n.id === 1);
      expect(hashJoin1?.memoryUsed).toBe(923648);
    });

    it('extracts optimizer estimates (cost, rows, bytes)', () => {
      const hashJoin1 = result.allNodes.find(n => n.id === 1);
      expect(hashJoin1?.cost).toBe(6);
      expect(hashJoin1?.rows).toBe(3);
      expect(hashJoin1?.bytes).toBe(192);
    });

    it('extracts predicates from plan section', () => {
      const hashJoin1 = result.allNodes.find(n => n.id === 1);
      expect(hashJoin1?.accessPredicates).toContain('"R"."ID"="E"."ROLE_ID"');

      const departments = result.allNodes.find(n => n.id === 3);
      expect(departments?.filterPredicates).toContain('Department Name 1');
    });

    it('has actual stats flag set', () => {
      expect(result.hasActualStats).toBe(true);
    });

    it('reports source as sql_monitor_xml', () => {
      expect(result.source).toBe('sql_monitor_xml');
    });

    it('calculates total elapsed time from global stats', () => {
      // Global elapsed_time = 1755 microseconds = 1.755 ms
      expect(result.totalElapsedTime).toBeCloseTo(1.755, 2);
    });

    it('extracts query block from plan section', () => {
      const hashJoin1 = result.allNodes.find(n => n.id === 1);
      expect(hashJoin1?.queryBlock).toBe('SEL$9E43CB6E');
    });
  });

  describe('Nested Loops example (09-sql_monitor-SQL Monitor XML (Nested Loops).txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('09-sql_monitor-SQL Monitor XML (Nested Loops).txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('extracts correct metadata', () => {
      expect(result.sqlId).toBe('g8f4kw2n7m103');
      expect(result.planHashValue).toBe('891273456');
    });

    it('parses all 13 operations', () => {
      expect(result.allNodes).toHaveLength(13);
    });

    it('handles INDEX operations with options', () => {
      const indexRangeScan = result.allNodes.find(n => n.id === 6);
      expect(indexRangeScan?.operation).toBe('INDEX RANGE SCAN');
      expect(indexRangeScan?.objectName).toBe('CUST_REGION_IX');

      const indexUniqueScan = result.allNodes.find(n => n.id === 12);
      expect(indexUniqueScan?.operation).toBe('INDEX UNIQUE SCAN');
      expect(indexUniqueScan?.objectName).toBe('PROD_PK');
    });

    it('handles SORT ORDER BY operation', () => {
      const sort = result.allNodes.find(n => n.id === 1);
      expect(sort?.operation).toBe('SORT ORDER BY');
    });

    it('extracts high starts count for nested loop children', () => {
      // ORDER_ITEMS accessed 3842 times (from nested loop)
      const orderItems = result.allNodes.find(n => n.id === 9);
      expect(orderItems?.starts).toBe(3842);

      // PRODUCTS accessed 5012 times
      const products = result.allNodes.find(n => n.id === 11);
      expect(products?.starts).toBe(5012);
    });

    it('extracts memory and temp usage', () => {
      const sort = result.allNodes.find(n => n.id === 1);
      expect(sort?.memoryUsed).toBe(1245184);
      expect(sort?.tempUsed).toBe(2097152);
    });

    it('extracts physical read stats', () => {
      const orders = result.allNodes.find(n => n.id === 7);
      expect(orders?.physicalReads).toBe(689);
    });

    it('shows actual vs estimated row differences', () => {
      const root = result.allNodes.find(n => n.id === 0);
      expect(root?.actualRows).toBe(5012); // actual
      expect(root?.rows).toBeUndefined();  // SELECT STATEMENT has no estimated rows in plan

      const sort = result.allNodes.find(n => n.id === 1);
      expect(sort?.rows).toBe(4500);       // estimated
      expect(sort?.actualRows).toBe(5012); // actual - slightly more
    });

    it('has correct global elapsed time', () => {
      // Global elapsed_time = 2451000 microseconds = 2451 ms
      expect(result.totalElapsedTime).toBeCloseTo(2451, 0);
    });
  });

  describe('Parallel query example (10-sql_monitor-SQL Monitor XML (Parallel).txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('10-sql_monitor-SQL Monitor XML (Parallel).txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('extracts correct metadata', () => {
      expect(result.sqlId).toBe('bx92mp4qr6h01');
      expect(result.planHashValue).toBe('3847291056');
    });

    it('parses all 24 operations', () => {
      expect(result.allNodes).toHaveLength(24);
    });

    it('handles PX operations correctly', () => {
      const pxCoord = result.allNodes.find(n => n.id === 1);
      expect(pxCoord?.operation).toBe('PX COORDINATOR');

      const pxSendQC = result.allNodes.find(n => n.id === 2);
      expect(pxSendQC?.operation).toBe('PX SEND QC (ORDER)');

      const pxSendBroadcast = result.allNodes.find(n => n.id === 9);
      expect(pxSendBroadcast?.operation).toBe('PX SEND BROADCAST');

      const pxBlockIter = result.allNodes.find(n => n.id === 10);
      expect(pxBlockIter?.operation).toBe('PX BLOCK ITERATOR');
    });

    it('handles HASH GROUP BY operation', () => {
      const hashGroup = result.allNodes.find(n => n.id === 6);
      expect(hashGroup?.operation).toBe('HASH GROUP BY');
    });

    it('handles large actual row counts (fact table)', () => {
      const factSales = result.allNodes.find(n => n.id === 23);
      expect(factSales?.actualRows).toBe(72458921);
      expect(factSales?.objectName).toBe('FACT_SALES');
    });

    it('extracts parallel starts correctly', () => {
      // PX operations run with DOP=4
      const pxSend = result.allNodes.find(n => n.id === 2);
      expect(pxSend?.starts).toBe(4);

      // Fact table scan runs on 16 PX granules
      const factSales = result.allNodes.find(n => n.id === 23);
      expect(factSales?.starts).toBe(16);
    });

    it('builds correct tree with deep nesting', () => {
      // Root -> PX COORDINATOR -> PX SEND QC -> SORT -> PX RECEIVE -> PX SEND RANGE -> HASH GROUP BY -> HASH JOIN
      const root = result.rootNode!;
      expect(root.children).toHaveLength(1);
      const pxCoord = root.children[0];
      expect(pxCoord.children).toHaveLength(1);
      const pxSendQC = pxCoord.children[0];
      expect(pxSendQC.children).toHaveLength(1);
      const sort = pxSendQC.children[0];
      expect(sort.children).toHaveLength(1);
    });
  });

  describe('Merge Join example - Oracle-Base (11-sql_monitor-SQL Monitor XML (Merge Join).txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('11-sql_monitor-SQL Monitor XML (Merge Join).txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('extracts metadata from Oracle 11g format', () => {
      expect(result.sqlId).toBe('526mvccm5nfy4');
      expect(result.planHashValue).toBe('2970111170');
    });

    it('extracts SQL text with WM_CONCAT', () => {
      expect(result.sqlText).toContain('WM_CONCAT');
      expect(result.sqlText).toContain('emp');
      expect(result.sqlText).toContain('dept');
    });

    it('parses all 7 operations', () => {
      expect(result.allNodes).toHaveLength(7);
    });

    it('handles MERGE JOIN operation', () => {
      const mergeJoin = result.allNodes.find(n => n.id === 2);
      expect(mergeJoin?.operation).toBe('MERGE JOIN');
      expect(mergeJoin?.rows).toBe(14);
      expect(mergeJoin?.actualRows).toBe(14);
    });

    it('handles SORT GROUP BY operation', () => {
      const sortGroupBy = result.allNodes.find(n => n.id === 1);
      expect(sortGroupBy?.operation).toBe('SORT GROUP BY');
      expect(sortGroupBy?.rows).toBe(4);
      expect(sortGroupBy?.actualRows).toBe(3); // fewer groups than estimated
      expect(sortGroupBy?.memoryUsed).toBe(2048);
    });

    it('handles INDEX FULL SCAN operation', () => {
      const indexScan = result.allNodes.find(n => n.id === 4);
      expect(indexScan?.operation).toBe('INDEX FULL SCAN');
      expect(indexScan?.objectName).toBe('PK_DEPT');
    });

    it('handles SORT JOIN with access and filter predicates', () => {
      const sortJoin = result.allNodes.find(n => n.id === 5);
      expect(sortJoin?.operation).toBe('SORT JOIN');
      expect(sortJoin?.starts).toBe(4); // called once per DEPT row
      expect(sortJoin?.accessPredicates).toBeTruthy();
      expect(sortJoin?.filterPredicates).toBeTruthy();
    });

    it('handles TABLE ACCESS BY INDEX ROWID', () => {
      const tableAccess = result.allNodes.find(n => n.id === 3);
      expect(tableAccess?.operation).toBe('TABLE ACCESS BY INDEX ROWID');
      expect(tableAccess?.objectName).toBe('DEPT');
    });

    it('builds correct tree structure', () => {
      // SELECT -> SORT GROUP BY -> MERGE JOIN -> (DEPT by ROWID, SORT JOIN)
      const root = result.rootNode!;
      expect(root.children).toHaveLength(1);
      const sortGroupBy = root.children[0];
      expect(sortGroupBy.children).toHaveLength(1);
      const mergeJoin = sortGroupBy.children[0];
      expect(mergeJoin.children).toHaveLength(2);
      expect(mergeJoin.children[0].operation).toBe('TABLE ACCESS BY INDEX ROWID');
      expect(mergeJoin.children[1].operation).toBe('SORT JOIN');
    });

    it('has correct global elapsed time from 11g format', () => {
      // elapsed_time = 14344 microseconds = 14.344 ms
      expect(result.totalElapsedTime).toBeCloseTo(14.344, 2);
    });
  });

  describe('Legacy XML format backward compatibility', () => {
    it('parses old simplified XML format', () => {
      const legacyXml = `<?xml version="1.0" encoding="UTF-8"?>
<report>
  <sql_monitor>
    <sql_id>xyz789abc123</sql_id>
    <sql_text>SELECT * FROM employees WHERE department_id = 10</sql_text>
    <plan_hash>1357924680</plan_hash>
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

      const result = sqlMonitorXmlParser.parse(legacyXml);
      expect(result.rootNode).not.toBeNull();
      expect(result.sqlId).toBe('xyz789abc123');
      expect(result.planHashValue).toBe('1357924680');
      expect(result.allNodes).toHaveLength(3);
      expect(result.allNodes[0].operation).toBe('SELECT STATEMENT');
      expect(result.allNodes[0].actualRows).toBe(45);
      expect(result.allNodes[1].objectName).toBe('EMPLOYEES');
      expect(result.allNodes[2].accessPredicates).toBe('DEPARTMENT_ID=10');
      expect(result.hasActualStats).toBe(true);
    });
  });
});
