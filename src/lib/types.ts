import type { BindVariable } from './parser/types';
import type { PlanNotes } from './parser/noteSection';
export type { BindVariable } from './parser/types';
export type { PlanNotes } from './parser/noteSection';

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

  // Partitioning and parallel execution columns (DBMS_XPLAN Pstart/Pstop/TQ/IN-OUT/PQ Distrib)
  pstart?: string;
  pstop?: string;
  tq?: string;
  inOut?: string;
  pqDistrib?: string;

  // Actual runtime statistics (from SQL Monitor)
  actualRows?: number;
  actualTime?: number;       // milliseconds, CUMULATIVE (includes children) after post-parse analysis
  selfTime?: number;         // milliseconds, this operation only — derived post-parse (analysis.ts)
  starts?: number;           // number of execution starts
  memoryUsed?: number;       // bytes
  tempUsed?: number;         // actual temp space in bytes
  physicalReads?: number;    // physical read requests (count)
  logicalReads?: number;     // buffer gets (count)
  ioReadRequests?: number;   // I/O read requests (count)
  ioReadBytes?: number;      // I/O read bytes
  ioWriteRequests?: number;  // I/O write requests (count)
  ioWriteBytes?: number;     // I/O write bytes
  activityPercent?: number;  // percentage of total execution time (ASH samples)

  // Execution timeline offsets (seconds relative to sql_exec_start), from SQL
  // Monitor <stats type="plan_monitor"> first_active/last_active/first_row.
  firstActiveOffset?: number;
  lastActiveOffset?: number;
  firstRowOffset?: number;

  // Predicates and metadata
  accessPredicates?: string;
  filterPredicates?: string;
  queryBlock?: string;
  objectAlias?: string;
  parentId?: number;
  children: PlanNode[];
}

export type PlanSource = 'dbms_xplan' | 'sql_monitor_text' | 'sql_monitor_xml' | 'json' | 'xbi';
export type NodeIndicatorMetric = 'cost' | 'actualRows' | 'actualTime' | 'starts' | 'activityPercent';

export interface ParsedPlan {
  planHashValue?: string;
  rootNode: PlanNode | null;
  allNodes: PlanNode[];
  totalCost: number;
  maxRows: number;
  maxActualRows?: number;
  maxStarts?: number;
  maxSelfTime?: number;      // milliseconds, set by computeSelfTimes (analysis.ts)

  // Source metadata
  source: PlanSource;
  hasActualStats: boolean;

  // Additional SQL Monitor metadata
  sqlId?: string;
  sqlText?: string;
  totalElapsedTime?: number;  // total execution time in milliseconds

  // Bind variables from SQL Monitor XML
  bindVariables?: BindVariable[];

  // Rich metadata from SQL Monitor XML reports
  monitorMetadata?: SqlMonitorMetadata;

  // Parsed "Note" section (dynamic sampling, adaptive plan, SQL profile, etc.)
  notes?: PlanNotes;

  // Report-level ASH timeline (Active Session History), from <activity_detail>
  activityTimeline?: ActivityTimeline;
}

/** One ASH sample from a SQL Monitor report-level <activity_detail> bucket. */
export interface ActivitySample {
  bucket: number;
  line?: number;
  waitClass: string;
  event?: string;
  count: number;
}

/** Report-level ASH timeline parsed from <activity_detail>. */
export interface ActivityTimeline {
  startTime?: string;
  durationSecs: number;
  bucketIntervalSecs: number;
  bucketCount: number;
  samples: ActivitySample[];
}

export interface SqlMonitorMetadata {
  // Execution summary
  status?: string;
  duration?: number;            // wall clock seconds
  sqlExecStart?: string;
  sqlExecId?: string;

  // Time breakdown (microseconds from <stats type="monitor">)
  cpuTime?: number;
  userIoWaitTime?: number;
  otherWaitTime?: number;
  plsqlExecTime?: number;

  // Session & Environment
  sessionId?: number;
  sessionSerial?: number;
  instanceId?: number;
  user?: string;
  program?: string;
  module?: string;
  service?: string;
  dbVersion?: string;
  dbUniqueName?: string;
  dbPlatform?: string;
  reportHostName?: string;
  cpuCores?: number;
  hyperthread?: boolean;

  // Resource consumption (from <stats type="monitor">)
  bufferGets?: number;
  readReqs?: number;
  readBytes?: number;
  userFetchCount?: number;

