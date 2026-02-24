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
  activeClass = 'bg-cyan-600 text-white shadow-sm',
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
        px-2.5 py-1 text-xs rounded-lg transition-colors font-medium
        ${current === metric ? activeClass : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-slate-700'}
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
      <div className="flex items-center justify-between px-3 py-1.5 bg-[var(--surface)] dark:bg-[var(--surface-dark)] border-b border-[var(--border-color)] dark:border-[var(--border-color-dark)] gap-2">
        <div className="flex gap-1">
          {tabs.filter(tab => tab.id !== 'compare').map((tab) => (
            <button
              key={tab.id}
              onClick={() => setViewMode(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors border
                ${
                  viewMode === tab.id
                    ? 'bg-cyan-600 text-white border-cyan-600'
                    : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] border-[var(--border-color)] dark:border-[var(--border-color-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-[var(--surface-raised-dark)]'
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
            <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]">Indicator</span>
            <div className="flex bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] rounded-lg p-0.5 border border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
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
            <span className="text-xs text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]">Show by</span>
            <div className="flex bg-[var(--surface-raised)] dark:bg-[var(--surface-card-dark)] rounded-lg p-0.5 border border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
              <button
                onClick={() => setSankeyMetric('rows')}
                className={`
                  px-2.5 py-1 text-xs rounded-lg transition-colors font-medium
                  ${
                    sankeyMetric === 'rows'
                      ? 'bg-cyan-600 text-white'
                      : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-slate-700'
                  }
                `}
              >
                {parsedPlan.hasActualStats ? 'E-Rows' : 'Rows'}
              </button>
              <button
                onClick={() => setSankeyMetric('cost')}
                className={`
                  px-2.5 py-1 text-xs rounded-lg transition-colors font-medium
                  ${
                    sankeyMetric === 'cost'
                      ? 'bg-cyan-600 text-white'
                      : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-slate-700'
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
                      px-2.5 py-1 text-xs rounded-lg transition-colors font-medium
                      ${
                        sankeyMetric === 'actualRows'
                          ? 'bg-cyan-600 text-white'
                          : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-slate-700'
                      }
                    `}
                  >
                    A-Rows
                  </button>
                  <button
                    onClick={() => setSankeyMetric('actualTime')}
                    className={`
                      px-2.5 py-1 text-xs rounded-lg transition-colors font-medium
                      ${
                        sankeyMetric === 'actualTime'
                          ? 'bg-cyan-600 text-white'
                          : 'text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-slate-700'
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
          <div className="h-full overflow-auto bg-[var(--surface-raised)] dark:bg-[var(--app-bg-dark)] p-4">
            <pre className="text-xs font-mono text-[var(--text-primary)] dark:text-[var(--text-primary-dark)] whitespace-pre leading-relaxed">
              {rawInput || 'No plan text available.'}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
