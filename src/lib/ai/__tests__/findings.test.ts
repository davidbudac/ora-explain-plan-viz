import { describe, expect, it } from 'vitest';
import { parseAiFindings, splitReport } from '../findings';

const VALID_IDS = new Set([0, 1, 2, 3]);

const REPORT = `## Summary
The full scan on line 2 dominates.

\`\`\`json
{"findings":[
  {"severity":"critical","title":"Full scan","explanation":"Line 2 reads everything.","suggestion":"Add an index.","nodeIds":[2]},
  {"severity":"warning","title":"Skew","explanation":"Underestimate.","nodeIds":[3,99]},
  {"severity":"nonsense","title":"Odd","explanation":"Bad severity clamps to info."}
]}
\`\`\``;

describe('splitReport', () => {
  it('separates narrative from the trailing json block', () => {
    const { narrative, jsonBlock, partialFence } = splitReport(REPORT);
    expect(narrative).toContain('## Summary');
    expect(narrative).not.toContain('```json');
    expect(jsonBlock).toContain('"findings"');
    expect(partialFence).toBe(false);
  });

  it('hides a half-received json block during streaming', () => {
    const streaming = '## Summary\nText.\n\n```json\n{"findings":[{"sev';
    const { narrative, jsonBlock, partialFence } = splitReport(streaming);
    expect(narrative).toBe('## Summary\nText.');
    expect(jsonBlock).toBeNull();
    expect(partialFence).toBe(true);
  });

  it('hides a partially streamed opening fence at the end of the buffer', () => {
    const { narrative, partialFence } = splitReport('Text.\n``');
    expect(narrative).toBe('Text.\n');
    expect(partialFence).toBe(true);
  });

  it('leaves reports without a fence untouched', () => {
    const { narrative, jsonBlock, partialFence } = splitReport('Just prose.');
    expect(narrative).toBe('Just prose.');
    expect(jsonBlock).toBeNull();
    expect(partialFence).toBe(false);
  });

  it('uses the LAST json fence when earlier ones appear in the narrative', () => {
    const report = '```json\n{"example":1}\n```\nProse.\n```json\n{"findings":[]}\n```';
    expect(splitReport(report).jsonBlock).toContain('"findings"');
  });
});

describe('parseAiFindings', () => {
  it('parses valid findings, clamps severity, and filters invented nodeIds', () => {
    const findings = parseAiFindings(REPORT, VALID_IDS);
    expect(findings).not.toBeNull();
    expect(findings).toHaveLength(3);
    expect(findings![0]).toEqual({
      severity: 'critical',
      title: 'Full scan',
      explanation: 'Line 2 reads everything.',
      suggestion: 'Add an index.',
      nodeIds: [2],
    });
    // Invented nodeId 99 filtered out; missing suggestion is undefined.
    expect(findings![1].nodeIds).toEqual([3]);
    expect(findings![1].suggestion).toBeUndefined();
    // Unknown severity clamps to info; missing nodeIds default to [].
    expect(findings![2].severity).toBe('info');
    expect(findings![2].nodeIds).toEqual([]);
  });

  it('returns null for garbled JSON', () => {
    expect(parseAiFindings('Text\n```json\n{"findings": [oops\n```', VALID_IDS)).toBeNull();
  });

  it('returns null when the block has the wrong shape', () => {
    expect(parseAiFindings('```json\n{"other": 1}\n```', VALID_IDS)).toBeNull();
    expect(parseAiFindings('```json\n[1,2]\n```', VALID_IDS)).toBeNull();
  });

  it('returns null when no block is present or it is still streaming', () => {
    expect(parseAiFindings('Only prose.', VALID_IDS)).toBeNull();
    expect(parseAiFindings('Prose\n```json\n{"findings"', VALID_IDS)).toBeNull();
  });

  it('skips entries missing required fields but keeps the rest', () => {
    const report = '```json\n{"findings":[{"title":"No explanation"},{"severity":"info","title":"Ok","explanation":"Fine."}]}\n```';
    const findings = parseAiFindings(report, VALID_IDS);
    expect(findings).toHaveLength(1);
    expect(findings![0].title).toBe('Ok');
  });
});
