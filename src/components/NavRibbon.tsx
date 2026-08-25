import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { PlanTabs } from './PlanTabs';
import type { ViewMode } from '../lib/types';

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
    id: 'flame',
    label: 'Flame',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2c1 3-2 4-2 7a2 2 0 004 0c1 1 2 2.5 2 4.5A6 6 0 016 13.5c0-3 1.5-4.5 3-7 .5 1.5 1.5 2 2 1.5C10.5 6 11 4 12 2z" />
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
  {
    id: 'metadata',
    label: 'Metadata',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7M4 12c0 1.1 3.6 2 8 2s8-.9 8-2" />
      </svg>
    ),
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    id: 'experimental',
    label: 'Experimental',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
      </svg>
    ),
  },
];

// Slack for the ribbon's own padding + the gap between the plan tabs and the
// view-tab strip, so the collapse decision leaves a little breathing room.
const RIBBON_CHROME_PX = 56;

export function NavRibbon() {
  const { viewMode, setViewMode, parsedPlan, plans, visualizationMaximized, setVisualizationMaximized } = usePlan();

  const rootRef = useRef<HTMLDivElement>(null);
  const planTabsRef = useRef<HTMLDivElement>(null);
  const tabStripRef = useRef<HTMLDivElement>(null);
  // Width the view-tab strip needs while it still shows labels. Cached because
  // once collapsed we can no longer measure the expanded width directly.
  const expandedStripWidth = useRef<number | null>(null);
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

  // The tab set changes with the plan (SQL / Monitor tabs), which invalidates
  // the cached expanded width — start over from the labelled layout.
  const visibleTabCount = visibleTabs.length;
  useLayoutEffect(() => {
    expandedStripWidth.current = null;
    setIconOnly(false);
  }, [visibleTabCount]);

  // Collapse the view tabs to icon-only based on the space actually left over
  // by the plan tabs, rather than a fixed breakpoint.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const strip = tabStripRef.current;
    if (!root || !strip) return;

    const measure = () => {
      if (!iconOnly) expandedStripWidth.current = strip.scrollWidth;
      const stripNeeds = expandedStripWidth.current ?? strip.scrollWidth;
      const planTabsNeeds = planTabsRef.current?.scrollWidth ?? 0;
      const available = root.clientWidth - RIBBON_CHROME_PX;
      setIconOnly(planTabsNeeds + stripNeeds > available);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(strip);
    if (planTabsRef.current) observer.observe(planTabsRef.current);
    return () => observer.disconnect();
  }, [iconOnly, visibleTabCount, comparablePlanCount, plans.length]);

  if (!parsedPlan && viewMode !== 'compare') return null;

  return (
    <div
      ref={rootRef}
      className="flex items-center justify-between gap-3 px-3 py-1 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 shadow-sm z-20"
    >
      <div ref={planTabsRef} className="flex flex-1 items-center gap-4 min-w-0 overflow-x-auto scrollbar-none">
        <PlanTabs />
      </div>

      <div className="flex items-center gap-3 min-w-0">
        <div
          ref={tabStripRef}
          className="flex min-w-0 overflow-x-auto scrollbar-none bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50"
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
                  shrink-0 flex items-center gap-1.5 ${iconOnly ? 'px-2' : 'px-3'} py-1 text-xs font-semibold rounded-md transition-all
                  ${isActive
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                    : isDisabled
                      ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
                `}
              >
                {tab.icon}
                <span className={iconOnly ? 'sr-only' : ''}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-700/50 mx-1 shrink-0" />

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
