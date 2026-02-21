export interface PlanNode {
  id: number;
  depth: number;
  operation: string;
  objectName?: string;
  alias?: string;

  // Estimated statistics (from optimizer)
  rows?: number;
  bytes?: number;
  cost?: number;
  cpuPercent?: number;
  time?: string;
  tempSpace?: number;

  // Actual runtime statistics (from SQL Monitor)
  actualRows?: number;
  actualTime?: number;       // milliseconds
  starts?: number;           // number of execution starts
  memoryUsed?: number;       // bytes
  tempUsed?: number;         // actual temp space in bytes
  physicalReads?: number;
  logicalReads?: number;
  activityPercent?: number;  // percentage of total execution time

  // Predicates and metadata
  accessPredicates?: string;
  filterPredicates?: string;
  queryBlock?: string;
  objectAlias?: string;
  parentId?: number;
  children: PlanNode[];
}

export type PlanSource = 'dbms_xplan' | 'sql_monitor_text' | 'sql_monitor_xml';
export type NodeIndicatorMetric = 'cost' | 'actualRows' | 'actualTime' | 'starts' | 'activityPercent';

export interface ParsedPlan {
  planHashValue?: string;
  rootNode: PlanNode | null;
  allNodes: PlanNode[];
  totalCost: number;
  maxRows: number;
  maxActualRows?: number;
  maxStarts?: number;

  // Source metadata
  source: PlanSource;
  hasActualStats: boolean;

  // Additional SQL Monitor metadata
  sqlId?: string;
  sqlText?: string;
  totalElapsedTime?: number;  // total execution time in milliseconds
}

export type PredicateType = 'access' | 'filter' | 'none';

export interface NodeDisplayOptions {
  showRows: boolean;
  showCost: boolean;
  showBytes: boolean;
  showObjectName: boolean;
  showPredicateIndicators: boolean;
  showPredicateDetails: boolean;
  showQueryBlockBadge: boolean;
  showQueryBlockGrouping: boolean;
  // SQL Monitor actual statistics
  showActualRows: boolean;
  showActualTime: boolean;
  showStarts: boolean;
}

export interface FilterState {
  operationTypes: string[];
  minCost: number;
  maxCost: number;
  searchText: string;
  showPredicates: boolean;
  predicateTypes: PredicateType[];
  animateEdges: boolean;
  focusSelection: boolean;
  nodeDisplayOptions: NodeDisplayOptions;
  // SQL Monitor actual statistics filters
  minActualRows: number;
  maxActualRows: number;
  minActualTime: number;
  maxActualTime: number;
  // Cardinality mismatch filter (minimum ratio deviation)
  minCardinalityMismatch: number;
}

export type ViewMode = 'hierarchical' | 'sankey' | 'text';
export type SankeyMetric = 'rows' | 'cost' | 'actualRows' | 'actualTime';
export type Theme = 'light' | 'dark';

