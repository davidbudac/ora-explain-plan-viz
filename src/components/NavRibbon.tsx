import React, { useEffect } from 'react';
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
    id: 'monitor',
    label: 'Monitor',
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
];

export function NavRibbon() {
  const { viewMode, setViewMode, parsedPlan, plans, visualizationMaximized, setVisualizationMaximized } = usePlan();

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

  if (!parsedPlan && viewMode !== 'compare') return null;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1 bg-slate-50 dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 shadow-sm z-20">
      <div className="flex items-center gap-4">
        <PlanTabs />
      </div>

      <div className="flex items-center gap-3">
        <div className="flex bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50">
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
                className={`
                  flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-all
                  ${isActive
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                    : isDisabled
                      ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
                `}
              >
                {tab.icon}
                <span className="hidden xl:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-slate-300/50 dark:bg-slate-700/50 mx-1" />

        <button
          type="button"
          onClick={() => setVisualizationMaximized(!visualizationMaximized)}
          className="h-8 w-8 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
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