  // Optimizer environment (param name -> value)
  optimizerEnv?: Record<string, string>;

  // Parallel execution (from <target> attributes / global <stats type="monitor">)
  dop?: number;
  pxServersRequested?: number;
  pxServersAllocated?: number;
}

export type PredicateType = 'access' | 'filter' | 'none';

export interface NodeDisplayOptions {
  showRows: boolean;
  showCost: boolean;
  showBytes: boolean;
  showObjectName: boolean;
  showPredicateIndicators: boolean;
  showPredicateDetails: boolean;
  showPartitionInfo: boolean;
  showQueryBlockBadge: boolean;
  showQueryBlockGrouping: boolean;
  // SQL Monitor actual statistics
  showActualRows: boolean;
  showActualTime: boolean;
  showStarts: boolean;
  // Warning badges
  showHotspotBadge: boolean;
  showSpillBadge: boolean;
  showCardinalityBadge: boolean;
  showAdvisorBadge: boolean;
  // Metadata indicators (from bundle)
  showStaleStatsBadge: boolean;
  showMissingStatsBadge: boolean;
  showMismatchNoHistogramBadge: boolean;
  // Annotations overlay
  showAnnotations: boolean;
  /**
   * Progressive disclosure: collapse the whole node body into a single quiet
   * mono metric line plus one amber warning dot. Suppresses the stats grid,
   * badge row, query-block/alias chips, partition info and predicate chips
   * regardless of the individual toggles above (those keep acting as signal
   * sources for the dot). Defaults to false for existing saved settings.
   */
  compactStats: boolean;
}

