import { useId, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { PredicateType } from '../lib/types';
import { matchesSearch, hasActiveFilters } from '../lib/filtering';
import { computeCardinalityRatio, formatNumberShort, formatTimeCompact } from '../lib/format';
import { FOCUS_RING } from './ui';
import { PanelResizeHandle } from './PanelEdgeTab';

const HISTOGRAM_BUCKETS = 40;

// Hairline used by the panel's quiet chips.
const HAIRLINE = 'border border-slate-200/70 dark:border-slate-700/50';
const SECTION_HEADING = 'block text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-3';
const SLIDER_LABEL = 'text-[11px] text-slate-500 dark:text-slate-400 font-medium';
const SLIDER = `w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-blue-600 ${FOCUS_RING}`;

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

interface FilterPanelProps {
  panelWidth: number;
  // Method syntax so App's HTMLButtonElement-typed handler still fits the
  // separator element (method parameters are bivariant).
  onResizeStart(event: ReactPointerEvent<HTMLElement>): void;
  /** Keyboard resizing (←/→ on the splitter); the splitter is pointer-only without it. */
  onResizeBy?: (delta: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

const FILTER_PANEL_ID = 'filter-panel';

export function FilterPanel({ panelWidth, onResizeStart, onResizeBy, minWidth, maxWidth }: FilterPanelProps) {
  const {
    parsedPlan, filters, filteredNodes,
    filterPanelCollapsed: isCollapsed, setFilterPanelCollapsed: setIsCollapsed,
  } = usePlan();

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan?.allNodes.length || 0;

  if (!parsedPlan) return null;

  if (isCollapsed) {
    const filtersActive = hasActiveFilters(filters) || filteredCount !== totalCount;
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className={`shrink-0 w-[26px] h-full flex flex-col items-center pt-2.5 gap-2.5 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`}
        title={filtersActive ? `Show filters (active: ${filteredCount} / ${totalCount} ops visible)` : 'Show filters'}
        aria-label="Show filters"
        aria-expanded={false}
      >
        <svg className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="[writing-mode:vertical-rl] uppercase text-[10px] font-bold tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Filters
        </span>
        {filtersActive && (
          <span className="[writing-mode:vertical-rl] text-[10px] font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {filteredCount}/{totalCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      id={FILTER_PANEL_ID}
      className="relative shrink-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto"
      style={{ width: panelWidth }}
    >
      <PanelResizeHandle
        side="left"
        label="Resize filters panel"
        width={panelWidth}
        minWidth={minWidth}
        maxWidth={maxWidth}
        controls={FILTER_PANEL_ID}
        onPointerDown={onResizeStart}
        onResizeBy={onResizeBy}
      />
      <FilterPanelBody />
    </div>
  );
}

/**
 * The filter controls themselves, with no panel shell around them — shared by
 * the docked filter panel and focus mode's floating filter popover.
 */
export function FilterPanelBody() {
  const { parsedPlan, filters, setFilters, filteredNodes, selectNode } = usePlan();
  // null = no match navigated to yet (first "Next" selects the first match)
  const [activeMatchIndex, setActiveMatchIndex] = useState<number | null>(null);
  const idPrefix = useId();
  const ids = {
    search: `${idPrefix}-search`,
    predicates: `${idPrefix}-predicates`,
    operations: `${idPrefix}-operations`,
    thresholds: `${idPrefix}-thresholds`,
    cost: `${idPrefix}-cost`,
    actualRows: `${idPrefix}-arows`,
    actualTime: `${idPrefix}-atime`,
    mismatch: `${idPrefix}-mismatch`,
  };

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

  // Reset the active search match whenever the search text or plan changes.
  const [prevSearchText, setPrevSearchText] = useState(filters.searchText);
  const [prevParsedPlan, setPrevParsedPlan] = useState(parsedPlan);
  if (filters.searchText !== prevSearchText || parsedPlan !== prevParsedPlan) {
    setPrevSearchText(filters.searchText);
    setPrevParsedPlan(parsedPlan);
    setActiveMatchIndex(null);
  }

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
      predicateTypes: [],
      minActualRows: 0,
      maxActualRows: Infinity,
      minActualTime: 0,
      maxActualTime: Infinity,
      minCardinalityMismatch: 0,
    });
  };

  if (!parsedPlan) return null;

  return (
    <>
      <div className="px-3 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2 min-w-0">
            <h3 className="font-semibold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-widest">Filters</h3>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate">
              {filteredCount} / {totalCount} ops
            </span>
          </div>
          <div className="flex items-center gap-1">
            {(hasActiveFilters(filters) || filteredCount !== totalCount) && (
              <button
                type="button"
                onClick={clearFilters}
                className={`px-2 py-1 text-[10px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-md uppercase tracking-wider transition-colors ${FOCUS_RING}`}
              >
                Reset filters
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <label htmlFor={ids.search} className={SECTION_HEADING}>
          Search
        </label>
        <div className="relative">
          <input
            id={ids.search}
            type="text"
            value={filters.searchText}
            onChange={(e) => setFilters({ searchText: e.target.value })}
            placeholder="Operation, object, predicate..."
            className="w-full pl-0.5 pr-5 py-1.5 text-[11px] bg-transparent border-0 border-b border-slate-300 dark:border-slate-700 rounded-none text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-0 focus:border-blue-500"
          />
          <div className="absolute right-0.5 top-1.5 pointer-events-none">
             <svg className="w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
             </svg>
          </div>
        </div>
        {filters.searchText.trim() && (
          <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-tight">
            <span className="tabular-nums" role="status">
              {searchMatches.length === 0
                ? 'No matches'
                : activeMatchIndex === null
                  ? `${searchMatches.length} match${searchMatches.length !== 1 ? 'es' : ''}`
                  : `${Math.min(activeMatchIndex + 1, searchMatches.length)} / ${searchMatches.length} matches`}
            </span>
            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleMatchNavigate('prev')}
                  className={`px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${FOCUS_RING}`}
                  title="Previous match"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => handleMatchNavigate('next')}
                  className={`px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${FOCUS_RING}`}
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
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <h4 id={ids.predicates} className={SECTION_HEADING}>
          Predicate types
        </h4>
        <div role="group" aria-labelledby={ids.predicates} className="flex flex-wrap gap-2">
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
                type="button"
                aria-pressed={isActive}
                aria-label={type === 'none' ? `Without predicates (${count})` : `${label} predicates (${count})`}
                onClick={() => handlePredicateTypeToggle(type)}
                className={`
                  flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-md transition-colors font-semibold uppercase tracking-tight
                  ${HAIRLINE} ${FOCUS_RING}
                  ${
                    isActive
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                      : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }
                `}
              >
                <span>{label}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-slate-300/70 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200' : 'bg-slate-100 dark:bg-slate-900 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Operation Categories */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30">
        <h4 id={ids.operations} className={SECTION_HEADING}>
          Operation types
        </h4>
        <div role="group" aria-labelledby={ids.operations} className="flex flex-wrap gap-2">
          {Object.keys(OPERATION_CATEGORIES).map((category) => {
            const count = operationStats.get(category) || 0;
            if (count === 0) return null;

            const isActive = isCategoryActive(category);

            return (
              <button
                key={category}
                type="button"
                aria-pressed={isActive}
                aria-label={`${category} (${count})`}
                title={category}
                onClick={() => handleCategoryToggle(category)}
                className={`
                   flex items-center gap-1.5 px-2 py-1 text-[10px] rounded-md transition-colors font-semibold uppercase tracking-tight
                  ${HAIRLINE} ${FOCUS_RING}
                  ${
                    isActive
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                      : 'bg-transparent text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }
                `}
              >
                <span className="truncate max-w-[120px]">{category}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isActive ? 'bg-slate-300/70 dark:bg-slate-800/80 text-slate-700 dark:text-slate-200' : 'bg-slate-100 dark:bg-slate-900 text-slate-500'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Thresholds */}
      <div className="p-3">
        <h4 id={ids.thresholds} className={SECTION_HEADING}>
          Hide below threshold
        </h4>
        <div role="group" aria-labelledby={ids.thresholds} className="space-y-4">
          {/* Cost Range */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor={ids.cost} className={SLIDER_LABEL}>Minimum cost</label>
              <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono" aria-hidden="true">
                {filters.minCost > 0 ? `≥ ${filters.minCost}` : 'All'}
              </span>
            </div>
            <SliderHistogram values={costValues} max={maxCost} />
            <input
              id={ids.cost}
              type="range"
              min={0}
              max={maxCost}
              aria-valuetext={filters.minCost > 0 ? `at least ${filters.minCost}` : 'show all'}
              value={filters.minCost}
              onChange={(e) => setFilters({ minCost: parseInt(e.target.value) })}
              className={SLIDER}
            />
            <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tight">
              <span>Show all</span>
              <span className="font-mono tabular-nums">{formatNumberShort(maxCost)}</span>
            </div>
          </div>

          {/* SQL Monitor: Actual Rows Range */}
          {parsedPlan?.hasActualStats && maxActualRows > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor={ids.actualRows} className={SLIDER_LABEL}>Minimum A-Rows</label>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono" aria-hidden="true">
                  {filters.minActualRows > 0 ? `≥ ${formatNumberShort(filters.minActualRows, { infinity: '∞' })}` : 'All'}
                </span>
              </div>
              <SliderHistogram values={actualRowsValues} max={maxActualRows} />
              <input
                id={ids.actualRows}
                type="range"
                min={0}
                max={maxActualRows}
                aria-valuetext={filters.minActualRows > 0 ? `at least ${formatNumberShort(filters.minActualRows, { infinity: 'infinity' })} rows` : 'show all'}
                value={filters.minActualRows === Infinity ? maxActualRows : filters.minActualRows}
                onChange={(e) => setFilters({ minActualRows: parseInt(e.target.value) })}
                className={SLIDER}
              />
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tight">
                <span>Show all</span>
                <span className="font-mono tabular-nums">{formatNumberShort(maxActualRows)}</span>
              </div>
            </div>
          )}

          {/* SQL Monitor: Actual Time Range */}
          {parsedPlan?.hasActualStats && maxActualTime > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor={ids.actualTime} className={SLIDER_LABEL}>Minimum A-Time</label>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono" aria-hidden="true">
                  {filters.minActualTime > 0 ? `≥ ${formatTimeCompact(filters.minActualTime, { infinity: '∞' })}` : 'All'}
                </span>
              </div>
              <SliderHistogram values={actualTimeValues} max={maxActualTime} />
              <input
                id={ids.actualTime}
                type="range"
                min={0}
                max={maxActualTime}
                aria-valuetext={filters.minActualTime > 0 ? `at least ${formatTimeCompact(filters.minActualTime, { infinity: 'infinity' })}` : 'show all'}
                value={filters.minActualTime === Infinity ? maxActualTime : filters.minActualTime}
                onChange={(e) => setFilters({ minActualTime: parseInt(e.target.value) })}
                className={SLIDER}
              />
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tight">
                <span>Show all</span>
                <span className="font-mono tabular-nums">{formatTimeCompact(maxActualTime)}</span>
              </div>
            </div>
          )}

          {/* Cardinality Mismatch Filter */}
          {parsedPlan?.hasActualStats && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor={ids.mismatch} className={SLIDER_LABEL}>Minimum cardinality mismatch</label>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 font-mono" aria-hidden="true">
                  {filters.minCardinalityMismatch > 0 ? `≥ ${filters.minCardinalityMismatch}x` : 'Off'}
                </span>
              </div>
              <SliderHistogram values={cardinalityMismatchValues} max={100} />
              <input
                id={ids.mismatch}
                type="range"
                min={0}
                max={100}
                step={1}
                aria-valuetext={filters.minCardinalityMismatch > 0 ? `at least ${filters.minCardinalityMismatch} times` : 'off'}
                value={filters.minCardinalityMismatch}
                onChange={(e) => setFilters({ minCardinalityMismatch: parseInt(e.target.value) })}
                className={SLIDER}
              />
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tight">
                <span>Off</span>
                <span className="font-mono tabular-nums">100x</span>
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
    </>
  );
}
