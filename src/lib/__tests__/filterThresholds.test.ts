import { describe, expect, it } from 'vitest';
import {
  THRESHOLD_STEPS,
  formatThreshold,
  logHistogram,
  parseThreshold,
  positionToThreshold,
  roundThreshold,
  thresholdToPosition,
} from '../filterThresholds';

describe('roundThreshold', () => {
  it('keeps two significant digits', () => {
    expect(roundThreshold(1237)).toBe(1200);
    expect(roundThreshold(38_912_345)).toBe(39_000_000);
    expect(roundThreshold(57)).toBe(57);
    expect(roundThreshold(0.3)).toBe(1);
    expect(roundThreshold(0)).toBe(0);
  });
});

describe('log-scale slider mapping', () => {
  it('maps the ends to "any" and the max', () => {
    expect(positionToThreshold(0, 39_000_000)).toBe(0);
    expect(positionToThreshold(THRESHOLD_STEPS, 39_000_123)).toBe(39_000_123);
    expect(thresholdToPosition(0, 1000)).toBe(0);
    expect(thresholdToPosition(5000, 1000)).toBe(THRESHOLD_STEPS);
  });

  it('gives each decade an equal share of the track', () => {
    const max = 999_999; // log1p(max) = 6 decades
    expect(thresholdToPosition(999, max)).toBe(500);
    expect(positionToThreshold(500, max)).toBe(1000);
  });

  it('round-trips a value to (about) itself', () => {
    const max = 39_000_000;
    const value = positionToThreshold(thresholdToPosition(1_000_000, max), max);
    expect(value).toBeGreaterThanOrEqual(950_000);
    expect(value).toBeLessThanOrEqual(1_050_000);
  });

  it('is safe with an empty range', () => {
    expect(thresholdToPosition(10, 0)).toBe(0);
    expect(positionToThreshold(500, 0)).toBe(0);
  });
});

describe('logHistogram', () => {
  it('spreads values across decades instead of piling them into the first bucket', () => {
    const bars = logHistogram([1, 10, 100, 1000, 10_000, 100_000, 1_000_000], 1_000_000, 6);
    expect(bars.filter((bar) => bar > 0).length).toBeGreaterThanOrEqual(5);
  });

  it('normalises to the fullest bucket and handles empty input', () => {
    expect(Math.max(...logHistogram([5, 5, 5, 900], 1000, 4))).toBe(1);
    expect(logHistogram([], 100, 10)).toEqual([]);
    expect(logHistogram([1], 0, 10)).toEqual([]);
  });
});

describe('parseThreshold', () => {
  it('reads counts with K/M/B suffixes, separators and a leading ≥', () => {
    expect(parseThreshold('1.5M', 'count')).toBe(1_500_000);
    expect(parseThreshold('20k', 'count')).toBe(20_000);
    expect(parseThreshold('1,000', 'count')).toBe(1000);
    expect(parseThreshold('≥ 2B', 'count')).toBe(2_000_000_000);
    expect(parseThreshold('1e6', 'count')).toBe(1_000_000);
  });

  it('reads times, defaulting to seconds', () => {
    expect(parseThreshold('500ms', 'time')).toBe(500);
    expect(parseThreshold('2', 'time')).toBe(2000);
    expect(parseThreshold('1.5s', 'time')).toBe(1500);
    expect(parseThreshold('3m', 'time')).toBe(180_000);
  });

  it('reads ratios with or without ×', () => {
    expect(parseThreshold('10x', 'ratio')).toBe(10);
    expect(parseThreshold('2.5×', 'ratio')).toBe(2.5);
  });

  it('clears on empty / "any" and rejects garbage', () => {
    expect(parseThreshold('', 'count')).toBe(0);
    expect(parseThreshold(' any ', 'time')).toBe(0);
    expect(parseThreshold('lots', 'count')).toBeNull();
    expect(parseThreshold('-5', 'count')).toBeNull();
    expect(parseThreshold('5q', 'time')).toBeNull();
  });
});

describe('formatThreshold', () => {
  it('formats each kind compactly', () => {
    expect(formatThreshold(1_000_000, 'count')).toBe('1M');
    expect(formatThreshold(1_500_000, 'count')).toBe('1.5M');
    expect(formatThreshold(153, 'count')).toBe('153');
    expect(formatThreshold(2000, 'time')).toBe('2.00s');
    expect(formatThreshold(10, 'ratio')).toBe('10×');
  });
});
