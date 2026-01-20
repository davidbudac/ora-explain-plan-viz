import { useMemo, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { PredicateType } from '../lib/types';

export function FilterPanel() {
  const { parsedPlan, filters, setFilters, getFilteredNodes } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);

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

  const filteredCount = getFilteredNodes().length;
  const totalCount = parsedPlan?.allNodes.length || 0;

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
    setFilters({
      operationTypes: [],
      minCost: 0,
      maxCost: Infinity,
      searchText: '',
      predicateTypes: [],
    });
  };

  if (!parsedPlan) return null;

  if (isCollapsed) {
    return (
      <div className="bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col items-center py-4">
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          title="Show filters"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </button>
        <span className="text-xs text-gray-500 dark:text-gray-400 mt-2 writing-mode-vertical">Filters</span>
      </div>
    );
  }

  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCollapsed(true)}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
              title="Collapse panel"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="font-semibold text-gray-900 dark:text-gray-100">Filters</h3>
          </div>
          <button
            onClick={clearFilters}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            Clear all
          </button>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          Showing {filteredCount} of {totalCount} nodes
        </div>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Search
        </label>
        <input
          type="text"
          value={filters.searchText}
          onChange={(e) => setFilters({ searchText: e.target.value })}
          placeholder="Operation, object, predicate..."
          className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Display Options */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
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
            <span className="text-sm text-gray-700 dark:text-gray-300">Animate edges</span>
          </label>
          <div className="border-t border-gray-200 dark:border-gray-700 pt-2 mt-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 mb-2 block">Node Properties</span>
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
                <span className="text-sm text-gray-700 dark:text-gray-300">Object name</span>
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
                <span className="text-sm text-gray-700 dark:text-gray-300">Rows</span>
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
                <span className="text-sm text-gray-700 dark:text-gray-300">Cost</span>
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
                <span className="text-sm text-gray-700 dark:text-gray-300">Bytes</span>
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
                <span className="text-sm text-gray-700 dark:text-gray-300">Predicate indicators</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Cost Range */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
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
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
          <span>0</span>
          <span>{maxCost}</span>
        </div>
      </div>

      {/* Predicate Types */}
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
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
                  w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors
                  ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                      : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                `}
              >
                <span className="truncate">{label}</span>
                <span className="ml-2 px-2 py-0.5 bg-white dark:bg-gray-800 rounded text-xs">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Operation Categories */}
      <div className="p-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
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
                  w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors
                  ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700'
                      : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                `}
              >
                <span className="truncate">{category}</span>
                <span className="ml-2 px-2 py-0.5 bg-white dark:bg-gray-800 rounded text-xs">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
