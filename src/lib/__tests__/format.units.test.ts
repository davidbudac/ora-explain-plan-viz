import { describe, expect, it } from 'vitest';
import {
  formatBytes,
  formatEstimatedRows,
  formatNumberShort,
  formatTimeCompact,
  formatTimeDetailed,
  formatTimeShort,
} from '../format';
import { formatThreshold } from '../filterThresholds';
import type { PlanNode } from '../types';

describe('formatNumberShort', () => {
  it.each([
    [0, '0'],
    [7, '7'],
    [999, '999'],
    [999.5, '999.5'],
    [1000, '1.0K'],
    [1500, '1.5K'],
    [999_949, '999.9K'],
    [999_950, '1.0M'],
    [999_999, '1.0M'],
    [1_000_000, '1.0M'],
    [1_500_000, '1.5M'],
    [999_949_999, '999.9M'],
    [999_950_000, '1.0G'],
    [1e9, '1.0G'],
    [12_345_678_901, '12.3G'],
    [999_950_000_000, '1.0T'],
    [1e12, '1.0T'],
    [5e15, '5000.0T'],
    [-5, '-5'],
  ])('%d → %s', (value, text) => {
    expect(formatNumberShort(value)).toBe(text);
  });

  it('has no text for values that are not numbers', () => {
    expect(formatNumberShort(undefined)).toBeUndefined();
    expect(formatNumberShort(NaN)).toBeUndefined();
    expect(formatNumberShort(-Infinity)).toBeUndefined();
    expect(formatNumberShort(NaN, { empty: '—' })).toBe('—');
    expect(formatNumberShort(Infinity)).toBe('∞');
    expect(formatNumberShort(Infinity, { infinity: 'inf' })).toBe('inf');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1_048_575, '1.0 MB'],
    [1_048_576, '1.0 MB'],
    [1_073_741_823, '1.0 GB'],
    [1_073_741_824, '1.0 GB'],
    [1_099_511_627_775, '1.0 TB'],
    [1_099_511_627_776, '1.0 TB'],
    [5_497_558_138_880, '5.0 TB'],
  ])('%d → %s', (value, text) => {
    expect(formatBytes(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatBytes(NaN)).toBeUndefined();
    expect(formatBytes(NaN, { empty: '' })).toBe('');
    expect(formatBytes(Infinity)).toBe('∞');
  });
});

