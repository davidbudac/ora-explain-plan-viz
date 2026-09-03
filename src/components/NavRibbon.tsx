import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { useAi } from '../hooks/useAiAnalysis';
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
  { id: 'ai', label: 'AI (Beta)' },
  { id: 'ai-report', label: 'AI (proto)' },
];

// Keyboard focus ring. Inset inside the tab strip, whose `overflow-x-auto`
// would otherwise clip an outset ring on the first/last tab.
const FOCUS_RING_INSET =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

// The strip's own padding + border, and the width the overflow "⋯" trigger
// takes inside it. Both are subtracted from the space the tabs may claim.
const STRIP_CHROME_PX = 12;
const OVERFLOW_TRIGGER_PX = 34;

interface TabLayout {
  /** Labels hidden (icon + title tooltip only). */
  iconOnly: boolean;
  /** How many tabs stay in the strip; the rest move to the "⋯" menu. */
  visibleCount: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * The view-tab cluster of the single top bar. It is the bar's only flexible
 * child (`flex-1` over a zero basis), so it always reports the space the fixed
 * clusters left over, and degrades in three steps as that space shrinks:
 * full labels → icon-only tabs → the tail of the list in an overflow menu.
 */
export function ViewTabStrip() {
  const { viewMode, setViewMode, parsedPlan, plans } = usePlan();
  const { report: aiReport } = useAi();

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<TabLayout>({ iconOnly: false, visibleCount: tabs.length });
  const [overflowOpen, setOverflowOpen] = useState(false);

  const comparablePlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const compareEnabled = comparablePlanCount >= 2;
  const availableTabs = tabs.filter((tab) => {
    if (tab.id === 'sql') return Boolean(parsedPlan?.sqlText);
    if (tab.id === 'monitor') return parsedPlan?.source === 'sql_monitor_xml';
    if (tab.id === 'ai') return Boolean(parsedPlan) || aiReport !== null;
    // Throwaway design prototype (wayfinder ticket 08) — dev builds only.
    if (tab.id === 'ai-report') return import.meta.env.DEV;
    return true;
  });

  // A slot the user added but hasn't filled has nothing for the view tabs to
  // switch between; the plan tabs beside them still need to render.
  const activeSlotEmpty = !parsedPlan && viewMode !== 'compare';
  const shown = !(comparablePlanCount === 0 && viewMode !== 'compare') && !activeSlotEmpty;

  // If the current view's tab isn't available for this plan (e.g. SQL view but
  // the plan has no SQL text, or a persisted view mode from a previous session),
  // fall back to the tree view instead of showing an empty hidden view.
  const viewModeAvailable = availableTabs.some((tab) => tab.id === viewMode);
  useEffect(() => {
    if (parsedPlan && !viewModeAvailable) {
      setViewMode('hierarchical');
    }
  }, [parsedPlan, viewModeAvailable, setViewMode]);

  // Re-measure both the labelled and the icon-only width of every tab on each
  // pass (by briefly normalising the classes in place) so the decision never
  // rides on a stale measurement of whatever state is currently rendered.
  const availableTabCount = availableTabs.length;
  useLayoutEffect(() => {
    if (!shown) return;
    const wrap = wrapRef.current;
    const list = listRef.current;
    if (!wrap || !list) return;

    const measure = () => {
      const buttons = [...list.querySelectorAll<HTMLElement>('[data-view-tab]')];
      if (buttons.length === 0) return;
      const labels = [...list.querySelectorAll<HTMLElement>('[data-tab-label]')];
      const wasHidden = buttons.filter((el) => el.classList.contains('hidden'));
      const wasSrOnly = labels.filter((el) => el.classList.contains('sr-only'));

      wasHidden.forEach((el) => el.classList.remove('hidden'));
      wasSrOnly.forEach((el) => el.classList.remove('sr-only'));
      const labelledWidths = buttons.map((el) => el.offsetWidth);
      labels.forEach((el) => el.classList.add('sr-only'));
      const iconWidths = buttons.map((el) => el.offsetWidth);

      labels.forEach((el) => el.classList.remove('sr-only'));
      wasSrOnly.forEach((el) => el.classList.add('sr-only'));
      wasHidden.forEach((el) => el.classList.add('hidden'));

      const available = wrap.clientWidth - STRIP_CHROME_PX;
      let next: TabLayout;
      if (sum(labelledWidths) <= available) {
        next = { iconOnly: false, visibleCount: buttons.length };
      } else if (sum(iconWidths) <= available) {
        next = { iconOnly: true, visibleCount: buttons.length };
      } else {
        const budget = available - OVERFLOW_TRIGGER_PX;
        let used = 0;
        let count = 0;
        for (const width of iconWidths) {
          if (used + width > budget) break;
          used += width;
          count += 1;
        }
        next = { iconOnly: true, visibleCount: Math.max(1, count) };
      }

      setLayout((prev) =>
        prev.iconOnly === next.iconOnly && prev.visibleCount === next.visibleCount ? prev : next
      );
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [shown, availableTabCount, comparablePlanCount]);

  // Close the overflow menu on an outside click or Escape, like the other
  // popovers in the chrome.
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(event.target as Node)) {
        setOverflowOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOverflowOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [overflowOpen]);

  const selectTab = useCallback(
    (id: ViewMode, disabled: boolean) => {
      if (disabled) return;
      setOverflowOpen(false);
      setViewMode(id);
    },
    [setViewMode]
  );

  if (!shown) return null;

  const overflowTabs = availableTabs.slice(layout.visibleCount);
  const activeIsHidden = overflowTabs.some((tab) => tab.id === viewMode);

  // `min-w-[11rem]` (rather than min-w-0) is deliberate: it overrides the flex
  // `min-width:auto` yet keeps a floor, so a tight bar truncates the SQL-ID
  // title and scrolls the plan tabs instead of starving the view tabs.
  return (
    <div ref={wrapRef} className="flex-1 min-w-[11rem] flex items-center">
      <div className="flex items-center max-w-full bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50">
        <div ref={listRef} className="flex min-w-0 overflow-x-auto scrollbar-none">
          {availableTabs.map((tab, index) => {
            const isDisabled = tab.id === 'compare' && !compareEnabled;
            const isActive = viewMode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-view-tab
                onClick={() => selectTab(tab.id, isDisabled)}
                disabled={isDisabled}
                title={isDisabled ? 'Load a second plan (+ Add Plan) to enable comparison' : tab.label}
                className={`
                  shrink-0 flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md motion-safe:transition-all
                  ${index >= layout.visibleCount ? 'hidden' : ''}
                  ${FOCUS_RING_INSET}
                  ${isActive
                    ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                    : isDisabled
                      ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed opacity-50'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
                `}
              >
                <ViewIcon mode={tab.id} />
                <span data-tab-label className={layout.iconOnly ? 'sr-only' : ''}>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {overflowTabs.length > 0 && (
          <div className="relative shrink-0" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setOverflowOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label="More views"
              title="More views"
              className={`
                h-6 w-8 flex items-center justify-center rounded-md text-xs font-semibold motion-safe:transition-colors
                ${FOCUS_RING_INSET}
                ${activeIsHidden
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
              `}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
              </svg>
            </button>
            {overflowOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-44 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50"
              >
                {overflowTabs.map((tab) => {
                  const isDisabled = tab.id === 'compare' && !compareEnabled;
                  const isActive = viewMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitem"
                      onClick={() => selectTab(tab.id, isDisabled)}
                      disabled={isDisabled}
                      title={isDisabled ? 'Load a second plan (+ Add Plan) to enable comparison' : tab.label}
                      className={`
                        w-full px-3 py-2 flex items-center gap-2 text-left text-sm motion-safe:transition-colors
                        ${FOCUS_RING_INSET}
                        ${isActive
                          ? 'font-semibold text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800'
                          : isDisabled
                            ? 'text-slate-400 dark:text-slate-600 cursor-not-allowed'
                            : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}
                      `}
                    >
                      <ViewIcon mode={tab.id} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Plan A / Plan B tabs wrapped for the top bar: they may shrink and scroll so
 * a long list of renamed plans never pushes the view tabs off the bar.
 */
export function PlanTabsCluster() {
  const { plans } = usePlan();
  // Mirrors PlanTabs' own bail-out so the bar doesn't carry an empty flex child
  // (and its gap) before a second plan exists.
  const parsedPlanCount = plans.filter((slot) => slot.parsedPlan).length;
  if (parsedPlanCount === 0 && plans.length <= 1) return null;

  return (
    <div className="min-w-0 shrink overflow-x-auto scrollbar-none">
      {/* Inner w-max wrapper keeps the tabs at their natural width inside the
          scroller instead of being squeezed by it. */}
      <div className="flex items-center gap-4 w-max">
        <PlanTabs />
      </div>
    </div>
  );
}

/** Fullscreen toggle for the visualization canvas (also bound to `f`). */
export function MaximizeButton() {
  const { plans, visualizationMaximized, setVisualizationMaximized } = usePlan();
  if (!plans.some((slot) => slot.parsedPlan)) return null;

  return (
    <button
      type="button"
      onClick={() => setVisualizationMaximized(!visualizationMaximized)}
      className={`shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 motion-safe:transition-colors ${FOCUS_RING}`}
      title={visualizationMaximized ? 'Exit fullscreen visualization (F)' : 'Maximize visualization (F)'}
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
  );
}

/**
 * The slim variant of the single top bar shown while the visualization is
 * maximized: navigation only — plan tabs, view tabs and the exit toggle.
 */
export function MaximizedTopBar() {
  return (
    <div className="shrink-0 h-11 flex items-center gap-3 px-3 bg-white dark:bg-slate-900 border-b border-slate-200/70 dark:border-slate-800/70 z-20">
      <PlanTabsCluster />
      <ViewTabStrip />
      <MaximizeButton />
    </div>
  );
}
