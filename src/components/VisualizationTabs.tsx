import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode } from '../lib/types';
import { HierarchicalView } from './views/HierarchicalView';
import { SankeyView } from './views/SankeyView';
import { FlameGraphD3Library } from './views/FlameGraphD3Library';
import { FlameGraphCustomD3 } from './views/FlameGraphCustomD3';
import { FlameGraphReact } from './views/FlameGraphReact';

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
    id: 'sankey',
    label: 'Sankey',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16" />
      </svg>
    ),
  },
  {
    id: 'flamegraph-d3lib',
    label: 'Flame (D3 Lib)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
      </svg>
    ),
  },
  {
    id: 'flamegraph-custom',
    label: 'Flame (Custom)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
      </svg>
    ),
  },
  {
    id: 'flamegraph-react',
    label: 'Flame (React)',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
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

        {/* Metric toggle for Sankey and Flame Graph views */}
        {(viewMode === 'sankey' || viewMode.startsWith('flamegraph')) && (
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
                {parsedPlan.hasActualStats ? 'E-Rows' : 'Rows'}
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
              {parsedPlan.hasActualStats && (
                <>
                  <button
                    onClick={() => setSankeyMetric('actualRows')}
                    className={`
                      px-3 py-1 text-sm rounded transition-colors
                      ${
                        sankeyMetric === 'actualRows'
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400'
                      }
                    `}
                  >
                    A-Rows
                  </button>
                  <button
                    onClick={() => setSankeyMetric('actualTime')}
                    className={`
                      px-3 py-1 text-sm rounded transition-colors
                      ${
                        sankeyMetric === 'actualTime'
                          ? 'bg-purple-500 text-white shadow-sm'
                          : 'text-gray-600 dark:text-gray-400'
                      }
                    `}
                  >
                    A-Time
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Visualization area */}
      <div className="flex-1 min-h-0 h-full">
        {viewMode === 'hierarchical' && <HierarchicalView />}
        {viewMode === 'sankey' && <SankeyView />}
        {viewMode === 'flamegraph-d3lib' && <FlameGraphD3Library />}
        {viewMode === 'flamegraph-custom' && <FlameGraphCustomD3 />}
        {viewMode === 'flamegraph-react' && <FlameGraphReact />}
      </div>
    </div>
  );
}
