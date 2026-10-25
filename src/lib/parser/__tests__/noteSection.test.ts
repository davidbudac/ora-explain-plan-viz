import { describe, expect, it } from 'vitest';
import { parseNoteSection } from '../noteSection';
import type { PlanNotes } from '../noteSection';

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

  it.each<[string, string, Partial<PlanNotes>]>([
    ['recognizes dynamic sampling and extracts the level', 'dynamic statistics used: dynamic sampling (level=4)', { dynamicSampling: true, dynamicSamplingLevel: 4 }],
    ['recognizes dynamic sampling phrased as "dynamic sampling used"', 'dynamic sampling used for this statement', { dynamicSampling: true, dynamicSamplingLevel: undefined }],
    ['recognizes SQL plan directives used', 'SQL plan directive used for this statement', { planDirectives: true }],
    ['recognizes cardinality feedback used', 'cardinality feedback used for this statement', { cardinalityFeedback: true }],
    ['recognizes statistics feedback used', 'statistics feedback used for this statement', { statisticsFeedback: true }],
    ['recognizes adaptive plan marker', "this is an adaptive plan (rows marked '-' are inactive)", { adaptivePlan: true }],
    ['extracts a quoted SQL profile name', 'SQL profile "SYS_SQLPROF_0123456789abcdef" used for this statement', { sqlProfile: 'SYS_SQLPROF_0123456789abcdef' }],
    ['extracts a quoted SQL plan baseline name', 'SQL plan baseline "SQL_PLAN_abc123def456" used for this statement', { sqlPlanBaseline: 'SQL_PLAN_abc123def456' }],
    ['extracts a quoted outline name', 'outline "SYS_OUTLINE_001" used for this statement', { outline: 'SYS_OUTLINE_001' }],
  ])('%s', (_name, note, expected) => {
    const notes = parseNoteSection(lines(`
Note
-----
   - ${note}
`));
    expect(notes).toBeDefined();
    for (const key of Object.keys(expected) as (keyof PlanNotes)[]) {
      expect(notes?.[key], key).toBe(expected[key]);
    }
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
