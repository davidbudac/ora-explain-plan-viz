import { describe, it, expect } from 'vitest';
import { findImplicitConversions } from '../predicates';

describe('findImplicitConversions', () => {
  it('flags INTERNAL_FUNCTION wrapping a column', () => {
    const hits = findImplicitConversions('INTERNAL_FUNCTION("T"."COL")=:1');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fn: 'INTERNAL_FUNCTION', column: 'COL', source: 'access' });
  });

  it('flags TO_NUMBER wrapping a quoted column', () => {
    const hits = findImplicitConversions(undefined, 'TO_NUMBER("T"."COL")=:1');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fn: 'TO_NUMBER', column: 'COL', source: 'filter' });
  });

  it('does not flag TO_DATE with a literal first argument', () => {
    const hits = findImplicitConversions(undefined, "TO_DATE('2024-01-01','YYYY-MM-DD')=:1");
    expect(hits).toHaveLength(0);
  });

  it('does not flag TO_NUMBER on a bind variable', () => {
    const hits = findImplicitConversions('TO_NUMBER(:B1)=:2');
    expect(hits).toHaveLength(0);
  });

  it('flags TO_CHAR wrapping a qualified column', () => {
    const hits = findImplicitConversions('TO_CHAR("E"."HIRE_DATE",\'YYYY\')=:1');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ fn: 'TO_CHAR', column: 'HIRE_DATE' });
  });

  it('attributes hits to access vs filter source independently', () => {
    const hits = findImplicitConversions('INTERNAL_FUNCTION("A"."X")=:1', 'TO_NUMBER("B"."Y")=:2');
    expect(hits).toHaveLength(2);
    expect(hits.find((h) => h.column === 'X')?.source).toBe('access');
    expect(hits.find((h) => h.column === 'Y')?.source).toBe('filter');
  });

  it('strips owner.table qualifiers from the column name', () => {
    const hits = findImplicitConversions('INTERNAL_FUNCTION("HR"."EMPLOYEES"."ID")=:1');
    expect(hits[0].column).toBe('ID');
  });

  it('returns empty array when no predicates provided', () => {
    expect(findImplicitConversions()).toEqual([]);
  });

  it('captures the matched fragment text', () => {
    const hits = findImplicitConversions('INTERNAL_FUNCTION("T"."COL")=:1');
    expect(hits[0].fragment).toBe('INTERNAL_FUNCTION("T"."COL")');
  });

  describe('INTERNAL_FUNCTION context', () => {
    it('ignores a DESC sort key inside an analytic clause', () => {
      const predicate =
        'ROW_NUMBER() OVER ( PARTITION BY "S"."CUSTOMER_ID" ORDER BY INTERNAL_FUNCTION("S"."SALE_DATE") DESC )<=3';
      expect(findImplicitConversions(undefined, predicate)).toEqual([]);
    });

    it('ignores INTERNAL_FUNCTION immediately followed by ASC/DESC', () => {
      expect(findImplicitConversions(undefined, 'INTERNAL_FUNCTION("T"."D") ASC')).toEqual([]);
      expect(findImplicitConversions(undefined, 'X(INTERNAL_FUNCTION("T"."D")  DESC)')).toEqual([]);
    });

    it('ignores a standalone boolean term (IN-list representation)', () => {
      const predicate = '(("O"."TYPE#"=13 AND "O"."SUBNAME" IS NULL) OR INTERNAL_FUNCTION("O"."TYPE#"))';
      expect(findImplicitConversions(undefined, predicate)).toEqual([]);
    });

    it('still flags comparison operands on either side of the operator', () => {
      expect(findImplicitConversions('INTERNAL_FUNCTION("S"."SALE_DATE")>=:B1')).toHaveLength(1);
      expect(findImplicitConversions('INTERNAL_FUNCTION("S"."SALE_DATE")<>:B1')).toHaveLength(1);
      expect(findImplicitConversions('INTERNAL_FUNCTION("S"."SALE_DATE")!=:B1')).toHaveLength(1);
      expect(findImplicitConversions(':B1<=INTERNAL_FUNCTION("S"."SALE_DATE")')).toHaveLength(1);
      expect(findImplicitConversions('INTERNAL_FUNCTION("S"."NAME") LIKE :B1')).toHaveLength(1);
      expect(findImplicitConversions('INTERNAL_FUNCTION("S"."D") BETWEEN :B1 AND :B2')).toHaveLength(1);
    });

    it('still flags TO_NUMBER on a column', () => {
      expect(findImplicitConversions(undefined, 'TO_NUMBER("REF_CODE")=12345')).toHaveLength(1);
    });

    it('flags a real conversion next to an analytic sort key', () => {
      const predicate = 'INTERNAL_FUNCTION("S"."A")=:1 AND ROW_NUMBER() OVER ( ORDER BY INTERNAL_FUNCTION("S"."B") DESC )<=3';
      const hits = findImplicitConversions(undefined, predicate);
      expect(hits).toHaveLength(1);
      expect(hits[0].column).toBe('A');
    });

    it('is not fooled by parentheses or OVER inside a string literal', () => {
      expect(findImplicitConversions(undefined, `"X"='OVER (' AND INTERNAL_FUNCTION("S"."A")=:1`)).toHaveLength(1);
    });
  });
});
