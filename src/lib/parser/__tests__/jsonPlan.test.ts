import { describe, it, expect } from 'vitest';
import { jsonPlanParser } from '../jsonPlanParser';
import { detectFormat } from '../index';

describe('JSON Plan Parser', () => {
  describe('canParse', () => {
    it('detects valid JSON plan array', () => {
      const input = '[{"id": 0, "operation": "SELECT STATEMENT"}]';
      expect(jsonPlanParser.canParse(input)).toBe(true);
    });

    it('rejects non-array JSON', () => {
      expect(jsonPlanParser.canParse('{"id": 0}')).toBe(false);
    });

    it('rejects empty array', () => {
      expect(jsonPlanParser.canParse('[]')).toBe(false);
    });

    it('rejects non-JSON text', () => {
      expect(jsonPlanParser.canParse('Plan hash value: 123')).toBe(false);
    });

    it('rejects array without id/operation', () => {
      expect(jsonPlanParser.canParse('[{"foo": "bar"}]')).toBe(false);
    });

    it('detects format as json in detectFormat', () => {
      const input = '[{"id": 0, "operation": "SELECT STATEMENT", "options": null}]';
      expect(detectFormat(input)).toBe('json');
    });
  });

  describe('parse - V$SQL_PLAN_STATISTICS_ALL format', () => {
    const sampleJson = JSON.stringify([
      {
        id: 0,
        parent_id: null,
        depth: 0,
        operation: 'SELECT STATEMENT',
        options: null,
        object_name: null,
        cost: 15234,
        cardinality: 1000,
        bytes: 95000,
        access_predicates: null,
        filter_predicates: null,
        actual_starts: 1,
        actual_rows: 263,
        actual_elapsed_time: 12074670,
        actual_cr_buffer_gets: 245800,
        actual_disk_reads: 12400,
        actual_memory_used: 2097152,
        actual_tempseg_size: null,
      },
      {
        id: 1,
        parent_id: 0,
        depth: 1,
        operation: 'HASH',
        options: 'GROUP BY',
        object_name: null,
        cost: 7600,
        cardinality: 500,
        bytes: 19500,
        access_predicates: null,
        filter_predicates: null,
        actual_starts: 1,
        actual_rows: 487,
        actual_elapsed_time: 5199570,
        actual_cr_buffer_gets: 198300,
        actual_disk_reads: 9800,
        actual_memory_used: 3145728,
        actual_tempseg_size: null,
      },
      {
        id: 2,
        parent_id: 1,
        depth: 2,
        operation: 'HASH JOIN',
        options: null,
        object_name: null,
        cost: 7580,
        cardinality: 50000,
        bytes: 1953125,
        access_predicates: '"WS"."WS_SOLD_DATE_SK"="D"."D_DATE_SK"',
        filter_predicates: null,
        actual_starts: 1,
        actual_rows: 17287456,
        actual_elapsed_time: 2422720,
        actual_memory_used: 4194304,
        actual_tempseg_size: null,
      },
      {
        id: 3,
        parent_id: 2,
        depth: 3,
        operation: 'TABLE ACCESS',
        options: 'FULL',
        object_owner: 'TPCDS',
        object_name: 'DATE_DIM',
        object_alias: 'D@SEL$1',
        cost: 120,
        cardinality: 73049,
        bytes: 1461000,
        access_predicates: null,
        filter_predicates: '"D"."D_YEAR"=2001',
        actual_starts: 1,
        actual_rows: 366,
        actual_elapsed_time: 15400,
      },
      {
        id: 4,
        parent_id: 2,
        depth: 3,
        operation: 'TABLE ACCESS',
        options: 'FULL',
        object_owner: 'TPCDS',
        object_name: 'WEB_SALES',
        object_alias: 'WS@SEL$1',
        cost: 7420,
        cardinality: 7197670,
        bytes: 140000000,
        access_predicates: null,
        filter_predicates: null,
        actual_starts: 1,
        actual_rows: 7197670,
        actual_elapsed_time: 1850300,
      },
    ]);

    it('parses all nodes', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes).toHaveLength(5);
    });

    it('sets source to json', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.source).toBe('json');
    });

    it('detects actual stats', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.hasActualStats).toBe(true);
    });

    it('combines operation + options', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[1].operation).toBe('HASH GROUP BY');
      expect(result.allNodes[3].operation).toBe('TABLE ACCESS FULL');
    });

    it('converts elapsed time from microseconds to milliseconds', () => {
      const result = jsonPlanParser.parse(sampleJson);
      // 12074670 us = 12074.67 ms
      expect(result.allNodes[0].actualTime).toBeCloseTo(12074.67, 1);
      // 5199570 us = 5199.57 ms
      expect(result.allNodes[1].actualTime).toBeCloseTo(5199.57, 1);
    });

    it('parses actual rows', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[0].actualRows).toBe(263);
      expect(result.allNodes[2].actualRows).toBe(17287456);
    });

    it('parses estimated rows (cardinality)', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[0].rows).toBe(1000);
      expect(result.allNodes[2].rows).toBe(50000);
    });

    it('builds correct tree structure from parent_id', () => {
      const result = jsonPlanParser.parse(sampleJson);
      const root = result.rootNode!;
      expect(root.id).toBe(0);
      expect(root.children).toHaveLength(1);
      expect(root.children[0].id).toBe(1);
      expect(root.children[0].children).toHaveLength(1);
      expect(root.children[0].children[0].id).toBe(2);
      expect(root.children[0].children[0].children).toHaveLength(2);
      expect(root.children[0].children[0].children[0].id).toBe(3);
      expect(root.children[0].children[0].children[1].id).toBe(4);
    });

    it('parses predicates', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[2].accessPredicates).toBe('"WS"."WS_SOLD_DATE_SK"="D"."D_DATE_SK"');
      expect(result.allNodes[3].filterPredicates).toBe('"D"."D_YEAR"=2001');
    });

    it('parses object names', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[3].objectName).toBe('DATE_DIM');
      expect(result.allNodes[4].objectName).toBe('WEB_SALES');
    });

    it('parses object aliases', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[3].objectAlias).toBe('D@SEL$1');
    });

    it('parses cost', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[0].cost).toBe(15234);
    });

    it('parses memory used', () => {
      const result = jsonPlanParser.parse(sampleJson);
      expect(result.allNodes[0].memoryUsed).toBe(2097152);
    });

    it('detects cardinality mismatches', () => {
      const result = jsonPlanParser.parse(sampleJson);
      // Node 2: estimated 50000, actual 17287456 -> ~346x over
      const hashJoin = result.allNodes[2];
      expect(hashJoin.rows).toBe(50000);
      expect(hashJoin.actualRows).toBe(17287456);
    });

    it('calculates totalElapsedTime from root', () => {
      const result = jsonPlanParser.parse(sampleJson);
      // Root actualTime = 12074670 us = 12074.67 ms
      expect(result.totalElapsedTime).toBeCloseTo(12074.67, 1);
    });
  });

  describe('parse - depth-based tree building (no parent_id)', () => {
    const noParentJson = JSON.stringify([
      { id: 0, depth: 0, operation: 'SELECT STATEMENT', options: null, cost: 100, cardinality: 10 },
      { id: 1, depth: 1, operation: 'NESTED LOOPS', options: null, cost: 90, cardinality: 10 },
      { id: 2, depth: 2, operation: 'TABLE ACCESS', options: 'FULL', object_name: 'EMP', cost: 5, cardinality: 100 },
      { id: 3, depth: 2, operation: 'INDEX', options: 'UNIQUE SCAN', object_name: 'DEPT_PK', cost: 1, cardinality: 1 },
    ]);

    it('builds tree from depth when parent_id is absent', () => {
      const result = jsonPlanParser.parse(noParentJson);
      const root = result.rootNode!;
      expect(root.id).toBe(0);
      expect(root.children).toHaveLength(1);
      expect(root.children[0].id).toBe(1);
      expect(root.children[0].children).toHaveLength(2);
    });

    it('has no actual stats', () => {
      const result = jsonPlanParser.parse(noParentJson);
      expect(result.hasActualStats).toBe(false);
    });
  });

  describe('parse - case insensitive keys', () => {
    it('handles uppercase keys', () => {
      const input = JSON.stringify([
        { ID: 0, OPERATION: 'SELECT STATEMENT', DEPTH: 0, COST: 100, CARDINALITY: 50 },
      ]);
      const result = jsonPlanParser.parse(input);
      expect(result.allNodes).toHaveLength(1);
      expect(result.allNodes[0].operation).toBe('SELECT STATEMENT');
      expect(result.allNodes[0].cost).toBe(100);
      expect(result.allNodes[0].rows).toBe(50);
    });
  });

  describe('parse - alternative key names', () => {
    it('handles last_output_rows as actual rows', () => {
      const input = JSON.stringify([
        { id: 0, operation: 'SELECT STATEMENT', depth: 0, last_output_rows: 42 },
      ]);
      const result = jsonPlanParser.parse(input);
      expect(result.allNodes[0].actualRows).toBe(42);
    });

    it('handles last_elapsed_time as actual time', () => {
      const input = JSON.stringify([
        { id: 0, operation: 'SELECT STATEMENT', depth: 0, last_elapsed_time: 5000000 },
      ]);
      const result = jsonPlanParser.parse(input);
      expect(result.allNodes[0].actualTime).toBe(5000); // 5M us = 5000 ms
    });

    it('handles last_starts as starts', () => {
      const input = JSON.stringify([
        { id: 0, operation: 'SELECT STATEMENT', depth: 0, last_starts: 3 },
      ]);
      const result = jsonPlanParser.parse(input);
      expect(result.allNodes[0].starts).toBe(3);
    });
  });
  describe('parse - V$SQL_PLAN_STATISTICS_ALL accuracy fixes', () => {
    const one = (row: Record<string, unknown>) =>
      jsonPlanParser.parse(JSON.stringify([{ id: 0, operation: 'TABLE ACCESS', options: 'FULL', depth: 0, ...row }])).allNodes[0];

    it('computes %CPU as (cost - io_cost) / cost like DBMS_XPLAN', () => {
      expect(one({ cost: 100, io_cost: 90, cpu_cost: 987654321 }).cpuPercent).toBe(10);
      expect(one({ cost: 7, io_cost: 7, cpu_cost: 5000000 }).cpuPercent).toBe(0);
    });

    it('shows 0 %CPU for zero cost and leaves it undefined without io_cost', () => {
      expect(one({ cost: 0, io_cost: 0 }).cpuPercent).toBe(0);
      expect(one({ cost: 50, cpu_cost: 12345 }).cpuPercent).toBeUndefined();
    });

    it('clamps %CPU to 0..100', () => {
      expect(one({ cost: 10, io_cost: 15 }).cpuPercent).toBe(0);
      expect(one({ cost: 10, io_cost: -5 }).cpuPercent).toBe(100);
    });

    it('does not turn the degree of parallelism into starts', () => {
      const node = one({ last_degree: 4, degree: 4, actual_parallel_degree: 4 });
      expect(node.starts).toBeUndefined();
    });

    it('still reads starts from starts columns', () => {
      expect(one({ starts: 5 }).starts).toBe(5);
      expect(one({ actual_starts: 2, last_degree: 4 }).starts).toBe(2);
    });

    it('maps partition and parallel columns', () => {
      const node = one({
        partition_start: 'KEY',
        partition_stop: 'KEY(I)',
        object_node: ':Q1000',
        other_tag: 'PARALLEL_TO_SERIAL',
        distribution: 'HASH',
      });
      expect(node.pstart).toBe('KEY');
      expect(node.pstop).toBe('KEY(I)');
      expect(node.tq).toBe(':Q1000');
      expect(node.inOut).toBe('P->S');
      expect(node.pqDistrib).toBe('HASH');
    });

    it('accepts numeric partition bounds and bloom-filter markers', () => {
      const node = one({ partition_start: 1, partition_stop: 4 });
      expect(node.pstart).toBe('1');
      expect(node.pstop).toBe('4');
      expect(one({ partition_start: ':BF0000' }).pstart).toBe(':BF0000');
    });

    it('translates OTHER_TAG values to IN-OUT codes', () => {
      const tag = (other_tag: string) => one({ other_tag }).inOut;
      expect(tag('PARALLEL_TO_PARALLEL')).toBe('P->P');
      expect(tag('PARALLEL_COMBINED_WITH_PARENT')).toBe('PCWP');
      expect(tag('PARALLEL_COMBINED_WITH_CHILD')).toBe('PCWC');
      expect(tag('SERIAL_FROM_REMOTE')).toBe('R->S');
      expect(tag('SERIAL_TO_PARALLEL')).toBe('S->P');
      expect(tag('PARALLEL_FROM_SERIAL')).toBe('S->P');
      expect(tag('SERIAL')).toBeUndefined();
      expect(tag('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    });

    it('accepts already-short column names', () => {
      const node = one({ pstart: '1', pstop: '8', tq: ':Q1001', in_out: 'P->P', pq_distrib: 'BROADCAST' });
      expect(node.pstart).toBe('1');
      expect(node.pstop).toBe('8');
      expect(node.tq).toBe(':Q1001');
      expect(node.inOut).toBe('P->P');
      expect(node.pqDistrib).toBe('BROADCAST');
    });

    it('sums consistent and current gets for buffers', () => {
      expect(one({ last_cr_buffer_gets: 100, last_cu_buffer_gets: 25 }).logicalReads).toBe(125);
      expect(one({ cr_buffer_gets: 10, cu_buffer_gets: 3 }).logicalReads).toBe(13);
    });

    it('keeps single-key buffer fallbacks', () => {
      expect(one({ last_cr_buffer_gets: 100 }).logicalReads).toBe(100);
      expect(one({ actual_cr_buffer_gets: 42 }).logicalReads).toBe(42);
      expect(one({ buffer_gets: 7 }).logicalReads).toBe(7);
      expect(one({ logical_reads: 8 }).logicalReads).toBe(8);
    });

    it('maps physical writes', () => {
      expect(one({ last_disk_writes: 12 }).physicalWrites).toBe(12);
      expect(one({ disk_writes: 3 }).physicalWrites).toBe(3);
    });

    it('reads workarea sizes as bytes', () => {
      const node = one({ estimated_optimal_size: 2607104, estimated_onepass_size: 2607104 });
      expect(node.estimatedOptimalMemory).toBe(2607104);
      expect(node.estimatedOnePassMemory).toBe(2607104);
    });

    it('treats last_memory_used and last_tempseg_size as bytes', () => {
      const node = one({ last_memory_used: 1756160, last_tempseg_size: 8192 });
      expect(node.memoryUsed).toBe(1756160);
      expect(node.tempUsed).toBe(8192);
    });

    it('parses LAST_EXECUTION into workarea passes', () => {
      const passes = (last_execution: string) => one({ last_execution }).workareaPasses;
      expect(passes('OPTIMAL')).toBe(0);
      expect(passes('1 PASS')).toBe(1);
      expect(passes('ONE PASS')).toBe(1);
      expect(passes('ONEPASS')).toBe(1);
      expect(passes('3 PASSES')).toBe(3);
      expect(passes('garbage')).toBeUndefined();
      expect(one({}).workareaPasses).toBeUndefined();
    });

    it('maps workarea execution counts', () => {
      expect(
        one({ optimal_executions: 4, onepass_executions: 1, multipasses_executions: 0 }).workareaExecutions
      ).toEqual({ optimal: 4, onePass: 1, multipass: 0 });
      expect(one({ onepass_executions: 2 }).workareaExecutions).toEqual({ optimal: 0, onePass: 2, multipass: 0 });
      expect(one({}).workareaExecutions).toBeUndefined();
    });
  });
});
