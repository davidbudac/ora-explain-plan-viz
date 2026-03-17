import { useEffect } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import type { ViewMode, NodeIndicatorMetric } from '../lib/types';
import { ComparePlanPicker } from './ComparePlanPicker';
import { HierarchicalView } from './views/HierarchicalView';
import { SankeyView } from './views/SankeyView';
import { TabularView } from './views/TabularView';
import { CompareView } from './views/CompareView';
import { SqlTextView } from './views/SqlTextView';
import { TreeCompareView } from './views/TreeCompareView';

const tabs: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    id: 'hierarchical',
    label: 'Tree',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
      </svg>
    ),
  },
  {
    id: 'compare',
    label: 'Compare',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    id: 'tabular',
    label: 'Tabular',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M3 6h18M3 18h18M9 6v12M15 6v12" />
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
  {
    id: 'sql',
    label: 'SQL',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
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
  onClick: (metric: NodeIndicatorMetric) => void;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(metric)}
      className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${current === metric ? activeClass : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
    >
      {label}
    </button>
  );
}

export function VisualizationTabs() {
  const {
    viewMode,
    setViewMode,
    sankeyMetric,
    setSankeyMetric,
    nodeIndicatorMetric,
    setNodeIndicatorMetric,
    parsedPlan,
    rawInput,
    plans,
    treeCompareEnabled,
    setTreeCompareEnabled,
    visualizationMaximized,
    setVisualizationMaximized,
    exportPngFnRef,
  } = usePlan();

  const comparablePlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const showCompareView = comparablePlanCount >= 2;
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'compare') return showCompareView;
    if (tab.id === 'sql') return Boolean(parsedPlan?.sqlText);
    return true;
  });

  useEffect(() => {
    if (viewMode !== 'hierarchical' || treeCompareEnabled) {
      exportPngFnRef.current = null;
    }
  }, [exportPngFnRef, treeCompareEnabled, viewMode]);

  if (!parsedPlan && viewMode !== 'compare') {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
        <div className="flex flex-wrap gap-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setViewMode(tab.id)}
              className={`
                flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border
                ${viewMode === tab.id
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'}
              `}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {viewMode === 'hierarchical' && comparablePlanCount >= 2 && (
            <>
              <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700">
                <button
                  type="button"
                  onClick={() => setTreeCompareEnabled(false)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${!treeCompareEnabled ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                >
                  Single
                </button>
                <button
                  type="button"
                  onClick={() => setTreeCompareEnabled(true)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${treeCompareEnabled ? 'bg-blue-600 text-white shadow-sm' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                >
                  Split Compare
                </button>
              </div>
              {treeCompareEnabled && <ComparePlanPicker />}
            </>
          )}

          {viewMode === 'compare' && <ComparePlanPicker />}

          {viewMode === 'hierarchical' && parsedPlan && !treeCompareEnabled && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">Indicator</span>
              <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700">
                <IndicatorButton metric="cost" label="Cost" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                {parsedPlan.hasActualStats && (
                  <>
                    <IndicatorButton metric="actualRows" label="A-Rows" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                    <IndicatorButton metric="actualTime" label="A-Time" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                    <IndicatorButton metric="starts" label="Starts" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                    <IndicatorButton metric="activityPercent" label="Activity %" current={nodeIndicatorMetric} onClick={setNodeIndicatorMetric} />
                  </>
                )}
              </div>
            </div>
          )}

          {viewMode === 'sankey' && parsedPlan && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-600 dark:text-neutral-400">Show by</span>
              <div className="flex bg-neutral-100 dark:bg-neutral-800 rounded-md p-0.5 border border-neutral-200 dark:border-neutral-700">
                <button
                  type="button"
                  onClick={() => setSankeyMetric('rows')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${sankeyMetric === 'rows' ? 'bg-blue-600 text-white' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                >
                  {parsedPlan.hasActualStats ? 'E-Rows' : 'Rows'}
                </button>
                <button
                  type="button"
                  onClick={() => setSankeyMetric('cost')}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${sankeyMetric === 'cost' ? 'bg-blue-600 text-white' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                >
                  Cost
                </button>
                {parsedPlan.hasActualStats && (
                  <>
                    <button
                      type="button"
                      onClick={() => setSankeyMetric('actualRows')}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${sankeyMetric === 'actualRows' ? 'bg-blue-600 text-white' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                    >
                      A-Rows
                    </button>
                    <button
                      type="button"
                      onClick={() => setSankeyMetric('actualTime')}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors font-medium ${sankeyMetric === 'actualTime' ? 'bg-blue-600 text-white' : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700'}`}
                    >
                      A-Time
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setVisualizationMaximized(!visualizationMaximized)}
            className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
            title={visualizationMaximized ? 'Exit fullscreen visualization' : 'Maximize visualization'}
            aria-label={visualizationMaximized ? 'Exit fullscreen visualization' : 'Maximize visualization'}
          >
            {visualizationMaximized ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4H4v4m0 8v4h4m8-16h4v4m0 8v4h-4" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9V4h5M20 9V4h-5M4 15v5h5m11-5v5h-5" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 h-full">
        {viewMode === 'hierarchical' && (treeCompareEnabled ? <TreeCompareView /> : <HierarchicalView />)}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'sankey' && <SankeyView />}
        {viewMode === 'tabular' && <TabularView />}
        {viewMode === 'text' && (
          <div className="h-full overflow-auto bg-neutral-50 dark:bg-neutral-950 p-4">
            <pre className="text-xs font-mono text-neutral-800 dark:text-neutral-200 whitespace-pre leading-relaxed">
              {rawInput || 'No plan text available.'}
            </pre>
          </div>
        )}
        {viewMode === 'sql' && <SqlTextView />}
      </div>
    </div>
  );
}