describe('formatTimeCompact (milliseconds)', () => {
  it.each([
    [0, '0ms'],
    [5, '5ms'],
    [999.4, '999ms'],
    [999.5, '1.00s'],
    [999.6, '1.00s'],
    [1000, '1.00s'],
    [1500, '1.50s'],
    [59_994, '59.99s'],
    [59_999, '1m 0.0s'],
    [60_000, '1m 0.0s'],
    [61_500, '1m 1.5s'],
    [119_940, '1m 59.9s'],
    [119_960, '2m 0.0s'],
    [3_599_940, '59m 59.9s'],
    [3_599_960, '1h 0m'],
    [3_600_000, '1h 0m'],
    [5_400_000, '1h 30m'],
    [7_200_000, '2h 0m'],
    [86_400_000, '24h 0m'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeCompact(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeCompact(NaN)).toBeUndefined();
    expect(formatTimeCompact(Infinity)).toBe('∞');
  });
});

describe('formatTimeShort (milliseconds)', () => {
  it.each([
    [0, '0ms'],
    [5, '5ms'],
    [999.6, '1.00s'],
    [1000, '1.00s'],
    [59_994, '59.99s'],
    [59_999, '1.0m'],
    [60_000, '1.0m'],
    [90_000, '1.5m'],
    [3_596_999, '59.9m'],
    [3_597_000, '1.0h'],
    [3_600_000, '1.0h'],
    [7_200_000, '2.0h'],
    [90_000_000, '25.0h'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeShort(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeShort(NaN)).toBeUndefined();
  });
});

describe('formatTimeDetailed (milliseconds)', () => {
  it.each([
    [0, '0us'],
    [0.5, '500us'],
    [0.9994, '999us'],
    [0.9996, '1.0ms'],
    [1, '1.0ms'],
    [12.34, '12.3ms'],
    [999.94, '999.9ms'],
    [999.96, '1.00s'],
    [1000, '1.00s'],
    [59_994, '59.99s'],
    [59_999, '1m 0.0s'],
    [60_000, '1m 0.0s'],
    [119_960, '2m 0.0s'],
    [3_599_960, '1h 0m 0s'],
    [3_600_000, '1h 0m 0s'],
    [3_723_400, '1h 2m 3s'],
    [7_200_000, '2h 0m 0s'],
  ])('%d → %s', (value, text) => {
    expect(formatTimeDetailed(value)).toBe(text);
  });

  it('has no text for NaN', () => {
    expect(formatTimeDetailed(NaN)).toBeUndefined();
  });
});

describe('no formatter prints a value at or above its own unit', () => {
  // A deterministic sweep over 15 orders of magnitude, with extra points just below each unit boundary.
  const samples: number[] = [];
  let seed = 42;
  const next = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  for (let i = 0; i < 20_000; i++) {
    const value = 10 ** (next() * 15);
    samples.push(value, Math.round(value), Math.round(value / 10) * 10 - 0.5);
  }
  for (const edge of [999.5, 999_950, 999_999_999, 59_995, 3_599_950, 3_597_000, 1_048_575, 1_073_741_823]) {
    for (const delta of [-1, -0.5, -0.1, 0, 0.1, 0.5, 1]) samples.push(edge + delta);
  }

  const violations = (format: (value: number) => string | undefined): string[] => {
    const bad: string[] = [];
    for (const value of samples) {
      const text = format(value) ?? '';
      const single = /^(\d+(?:\.\d+)?)(K|M|G| KB| MB| GB|us|ms|s|m)$/.exec(text);
      const minutes = /^(\d+)m (\d+\.\d)s$/.exec(text);
      const hours = /^(\d+)h (\d+)m(?: (\d+)s)?$/.exec(text);
      const limit = single
        ? { K: 1000, M: 1000, G: 1000, KB: 1024, MB: 1024, GB: 1024, us: 1000, ms: 1000, s: 60, m: 60 }[single[2].trim()]!
        : 0;
      if (
        /NaN|Infinity|undefined/.test(text)
        || (single && Number(single[1]) >= limit)
        || (minutes && (Number(minutes[1]) >= 60 || Number(minutes[2]) >= 60))
        || (hours && (Number(hours[2]) >= 60 || Number(hours[3] ?? 0) >= 60))
      ) {
        bad.push(`${value} → ${text}`);
      }
    }
    return bad;
  };

  it.each([
    ['formatNumberShort', formatNumberShort],
    ['formatBytes', formatBytes],
    ['formatTimeCompact', formatTimeCompact],
    ['formatTimeShort', formatTimeShort],
    ['formatTimeDetailed', formatTimeDetailed],
  ] as const)('%s', (_name, format) => {
    expect(violations((value) => format(value))).toEqual([]);
  });
});

describe('callers that trim a trailing ".0" before the unit', () => {
  const node = (over: Partial<PlanNode>): PlanNode => ({ id: 1, depth: 1, operation: 'X', children: [], ...over });

  it('formatEstimatedRows trims it for the G and T units too', () => {
    expect(formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 2_000_000_000 })).text).toBe('1 × 2G');
    expect(formatEstimatedRows(node({ rows: 1, estimatedRowsTotal: 3_000_000_000_000 })).text).toBe('1 × 3T');
  });

  it('formatThreshold trims it for the G and T units too', () => {
    expect(formatThreshold(2_000_000_000, 'count')).toBe('2G');
    expect(formatThreshold(2_500_000_000, 'count')).toBe('2.5G');
    expect(formatThreshold(1_000_000_000_000, 'count')).toBe('1T');
    expect(formatThreshold(7_200_000, 'time')).toBe('2h 0m');
  });
});
