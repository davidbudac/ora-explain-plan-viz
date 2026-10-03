import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { csvPlanParser, splitCsvPlanBatches } from '../csvPlanParser';
import { detectFormat, parsePlan, parsePlans, splitPlanBatches, getSourceDisplayName } from '../index';

/** SQL*Plus `SET MARKUP CSV ON` style: quoted header, quoted strings, bare numbers, empty = NULL. */
const SQLPLUS_CSV = [
  '"ID","PARENT_ID","DEPTH","OPERATION","OPTIONS","OBJECT_NAME","CARDINALITY","COST"',
  '0,,0,"SELECT STATEMENT",,,10,5',
  '1,0,1,"HASH JOIN",,,10,5',
  '2,1,2,"TABLE ACCESS","FULL","ORDERS",100,2',
  '3,1,2,"TABLE ACCESS","FULL","ITEMS",50,2',
].join('\n');

describe('CSV plan parser', () => {
  describe('canParse', () => {
    it('accepts SQL*Plus MARKUP CSV output', () => {
      expect(csvPlanParser.canParse(SQLPLUS_CSV)).toBe(true);
    });

    it('accepts an unquoted comma header', () => {
      expect(csvPlanParser.canParse('ID,PARENT_ID,OPERATION\n0,,SELECT STATEMENT')).toBe(true);
    });

    it('accepts semicolon- and tab-delimited exports', () => {
      expect(csvPlanParser.canParse('ID;PARENT_ID;OPERATION\n0;;SELECT STATEMENT')).toBe(true);
      expect(csvPlanParser.canParse('ID\tPARENT_ID\tOPERATION\n0\t\tSELECT STATEMENT')).toBe(true);
    });

    it('accepts DEPTH instead of PARENT_ID, any case, with a BOM and CRLF', () => {
      expect(csvPlanParser.canParse('\uFEFFId,Operation,Depth\r\n0,SELECT STATEMENT,0')).toBe(true);
    });

    it('finds the header below a few lines of noise', () => {
      expect(csvPlanParser.canParse('SQL> select * from v$sql_plan;\n\nID,PARENT_ID,OPERATION\n0,,X')).toBe(true);
    });

    it('rejects a header without the key columns', () => {
      expect(csvPlanParser.canParse('ID,NAME\n1,foo')).toBe(false);
      expect(csvPlanParser.canParse('ID,OPERATION\n0,X')).toBe(false);
    });

    it('rejects every other bundled format', () => {
      const dirs = [
        join(__dirname, '../../../examples'),
        join(__dirname, 'fixtures'),
      ];
      let checked = 0;
      for (const dir of dirs) {
        for (const file of readdirSync(dir)) {
          if (!/\.(txt|html)$/.test(file)) continue;
          expect(csvPlanParser.canParse(readFileSync(join(dir, file), 'utf-8')), file).toBe(false);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(20);
    });

    it('is detected by detectFormat and named', () => {
      expect(detectFormat(SQLPLUS_CSV)).toBe('csv');
      expect(getSourceDisplayName('csv')).toBe('CSV (V$SQL_PLAN)');
    });
  });

  describe('parse - tree', () => {
    it('builds the tree from PARENT_ID', () => {
      const plan = csvPlanParser.parse(SQLPLUS_CSV);
      expect(plan.source).toBe('csv');
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.rootNode?.operation).toBe('SELECT STATEMENT');
      const join = plan.allNodes[1];
      expect(join.operation).toBe('HASH JOIN');
      expect(join.children.map((c) => c.id)).toEqual([2, 3]);
      expect(plan.allNodes[2].operation).toBe('TABLE ACCESS FULL');
      expect(plan.allNodes[2].objectName).toBe('ORDERS');
      expect(plan.allNodes[2].rows).toBe(100);
      expect(plan.allNodes[2].cost).toBe(2);
      expect(plan.totalCost).toBe(5);
      expect(plan.warnings).toBeUndefined();
    });

    it('builds the tree from DEPTH alone', () => {
      const plan = csvPlanParser.parse(
        'ID,DEPTH,OPERATION\n0,0,SELECT STATEMENT\n1,1,HASH JOIN\n2,2,SCAN A\n3,2,SCAN B\n4,1,SORT',
      );
      expect(plan.rootNode?.children.map((c) => c.id)).toEqual([1, 4]);
      expect(plan.allNodes[1].children.map((c) => c.id)).toEqual([2, 3]);
    });

    it('parses semicolon and tab delimited text the same way', () => {
      const semi = csvPlanParser.parse('ID;PARENT_ID;OPERATION\n0;;SELECT STATEMENT\n1;0;TABLE ACCESS');
      expect(semi.allNodes).toHaveLength(2);
      expect(semi.rootNode?.children[0].id).toBe(1);
      const tab = csvPlanParser.parse('ID\tPARENT_ID\tOPERATION\n0\t\tSELECT STATEMENT\n1\t0\tTABLE ACCESS');
      expect(tab.allNodes).toHaveLength(2);
    });

    it('handles a BOM and CRLF line endings', () => {
      const plan = csvPlanParser.parse(`\uFEFF${SQLPLUS_CSV.replace(/\n/g, '\r\n')}\r\n`);
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.rootNode?.operation).toBe('SELECT STATEMENT');
    });

    it('reads the plan header columns', () => {
      const plan = csvPlanParser.parse(
        'SQL_ID,CHILD_NUMBER,PLAN_HASH_VALUE,ID,PARENT_ID,OPERATION\nabc,2,12345,0,,SELECT STATEMENT\nabc,2,12345,1,0,X',
      );
      expect(plan.sqlId).toBe('abc');
      expect(plan.childNumber).toBe(2);
      expect(plan.planHashValue).toBe('12345');
    });
  });

  describe('parse - quoting', () => {
    it('keeps commas, doubled quotes and newlines inside quoted predicates', () => {
      const csv = [
        'ID,PARENT_ID,OPERATION,OPTIONS,OBJECT_NAME,ACCESS_PREDICATES,FILTER_PREDICATES',
        '0,,"SELECT STATEMENT",,,,',
        '1,0,"TABLE ACCESS","FULL","T","""A""=1 AND ""B"" IN (1,2,3)","""C""=\'x, y\'',
        'AND ""D"">0"',
        '2,1,"INDEX","RANGE SCAN","IX",,',
      ].join('\n');
      const plan = csvPlanParser.parse(csv);
      expect(plan.allNodes).toHaveLength(3);
      expect(plan.allNodes[1].accessPredicates).toBe('"A"=1 AND "B" IN (1,2,3)');
      expect(plan.allNodes[1].filterPredicates).toBe('"C"=\'x, y\'\nAND "D">0');
      expect(plan.allNodes[2].id).toBe(2);
      expect(plan.warnings).toBeUndefined();
    });
  });

  describe('parse - runtime columns', () => {
    const csv = [
      'ID,PARENT_ID,OPERATION,CARDINALITY,TIME,PROJECTION,LAST_STARTS,LAST_OUTPUT_ROWS,LAST_ELAPSED_TIME,LAST_CR_BUFFER_GETS,LAST_CU_BUFFER_GETS',
      '0,,SELECT STATEMENT,1,2,,1,1,12000,50,1',
      '1,0,TABLE ACCESS FULL,1,2,"""T"".""X""[NUMBER,22]",1,1,11000,40,0',
    ].join('\n');

    it('maps A-Rows, Starts, microseconds to ms, buffers, time and projection', () => {
      const plan = csvPlanParser.parse(csv);
      expect(plan.hasActualStats).toBe(true);
      const [root, scan] = plan.allNodes;
      expect(root.actualRows).toBe(1);
      expect(root.starts).toBe(1);
      expect(root.actualTime).toBe(12);
      expect(root.logicalReads).toBe(51);
      expect(root.time).toBe('00:00:02');
      expect(scan.projection).toBe('"T"."X"[NUMBER,22]');
      expect(plan.totalElapsedTime).toBe(12);
    });

    it('has no actual stats without the runtime columns', () => {
      expect(csvPlanParser.parse(SQLPLUS_CSV).hasActualStats).toBe(false);
    });
  });

  describe('parse - noise and warnings', () => {
    it('ignores leading noise and a trailing "n rows selected." without a warning', () => {
      const csv = `SQL> select * from v$sql_plan;\n\n${SQLPLUS_CSV}\n\n4 rows selected.\n\n`;
      const plan = csvPlanParser.parse(csv);
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.warnings).toBeUndefined();
    });

    it('warns about records that look like data but have no numeric ID', () => {
      const csv = `${SQLPLUS_CSV}\nfoo,bar,baz,qux\n`;
      const plan = csvPlanParser.parse(csv);
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings![0].code).toBe('unparsed_rows');
      expect(plan.warnings![0].detail).toContain('foo,bar,baz,qux');
    });

    it('keeps the first row of a repeated ID and warns that several plans are mixed', () => {
      const csv = `${SQLPLUS_CSV}\n0,,0,"SELECT STATEMENT",,,1,1\n1,0,1,"NESTED LOOPS",,,1,1`;
      const plan = csvPlanParser.parse(csv);
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.allNodes[1].operation).toBe('HASH JOIN');
      const warning = plan.warnings!.find((w) => w.code === 'duplicate_ids');
      expect(warning?.message).toContain('0, 1');
    });

    it('does not treat a repeated header line as data', () => {
      const header = SQLPLUS_CSV.split('\n')[0];
      const plan = csvPlanParser.parse(`${SQLPLUS_CSV}\n${header}\n`);
      expect(plan.allNodes).toHaveLength(4);
      expect(plan.warnings).toBeUndefined();
    });
  });

  describe('parsePlan end-to-end', () => {
    it('parses a fully quoted CSV whose first and last characters are quotes', () => {
      const csv = [
        '"ID","PARENT_ID","OPERATION","OBJECT_NAME"',
        '"0","","SELECT STATEMENT",""',
        '"1","0","TABLE ACCESS FULL","ORDERS"',
      ].join('\n');
      expect(csv.startsWith('"') && csv.endsWith('"')).toBe(true);
      const plan = parsePlan(csv);
      expect(plan.source).toBe('csv');
      expect(plan.allNodes).toHaveLength(2);
      expect(plan.allNodes[1].objectName).toBe('ORDERS');
    });

    it('runs the post-parse derivations', () => {
      const plan = parsePlan(SQLPLUS_CSV);
      expect(plan.allNodes[2].selfCost).toBe(2);
      expect(plan.allNodes[1].selfCost).toBe(1);
    });
  });

  describe('splitCsvPlanBatches', () => {
    const header = 'SQL_ID,CHILD_NUMBER,PLAN_HASH_VALUE,ID,PARENT_ID,OPERATION,OBJECT_NAME';
    const twoPlans = [
      header,
      '"a1",0,111,0,,"SELECT STATEMENT",',
      '"a1",0,111,1,0,"TABLE ACCESS FULL","ORDERS"',
      '"b2",0,222,0,,"SELECT STATEMENT",',
      '"b2",0,222,1,0,"HASH JOIN",',
      '"b2",0,222,2,1,"TABLE ACCESS FULL","ITEMS"',
      '"b2",0,222,3,1,"TABLE ACCESS FULL","ORDERS"',
      '',
      '6 rows selected.',
    ].join('\n');

    it('splits by SQL_ID / child / plan hash, in first-seen order', () => {
      const batches = splitCsvPlanBatches(twoPlans);
      expect(batches).toHaveLength(2);
      expect(batches[0].split('\n')[0]).toBe(header);
      expect(batches[0]).not.toContain('b2');
      expect(batches[1]).not.toContain('a1');
      expect(batches[1]).not.toContain('rows selected');
      const [a, b] = batches.map((batch) => parsePlan(batch));
      expect(a.sqlId).toBe('a1');
      expect(a.allNodes).toHaveLength(2);
      expect(a.warnings).toBeUndefined();
      expect(b.sqlId).toBe('b2');
      expect(b.allNodes).toHaveLength(4);
      expect(b.rootNode?.children[0].children.map((c) => c.objectName)).toEqual(['ITEMS', 'ORDERS']);
    });

    it('separates child cursors of the same SQL_ID', () => {
      const csv = [
        'SQL_ID,CHILD_NUMBER,ID,PARENT_ID,OPERATION',
        'a,0,0,,SELECT STATEMENT',
        'a,1,0,,SELECT STATEMENT',
        'a,0,1,0,X',
        'a,1,1,0,Y',
      ].join('\n');
      const batches = splitCsvPlanBatches(csv);
      expect(batches).toHaveLength(2);
      expect(parsePlan(batches[0]).allNodes[1].operation).toBe('X');
      expect(parsePlan(batches[1]).allNodes[1].operation).toBe('Y');
    });

    it('keeps embedded newlines inside a record intact', () => {
      const csv = [
        'SQL_ID,ID,PARENT_ID,OPERATION,FILTER_PREDICATES',
        'a,0,,SELECT STATEMENT,',
        'b,0,,SELECT STATEMENT,"x=1',
        'AND y=2"',
      ].join('\n');
      const batches = splitCsvPlanBatches(csv);
      expect(batches).toHaveLength(2);
      expect(parsePlan(batches[1]).allNodes[0].filterPredicates).toBe('x=1\nAND y=2');
    });

    it('returns the input for a single plan or without identifying columns', () => {
      expect(splitCsvPlanBatches(SQLPLUS_CSV)).toEqual([SQLPLUS_CSV]);
      const single = `${header}\n"a1",0,111,0,,"SELECT STATEMENT",`;
      expect(splitCsvPlanBatches(single)).toEqual([single]);
    });

    it('returns nothing for non-CSV input', () => {
      expect(splitCsvPlanBatches('Plan hash value: 1')).toEqual([]);
    });

    it('is what splitPlanBatches / parsePlans use for CSV', () => {
      expect(splitPlanBatches(twoPlans)).toHaveLength(2);
      const plans = parsePlans(twoPlans);
      expect(plans.map((p) => p.sqlId)).toEqual(['a1', 'b2']);
    });
  });
});

