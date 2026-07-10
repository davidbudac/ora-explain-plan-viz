import { describe, it, expect } from 'vitest';
import { sqlMonitorXmlParser } from '../sqlMonitorParser';
import { readFileSync } from 'fs';
import { join } from 'path';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../../examples', filename), 'utf-8');
}

function readFixture(filename: string): string {
  return readFileSync(join(__dirname, 'fixtures', filename), 'utf-8');
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

  describe('Hash Join example (sql-monitor-xml-hash-join.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readFixture('sql-monitor-xml-hash-join.txt');
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

  describe('Nested Loops example (sql-monitor-xml-nested-loops.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readFixture('sql-monitor-xml-nested-loops.txt');
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

  describe('Parallel execution metadata (DOP)', () => {
    function buildXml({ dop, serversRequested, serversAllocated }: {
      dop?: string;
      serversRequested?: string;
      serversAllocated?: string;
    }): string {
      const dopAttr = dop ? ` dop="${dop}"` : '';
      const statLines = [
        serversRequested ? `<stat name="servers_requested">${serversRequested}</stat>` : '',
        serversAllocated ? `<stat name="servers_allocated">${serversAllocated}</stat>` : '',
      ].join('\n');

      return `<?xml version="1.0" encoding="UTF-8"?>
<report>
  <sql_monitor_report version="4.0">
    <report_parameters>
      <sql_id>parallel123</sql_id>
    </report_parameters>
    <target sql_id="parallel123" sql_plan_hash="42"${dopAttr}>
      <status>DONE</status>
    </target>
    <stats type="monitor">
      ${statLines}
    </stats>
    <plan_monitor>
      <operation id="0" name="SELECT STATEMENT" depth="0">
        <stats type="plan_monitor"><stat name="cardinality">1</stat></stats>
      </operation>
    </plan_monitor>
  </sql_monitor_report>
</report>`;
    }

    it('populates dop, pxServersRequested, pxServersAllocated when present', () => {
      const xml = buildXml({ dop: '8', serversRequested: '8', serversAllocated: '4' });
      const result = sqlMonitorXmlParser.parse(xml);
      expect(result.monitorMetadata?.dop).toBe(8);
      expect(result.monitorMetadata?.pxServersRequested).toBe(8);
      expect(result.monitorMetadata?.pxServersAllocated).toBe(4);
    });

    it('leaves fields undefined when absent', () => {
      const xml = buildXml({});
      const result = sqlMonitorXmlParser.parse(xml);
      expect(result.monitorMetadata?.dop).toBeUndefined();
      expect(result.monitorMetadata?.pxServersRequested).toBeUndefined();
      expect(result.monitorMetadata?.pxServersAllocated).toBeUndefined();
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

  describe('Partition pruning example (27-sql_monitor-Partitioned Star Query.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('27-sql_monitor-Partitioned Star Query.txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('extracts Pstart/Pstop partition range on the partitioned table scan', () => {
      // The interval-partitioned SALES_PART fact is pruned to partitions 15-20
      // (the six months 2025-03 .. 2025-08).
      const salesScan = result.allNodes.find(
        (n) => n.objectName === 'SALES_PART' && n.operation.startsWith('TABLE ACCESS'),
      );
      expect(salesScan).toBeDefined();
      expect(salesScan!.pstart).toBe('15');
      expect(salesScan!.pstop).toBe('20');
    });

    it('surfaces parallel execution (PX) operators', () => {
      const pxNodes = result.allNodes.filter((n) => n.operation.startsWith('PX '));
      expect(pxNodes.length).toBeGreaterThan(0);
    });
  });

  describe('Partition range iterator example (28-sql_monitor-Partition Range Iterator.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('28-sql_monitor-Partition Range Iterator.txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('has an explicit PARTITION RANGE ITERATOR operator with Pstart/Pstop', () => {
      const iterator = result.allNodes.find((n) => n.operation === 'PARTITION RANGE ITERATOR');
      expect(iterator).toBeDefined();
      expect(iterator!.pstart).toBe('15');
      expect(iterator!.pstop).toBe('20');
    });

    it('carries the same partition range on the child SALES_PART scan', () => {
      const salesScan = result.allNodes.find(
        (n) => n.objectName === 'SALES_PART' && n.operation.startsWith('TABLE ACCESS'),
      );
      expect(salesScan).toBeDefined();
      expect(salesScan!.pstart).toBe('15');
      expect(salesScan!.pstop).toBe('20');
    });

    it('is a serial plan (no PX operators)', () => {
      const pxNodes = result.allNodes.filter((n) => n.operation.startsWith('PX '));
      expect(pxNodes.length).toBe(0);
    });
  });

  describe('partition pruning attribute parsing (synthetic)', () => {
    it('reads <partition_start>/<partition_stop> from plan_monitor operations', () => {
      const xml = `<report><sql_monitor_report>
        <plan_monitor>
          <operation id="0" name="SELECT STATEMENT" depth="0"/>
          <operation id="1" parent_id="0" name="PARTITION RANGE" options="ITERATOR" depth="1">
            <partition_start>3</partition_start>
            <partition_stop>7</partition_stop>
          </operation>
          <operation id="2" parent_id="1" name="TABLE ACCESS" options="FULL" depth="2">
            <object type="TABLE"><name>ORDERS_PART</name></object>
            <partition_start>3</partition_start>
            <partition_stop>7</partition_stop>
          </operation>
        </plan_monitor>
      </sql_monitor_report></report>`;

      const result = sqlMonitorXmlParser.parse(xml);
      const iterator = result.allNodes.find((n) => n.id === 1)!;
      expect(iterator.operation).toBe('PARTITION RANGE ITERATOR');
      expect(iterator.pstart).toBe('3');
      expect(iterator.pstop).toBe('7');
      const scan = result.allNodes.find((n) => n.id === 2)!;
      expect(scan.pstart).toBe('3');
      expect(scan.pstop).toBe('7');
    });
  });

  describe('Activity timeline (23-sql_monitor-Window Sort Spill.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('23-sql_monitor-Window Sort Spill.txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('parses report-level activity_detail into activityTimeline', () => {
      expect(result.activityTimeline).toBeDefined();
      expect(result.activityTimeline!.bucketCount).toBe(11);
      expect(result.activityTimeline!.bucketIntervalSecs).toBe(1);
      expect(result.activityTimeline!.durationSecs).toBe(9);
      expect(result.activityTimeline!.samples).toHaveLength(9);
    });

    it('includes a User I/O sample with event and line', () => {
      const sample = result.activityTimeline!.samples.find(
        (s) => s.waitClass === 'User I/O' && s.event === 'direct path write temp' && s.line === 4
      );
      expect(sample).toBeDefined();
      expect(sample!.bucket).toBe(4);
      expect(sample!.count).toBe(1);
    });

    it('includes Cpu samples', () => {
      const cpuSamples = result.activityTimeline!.samples.filter((s) => s.waitClass === 'Cpu');
      expect(cpuSamples.length).toBe(7); // buckets 2,3,5,6,7,8,10
    });

    it('sets first/last-active offsets (seconds from sql_exec_start=07/04/2026 18:51:54)', () => {
      const byId = (id: number) => result.allNodes.find((n) => n.id === id)!;
      expect(byId(0).firstActiveOffset).toBe(1);
      expect(byId(0).lastActiveOffset).toBe(9);
      expect(byId(0).firstRowOffset).toBe(9);
      expect(byId(1).firstActiveOffset).toBe(9);
      expect(byId(1).lastActiveOffset).toBe(9);
      expect(byId(2).firstActiveOffset).toBe(9);
      expect(byId(2).lastActiveOffset).toBe(9);
      expect(byId(3).firstActiveOffset).toBe(6);
      expect(byId(3).lastActiveOffset).toBe(9);
      expect(byId(4).firstActiveOffset).toBe(2);
      expect(byId(4).lastActiveOffset).toBe(9);
      expect(byId(5).firstActiveOffset).toBe(2);
      expect(byId(5).lastActiveOffset).toBe(4);
    });

    it('populates activityPercent from the timeline, dominant on line 4', () => {
      const byId = (id: number) => result.allNodes.find((n) => n.id === id)!;
      // line 4 (WINDOW SORT, id=4): 6 of 9 samples = 66.67%
      expect(byId(4).activityPercent).toBeCloseTo((6 / 9) * 100, 5);
      // line 3 (WINDOW SORT PUSHED RANK, id=3): 2 of 9 = 22.22%
      expect(byId(3).activityPercent).toBeCloseTo((2 / 9) * 100, 5);
      // line 0 (SELECT STATEMENT, id=0): 1 of 9 = 11.11%
      expect(byId(0).activityPercent).toBeCloseTo((1 / 9) * 100, 5);
      expect(byId(1).activityPercent).toBeUndefined();
      expect(byId(2).activityPercent).toBeUndefined();
      expect(byId(5).activityPercent).toBeUndefined();

      const sum = [4, 3, 0].reduce((s, id) => s + (byId(id).activityPercent ?? 0), 0);
      expect(sum).toBeCloseTo(100, 5);
    });
  });

  describe('No activity_detail (21-sql_monitor-Star Schema Rollup.txt)', () => {
    let result: ReturnType<typeof sqlMonitorXmlParser.parse>;

    it('parses without errors', () => {
      const xml = readExample('21-sql_monitor-Star Schema Rollup.txt');
      result = sqlMonitorXmlParser.parse(xml);
      expect(result.rootNode).not.toBeNull();
    });

    it('activityTimeline is undefined', () => {
      expect(result.activityTimeline).toBeUndefined();
    });

    it('firstActiveOffset/lastActiveOffset are still populated from timestamps (all 0s here)', () => {
      expect(result.allNodes).toHaveLength(9);
      for (const node of result.allNodes) {
        expect(node.firstActiveOffset).toBe(0);
        expect(node.lastActiveOffset).toBe(0);
        expect(node.firstRowOffset).toBeUndefined();
      }
    });

    it('does not regress activityPercent (no samples, stays undefined)', () => {
      expect(result.allNodes.every((n) => n.activityPercent === undefined)).toBe(true);
    });
  });
});
