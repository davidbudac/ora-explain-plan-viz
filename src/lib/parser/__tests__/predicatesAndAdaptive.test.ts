import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePlan, parsePlans } from '../index';
import { parsePredicateSection, parseQueryBlockSection } from '../predicateSection';
import { computeWorstNodes } from '../../worstNodes';
import { computeHottestNodeId, rankNodesByTime } from '../../analysis';

const fixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf-8');

const ADVANCED = fixture('advanced-allstats-19c.txt');
const ADAPTIVE = fixture('allstats-adaptive-19c.txt');

const node = (plan: ReturnType<typeof parsePlan>, id: number) => {
  const n = plan.allNodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

const section = (body: string): string[] =>
  ['Predicate Information (identified by operation id):', '---------------------------------------------------', '', ...body.split('\n')];

describe('parsePredicateSection', () => {
  it('attaches an Id-less filter line to the preceding id', () => {
    const preds = parsePredicateSection(section(`  15 - access("IO"."OBJ#"="I"."BO#" AND "IO"."TYPE#"=2)
       filter("IO"."TYPE#"=2)
  16 - filter(BITAND("T"."PROPERTY",3)=0)`));
    expect(preds.get(15)).toEqual({
      access: '"IO"."OBJ#"="I"."BO#" AND "IO"."TYPE#"=2',
      filter: '"IO"."TYPE#"=2',
    });
    expect(preds.get(16)).toEqual({ filter: 'BITAND("T"."PROPERTY",3)=0' });
  });

  it('parses Exadata storage predicates, including the Id-less form', () => {
    const preds = parsePredicateSection(section(`   3 - storage("SALES"."AMOUNT">1000)
       filter("SALES"."AMOUNT">1000)
   4 - access("A"=1)
       storage("A"=1)`));
    expect(preds.get(3)).toEqual({ storage: '"SALES"."AMOUNT">1000', filter: '"SALES"."AMOUNT">1000' });
    expect(preds.get(4)).toEqual({ access: '"A"=1', storage: '"A"=1' });
  });

  it('keeps a multi-line predicate whose continuation line ends in an inner ")"', () => {
    const preds = parsePredicateSection(section(`   4 - filter(("A"=1 AND ("B"=2)
              AND "C"=3))
   5 - access("X"=1)`));
    expect(preds.get(4)?.filter).toBe('("A"=1 AND ("B"=2) AND "C"=3)');
    expect(preds.get(5)?.access).toBe('"X"=1');
  });

  it('ignores parentheses inside quoted strings', () => {
    const preds = parsePredicateSection(section(`   2 - filter("NAME"='a)b(' AND "X"=1)
   3 - filter(INSTR("N",')')>0
              AND "Y"="Z")
   4 - access("T"."C"=:B1)`));
    expect(preds.get(2)?.filter).toBe(`"NAME"='a)b(' AND "X"=1`);
    expect(preds.get(3)?.filter).toBe(`INSTR("N",')')>0 AND "Y"="Z"`);
    expect(preds.get(4)?.access).toBe('"T"."C"=:B1');
  });

  it('joins repeated types for one id with AND', () => {
    const preds = parsePredicateSection(section(`   7 - filter("A"=1)
       filter("B"=2)`));
    expect(preds.get(7)?.filter).toBe('"A"=1 AND "B"=2');
  });

  it('stops at the next section', () => {
    const preds = parsePredicateSection([
      ...section('   1 - access("A"=1)'),
      '',
      'Column Projection Information (identified by operation id):',
      '-----------------------------------------------------------',
      '',
      '   1 - "A"[NUMBER,22]',
      '   2 - filter("B"=2)',
    ]);
    expect([...preds.keys()]).toEqual([1]);
  });
});

describe('parseQueryBlockSection', () => {
  it('reads rows after the blank line that follows the dashes and strips quotes', () => {
    const qb = parseQueryBlockSection([
      'Query Block Name / Object Alias (identified by operation id):',
      '-------------------------------------------------------------',
      '',
      '   1 - SEL$1',
      '   2 - SET$1        / O@SEL$1',
      '   3 - "SEL$2"      / "E"@"SEL$2"',
      '',
      'Outline Data',
      '   9 - SEL$9 / X@SEL$9',
    ]);
    expect(qb.get(1)).toEqual({ queryBlock: 'SEL$1', objectAlias: undefined });
    expect(qb.get(2)).toEqual({ queryBlock: 'SET$1', objectAlias: 'O@SEL$1' });
    expect(qb.get(3)).toEqual({ queryBlock: 'SEL$2', objectAlias: 'E@SEL$2' });
    expect(qb.has(9)).toBe(false);
  });

  it('does not mistake the Hint Report header for the section', () => {
    const qb = parseQueryBlockSection([
      'Hint Report (identified by operation id / Query Block Name / Object Alias):',
      '   1 -  SEL$1',
    ]);
    expect(qb.size).toBe(0);
  });
});

describe('real 19c captures: predicates and query blocks', () => {
  const advanced = parsePlan(ADVANCED);

  it('attaches Query Block / Object Alias to nodes', () => {
    expect(node(advanced, 2).queryBlock).toBe('SET$1');
    expect(node(advanced, 2).objectAlias).toBe('O@SEL$1');
    expect(node(advanced, 10).queryBlock).toBe('SEL$E029B2FF');
    expect(node(advanced, 10).objectAlias).toBe('O@SEL$5');
    expect(node(advanced, 3).objectAlias).toBeUndefined();
  });

  it('attaches the Id-less filter line of operation 16 (advanced) and 15/25 (adaptive)', () => {
    expect(node(advanced, 16).accessPredicates).toBe('"IO"."OBJ#"="I"."BO#" AND "IO"."TYPE#"=2');
    expect(node(advanced, 16).filterPredicates).toBe('"IO"."TYPE#"=2');

    const adaptive = parsePlan(ADAPTIVE);
    expect(node(adaptive, 15).filterPredicates).toBe('"IO"."TYPE#"=2');
    expect(node(adaptive, 25).accessPredicates).toContain('"U2"."TYPE#"=2');
    expect(node(adaptive, 25).filterPredicates).toContain('current_edition_id');
  });

  it('joins a wrapped predicate without losing its inner parentheses', () => {
    const filter = node(advanced, 10).filterPredicates ?? '';
    expect(filter.startsWith('("O"."SPARE3"="U"."USER#"')).toBe(true);
    expect(filter.endsWith('BITAND("O"."FLAGS",128)=0)')).toBe(true);
    expect(filter).not.toContain('\n');
  });
});

describe('child number', () => {
  const header = (child: number) => `SQL_ID  7wk3dq0p9xz2c, child number ${child}
-------------------------------------
select * from t where id = :b1`;
  const table = (hash: string, cost: number) => `
Plan hash value: ${hash}

----------------------------------------------------------
| Id  | Operation         | Name | Rows  | Bytes | Cost  |
----------------------------------------------------------
|   0 | SELECT STATEMENT  |      |     1 |     5 |     ${cost} |
|*  1 |  TABLE ACCESS FULL| T    |     1 |     5 |     ${cost} |
----------------------------------------------------------

Predicate Information (identified by operation id):
---------------------------------------------------

   1 - filter("ID"=:B1)
`;

  it('is read from the SQL_ID header', () => {
    const plan = parsePlan(ADVANCED);
    expect(plan.sqlId).toBe('gvujs4tz2rfwx');
    expect(plan.childNumber).toBe(0);
  });

  it('keeps each plan of a two-child paste with its own header data', () => {
    const plans = parsePlans(`${header(0)}\n${table('1111111111', 3)}\n${header(1)}\n${table('2222222222', 9)}`);
    expect(plans).toHaveLength(2);
    expect(plans.map((p) => p.childNumber)).toEqual([0, 1]);
    expect(plans.map((p) => p.sqlId)).toEqual(['7wk3dq0p9xz2c', '7wk3dq0p9xz2c']);
    expect(plans.map((p) => p.planHashValue)).toEqual(['1111111111', '2222222222']);
    expect(plans.map((p) => p.sqlText)).toEqual(['select * from t where id = :b1', 'select * from t where id = :b1']);
    expect(plans.map((p) => p.totalCost)).toEqual([3, 9]);
  });

  it('leaves it undefined without a DISPLAY_CURSOR header', () => {
    expect(parsePlan(table('1111111111', 3)).childNumber).toBeUndefined();
  });
});

describe('adaptive plans', () => {
  const plan = parsePlan(ADAPTIVE);

  it('marks "-" rows inactive, including STATISTICS COLLECTOR', () => {
    expect(plan.allNodes.filter((n) => n.inactive).map((n) => n.id)).toEqual([27, 29, 32]);
    expect(node(plan, 29).operation).toBe('STATISTICS COLLECTOR');
    expect(node(plan, 27).accessPredicates).toBe('"L"."OWNER#"="U"."USER#"');
  });

  it('keeps inactive rows in the tree', () => {
    expect(node(plan, 27).parentId).toBe(3);
    expect(node(plan, 28).parentId).toBe(27);
    expect(node(plan, 30).parentId).toBe(29);
  });

  it('gives inactive nodes no derived self numbers', () => {
    for (const id of [27, 29, 32]) {
      const n = node(plan, id);
      expect(n.selfTime).toBeUndefined();
      expect(n.selfCost).toBeUndefined();
      expect(n.estimatedRowsTotal).toBeUndefined();
    }
    expect(node(plan, 28).selfTime).toBeDefined();
  });

  it('excludes inactive rows from the totals', () => {
    // Inactive row 29 has Starts 1 and 1 A-Row; make an inactive row the largest one.
    const bumped = ADAPTIVE.replace(
      /(\|-\s{3}32 \|[^|]*\|[^|]*\|)\s+0 \|(\s+1 \|)\s+0 \|/,
      '$1   99999 |$2 888888 |',
    );
    expect(bumped).not.toBe(ADAPTIVE);
    const parsed = parsePlan(bumped);
    expect(node(parsed, 32).inactive).toBe(true);
    expect(parsed.maxStarts).toBe(plan.maxStarts);
    expect(parsed.maxActualRows).toBe(plan.maxActualRows);
    expect(parsed.maxRows).toBe(plan.maxRows);
  });

  it('computes self time of UNION-ALL 3 from active work only', () => {
    // 3 = 70 ms; 4 = 60 ms; 28 (active, below inactive 27) = 10 ms.
    expect(node(plan, 3).actualTime).toBe(70);
    expect(node(plan, 3).selfTime).toBe(0);
    expect(node(plan, 4).selfTime).toBe(0);
  });

  it('does not rank or highlight inactive nodes', () => {
    const slow = ADAPTIVE.replace(/(\|-\s{3}29 \|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)00:00:00\.01/, '$100:00:09.99');
    expect(slow).not.toBe(ADAPTIVE);
    const parsed = parsePlan(slow);
    expect(node(parsed, 29).actualTime).toBe(9990);
    expect(rankNodesByTime(parsed).some((n) => n.inactive)).toBe(false);
    expect(computeWorstNodes(parsed).byTime.some((n) => n.inactive)).toBe(false);
    const hottest = computeHottestNodeId(parsed);
    expect(hottest === null || !node(parsed, hottest).inactive).toBe(true);
  });
});

describe('adaptive plans in SQL Monitor text', () => {
  const text = `SQL Plan Monitoring Details (Plan Hash Value=1234567890)
====================================================================================
| Id |       Operation        |  Name  |  Rows   | Cost |   Time    | Start  | Execs |   Rows   |
|    |                        |        | (Estim) |      | Active(s) | Active |       | (Actual) |
====================================================================================
|  0 | SELECT STATEMENT       |        |         |      |         1 |     +0 |     1 |        1 |
|  1 |   HASH JOIN            |        |       1 |   10 |         1 |     +0 |     1 |        1 |
|- 2 |    STATISTICS COLLECTOR|        |         |      |         1 |     +0 |     1 |    99999 |
|  3 |     TABLE ACCESS FULL  | T      |       1 |    5 |         1 |     +0 |     1 |        1 |
====================================================================================
`;

  it('flags inactive rows and keeps them out of maxActualRows', () => {
    const parsed = parsePlan(text);
    expect(parsed.source).toBe('sql_monitor_text');
    const inactive = parsed.allNodes.filter((n) => n.inactive).map((n) => n.id);
    expect(inactive).toEqual([2]);
    expect(parsed.maxActualRows).toBe(1);
  });
});

describe('rows that overflow their column', () => {
  const simple = readFileSync(join(__dirname, '../../../examples/01-dbms_xplan-Simple Plan.txt'), 'utf-8');

  it('reads cells by pipe when the row has the header pipe count but misaligned pipes', () => {
    const plan = parsePlan(simple);
    expect(node(plan, 3).operation).toBe('TABLE ACCESS BY INDEX ROWID');
    expect(node(plan, 3).objectName).toBe('EMPLOYEES');
    expect(node(plan, 5).operation).toBe('TABLE ACCESS BY INDEX ROWID');
    expect(node(plan, 5).objectName).toBe('JOBS');
    expect(node(plan, 3).rows).toBe(5);
    expect(node(plan, 5).cost).toBe(1);
    // Cells after the overflowing one are not shifted either.
    expect(node(plan, 7).objectName).toBe('DEPARTMENTS');
  });

  it('gives overflowing rows the depth they would have had aligned', () => {
    const plan = parsePlan(simple);
    expect(node(plan, 3).depth).toBe(node(plan, 2).depth + 1);
    expect(node(plan, 5).depth).toBe(node(plan, 3).depth);
    expect(node(plan, 4).depth).toBe(node(plan, 3).depth + 1);
    expect(node(plan, 3).parentId).toBe(2);
    expect(node(plan, 4).parentId).toBe(3);
    expect(node(plan, 5).parentId).toBe(2);
    expect(node(plan, 6).parentId).toBe(5);
    expect(node(plan, 7).parentId).toBe(1);
  });

  it('matches the depths of the same plan with the Operation column widened so every row aligns', () => {
    const widened = simple
      .split('\n')
      .map((line) => {
        if (!line.startsWith('|')) return line;
        const cells = line.split('|');
        cells[2] += ' ';
        return cells.join('|');
      })
      .join('\n');
    const aligned = parsePlan(widened);
    expect(node(aligned, 3).operation).toBe('TABLE ACCESS BY INDEX ROWID');
    const depths = (p: ReturnType<typeof parsePlan>) => p.allNodes.map((n) => [n.id, n.depth, n.parentId, n.operation, n.objectName]);
    expect(depths(parsePlan(simple))).toEqual(depths(aligned));
  });

  it('keeps position slicing when the pipe count differs from the header', () => {
    const broken = simple.replace('|   7 |   TABLE ACCESS FULL          | DEPARTMENTS|', '|   7 |   TABLE ACCESS FULL          | DEPARTMENTS');
    expect(broken).not.toBe(simple);
    const plan = parsePlan(broken);
    expect(node(plan, 7).operation).toBe('TABLE ACCESS FULL');
  });

  it('applies to the SQL Monitor text parser too', () => {
    const text = `SQL Plan Monitoring Details (Plan Hash Value=1234567890)
==========================================================================
| Id |       Operation        |  Name  |  Rows   | Cost | Execs | Rows     |
|    |                        |        | (Estim) |      |       | (Actual) |
==========================================================================
|  0 | SELECT STATEMENT       |        |         |      |     1 |        4 |
|  1 |   TABLE ACCESS BY INDEX ROWID| EMPLOYEES |       4 |    2 |     1 |        4 |
==========================================================================
`;
    const plan = parsePlan(text);
    expect(plan.source).toBe('sql_monitor_text');
    expect(node(plan, 1).operation).toBe('TABLE ACCESS BY INDEX ROWID');
    expect(node(plan, 1).objectName).toBe('EMPLOYEES');
    expect(node(plan, 1).actualRows).toBe(4);
    expect(node(plan, 1).parentId).toBe(0);
  });
});
