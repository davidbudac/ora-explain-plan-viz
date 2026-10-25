import { formatNumberShort, formatTimeCompact } from './format';

/**
 * Helpers for the filter panel's "At least" thresholds (cost, A-Rows, A-Time,
 * estimate error). Plan values span orders of magnitude (1 row … 39M rows), so
 * the sliders and their histograms work on a log scale (`log1p`, so 0 maps to
 * the left end), and the value box accepts suffixed text like `1.5M` or `2s`.
 */

/** What a threshold measures — decides parsing and formatting. */
export type ThresholdKind = 'count' | 'time' | 'ratio';

/** Resolution of the range input (positions 0 … THRESHOLD_STEPS). */
export const THRESHOLD_STEPS = 1000;

/** Round to two significant digits so dragged values read as 1.2K, not 1,237. */
export function roundThreshold(value: number): number {
  if (value <= 0) return 0;
  if (value < 10) return Math.max(1, Math.round(value));
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

/** Slider position (0 … THRESHOLD_STEPS) for a threshold value on a log scale. */
export function thresholdToPosition(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  if (value >= max) return THRESHOLD_STEPS;
  return Math.round((Math.log1p(value) / Math.log1p(max)) * THRESHOLD_STEPS);
}

/** Threshold value for a slider position; position 0 is "any" (0), the far right is exactly `max`. */
export function positionToThreshold(position: number, max: number): number {
  if (position <= 0 || !(max > 0)) return 0;
  if (position >= THRESHOLD_STEPS) return max;
  return Math.min(max, roundThreshold(Math.expm1((position / THRESHOLD_STEPS) * Math.log1p(max))));
}

/**
 * Bucket values on the same log scale as the slider. Returns per-bucket
 * heights normalised to the fullest bucket (0 … 1).
 */
export function logHistogram(values: number[], max: number, buckets: number): number[] {
  if (!(max > 0) || values.length === 0 || buckets <= 0) return [];
  const counts = new Array<number>(buckets).fill(0);
  const scale = Math.log1p(max);
  for (const value of values) {
    const position = Math.log1p(Math.max(0, Math.min(value, max))) / scale;
    counts[Math.min(Math.floor(position * buckets), buckets - 1)]++;
  }
  const peak = Math.max(...counts);
  return counts.map((count) => (peak > 0 ? count / peak : 0));
}

const COUNT_SUFFIX: Record<string, number> = { '': 1, k: 1e3, m: 1e6, g: 1e9, b: 1e9, t: 1e12 };
const TIME_SUFFIX: Record<string, number> = { ms: 1, s: 1000, m: 60_000, min: 60_000, h: 3_600_000 };

/**
 * Parse what the user typed into a threshold box. Empty text (or "any"/"off")
 * clears the threshold (0); unreadable text returns null so the caller can
 * keep the previous value. Times without a unit are seconds.
 */
export function parseThreshold(text: string, kind: ThresholdKind): number | null {
  const cleaned = text.trim().toLowerCase().replace(/^(≥|>=|>)/, '').replace(/[,\s_]/g, '');
  if (cleaned === '' || cleaned === 'any' || cleaned === 'off' || cleaned === 'all') return 0;

  if (kind === 'time') {
    const match = /^(\d*\.?\d+)(ms|s|min|m|h)?$/.exec(cleaned);
    if (!match) return null;
    return Math.round(Number(match[1]) * TIME_SUFFIX[match[2] ?? 's']);
  }

  if (kind === 'ratio') {
    const match = /^(\d*\.?\d+)(x|×)?$/.exec(cleaned);
    if (!match) return null;
    return Number(match[1]);
  }

  const match = /^(\d*\.?\d+(?:e\d+)?)([kmgbt]?)$/.exec(cleaned);
  if (!match) return null;
  return Math.round(Number(match[1]) * COUNT_SUFFIX[match[2]]);
}

/** Short display text for a threshold value (never "≥"; the caller adds that). */
export function formatThreshold(value: number, kind: ThresholdKind): string {
  if (kind === 'time') return formatTimeCompact(value) ?? '';
  if (kind === 'ratio') return `${Number(value.toFixed(1))}×`;
  return (formatNumberShort(value) ?? '').replace(/\.0(?=[KM]$)/, '');
}
