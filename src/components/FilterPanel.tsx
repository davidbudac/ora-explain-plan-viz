import { useMemo } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';

export function FilterPanel() {
  const { parsedPlan, filters, setFilters, getFilteredNodes } = usePlan();

  const operationStats = useMemo(() => {
    if (!parsedPlan) return new Map<string, number>();

    const stats = new Map<string, number>();
    for (const node of parsedPlan.allNodes) {
      const category = getOperationCategory(node.operation);
      stats.set(category, (stats.get(category) || 0) + 1);
    }
    return stats;
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

  const clearFilters = () => {
    setFilters({
      operationTypes: [],
      minCost: 0,
      maxCost: Infinity,
      searchText: '',
    });
  };

  if (!parsedPlan) return null;

  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-gray-900 dark:text-gray-100">Filters</h3>
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
