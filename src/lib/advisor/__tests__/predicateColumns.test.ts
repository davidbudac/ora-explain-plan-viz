import { describe, it, expect } from 'vitest';
import { extractQuotedColumns, findFunctionWrappedColumns } from '../predicates';

describe('extractQuotedColumns', () => {
  it('returns alias-qualified and bare quoted columns, skipping binds, literals and functions', () => {
    expect(extractQuotedColumns('"E"."SAL">:B1 AND UPPER("ENAME")=\'A"B"C\' AND "E"."SAL"<10')).toEqual([
      { alias: 'E', column: 'SAL' },
      { column: 'ENAME' },
    ]);
  });

  it('merges several predicates and returns nothing for empty input', () => {
    expect(extractQuotedColumns('"A"."X"=1', undefined, '"A"."Y"=2').map((c) => c.column)).toEqual(['X', 'Y']);
    expect(extractQuotedColumns(undefined)).toEqual([]);
  });
});

describe('findFunctionWrappedColumns', () => {
  it('finds a column that is the first argument of a function', () => {
    const hits = findFunctionWrappedColumns(undefined, 'UPPER("E"."ENAME")=\'X\' AND NVL("E"."SAL",0)>1');
    expect(hits.map((h) => `${h.fn}:${h.alias}.${h.column}:${h.source}`)).toEqual(['UPPER:E.ENAME:filter', 'NVL:E.SAL:filter']);
    expect(hits[1].fragment).toBe('NVL("E"."SAL", …)');
  });

  it('ignores columns that are not the first argument and function-looking text in literals', () => {
    expect(findFunctionWrappedColumns(undefined, '"E"."A"=NVL(:B1,"E"."B")')).toEqual([]);
    expect(findFunctionWrappedColumns(undefined, '"E"."A"=\'UPPER("E"."A")\'')).toEqual([]);
  });
});