export const OPERATION_CATEGORIES: Record<string, string[]> = {
  'Table Access': [
    'TABLE ACCESS FULL',
    'TABLE ACCESS BY INDEX ROWID',
    'TABLE ACCESS BY INDEX ROWID BATCHED',
    'TABLE ACCESS BY USER ROWID',
    'TABLE ACCESS BY GLOBAL INDEX ROWID',
    'TABLE ACCESS BY LOCAL INDEX ROWID',
  ],
  'Index Operations': [
    'INDEX UNIQUE SCAN',
    'INDEX RANGE SCAN',
    'INDEX FULL SCAN',
    'INDEX FAST FULL SCAN',
    'INDEX SKIP SCAN',
    'INDEX RANGE SCAN DESCENDING',
  ],
  'Join Operations': [
    'NESTED LOOPS',
    'HASH JOIN',
    'MERGE JOIN',
    'HASH JOIN OUTER',
    'HASH JOIN ANTI',
    'HASH JOIN SEMI',
    'NESTED LOOPS OUTER',
    'MERGE JOIN OUTER',
  ],
  'Set Operations': [
    'UNION-ALL',
    'UNION',
    'INTERSECT',
    'MINUS',
    'CONCATENATION',
  ],
  'Aggregation': [
    'SORT AGGREGATE',
    'HASH GROUP BY',
    'SORT GROUP BY',
    'SORT GROUP BY NOSORT',
  ],
  'Sort Operations': [
    'SORT ORDER BY',
    'SORT UNIQUE',
    'SORT JOIN',
    'BUFFER SORT',
  ],
  'Filter/View': [
    'FILTER',
    'VIEW',
    'COUNT STOPKEY',
    'FIRST ROW',
  ],
  'Partition': [
    'PARTITION RANGE ALL',
    'PARTITION RANGE SINGLE',
    'PARTITION RANGE ITERATOR',
    'PARTITION LIST ALL',
    'PARTITION LIST SINGLE',
  ],
  'Parallelism': [
    'PX COORDINATOR',
    'PX SEND',
    'PX RECEIVE',
    'PX BLOCK ITERATOR',
    'PX SELECTOR',
    'PX SEND QC',
    'PX SEND HASH',
    'PX SEND BROADCAST',
    'PX SEND RANGE',
    'PX SEND ROUND-ROBIN',
    'PX PARTITION',
  ],
  'Other': [
    'SELECT STATEMENT',
    'UPDATE STATEMENT',
    'INSERT STATEMENT',
    'DELETE STATEMENT',
    'LOAD TABLE CONVENTIONAL',
    'SEQUENCE',
  ],
};

export function getOperationCategory(operation: string): string {
  for (const [category, operations] of Object.entries(OPERATION_CATEGORIES)) {
    if (operations.some(op => operation.toUpperCase().includes(op))) {
      return category;
    }
  }
  return 'Other';
}

export type ColorScheme = 'vibrant' | 'muted' | 'professional' | 'monochrome';

export const COLOR_SCHEME_PALETTES: Record<ColorScheme, Record<string, string>> = {
  vibrant: {
    'Table Access': '#f97316',
    'Index Operations': '#22c55e',
    'Join Operations': '#3b82f6',
    'Set Operations': '#a855f7',
    'Aggregation': '#ec4899',
    'Sort Operations': '#eab308',
    'Filter/View': '#06b6d4',
    'Partition': '#6366f1',
    'Parallelism': '#f43f5e',
    'Other': '#6b7280',
  },
  muted: {
    'Table Access': '#f59e0b',
    'Index Operations': '#10b981',
    'Join Operations': '#0ea5e9',
    'Set Operations': '#8b5cf6',
    'Aggregation': '#d946ef',
    'Sort Operations': '#84cc16',
    'Filter/View': '#14b8a6',
    'Partition': '#6366f1',
    'Parallelism': '#f43f5e',
    'Other': '#94a3b8',
  },
  professional: {
    'Table Access': '#b45309',
    'Index Operations': '#047857',
    'Join Operations': '#1d4ed8',
    'Set Operations': '#6d28d9',
    'Aggregation': '#be185d',
    'Sort Operations': '#a16207',
    'Filter/View': '#0e7490',
    'Partition': '#4338ca',
    'Parallelism': '#be123c',
    'Other': '#64748b',
  },
  monochrome: {
    'Table Access': '#78716c',
    'Index Operations': '#71717a',
    'Join Operations': '#64748b',
    'Set Operations': '#6b7280',
    'Aggregation': '#737373',
    'Sort Operations': '#78716c',
    'Filter/View': '#71717a',
    'Partition': '#64748b',
    'Parallelism': '#6b7280',
    'Other': '#94a3b8',
  },
};

