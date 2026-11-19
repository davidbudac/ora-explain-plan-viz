import type { PlanNode } from './types.ts';

export interface FormatOptions {
  empty?: string;
  infinity?: string;
}

/** `undefined`, NaN and -Infinity have no display value (Infinity has its own symbol). */
function isBlank(value: number | undefined): value is undefined {
  return value === undefined || Number.isNaN(value) || value === -Infinity;
}

/** Count suffixes as Oracle prints them in plan tables (1000-based). */
const COUNT_UNITS = ['K', 'M', 'G', 'T'];
const BYTE_UNITS = ['KB', 'MB', 'GB', 'TB'];

/**
 * `value` scaled down by `base` until it prints below `base` with one decimal: the unit is
 * chosen after rounding, so 999,950 reads "1.0M", never "1000.0K". Values past the last
 * unit stay in it.
 */
function scaleToUnit(value: number, base: number, units: string[]): { text: string; unit: string } {
  let scaled = value / base;
  let index = 0;
  while (index < units.length - 1 && Number(scaled.toFixed(1)) >= base) {
    scaled /= base;
    index++;
  }
  return { text: scaled.toFixed(1), unit: units[index] };
}

export function formatNumberShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value < 1000) return value.toString();
  const { text, unit } = scaleToUnit(value, 1000, COUNT_UNITS);
  return text + unit;
}

export function formatBytes(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (value < 1024) return value + ' B';
  const { text, unit } = scaleToUnit(value, 1024, BYTE_UNITS);
  return `${text} ${unit}`;
}

// The time formatters take milliseconds. Each range test rounds to the precision that range
// prints with before comparing, so a value never shows as "1000ms", "60.00s" or "1m 60.0s".

/** "2m 5.3s" from a duration, via tenths of a second so the seconds part is always below 60. */
function minutesAndSeconds(ms: number): string {
  const tenths = Math.round(ms / 100);
  return `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1)}s`;
}

/** True while `ms` still prints below one hour in the "Xm Y.Ys" form. */
const belowOneHour = (ms: number): boolean => Math.round(ms / 100) < 36000;
/** True while `ms` still prints below one minute in the "S.SSs" form. */
const belowOneMinute = (ms: number): boolean => Math.round(ms / 10) < 6000;

export function formatTimeCompact(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value) < 1000) return value.toFixed(0) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (belowOneHour(value)) return minutesAndSeconds(value);
  const minutes = Math.round(value / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatTimeShort(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value) < 1000) return value.toFixed(0) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (Math.round(value / 6000) < 600) return (value / 60000).toFixed(1) + 'm';
  return (value / 3600000).toFixed(1) + 'h';
}

