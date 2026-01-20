import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode } from '../lib/types';
import { HierarchicalView } from './views/HierarchicalView';
import { ForceDirectedView } from './views/ForceDirectedView';
import { SankeyView } from './views/SankeyView';

const tabs: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    id: 'hierarchical',
    label: 'Hierarchical',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    id: 'force',
    label: 'Force-Directed',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    id: 'sankey',
    label: 'Sankey',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
      </svg>
    ),
  },
];

export function VisualizationTabs() {
  const { viewMode, setViewMode, sankeyMetric, setSankeyMetric, parsedPlan } = usePlan();

  if (!parsedPlan) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`
                flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors
                ${
                  viewMode === tab.id
                    ? 'bg-white dark:bg-gray-900 text-blue-600 dark:text-blue-400 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Sankey metric toggle */}
        {viewMode === 'sankey' && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 dark:text-gray-400">Show by:</span>
            <div className="flex bg-gray-200 dark:bg-gray-700 rounded-md p-0.5">
              <button
                onClick={() => setSankeyMetric('rows')}
                className={`
                  px-3 py-1 text-sm rounded transition-colors
                  ${
                    sankeyMetric === 'rows'
                      ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }
                `}
              >
                Rows
              </button>
              <button
                onClick={() => setSankeyMetric('cost')}
                className={`
                  px-3 py-1 text-sm rounded transition-colors
                  ${
                    sankeyMetric === 'cost'
                      ? 'bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-600 dark:text-gray-400'
                  }
                `}
              >
                Cost
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Visualization area */}
      <div className="flex-1 min-h-0 h-full">
        {viewMode === 'hierarchical' && <HierarchicalView />}
        {viewMode === 'force' && <ForceDirectedView />}
        {viewMode === 'sankey' && <SankeyView />}
      </div>
    </div>
  );
}
