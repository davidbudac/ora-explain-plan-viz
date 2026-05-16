import { describe, it, expect } from 'vitest';
import { parseManualObjectList, formatManualListArg } from '../manualList';

describe('parseManualObjectList', () => {
  it('parses comma-separated OWNER.OBJECT', () => {
    const { items, errors } = parseManualObjectList('HR.EMPLOYEES, HR.DEPARTMENTS');
    expect(errors).toEqual([]);
    expect(items).toEqual([
      { owner: 'HR', name: 'EMPLOYEES' },
      { owner: 'HR', name: 'DEPARTMENTS' },
    ]);
  });

  it('parses newline-separated entries', () => {
    const { items, errors } = parseManualObjectList('HR.EMPLOYEES\nSCOTT.EMP\n');
    expect(errors).toEqual([]);
    expect(items).toHaveLength(2);
  });

  it('upper-cases unquoted identifiers', () => {
    const { items } = parseManualObjectList('hr.employees');
    expect(items[0]).toEqual({ owner: 'HR', name: 'EMPLOYEES' });
  });

  it('preserves case for double-quoted identifiers', () => {
    const { items } = parseManualObjectList('"hr"."Employees"');
    expect(items[0]).toEqual({ owner: 'hr', name: 'Employees' });
  });

  it('rejects entries without a dot', () => {
    const { items, errors } = parseManualObjectList('EMPLOYEES');
    expect(items).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('OWNER.OBJECT');
  });

  it('rejects entries with empty owner or name', () => {
    const { items, errors } = parseManualObjectList('.EMPLOYEES, HR.');
    expect(items).toEqual([]);
    expect(errors).toHaveLength(2);
  });

  it('rejects invalid identifier characters', () => {
    const { items, errors } = parseManualObjectList('HR.EMP LOYEES');
    expect(items).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  it('deduplicates exact repeats', () => {
    const { items } = parseManualObjectList('HR.EMP,HR.EMP,hr.emp');
    expect(items).toHaveLength(1);
  });

  it('returns empty on blank input', () => {
    expect(parseManualObjectList('')).toEqual({ items: [], errors: [] });
    expect(parseManualObjectList('   \n  ')).toEqual({ items: [], errors: [] });
  });
});

describe('formatManualListArg', () => {
  it('joins as comma-separated OWNER.OBJECT', () => {
    const arg = formatManualListArg([
      { owner: 'HR', name: 'EMPLOYEES' },
      { owner: 'HR', name: 'DEPARTMENTS' },
    ]);
    expect(arg).toBe('HR.EMPLOYEES,HR.DEPARTMENTS');
  });

  it('returns empty string for empty list', () => {
    expect(formatManualListArg([])).toBe('');
  });
});
