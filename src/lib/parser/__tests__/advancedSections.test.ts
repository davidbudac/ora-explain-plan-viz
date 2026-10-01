import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan } from '../index';
import {
  parseHintReport,
  parseOutlineSection,
  parsePeekedBinds,
  parseProjectionSection,
  parseRemoteSqlSection,
} from '../advancedSections';

const ADVANCED = readFileSync(join(__dirname, 'fixtures', 'advanced-allstats-19c.txt'), 'utf-8');
const lines = (text: string): string[] => text.split('\n');

const node = (plan: ReturnType<typeof parsePlan>, id: number) => {
  const n = plan.allNodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

describe('ADVANCED fixture (DISPLAY_CURSOR, 19c)', () => {
  const plan = parsePlan(ADVANCED);

  it('reads the outline hints one per entry, without the wrapper', () => {
    const hints = plan.outlineHints!;
    expect(hints).toHaveLength(58);
    expect(hints[0]).toBe('IGNORE_OPTIM_EMBEDDED_HINTS');
    expect(hints[1]).toBe("OPTIMIZER_FEATURES_ENABLE('19.1.0')");
    expect(hints[hints.length - 1]).toBe('INDEX_RS_ASC(@"SEL$3" "S"@"SEL$3" ("SUM$"."OBJ#"))');
    expect(hints.some((h) => /OUTLINE_DATA|\/\*|\*\//.test(h))).toBe(false);
    expect(hints).toContain('MERGE(@"SEL$5" >"SEL$2")');
  });

  it('attaches the hint report to the operation, with status and reason', () => {
    const hints = node(plan, 1).hints!;
    expect(hints).toHaveLength(3);
    expect(hints.filter((h) => h.status === 'error').map((h) => h.text)).toEqual(['no_such_hint', 'planviz_advanced']);
    const unused = hints.find((h) => h.status === 'unused')!;
    expect(unused).toMatchObject({
      text: 'index(o)',
      code: 'U',
      reason: 'hint on view cannot be pushed into view',
      queryBlock: 'SEL$1',
      alias: 'O@SEL$1',
    });
    expect(node(plan, 2).hints).toBeUndefined();
    expect(plan.hintSummary).toEqual({ total: 3, unused: 1, errors: 2 });
  });

  it('joins a wrapped projection line with one space', () => {
    expect(node(plan, 5).projection).toBe(
      '(#keys=1) "U"."SPARE2"[NUMBER,22], "U"."TYPE#"[NUMBER,22], "U"."SPARE1"[NUMBER,22], "U"."NAME"[VARCHAR2,128], "O"."OBJ#"[NUMBER,22], "O"."SPARE3"[NUMBER,22], "O"."TYPE#"[NUMBER,22], "O"."FLAGS"[NUMBER,22]',
    );
    expect(node(plan, 3).projection).toBe('STRDEF[128]');
    expect(node(plan, 4).projection).toBe('"U"."NAME"[VARCHAR2,128]');
    // Operations the section does not list have no projection.
    expect(node(plan, 0).projection).toBeUndefined();
  });

  it('reads the peeked binds', () => {
    expect(plan.bindVariables).toEqual([
      { name: ':1', type: 'NUMBER', value: '20', position: 1 },
      { name: ':2', type: 'VARCHAR2(30)', value: 'SYS', position: 2 },
    ]);
  });

  it('still reads predicates and query blocks identically', () => {
    expect(node(plan, 5).accessPredicates).toBe('"O"."OWNER#"="U"."USER#"');
    expect(node(plan, 9).accessPredicates).toBe('"U"."NAME"=:B2');
    expect(node(plan, 16).accessPredicates).toBe('"IO"."OBJ#"="I"."BO#" AND "IO"."TYPE#"=2');
    expect(node(plan, 16).filterPredicates).toBe('"IO"."TYPE#"=2');
    expect(node(plan, 2).queryBlock).toBe('SET$1');
    expect(node(plan, 2).objectAlias).toBe('O@SEL$1');
    expect(node(plan, 32).objectAlias).toBe('L@SEL$14');
    expect(node(plan, 28).filterPredicates).toBe('NULL IS NOT NULL');
  });

  it('does not let the Query Block Registry leak into anything', () => {
    expect(node(plan, 32).projection).toBeUndefined();
    expect(JSON.stringify(plan.allNodes.map((n) => n.hints))).not.toContain('CDATA');
  });
});

describe('plans without ADVANCED sections', () => {
  it('leave the new fields unset', () => {
    const plan = parsePlan(`Plan hash value: 1

---------------------------------------
| Id  | Operation         | Name | Rows |
---------------------------------------
|   0 | SELECT STATEMENT  |      |    1 |
|   1 |  TABLE ACCESS FULL| T    |    1 |
---------------------------------------
`);
    expect(plan.outlineHints).toBeUndefined();
    expect(plan.hintSummary).toBeUndefined();
    expect(plan.bindVariables).toBeUndefined();
    expect(plan.allNodes.every((n) => n.projection === undefined && n.hints === undefined)).toBe(true);
  });
});

describe('parseOutlineSection', () => {
  it('joins a hint that wraps across lines', () => {
    const hints = parseOutlineSection(
      lines(`Outline Data
-------------

  /*+
      BEGIN_OUTLINE_DATA
      INDEX(@"SEL$1" "T"@"SEL$1" ("T"."A"
              "T"."B"))
      FULL(@"SEL$1" "U"@"SEL$1")
      END_OUTLINE_DATA
  */

Predicate Information (identified by operation id):`),
    );
    expect(hints).toEqual(['INDEX(@"SEL$1" "T"@"SEL$1" ("T"."A" "T"."B"))', 'FULL(@"SEL$1" "U"@"SEL$1")']);
  });

  it('returns undefined without an Outline Data header', () => {
    expect(parseOutlineSection(lines('Predicate Information\n---'))).toBeUndefined();
  });
});

describe('parsePeekedBinds', () => {
  it('handles types with parentheses, quoted values, quotes and NULL', () => {
    const binds = parsePeekedBinds(
      lines(`Peeked Binds (identified by position):
--------------------------------------

   1 - :1 (NUMBER): 20
   2 - :2 (VARCHAR2(30), CSID=873): 'O''Brien'
   3 - :3 (NUMBER(10,2)): NULL
   4 - :SYS_B_0 (VARCHAR2(1), CSID=873, CSFRM=1): 'Y'

Predicate Information (identified by operation id):
---------------------------------------------------
   1 - access("A"=:1)`),
    );
    expect(binds).toEqual([
      { name: ':1', type: 'NUMBER', value: '20', position: 1 },
      { name: ':2', type: 'VARCHAR2(30)', value: "O'Brien", position: 2 },
      { name: ':3', type: 'NUMBER(10,2)', value: null, position: 3 },
      { name: ':SYS_B_0', type: 'VARCHAR2(1)', value: 'Y', position: 4 },
    ]);
  });
});

describe('parseHintReport', () => {
  it('reads used hints (no letter), other letters and a summary without problems', () => {
    const report = parseHintReport(
      lines(`Hint Report (identified by operation id / Query Block Name / Object Alias):
Total hints for statement: 2
---------------------------------------------------------------------------

   2 - SEL$1 / T@SEL$1
         -  FULL(t)
         X -  something / odd

Column Projection Information (identified by operation id):
-----------------------------------------------------------
   2 - "T"."A"[NUMBER,22]`),
    );
    expect(report.hints.get(2)).toEqual([
      { text: 'FULL(t)', status: 'used', queryBlock: 'SEL$1', alias: 'T@SEL$1' },
      { text: 'something', status: 'other', code: 'X', reason: 'odd', queryBlock: 'SEL$1', alias: 'T@SEL$1' },
    ]);
    expect(report.summary).toEqual({ total: 2, unused: 0, errors: 0 });
  });
});

describe('Remote SQL and projection sections', () => {
  const text = lines(`Remote SQL Information (identified by operation id):
----------------------------------------------------

   2 - SELECT "EMPNO","ENAME" FROM "EMP" "A2"
       WHERE "DEPTNO"=10 (accessing 'ORCL@LINK' )

Note
-----
   - dynamic statistics used`);

  it('joins wrapped remote SQL and stops at the next section', () => {
    expect(parseRemoteSqlSection(text).get(2)).toBe(
      `SELECT "EMPNO","ENAME" FROM "EMP" "A2" WHERE "DEPTNO"=10 (accessing 'ORCL@LINK' )`,
    );
    expect(parseProjectionSection(text).size).toBe(0);
  });

  it('attaches remote SQL to the operation', () => {
    const plan = parsePlan(`Plan hash value: 1

---------------------------------------
| Id  | Operation         | Name | Rows |
---------------------------------------
|   0 | SELECT STATEMENT  |      |    1 |
|   1 |  NESTED LOOPS     |      |    1 |
|   2 |   REMOTE          | EMP  |    1 |
---------------------------------------

${text.join('\n')}
`);
    expect(node(plan, 2).remoteSql).toContain('FROM "EMP" "A2" WHERE');
    expect(node(plan, 2).remoteSql).not.toContain('dynamic');
  });
});
