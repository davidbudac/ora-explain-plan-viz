import { describe, it, expect } from 'vitest';
import { extractPredicateColumns } from '../predicateColumns';

describe('extractPredicateColumns', () => {
  it('returns empty array when input is empty/undefined', () => {
    expect(extractPredicateColumns(undefined)).toEqual([]);
    expect(extractPredicateColumns('')).toEqual([]);
  });

  it('extracts a bare column name from an equality predicate', () => {
    expect(extractPredicateColumns('EMPNO=:1')).toEqual(['EMPNO']);
  });

  it('strips the table alias from T.COL form', () => {
    expect(extractPredicateColumns('"E"."EMPLOYEE_ID"=:1')).toEqual(['EMPLOYEE_ID']);
  });

  it('strips owner.table from OWNER.TABLE.COL form', () => {
    expect(extractPredicateColumns('"HR"."EMPLOYEES"."ID"=:1')).toEqual(['ID']);
  });

  it('extracts both sides of a join predicate', () => {
    const result = extractPredicateColumns('"E"."DEPT_ID"="D"."ID"');
    expect(result).toContain('DEPT_ID');
    expect(result).toContain('ID');
  });

  it('extracts columns from a function-wrapped predicate', () => {
    expect(extractPredicateColumns('UPPER("E"."NAME")=:1')).toEqual(['NAME']);
  });

  it('deduplicates columns referenced multiple times', () => {
    const result = extractPredicateColumns('"E"."ID"=:1 AND "E"."ID"<>:2');
    expect(result).toEqual(['ID']);
  });

  it('ignores SQL keywords/numeric literals/binds', () => {
    const result = extractPredicateColumns(
      '"E"."SALARY">5000 AND "E"."HIRE_DATE" IS NOT NULL AND "E"."ID"=:1',
    );
    expect(result.sort()).toEqual(['HIRE_DATE', 'ID', 'SALARY']);
  });

  it('combines access and filter predicate strings', () => {
    const result = extractPredicateColumns('"E"."DEPT_ID"=:1', '"E"."SALARY">5000');
    expect(result.sort()).toEqual(['DEPT_ID', 'SALARY']);
  });
});

describe('extractPredicateColumns: only real column references', () => {
  it('ignores string literals, date format masks and named binds', () => {
    expect(extractPredicateColumns(
      `"E"."STATUS"='ACTIVE' AND "E"."HIRED">TO_DATE(' 2024-01-01 00:00:00', 'syyyy-mm-dd hh24:mi:ss') AND "E"."DEPT_ID"=:B1`,
    )).toEqual(['STATUS', 'HIRED', 'DEPT_ID']);
    expect(extractPredicateColumns('"U"."NAME"=:B2')).toEqual(['NAME']);
    expect(extractPredicateColumns('"T"."C"=:SYS_B_0')).toEqual(['C']);
    expect(extractPredicateColumns('"E"."DEPARTMENT_ID"=:dept_id')).toEqual(['DEPARTMENT_ID']);
  });

  it('ignores function names, also ones that are not on a keyword list', () => {
    expect(extractPredicateColumns('BITAND("O"."FLAGS",128)=0')).toEqual(['FLAGS']);
    expect(extractPredicateColumns(
      `"U2"."TYPE#"=2 AND "U2"."SPARE2"=TO_NUMBER(SYS_CONTEXT('userenv','current_edition_id'))`,
    )).toEqual(['TYPE#', 'SPARE2']);
    expect(extractPredicateColumns('"SCOTT"."F"("T"."ID")=1')).toEqual(['ID']);
  });

  it('reads a real 19c dictionary predicate (advanced-allstats-19c.txt, operation 10)', () => {
    expect(extractPredicateColumns(
      `("O"."SPARE3"="U"."USER#" AND "O"."OBJ#">:B1 AND "O"."NAME"<>'_NEXT_OBJECT' AND "O"."NAME"<>'_default_auditing_options_' AND "O"."TYPE#"<>10 AND "O"."LINKNAME" IS NULL AND BITAND("O"."FLAGS",128)=0)`,
    )).toEqual(['SPARE3', 'USER#', 'OBJ#', 'NAME', 'TYPE#', 'LINKNAME', 'FLAGS']);
  });

  it('is not confused by quotes inside a literal', () => {
    expect(extractPredicateColumns(`"O"."NAME"='it''s "QUOTED"'`)).toEqual(['NAME']);
  });

  it('takes only the quoted references when a predicate has any (analytic-clause keywords are not columns)', () => {
    expect(extractPredicateColumns(
      'ROW_NUMBER() OVER ( PARTITION BY "T"."A" ORDER BY "T"."B" DESC NULLS LAST)<=5',
    )).toEqual(['A', 'B']);
  });

  it('still reads a hand-written predicate without quoted identifiers', () => {
    expect(extractPredicateColumns(`status = 'OPEN' and upper(name) like :b1`)).toEqual(['STATUS', 'NAME']);
    expect(extractPredicateColumns('e.sal > 1000 and e.deptno in (10, 20)')).toEqual(['SAL', 'DEPTNO']);
  });
});
