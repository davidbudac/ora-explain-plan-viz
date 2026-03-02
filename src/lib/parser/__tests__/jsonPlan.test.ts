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
});