// Current vibrant colors (original)
const COLORS_VIBRANT: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-orange-100 dark:bg-orange-900/30', border: 'border-orange-400', text: 'text-orange-700 dark:text-orange-300' },
  'Index Operations': { bg: 'bg-green-100 dark:bg-green-900/30', border: 'border-green-400', text: 'text-green-700 dark:text-green-300' },
  'Join Operations': { bg: 'bg-blue-100 dark:bg-blue-900/30', border: 'border-blue-400', text: 'text-blue-700 dark:text-blue-300' },
  'Set Operations': { bg: 'bg-purple-100 dark:bg-purple-900/30', border: 'border-purple-400', text: 'text-purple-700 dark:text-purple-300' },
  'Aggregation': { bg: 'bg-pink-100 dark:bg-pink-900/30', border: 'border-pink-400', text: 'text-pink-700 dark:text-pink-300' },
  'Sort Operations': { bg: 'bg-yellow-100 dark:bg-yellow-900/30', border: 'border-yellow-400', text: 'text-yellow-700 dark:text-yellow-300' },
  'Filter/View': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', border: 'border-cyan-400', text: 'text-cyan-700 dark:text-cyan-300' },
  'Partition': { bg: 'bg-indigo-100 dark:bg-indigo-900/30', border: 'border-indigo-400', text: 'text-indigo-700 dark:text-indigo-300' },
  'Parallelism': { bg: 'bg-rose-100 dark:bg-rose-900/30', border: 'border-rose-400', text: 'text-rose-700 dark:text-rose-300' },
  'Other': { bg: 'bg-gray-100 dark:bg-gray-800', border: 'border-gray-400', text: 'text-gray-700 dark:text-gray-300' },
};

// Option A: Muted pastels - softer, less saturated colors
const COLORS_MUTED: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border-amber-300 dark:border-amber-700', text: 'text-amber-800 dark:text-amber-200' },
  'Index Operations': { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border-emerald-300 dark:border-emerald-700', text: 'text-emerald-800 dark:text-emerald-200' },
  'Join Operations': { bg: 'bg-sky-50 dark:bg-sky-950/40', border: 'border-sky-300 dark:border-sky-700', text: 'text-sky-800 dark:text-sky-200' },
  'Set Operations': { bg: 'bg-violet-50 dark:bg-violet-950/40', border: 'border-violet-300 dark:border-violet-700', text: 'text-violet-800 dark:text-violet-200' },
  'Aggregation': { bg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40', border: 'border-fuchsia-300 dark:border-fuchsia-700', text: 'text-fuchsia-800 dark:text-fuchsia-200' },
  'Sort Operations': { bg: 'bg-lime-50 dark:bg-lime-950/40', border: 'border-lime-300 dark:border-lime-700', text: 'text-lime-800 dark:text-lime-200' },
  'Filter/View': { bg: 'bg-teal-50 dark:bg-teal-950/40', border: 'border-teal-300 dark:border-teal-700', text: 'text-teal-800 dark:text-teal-200' },
  'Partition': { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border-indigo-300 dark:border-indigo-700', text: 'text-indigo-800 dark:text-indigo-200' },
  'Parallelism': { bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border-rose-300 dark:border-rose-700', text: 'text-rose-800 dark:text-rose-200' },
  'Other': { bg: 'bg-slate-50 dark:bg-slate-900', border: 'border-slate-300 dark:border-slate-600', text: 'text-slate-700 dark:text-slate-300' },
};

// Option B: Professional - slate backgrounds with subtle colored accents
const COLORS_PROFESSIONAL: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-amber-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Index Operations': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-emerald-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Join Operations': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-blue-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Set Operations': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-violet-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Aggregation': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-pink-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Sort Operations': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-yellow-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Filter/View': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-cyan-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Partition': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-indigo-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Parallelism': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-rose-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Other': { bg: 'bg-slate-50 dark:bg-slate-800/80', border: 'border-l-4 border-l-slate-400 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
};

// Option C: Monochrome - grayscale with very subtle tints
const COLORS_MONOCHROME: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-stone-100 dark:bg-stone-800/60', border: 'border-stone-400 dark:border-stone-500', text: 'text-stone-700 dark:text-stone-200' },
  'Index Operations': { bg: 'bg-zinc-100 dark:bg-zinc-800/60', border: 'border-zinc-400 dark:border-zinc-500', text: 'text-zinc-700 dark:text-zinc-200' },
  'Join Operations': { bg: 'bg-slate-100 dark:bg-slate-800/60', border: 'border-slate-400 dark:border-slate-500', text: 'text-slate-700 dark:text-slate-200' },
  'Set Operations': { bg: 'bg-gray-100 dark:bg-gray-800/60', border: 'border-gray-400 dark:border-gray-500', text: 'text-gray-700 dark:text-gray-200' },
  'Aggregation': { bg: 'bg-neutral-100 dark:bg-neutral-800/60', border: 'border-neutral-400 dark:border-neutral-500', text: 'text-neutral-700 dark:text-neutral-200' },
  'Sort Operations': { bg: 'bg-stone-100 dark:bg-stone-800/60', border: 'border-stone-400 dark:border-stone-500', text: 'text-stone-700 dark:text-stone-200' },
  'Filter/View': { bg: 'bg-zinc-100 dark:bg-zinc-800/60', border: 'border-zinc-400 dark:border-zinc-500', text: 'text-zinc-700 dark:text-zinc-200' },
  'Partition': { bg: 'bg-slate-100 dark:bg-slate-800/60', border: 'border-slate-400 dark:border-slate-500', text: 'text-slate-700 dark:text-slate-200' },
  'Parallelism': { bg: 'bg-gray-100 dark:bg-gray-800/60', border: 'border-gray-400 dark:border-gray-500', text: 'text-gray-700 dark:text-gray-200' },
  'Other': { bg: 'bg-neutral-100 dark:bg-neutral-800/60', border: 'border-neutral-400 dark:border-neutral-500', text: 'text-neutral-700 dark:text-neutral-200' },
};

export const COLOR_SCHEMES: Record<ColorScheme, Record<string, { bg: string; border: string; text: string }>> = {
  vibrant: COLORS_VIBRANT,
  muted: COLORS_MUTED,
  professional: COLORS_PROFESSIONAL,
  monochrome: COLORS_MONOCHROME,
};

// Default export for backward compatibility
export const CATEGORY_COLORS = COLORS_VIBRANT;

export function getCostColor(cost: number, totalCost: number): string {
  if (totalCost === 0) return 'bg-gray-200 dark:bg-gray-700';
  const ratio = cost / totalCost;
  if (ratio >= 0.5) return 'bg-red-500';
  if (ratio >= 0.25) return 'bg-orange-500';
  if (ratio >= 0.1) return 'bg-yellow-500';
  return 'bg-green-500';
}

export function getMetricColor(ratio: number): string {
  if (ratio >= 0.5) return 'bg-red-500';
  if (ratio >= 0.25) return 'bg-orange-500';
  if (ratio >= 0.1) return 'bg-yellow-500';
  return 'bg-green-500';
}

export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}

