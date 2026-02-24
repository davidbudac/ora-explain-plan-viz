import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { NodeDisplayOptions, PredicateType } from '../lib/types';
import { matchesSearch } from '../lib/filtering';
import { formatNumberShort, formatTimeCompact } from '../lib/format';
import { CustomizeViewMenu } from './CustomizeViewMenu';

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
  showAnnotations: true,
};

interface FilterPanelProps {
  panelWidth: number;
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

export function FilterPanel({ panelWidth, onResizeStart }: FilterPanelProps) {
  const { parsedPlan, filters, setFilters, filteredNodes, selectNode, filterPanelCollapsed: isCollapsed, setFilterPanelCollapsed: setIsCollapsed } = usePlan();
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);

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

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan?.allNodes.length || 0;

  const searchMatches = useMemo(() => {
    if (!parsedPlan) return [];
    const query = filters.searchText.trim();
    if (!query) return [];
    return parsedPlan.allNodes.filter((node) => matchesSearch(node, query)).map((node) => node.id);
  }, [parsedPlan, filters.searchText]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [filters.searchText, parsedPlan]);

  const handleMatchNavigate = (direction: 'prev' | 'next') => {
    if (searchMatches.length === 0) return;
    const delta = direction === 'next' ? 1 : -1;
    const nextIndex = (activeMatchIndex + delta + searchMatches.length) % searchMatches.length;
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
    setActiveMatchIndex(0);
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
    return (
      <div className="bg-[var(--surface)] dark:bg-[var(--surface-dark)] border-r border-[var(--border-color)] dark:border-[var(--border-color-dark)] flex flex-col items-center py-3">
        <button
          onClick={() => setIsCollapsed(false)}
          className="h-8 w-8 flex items-center justify-center hover:bg-[var(--surface-raised)] dark:hover:bg-[var(--surface-raised-dark)] rounded-xl transition-colors border border-[var(--border-color)] dark:border-[var(--border-color-dark)] shadow-sm"
          title="Show filters"
        >
          <svg className="w-4 h-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
        <span className="text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-2 writing-mode-vertical">Filters</span>
      </div>
    );
  }

