import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import type { PlanNode } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, computeCardinalityRatio, formatCardinalityRatio, cardinalityRatioSeverity } from '../../lib/format';
import { getHighlightColorDef } from '../../lib/annotations';
import type { AnnotationGroup } from '../../lib/annotations';
import { matchesFilters } from '../../lib/filtering';
import { HighlightText } from '../HighlightText';

const EMPTY_SELECTED_NODE_IDS: number[] = [];

type SortColumn = 'id' | 'cost' | 'rows' | 'actualRows' | 'actualTime' | 'activityPercent' | 'starts' | 'memoryUsed' | 'tempUsed';
type SortDirection = 'asc' | 'desc';
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

/** Collect all descendant IDs of a node (not including the node itself). */
function collectDescendantIds(node: PlanNode, out: Set<number>) {
  for (const child of node.children) {
    out.add(child.id);
    collectDescendantIds(child, out);
  }
}

function SortArrow({ column, sortColumn, sortDirection }: { column: SortColumn; sortColumn: SortColumn; sortDirection: SortDirection }) {
  if (column !== sortColumn) return null;
  return (
    <span className="ml-0.5 text-blue-500">
      {sortDirection === 'asc' ? '\u25B2' : '\u25BC'}
    </span>
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

  const hottestNodeId = useMemo((): number | null => {
    if (!hotspotsEnabled) return null;
    if (!parsedPlan?.hasActualStats) return null;
    let maxTime = 0;
    let hotId: number | null = null;
    for (const node of parsedPlan.allNodes) {
      if (node.parentId === undefined) continue;
      if (node.actualTime !== undefined && node.actualTime > maxTime) {
        maxTime = node.actualTime;
        hotId = node.id;
      }
    }
    return hotId;
  }, [parsedPlan, hotspotsEnabled]);

  const [sortColumn, setSortColumn] = useState<SortColumn>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [columnWidths, setColumnWidths] = useState<Record<ColumnKey, number>>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY);
      if (saved) return { ...COLUMN_DEFAULT_WIDTHS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return { ...COLUMN_DEFAULT_WIDTHS };
  });
  const resizingRef = useRef<{ column: ColumnKey; startX: number; startWidth: number } | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: number; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

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
  }, [effectiveAnnotations.groups]);

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

  const flatNodes = useMemo(() => {
    if (!parsedPlan?.allNodes) return [];
    return [...parsedPlan.allNodes];
  }, [parsedPlan]);

  const sortedNodes = useMemo(() => {
    let nodes = flatNodes;

    // Filter out nodes hidden by collapsed parents
    if (hiddenByCollapse.size > 0) {
      nodes = nodes.filter(n => !hiddenByCollapse.has(n.id));
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
  }, [flatNodes, sortColumn, sortDirection, hiddenByCollapse]);

  const totalCost = parsedPlan?.totalCost ?? 0;
  const totalElapsedTime = parsedPlan?.totalElapsedTime ?? 0;


  const handleSort = useCallback((column: SortColumn) => {
    if (sortColumn === column) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn('id');
        setSortDirection('asc');
      }
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn, sortDirection]);

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

  // Keyboard navigation
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

  // Auto-scroll selected row into view
  useEffect(() => {
    if (selectedNodeIds.length === 1) {
      const row = rowRefs.current.get(selectedNodeIds[0]);
      row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selectedNodeIds]);

  // Reset collapsed state when plan changes
  useEffect(() => {
    setCollapsedIds(new Set());
  }, [parsedPlan]);

  // Cleanup tooltip timer
  useEffect(() => {
    return () => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current); };
  }, []);

  if (!parsedPlan) return null;

  const groupThClass = 'px-2 py-1 text-center text-[11px] font-semibold text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-900 sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-700 select-none';
  const thClass = 'relative px-2 py-1.5 text-left text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 sticky top-[22px] z-10 border-b border-neutral-200 dark:border-neutral-700 select-none';
  const thSortableClass = thClass + ' cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-200';
  const ResizeHandle = ({ column }: { column: ColumnKey }) => (
    <span
      onMouseDown={(e) => handleResizeStart(column, e)}
      onDoubleClick={(e) => handleResizeDoubleClick(column, e)}
      onClick={(e) => e.stopPropagation()}
      title="Drag to resize, double-click to reset"
      className="absolute top-0 right-0 h-full w-[6px] cursor-col-resize z-30 hover:bg-blue-400/50 active:bg-blue-500/70"
      style={{ marginRight: '-3px' }}
    />
  );
  const thRightClass = 'text-right';
  const groupBorderClass = 'border-l border-neutral-200 dark:border-neutral-700';
  const bodyGroupBorderClass = 'border-l border-neutral-100 dark:border-neutral-800';

  return (
    <div
      ref={tableRef}
      className="h-full overflow-auto bg-white dark:bg-neutral-950 focus:outline-none relative"
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
            className="absolute z-50 max-w-sm rounded-md shadow-lg px-2.5 py-1.5 text-xs pointer-events-none bg-white dark:bg-neutral-800"
            style={{
              left: tooltip.x,
              top: tooltip.y + 2,
              isolation: 'isolate',
              borderLeft: `3px solid ${tooltipColorDef ? tooltipColorDef.hex : '#a3a3a3'}`,
              borderTop: '1px solid var(--border-color, #e5e7eb)',
              borderRight: '1px solid var(--border-color, #e5e7eb)',
              borderBottom: '1px solid var(--border-color, #e5e7eb)',
            }}
          >
            <span className="text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">{tooltipAnnotation.text}</span>
          </div>
        );
      })()}
      <table className="text-xs border-collapse table-fixed" style={{ width: visibleColumns.reduce((sum, c) => sum + (columnWidths[c] ?? COLUMN_DEFAULT_WIDTHS[c]), 0), minWidth: '100%' }}>
        <colgroup>
          {visibleColumns.map(col => (
            <col key={col} style={{ width: `${columnWidths[col] ?? COLUMN_DEFAULT_WIDTHS[col]}px` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
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
          <tr>
            <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('id')}>
              Id<SortArrow column="id" sortColumn={sortColumn} sortDirection={sortDirection} />
              <ResizeHandle column="id" />
            </th>
            <th className={`${thClass} sticky left-0 z-20 bg-neutral-50 dark:bg-neutral-900`}>
              Operation
              <ResizeHandle column="operation" />
            </th>
            {hasData.rows && (
              <th className={`${thSortableClass} ${thRightClass} ${groupBorderClass}`} onClick={() => handleSort('rows')}>
                {hasActualStats ? 'E-Rows' : 'Rows'}<SortArrow column="rows" sortColumn={sortColumn} sortDirection={sortDirection} />
                <ResizeHandle column="rows" />
              </th>
            )}
            {hasData.cost && (
              <th className={`${thSortableClass} ${thRightClass} ${hasData.rows ? '' : groupBorderClass}`} onClick={() => handleSort('cost')}>
                Cost<SortArrow column="cost" sortColumn={sortColumn} sortDirection={sortDirection} />
                <ResizeHandle column="cost" />
              </th>
            )}
            {showActualGroup && (
              <>
                {hasData.actualRows && (
                  <th className={`${thSortableClass} ${thRightClass} ${groupBorderClass}`} onClick={() => handleSort('actualRows')}>
                    A-Rows<SortArrow column="actualRows" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="actualRows" />
                  </th>
                )}
                {hasData.actualTime && (
                  <th className={`${thSortableClass} ${thRightClass} ${!hasData.actualRows ? groupBorderClass : ''}`} onClick={() => handleSort('actualTime')}>
                    A-Time<SortArrow column="actualTime" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="actualTime" />
                  </th>
                )}
                {hasData.activityPercent && (
                  <th className={`${thSortableClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime ? groupBorderClass : ''}`} onClick={() => handleSort('activityPercent')} title="Share of total execution activity">
                    Activity<SortArrow column="activityPercent" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="activityPercent" />
                  </th>
                )}
                {hasData.starts && (
                  <th className={`${thSortableClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent ? groupBorderClass : ''}`} onClick={() => handleSort('starts')}>
                    Starts<SortArrow column="starts" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="starts" />
                  </th>
                )}
                {hasData.memoryUsed && (
                  <th className={`${thSortableClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts ? groupBorderClass : ''}`} onClick={() => handleSort('memoryUsed')}>
                    Memory<SortArrow column="memoryUsed" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="memoryUsed" />
                  </th>
                )}
                {hasData.tempUsed && (
                  <th className={`${thSortableClass} ${thRightClass} ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts && !hasData.memoryUsed ? groupBorderClass : ''}`} onClick={() => handleSort('tempUsed')}>
                    Temp<SortArrow column="tempUsed" sortColumn={sortColumn} sortDirection={sortDirection} />
                    <ResizeHandle column="tempUsed" />
                  </th>
                )}
                {showCardinalityCol && (
                  <th className={`${thClass} text-center`}>
                    Card.
                    <ResizeHandle column="cardinality" />
                  </th>
                )}
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {sortedNodes.map((node) => {
            const isSelected = selectedNodeIdSet.has(node.id);
            const isFiltered = filteredNodeIds.size > 0 && !filteredNodeIds.has(node.id);
            const isHot = node.id === hottestNodeId;
            const isCollapsed = collapsedIds.has(node.id);
            const hasChildren = node.children.length > 0;
            const isHoverHighlighted = hoverHighlightIds.has(node.id);


            const costRatio = totalCost > 0 ? (node.cost ?? 0) / totalCost : 0;
            const timeRatio = totalElapsedTime > 0 ? (node.actualTime ?? 0) / totalElapsedTime : 0;
            const cardRatio = computeCardinalityRatio(node.rows, node.actualRows);
            const cardSeverity = cardinalityRatioSeverity(cardRatio);
            const continuing = treeLineData.get(node.id) ?? new Set<number>();
            const highlight = effectiveAnnotations.nodeHighlights.get(node.id);
            const annotation = effectiveAnnotations.nodeAnnotations.get(node.id);
            const highlightColorDef = highlight ? getHighlightColorDef(highlight.color) : null;
            const hasAnnotationOrHighlight = !!annotation || !!highlight;

            return (
              <tr
                key={node.id}
                ref={(el) => { if (el) rowRefs.current.set(node.id, el); else rowRefs.current.delete(node.id); }}
                onClick={(e) => handleRowClick(node, e)}
                onMouseEnter={(e) => handleRowMouseEnter(node, e)}
                onMouseLeave={handleRowMouseLeave}
                style={hasAnnotationOrHighlight ? {
                  outline: `1.5px solid ${highlightColorDef ? highlightColorDef.hex + '50' : '#a3a3a340'}`,
                  outlineOffset: '-1.5px',
                } : undefined}
                className={`
                  border-b border-neutral-100 dark:border-neutral-800 cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-blue-50/60 dark:bg-blue-950/25'
                    : isHoverHighlighted
                      ? 'bg-neutral-50 dark:bg-neutral-800/30'
                      : ''}
                  ${isFiltered ? 'opacity-30' : ''}
                `}
              >
                {/* Id */}
                <td className="px-2 py-1.5 text-right font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                  {node.id}
                </td>

                {/* Operation */}
                <td className="px-2 py-0 sticky left-0 bg-inherit">
                  <div className="flex items-stretch">
                    {/* Tree lines */}
                    {node.depth > 0 && isTreeOrder && Array.from({ length: node.depth }, (_, i) => {
                      const isConnector = i === node.depth - 1;
                      const isLast = isConnector && !continuing.has(node.depth);
                      const hasVert = continuing.has(i + 1);

                      if (isConnector) {
                        return (
                          <span key={i} className="w-4 flex-shrink-0 relative">
                            <span className={`absolute left-[7px] top-0 ${isLast ? 'h-1/2' : 'h-full'} w-px bg-neutral-300 dark:bg-neutral-600`} />
                            <span className="absolute left-[7px] top-1/2 w-[9px] h-px bg-neutral-300 dark:bg-neutral-600" />
                          </span>
                        );
                      } else if (hasVert) {
                        return (
                          <span key={i} className="w-4 flex-shrink-0 relative">
                            <span className="absolute left-[7px] top-0 h-full w-px bg-neutral-300 dark:bg-neutral-600" />
                          </span>
                        );
                      }
                      return <span key={i} className="w-4 flex-shrink-0" />;
                    })}
                    {/* Padding fallback when not in tree order */}
                    {(!isTreeOrder && node.depth > 0) && (
                      <span className="flex-shrink-0" style={{ width: `${node.depth * 16}px` }} />
                    )}
                    {/* Content */}
                    <div className="py-1">
                      <div className="flex items-center gap-1">
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
                            className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 rounded text-neutral-400 dark:text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-700"
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
                        <HighlightText
                          text={node.operation}
                          query={searchText}
                          className="font-medium text-neutral-900 dark:text-neutral-100 whitespace-nowrap"
                        />
                        {/* Object name */}
                        {node.objectName && (
                          <HighlightText
                            text={node.objectName}
                            query={searchText}
                            className="font-semibold text-blue-700 dark:text-blue-300 whitespace-nowrap"
                          />
                        )}
                        {/* Collapsed count badge */}
                        {isCollapsed && (() => {
                          const desc = new Set<number>();
                          collectDescendantIds(node, desc);
                          return (
                            <span className="px-1 py-0 text-[9px] font-medium bg-neutral-200 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300 rounded">
                              +{desc.size}
                            </span>
                          );
                        })()}
                        {/* Hot badge */}
                        {isHot && (
                          <span className="px-1 py-0 text-[9px] font-bold bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 rounded">
                            HOT
                          </span>
                        )}
                        {/* Annotation note indicator */}
                        {annotation && (
                          <span
                            className={`flex-shrink-0 ${highlightColorDef ? highlightColorDef.text : 'text-neutral-400 dark:text-neutral-500'}`}
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
                              className={`px-1 py-0 text-[9px] font-medium rounded border ${groupColorDef.groupBorder} ${groupColorDef.text}`}
                              title={group.note ? `${group.name}: ${group.note}` : group.name}
                            >
                              {group.name}
                            </span>
                          );
                        })}
                      </div>
                      {/* Inline predicates */}
                      {(node.accessPredicates || node.filterPredicates) && (
                        <div className="ml-[calc(0.875rem+0.25rem)] mt-0.5 text-[10px] font-mono text-neutral-400 dark:text-neutral-500 whitespace-pre-wrap break-all leading-tight">
                          {node.accessPredicates && (
                            <span><span className="text-blue-400 dark:text-blue-500">A:</span> {node.accessPredicates}</span>
                          )}
                          {node.accessPredicates && node.filterPredicates && (
                            <span className="mx-1.5 text-neutral-300 dark:text-neutral-600">|</span>
                          )}
                          {node.filterPredicates && (
                            <span><span className="text-amber-400 dark:text-amber-500">F:</span> {node.filterPredicates}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </td>

                {/* Rows/E-Rows */}
                {hasData.rows && (
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${bodyGroupBorderClass}`}>
                    {formatNumberShort(node.rows)}
                  </td>
                )}

                {/* Cost + inline bar */}
                {hasData.cost && (
                  <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${hasData.rows ? '' : bodyGroupBorderClass}`}>
                    <div className="flex flex-col items-end gap-0.5">
                      <span>{formatNumberShort(node.cost)}</span>
                      {costRatio > 0 && (
                        <div className="w-full h-[3px] bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
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
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${bodyGroupBorderClass}`}>
                        {formatNumberShort(node.actualRows)}
                      </td>
                    )}

                    {/* A-Time + inline bar */}
                    {hasData.actualTime && (
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${!hasData.actualRows ? bodyGroupBorderClass : ''}`}>
                        <div className="flex flex-col items-end gap-0.5">
                          <div className="flex items-baseline gap-1.5">
                            <span>{formatTimeCompact(node.actualTime)}</span>
                            {timeRatio >= 0.01 && (
                              <span className={`text-[9px] ${timeRatio >= 0.5 ? 'text-red-500' : timeRatio >= 0.25 ? 'text-orange-500' : timeRatio >= 0.1 ? 'text-yellow-600 dark:text-yellow-500' : 'text-neutral-400 dark:text-neutral-500'}`}>
                                {(timeRatio * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          {timeRatio > 0 && (
                            <div className="w-full h-[3px] bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
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
                        'text-neutral-700 dark:text-neutral-300';
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
                              <div className="w-full h-[3px] bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${barTone}`} style={{ width: `${Math.max(ratio * 100, 1)}%` }} />
                              </div>
                            )}
                          </div>
                        </td>
                      );
                    })()}

                    {/* Starts */}
                    {hasData.starts && (
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent ? bodyGroupBorderClass : ''}`}>
                        {formatNumberShort(node.starts)}
                      </td>
                    )}

                    {/* Memory */}
                    {hasData.memoryUsed && (
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts ? bodyGroupBorderClass : ''}`}>
                        {formatBytes(node.memoryUsed)}
                      </td>
                    )}

                    {/* Temp */}
                    {hasData.tempUsed && (
                      <td className={`px-2 py-1.5 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300 ${!hasData.actualRows && !hasData.actualTime && !hasData.activityPercent && !hasData.starts && !hasData.memoryUsed ? bodyGroupBorderClass : ''}`}>
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
                            'text-neutral-500 dark:text-neutral-400'
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
        </tbody>
      </table>
    </div>
  );
}