export function formatTimeDetailed(value?: number, options: FormatOptions = {}): string | undefined {
  if (isBlank(value)) return options.empty;
  if (value === Infinity) return options.infinity ?? '∞';
  if (Math.round(value * 1000) < 1000) return (value * 1000).toFixed(0) + 'us';
  if (Math.round(value * 10) < 10000) return value.toFixed(1) + 'ms';
  if (belowOneMinute(value)) return (value / 1000).toFixed(2) + 's';
  if (belowOneHour(value)) return minutesAndSeconds(value);
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`;
}

/**
 * Compute the ratio between actual and estimated rows. Returns undefined if either is missing.
 * Both operands are floored at 1 (Oracle itself floors E-Rows at 1), so the result is never
 * 0 or Infinity: E-Rows=1 vs A-Rows=0 is "accurate", not an infinite underestimate.
 * The estimate must be comparable with `aRows` (all starts) — prefer `nodeCardinalityRatio`.
 */
export function computeCardinalityRatio(eRows?: number, aRows?: number): number | undefined {
  if (eRows === undefined || aRows === undefined) return undefined;
  return Math.max(aRows, 1) / Math.max(eRows, 1);
}

/**
 * THE function UI and advisor code should use for estimate-vs-actual comparisons.
 * Compares A-Rows with the estimate over all starts (`estimatedRowsTotal`), never the
 * per-start E-Rows. Undefined when no comparable estimate exists (never started,
 * early termination, no actual stats).
 */
export function nodeCardinalityRatio(node: PlanNode): number | undefined {
  return computeCardinalityRatio(node.estimatedRowsTotal, node.actualRows);
}

/**
 * Effective number of executions behind `estimatedRowsTotal` (total ÷ per-start E-Rows),
 * or undefined when the operation effectively ran once / there is no comparable total.
 * Not necessarily `Starts`: PX slave sets, partition iterators and NLJ-batched rowid
 * fetches derive their total differently (see `computeEstimatedRowTotals`).
 */
export function effectiveExecutions(node: Pick<PlanNode, 'rows' | 'estimatedRowsTotal'>): number | undefined {
  const { rows, estimatedRowsTotal: total } = node;
  if (rows === undefined || total === undefined || rows <= 0 || total <= rows) return undefined;
  const raw = total / rows;
  // Floating noise (e.g. 80000 / 4 computed from a rounded total) — it is an execution count.
  const rounded = Math.round(raw);
  const executions = Math.abs(raw - rounded) < 1e-6 * Math.max(1, raw) ? rounded : raw;
  return executions > 1 ? executions : undefined;
}

/**
 * The per-start estimate as shown next to A-Rows (which is cumulative over all executions).
 * When the operation ran more than once it reads `E-Rows × executions` (e.g. "4 × 20.0K") so the
 * estimate is comparable with the actual at a glance; otherwise it is the plain E-Rows.
 * `title` explains the product and is only set for the `×` form. Tabular columns should keep
 * using the plain number.
 */
export function formatEstimatedRows(
  node: PlanNode,
  hasActualStats = true,
): { text: string; title?: string } {
  const plain = { text: formatNumberShort(node.rows, { empty: '—' }) as string };
  if (!hasActualStats) return plain;
  const executions = effectiveExecutions(node);
  if (executions === undefined || node.rows === undefined || node.estimatedRowsTotal === undefined) return plain;
  const execText = Number.isInteger(executions) ? executions.toLocaleString('en-US') : executions.toFixed(1);
  const perExec = node.rows.toLocaleString('en-US');
  return {
    text: `${formatNumberShort(node.rows)} × ${formatNumberShort(executions)!.replace(/\.0(?=[KMGT]$)/, '')}`,
    title:
      `${perExec} ${node.rows === 1 ? 'row' : 'rows'} per execution × ${execText} executions = ` +
      `${Math.round(node.estimatedRowsTotal).toLocaleString('en-US')} estimated in total ` +
      `(A-Rows is the total over all executions)`,
  };
}

/**
 * One-line explanation of a node's estimate-vs-actual comparison, e.g.
 * "Cardinality mismatch: estimated 1.0K rows (E-Rows 1 × 1.0K executions) vs A-Rows 250.0K".
 * The "× executions" breakdown appears only when it changes the number, and uses the multiplier
 * the total was built with (`effectiveExecutions`), which is not always the node's own Starts.
 */
export function cardinalityMismatchText(node: PlanNode): string {
  const total = node.estimatedRowsTotal;
  const fmt = (n: number | undefined) => formatNumberShort(n) ?? '?';
  if (total === undefined) {
    return `Cardinality mismatch: E-Rows ${fmt(node.rows)} vs A-Rows ${fmt(node.actualRows)}`;
  }
  const executions = effectiveExecutions(node);
  const breakdown = executions !== undefined
    ? ` (E-Rows ${fmt(node.rows)} × ${fmt(Number.isInteger(executions) ? executions : Math.round(executions * 10) / 10)} executions)`
    : '';
  return `Cardinality mismatch: estimated ${fmt(total)} rows${breakdown} vs A-Rows ${fmt(node.actualRows)}`;
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

/**
 * Format a partition Pstart/Pstop pair as a compact range string.
 * Returns e.g. "15–20", or "9" when start === stop (single partition),
 * or undefined when no partition range is present. Non-numeric markers
 * (KEY, KEY(I), :BFnnnn, ROWID, etc.) are passed through unchanged.
 */
export function formatPartitionRange(pstart?: string, pstop?: string): string | undefined {
  const start = pstart?.trim() || undefined;
  const stop = pstop?.trim() || undefined;
  if (!start && !stop) return undefined;
  if (start && stop) {
    return start === stop ? start : `${start}–${stop}`;
  }
  return start ?? stop;
}