export interface FilterState {
  operationTypes: string[];
  minCost: number;
  maxCost: number;
  searchText: string;
  showPredicates: boolean;
  predicateTypes: PredicateType[];
  animateEdges: boolean;
  scaleEdgeWidth: boolean;
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

export type ViewMode = 'hierarchical' | 'sankey' | 'flame' | 'tabular' | 'text' | 'sql' | 'metadata' | 'compare' | 'monitor' | 'experimental';
export type SankeyMetric = 'rows' | 'cost' | 'actualRows' | 'actualTime';
export type ExperimentalSubView = 'scatter' | 'timeline' | 'waterfall' | 'morph' | 'waits';
export type { FlameMetric } from './flameLayout';
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

export type ColorScheme =
  | 'contrast'
  | 'semantic'
  | 'estact'
  | 'rail'
  | 'ticker'
  | 'stripe'
  | 'tinted'
  | 'terminal';

/**
 * App palette — a third appearance axis next to theme (light/dark) and color
 * scheme (data paint). It re-skins the app's neutral surfaces and accent by
 * redefining the Tailwind slate/blue ramps under `html[data-palette=…]`
 * (see the palette blocks in index.css). 'slate' is the built-in look and
 * applies zero overrides.
 */
export type AppPalette = 'slate' | 'graphite' | 'teal' | 'violet' | 'paper';

export const APP_PALETTE_ORDER: AppPalette[] = ['slate', 'graphite', 'teal', 'violet', 'paper'];

export const APP_PALETTE_LABELS: Record<AppPalette, string> = {
  slate: 'Slate',
  graphite: 'Graphite',
  teal: 'Teal',
  violet: 'Violet',
  paper: 'Paper',
};

/** Full per-category hue map — the 'contrast' palette, shared by the schemes that paint every category. */
const FULL_CATEGORY_PALETTE: Record<string, string> = {
  'Table Access': '#d97706',
  'Index Operations': '#059669',
  'Join Operations': '#2563eb',
  'Set Operations': '#7c3aed',
  'Aggregation': '#db2777',
  'Sort Operations': '#ea580c',
  'Filter/View': '#0891b2',
  'Partition': '#4f46e5',
  'Parallelism': '#e11d48',
  'Other': '#475569',
};

export const COLOR_SCHEME_PALETTES: Record<ColorScheme, Record<string, string>> = {
  contrast: {
    'Table Access': '#d97706',
    'Index Operations': '#059669',
    'Join Operations': '#2563eb',
    'Set Operations': '#7c3aed',
    'Aggregation': '#db2777',
    'Sort Operations': '#ea580c',
    'Filter/View': '#0891b2',
    'Partition': '#4f46e5',
    'Parallelism': '#e11d48',
    'Other': '#475569',
  },
  semantic: {
    'Table Access': '#d97706',
    'Index Operations': '#059669',
    'Join Operations': '#2563eb',
    'Set Operations': '#64748b',
    'Aggregation': '#64748b',
    'Sort Operations': '#ea580c',
    'Filter/View': '#64748b',
    'Partition': '#64748b',
    'Parallelism': '#7c3aed',
    'Other': '#94a3b8',
  },
  estact: {
    'Table Access': '#d97706',
    'Index Operations': '#059669',
    'Join Operations': '#2563eb',
    'Set Operations': '#7c3aed',
    'Aggregation': '#db2777',
    'Sort Operations': '#ea580c',
    'Filter/View': '#0891b2',
    'Partition': '#4f46e5',
    'Parallelism': '#e11d48',
    'Other': '#475569',
  },
  rail: {
    'Table Access': '#d97706',
    'Index Operations': '#059669',
    'Join Operations': '#2563eb',
    'Set Operations': '#7c3aed',
    'Aggregation': '#db2777',
    'Sort Operations': '#ea580c',
    'Filter/View': '#0891b2',
    'Partition': '#4f46e5',
    'Parallelism': '#e11d48',
    'Other': '#475569',
  },
  ticker: {
    'Table Access': '#d97706',
    'Index Operations': '#059669',
    'Join Operations': '#2563eb',
    'Set Operations': '#7c3aed',
    'Aggregation': '#db2777',
    'Sort Operations': '#ea580c',
    'Filter/View': '#0891b2',
    'Partition': '#4f46e5',
    'Parallelism': '#e11d48',
    'Other': '#475569',
  },
  stripe: FULL_CATEGORY_PALETTE,
  tinted: FULL_CATEGORY_PALETTE,
  terminal: FULL_CATEGORY_PALETTE,
};

/** Fallback hue for categories missing from a palette (slate-500). */
const CATEGORY_FALLBACK_HEX = '#64748b';

/**
 * Theme-aware paint for a category swatch in the data-viz views
 * (flame bars, sankey nodes, waterfall bars).
 *
 * Light mode keeps the saturated palette hex as a solid fill. Dark mode
 * follows the tree view's grammar instead — a tinted surface (hue at ~15%)
 * with a colored hairline (hue at ~60%) — so the canvas stays quiet and the
 * chrome, not the data, reads as the loudest thing on screen.
 */
export function getCategoryPaint(
  category: string,
  scheme: ColorScheme,
  isDark: boolean
): { fill: string; stroke: string } {
  const hex = COLOR_SCHEME_PALETTES[scheme]?.[category] || CATEGORY_FALLBACK_HEX;
  if (!isDark) return { fill: hex, stroke: hex };
  // Only 6-digit hexes can take an alpha suffix; anything else stays opaque.
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { fill: hex, stroke: hex };
  return { fill: `${hex}26`, stroke: `${hex}99` };
}

export const EDGE_SCHEME_COLORS: Record<ColorScheme, {
  light: { active: string; default: string; focus: string; dimmed: string };
  dark: { active: string; default: string; focus: string; dimmed: string };
}> = {
  contrast: {
    light: { active: '#475569', default: '#94a3b8', focus: '#0f172a', dimmed: '#e2e8f0' },
    dark: { active: '#94a3b8', default: '#475569', focus: '#e2e8f0', dimmed: '#1e293b' },
  },
  semantic: {
    light: { active: '#64748b', default: '#cbd5e1', focus: '#334155', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  estact: {
    light: { active: '#94a3b8', default: '#cbd5e1', focus: '#475569', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  rail: {
    light: { active: '#94a3b8', default: '#cbd5e1', focus: '#475569', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  ticker: {
    light: { active: '#94a3b8', default: '#cbd5e1', focus: '#475569', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  stripe: {
    light: { active: '#64748b', default: '#cbd5e1', focus: '#334155', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  tinted: {
    light: { active: '#64748b', default: '#cbd5e1', focus: '#334155', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
  terminal: {
    light: { active: '#64748b', default: '#cbd5e1', focus: '#334155', dimmed: '#f1f5f9' },
    dark: { active: '#64748b', default: '#334155', focus: '#94a3b8', dimmed: '#1e293b' },
  },
};

// Option E: High Contrast — clean white cards, bold category borders, dark accessible text.
// For projectors, screen sharing, and low-vision use: category is readable from both border and text.
const COLORS_CONTRAST: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-amber-600 dark:border-amber-500', text: 'text-amber-800 dark:text-amber-300' },
  'Index Operations': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-emerald-600 dark:border-emerald-500', text: 'text-emerald-800 dark:text-emerald-300' },
  'Join Operations': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-blue-600 dark:border-blue-500', text: 'text-blue-800 dark:text-blue-300' },
  'Set Operations': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-violet-600 dark:border-violet-500', text: 'text-violet-800 dark:text-violet-300' },
  'Aggregation': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-pink-600 dark:border-pink-500', text: 'text-pink-800 dark:text-pink-300' },
  'Sort Operations': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-orange-600 dark:border-orange-500', text: 'text-orange-800 dark:text-orange-300' },
  'Filter/View': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-cyan-600 dark:border-cyan-500', text: 'text-cyan-800 dark:text-cyan-300' },
  'Partition': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-indigo-600 dark:border-indigo-500', text: 'text-indigo-800 dark:text-indigo-300' },
  'Parallelism': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-rose-600 dark:border-rose-500', text: 'text-rose-800 dark:text-rose-300' },
  'Other': { bg: 'bg-white dark:bg-slate-900', border: 'border-2 border-slate-400 dark:border-slate-500', text: 'text-slate-700 dark:text-slate-300' },
};

// Option F: Semantic — color only where it changes how you read the plan.
// Data access (amber=table, green=index), joins (blue), sorts (orange), PX (violet); everything else stays quiet.
const COLORS_SEMANTIC: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-l-4 border-l-amber-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-amber-900 dark:text-amber-200' },
  'Index Operations': { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-l-4 border-l-emerald-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-emerald-900 dark:text-emerald-200' },
  'Join Operations': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-blue-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-blue-900 dark:text-blue-200' },
  'Set Operations': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-slate-300 dark:border-l-slate-600 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Aggregation': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-slate-300 dark:border-l-slate-600 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Sort Operations': { bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-l-4 border-l-orange-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-orange-900 dark:text-orange-200' },
  'Filter/View': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-slate-300 dark:border-l-slate-600 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Partition': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-slate-300 dark:border-l-slate-600 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
  'Parallelism': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-violet-500 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-violet-900 dark:text-violet-200' },
  'Other': { bg: 'bg-white dark:bg-slate-800/90', border: 'border-l-4 border-l-slate-300 dark:border-l-slate-600 border-y border-r border-slate-200 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-200' },
};

// Shared card chrome for the layout-focused schemes ('estact', 'rail'):
// quiet white cards with a single neutral border; category color carried by the operation name.
const COLORS_QUIET: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-amber-600 dark:text-amber-400' },
  'Index Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-emerald-600 dark:text-emerald-400' },
  'Join Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-blue-600 dark:text-blue-400' },
  'Set Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-violet-600 dark:text-violet-400' },
  'Aggregation': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-pink-600 dark:text-pink-400' },
  'Sort Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-orange-600 dark:text-orange-400' },
  'Filter/View': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-cyan-600 dark:text-cyan-400' },
  'Partition': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-indigo-600 dark:text-indigo-400' },
  'Parallelism': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-rose-600 dark:text-rose-400' },
  'Other': { bg: 'bg-white dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', text: 'text-slate-600 dark:text-slate-300' },
};

// Stripe — neutral card, thick category spine on the left, category-colored title.
// Identity lives in one edge + the operation name; the card itself stays out of the way.
const COLORS_STRIPE: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-amber-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-amber-700 dark:text-amber-300' },
  'Index Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-emerald-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-emerald-700 dark:text-emerald-300' },
  'Join Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-blue-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-blue-700 dark:text-blue-300' },
  'Set Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-violet-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-violet-700 dark:text-violet-300' },
  'Aggregation': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-pink-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-pink-700 dark:text-pink-300' },
  'Sort Operations': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-orange-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-orange-700 dark:text-orange-300' },
  'Filter/View': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-cyan-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-cyan-700 dark:text-cyan-300' },
  'Partition': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-indigo-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-indigo-700 dark:text-indigo-300' },
  'Parallelism': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-rose-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-rose-700 dark:text-rose-300' },
  'Other': { bg: 'bg-white dark:bg-slate-800', border: 'border-l-[5px] border-l-slate-400 dark:border-l-slate-500 border-y border-r border-slate-200/80 dark:border-y-slate-700 dark:border-r-slate-700', text: 'text-slate-700 dark:text-slate-300' },
};

// Tinted — the whole card carries a quiet category tint; identity is readable at
// a glance from across the canvas without any single loud edge.
const COLORS_TINTED: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-amber-50 dark:bg-amber-950/40', border: 'border border-amber-300/70 dark:border-amber-500/40', text: 'text-amber-800 dark:text-amber-200' },
  'Index Operations': { bg: 'bg-emerald-50 dark:bg-emerald-950/40', border: 'border border-emerald-300/70 dark:border-emerald-500/40', text: 'text-emerald-800 dark:text-emerald-200' },
  'Join Operations': { bg: 'bg-blue-50 dark:bg-blue-950/40', border: 'border border-blue-300/70 dark:border-blue-500/40', text: 'text-blue-800 dark:text-blue-200' },
  'Set Operations': { bg: 'bg-violet-50 dark:bg-violet-950/40', border: 'border border-violet-300/70 dark:border-violet-500/40', text: 'text-violet-800 dark:text-violet-200' },
  'Aggregation': { bg: 'bg-pink-50 dark:bg-pink-950/40', border: 'border border-pink-300/70 dark:border-pink-500/40', text: 'text-pink-800 dark:text-pink-200' },
  'Sort Operations': { bg: 'bg-orange-50 dark:bg-orange-950/40', border: 'border border-orange-300/70 dark:border-orange-500/40', text: 'text-orange-800 dark:text-orange-200' },
  'Filter/View': { bg: 'bg-cyan-50 dark:bg-cyan-950/40', border: 'border border-cyan-300/70 dark:border-cyan-500/40', text: 'text-cyan-800 dark:text-cyan-200' },
  'Partition': { bg: 'bg-indigo-50 dark:bg-indigo-950/40', border: 'border border-indigo-300/70 dark:border-indigo-500/40', text: 'text-indigo-800 dark:text-indigo-200' },
  'Parallelism': { bg: 'bg-rose-50 dark:bg-rose-950/40', border: 'border border-rose-300/70 dark:border-rose-500/40', text: 'text-rose-800 dark:text-rose-200' },
  'Other': { bg: 'bg-slate-50 dark:bg-slate-800/60', border: 'border border-slate-300/70 dark:border-slate-600/60', text: 'text-slate-700 dark:text-slate-200' },
};

// Terminal — hairline category border on a near-black card (white in light mode);
// PlanNode pairs it with square corners, a mono operation name and a hard offset shadow.
const COLORS_TERMINAL: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-amber-600/70 dark:border-amber-400/60', text: 'text-amber-700 dark:text-amber-300' },
  'Index Operations': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-emerald-600/70 dark:border-emerald-400/60', text: 'text-emerald-700 dark:text-emerald-300' },
  'Join Operations': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-blue-600/70 dark:border-blue-400/60', text: 'text-blue-700 dark:text-blue-300' },
  'Set Operations': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-violet-600/70 dark:border-violet-400/60', text: 'text-violet-700 dark:text-violet-300' },
  'Aggregation': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-pink-600/70 dark:border-pink-400/60', text: 'text-pink-700 dark:text-pink-300' },
  'Sort Operations': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-orange-600/70 dark:border-orange-400/60', text: 'text-orange-700 dark:text-orange-300' },
  'Filter/View': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-cyan-600/70 dark:border-cyan-400/60', text: 'text-cyan-700 dark:text-cyan-300' },
  'Partition': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-indigo-600/70 dark:border-indigo-400/60', text: 'text-indigo-700 dark:text-indigo-300' },
  'Parallelism': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-rose-600/70 dark:border-rose-400/60', text: 'text-rose-700 dark:text-rose-300' },
  'Other': { bg: 'bg-white dark:bg-[#0c1017]', border: 'border border-slate-400/70 dark:border-slate-500/60', text: 'text-slate-700 dark:text-slate-300' },
};

export const COLOR_SCHEMES: Record<ColorScheme, Record<string, { bg: string; border: string; text: string }>> = {
  contrast: COLORS_CONTRAST,
  semantic: COLORS_SEMANTIC,
  estact: COLORS_QUIET,
  rail: COLORS_QUIET,
  ticker: COLORS_QUIET,
  stripe: COLORS_STRIPE,
  tinted: COLORS_TINTED,
  terminal: COLORS_TERMINAL,
};

export function getCostColor(cost: number, totalCost: number): string {
  if (totalCost === 0) return 'bg-slate-200 dark:bg-slate-700';
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
