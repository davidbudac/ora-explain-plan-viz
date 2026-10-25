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
    const result = sqlMonitorXmlParser.parse(readFixture('sql-monitor-xml-hash-join.txt'));
    const byId = (id: number) => result.allNodes.find(n => n.id === id);

    it('extracts SQL ID, plan hash, SQL text and global stats', () => {
      expect(result.sqlId).toBe('an05rsj1up1k5'); // report_parameters
      expect(result.planHashValue).toBe('2341252972'); // target attribute
      expect(result.sqlText).toContain('select'); // target/sql_fulltext
      expect(result.sqlText).toContain('employees');
      expect(result.hasActualStats).toBe(true);
      // Global elapsed_time = 1755 microseconds = 1.755 ms
      expect(result.totalElapsedTime).toBeCloseTo(1.755, 2);
    });

    it('parses all 6 operations into the correct tree', () => {
      expect(result.rootNode).not.toBeNull();
      expect(result.allNodes).toHaveLength(6);
      expect(result.rootNode!.id).toBe(0);
      expect(result.rootNode!.operation).toBe('SELECT STATEMENT');
      expect(result.rootNode!.children).toHaveLength(1); // HASH JOIN id=1
      expect(result.rootNode!.children[0].id).toBe(1);
      expect(result.rootNode!.children[0].operation).toBe('HASH JOIN');
      expect(result.rootNode!.children[0].children).toHaveLength(2); // HASH JOIN id=2, TABLE ACCESS id=5
    });

    it('combines name + options and reads object names from nested <object><name> elements', () => {
      expect(byId(3)?.operation).toBe('TABLE ACCESS FULL');
      expect(byId(3)?.objectName).toBe('DEPARTMENTS');
      expect(byId(4)?.objectName).toBe('EMPLOYEES');
      expect(byId(5)?.objectName).toBe('ROLES');
    });

    it('extracts actual rows (cardinality stat), starts and max_memory from plan_monitor', () => {
      expect(byId(0)?.actualRows).toBe(1);
      expect(byId(1)?.actualRows).toBe(1);
      expect(byId(2)?.actualRows).toBe(2);
      expect(byId(4)?.actualRows).toBe(10);
      expect(byId(0)?.starts).toBe(1);
      expect(byId(1)?.memoryUsed).toBe(923648);
    });

    it('extracts optimizer estimates, predicates and query block from the plan section', () => {
      const hashJoin1 = byId(1);
      expect(hashJoin1?.cost).toBe(6);
      expect(hashJoin1?.rows).toBe(3);
      expect(hashJoin1?.bytes).toBe(192);
      expect(hashJoin1?.accessPredicates).toContain('"R"."ID"="E"."ROLE_ID"');
      expect(hashJoin1?.queryBlock).toBe('SEL$9E43CB6E');
      expect(byId(3)?.filterPredicates).toContain('Department Name 1');
    });
  });

  describe('Nested Loops example (sql-monitor-xml-nested-loops.txt)', () => {
    const result = sqlMonitorXmlParser.parse(readFixture('sql-monitor-xml-nested-loops.txt'));
    const byId = (id: number) => result.allNodes.find(n => n.id === id);

    it('extracts metadata, all 13 operations and the global elapsed time', () => {
      expect(result.rootNode).not.toBeNull();
      expect(result.sqlId).toBe('g8f4kw2n7m103');
      expect(result.planHashValue).toBe('891273456');
      expect(result.allNodes).toHaveLength(13);
      // Global elapsed_time = 2451000 microseconds = 2451 ms
      expect(result.totalElapsedTime).toBeCloseTo(2451, 0);
    });

    it('handles INDEX operations with options and SORT ORDER BY', () => {
      expect(byId(6)?.operation).toBe('INDEX RANGE SCAN');
      expect(byId(6)?.objectName).toBe('CUST_REGION_IX');
      expect(byId(12)?.operation).toBe('INDEX UNIQUE SCAN');
      expect(byId(12)?.objectName).toBe('PROD_PK');
      expect(byId(1)?.operation).toBe('SORT ORDER BY');
    });

    it('extracts nested-loop starts, memory/temp, physical reads and actual vs estimated rows', () => {
      // ORDER_ITEMS accessed 3842 times, PRODUCTS 5012 times (from nested loops)
      expect(byId(9)?.starts).toBe(3842);
      expect(byId(11)?.starts).toBe(5012);

      expect(byId(1)?.memoryUsed).toBe(1245184);
      expect(byId(1)?.tempUsed).toBe(2097152);
      expect(byId(7)?.physicalReads).toBe(689);

      expect(byId(0)?.actualRows).toBe(5012); // actual
      expect(byId(0)?.rows).toBeUndefined();  // SELECT STATEMENT has no estimated rows in plan
      expect(byId(1)?.rows).toBe(4500);       // estimated
      expect(byId(1)?.actualRows).toBe(5012); // actual - slightly more
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
    const result = sqlMonitorXmlParser.parse(readExample('27-sql_monitor-Partitioned Star Query.txt'));

    it('extracts Pstart/Pstop on the partitioned table scan and surfaces PX operators', () => {
      expect(result.rootNode).not.toBeNull();
      // The interval-partitioned SALES_PART fact is pruned to partitions 15-20
      // (the six months 2025-03 .. 2025-08).
      const salesScan = result.allNodes.find(
        (n) => n.objectName === 'SALES_PART' && n.operation.startsWith('TABLE ACCESS'),
      );
      expect(salesScan).toBeDefined();
      expect(salesScan!.pstart).toBe('15');
      expect(salesScan!.pstop).toBe('20');

      const pxNodes = result.allNodes.filter((n) => n.operation.startsWith('PX '));
      expect(pxNodes.length).toBeGreaterThan(0);
    });
  });

  describe('Partition range iterator example (28-sql_monitor-Partition Range Iterator.txt)', () => {
    const result = sqlMonitorXmlParser.parse(readExample('28-sql_monitor-Partition Range Iterator.txt'));

    it('has a PARTITION RANGE ITERATOR with Pstart/Pstop, and the same range on the child SALES_PART scan', () => {
      expect(result.rootNode).not.toBeNull();
      const iterator = result.allNodes.find((n) => n.operation === 'PARTITION RANGE ITERATOR');
      expect(iterator).toBeDefined();
      expect(iterator!.pstart).toBe('15');
      expect(iterator!.pstop).toBe('20');

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
    const result = sqlMonitorXmlParser.parse(readExample('23-sql_monitor-Window Sort Spill.txt'));
    const byId = (id: number) => result.allNodes.find((n) => n.id === id)!;

    it('parses report-level activity_detail into activityTimeline (User I/O and Cpu samples)', () => {
      expect(result.rootNode).not.toBeNull();
      expect(result.activityTimeline).toBeDefined();
      expect(result.activityTimeline!.bucketCount).toBe(11);
      expect(result.activityTimeline!.bucketIntervalSecs).toBe(1);
      expect(result.activityTimeline!.durationSecs).toBe(9);
      expect(result.activityTimeline!.samples).toHaveLength(9);

      const sample = result.activityTimeline!.samples.find(
        (s) => s.waitClass === 'User I/O' && s.event === 'direct path write temp' && s.line === 4
      );
      expect(sample).toBeDefined();
      expect(sample!.bucket).toBe(4);
      expect(sample!.count).toBe(1);

      const cpuSamples = result.activityTimeline!.samples.filter((s) => s.waitClass === 'Cpu');
      expect(cpuSamples.length).toBe(7); // buckets 2,3,5,6,7,8,10
    });

    it('sets first/last-active offsets (seconds from sql_exec_start=07/04/2026 18:51:54)', () => {
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
    const result = sqlMonitorXmlParser.parse(readExample('21-sql_monitor-Star Schema Rollup.txt'));

    it('leaves activityTimeline and activityPercent undefined but still fills offsets from timestamps (all 0s here)', () => {
      expect(result.rootNode).not.toBeNull();
      expect(result.activityTimeline).toBeUndefined();
      expect(result.allNodes).toHaveLength(9);
      for (const node of result.allNodes) {
        expect(node.firstActiveOffset).toBe(0);
        expect(node.lastActiveOffset).toBe(0);
        expect(node.firstRowOffset).toBeUndefined();
      }
      expect(result.allNodes.every((n) => n.activityPercent === undefined)).toBe(true);
    });
  });
});
