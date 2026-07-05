import { describe, expect, it } from 'vitest';
import { parseNoteSection } from '../noteSection';

function lines(text: string): string[] {
  return text.split('\n');
}

describe('parseNoteSection', () => {
  it('returns undefined when there is no Note block', () => {
    const input = lines(`
Plan hash value: 123

--------------------------------
| Id | Operation        | Name |
--------------------------------
|  0 | SELECT STATEMENT |      |
--------------------------------
`);
    expect(parseNoteSection(input)).toBeUndefined();
  });

  it('recognizes dynamic sampling and extracts the level', () => {
    const input = lines(`
Note
-----
   - dynamic statistics used: dynamic sampling (level=4)
`);
    const notes = parseNoteSection(input);
    expect(notes?.dynamicSampling).toBe(true);
    expect(notes?.dynamicSamplingLevel).toBe(4);
  });

  it('recognizes dynamic sampling phrased as "dynamic sampling used"', () => {
    const input = lines(`
Note
-----
   - dynamic sampling used for this statement
`);
    const notes = parseNoteSection(input);
    expect(notes?.dynamicSampling).toBe(true);
    expect(notes?.dynamicSamplingLevel).toBeUndefined();
  });

  it('recognizes SQL plan directives used', () => {
    const input = lines(`
Note
-----
   - SQL plan directive used for this statement
`);
    expect(parseNoteSection(input)?.planDirectives).toBe(true);
  });

  it('recognizes cardinality feedback used', () => {
    const input = lines(`
Note
-----
   - cardinality feedback used for this statement
`);
    expect(parseNoteSection(input)?.cardinalityFeedback).toBe(true);
  });

  it('recognizes statistics feedback used', () => {
    const input = lines(`
Note
-----
   - statistics feedback used for this statement
`);
    expect(parseNoteSection(input)?.statisticsFeedback).toBe(true);
  });

  it('recognizes adaptive plan marker', () => {
    const input = lines(`
Note
-----
   - this is an adaptive plan (rows marked '-' are inactive)
`);
    expect(parseNoteSection(input)?.adaptivePlan).toBe(true);
  });

  it('extracts a quoted SQL profile name', () => {
    const input = lines(`
Note
-----
   - SQL profile "SYS_SQLPROF_0123456789abcdef" used for this statement
`);
    expect(parseNoteSection(input)?.sqlProfile).toBe('SYS_SQLPROF_0123456789abcdef');
  });

  it('extracts a quoted SQL plan baseline name', () => {
    const input = lines(`
Note
-----
   - SQL plan baseline "SQL_PLAN_abc123def456" used for this statement
`);
    expect(parseNoteSection(input)?.sqlPlanBaseline).toBe('SQL_PLAN_abc123def456');
  });

  it('extracts a quoted outline name', () => {
    const input = lines(`
Note
-----
   - outline "SYS_OUTLINE_001" used for this statement
`);
    expect(parseNoteSection(input)?.outline).toBe('SYS_OUTLINE_001');
  });

  it('recognizes multiple flags within one Note block', () => {
    const input = lines(`
Note
-----
   - dynamic statistics used: dynamic sampling (level=2)
   - this is an adaptive plan
   - cardinality feedback used for this statement
`);
    const notes = parseNoteSection(input);
    expect(notes?.dynamicSampling).toBe(true);
    expect(notes?.dynamicSamplingLevel).toBe(2);
    expect(notes?.adaptivePlan).toBe(true);
    expect(notes?.cardinalityFeedback).toBe(true);
    expect(notes?.rawLines).toHaveLength(3);
  });

  it('preserves unrecognized note lines in rawLines', () => {
    const input = lines(`
Note
-----
   - some completely unrecognized note text
`);
    const notes = parseNoteSection(input);
    expect(notes?.rawLines).toEqual(['some completely unrecognized note text']);
    expect(notes?.dynamicSampling).toBeUndefined();
  });

  it('is case-insensitive when matching the "Note" header', () => {
    const input = lines(`
note
-----
   - this is an adaptive plan
`);
    expect(parseNoteSection(input)?.adaptivePlan).toBe(true);
  });
});
