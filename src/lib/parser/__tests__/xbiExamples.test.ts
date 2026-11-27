import { describe, it, expect } from 'vitest';
import { SAMPLE_PLANS } from '../../../examples';
import { runAdvisor } from '../../advisor/engine';
import { nodeCardinalityRatio } from '../../format';
import type { ParsedPlan } from '../../types';
import { parsePlan } from '../index';
import { xbiParser } from '../xbiParser';

function loadExample(name: string) {
  const sample = SAMPLE_PLANS.find((p) => p.name === name);
  if (!sample) throw new Error(`example not found: ${name}`);
  return parsePlan(sample.data);
}

describe('xbi examples (verbatim blog output)', () => {
  const query = loadExample('XBI TPC-DS Query');
  const tempTable = loadExample('XBI TPC-DS Temp Table');
  const byId = (plan: typeof query, id: number) => plan.allNodes.find((n) => n.id === id)!;

  it('parses both as xbi plans', () => {
    expect(query.source).toBe('xbi');
    expect(tempTable.source).toBe('xbi');
    expect(query.rootNode).not.toBeNull();
    expect(tempTable.rootNode).not.toBeNull();
  });

  it('never leaves a bracketed object name glued to an operation', () => {
    for (const plan of [query, tempTable]) {
      for (const node of plan.allNodes) {
        expect(node.operation, `node ${node.id}`).not.toContain('[');
      }
    }
  });

  it('keeps the truncated object-name fragment as objectName', () => {
    expect(byId(query, 9).operation).toBe('TABLE ACCESS BY GLOBAL INDEX ROWID');
    expect(byId(query, 9).objectName).toBe('ST');
    expect(byId(tempTable, 17).objectName).toBe('SYS_TEMP_0FD9');
    expect(byId(tempTable, 19).objectName).toBe('SYS_TEMP_0FD9D6');
    expect(byId(tempTable, 17).operation).toBe('TABLE ACCESS FULL');
  });

  it('handles a VIEW with a double-space before its bracketed name', () => {
    const view = byId(tempTable, 5);
    expect(view.operation).toBe('VIEW');
    expect(view.objectName).toBe('VW_GBF_7');
  });

  it('keeps a parenthesised operation suffix intact', () => {
    expect(byId(tempTable, 2).operation).toBe('LOAD AS SELECT (CURSOR DURATION MEMORY)');
    expect(byId(tempTable, 2).objectName).toBeUndefined();
    expect(byId(tempTable, 2).actualRows).toBe(0);
  });
});

// xbi.sql prints "Est. rows total" as CARDINALITY × LAST_STARTS, raw; the app applies the same
// estimate-total rules to it as to DBMS_XPLAN ALLSTATS, which reads the same V$ view.
describe('xbi estimates against actual rows', () => {
  const query = loadExample('XBI TPC-DS Query');
  const tempTable = loadExample('XBI TPC-DS Temp Table');
  const byId = (plan: ParsedPlan, id: number) => plan.allNodes.find((n) => n.id === id)!;
  const cardinalityFindingIds = (plan: ParsedPlan) => runAdvisor(plan, null).findings
    .filter((f) => f.ruleId === 'cardinality-mismatch')
    .flatMap((f) => f.nodeIds);

  it('multiplies a partition scan by the iterator’s Starts, not by the partitions it visited', () => {
    // Line 8 STORE_RETURNS: 22 starts = 22 partitions under PARTITION RANGE ALL (line 7, 1 start);
    // 11,500,560 rows per start estimated, 11,500,560 returned.
    const scan = byId(tempTable, 8);
    expect(scan.rows).toBe(11500560);
    expect(scan.estimatedRowsTotal).toBe(11500560);
    expect(nodeCardinalityRatio(scan)).toBe(1);
    expect(cardinalityFindingIds(tempTable)).not.toContain(8);
  });

  it('multiplies an NLJ-batched rowid fetch by the Starts of the index feeding it', () => {
    // Line 9 is the table-by-rowid side of NESTED LOOPS 5 over NESTED LOOPS 6: its 693 rows per start
    // are per outer row, i.e. per start of INDEX RANGE SCAN 8 (160 starts). 693 × 160 = 110,880.
    const fetch = byId(query, 9);
    expect(fetch.rows).toBe(693);
    expect(fetch.estimatedRowsTotal).toBe(110880);
    expect(nodeCardinalityRatio(fetch)).toBeCloseTo(112576 / 110880, 6);
    expect(cardinalityFindingIds(query)).not.toContain(9);
  });

  it('still reports the real misestimates', () => {
    // HASH JOIN 3: 114,030 estimated, 9,056 returned. TEMP table reads 17 / 19: 2,096,755 vs 64,004.
    expect(cardinalityFindingIds(query)).toContain(3);
    expect(cardinalityFindingIds(tempTable)).toEqual(expect.arrayContaining([17, 19]));
  });

  it('matches the printed Est. rows total on operations that need no adjustment', () => {
    expect(byId(query, 4).estimatedRowsTotal).toBe(6000);
    expect(byId(query, 8).estimatedRowsTotal).toBe(110880);
    expect(byId(query, 5).estimatedRowsTotal).toBe(114030);
    expect(byId(tempTable, 4).estimatedRowsTotal).toBe(2096755);
    expect(byId(tempTable, 20).estimatedRowsTotal).toBe(709015);
  });

  it('keeps E-Rows and Starts, so the printed total stays recoverable where the app’s total differs', () => {
    const fetch = byId(query, 9);
    expect(fetch.rows! * fetch.starts!).toBe(78015168);
    const scan = byId(tempTable, 8);
    expect(scan.rows! * scan.starts!).toBe(253012320);
  });
});

describe('xbi Row Source truncation', () => {
  const header = [
    ' Pred    Op  Par.  #Sib                              Query Block             ms spent in Consistent  Rowsource  Real #rows     Est. rows',
    ' #Col    ID    ID  ling Row Source                     name                 this operation       gets     starts    returned         total',
    '----- ----- ----- ----- ------------------------------ -------------------- -------------- ---------- ---------- ----------- -------------',
  ];

  it('strips an unterminated trailing [fragment from the operation', () => {
    const text = [
      ...header,
      '          0             SELECT STATEMENT               >>> Plan totals >>>          10.00          5          1           1',
      '          1     0     1  TABLE ACCESS FULL [SYS_TEMP_0 SEL$1                          10.00          5          1           1             1',
    ].join('\n');
    const plan = xbiParser.parse(text);
    const node = plan.allNodes.find((n) => n.id === 1)!;
    expect(node.operation).toBe('TABLE ACCESS FULL');
    expect(node.objectName).toBe('SYS_TEMP_0');
  });
});