  return (
    <div
      className="relative shrink-0 bg-[var(--surface)] dark:bg-[var(--surface-dark)] border-r border-[var(--border-color)] dark:border-[var(--border-color-dark)] overflow-y-auto"
      style={{ width: panelWidth }}
    >
      <button
        type="button"
        onPointerDown={onResizeStart}
        className="absolute right-0 top-0 z-10 h-full w-2 cursor-col-resize touch-none bg-transparent hover:bg-stone-200/70 dark:hover:bg-stone-700/70 transition-colors"
        aria-label="Resize filters panel"
        title="Resize filters panel"
      />
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-[var(--surface-raised)] dark:hover:bg-[var(--surface-raised-dark)] rounded transition-colors"
              title="Collapse panel"
            >
              <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-[var(--text-primary-dark)]">Filters</h3>
          </div>
          <button
            onClick={clearFilters}
            className="text-[11px] text-orange-600 dark:text-orange-400 hover:underline"
          >
            Clear all
          </button>
        </div>
        <div className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]">
          Showing {filteredCount} of {totalCount} nodes
        </div>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
          Search
        </label>
        <input
          type="text"
          value={filters.searchText}
          onChange={(e) => setFilters({ searchText: e.target.value })}
          placeholder="Operation, object, predicate..."
          className="w-full px-2.5 py-1.5 text-xs border border-[var(--border-color)] dark:border-[var(--border-color-dark)] rounded-xl bg-[var(--surface)] dark:bg-[var(--surface-dark)] text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] placeholder-[var(--text-muted)] dark:placeholder-[var(--text-muted-dark)] focus:outline-none focus:ring-2 focus:ring-orange-500/60 shadow-sm"
        />
        {filters.searchText.trim() && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]">
            <span>
              {searchMatches.length === 0
                ? 'No matches'
                : `Match ${Math.min(activeMatchIndex + 1, searchMatches.length)} of ${searchMatches.length}`}
            </span>
            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleMatchNavigate('prev')}
                  className="px-2 py-1 rounded-full border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface)] dark:bg-[var(--surface-dark)] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:shadow-md transition-all shadow-sm"
                  title="Previous match"
                >
                  Prev
                </button>
                <button
                  onClick={() => handleMatchNavigate('next')}
                  className="px-2 py-1 rounded-full border border-[var(--border-color)] dark:border-[var(--border-color-dark)] bg-[var(--surface)] dark:bg-[var(--surface-dark)] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:shadow-md transition-all shadow-sm"
                  title="Next match"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* View Customization */}
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
          View
        </label>
        <CustomizeViewMenu
          filters={filters}
          setFilters={setFilters}
          hasActualStats={parsedPlan.hasActualStats}
          defaultNodeDisplayOptions={DEFAULT_NODE_DISPLAY_OPTIONS}
        />
      </div>

      {/* Predicate Types */}
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-3">
          Predicate Types
        </label>
        <div className="space-y-2">
          {([
            { type: 'access' as PredicateType, label: 'Access Predicate', count: predicateStats.access },
            { type: 'filter' as PredicateType, label: 'Filter Predicate', count: predicateStats.filter },
            { type: 'none' as PredicateType, label: 'No Predicate', count: predicateStats.none },
          ]).map(({ type, label, count }) => {
            if (count === 0) return null;
            const isActive = isPredicateTypeActive(type);

            return (
              <button
                key={type}
                onClick={() => handlePredicateTypeToggle(type)}
                className={`
                  w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl transition-all
                  ${
                    isActive
                      ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                      : 'bg-[var(--surface-raised)] dark:bg-[var(--surface-raised-dark)] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] border border-[var(--border-color)] dark:border-[var(--border-color-dark)] hover:shadow-md shadow-sm'
                  }
                `}
              >
                <span className="truncate">{label}</span>
                <span className="ml-2 px-2 py-0.5 bg-[var(--surface)] dark:bg-[var(--surface-dark)] rounded-full text-[11px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Operation Categories */}
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-3">
          Operation Types
        </label>
        <div className="space-y-2">
          {Object.keys(OPERATION_CATEGORIES).map((category) => {
            const count = operationStats.get(category) || 0;
            if (count === 0) return null;

            const isActive = isCategoryActive(category);

            return (
              <button
                key={category}
                onClick={() => handleCategoryToggle(category)}
                className={`
                  w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-xl transition-all
                  ${
                    isActive
                      ? 'bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                      : 'bg-[var(--surface-raised)] dark:bg-[var(--surface-raised-dark)] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] border border-[var(--border-color)] dark:border-[var(--border-color-dark)] hover:shadow-md shadow-sm'
                  }
                `}
              >
                <span className="truncate">{category}</span>
                <span className="ml-2 px-2 py-0.5 bg-[var(--surface)] dark:bg-[var(--surface-dark)] rounded-full text-[11px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cost Range */}
      <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
        <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
          Minimum Cost: {filters.minCost}
        </label>
        <input
          type="range"
          min={0}
          max={maxCost}
          value={filters.minCost}
          onChange={(e) => setFilters({ minCost: parseInt(e.target.value) })}
          className="w-full accent-orange-600"
        />
        <div className="flex justify-between text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-1">
          <span>0</span>
          <span>{maxCost}</span>
        </div>
      </div>

      {/* SQL Monitor: Actual Rows Range */}
      {parsedPlan?.hasActualStats && maxActualRows > 0 && (
        <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
          <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
            Minimum A-Rows: {formatNumberShort(filters.minActualRows, { infinity: '\u221e' })}
          </label>
          <input
            type="range"
            min={0}
            max={maxActualRows}
            value={filters.minActualRows === Infinity ? maxActualRows : filters.minActualRows}
            onChange={(e) => setFilters({ minActualRows: parseInt(e.target.value) })}
            className="w-full accent-orange-600"
          />
          <div className="flex justify-between text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-1">
            <span>0</span>
            <span>{formatNumberShort(maxActualRows, { infinity: '\u221e' })}</span>
          </div>
        </div>
      )}

      {/* SQL Monitor: Actual Time Range */}
      {parsedPlan?.hasActualStats && maxActualTime > 0 && (
        <div className="p-3 border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
          <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
            Minimum A-Time: {formatTimeCompact(filters.minActualTime, { infinity: '\u221e' })}
          </label>
          <input
            type="range"
            min={0}
            max={maxActualTime}
            value={filters.minActualTime === Infinity ? maxActualTime : filters.minActualTime}
            onChange={(e) => setFilters({ minActualTime: parseInt(e.target.value) })}
            className="w-full accent-orange-600"
          />
          <div className="flex justify-between text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-1">
            <span>0</span>
            <span>{formatTimeCompact(maxActualTime, { infinity: '\u221e' })}</span>
          </div>
        </div>
      )}

      {/* Cardinality Mismatch Filter */}
      {parsedPlan?.hasActualStats && (
        <div className="p-3">
          <label className="block font-semibold text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">
            Min Cardinality Mismatch: {filters.minCardinalityMismatch > 0 ? `${filters.minCardinalityMismatch}x` : 'Off'}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={filters.minCardinalityMismatch}
            onChange={(e) => setFilters({ minCardinalityMismatch: parseInt(e.target.value) })}
            className="w-full accent-orange-600"
          />
          <div className="flex justify-between text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-1">
            <span>Off</span>
            <span>100x</span>
          </div>
          {filters.minCardinalityMismatch > 0 && (
            <div className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              Showing only nodes where E-Rows/A-Rows differ by {filters.minCardinalityMismatch}x+
            </div>
          )}
        </div>
      )}
    </div>
  );
}
