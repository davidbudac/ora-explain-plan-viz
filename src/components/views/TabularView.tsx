import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { usePlan } from '../../hooks/usePlanContext';
import type { PlanNode } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, nodeCardinalityRatio, formatCardinalityRatio, cardinalityRatioSeverity, formatPartitionRange } from '../../lib/format';
import { getHighlightColorDef } from '../../lib/annotations';
import type { AnnotationGroup } from '../../lib/annotations';
import { isFilterActive, matchesFilters } from '../../lib/filtering';
import { computeHottestNodeId } from '../../lib/analysis';
import { copyToClipboard } from '../../lib/clipboard';
import {
  ariaSortFor,
  buildTabularTsv,
  collapseAllIds,
  DEFAULT_SORT,
  nextSortState,
  timeShare,
  timeShareDenominator,
} from '../../lib/tabularHelpers';
import type { TabularSortColumn, TabularSortState } from '../../lib/tabularHelpers';
import { HighlightText } from '../HighlightText';
import { INACTIVE_NODE_TOOLTIP } from '../../lib/nodeAriaLabel';

const EMPTY_SELECTED_NODE_IDS: number[] = [];

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

type SortColumn = TabularSortColumn;
type ColumnKey =
  | 'id' | 'operation'
  | 'rows' | 'cost'
  | 'actualRows' | 'actualTime' | 'activityPercent' | 'starts' | 'memoryUsed' | 'tempUsed'
  | 'cardinality';

const COLUMN_DEFAULT_WIDTHS: Record<ColumnKey, number> = {
  id: 48,
  operation: 340,
  rows: 90,
  cost: 110,
  actualRows: 90,
  actualTime: 130,
  activityPercent: 80,
  starts: 70,
  memoryUsed: 90,
  tempUsed: 90,
  cardinality: 80,
};
const COLUMN_MIN_WIDTH: Record<ColumnKey, number> = {
  id: 36, operation: 160, rows: 56, cost: 56, actualRows: 56,
  actualTime: 72, activityPercent: 56, starts: 48, memoryUsed: 56, tempUsed: 56, cardinality: 48,
};
const COLUMN_WIDTHS_STORAGE_KEY = 'tabularView.columnWidths.v1';

/** Sibling of the column-widths key: view toggles that should survive reloads. */
const PREFS_STORAGE_KEY = 'tabularView.prefs.v1';
interface TabularPrefs {
  hideFilteredRows: boolean;
  wrapPredicates: boolean;
}
const DEFAULT_PREFS: TabularPrefs = { hideFilteredRows: false, wrapPredicates: false };

function loadPrefs(): TabularPrefs {
  try {
    const saved = localStorage.getItem(PREFS_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<TabularPrefs>;
      return {
        hideFilteredRows: typeof parsed.hideFilteredRows === 'boolean' ? parsed.hideFilteredRows : DEFAULT_PREFS.hideFilteredRows,
        wrapPredicates: typeof parsed.wrapPredicates === 'boolean' ? parsed.wrapPredicates : DEFAULT_PREFS.wrapPredicates,
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_PREFS };
}

/** Fallback header height until the real <thead> is measured (two header rows). */
const DEFAULT_HEADER_HEIGHT = 50;

type CopyStatus = 'idle' | 'copied' | 'failed';

/** Collect all descendant IDs of a node (not including the node itself). */
function collectDescendantIds(node: PlanNode, out: Set<number>) {
  for (const child of node.children) {
    out.add(child.id);
    collectDescendantIds(child, out);
  }
}

function hasPredicateLine(node: PlanNode): boolean {
  return !!(node.accessPredicates || node.filterPredicates || formatPartitionRange(node.pstart, node.pstop));
}

/** Row height estimate for the virtualizer; real heights are measured once rendered. */
function estimateRowHeight(node: PlanNode | undefined): number {
  if (!node) return 30;
  return hasPredicateLine(node) ? 48 : 30;
}

function ResizeHandle({
  column,
  onResizeStart,
  onResizeDoubleClick,
}: {
  column: ColumnKey;
  onResizeStart: (column: ColumnKey, e: React.MouseEvent) => void;
  onResizeDoubleClick: (column: ColumnKey, e: React.MouseEvent) => void;
}) {
  return (
    <span
      onMouseDown={(e) => onResizeStart(column, e)}
      onDoubleClick={(e) => onResizeDoubleClick(column, e)}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize, double-click to reset"
      aria-hidden="true"
      className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-30 hover:bg-blue-400/50 active:bg-blue-500/70"
      style={{ marginRight: '-3px' }}
    />
  );
}

/**
 * Sortable column header: a real <button> inside the <th> (keyboard- and
 * screen-reader-operable), `aria-sort` on the <th>, and a visible indicator.
 */
function SortableHeader({
  column,
  sort,
  onSort,
  className,
  title,
  children,
  resize,
}: {
  column: SortColumn;
  sort: TabularSortState;
  onSort: (column: SortColumn) => void;
  className: string;
  title?: string;
  children: ReactNode;
  resize: ReactNode;
}) {
  const ariaSort = ariaSortFor(column, sort);
  return (
    <th className={className} aria-sort={ariaSort} scope="col" title={title}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`group inline-flex w-full items-center justify-end gap-0.5 rounded-sm font-medium hover:text-slate-800 dark:hover:text-slate-100 ${FOCUS_RING}`}
      >
        <span className="truncate">{children}</span>
        <span
          aria-hidden="true"
          className={
            ariaSort === 'none'
              ? 'w-2.5 text-center text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'
              : 'w-2.5 text-center text-blue-500'
          }
        >
          {ariaSort === 'ascending' ? '▲' : ariaSort === 'descending' ? '▼' : '↕'}
        </span>
      </button>
      {resize}
    </th>
  );
}

/**
 * Inline access / filter predicates (+ partition range) for one row. Clamped
 * to two lines unless wrapping is on globally or the row is expanded; a
 * "more"/"less" button appears only when the clamped text actually overflows.
 */
function PredicateBlock({
  node,
  searchText,
  wrapAll,
  expanded,
  onToggle,
}: {
  node: PlanNode;
  searchText: string;
  wrapAll: boolean;
  expanded: boolean;
  onToggle: (nodeId: number) => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const clamped = !wrapAll && !expanded;

  // ResizeObserver delivers an initial notification on observe(), so this
  // also covers the first render; it re-checks when column widths change.
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el || !clamped || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [clamped, node.accessPredicates, node.filterPredicates]);

  const partitionRange = formatPartitionRange(node.pstart, node.pstop);
  const showToggle = !wrapAll && (expanded || overflowing);

  return (
    <div className="ml-[calc(0.875rem+0.25rem)] mt-0.5 flex items-end gap-1 min-w-0">
      <div
        ref={textRef}
        className={`min-w-0 flex-1 text-[10px] font-mono text-slate-400 dark:text-slate-500 whitespace-pre-wrap break-all leading-tight ${clamped ? 'line-clamp-2' : ''}`}
      >
        {node.accessPredicates && (
          <span>
            <span className="text-blue-400 dark:text-blue-500">A:</span>{' '}
            <HighlightText text={node.accessPredicates} query={searchText} />
          </span>
        )}
        {node.accessPredicates && node.filterPredicates && (
          <span className="mx-1.5 text-slate-300 dark:text-slate-600">|</span>
        )}
        {node.filterPredicates && (
          <span>
            <span className="text-amber-400 dark:text-amber-500">F:</span>{' '}
            <HighlightText text={node.filterPredicates} query={searchText} />
          </span>
        )}
        {(node.accessPredicates || node.filterPredicates) && partitionRange && (
          <span className="mx-1.5 text-slate-300 dark:text-slate-600">|</span>
        )}
        {partitionRange && (
          <span title={`Pstart: ${node.pstart ?? '—'}, Pstop: ${node.pstop ?? '—'}`}>
            <span className="text-indigo-400 dark:text-indigo-500">Part:</span> {partitionRange}
          </span>
        )}
      </div>
      {showToggle && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle(node.id);
          }}
          aria-expanded={expanded}
          aria-label={expanded ? `Show less of the predicates for operation ${node.id}` : `Show all predicates for operation ${node.id}`}
          className={`shrink-0 rounded px-1 text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 ${FOCUS_RING}`}
        >
          {expanded ? 'less' : 'more'}
        </button>
      )}
    </div>
  );
}

