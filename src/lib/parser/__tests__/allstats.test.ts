import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectFormat, parsePlan, parsePlans } from '../index';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const WORKAREA = fixture('allstats-workarea.txt');

const node = (plan: ReturnType<typeof parsePlan>, id: number) => {
  const n = plan.allNodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

describe('format routing', () => {
  it('sends DISPLAY_CURSOR ALLSTATS output to the DBMS_XPLAN parser', () => {
    expect(detectFormat(WORKAREA)).toBe('dbms_xplan');
    expect(parsePlan(WORKAREA).source).toBe('dbms_xplan');
  });

  it('sends the real 19c ALLSTATS fixtures to the DBMS_XPLAN parser', () => {
    for (const name of ['allstats-nlj-batching.txt', 'allstats-batched-rowid.txt']) {
      expect(parsePlan(fixture(name)).source).toBe('dbms_xplan');
    }
  });

  it('keeps a bare A-Rows table without a plan hash on the SQL Monitor text parser', () => {
    const bare = `
| Id | Operation        | Name | E-Rows | A-Rows | A-Time   | Starts |
|  0 | SELECT STATEMENT |      |        |      1 | 00:00:01 |      1 |
|  1 |  TABLE ACCESS FULL | EMP |     14 |     14 | 00:00:01 |      1 |
`.trim();
    expect(detectFormat(bare)).toBe('sql_monitor_text');
    expect(parsePlan(bare).source).toBe('sql_monitor_text');
  });

  it('keeps SQL Monitor reports on the SQL Monitor text parser even with a plan hash line', () => {
    const report = `
SQL Monitoring Report

Plan hash value: 1234567890

SQL Plan Monitoring Details (Plan Hash Value=1234567890)
| Id | Operation        | Name | E-Rows | A-Rows | A-Time   | Starts |
|  0 | SELECT STATEMENT |      |        |      1 | 00:00:01 |      1 |
|  1 |  TABLE ACCESS FULL | EMP |     14 |     14 | 00:00:01 |      1 |
`.trim();
    expect(detectFormat(report)).toBe('sql_monitor_text');
  });
});

describe('ALLSTATS LAST via the DBMS_XPLAN parser', () => {
  const plan = parsePlan(WORKAREA);

  it('keeps the header, SQL text, predicates and notes', () => {
    expect(plan.sqlId).toBe('9fq3kz7w2m8ud');
    expect(plan.sqlText).toContain('gather_plan_statistics');
    expect(plan.planHashValue).toBe('3302186721');
    expect(node(plan, 3).accessPredicates).toBe('"C"."CUST_ID"="S"."CUST_ID"');
    expect(plan.notes?.rawLines.join(' ')).toContain('dynamic sampling');
  });

  it('builds the tree', () => {
    expect(plan.allNodes).toHaveLength(7);
    expect(node(plan, 3).children.map((c) => c.id)).toEqual([4, 5]);
  });

  it('reads Starts, A-Rows, A-Time', () => {
    const scan = node(plan, 6);
    expect(scan.starts).toBe(8);
    expect(scan.actualRows).toBe(918_000);
    expect(scan.actualTime).toBeCloseTo(260);
    expect(node(plan, 0).actualTime).toBeCloseTo(1420);
  });

  it('reads Buffers, Reads and Writes', () => {
    const join = node(plan, 3);
    expect(join.logicalReads).toBe(12364);
    expect(join.physicalReads).toBe(2865);
    expect(join.physicalWrites).toBe(2843);
    // Reads is physical reads here, not I/O request stats
    expect(join.ioReadRequests).toBeUndefined();
    expect(node(plan, 4).physicalReads).toBe(0);
  });

  it('keeps OMem, 1Mem and Used-Mem apart', () => {
    const sort = node(plan, 1);
    expect(sort.estimatedOptimalMemory).toBe(1236 * 1024);
    expect(sort.estimatedOnePassMemory).toBe(1236 * 1024);
    expect(sort.memoryUsed).toBe(1152 * 1024);
    expect(sort.workareaPasses).toBe(0);
  });

  it('reads a spilling hash join: one-pass and Used-Tmp', () => {
    const hj = node(plan, 3);
    expect(hj.estimatedOptimalMemory).toBe(37 * 1024 ** 2);
    expect(hj.estimatedOnePassMemory).toBe(2843 * 1024);
    expect(hj.memoryUsed).toBe(10 * 1024 ** 2);
    expect(hj.workareaPasses).toBe(1);
    expect(hj.tempUsed).toBe(43 * 1024 ** 2);
  });

  it('leaves work-area fields undefined where the cells are blank', () => {
    const scan = node(plan, 4);
    expect(scan.memoryUsed).toBeUndefined();
    expect(scan.workareaPasses).toBeUndefined();
    expect(scan.tempUsed).toBeUndefined();
  });

  it('sets the plan-level runtime summary', () => {
    expect(plan.hasActualStats).toBe(true);
    expect(plan.maxActualRows).toBe(918_000);
    expect(plan.maxStarts).toBe(8);
    expect(plan.totalElapsedTime).toBeCloseTo(1420);
    expect(plan.maxRows).toBe(918_000);
  });
});

describe('DBMS_XPLAN runtime columns', () => {
  it('reads O/1/M executions, Max-Tmp and 0Mem spellings', () => {
    const text = `
Plan hash value: 42

--------------------------------------------------------------------------------------------
| Id  | Operation          | Name | Starts | E-Rows | A-Rows | 0Mem | 1Mem | O/1/M   | Max-Tmp |
--------------------------------------------------------------------------------------------
|   0 | SELECT STATEMENT   |      |      1 |        |     10 |      |      |         |         |
|   1 |  SORT ORDER BY     |      |      1 |     10 |     10 | 2048K| 2048K| 2/0/0   |    8192 |
--------------------------------------------------------------------------------------------
`.trim();
    const plan = parsePlan(text);
    expect(plan.source).toBe('dbms_xplan');
    const sort = node(plan, 1);
    expect(sort.workareaExecutions).toEqual({ optimal: 2, onePass: 0, multipass: 0 });
    expect(sort.estimatedOptimalMemory).toBe(2048 * 1024);
    expect(sort.tempUsed).toBe(8192);
  });

  it('reads multipass pass counts', () => {
    const text = `
Plan hash value: 43

---------------------------------------------------------------
| Id  | Operation          | Name | Starts | A-Rows | Used-Mem |
---------------------------------------------------------------
|   0 | SELECT STATEMENT   |      |      1 |      5 |          |
|   1 |  SORT ORDER BY     |      |      1 |      5 | 5120K (3)|
---------------------------------------------------------------
`.trim();
    const sort = node(parsePlan(text), 1);
    expect(sort.memoryUsed).toBe(5120 * 1024);
    expect(sort.workareaPasses).toBe(3);
  });

  it('scales suffixed costs and keeps %CPU', () => {
    const text = `
Plan hash value: 44

------------------------------------------------------
| Id  | Operation          | Name | Rows  | Cost (%CPU)|
------------------------------------------------------
|   0 | SELECT STATEMENT   |      |  1000 | 4823K   (1)|
|   1 |  TABLE ACCESS FULL | EMP  |  1000 |   13M   (2)|
------------------------------------------------------
`.trim();
    const plan = parsePlan(text);
    expect(node(plan, 0).cost).toBe(4_823_000);
    expect(node(plan, 0).cpuPercent).toBe(1);
    expect(node(plan, 1).cost).toBe(13_000_000);
    expect(plan.totalCost).toBe(4_823_000);
  });

  it('has no actual stats for an estimates-only plan', () => {
    const text = `
Plan hash value: 45

------------------------------------------
| Id  | Operation         | Name | Rows  |
------------------------------------------
|   0 | SELECT STATEMENT  |      |     1 |
------------------------------------------
`.trim();
    const plan = parsePlan(text);
    expect(plan.hasActualStats).toBe(false);
    expect(plan.maxActualRows).toBeUndefined();
  });
});

describe('text robustness', () => {
  it('parses CRLF input identically to LF, notes included', () => {
    const crlf = WORKAREA.replace(/\n/g, '\r\n');
    const lf = parsePlan(WORKAREA);
    const win = parsePlan(crlf);
    expect(win).toEqual(lf);
    expect(win.notes?.rawLines.length).toBeGreaterThan(0);
  });

  it('parses lone CR input and CRLF batches', () => {
    expect(parsePlan(WORKAREA.replace(/\n/g, '\r')).allNodes).toHaveLength(7);
    const two = `${WORKAREA}\n\n${WORKAREA}`.replace(/\n/g, '\r\n');
    expect(parsePlans(two)).toHaveLength(2);
  });

  it('counts a tab in the operation indentation toward depth', () => {
    // After "|   1 |" (7 chars) a tab pads to column 8 (one space), so NESTED LOOPS
    // sits two spaces in and TABLE ACCESS FULL three.
    const text = [
      'Plan hash value: 46',
      '',
      '---------------------------------------------',
      '| Id  | Operation          | Name | Rows |',
      '---------------------------------------------',
      '|   0 | SELECT STATEMENT   |      |    1 |',
      '|   1 |\t NESTED LOOPS      |      |    1 |',
      '|   2 |\t  TABLE ACCESS FULL| EMP  |    1 |',
      '---------------------------------------------',
    ].join('\n');
    const plan = parsePlan(text);
    expect(plan.allNodes.map((n) => n.operation)).toEqual([
      'SELECT STATEMENT',
      'NESTED LOOPS',
      'TABLE ACCESS FULL',
    ]);
    expect(plan.allNodes.map((n) => n.parentId)).toEqual([undefined, 0, 1]);
    expect(node(plan, 2).objectName).toBe('EMP');
    expect(node(plan, 2).rows).toBe(1);
  });
});

describe('SQL Monitor text parser shares the value parsers', () => {
  it('reads suffixed costs, Used-Mem with a pass count, and tab-indented rows', () => {
    const text = [
      'SQL Plan Monitoring Details (Plan Hash Value=777)',
      '| Id | Operation        | Name | Cost  | E-Rows | A-Rows | A-Time   | Starts | Used-Mem  |',
      '|  0 | SELECT STATEMENT |      | 4823K |        |      5 | 00:00:01 |      1 |           |',
      '|  1 |\t SORT ORDER BY  |      | 4823K |      5 |      5 | 00:00:01 |      1 | 1385K (0) |',
    ].join('\r\n');
    const plan = parsePlan(text);
    expect(plan.source).toBe('sql_monitor_text');
    expect(node(plan, 0).cost).toBe(4_823_000);
    expect(node(plan, 1).memoryUsed).toBe(1385 * 1024);
    expect(node(plan, 1).parentId).toBe(0);
  });
});

describe('real 19c captures', () => {
  const spill = parsePlan(fixture('allstats-spill-19c.txt'));

  it('reads a spilling SORT JOIN: plain-byte Used-Mem with two spaces before the pass count', () => {
    expect(spill.source).toBe('dbms_xplan');
    const sort1 = node(spill, 3);
    expect(sort1.memoryUsed).toBe(58368);
    expect(sort1.workareaPasses).toBe(1);
    expect(sort1.estimatedOptimalMemory).toBe(3861 * 1024);
    expect(sort1.estimatedOnePassMemory).toBe(843 * 1024);
    expect(sort1.tempUsed).toBe(4096 * 1024);
    expect(sort1.physicalWrites).toBe(429);

    const sort2 = node(spill, 32);
    expect(sort2.memoryUsed).toBe(49152);
    expect(sort2.workareaPasses).toBe(2);
  });

  it('reads an in-memory hash join (suffixed Used-Mem, zero passes)', () => {
    const hj = node(spill, 7);
    expect(hj.memoryUsed).toBe(116 * 1024);
    expect(hj.workareaPasses).toBe(0);
    expect(hj.tempUsed).toBeUndefined();
  });

  it('parses a tab-printed (SET TAB ON) plan identically to the space version', () => {
    const spaced = parsePlan(fixture('allstats-adaptive-19c.txt'));
    const tabbed = parsePlan(fixture('allstats-adaptive-19c-tabs.txt'));
    expect(tabbed.allNodes.length).toBe(spaced.allNodes.length);
    expect(tabbed.allNodes.length).toBeGreaterThan(20);
    const strip = (p: ReturnType<typeof parsePlan>) =>
      p.allNodes.map((n) => ({ ...n, children: n.children.map((c) => c.id) }));
    expect(strip(tabbed)).toEqual(strip(spaced));
    expect(tabbed.hasActualStats).toBe(true);
  });

  it('still parses adaptive inactive ("-") rows as normal rows', () => {
    const plan = parsePlan(fixture('allstats-adaptive-19c.txt'));
    expect(plan.allNodes.some((n) => n.id === 27)).toBe(true);
    expect(plan.allNodes.some((n) => n.id === 29)).toBe(true);
  });
});

describe('SQL Monitor "->" executing marker', () => {
  it('does not treat "-> N" rows as inactive, but still treats "- N" as skipped', () => {
    const text = [
      'SQL Plan Monitoring Details (Plan Hash Value=888)',
      '| Id   | Operation          | Name | E-Rows | A-Rows | A-Time   | Starts |',
      '|    0 | SELECT STATEMENT   |      |        |      1 | 00:00:01 |      1 |',
      '| -> 1 |  TABLE ACCESS FULL | EMP  |     14 |     14 | 00:00:01 |      1 |',
      '| -  2 |  TABLE ACCESS FULL | DEPT |      4 |        |          |        |',
    ].join('\n');
    const plan = parsePlan(text);
    expect(node(plan, 1).inactive).toBeUndefined();
    expect(node(plan, 2).inactive).toBe(true);
  });
});
