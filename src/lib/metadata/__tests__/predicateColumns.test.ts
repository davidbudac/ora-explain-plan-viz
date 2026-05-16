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
