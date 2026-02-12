import { useEffect, useMemo, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { PredicateType } from '../lib/types';
import { matchesSearch } from '../lib/filtering';
import { formatNumberShort, formatTimeCompact } from '../lib/format';

const DEFAULT_NODE_DISPLAY_OPTIONS = {
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
} as const;

export function FilterPanel() {
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
    });
  };

  if (!parsedPlan) return null;

  if (isCollapsed) {
    return (
      <div className="bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col items-center py-3">
        <button
          onClick={() => setIsCollapsed(false)}
          className="h-8 w-8 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors border border-slate-200 dark:border-slate-700"
          title="Show filters"
        >
          <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 writing-mode-vertical">Filters</span>
      </div>
    );
  }

  return (
    <div className="w-[250px] bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              title="Collapse panel"
            >
              <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="font-semibold text-sm text-slate-900 dark:text-slate-100">Filters</h3>
          </div>
          <button
            onClick={clearFilters}
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear all
          </button>
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400">
          Showing {filteredCount} of {totalCount} nodes
        </div>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
          Search
        </label>
        <input
          type="text"
          value={filters.searchText}
          onChange={(e) => setFilters({ searchText: e.target.value })}
          placeholder="Operation, object, predicate..."
          className="w-full px-2.5 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        />
        {filters.searchText.trim() && (
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-400">
            <span>
              {searchMatches.length === 0
                ? 'No matches'
                : `Match ${Math.min(activeMatchIndex + 1, searchMatches.length)} of ${searchMatches.length}`}
            </span>
            {searchMatches.length > 0 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleMatchNavigate('prev')}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Previous match"
                >
                  Prev
                </button>
                <button
                  onClick={() => handleMatchNavigate('next')}
                  className="px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                  title="Next match"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Display Options */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide">
          Display Options
        </label>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.animateEdges}
              onChange={(e) => setFilters({ animateEdges: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">Animate edges</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.focusSelection}
              onChange={(e) => setFilters({ focusSelection: e.target.checked })}
              className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-xs text-slate-700 dark:text-slate-300">Focus selection path</span>
          </label>
          <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
            <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 block uppercase tracking-wide">Node Properties</span>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showObjectName}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showObjectName: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Object name</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showRows}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showRows: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">
                  {parsedPlan?.hasActualStats ? 'E-Rows' : 'Rows'}
                </span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showCost}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showCost: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Cost</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showBytes}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showBytes: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Bytes</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showPredicateIndicators}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showPredicateIndicators: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Predicate indicators</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showPredicateDetails}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showPredicateDetails: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Predicate details</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showQueryBlockBadge}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showQueryBlockBadge: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Query block badge</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.nodeDisplayOptions.showQueryBlockGrouping}
                  onChange={(e) => setFilters({
                    nodeDisplayOptions: { ...filters.nodeDisplayOptions, showQueryBlockGrouping: e.target.checked }
                  })}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-xs text-slate-700 dark:text-slate-300">Query block grouping</span>
              </label>
            </div>
            {/* SQL Monitor actual statistics options */}
            {parsedPlan?.hasActualStats && (
              <div className="border-t border-slate-200 dark:border-slate-700 pt-2 mt-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 mb-2 block uppercase tracking-wide">Runtime Statistics</span>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.nodeDisplayOptions.showActualRows}
                      onChange={(e) => setFilters({
                        nodeDisplayOptions: { ...filters.nodeDisplayOptions, showActualRows: e.target.checked }
                      })}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300">A-Rows</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.nodeDisplayOptions.showActualTime}
                      onChange={(e) => setFilters({
                        nodeDisplayOptions: { ...filters.nodeDisplayOptions, showActualTime: e.target.checked }
                      })}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300">A-Time</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filters.nodeDisplayOptions.showStarts}
                      onChange={(e) => setFilters({
                        nodeDisplayOptions: { ...filters.nodeDisplayOptions, showStarts: e.target.checked }
                      })}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300">Starts</span>
                  </label>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Predicate Types */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide">
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
                  w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md transition-colors
                  ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }
                `}
              >
                <span className="truncate">{label}</span>
                <span className="ml-2 px-2 py-0.5 bg-white dark:bg-slate-900 rounded text-[11px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Operation Categories */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3 uppercase tracking-wide">
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
                  w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-md transition-colors
                  ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }
                `}
              >
                <span className="truncate">{category}</span>
                <span className="ml-2 px-2 py-0.5 bg-white dark:bg-slate-900 rounded text-[11px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cost Range */}
      <div className="p-3 border-b border-slate-200 dark:border-slate-800">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
          Minimum Cost: {filters.minCost}
        </label>
        <input
          type="range"
          min={0}
          max={maxCost}
          value={filters.minCost}
          onChange={(e) => setFilters({ minCost: parseInt(e.target.value) })}
          className="w-full accent-blue-600"
        />
        <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
          <span>0</span>
          <span>{maxCost}</span>
        </div>
      </div>

      {/* SQL Monitor: Actual Rows Range */}
      {parsedPlan?.hasActualStats && maxActualRows > 0 && (
        <div className="p-3 border-b border-slate-200 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
            Minimum A-Rows: {formatNumberShort(filters.minActualRows, { infinity: '∞' })}
          </label>
          <input
            type="range"
            min={0}
            max={maxActualRows}
            value={filters.minActualRows === Infinity ? maxActualRows : filters.minActualRows}
            onChange={(e) => setFilters({ minActualRows: parseInt(e.target.value) })}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            <span>0</span>
            <span>{formatNumberShort(maxActualRows, { infinity: '∞' })}</span>
          </div>
        </div>
      )}

      {/* SQL Monitor: Actual Time Range */}
      {parsedPlan?.hasActualStats && maxActualTime > 0 && (
        <div className="p-3">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">
            Minimum A-Time: {formatTimeCompact(filters.minActualTime, { infinity: '∞' })}
          </label>
          <input
            type="range"
            min={0}
            max={maxActualTime}
            value={filters.minActualTime === Infinity ? maxActualTime : filters.minActualTime}
            onChange={(e) => setFilters({ minActualTime: parseInt(e.target.value) })}
            className="w-full accent-blue-600"
          />
          <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            <span>0</span>
            <span>{formatTimeCompact(maxActualTime, { infinity: '∞' })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
