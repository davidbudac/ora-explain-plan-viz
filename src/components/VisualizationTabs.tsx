import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode, NodeIndicatorMetric } from '../lib/types';
import { HierarchicalView } from './views/HierarchicalView';
import { SankeyView } from './views/SankeyView';
import { CompareView } from './views/CompareView';

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
    id: 'text',
    label: 'Plan Text',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

function IndicatorButton({
  metric,
  label,
  current,
  onClick,
  activeClass = 'bg-blue-600 text-white shadow-sm',
}: {
  metric: NodeIndicatorMetric;
  label: string;
  current: NodeIndicatorMetric;
  onClick: (m: NodeIndicatorMetric) => void;
  activeClass?: string;
}) {
  return (
    <button
      onClick={() => onClick(metric)}
      className={`
        px-2.5 py-1 text-xs rounded-md transition-colors font-medium
        ${current === metric ? activeClass : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}
      `}
    >
      {label}
    </button>
  );
}

export function VisualizationTabs() {
  const { viewMode, setViewMode, sankeyMetric, setSankeyMetric, nodeIndicatorMetric, setNodeIndicatorMetric, parsedPlan, rawInput } = usePlan();

  if (viewMode === 'compare') {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <CompareView />
      </div>
    );
  }

  if (!parsedPlan) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 gap-2">
        <div className="flex gap-1">
          {tabs.filter(tab => tab.id !== 'compare').map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border
                ${
                  viewMode === tab.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                }
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Hierarchical indicator metric toggle */}
        {viewMode === 'hierarchical' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">Indicator</span>
            <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700">
              <IndicatorButton
                metric="cost"
                label="Cost"
                current={nodeIndicatorMetric}
                onClick={setNodeIndicatorMetric}
              />
              {parsedPlan.hasActualStats && (
                <>
                  <IndicatorButton
                    metric="actualRows"
                    label="A-Rows"
                    current={nodeIndicatorMetric}
                    onClick={setNodeIndicatorMetric}
                  />
                  <IndicatorButton
                    metric="actualTime"
                    label="A-Time"
                    current={nodeIndicatorMetric}
                    onClick={setNodeIndicatorMetric}
                  />
                  <IndicatorButton
                    metric="starts"
                    label="Starts"
                    current={nodeIndicatorMetric}
                    onClick={setNodeIndicatorMetric}
                  />
                  <IndicatorButton
                    metric="activityPercent"
                    label="Activity %"
                    current={nodeIndicatorMetric}
                    onClick={setNodeIndicatorMetric}
                  />
                </>
              )}
            </div>
          </div>
        )}

        {/* Sankey metric toggle */}
        {viewMode === 'sankey' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-600 dark:text-neutral-400">Show by</span>
            <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700">
              <button
                onClick={() => setSankeyMetric('rows')}
                className={`
                  px-2.5 py-1 text-xs rounded-md transition-colors font-medium
                  ${
                    sankeyMetric === 'rows'
                      ? 'bg-blue-600 text-white'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                  }
                `}
              >
                {parsedPlan.hasActualStats ? 'E-Rows' : 'Rows'}
              </button>
              <button
                onClick={() => setSankeyMetric('cost')}
                className={`
                  px-2.5 py-1 text-xs rounded-md transition-colors font-medium
                  ${
                    sankeyMetric === 'cost'
                      ? 'bg-blue-600 text-white'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'
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
                      px-2.5 py-1 text-xs rounded-md transition-colors font-medium
                      ${
                        sankeyMetric === 'actualRows'
                          ? 'bg-blue-600 text-white'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                      }
                    `}
                  >
                    A-Rows
                  </button>
                  <button
                    onClick={() => setSankeyMetric('actualTime')}
                    className={`
                      px-2.5 py-1 text-xs rounded-md transition-colors font-medium
                      ${
                        sankeyMetric === 'actualTime'
                          ? 'bg-blue-600 text-white'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'
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
        {viewMode === 'text' && (
          <div className="h-full overflow-auto bg-neutral-50 dark:bg-neutral-950 p-4">
            <pre className="text-xs font-mono text-neutral-800 dark:text-neutral-200 whitespace-pre leading-relaxed">
              {rawInput || 'No plan text available.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