/** Brief tooltips for common Oracle execution plan operations. */
export const OPERATION_TOOLTIPS: Record<string, string> = {
  'SELECT STATEMENT': 'Root of a SELECT query plan',
  'UPDATE STATEMENT': 'Root of an UPDATE query plan',
  'INSERT STATEMENT': 'Root of an INSERT query plan',
  'DELETE STATEMENT': 'Root of a DELETE query plan',
  'TABLE ACCESS FULL': 'Full table scan — reads every row. May indicate missing index',
  'TABLE ACCESS BY INDEX ROWID': 'Row lookup by ROWID obtained from an index',
  'TABLE ACCESS BY INDEX ROWID BATCHED': 'Batched row lookup — sorts ROWIDs before accessing table blocks',
  'TABLE ACCESS BY USER ROWID': 'Direct access using user-supplied ROWID',
  'TABLE ACCESS BY GLOBAL INDEX ROWID': 'Partitioned table access via global index',
  'TABLE ACCESS BY LOCAL INDEX ROWID': 'Partitioned table access via local index',
  'INDEX UNIQUE SCAN': 'Finds exactly one index entry. Most efficient index access',
  'INDEX RANGE SCAN': 'Reads a range of index entries. Common for range predicates or non-unique lookups',
  'INDEX FULL SCAN': 'Reads entire index in order. Often used for ORDER BY without table access',
  'INDEX FAST FULL SCAN': 'Reads entire index using multiblock I/O. Like a full table scan on the index',
  'INDEX SKIP SCAN': 'Skips leading index column. May indicate a missing composite index',
  'INDEX RANGE SCAN DESCENDING': 'Range scan in descending order (e.g., ORDER BY col DESC)',
  'NESTED LOOPS': 'For each row from the outer source, probes the inner source. Best for small result sets',
  'HASH JOIN': 'Builds hash table on smaller input, probes with larger. Best for large unsorted joins',
  'MERGE JOIN': 'Merges two sorted inputs. Requires both sides sorted on the join key',
  'HASH JOIN OUTER': 'Hash join preserving all rows from the outer (left) side',
  'HASH JOIN ANTI': 'Hash join for NOT IN / NOT EXISTS — finds rows with no match',
  'HASH JOIN SEMI': 'Hash join for EXISTS / IN — stops after first match per row',
  'NESTED LOOPS OUTER': 'Outer join variant of nested loops',
  'MERGE JOIN OUTER': 'Outer join variant of merge join',
  'SORT AGGREGATE': 'Computes aggregate (COUNT, SUM, etc.) — no actual sort performed',
  'HASH GROUP BY': 'Groups rows using a hash table. Common for GROUP BY',
  'SORT GROUP BY': 'Groups rows by sorting. Used when result must be ordered',
  'SORT GROUP BY NOSORT': 'Groups already-sorted input without re-sorting',
  'SORT ORDER BY': 'Sorts output rows for ORDER BY clause',
  'SORT UNIQUE': 'Sorts and removes duplicates (DISTINCT)',
  'SORT JOIN': 'Sorts input for a merge join',
  'BUFFER SORT': 'Buffers rows to avoid repeated access. Watch for high temp space usage',
  'FILTER': 'Applies a filter condition. May execute subqueries per row — check predicates',
  'VIEW': 'Materializes an inline view or subquery',
  'COUNT STOPKEY': 'Stops after ROWNUM limit is reached. Efficient for top-N queries',
  'FIRST ROW': 'Optimized to return only the first row',
  'UNION-ALL': 'Concatenates results from multiple branches without deduplication',
  'UNION': 'Concatenates and deduplicates results from multiple branches',
  'INTERSECT': 'Returns rows common to both branches',
  'MINUS': 'Returns rows from first branch not in second',
  'CONCATENATION': 'OR-expansion: each branch handles a different OR condition',
  'PARTITION RANGE ALL': 'Accesses all partitions in range-partitioned table',
  'PARTITION RANGE SINGLE': 'Accesses a single partition. Good partition pruning',
  'PARTITION RANGE ITERATOR': 'Iterates over a subset of partitions',
  'PARTITION LIST ALL': 'Accesses all list partitions',
  'PARTITION LIST SINGLE': 'Accesses a single list partition',
  'PX COORDINATOR': 'Parallel query coordinator — collects results from parallel slaves',
  'PX SEND QC': 'Parallel slave sends data to query coordinator',
  'PX SEND HASH': 'Parallel redistribution by hash — for parallel joins',
  'PX SEND BROADCAST': 'Broadcasts data to all parallel slaves. Watch for data skew',
  'PX SEND RANGE': 'Sends data partitioned by range to parallel slaves',
  'PX SEND ROUND-ROBIN': 'Distributes rows round-robin to parallel slaves',
  'PX RECEIVE': 'Receives data from parallel slaves',
  'PX BLOCK ITERATOR': 'Parallel scan — divides work into block ranges',
  'PX SELECTOR': 'Selects specific parallel execution server',
  'LOAD TABLE CONVENTIONAL': 'Conventional path INSERT',
  'SEQUENCE': 'Generates sequence values',
};

/** Look up tooltip for an operation, trying exact match first, then prefix match. */
export function getOperationTooltip(operation: string): string | undefined {
  const upper = operation.toUpperCase();
  if (OPERATION_TOOLTIPS[upper]) return OPERATION_TOOLTIPS[upper];
  // Try prefix match (e.g., "NESTED LOOPS OUTER" matches "NESTED LOOPS")
  for (const [key, value] of Object.entries(OPERATION_TOOLTIPS)) {
    if (upper.startsWith(key)) return value;
  }
  return undefined;
}
