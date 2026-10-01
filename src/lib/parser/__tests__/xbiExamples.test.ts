import { describe, it, expect } from 'vitest';
import { SAMPLE_PLANS } from '../../../examples';
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
