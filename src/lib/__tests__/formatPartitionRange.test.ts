import { describe, it, expect } from 'vitest';
import { formatPartitionRange } from '../format';

describe('formatPartitionRange', () => {
  it('formats a start/stop pair as a range', () => {
    expect(formatPartitionRange('15', '20')).toBe('15–20');
  });

  it('collapses to a single value when start === stop', () => {
    expect(formatPartitionRange('9', '9')).toBe('9');
  });

  it('returns undefined when neither bound is present', () => {
    expect(formatPartitionRange(undefined, undefined)).toBeUndefined();
    expect(formatPartitionRange('', '   ')).toBeUndefined();
  });

  it('falls back to whichever single bound is present', () => {
    expect(formatPartitionRange('3', undefined)).toBe('3');
    expect(formatPartitionRange(undefined, '7')).toBe('7');
  });

  it('passes through non-numeric pruning markers (KEY, :BFnnnn)', () => {
    expect(formatPartitionRange('KEY', 'KEY')).toBe('KEY');
    expect(formatPartitionRange('1', ':BF0000')).toBe('1–:BF0000');
  });
});
