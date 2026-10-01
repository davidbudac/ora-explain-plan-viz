import { describe, expect, it } from 'vitest';
import { formatHintSummary, outlineHintBlock } from '../outlineHints';

describe('outlineHints helpers', () => {
  it('wraps hints in a ready-to-paste hint comment', () => {
    expect(outlineHintBlock(['FULL(@"SEL$1" "T"@"SEL$1")', 'ALL_ROWS'])).toBe(
      '/*+\n  FULL(@"SEL$1" "T"@"SEL$1")\n  ALL_ROWS\n*/',
    );
  });

  it('words the hint report totals', () => {
    expect(formatHintSummary({ total: 3, unused: 1, errors: 2 })).toBe('Hint report: 3 hints (1 unused, 2 syntax errors)');
    expect(formatHintSummary({ total: 1, unused: 0, errors: 1 })).toBe('Hint report: 1 hint (1 syntax error)');
    expect(formatHintSummary({ total: 2, unused: 0, errors: 0 })).toBe('Hint report: 2 hints, all used');
  });
});
