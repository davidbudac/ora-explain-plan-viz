import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { NodeDisplayOptions, PredicateType } from '../lib/types';
import { matchesSearch, hasActiveFilters } from '../lib/filtering';
import { computeCardinalityRatio, formatNumberShort, formatTimeCompact } from '../lib/format';
import { CustomizeViewMenu } from './CustomizeViewMenu';

const HISTOGRAM_BUCKETS = 40;

/** Renders a robust histogram behind a range slider showing node value distribution. */
function SliderHistogram({ values, max, height = 40 }: { values: number[]; max: number; height?: number }) {
  const buckets = useMemo(() => {
    if (max <= 0 || values.length === 0) return [];
    const counts = new Array(HISTOGRAM_BUCKETS).fill(0);
    for (const v of values) {
      const idx = Math.min(Math.floor((v / max) * HISTOGRAM_BUCKETS), HISTOGRAM_BUCKETS - 1);
      counts[idx]++;
    }
    const peak = Math.max(...counts);
    return counts.map((c) => (peak > 0 ? c / peak : 0));
  }, [values, max]);

  if (buckets.length === 0) return null;

  return (
    <div className="flex items-end gap-0.5 mb-[-2px]" style={{ height: `${height}px` }} aria-hidden="true">
      {buckets.map((ratio, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm transition-all duration-300 ease-out"
          style={{
            height: ratio > 0 ? `${Math.max(ratio * 100, 4)}%` : '2px',
            backgroundColor: ratio > 0
              ? `rgba(59, 130, 246, ${0.15 + ratio * 0.45})`
              : 'rgba(203, 213, 225, 0.1)',
          }}
        />
      ))}
    </div>
  );
}

