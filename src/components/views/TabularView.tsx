import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getOperationCategory } from '../../lib/types';
import type { PlanNode } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeCompact, computeCardinalityRatio, formatCardinalityRatio, cardinalityRatioSeverity } from '../../lib/format';
import { HighlightText } from '../HighlightText';

type SortColumn = 'id' | 'cost' | 'rows' | 'bytes' | 'actualRows' | 'actualTime' | 'starts' | 'memoryUsed' | 'tempUsed';
type SortDirection = 'asc' | 'desc';

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

export function TabularView() {
  const {
    parsedPlan,
    selectedNodeIds,
    selectNode,
    filteredNodeIds,
    hottestNodeId,
    colorScheme,
    filters,
    nodeById,
  } = usePlan();

  const [sortColumn, setSortColumn] = useState<SortColumn>('id');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [collapsedIds, setCollapsedIds] = useState<Set<number>>(new Set());
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: number; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Map<number, HTMLTableRowElement>>(new Map());

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const searchText = filters.searchText?.trim() ?? '';
  const hasActualStats = parsedPlan?.hasActualStats ?? false;

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
          case 'bytes': return node.bytes ?? 0;
          case 'actualRows': return node.actualRows ?? 0;
          case 'actualTime': return node.actualTime ?? 0;
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
  const palette = COLOR_SCHEME_PALETTES[colorScheme];

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
    if (node.children.length > 0) {
      setCollapsedIds(prev => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
    }
  }, [selectNode]);

  const handleRowMouseEnter = useCallback((node: PlanNode, event: React.MouseEvent) => {
    setHoveredNodeId(node.id);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    if (node.accessPredicates || node.filterPredicates) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const containerRect = tableRef.current?.getBoundingClientRect();
      if (containerRect) {
        setTooltip({
          nodeId: node.id,
          x: rect.left - containerRect.left + 40,
          y: rect.bottom - containerRect.top + tableRef.current!.scrollTop,
        });
      }
    } else {
      setTooltip(null);
    }
  }, []);

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

  const thClass = 'px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900 sticky top-0 z-10 border-b border-neutral-200 dark:border-neutral-700 select-none';
  const thSortableClass = thClass + ' cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-200';
  const thRightClass = 'text-right';

  return (
    <div
      ref={tableRef}
      className="h-full overflow-auto bg-white dark:bg-neutral-950 focus:outline-none relative"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseLeave={() => { setHoveredNodeId(null); setTooltip(null); }}
    >
      {/* Predicate tooltip */}
      {tooltip && (() => {
        const node = nodeById.get(tooltip.nodeId);
        if (!node) return null;
        return (
          <div
            className="absolute z-30 max-w-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md shadow-lg p-2 text-xs pointer-events-none"
            style={{ left: tooltip.x, top: tooltip.y + 2 }}
          >
            {node.accessPredicates && (
              <div className="mb-1">
                <span className="font-semibold text-blue-600 dark:text-blue-400">Access: </span>
                <span className="text-neutral-700 dark:text-neutral-300 font-mono whitespace-pre-wrap">{node.accessPredicates}</span>
              </div>
            )}
            {node.filterPredicates && (
              <div>
                <span className="font-semibold text-amber-600 dark:text-amber-400">Filter: </span>
                <span className="text-neutral-700 dark:text-neutral-300 font-mono whitespace-pre-wrap">{node.filterPredicates}</span>
              </div>
            )}
          </div>
        );
      })()}
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr>
            <th className={`${thSortableClass} ${thRightClass} w-10`} onClick={() => handleSort('id')}>
              Id<SortArrow column="id" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            <th className={`${thClass} min-w-[200px] sticky left-0 z-20 bg-neutral-50 dark:bg-neutral-900`}>
              Operation
            </th>
            <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('rows')}>
              {hasActualStats ? 'E-Rows' : 'Rows'}<SortArrow column="rows" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('bytes')}>
              Bytes<SortArrow column="bytes" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('cost')}>
              Cost<SortArrow column="cost" sortColumn={sortColumn} sortDirection={sortDirection} />
            </th>
            {hasActualStats && (
              <>
                <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('actualRows')}>
                  A-Rows<SortArrow column="actualRows" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('actualTime')}>
                  A-Time<SortArrow column="actualTime" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('starts')}>
                  Starts<SortArrow column="starts" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('memoryUsed')}>
                  Memory<SortArrow column="memoryUsed" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th className={`${thSortableClass} ${thRightClass}`} onClick={() => handleSort('tempUsed')}>
                  Temp<SortArrow column="tempUsed" sortColumn={sortColumn} sortDirection={sortDirection} />
                </th>
                <th className={`${thClass} text-center`}>
                  Card.
                </th>
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
            const category = getOperationCategory(node.operation);
            const categoryColor = palette[category] ?? palette['Other'];
            const costRatio = totalCost > 0 ? (node.cost ?? 0) / totalCost : 0;
            const timeRatio = totalElapsedTime > 0 ? (node.actualTime ?? 0) / totalElapsedTime : 0;
            const cardRatio = computeCardinalityRatio(node.rows, node.actualRows);
            const cardSeverity = cardinalityRatioSeverity(cardRatio);

            return (
              <tr
                key={node.id}
                ref={(el) => { if (el) rowRefs.current.set(node.id, el); else rowRefs.current.delete(node.id); }}
                onClick={(e) => handleRowClick(node, e)}
                onMouseEnter={(e) => handleRowMouseEnter(node, e)}
                onMouseLeave={handleRowMouseLeave}
                className={`
                  border-b border-neutral-100 dark:border-neutral-800 cursor-pointer transition-colors
                  ${isSelected
                    ? 'bg-blue-50 dark:bg-blue-950/40'
                    : isHoverHighlighted
                      ? 'bg-neutral-100 dark:bg-neutral-800/60'
                      : ''}
                  ${isFiltered ? 'opacity-30' : ''}
                `}
              >
                {/* Id */}
                <td className="px-2 py-1 text-right font-mono text-neutral-500 dark:text-neutral-400 tabular-nums">
                  {node.id}
                </td>

                {/* Operation */}
                <td className="px-2 py-1 sticky left-0 bg-inherit">
                  <div className="flex items-center gap-1" style={{ paddingLeft: `${node.depth * 16}px` }}>
                    {/* Collapse indicator */}
                    {hasChildren ? (
                      <span className="w-3.5 h-3.5 flex items-center justify-center flex-shrink-0 text-neutral-400 dark:text-neutral-500">
                        <svg
                          className={`w-3 h-3 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    ) : (
                      <span className="w-3.5 flex-shrink-0" />
                    )}
                    {/* Color dot */}
                    <span
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: categoryColor }}
                    />
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
                        className="text-neutral-500 dark:text-neutral-400 whitespace-nowrap"
                      />
                    )}
                    {/* Predicate indicators */}
                    {node.accessPredicates && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" title="Access predicate" />
                    )}
                    {node.filterPredicates && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" title="Filter predicate" />
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
                  </div>
                </td>

                {/* Rows/E-Rows */}
                <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                  {formatNumberShort(node.rows)}
                </td>

                {/* Bytes */}
                <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                  {formatBytes(node.bytes)}
                </td>

                {/* Cost + inline bar */}
                <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                  <div className="flex flex-col items-end gap-0.5">
                    <span>{formatNumberShort(node.cost)}</span>
                    {costRatio > 0 && (
                      <div className="w-full h-[2px] bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${costRatio >= 0.5 ? 'bg-red-500' : costRatio >= 0.25 ? 'bg-orange-500' : costRatio >= 0.1 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${Math.max(costRatio * 100, 1)}%` }}
                        />
                      </div>
                    )}
                  </div>
                </td>

                {hasActualStats && (
                  <>
                    {/* A-Rows */}
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatNumberShort(node.actualRows)}
                    </td>

                    {/* A-Time + inline bar */}
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                      <div className="flex flex-col items-end gap-0.5">
                        <span>{formatTimeCompact(node.actualTime)}</span>
                        {timeRatio > 0 && (
                          <div className="w-full h-[2px] bg-neutral-100 dark:bg-neutral-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${timeRatio >= 0.5 ? 'bg-red-500' : timeRatio >= 0.25 ? 'bg-orange-500' : timeRatio >= 0.1 ? 'bg-yellow-500' : 'bg-green-500'}`}
                              style={{ width: `${Math.max(timeRatio * 100, 1)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </td>

                    {/* Starts */}
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatNumberShort(node.starts)}
                    </td>

                    {/* Memory */}
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
                      {formatBytes(node.memoryUsed)}
                    </td>

                    {/* Temp */}
                    <td className="px-2 py-1 text-right font-mono tabular-nums text-neutral-700 dark:text-neutral-300">
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

                    {/* Cardinality ratio */}
                    <td className="px-2 py-1 text-center font-mono tabular-nums">
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