describe('CSV plan parser - real Oracle 19c capture', () => {
  // SQL*Plus SET MARKUP CSV ON of select * from v$sql_plan_statistics_all ... order by id (real capture).
  const capture = readFileSync(join(__dirname, 'fixtures/vsqlplan-stats-allstats-19c.csv'), 'utf-8');

  it('is detected as csv and parses with no warnings', () => {
    expect(detectFormat(capture)).toBe('csv');
    const plan = parsePlan(capture);
    expect(plan.source).toBe('csv');
    expect(plan.warnings).toBeUndefined();
  });

  it('rebuilds the plan tree', () => {
    const plan = parsePlan(capture);
    const shape = (n: (typeof plan.allNodes)[number]): unknown[] => [
      n.id,
      n.objectName ? `${n.operation} ${n.objectName}` : n.operation,
      ...n.children.map(shape),
    ];
    expect(shape(plan.rootNode!)).toEqual([
      0, 'SELECT STATEMENT',
      [1, 'SORT GROUP BY',
        [2, 'HASH JOIN',
          [3, 'TABLE ACCESS FULL PRODUCTS'],
          [4, 'HASH JOIN',
            [5, 'TABLE ACCESS FULL TIMES'],
            [6, 'HASH JOIN',
              [7, 'TABLE ACCESS FULL CUSTOMERS'],
              [8, 'TABLE ACCESS FULL SALES']]]]],
    ]);
    expect(plan.allNodes).toHaveLength(9);
  });

  it('reads plan identity, runtime stats and normalised aliases', () => {
    const plan = parsePlan(capture);
    expect(plan.sqlId).toBe('04gw1nkv9pwk1');
    expect(plan.planHashValue).toBe('717513941');
    expect(plan.childNumber).toBe(0);
    expect(plan.hasActualStats).toBe(true);
    expect(plan.rootNode?.actualRows).toBe(10);
    const products = plan.allNodes.find((n) => n.id === 3)!;
    expect(products.objectAlias).toBe('P@SEL$1');
    expect(products.queryBlock).toBe('SEL$EE94F965');
  });

  it('splits into a single batch', () => {
    expect(splitPlanBatches(capture)).toHaveLength(1);
  });
});