function IndicatorButton({
  metric,
  label,
  current,
  onClick,
  activeClass = 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30',
}: {
  metric: any;
  label: string;
  current: any;
  onClick: (metric: any) => void;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(metric)}
      className={`px-2 py-1 text-[10px] rounded transition-all font-semibold uppercase tracking-wider ${current === metric ? activeClass : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
    >
      {label}
    </button>
  );
}

const DEFAULT_NODE_DISPLAY_OPTIONS: NodeDisplayOptions = {
  showRows: true,
  showCost: true,
  showBytes: true,
  showObjectName: true,
  showPredicateIndicators: true,
  showPredicateDetails: false,
  showQueryBlockBadge: true,
  showQueryBlockGrouping: true,
  showActualRows: true,
  showActualTime: true,
  showStarts: true,
  showHotspotBadge: true,
  showSpillBadge: true,
  showCardinalityBadge: true,
  showStaleStatsBadge: true,
  showMissingStatsBadge: true,
  showMismatchNoHistogramBadge: true,
  showAnnotations: true,
};

interface FilterPanelProps {
  panelWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function FilterPanel({ panelWidth, onResizeStart }: FilterPanelProps) {
  const {
    parsedPlan, filters, setFilters, filteredNodes, selectNode,
    filterPanelCollapsed: isCollapsed, setFilterPanelCollapsed: setIsCollapsed,
    nodeIndicatorMetric, setNodeIndicatorMetric,
    viewMode, sankeyMetric, setSankeyMetric, treeCompareEnabled
  } = usePlan();
  // null = no match navigated to yet (first "Next" selects the first match)
  const [activeMatchIndex, setActiveMatchIndex] = useState<number | null>(null);

  const operationStats = useMemo(() => {
    if (!parsedPlan) return new Map<string, number>();

    const stats = new Map<string, number>();
    for (const node of parsedPlan.allNodes) {
      const category = getOperationCategory(node.operation);
      stats.set(category, (stats.get(category) || 0) + 1);
    }
    return stats;
  }, [parsedPlan]);

  const predicateStats = useMemo(() => {
    if (!parsedPlan) return { access: 0, filter: 0, none: 0 };

    let access = 0;
    let filter = 0;
    let none = 0;
    for (const node of parsedPlan.allNodes) {
      if (node.accessPredicates) access++;
      if (node.filterPredicates) filter++;
      if (!node.accessPredicates && !node.filterPredicates) none++;
    }
    return { access, filter, none };
  }, [parsedPlan]);

  const maxCost = useMemo(() => {
    if (!parsedPlan) return 100;
    return Math.max(...parsedPlan.allNodes.map((n) => n.cost || 0), 100);
  }, [parsedPlan]);

  const maxActualRows = useMemo(() => {
    if (!parsedPlan || !parsedPlan.hasActualStats) return 0;
    return Math.max(...parsedPlan.allNodes.map((n) => n.actualRows || 0), 0);
  }, [parsedPlan]);

  const maxActualTime = useMemo(() => {
    if (!parsedPlan || !parsedPlan.hasActualStats) return 0;
    return Math.max(...parsedPlan.allNodes.map((n) => n.actualTime || 0), 0);
  }, [parsedPlan]);

  // Histogram value arrays for each slider
  const costValues = useMemo(() => {
    if (!parsedPlan) return [];
    return parsedPlan.allNodes.map((n) => n.cost || 0);
  }, [parsedPlan]);

  const actualRowsValues = useMemo(() => {
    if (!parsedPlan || !parsedPlan.hasActualStats) return [];
    return parsedPlan.allNodes.map((n) => n.actualRows || 0);
  }, [parsedPlan]);

  const actualTimeValues = useMemo(() => {
    if (!parsedPlan || !parsedPlan.hasActualStats) return [];
    return parsedPlan.allNodes.map((n) => n.actualTime || 0);
  }, [parsedPlan]);

  const cardinalityMismatchValues = useMemo(() => {
    if (!parsedPlan || !parsedPlan.hasActualStats) return [];
    const vals: number[] = [];
    for (const node of parsedPlan.allNodes) {
      const ratio = computeCardinalityRatio(node.rows, node.actualRows);
      if (ratio !== undefined) {
        const deviation = ratio >= 1 ? ratio : 1 / ratio;
        vals.push(Math.min(deviation, 100)); // clamp to slider max
      }
    }
    return vals;
  }, [parsedPlan]);

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan?.allNodes.length || 0;

  const searchMatches = useMemo(() => {
    if (!parsedPlan) return [];
    const query = filters.searchText.trim();
    if (!query) return [];
    return parsedPlan.allNodes.filter((node) => matchesSearch(node, query)).map((node) => node.id);
  }, [parsedPlan, filters.searchText]);

  useEffect(() => {
    setActiveMatchIndex(null);
  }, [filters.searchText, parsedPlan]);

  const handleMatchNavigate = (direction: 'prev' | 'next') => {
    if (searchMatches.length === 0) return;
    let nextIndex: number;
    if (activeMatchIndex === null) {
      nextIndex = direction === 'next' ? 0 : searchMatches.length - 1;
    } else {
      const delta = direction === 'next' ? 1 : -1;
      nextIndex = (activeMatchIndex + delta + searchMatches.length) % searchMatches.length;
    }
    setActiveMatchIndex(nextIndex);
    selectNode(searchMatches[nextIndex]);
  };

  const handleCategoryToggle = (category: string) => {
    const operations = OPERATION_CATEGORIES[category] || [];
    const currentTypes = new Set(filters.operationTypes);

    // Check if any operations from this category are currently active
    const hasAny = operations.some((op) => currentTypes.has(op));

    if (hasAny) {
      // Remove all operations from this category
      operations.forEach((op) => currentTypes.delete(op));
    } else {
      // Add all operations from this category
      operations.forEach((op) => currentTypes.add(op));
    }

    setFilters({ operationTypes: Array.from(currentTypes) });
  };

  const isCategoryActive = (category: string) => {
    const operations = OPERATION_CATEGORIES[category] || [];
    return operations.some((op) => filters.operationTypes.includes(op));
  };

  const handlePredicateTypeToggle = (predicateType: PredicateType) => {
    const currentTypes = new Set(filters.predicateTypes);
    if (currentTypes.has(predicateType)) {
      currentTypes.delete(predicateType);
    } else {
      currentTypes.add(predicateType);
    }
    setFilters({ predicateTypes: Array.from(currentTypes) });
  };

  const isPredicateTypeActive = (predicateType: PredicateType) => {
    return filters.predicateTypes.includes(predicateType);
  };

  const clearFilters = () => {
    setActiveMatchIndex(null);
    setFilters({
      operationTypes: [],
      minCost: 0,
      maxCost: Infinity,
      searchText: '',
      showPredicates: true,
      predicateTypes: [],
      animateEdges: false,
      focusSelection: false,
      nodeDisplayOptions: { ...DEFAULT_NODE_DISPLAY_OPTIONS },
      minActualRows: 0,
      maxActualRows: Infinity,
      minActualTime: 0,
      maxActualTime: Infinity,
      minCardinalityMismatch: 0,
    });
  };

  if (!parsedPlan) return null;

  if (isCollapsed) {
    const filtersActive = hasActiveFilters(filters) || filteredCount !== totalCount;
    return (
      <div className="bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col items-center py-4 px-1.5 shadow-sm">
        <button
          onClick={() => setIsCollapsed(false)}
          className="relative h-9 w-9 flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 rounded-xl transition-all shadow-lg ring-2 ring-blue-500/20 active:scale-95"
          title={filtersActive ? `Show filters (active: ${filteredCount} / ${totalCount} ops visible)` : 'Show filters'}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          {filtersActive && (
            <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-amber-400 border-2 border-white dark:border-slate-900" aria-hidden="true" />
          )}
        </button>
        {filtersActive && (
          <span className="mt-2 text-[9px] font-bold text-amber-600 dark:text-amber-400 font-mono whitespace-nowrap">
            {filteredCount}/{totalCount}
          </span>
        )}
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-4 uppercase tracking-[0.2em] writing-mode-vertical whitespace-nowrap">Filter Workspace</span>
      </div>
    );
  }

  return (
    <div
      className="relative shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto"
      style={{ width: panelWidth }}
    >
      <button
        type="button"
        onPointerDown={onResizeStart}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize touch-none bg-transparent hover:bg-blue-500/40 transition-colors"
        aria-label="Resize filters panel"
      />
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
             <div className="p-1.5 bg-blue-600 rounded-lg shadow-sm">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
             </div>
             <div>
                <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-widest">Filters</h3>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono mt-0.5">
                   {filteredCount} / {totalCount} ops
                </div>
             </div>
          </div>
          <div className="flex items-center gap-1">
             <button
                onClick={clearFilters}
                className="px-2 py-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded uppercase tracking-wider transition-colors"
              >
                Reset
              </button>
              <button
                  onClick={() => setIsCollapsed(true)}
                  className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-md transition-colors text-slate-400 dark:text-slate-500"
                  title="Collapse panel"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                  </svg>
                </button>
          </div>
        </div>
      </div>

      {/* View Settings */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
          View Settings
        </label>
        
        {viewMode === 'hierarchical' && parsedPlan && !treeCompareEnabled && (
          <div className="mb-4">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-2 font-medium">Node Indicator</span>
            <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800 rounded-md p-1 border border-slate-200 dark:border-slate-700">
              <IndicatorButton metric="cost" label="Cost" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
              {parsedPlan.hasActualStats && (
                <>
                  <IndicatorButton metric="actualRows" label="A-Rows" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                  <IndicatorButton metric="actualTime" label="A-Time" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                  <IndicatorButton metric="starts" label="Starts" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                </>
              )}
            </div>
          </div>
        )}

        {viewMode === 'sankey' && parsedPlan && (
           <div className="mb-4">
            <span className="block text-[11px] text-slate-500 dark:text-slate-400 mb-2 font-medium">Flow Metric</span>
            <div className="grid grid-cols-2 gap-1 bg-slate-100 dark:bg-slate-800 rounded-md p-1 border border-slate-200 dark:border-slate-700">
                <IndicatorButton metric="rows" label={parsedPlan.hasActualStats ? 'E-Rows' : 'Rows'} current={sankeyMetric} onClick={setSankeyMetric} />
                <IndicatorButton metric="cost" label="Cost" current={sankeyMetric} onClick={setSankeyMetric} />
                {parsedPlan.hasActualStats && (
                  <>
                    <IndicatorButton metric="actualRows" label="Rows × Starts" current={sankeyMetric} onClick={setSankeyMetric} />
                    <IndicatorButton metric="actualTime" label="A-Time" current={sankeyMetric} onClick={setSankeyMetric} />
                  </>
                )}
            </div>
          </div>
        )}

        <CustomizeViewMenu
          filters={filters}
          setFilters={setFilters}
          hasActualStats={parsedPlan.hasActualStats}
          defaultNodeDisplayOptions={DEFAULT_NODE_DISPLAY_OPTIONS}
        />
      </div>

      {/* Search */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
          Search
        </label>
        <div className="relative">
          <input
            type="text"
            value={filters.searchText}
            onChange={(e) => setFilters({ searchText: e.target.value })}
            placeholder="Operation, object, predicate..."
            className="w-full px-3 py-1.5 text-[11px] border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 shadow-sm"
          />
          <div className="absolute right-2 top-1.5 pointer-events-none">
             <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
             </svg>
          </div>
        </div>
        {filters.searchText.trim() && (
          <div className="mt-2 flex items-center justify-between text-[10px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-tight">
            <span>
              {searchMatches.length === 0
                ? 'No matches'
                : activeMatchIndex === null
                  ? `${searchMatches.length} match${searchMatches.length !== 1 ? 'es' : ''}`
                  : `${Math.min(activeMatchIndex + 1, searchMatches.length)} / ${searchMatches.length} matches`}
            </span>
            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleMatchNavigate('prev')}
                  className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Previous match"
                >
                  Prev
                </button>
                <button
                  onClick={() => handleMatchNavigate('next')}
                  className="px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Next match"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Predicate Types */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
          Predicate types
        </label>
        <div className="flex flex-wrap gap-2">
          {([
            { type: 'access' as PredicateType, label: 'Access', count: predicateStats.access },
            { type: 'filter' as PredicateType, label: 'Filter', count: predicateStats.filter },
            { type: 'none' as PredicateType, label: 'None', count: predicateStats.none },
          ]).map(({ type, label, count }) => {
            if (count === 0) return null;
            const isActive = isPredicateTypeActive(type);

            return (
              <button
                key={type}
                onClick={() => handlePredicateTypeToggle(type)}
                className={`
                  flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-md transition-all font-semibold uppercase tracking-tight border
                  ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-1 ring-blue-400/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }
                `}
              >
                <span>{label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 dark:bg-slate-900 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Operation Categories */}
      <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3">
          Operation types
        </label>
        <div className="flex flex-wrap gap-2">
          {Object.keys(OPERATION_CATEGORIES).map((category) => {
            const count = operationStats.get(category) || 0;
            if (count === 0) return null;

            const isActive = isCategoryActive(category);

            return (
              <button
                key={category}
                onClick={() => handleCategoryToggle(category)}
                className={`
                   flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-md transition-all font-semibold uppercase tracking-tight border
                  ${
                    isActive
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm ring-1 ring-blue-400/30'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }
                `}
              >
                <span className="truncate max-w-[120px]">{category}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${isActive ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 dark:bg-slate-900 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thresholds */}
      <div className="p-3">
        <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3">
          Hide below threshold
        </label>
        <div className="space-y-4">
          {/* Cost Range */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Cost</span>
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">
                {filters.minCost > 0 ? `≥ ${filters.minCost}` : 'All'}
              </span>
            </div>
            <SliderHistogram values={costValues} max={maxCost} />
            <input
              type="range"
              min={0}
              max={maxCost}
              value={filters.minCost}
              onChange={(e) => setFilters({ minCost: parseInt(e.target.value) })}
              className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
            />
            <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-mono uppercase">
              <span>Show all</span>
              <span>{formatNumberShort(maxCost)}</span>
            </div>
          </div>

          {/* SQL Monitor: Actual Rows Range */}
          {parsedPlan?.hasActualStats && maxActualRows > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">A-Rows</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">
                  {filters.minActualRows > 0 ? `≥ ${formatNumberShort(filters.minActualRows, { infinity: '∞' })}` : 'All'}
                </span>
              </div>
              <SliderHistogram values={actualRowsValues} max={maxActualRows} />
              <input
                type="range"
                min={0}
                max={maxActualRows}
                value={filters.minActualRows === Infinity ? maxActualRows : filters.minActualRows}
                onChange={(e) => setFilters({ minActualRows: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-mono uppercase">
                <span>Show all</span>
                <span>{formatNumberShort(maxActualRows)}</span>
              </div>
            </div>
          )}

          {/* SQL Monitor: Actual Time Range */}
          {parsedPlan?.hasActualStats && maxActualTime > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">A-Time</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">
                  {filters.minActualTime > 0 ? `≥ ${formatTimeCompact(filters.minActualTime, { infinity: '∞' })}` : 'All'}
                </span>
              </div>
              <SliderHistogram values={actualTimeValues} max={maxActualTime} />
              <input
                type="range"
                min={0}
                max={maxActualTime}
                value={filters.minActualTime === Infinity ? maxActualTime : filters.minActualTime}
                onChange={(e) => setFilters({ minActualTime: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-mono uppercase">
                <span>Show all</span>
                <span>{formatTimeCompact(maxActualTime)}</span>
              </div>
            </div>
          )}

          {/* Cardinality Mismatch Filter */}
          {parsedPlan?.hasActualStats && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Cardinality mismatch</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono">
                  {filters.minCardinalityMismatch > 0 ? `≥ ${filters.minCardinalityMismatch}x` : 'Off'}
                </span>
              </div>
              <SliderHistogram values={cardinalityMismatchValues} max={100} />
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={filters.minCardinalityMismatch}
                onChange={(e) => setFilters({ minCardinalityMismatch: parseInt(e.target.value) })}
                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[9px] text-slate-400 dark:text-slate-500 mt-1 font-mono uppercase">
                <span>Off</span>
                <span>100x</span>
              </div>
              {filters.minCardinalityMismatch > 0 && (
                <div className="mt-1.5 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-[10px] text-amber-600 dark:text-amber-400 font-medium leading-tight">
                  E-Rows/A-Rows differ by {filters.minCardinalityMismatch}x+
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
