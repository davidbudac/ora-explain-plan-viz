import { describe, it, expect } from 'vitest';
import { classifyDroppedFile, findCoverageWarning } from '../dropClassify';
import type { MetadataBundle } from '../bundle';

describe('classifyDroppedFile', () => {
  it('returns plan for files without .json extension', () => {
    const out = classifyDroppedFile('plan.txt', '| 0 | SELECT STATEMENT |');
    expect(out.kind).toBe('plan');
  });

  it('returns error for .json files that fail JSON.parse', () => {
    const out = classifyDroppedFile('bundle.json', '{not really json');
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.message).toMatch(/not valid JSON/i);
    }
  });

  it('returns bundle for JSON with format: ora-plan-metadata', () => {
    const text = JSON.stringify({ format: 'ora-plan-metadata', version: 1, objects: {} });
    const out = classifyDroppedFile('bundle.json', text);
    expect(out.kind).toBe('bundle');
  });

  it('returns plan for JSON arrays that look like V$SQL_PLAN dumps', () => {
    const text = JSON.stringify([{ id: 0, operation: 'SELECT STATEMENT' }]);
    const out = classifyDroppedFile('plan.json', text);
    expect(out.kind).toBe('plan');
  });

  it('returns error for unrecognized JSON object', () => {
    const text = JSON.stringify({ foo: 'bar' });
    const out = classifyDroppedFile('weird.json', text);
    expect(out.kind).toBe('error');
    if (out.kind === 'error') {
      expect(out.message).toMatch(/not a recognized format|not a recognised format|neither/i);
    }
  });

  it('returns error for empty JSON array', () => {
    const out = classifyDroppedFile('empty.json', '[]');
    expect(out.kind).toBe('error');
  });
});

describe('findCoverageWarning', () => {
  function makeBundle(coverage: Array<{ object: string; reason: string }>): MetadataBundle {
    return {
      format: 'ora-plan-metadata',
      version: 1,
      captured_at: '2026-01-01T00:00:00Z',
      source: { db_name: 'X', oracle_version: '19.0', container_name: 'C' },
      plan_ref: { sql_id: null, plan_hash_value: null },
      objects: {},
      coverage_warnings: coverage,
    };
  }

  it('returns null when object name is undefined', () => {
    const bundle = makeBundle([{ object: 'HR.X', reason: 'r' }]);
    expect(findCoverageWarning(bundle, undefined)).toBeNull();
  });

  it('finds an exact owner.name match', () => {
    const bundle = makeBundle([{ object: 'SH.SALES', reason: 'no privs' }]);
    const out = findCoverageWarning(bundle, 'SH.SALES');
    expect(out).toEqual({ object: 'SH.SALES', reason: 'no privs' });
  });

  it('falls back to suffix match for bare names', () => {
    const bundle = makeBundle([{ object: 'SH.SALES', reason: 'no privs' }]);
    const out = findCoverageWarning(bundle, 'SALES');
    expect(out).toEqual({ object: 'SH.SALES', reason: 'no privs' });
  });

  it('returns null when no warning matches', () => {
    const bundle = makeBundle([{ object: 'SH.SALES', reason: 'no privs' }]);
    expect(findCoverageWarning(bundle, 'EMPLOYEES')).toBeNull();
  });
});
