import { useEffect } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { HierarchicalView } from './views/HierarchicalView';
import { SankeyView } from './views/SankeyView';
import { TabularView } from './views/TabularView';
import { TabularCompareView } from './views/TabularCompareView';
import { CompareView } from './views/CompareView';
import { SqlTextView } from './views/SqlTextView';
import { MonitorDetailsView } from './views/MonitorDetailsView';
import { TreeCompareView } from './views/TreeCompareView';

export function VisualizationTabs() {
  const {
    viewMode,
    parsedPlan,
    rawInput,
    treeCompareEnabled,
    exportPngFnRef,
  } = usePlan();

  useEffect(() => {
    if (viewMode !== 'hierarchical' || treeCompareEnabled) {
      exportPngFnRef.current = null;
    }
  }, [exportPngFnRef, treeCompareEnabled, viewMode]);

  if (!parsedPlan && viewMode !== 'compare') {
    return null;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
      <div className="flex-1 min-h-0 h-full relative">
        {viewMode === 'hierarchical' && (treeCompareEnabled ? <TreeCompareView /> : <HierarchicalView />)}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'sankey' && <SankeyView />}
        {viewMode === 'tabular' && (treeCompareEnabled ? <TabularCompareView /> : <TabularView />)}
        {viewMode === 'text' && (
          <div className="h-full overflow-auto bg-slate-50 dark:bg-slate-950 p-4 font-mono">
            <pre className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre leading-relaxed">
              {rawInput || 'No plan text available.'}
            </pre>
          </div>
        )}
        {viewMode === 'sql' && <SqlTextView />}
        {viewMode === 'monitor' && <MonitorDetailsView />}
      </div>
    </div>
  );
}
