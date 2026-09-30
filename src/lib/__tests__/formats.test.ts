import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SUPPORTED_FORMATS,
  SUPPORTED_FORMATS_SENTENCE,
  PARSE_FAILED_MESSAGE,
  INPUT_PLACEHOLDER,
  describeParseFailure,
  looksLikePlan,
} from '../formats';

function readExample(filename: string): string {
  return readFileSync(join(__dirname, '../../examples', filename), 'utf-8');
}

describe('supported formats list', () => {
  it('covers every parser plus metadata bundles', () => {
    const ids = SUPPORTED_FORMATS.map((f) => f.id);
    expect(ids).toEqual(['dbms_xplan', 'sql_monitor_text', 'sql_monitor_xml', 'json', 'xbi', 'metadata_bundle']);
    for (const format of SUPPORTED_FORMATS) {
      expect(format.name).toBeTruthy();
      expect(format.hint).toBeTruthy();
    }
  });

  it('uses the same list in the placeholder and the error message', () => {
    for (const format of SUPPORTED_FORMATS) {
      expect(INPUT_PLACEHOLDER).toContain(format.name);
    }
    expect(PARSE_FAILED_MESSAGE).toContain(SUPPORTED_FORMATS_SENTENCE);
    expect(SUPPORTED_FORMATS_SENTENCE).toMatch(/xbi\.sql/);
    expect(SUPPORTED_FORMATS_SENTENCE).toMatch(/metadata bundles/);
  });
});

describe('describeParseFailure', () => {
  it('says which format was recognised when no operations were found', () => {
    const xmlWithoutPlan = '<?xml version="1.0"?><report><sql_monitor_report></sql_monitor_report></report>';
    expect(describeParseFailure(xmlWithoutPlan)).toMatch(/^Looks like SQL Monitor XML but no plan operations were found/);

    const truncatedXplan = 'Plan hash value: 1\n| Id | Operation | Name |\n';
    expect(describeParseFailure(truncatedXplan)).toMatch(/^Looks like DBMS_XPLAN output but no plan operations/);
  });

  it('falls back to the supported-formats message for unrecognised text', () => {
    expect(describeParseFailure('hello world')).toBe(PARSE_FAILED_MESSAGE);
  });
});

describe('looksLikePlan', () => {
  it('recognises real plans in every example format', () => {
    expect(looksLikePlan(readExample('01-dbms_xplan-Simple Plan.txt'))).toBe(true);
    expect(looksLikePlan(readExample('12-json-JSON Plan (TPC-DS Hash Joins).txt'))).toBe(true);
    expect(looksLikePlan(readExample('13-xbi-XBI TPC-DS Query.txt'))).toBe(true);
    expect(looksLikePlan(readExample('22-sql_monitor-Cardinality Trap (NL).txt'))).toBe(true);
  });

  it('rejects prose, empty text and metadata bundles', () => {
    expect(looksLikePlan('')).toBe(false);
    expect(looksLikePlan('select * from dual')).toBe(false);
    expect(looksLikePlan('{"format": "ora-plan-metadata", "version": 2}')).toBe(false);
  });
});
