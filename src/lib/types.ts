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

export interface ParsedPlan {
  planHashValue?: string;
  rootNode: PlanNode | null;
  allNodes: PlanNode[];
  totalCost: number;
  maxRows: number;

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
  nodeDisplayOptions: NodeDisplayOptions;
  // SQL Monitor actual statistics filters
  minActualRows: number;
  maxActualRows: number;
  minActualTime: number;
  maxActualTime: number;
}

export type ViewMode = 'hierarchical' | 'sankey';
export type SankeyMetric = 'rows' | 'cost';
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

export const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  'Table Access': { bg: 'bg-orange-100 dark:bg-orange-900/30', border: 'border-orange-400', text: 'text-orange-700 dark:text-orange-300' },
  'Index Operations': { bg: 'bg-green-100 dark:bg-green-900/30', border: 'border-green-400', text: 'text-green-700 dark:text-green-300' },
  'Join Operations': { bg: 'bg-blue-100 dark:bg-blue-900/30', border: 'border-blue-400', text: 'text-blue-700 dark:text-blue-300' },
  'Set Operations': { bg: 'bg-purple-100 dark:bg-purple-900/30', border: 'border-purple-400', text: 'text-purple-700 dark:text-purple-300' },
  'Aggregation': { bg: 'bg-pink-100 dark:bg-pink-900/30', border: 'border-pink-400', text: 'text-pink-700 dark:text-pink-300' },
  'Sort Operations': { bg: 'bg-yellow-100 dark:bg-yellow-900/30', border: 'border-yellow-400', text: 'text-yellow-700 dark:text-yellow-300' },
  'Filter/View': { bg: 'bg-cyan-100 dark:bg-cyan-900/30', border: 'border-cyan-400', text: 'text-cyan-700 dark:text-cyan-300' },
  'Partition': { bg: 'bg-indigo-100 dark:bg-indigo-900/30', border: 'border-indigo-400', text: 'text-indigo-700 dark:text-indigo-300' },
  'Other': { bg: 'bg-gray-100 dark:bg-gray-800', border: 'border-gray-400', text: 'text-gray-700 dark:text-gray-300' },
};

export function getCostColor(cost: number, totalCost: number): string {
  if (totalCost === 0) return 'bg-gray-200 dark:bg-gray-700';
  const ratio = cost / totalCost;
  if (ratio >= 0.5) return 'bg-red-500';
  if (ratio >= 0.25) return 'bg-orange-500';
  if (ratio >= 0.1) return 'bg-yellow-500';
  return 'bg-green-500';
}