function ToolbarButton({
  onClick,
  pressed,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const isToggle = pressed !== undefined;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={isToggle ? pressed : undefined}
      title={title}
      className={`shrink-0 whitespace-nowrap px-2 py-1 rounded-md text-[11px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS_RING} ${
        pressed
          ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300'
          : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-800'
      }`}
    >
      {children}
    </button>
  );
}

interface TabularViewProps {
  planIndex?: number;
}

export function TabularView({ planIndex }: TabularViewProps = {}) {
  const {
    plans,
    activePlanIndex,
    selectNodeForPlan,
    setActivePlan,
    filters,
    hotspotsEnabled,
    getAnnotationsForPlan,
  } = usePlan();

  const resolvedPlanIndex = planIndex ?? activePlanIndex;
  const slot = plans[resolvedPlanIndex];
  const parsedPlan = slot?.parsedPlan ?? null;
  const selectedNodeIds = slot?.selectedNodeIds ?? EMPTY_SELECTED_NODE_IDS;

  const selectNode = useCallback(
    (id: number | null, options?: { additive?: boolean }) => {
      setActivePlan(resolvedPlanIndex);
      selectNodeForPlan(resolvedPlanIndex, id, options);
    },
    [resolvedPlanIndex, selectNodeForPlan, setActivePlan]
  );

  // Derive node lookup, filter set, and hot node locally so this view works for
  // any plan slot (not just the active one).
  const nodeById = useMemo(() => {
    if (!parsedPlan) return new Map<number, PlanNode>();
    return new Map(parsedPlan.allNodes.map((node) => [node.id, node]));
  }, [parsedPlan]);

  const filteredNodeIds = useMemo(() => {
    if (!parsedPlan) return new Set<number>();
    const hasActualStats = parsedPlan.hasActualStats ?? false;
    return new Set(
      parsedPlan.allNodes
        .filter((node) => matchesFilters(node, filters, hasActualStats))
        .map((node) => node.id)
    );
  }, [parsedPlan, filters]);
  // With no active filter every node matches; with an active filter that
  // matches nothing the set is empty and *every* row must dim.
  const filterActive = isFilterActive(filters);

  const hottestNodeId = useMemo(
    (): number | null => (hotspotsEnabled ? computeHottestNodeId(parsedPlan) : null),
    [parsedPlan, hotspotsEnabled]
  );

  const [sort, setSort] = useState<TabularSortState>(DEFAULT_SORT);
  const sortColumn = sort.column;
  const sortDirection = sort.direction;
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (saved) return { ...COLUMN_DEFAULT_WIDTHS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...COLUMN_DEFAULT_WIDTHS };
  });
  const [prefs, setPrefs] = useState<TabularPrefs>(loadPrefs);
  const { hideFilteredRows, wrapPredicates } = prefs;
  const resizingRef = useRef<{ column: ColumnKey; startX: number; startWidth: number } | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [expandedPredicateIds, setExpandedPredicateIds] = useState<Set<number>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: number; x: number; y: number } | null>(null);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [headerHeight, setHeaderHeight] = useState(DEFAULT_HEADER_HEIGHT);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const lastScrolledSelectionRef = useRef<readonly number[] | null>(null);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const searchText = filters.searchText?.trim() ?? '';
  const hasActualStats = parsedPlan?.hasActualStats ?? false;
  const showAnnotations = filters.nodeDisplayOptions?.showAnnotations ?? true;

  // Hide columns that have no data across any node in the plan.
  const hasData = useMemo(() => {
    const nodes = parsedPlan?.allNodes ?? [];
    const anyNonNull = (field: keyof PlanNode) => nodes.some(n => n[field] != null);
    return {
      rows: anyNonNull('rows'),
      cost: anyNonNull('cost'),
      actualRows: anyNonNull('actualRows'),
      actualTime: anyNonNull('actualTime'),
      activityPercent: anyNonNull('activityPercent'),
      starts: anyNonNull('starts'),
      memoryUsed: anyNonNull('memoryUsed'),
      tempUsed: anyNonNull('tempUsed'),
    };
  }, [parsedPlan]);

  const visibleColumns = useMemo<ColumnKey[]>(() => {
    const cols: ColumnKey[] = ['id', 'operation'];
    if (hasData.rows) cols.push('rows');
    if (hasData.cost) cols.push('cost');
    if (hasActualStats) {
      if (hasData.actualRows) cols.push('actualRows');
      if (hasData.actualTime) cols.push('actualTime');
      if (hasData.activityPercent) cols.push('activityPercent');
      if (hasData.starts) cols.push('starts');
      if (hasData.memoryUsed) cols.push('memoryUsed');
      if (hasData.tempUsed) cols.push('tempUsed');
    }
    if (hasActualStats && hotspotsEnabled && hasData.rows && hasData.actualRows) cols.push('cardinality');
    return cols;
  }, [hasData, hasActualStats, hotspotsEnabled]);

  useEffect(() => {
    try { localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(columnWidths)); } catch { /* ignore */ }
  }, [columnWidths]);

  useEffect(() => {
    try { localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
  }, [prefs]);

  const handleResizeStart = useCallback((column: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = columnWidths[column] ?? COLUMN_DEFAULT_WIDTHS[column];
    resizingRef.current = { column, startX: e.clientX, startWidth };
    const onMove = (ev: MouseEvent) => {
      const info = resizingRef.current;
      if (!info) return;
      const delta = ev.clientX - info.startX;
      const min = COLUMN_MIN_WIDTH[info.column];
      const next = Math.max(min, info.startWidth + delta);
      setColumnWidths(prev => prev[info.column] === next ? prev : { ...prev, [info.column]: next });
    };
    const onUp = () => {
      resizingRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  const handleResizeDoubleClick = useCallback((column: ColumnKey, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setColumnWidths(prev => ({ ...prev, [column]: COLUMN_DEFAULT_WIDTHS[column] }));
  }, []);

  const estimatedColSpan = (hasData.rows ? 1 : 0) + (hasData.cost ? 1 : 0);
  const actualColCount =
    (hasData.actualRows ? 1 : 0) + (hasData.actualTime ? 1 : 0) + (hasData.activityPercent ? 1 : 0) +
    (hasData.starts ? 1 : 0) + (hasData.memoryUsed ? 1 : 0) + (hasData.tempUsed ? 1 : 0);
  const showCardinalityCol = hasActualStats && hotspotsEnabled && hasData.rows && hasData.actualRows;
  const actualColSpan = actualColCount + (showCardinalityCol ? 1 : 0);
  const showActualGroup = hasActualStats && actualColSpan > 0;

  const planAnnotations = getAnnotationsForPlan(resolvedPlanIndex);
  const effectiveAnnotations = useMemo(
    () => showAnnotations ? planAnnotations : { nodeAnnotations: new Map(), nodeHighlights: new Map(), groups: [] as AnnotationGroup[] },
    [planAnnotations, showAnnotations]
  );

  // Build a map of nodeId -> groups it belongs to
  const nodeGroupMap = useMemo(() => {
    const map = new Map<number, typeof effectiveAnnotations.groups>();
    for (const group of effectiveAnnotations.groups) {
      for (const nodeId of group.nodeIds) {
        const existing = map.get(nodeId);
        if (existing) existing.push(group);
        else map.set(nodeId, [group]);
      }
    }
    return map;
  }, [effectiveAnnotations]);

  // Build a set of all IDs hidden by collapsed parents
  const hiddenByCollapse = useMemo(() => {
    const hidden = new Set<number>();
    for (const id of collapsedIds) {
      const node = nodeById.get(id);
      if (node) collectDescendantIds(node, hidden);
    }
    return hidden;
  }, [collapsedIds, nodeById]);

  // Build the set of hovered node + all its descendants for highlight
  const hoverHighlightIds = useMemo(() => {
    if (hoveredNodeId === null) return new Set<number>();
    const node = nodeById.get(hoveredNodeId);
    if (!node) return new Set<number>();
    const ids = new Set<number>([hoveredNodeId]);
    collectDescendantIds(node, ids);
    return ids;
  }, [hoveredNodeId, nodeById]);

  // Pre-compute tree line data: for each node, which depths have continuing siblings
  const treeLineData = useMemo(() => {
    const data = new Map<number, Set<number>>();
    for (const node of parsedPlan?.allNodes ?? []) {
      const continuing = new Set<number>();
      let current: PlanNode | undefined = node;
      while (current && current.parentId !== undefined) {
        const parent = nodeById.get(current.parentId);
        if (!parent) break;
        const isLastChild = parent.children[parent.children.length - 1].id === current.id;
        if (!isLastChild) continuing.add(current.depth);
        current = parent;
      }
      data.set(node.id, continuing);
    }
    return data;
  }, [parsedPlan, nodeById]);

  const isTreeOrder = sortColumn === 'id' && sortDirection === 'asc';
  // Tree connector lines only make sense when every row is shown in plan order.
  const hidingFilteredRows = hideFilteredRows && filterActive;
  const drawTreeLines = isTreeOrder && !hidingFilteredRows;

  const flatNodes = useMemo(() => {
    if (!parsedPlan?.allNodes) return [];
    return [...parsedPlan.allNodes];
  }, [parsedPlan]);

  const allParentIds = useMemo(() => collapseAllIds(flatNodes), [flatNodes]);
  const allCollapsed = allParentIds.size > 0 && [...allParentIds].every((id) => collapsedIds.has(id));

  /** Rows as displayed: collapse + "hide filtered rows" applied, then sorted. */
  const sortedNodes = useMemo(() => {
    let nodes = flatNodes;

    // Filter out nodes hidden by collapsed parents
    if (hiddenByCollapse.size > 0) {
      nodes = nodes.filter(n => !hiddenByCollapse.has(n.id));
    }

    if (hidingFilteredRows) {
      nodes = nodes.filter(n => filteredNodeIds.has(n.id));
    }

    if (sortColumn === 'id' && sortDirection === 'asc') return nodes;

    const sorted = [...nodes];
    sorted.sort((a, b) => {
      const getValue = (node: PlanNode): number => {
        switch (sortColumn) {
          case 'id': return node.id;
          case 'cost': return node.cost ?? 0;
          case 'rows': return node.rows ?? 0;
          case 'actualRows': return node.actualRows ?? 0;
          case 'actualTime': return node.actualTime ?? 0;
          case 'activityPercent': return node.activityPercent ?? 0;
          case 'starts': return node.starts ?? 0;
          case 'memoryUsed': return node.memoryUsed ?? 0;
          case 'tempUsed': return node.tempUsed ?? 0;
        }
      };
      const diff = getValue(a) - getValue(b);
      return sortDirection === 'asc' ? diff : -diff;
    });
    return sorted;
  }, [flatNodes, sortColumn, sortDirection, hiddenByCollapse, hidingFilteredRows, filteredNodeIds]);

  const totalCost = parsedPlan?.totalCost ?? 0;
  // Per-line A-Time can exceed the reported elapsed time; see timeShareDenominator.
  const timeDenominator = useMemo(
    () => timeShareDenominator(parsedPlan?.totalElapsedTime, parsedPlan?.allNodes ?? []),
    [parsedPlan]
  );

  // Measure the sticky two-row header: the virtualizer needs it as scroll
  // margin (rows start below it) and scroll padding (so a row scrolled into
  // view isn't hidden underneath it).
  useLayoutEffect(() => {
    const thead = theadRef.current;
    if (!thead || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      const height = thead.offsetHeight;
      if (height > 0) setHeaderHeight((prev) => (prev === height ? prev : height));
    });
    observer.observe(thead);
    return () => observer.disconnect();
  }, [parsedPlan]);

  // TanStack Virtual returns non-memoizable functions; this view is not compiled
  // by the React Compiler, so the library's re-render model applies as usual.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: sortedNodes.length,
    getScrollElement: () => tableRef.current,
    estimateSize: (index) => estimateRowHeight(sortedNodes[index]),
    getItemKey: (index) => sortedNodes[index]?.id ?? index,
    overscan: 12,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
  });

  // Wrapping changes most row heights at once, including rows measured earlier
  // and now off-screen — drop the cached sizes so the scroll extent is right.
  useEffect(() => {
    rowVirtualizer.measure();
  }, [wrapPredicates, rowVirtualizer]);

  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => nextSortState(prev, column));
  }, []);

  const handleRowClick = useCallback((node: PlanNode, event: React.MouseEvent) => {
    selectNode(node.id, { additive: event.metaKey || event.ctrlKey });
  }, [selectNode]);

  const toggleCollapse = useCallback((nodeId: number) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const togglePredicateExpanded = useCallback((nodeId: number) => {
    setExpandedPredicateIds(prev => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  const handleRowMouseEnter = useCallback((node: PlanNode, event: React.MouseEvent) => {
    setHoveredNodeId(node.id);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    const hasAnnotation = effectiveAnnotations.nodeAnnotations.has(node.id);
    if (hasAnnotation) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const containerRect = tableRef.current?.getBoundingClientRect();
      if (containerRect) {
        setTooltip({
          nodeId: node.id,
          x: event.clientX - containerRect.left + tableRef.current!.scrollLeft,
          y: rect.bottom - containerRect.top + tableRef.current!.scrollTop,
        });
      }
    } else {
      setTooltip(null);
    }
  }, [effectiveAnnotations.nodeAnnotations]);

  const handleRowMouseLeave = useCallback(() => {
    tooltipTimerRef.current = setTimeout(() => setTooltip(null), 100);
  }, []);

  // Keyboard navigation (works across virtualised rows: it walks the data, and
  // the selection effect below scrolls the target row into view).
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (!sortedNodes.length) return;

    if (event.key === 'Escape') {
      selectNode(null);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const currentId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;
      const currentIndex = currentId !== null ? sortedNodes.findIndex(n => n.id === currentId) : -1;

      let nextIndex: number;
      if (event.key === 'ArrowDown') {
        nextIndex = currentIndex < sortedNodes.length - 1 ? currentIndex + 1 : 0;
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : sortedNodes.length - 1;
      }

      selectNode(sortedNodes[nextIndex].id);
    }

    // Left arrow to collapse, Right arrow to expand
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const currentId = selectedNodeIds.length > 0 ? selectedNodeIds[selectedNodeIds.length - 1] : null;
      if (currentId === null) return;
      const node = nodeById.get(currentId);
      if (!node || node.children.length === 0) return;

      event.preventDefault();
      setCollapsedIds(prev => {
        const next = new Set(prev);
        if (event.key === 'ArrowLeft') {
          next.add(currentId);
        } else {
          next.delete(currentId);
        }
        return next;
      });
    }
  }, [sortedNodes, selectedNodeIds, selectNode, nodeById]);

  // Auto-scroll the selected row into view when the selection changes
  // (keyboard navigation, or a selection made in another view / panel).
  // Collapsing, sorting or filtering alone does not re-scroll.
  useEffect(() => {
    if (lastScrolledSelectionRef.current === selectedNodeIds) return;
    lastScrolledSelectionRef.current = selectedNodeIds;
    if (selectedNodeIds.length !== 1) return;
    const index = sortedNodes.findIndex((n) => n.id === selectedNodeIds[0]);
    if (index >= 0) rowVirtualizer.scrollToIndex(index, { align: 'auto' });
  }, [selectedNodeIds, sortedNodes, rowVirtualizer]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  // Reset collapsed / expanded-predicate state when plan changes
  const [prevPlan, setPrevPlan] = useState(parsedPlan);
  if (prevPlan !== parsedPlan) {
    setPrevPlan(parsedPlan);
    setCollapsedIds(new Set());
    setExpandedPredicateIds(new Set());
  }

  const handleCopyTsv = async () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    const tsv = buildTabularTsv(sortedNodes, visibleColumns, { hasActualStats });
    const ok = await copyToClipboard(tsv);
    setCopyStatus(ok ? 'copied' : 'failed');
    copyTimerRef.current = setTimeout(() => setCopyStatus('idle'), ok ? 1500 : 2500);
  };

  if (!parsedPlan) return null;

  const totalRows = parsedPlan.allNodes.length;
  const rowCountLabel = sortedNodes.length === totalRows
    ? `${totalRows} rows`
    : `${sortedNodes.length} of ${totalRows} rows`;

  const virtualItems = rowVirtualizer.getVirtualItems();
  const scrollMargin = rowVirtualizer.options.scrollMargin;
  const paddingTop = virtualItems.length > 0 ? Math.max(0, virtualItems[0].start - scrollMargin) : 0;
  const paddingBottom = virtualItems.length > 0
    ? Math.max(0, rowVirtualizer.getTotalSize() - (virtualItems[virtualItems.length - 1].end - scrollMargin))
    : 0;
  const columnCount = visibleColumns.length;

  const groupThClass = 'px-2 py-1 text-center text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 select-none';
  const thClass = 'relative px-2 py-1.5 text-left text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 sticky top-[22px] z-10 border-b border-slate-200 dark:border-slate-700 select-none';
  const thRightClass = 'text-right';
  const groupBorderClass = 'border-l border-slate-200 dark:border-slate-700';
  const bodyGroupBorderClass = 'border-l border-slate-100 dark:border-slate-800';

  const resizeHandle = (column: ColumnKey) => (
    <ResizeHandle column={column} onResizeStart={handleResizeStart} onResizeDoubleClick={handleResizeDoubleClick} />
  );

  return (
    <div className="h-full flex flex-col min-h-0 bg-white dark:bg-slate-950">
      {/* Toolbar */}
      <div className="h-9 shrink-0 flex items-center gap-1.5 overflow-x-auto px-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
        <ToolbarButton
          onClick={() => setCollapsedIds(new Set())}
          disabled={collapsedIds.size === 0}
          title="Expand every collapsed row"
        >
          Expand all
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setCollapsedIds(new Set(allParentIds))}
          disabled={allParentIds.size === 0 || allCollapsed}
          title="Collapse every subtree below the root"
        >
          Collapse all
        </ToolbarButton>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-700" aria-hidden="true" />
        <ToolbarButton
          onClick={() => setPrefs((p) => ({ ...p, wrapPredicates: !p.wrapPredicates }))}
          pressed={wrapPredicates}
          title="Show predicates in full instead of two lines per row"
        >
          Wrap predicates
        </ToolbarButton>
        <ToolbarButton
          onClick={() => setPrefs((p) => ({ ...p, hideFilteredRows: !p.hideFilteredRows }))}
          pressed={hideFilteredRows}
          title={filterActive ? 'Hide rows that do not match the active filters instead of dimming them' : 'Hide rows that do not match the active filters (no filters are active)'}
        >
          Hide filtered rows
        </ToolbarButton>
        <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
          {rowCountLabel}
        </span>
        <ToolbarButton
          onClick={handleCopyTsv}
          disabled={sortedNodes.length === 0}
          title="Copy the visible rows, in their current order, as tab-separated values"
        >
          Copy as TSV
        </ToolbarButton>
        <span role="status" className="shrink-0 min-w-[4.5rem] text-[11px] font-medium whitespace-nowrap">
          {copyStatus === 'copied' && <span className="text-emerald-600 dark:text-emerald-400">Copied</span>}
          {copyStatus === 'failed' && <span className="text-red-600 dark:text-red-400">Copy failed</span>}
        </span>
      </div>

      {/* pr-4 keeps the rightmost column (and its inline mismatch bars) off the
          details rail; it stays part of the scrollable area when columns overflow. */}
      <div
        ref={tableRef}
        role="region"
        aria-label="Plan operations table"
        className="flex-1 min-h-0 overflow-auto pr-4 relative focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseLeave={() => { setHoveredNodeId(null); setTooltip(null); }}
      >
        {/* Annotation tooltip */}
        {tooltip && (() => {
          const tooltipAnnotation = effectiveAnnotations.nodeAnnotations.get(tooltip.nodeId);
          if (!tooltipAnnotation?.text) return null;
          const tooltipHighlight = effectiveAnnotations.nodeHighlights.get(tooltip.nodeId);
          const tooltipColorDef = tooltipHighlight ? getHighlightColorDef(tooltipHighlight.color) : null;
          return (
            <div
              className="absolute z-50 max-w-sm rounded-md shadow-lg px-2.5 py-1.5 text-xs pointer-events-none bg-white dark:bg-slate-800"
              style={{
                left: tooltip.x,
                top: tooltip.y + 2,
                isolation: 'isolate',
                borderLeft: `3px solid ${tooltipColorDef ? tooltipColorDef.hex : '#a3a3a3'}`,
                borderTop: '1px solid var(--border-color, #e2e8f0)',
                borderRight: '1px solid var(--border-color, #e2e8f0)',
                borderBottom: '1px solid var(--border-color, #e2e8f0)',
              }}
            >
              <span className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{tooltipAnnotation.text}</span>
            </div>
          );
        })()}
        <table
          role="grid"
          aria-label="Plan operations"
          aria-multiselectable="true"
          aria-rowcount={sortedNodes.length + 2}
          className="text-xs border-collapse table-fixed"
          style={{ width: visibleColumns.reduce((sum, c) => sum + (columnWidths[c] ?? COLUMN_DEFAULT_WIDTHS[c]), 0), minWidth: '100%' }}
        >
          <colgroup>
            {visibleColumns.map(col => (
              <col key={col} style={{ width: `${columnWidths[col] ?? COLUMN_DEFAULT_WIDTHS[col]}px` }} />
            ))}
          </colgroup>
          <thead ref={theadRef}>
            <tr aria-rowindex={1}>
              <th className={groupThClass} colSpan={2}></th>
              {estimatedColSpan > 0 && (
                <th className={`${groupThClass} ${groupBorderClass}`} colSpan={estimatedColSpan}>
                  Estimated
                </th>
              )}
              {showActualGroup && (
                <th className={`${groupThClass} ${groupBorderClass}`} colSpan={actualColSpan}>
                  Actual
                </th>
              )}
            </tr>
            <tr aria-rowindex={2}>
              <SortableHeader column="id" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass}`} resize={resizeHandle('id')}>
                Id
              </SortableHeader>
              <th scope="col" className={`${thClass} sticky left-0 z-20 bg-slate-50 dark:bg-slate-900`}>
                Operation
                {resizeHandle('operation')}
              </th>
              {hasData.rows && (
                <SortableHeader column="rows" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${groupBorderClass}`} resize={resizeHandle('rows')}>
                  {hasActualStats ? 'E-Rows' : 'Rows'}
                </SortableHeader>
              )}
              {hasData.cost && (
                <SortableHeader column="cost" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${hasData.rows ? '' : groupBorderClass}`} resize={resizeHandle('cost')}>
                  Cost
                </SortableHeader>
              )}
              {showActualGroup && (
                <>
                  {hasData.actualRows && (
                    <SortableHeader column="actualRows" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${groupBorderClass}`} resize={resizeHandle('actualRows')}>
                      A-Rows
                    </SortableHeader>
                  )}
                  {hasData.actualTime && (
                    <SortableHeader
                      column="actualTime"
                      sort={sort}
                      onSort={handleSort}
                      className={`${thClass} ${thRightClass} ${!hasData.actualRows ? groupBorderClass : ''}`}
                      title="Actual elapsed time (includes children); % is the share of total elapsed time"
                      resize={resizeHandle('actualTime')}
                    >
                      A-Time
                    </SortableHeader>
                  )}
                  {hasData.activityPercent && (
                    <SortableHeader column="activityPercent" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime ? groupBorderClass : ''}`} title="Share of total execution activity" resize={resizeHandle('activityPercent')}>
                      Activity
                    </SortableHeader>
                  )}
                  {hasData.starts && (
                    <SortableHeader column="starts" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent ? groupBorderClass : ''}`} resize={resizeHandle('starts')}>
                      Starts
                    </SortableHeader>
                  )}
                  {hasData.memoryUsed && (
                    <SortableHeader column="memoryUsed" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts ? groupBorderClass : ''}`} resize={resizeHandle('memoryUsed')}>
                      Memory
                    </SortableHeader>
                  )}
                  {hasData.tempUsed && (
                    <SortableHeader column="tempUsed" sort={sort} onSort={handleSort} className={`${thClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts && !hasData.memoryUsed ? groupBorderClass : ''}`} resize={resizeHandle('tempUsed')}>
                      Temp
                    </SortableHeader>
                  )}
                  {showCardinalityCol && (
                    <th scope="col" className={`${thClass} text-center`}>
                      Card.
                      {resizeHandle('cardinality')}
                    </th>
                  )}
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sortedNodes.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-3 py-6 text-center text-slate-500 dark:text-slate-400">
                  {hidingFilteredRows ? 'No operations match the current filters.' : 'No operations to show.'}
                </td>
              </tr>
            )}
            {paddingTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: paddingTop, padding: 0, border: 0 }} />
              </tr>
            )}
            {virtualItems.map((virtualRow) => {
              const node = sortedNodes[virtualRow.index];
              if (!node) return null;
              const isSelected = selectedNodeIdSet.has(node.id);
              const isFiltered = filterActive && !filteredNodeIds.has(node.id);
              const isHot = node.id === hottestNodeId;
              const isCollapsed = collapsedIds.has(node.id);
              const hasChildren = node.children.length > 0;
              const isHoverHighlighted = hoverHighlightIds.has(node.id);

              const costRatio = totalCost > 0 ? (node.cost ?? 0) / totalCost : 0;
              const timeRatio = timeShare(node.actualTime, timeDenominator);
              const timeShareTitle = `${(timeRatio * 100).toFixed(1)}% of total elapsed time`;
              const cardRatio = nodeCardinalityRatio(node);
              const cardSeverity = cardinalityRatioSeverity(cardRatio);
              const continuing = treeLineData.get(node.id) ?? new Set<number>();
              const highlight = effectiveAnnotations.nodeHighlights.get(node.id);
              const annotation = effectiveAnnotations.nodeAnnotations.get(node.id);
              const highlightColorDef = highlight ? getHighlightColorDef(highlight.color) : null;
              const hasAnnotationOrHighlight = !!annotation || !!highlight;

              return (
                <tr
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  aria-rowindex={virtualRow.index + 3}
                  aria-selected={isSelected}
                  data-inactive={node.inactive ? 'true' : undefined}
                  onClick={(e) => handleRowClick(node, e)}
                  onMouseEnter={(e) => handleRowMouseEnter(node, e)}
                  onMouseLeave={handleRowMouseLeave}
                  style={hasAnnotationOrHighlight ? {
                    outline: `1.5px solid ${highlightColorDef ? highlightColorDef.hex + '50' : '#a3a3a340'}`,
                    outlineOffset: '-1.5px',
                  } : undefined}
                  className={`
                    border-b border-slate-100 dark:border-slate-800 cursor-pointer transition-colors
                    ${isSelected
                      ? 'bg-blue-50/60 dark:bg-blue-950/25'
                      : isHoverHighlighted
                        ? 'bg-slate-50 dark:bg-slate-800/30'
                        : ''}
                    ${isFiltered ? 'opacity-30' : node.inactive && !isSelected ? 'opacity-60 italic' : ''}
                  `}
                >
                  {/* Id */}
                  <td className="px-2 py-1.5 text-right font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                    {node.id}
                  </td>

                  {/* Operation */}
                  <td className="px-2 py-0 sticky left-0 bg-inherit overflow-hidden">
                    <div className="flex items-stretch min-w-0">
                      {/* Tree lines */}
                      {node.depth > 0 && drawTreeLines && Array.from({ length: node.depth }, (_, i) => {
                        const isConnector = i === node.depth - 1;
                        const isLast = isConnector && !continuing.has(node.depth);
                        const hasVert = continuing.has(i + 1);

                        if (isConnector) {
                          return (
                            <span key={i} className="w-4 flex-shrink-0 relative">
                              <span className={`absolute left-[7px] top-0 ${isLast ? 'h-1/2' : 'h-full'} w-px bg-slate-300 dark:bg-slate-600`} />
                              <span className="absolute left-[7px] top-1/2 w-[9px] h-px bg-slate-300 dark:bg-slate-600" />
                            </span>
                          );
                        } else if (hasVert) {
                          return (
                            <span key={i} className="w-4 flex-shrink-0 relative">
                              <span className="absolute left-[7px] top-0 h-full w-px bg-slate-300 dark:bg-slate-600" />
                            </span>
                          );
                        }
                        return <span key={i} className="w-4 flex-shrink-0" />;
                      })}
                      {/* Padding fallback when tree lines are not drawn */}
                      {(!drawTreeLines && node.depth > 0) && (
                        <span className="flex-shrink-0" style={{ width: `${node.depth * 16}px` }} />
                      )}
                      {/* Content */}
                      <div className="py-1 min-w-0 flex-1">
                        <div className="flex items-center gap-1 min-w-0">
                          {/* Collapse toggle */}
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleCollapse(node.id);
                              }}
                              title={isCollapsed ? 'Expand subtree' : 'Collapse subtree'}
                              aria-label={isCollapsed ? 'Expand subtree' : 'Collapse subtree'}
                              aria-expanded={!isCollapsed}
                              className={`w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 rounded text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 ${FOCUS_RING}`}
                            >
                              <svg
                                className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2.5}
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          ) : (
                            <span className="w-3.5 flex-shrink-0" />
                          )}
                          {/* Operation name */}
                          <span className="min-w-0 truncate" title={node.operation}>
                            <HighlightText
                              text={node.operation}
                              query={searchText}
                              className="font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap"
                            />
                          </span>
                          {node.inactive && (
                            <span
                              data-testid="inactive-tag"
                              title={INACTIVE_NODE_TOOLTIP}
                              className="shrink-0 px-1 py-px rounded border border-dashed border-slate-400 dark:border-slate-500 text-[9px] font-bold uppercase tracking-wide not-italic text-slate-500 dark:text-slate-400"
                            >
                              inactive
                            </span>
                          )}
                          {/* Object name */}
                          {node.objectName && (
                            <span className="min-w-0 truncate" title={node.objectName}>
                              <HighlightText
                                text={node.objectName}
                                query={searchText}
                                className="font-semibold text-blue-700 dark:text-blue-300 whitespace-nowrap"
                              />
                            </span>
                          )}
                          {/* Collapsed count badge */}
                          {isCollapsed && (() => {
                            const desc = new Set<number>();
                            collectDescendantIds(node, desc);
                            return (
                              <span className="px-1 py-0 text-[10px] font-medium bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded">
                                +{desc.size}
                              </span>
                            );
                          })()}
                          {/* Hot badge */}
                          {isHot && (
                            <span className="px-1 py-0 text-[10px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded">
                              HOT
                            </span>
                          )}
                          {/* Annotation note indicator */}
                          {annotation && (
                            <span
                              className={`flex-shrink-0 ${highlightColorDef ? highlightColorDef.text : 'text-slate-400 dark:text-slate-500'}`}
                              title={annotation.text}
                            >
                              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                          {/* Annotation group badges */}
                          {nodeGroupMap.get(node.id)?.map((group) => {
                            const groupColorDef = getHighlightColorDef(group.color);
                            return (
                              <span
                                key={group.id}
                                className={`px-1 py-0 text-[10px] font-medium rounded border ${groupColorDef.groupBorder} ${groupColorDef.text}`}
                                title={group.note ? `${group.name}: ${group.note}` : group.name}
                              >
                                {group.name}
                              </span>
                            );
                          })}
                        </div>
                        {/* Inline predicates + partition pruning */}
                        {hasPredicateLine(node) && (
                          <PredicateBlock
                            node={node}
                            searchText={searchText}
                            wrapAll={wrapPredicates}
                            expanded={expandedPredicateIds.has(node.id)}
                            onToggle={togglePredicateExpanded}
                          />
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Rows/E-Rows */}
                  {hasData.rows && (
                    <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${bodyGroupBorderClass}`}>
                      {formatNumberShort(node.rows)}
                    </td>
                  )}

                  {/* Cost + inline bar */}
                  {hasData.cost && (
                    <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${hasData.rows ? '' : bodyGroupBorderClass}`}>
                      <div className="flex flex-col items-end gap-0.5">
                        <span>{formatNumberShort(node.cost)}</span>
                        {costRatio > 0 && (
                          <div className="w-full h-[3px] bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${costRatio >= 0.5 ? 'bg-red-500' : costRatio >= 0.25 ? 'bg-orange-500' : costRatio >= 0.1 ? 'bg-yellow-500' : 'bg-green-500'}`}
                              style={{ width: `${Math.max(costRatio * 100, 1)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  )}

                  {showActualGroup && (
                    <>
                      {/* A-Rows */}
                      {hasData.actualRows && (
                        <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${bodyGroupBorderClass}`}>
                          {formatNumberShort(node.actualRows)}
                        </td>
                      )}

                      {/* A-Time + inline bar (share of total elapsed time, capped at 100%) */}
                      {hasData.actualTime && (
                        <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${!hasData.actualRows ? bodyGroupBorderClass : ''}`}>
                          <div className="flex flex-col items-end gap-0.5">
                            <div className="flex items-baseline gap-1.5">
                              <span>{formatTimeCompact(node.actualTime)}</span>
                              {timeRatio >= 0.01 && (
                                <span
                                  title={timeShareTitle}
                                  className={`text-[10px] ${timeRatio >= 0.5 ? 'text-red-500' : timeRatio >= 0.25 ? 'text-orange-500' : timeRatio >= 0.1 ? 'text-yellow-600 dark:text-yellow-500' : 'text-slate-400 dark:text-slate-500'}`}
                                >
                                  {(timeRatio * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>
                            {timeRatio > 0 && (
                              <div className="w-full h-[3px] bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden" title={timeShareTitle}>
                                <div
                                  className={`h-full rounded-full ${timeRatio >= 0.5 ? 'bg-red-500' : timeRatio >= 0.25 ? 'bg-orange-500' : timeRatio >= 0.1 ? 'bg-yellow-500' : 'bg-green-500'}`}
                                  style={{ width: `${Math.max(timeRatio * 100, 1)}%` }}
                                />
                              </div>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Activity % */}
                      {hasData.activityPercent && (() => {
                        const activity = node.activityPercent ?? 0;
                        const ratio = Math.max(0, Math.min(1, activity / 100));
                        const tone =
                          activity >= 50 ? 'text-red-500' :
                          activity >= 25 ? 'text-orange-500' :
                          activity >= 10 ? 'text-yellow-600 dark:text-yellow-500' :
                          'text-slate-700 dark:text-slate-300';
                        const barTone =
                          activity >= 50 ? 'bg-red-500' :
                          activity >= 25 ? 'bg-orange-500' :
                          activity >= 10 ? 'bg-yellow-500' :
                          'bg-green-500';
                        return (
                          <td className={`px-2 py-1.5 text-right font-mono tabular-nums ${tone} ${!hasData.actualRows && !hasData.actualTime ? bodyGroupBorderClass : ''}`}>
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{node.activityPercent != null ? `${activity.toFixed(1)}%` : ''}</span>
                              {ratio > 0 && (
                                <div className="w-full h-[3px] bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.max(ratio * 100, 1)}%` }} />
                                </div>
                              )}
                            </div>
                          </td>
                        );
                      })()}

                      {/* Starts */}
                      {hasData.starts && (
                        <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent ? bodyGroupBorderClass : ''}`}>
                          {formatNumberShort(node.starts)}
                        </td>
                      )}

                      {/* Memory */}
                      {hasData.memoryUsed && (
                        <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts ? bodyGroupBorderClass : ''}`}>
                          {formatBytes(node.memoryUsed)}
                        </td>
                      )}

                      {/* Temp */}
                      {hasData.tempUsed && (
                        <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts && !hasData.memoryUsed ? bodyGroupBorderClass : ''}`}>
                          <div className="flex items-center justify-end gap-1">
                            {formatBytes(node.tempUsed)}
                            {node.tempUsed != null && node.tempUsed > 0 && (
                              <span className="text-amber-500" title="Spill to disk">
                                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                        </td>
                      )}

                      {/* Cardinality ratio */}
                      {showCardinalityCol && (
                        <td className="px-2 py-1.5 text-center font-mono tabular-nums">
                          {cardRatio !== undefined && (
                            <span className={
                              cardSeverity === 'bad' ? 'text-red-600 dark:text-red-400 font-semibold' :
                              cardSeverity === 'warn' ? 'text-amber-600 dark:text-amber-400' :
                              'text-slate-500 dark:text-slate-400'
                            }>
                              {formatCardinalityRatio(cardRatio)}
                            </span>
                          )}
                        </td>
                      )}
                    </>
                  )}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: paddingBottom, padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
