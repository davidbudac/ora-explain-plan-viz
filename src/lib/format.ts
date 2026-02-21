export interface FormatOptions {
  empty?: string;
  infinity?: string;
}

export function formatNumberShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
  return value.toString();
}

export function formatBytes(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 1073741824) return (value / 1073741824).toFixed(1) + ' GB';
  if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
  if (value >= 1024) return (value / 1024).toFixed(1) + ' KB';
  return value + ' B';
}

export function formatTimeCompact(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const mins = Math.floor(value / 60000);
    const secs = ((value % 60000) / 1000).toFixed(1);
    return `${mins}m ${secs}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) return (value / 60000).toFixed(1) + 'm';
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  return value.toFixed(0) + 'ms';
}

export function formatTimeDetailed(value?: number, options: FormatOptions = {}): string | undefined {
  if (value === undefined) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value >= 60000) {
    const minutes = Math.floor(value / 60000);
    const seconds = ((value % 60000) / 1000).toFixed(1);
    return `${minutes}m ${seconds}s`;
  }
  if (value >= 1000) return (value / 1000).toFixed(2) + 's';
  if (value >= 1) return value.toFixed(1) + 'ms';
  return (value * 1000).toFixed(0) + 'us';
}

/** Compute the ratio between actual and estimated rows. Returns undefined if either is missing. */
export function computeCardinalityRatio(eRows?: number, aRows?: number): number | undefined {
  if (eRows === undefined || aRows === undefined) return undefined;
  if (eRows === 0 && aRows === 0) return 1;
  if (eRows === 0) return Infinity;
  return aRows / eRows;
}

/** Format a cardinality ratio as a human-readable string like "10x over" or "5x under". */
export function formatCardinalityRatio(ratio: number | undefined): string | undefined {
  if (ratio === undefined) return undefined;
  if (ratio === Infinity) return '∞ over';
  if (ratio >= 1) {
    if (ratio < 1.5) return 'accurate';
    return `${ratio >= 100 ? Math.round(ratio) : ratio.toFixed(1)}x over`;
  }
  const inverse = 1 / ratio;
  if (inverse < 1.5) return 'accurate';
  return `${inverse >= 100 ? Math.round(inverse) : inverse.toFixed(1)}x under`;
}

/** Return a severity level for a cardinality ratio: 'good', 'warn', or 'bad'. */
export function cardinalityRatioSeverity(ratio: number | undefined): 'good' | 'warn' | 'bad' {
  if (ratio === undefined) return 'good';
  const deviation = ratio >= 1 ? ratio : 1 / ratio;
  if (deviation >= 10) return 'bad';
  if (deviation >= 3) return 'warn';
  return 'good';
}
