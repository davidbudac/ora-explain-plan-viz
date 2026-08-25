import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { PlanTabs } from './PlanTabs';
import type { ViewMode } from '../lib/types';
import { ViewIcon } from './viewIcons';

const tabs: { id: ViewMode; label: string }[] = [
  { id: 'hierarchical', label: 'Tree' },
  { id: 'compare', label: 'Compare' },
  { id: 'tabular', label: 'Tabular' },
  { id: 'sankey', label: 'Sankey' },
  { id: 'flame', label: 'Flame' },
  { id: 'text', label: 'Plan Text' },
  { id: 'sql', label: 'SQL' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'experimental', label: 'Experimental' },
];

// Slack for the ribbon's own padding + the gap between the plan tabs and the
// view-tab strip, so the collapse decision leaves a little breathing room.
const RIBBON_CHROME_PX = 56;

export function NavRibbon() {
  const { viewMode, setViewMode, parsedPlan, plans, visualizationMaximized, setVisualizationMaximized } = usePlan();

  const rootRef = useRef<HTMLDivElement>(null);
  const planTabsRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  const [iconOnly, setIconOnly] = useState(false);

  const comparablePlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const compareEnabled = comparablePlanCount >= 2;
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'sql') return Boolean(parsedPlan?.sqlText);
    if (tab.id === 'monitor') return parsedPlan?.source === 'sql_monitor_xml';
    return true;
  });

  // If the current view's tab isn't available for this plan (e.g. SQL view but
  // the plan has no SQL text, or a persisted view mode from a previous session),
  // fall back to the tree view instead of showing an empty hidden view.
  const viewModeAvailable = visibleTabs.some((tab) => tab.id === viewMode);
  useEffect(() => {
    if (parsedPlan && !viewModeAvailable) {
      setViewMode('hierarchical');
    }
  }, [parsedPlan, viewModeAvailable, setViewMode]);

  // Collapse the view tabs to icon-only based on the space actually left over
  // by the plan tabs, rather than a fixed breakpoint. The labelled width is
  // re-measured every time (by briefly un-hiding the sr-only labels in place)
  // so the decision never rides on a stale first-paint measurement.
  const visibleTabCount = visibleTabs.length;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const strip = tabStripRef.current;
    if (!root || !strip) return;

    const measureLabelledWidth = () => {
      const labels = strip.querySelectorAll<HTMLElement>('[data-tab-label]');
      if (labels.length === 0) return strip.scrollWidth;
      const hidden = [...labels].filter((el) => el.classList.contains('sr-only'));
      hidden.forEach((el) => el.classList.remove('sr-only'));
      const width = strip.scrollWidth;
      hidden.forEach((el) => el.classList.add('sr-only'));
      return width;
    };

    const measure = () => {
      const planTabsNeeds = planTabsRef.current?.scrollWidth ?? 0;
      const available = root.clientWidth - RIBBON_CHROME_PX;
      setIconOnly(planTabsNeeds + measureLabelledWidth() > available);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (planTabsRef.current) observer.observe(planTabsRef.current);
    return () => observer.disconnect();
  }, [visibleTabCount, comparablePlanCount, plans.length]);

  // Keep the ribbon (and with it the plan tabs) while any slot holds a plan —
  // an empty active slot still needs a way back to the other plan. Its view
  // tabs would have nothing to switch, so they're hidden instead.
  const activeSlotEmpty = !parsedPlan && viewMode !== 'compare';
  if (comparablePlanCount === 0 && viewMode !== 'compare') return null;

  return (
    <div
      ref={rootRef}
      className="flex items-center justify-between gap-3 px-3 py-1 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 shadow-sm z-20"
    >
      <div className="flex-1 min-w-0 overflow-x-auto scrollbar-none">
        {/* Inner w-max wrapper: its scrollWidth is the plan tabs' natural width,
            which is what the collapse measurement below needs. */}
        <div ref={planTabsRef} className="flex items-center gap-4 w-max">
          <PlanTabs />
        </div>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div
          ref={tabStripRef}
          className={`flex min-w-0 overflow-x-auto scrollbar-none bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50 ${
            activeSlotEmpty ? 'hidden' : ''
          }`}
        >
          {visibleTabs.map((tab) => {
            const isDisabled = tab.id === 'compare' && !compareEnabled;
            const isActive = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  if (isDisabled) return;
                  setViewMode(tab.id);
                }}
                disabled={isDisabled}
                title={isDisabled ? 'Load a second plan (+ Add Plan) to enable comparison' : tab.label}
                className={`
                  shrink-0 flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all
                  ${isActive
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                    : isDisabled
                      ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
                `}
              >
                <ViewIcon mode={tab.id} />
                <span data-tab-label className={iconOnly ? 'sr-only' : ''}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {!activeSlotEmpty && (
          <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-700/50 mx-1 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => setVisualizationMaximized(!visualizationMaximized)}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          title={visualizationMaximized ? 'Exit fullscreen visualization (F)' : 'Maximize visualization (F)'}
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
  );
}
