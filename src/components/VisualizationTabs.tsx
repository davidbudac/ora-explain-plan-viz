import { useEffect, useMemo } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { useNarrowWorkspace } from '../hooks/useNarrowWorkspace';
import { HierarchicalView } from './views/HierarchicalView';
import { SankeyView } from './views/SankeyView';
import { FlameView } from './views/FlameView';
import { TabularView } from './views/TabularView';
import { TabularCompareView } from './views/TabularCompareView';
import { CompareView } from './views/CompareView';
import { SqlTextView } from './views/SqlTextView';
import { MonitorDetailsView } from './views/MonitorDetailsView';
import { TreeCompareView } from './views/TreeCompareView';
import { PlanTextView } from './views/PlanTextView';
import { Legend } from './Legend';
import { NoMatchesBanner } from './NoMatchesBanner';
import { AnalysisOverview } from './AnalysisOverview';
import { MetadataView } from './metadata/MetadataView';
import { ExperimentalView } from './views/experimental/ExperimentalView';
import { AiReportView } from './views/AiReportView';
import { AiReportPrototypeView } from './views/prototype/AiReportPrototypeView';
import { isFilterActive, matchesFilters } from '../lib/filtering';
import { OVERVIEW_VIEW_MODES } from '../lib/overview';
import type { ViewMode } from '../lib/types';

/** Views that dim / hide non-matching operations and so need the "nothing matches" banner. */
const FILTERED_VIEWS: ReadonlySet<ViewMode> = new Set<ViewMode>(['hierarchical', 'tabular', 'sankey', 'flame', 'experimental']);

/**
 * Banner offset from the top of the view area (px), clearing each view's own
 * top chrome: the experimental sub-view switcher, and the tabular toolbar +
 * sticky two-row header (plus the pane header in the side-by-side variants).
 */
function bannerTop(viewMode: ViewMode, sideBySide: boolean): number {
  switch (viewMode) {
    case 'experimental':
      return 56;
    case 'tabular':
      return sideBySide ? 160 : 100;
    case 'hierarchical':
      return sideBySide ? 72 : 12;
    default:
      return 12;
  }
}
/** Room for the focus-mode floating pill (top-3, h-10) that sits over the canvas. */
const FOCUS_PILL_CLEARANCE = 52;

export function VisualizationTabs() {
  const {
    viewMode,
    parsedPlan,
    treeCompareEnabled,
    exportPngFnRef,
    filters,
    filteredNodeIds,
    plans,
    comparePlanIndices,
    focusMode,
  } = usePlan();
  const narrowWorkspace = useNarrowWorkspace();

  useEffect(() => {
    if (viewMode !== 'hierarchical' || treeCompareEnabled) {
      exportPngFnRef.current = null;
    }
  }, [exportPngFnRef, treeCompareEnabled, viewMode]);

  const sideBySide = treeCompareEnabled && (viewMode === 'hierarchical' || viewMode === 'tabular');

  // "Active filters match nothing": filteredNodeIds holds every id when no
  // filter is active, so an empty set only means "nothing matches" when a
  // filter is active and the plan has operations. The side-by-side tree /
  // tabular variants show two plans, so require that neither has a match.
  const noMatches = useMemo(() => {
    if (!FILTERED_VIEWS.has(viewMode) || !isFilterActive(filters)) return false;
    if (sideBySide) {
      const shown = comparePlanIndices
        .map((index) => plans[index]?.parsedPlan)
        .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan && plan.allNodes.length > 0));
      if (shown.length === 0) return false;
      return shown.every(
        (plan) => !plan.allNodes.some((node) => matchesFilters(node, filters, plan.hasActualStats ?? false))
      );
    }
    return !!parsedPlan && parsedPlan.allNodes.length > 0 && filteredNodeIds.size === 0;
  }, [viewMode, filters, sideBySide, comparePlanIndices, plans, parsedPlan, filteredNodeIds]);

  if (!parsedPlan && viewMode !== 'compare') {
    return null;
  }

  const focusPillShown = focusMode && !narrowWorkspace;
  const top = bannerTop(viewMode, sideBySide) + (focusPillShown ? FOCUS_PILL_CLEARANCE : 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-slate-900">
      <div className="flex-1 min-h-0 h-full relative">
        {viewMode === 'hierarchical' && (treeCompareEnabled ? <TreeCompareView /> : <HierarchicalView />)}
        {viewMode === 'compare' && <CompareView />}
        {viewMode === 'sankey' && <SankeyView />}
        {viewMode === 'flame' && <FlameView />}
        {viewMode === 'tabular' && (treeCompareEnabled ? <TabularCompareView /> : <TabularView />)}
        {viewMode === 'text' && <PlanTextView />}
        {viewMode === 'sql' && <SqlTextView />}
        {viewMode === 'metadata' && <MetadataView />}
        {viewMode === 'monitor' && <MonitorDetailsView />}
        {viewMode === 'experimental' && <ExperimentalView />}
        {viewMode === 'ai' && <AiReportView />}
        {viewMode === 'ai-report' && <AiReportPrototypeView />}
        {(viewMode === 'hierarchical' || viewMode === 'sankey' || viewMode === 'flame' || viewMode === 'tabular') && <Legend />}
        {FILTERED_VIEWS.has(viewMode) && <NoMatchesBanner visible={noMatches} top={top} />}
        <AnalysisOverview active={OVERVIEW_VIEW_MODES.has(viewMode) && !sideBySide} top={top} />
      </div>
    </div>
  );
}
