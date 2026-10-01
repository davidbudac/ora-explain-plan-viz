/**
 * Pure helpers for the Tabular view (`TabularView.tsx`): A-Time share,
 * sort-state cycling, and the "Copy as TSV" serializer.
 */
import type { PlanNode } from './types';
import { nodeCardinalityRatio } from './format';

// ---------------------------------------------------------------------------
// A-Time share of total elapsed time
// ---------------------------------------------------------------------------

/**
 * Denominator for "share of total elapsed time" percentages.
 *
 * Per-line A-Time is cumulative (includes children), and SQL Monitor reports
 * can carry a statement elapsed time that is *smaller* than the root line's
 * A-Time (e.g. the "Partitioned Star Query" example: 326 ms elapsed vs a
 * 1000 ms root line, which used to render as 307%). Taking the larger of the
 * two keeps every share within 0–100%. Non-finite / negative inputs are ignored.
 */
export function timeShareDenominator(
  totalElapsedTime: number | undefined,
  nodes: readonly Pick<PlanNode, 'actualTime'>[],
): number {
  let max = isUsable(totalElapsedTime) ? totalElapsedTime : 0;
  for (const node of nodes) {
    const t = node.actualTime;
    if (isUsable(t) && t > max) max = t;
  }
  return max;
}

/** Share (0–1) of `actualTime` in `denominator`; 0 when either is unusable. */
export function timeShare(actualTime: number | undefined, denominator: number): number {
  if (!isUsable(actualTime) || !isUsable(denominator) || denominator <= 0) return 0;
  return Math.min(1, Math.max(0, actualTime / denominator));
}

function isUsable(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type TabularSortColumn =
  | 'id' | 'cost' | 'rows' | 'actualRows' | 'actualTime'
  | 'activityPercent' | 'starts' | 'memoryUsed' | 'tempUsed';
export type TabularSortDirection = 'asc' | 'desc';
export interface TabularSortState {
  column: TabularSortColumn;
  direction: TabularSortDirection;
}

/** Plan order (Id ascending) — the tree order the view starts in. */
export const DEFAULT_SORT: TabularSortState = { column: 'id', direction: 'asc' };

/**
 * Header click cycle: a new column sorts ascending, a second click sorts
 * descending, and a third click resets to plan order (Id ascending).
 */
export function nextSortState(current: TabularSortState, clicked: TabularSortColumn): TabularSortState {
  if (current.column !== clicked) return { column: clicked, direction: 'asc' };
  if (current.direction === 'asc') return { column: clicked, direction: 'desc' };
  return DEFAULT_SORT;
}

/** `aria-sort` value for a column header given the current sort. */
export function ariaSortFor(
  column: TabularSortColumn,
  current: TabularSortState,
): 'ascending' | 'descending' | 'none' {
  if (current.column !== column) return 'none';
  return current.direction === 'asc' ? 'ascending' : 'descending';
}

// ---------------------------------------------------------------------------
// Copy as TSV
// ---------------------------------------------------------------------------

export type TabularTsvColumn =
  | 'id' | 'operation'
  | 'rows' | 'cost'
  | 'actualRows' | 'actualTime' | 'activityPercent' | 'starts' | 'memoryUsed' | 'tempUsed'
  | 'cardinality';

export interface TsvOptions {
  /** Label the estimated-rows column "E-Rows" (plans with runtime stats) instead of "Rows". */
  hasActualStats?: boolean;
  /** Append Access / Filter predicate columns (default true). */
  includePredicates?: boolean;
}

/** Tabs/newlines inside a cell would break the TSV grid — collapse them to a space. */
export function sanitizeTsvCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, ' ').trim();
}

function num(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/**
 * Serialize the given rows (already filtered/sorted as displayed) to TSV with
 * a header row. Operation cells keep the plan indentation (two spaces per
 * depth level, like DBMS_XPLAN) and the object name gets its own column.
 * Numbers are raw (A-Time in ms, memory/temp in bytes) so spreadsheets can
 * compute with them.
 */
export function buildTabularTsv(
  nodes: readonly PlanNode[],
  columns: readonly TabularTsvColumn[],
  options: TsvOptions = {},
): string {
  const { hasActualStats = false, includePredicates = true } = options;
  const header: string[] = [];
  const cellFns: Array<(node: PlanNode) => string> = [];
  const add = (label: string, fn: (node: PlanNode) => string) => {
    header.push(label);
    cellFns.push(fn);
  };

  for (const column of columns) {
    switch (column) {
      case 'id':
        add('Id', (n) => String(n.id));
        break;
      case 'operation':
        add('Operation', (n) => '  '.repeat(Math.max(0, n.depth)) + n.operation);
        add('Object', (n) => n.objectName ?? '');
        break;
      case 'rows':
        add(hasActualStats ? 'E-Rows' : 'Rows', (n) => num(n.rows));
        break;
      case 'cost':
        add('Cost', (n) => num(n.cost));
        break;
      case 'actualRows':
        add('A-Rows', (n) => num(n.actualRows));
        break;
      case 'actualTime':
        add('A-Time (ms)', (n) => num(n.actualTime));
        break;
      case 'activityPercent':
        add('Activity %', (n) => num(n.activityPercent));
        break;
      case 'starts':
        add('Starts', (n) => num(n.starts));
        break;
      case 'memoryUsed':
        add('Memory (bytes)', (n) => num(n.memoryUsed));
        break;
      case 'tempUsed':
        add('Temp (bytes)', (n) => num(n.tempUsed));
        break;
      case 'cardinality':
        add('A-Rows / Est. total rows', (n) => {
          const ratio = nodeCardinalityRatio(n);
          if (ratio === undefined) return '';
          // Keep small under-estimates readable (0.00012, not 0).
          return String(Number(ratio >= 1 ? ratio.toFixed(2) : ratio.toPrecision(3)));
        });
        break;
    }
  }

  if (includePredicates) {
    add('Access Predicates', (n) => n.accessPredicates ?? '');
    add('Filter Predicates', (n) => n.filterPredicates ?? '');
  }

  // Header cells are plain labels; body cells may carry arbitrary plan text.
  // Operation cells keep their leading indentation, so only strip the right side.
  const lines = [header.join('\t')];
  for (const node of nodes) {
    lines.push(
      cellFns
        .map((fn, i) => {
          const raw = fn(node);
          return header[i] === 'Operation'
            ? raw.replace(/[\t\r\n]+/g, ' ').replace(/\s+$/, '')
            : sanitizeTsvCell(raw);
        })
        .join('\t'),
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Expand / collapse all
// ---------------------------------------------------------------------------

/**
 * "Collapse all" for the table: every operation that has children except the
 * root, so the table shows the root and its direct children as collapsed
 * stubs (same semantics as the tree view's collapse-all).
 */
export function collapseAllIds(nodes: readonly Pick<PlanNode, 'id' | 'parentId' | 'children'>[]): Set<number> {
  const ids = new Set<number>();
  for (const node of nodes) {
    if (node.parentId !== undefined && node.children.length > 0) ids.add(node.id);
  }
  return ids;
}
