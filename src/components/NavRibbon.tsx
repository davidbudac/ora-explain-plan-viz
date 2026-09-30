import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { PlanTabs } from './PlanTabs';
import type { ViewMode } from '../lib/types';
import { ViewIcon } from './viewIcons';
import { FOCUS_RING, FOCUS_RING_INSET, useMenuKeyboard } from './ui';
import { computeTopBarLayout, type TitleMode, type TopBarLayout } from '../lib/topBarLayout';
import { resetTopBarMode, setTopBarMode, TOP_BAR_LABEL_ATTR, useTopBarMode } from '../hooks/useTopBarMode';

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

// The strip's own padding + border, and the width the overflow "⋯" trigger
// takes inside it.
const STRIP_CHROME_PX = 12;
const OVERFLOW_TRIGGER_PX = 34;
// What a shrinkable sibling (the SQL-ID title) keeps at the very least when the
// bar is tight: its drawer chevron + padding, not its text. It only gets there
// after the ribbon has dropped its trailing labels (see `lib/topBarLayout.ts`).
const SHRINKABLE_RESERVE_PX = 24;
// Rounding slack so a measured fit never ends up a pixel short.
const SLACK_PX = 2;

/**
 * Attribute that marks the "SQL ID:" prefix inside the top-bar title. The title
 * renders it visually (full mode) or as `sr-only` (bare / truncated) so it
 * stays in the accessible name; the ribbon toggles it to measure both widths.
 */
const TITLE_PREFIX_ATTR = 'data-title-prefix';

// What the SQL-ID title shows, decided by the ribbon and read by the title
// (`InputPanel`). Kept beside the top-bar mode; only one top bar is mounted at
// a time, so a module-level value is enough.
let currentTitleMode: TitleMode = 'full';
const titleModeListeners = new Set<() => void>();

function setTitleMode(next: TitleMode): void {
  if (next === currentTitleMode) return;
  currentTitleMode = next;
  titleModeListeners.forEach((listener) => listener());
}

function subscribeTitleMode(listener: () => void) {
  titleModeListeners.add(listener);
  return () => {
    titleModeListeners.delete(listener);
  };
}

/** `full` shows "SQL ID: <id>", `bare` just the id, `truncated` the id cut short. */
function useTitleMode(): TitleMode {
  return useSyncExternalStore(subscribeTitleMode, () => currentTitleMode, () => 'full');
}

/**
 * The SQL ID as the top-bar title shows it. The "SQL ID:" prefix is visible
 * only while the bar has room for it (`full`); otherwise it turns `sr-only` —
 * out of layout, but still in the accessible name — and just the mono id
 * shows (see `lib/topBarLayout.ts`). The ribbon measures the title with the
 * prefix both ways, so this must stay inside the title's shrinkable sibling.
 */
export function SqlIdTitle({ sqlId }: { sqlId: string }) {
  const titleMode = useTitleMode();
  return (
    <span>
      <span {...{ [TITLE_PREFIX_ATTR]: '' }} className={titleMode === 'full' ? '' : 'sr-only'}>SQL ID:{' '}</span>
      <span className="font-mono">{sqlId}</span>
    </span>
  );
}

function resetTopBar(): void {
  resetTopBarMode();
  setTitleMode('full');
}

const COMPARE_DISABLED_TITLE = 'Load a second plan (+ Add Plan) to enable comparison';

const width = (el: Element) => Math.ceil(el.getBoundingClientRect().width);
const sumWidths = (els: Element[]) => els.reduce((total, el) => total + width(el), 0);

/** Temporarily applies `apply` to `els`, runs `read`, then restores each element's original classes. */
function withClasses<T>(els: HTMLElement[], apply: (el: HTMLElement) => void, read: () => T): T {
  const saved = els.map((el) => el.className);
  els.forEach(apply);
  const result = read();
  els.forEach((el, i) => {
    el.className = saved[i];
  });
  return result;
}

/** Natural (max-content) width of a flex item that would otherwise shrink. */
function naturalWidth(el: HTMLElement): number {
  const saved = el.style.flexShrink;
  el.style.flexShrink = '0';
  const result = width(el);
  el.style.flexShrink = saved;
  return result;
}

/**
 * Measures the whole top bar the ribbon sits in and decides how every cluster
 * compacts (see `lib/topBarLayout.ts` for the priority order). Each variant is
 * measured by briefly normalising classes in place, so a decision never rides
 * on a stale measurement of whatever state happens to be rendered.
 */
function measureTopBar(wrap: HTMLElement, list: HTMLElement): TopBarLayout | null {
  const bar = wrap.parentElement;
  if (!bar) return null;

  const buttons = [...list.querySelectorAll<HTMLElement>('[data-view-tab]')];
  if (buttons.length === 0) return null;
  const tabLabels = [...list.querySelectorAll<HTMLElement>('[data-tab-label]')];

  const showTabs = (el: HTMLElement) => el.classList.remove('hidden');
  const tabLabelled = withClasses([...buttons, ...tabLabels], (el) => {
    showTabs(el);
    el.classList.remove('sr-only');
  }, () => buttons.map(width));
  const tabIcon = withClasses([...buttons, ...tabLabels], (el) => {
    showTabs(el);
    if (el.hasAttribute('data-tab-label')) el.classList.add('sr-only');
  }, () => buttons.map(width));

  const barStyle = getComputedStyle(bar);
  const inner = bar.clientWidth - parseFloat(barStyle.paddingLeft || '0') - parseFloat(barStyle.paddingRight || '0');
  const gap = parseFloat(barStyle.columnGap || '0') || 0;
  const children = [...bar.children].filter(
    (el): el is HTMLElement => el instanceof HTMLElement && getComputedStyle(el).display !== 'none',
  );

  let planCluster: HTMLElement | null = null;
  const titles: HTMLElement[] = [];
  let titleMin = 0;
  const fixed: HTMLElement[] = [];
  for (const child of children) {
    if (child === wrap) continue;
    if (child.hasAttribute('data-plan-tabs-cluster')) {
      planCluster = child;
      continue;
    }
    if (parseFloat(getComputedStyle(child).flexShrink || '1') > 0) {
      titles.push(child);
      titleMin += SHRINKABLE_RESERVE_PX;
      continue;
    }
    fixed.push(child);
  }

  // The title at its natural width with and without its "SQL ID:" prefix.
  const titlePrefixes = titles.flatMap((el) => [...el.querySelectorAll<HTMLElement>(`[${TITLE_PREFIX_ATTR}]`)]);
  const titleWidth = () => titles.reduce((total, el) => total + naturalWidth(el), 0);
  const titleFull = withClasses(titlePrefixes, (el) => el.classList.remove('sr-only'), titleWidth);
  const titleBare = withClasses(titlePrefixes, (el) => el.classList.add('sr-only'), titleWidth);

  const barLabels = fixed.flatMap((el) => [...el.querySelectorAll<HTMLElement>(`[${TOP_BAR_LABEL_ATTR}]`)]);
  const fixedLabelled = withClasses(barLabels, (el) => el.classList.remove('sr-only'), () => sumWidths(fixed));
  const fixedCollapsed = withClasses(barLabels, (el) => el.classList.add('sr-only'), () => sumWidths(fixed));

  let planFull = 0;
  let planCompact = 0;
  const planInner = planCluster?.querySelector<HTMLElement>('[data-plan-tabs-inner]');
  if (planCluster && planInner) {
    const extras = [...planCluster.querySelectorAll<HTMLElement>('[data-plan-tab-extra]')];
    planFull = withClasses(extras, (el) => el.classList.remove('hidden'), () => width(planInner));
    planCompact = withClasses(extras, (el) => el.classList.add('hidden'), () => width(planInner));
  }

  return computeTopBarLayout({
    budget: inner - gap * Math.max(0, children.length - 1) - SLACK_PX,
    fixedLabelled,
    fixedCollapsed,
    planFull,
    planCompact,
    tabLabelled,
    tabIcon,
    stripChrome: STRIP_CHROME_PX,
    overflowTrigger: OVERFLOW_TRIGGER_PX,
    titleFull,
    titleBare,
    titleMin,
  });
}

/**
 * The view-tab cluster of the single top bar. It owns the bar's width
 * allocation: it measures its siblings (including the SQL-ID title's natural
 * width) and claims the width its chosen layout needs. The SQL ID is the last
 * thing to go: button labels collapse to icons, the plan tabs compact, the
 * ribbon sheds labels down to its first three, then the title drops its
 * "SQL ID:" prefix and only then truncates the bare id — followed by the
 * remaining labels, icons-only and the tail in an overflow menu (order spelled
 * out in `lib/topBarLayout.ts`).
 */
export function ViewTabStrip() {
  const { viewMode, setViewMode, parsedPlan, plans } = usePlan();

  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const [layout, setLayout] = useState<TopBarLayout | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const closeOverflow = useCallback((returnFocus = false) => {
    setOverflowOpen(false);
    if (returnFocus) overflowTriggerRef.current?.focus();
  }, []);
  const { menuProps, focusFirst } = useMenuKeyboard<HTMLDivElement>({ onClose: () => closeOverflow(true) });

  const comparablePlanCount = plans.filter((slot) => slot.parsedPlan).length;
  const compareEnabled = comparablePlanCount >= 2;
  const availableTabs = tabs.filter((tab) => {
    if (tab.id === 'sql') return Boolean(parsedPlan?.sqlText);
    if (tab.id === 'monitor') return parsedPlan?.source === 'sql_monitor_xml';
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

  const availableTabCount = availableTabs.length;
  useLayoutEffect(() => {
    if (!shown) return;
    const wrap = wrapRef.current;
    const list = listRef.current;
    const bar = wrap?.parentElement;
    if (!wrap || !list || !bar) return;

    const measure = () => {
      const next = measureTopBar(wrap, list);
      if (!next) return;
      setLayout((prev) =>
        prev &&
        prev.labelledCount === next.labelledCount &&
        prev.visibleCount === next.visibleCount &&
        prev.stripWidth === next.stripWidth &&
        prev.labelsCollapsed === next.labelsCollapsed &&
        prev.planCompact === next.planCompact &&
        prev.planSqueezed === next.planSqueezed &&
        prev.planWidth === next.planWidth &&
        prev.titleMode === next.titleMode
          ? prev
          : next
      );
      setTopBarMode({
        labelsCollapsed: next.labelsCollapsed,
        planCompact: next.planCompact,
        planSqueezed: next.planSqueezed,
        planWidth: next.planWidth,
      });
      setTitleMode(next.titleMode);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return resetTopBar;
    // The bar resizes with the window; siblings resize on their own when their
    // content changes (a renamed plan, the actions folding at a breakpoint).
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    for (const child of bar.children) {
      if (child !== wrap) observer.observe(child);
    }
    const planInner = bar.querySelector('[data-plan-tabs-inner]');
    if (planInner) observer.observe(planInner);
    // Children come and go (plan tabs appear with a second plan); re-wire. The
    // subtree/text watch catches a new SQL ID landing in a title that is
    // currently truncated — its box does not change, but its natural width does.
    const mutations = new MutationObserver(() => {
      for (const child of bar.children) {
        if (child !== wrap) observer.observe(child);
      }
      const inner = bar.querySelector('[data-plan-tabs-inner]');
      if (inner) observer.observe(inner);
      measure();
    });
    mutations.observe(bar, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      mutations.disconnect();
      resetTopBar();
    };
  }, [shown, availableTabCount, comparablePlanCount]);

  // Close the overflow menu on an outside click, like the other popovers.
  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (overflowRef.current && !overflowRef.current.contains(target)) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [overflowOpen]);

  useEffect(() => {
    if (overflowOpen) focusFirst();
  }, [overflowOpen, focusFirst]);

  const selectTab = useCallback(
    (id: ViewMode, disabled: boolean) => {
      if (disabled) return;
      setOverflowOpen(false);
      setViewMode(id);
    },
    [setViewMode]
  );

  if (!shown) return null;

  const visibleCount = layout?.visibleCount ?? availableTabs.length;
  const labelledCount = layout?.labelledCount ?? availableTabs.length;
  const visibleTabs = availableTabs.slice(0, visibleCount);
  const overflowTabs = availableTabs.slice(visibleCount);
  const activeIsHidden = overflowTabs.some((tab) => tab.id === viewMode);
  const isTabDisabled = (id: ViewMode) => id === 'compare' && !compareEnabled;

  // Roving tabindex: one tab stop for the whole strip (the active tab, else the
  // first enabled one); arrow keys move between the visible tabs.
  const rovingId =
    visibleTabs.find((tab) => tab.id === viewMode)?.id ??
    visibleTabs.find((tab) => !isTabDisabled(tab.id))?.id;

  const onTabListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const focusable = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[data-view-tab]') ?? [])].filter(
      (el) => !el.disabled && !el.classList.contains('hidden'),
    );
    if (focusable.length === 0) return;
    event.preventDefault();
    // Keep tree/graph arrow-key navigation from also reacting.
    event.stopPropagation();
    const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
    let next = 0;
    if (event.key === 'End') next = focusable.length - 1;
    else if (event.key === 'ArrowRight') next = current < 0 ? 0 : (current + 1) % focusable.length;
    else if (event.key === 'ArrowLeft') next = current < 0 ? focusable.length - 1 : (current - 1 + focusable.length) % focusable.length;
    focusable[next].focus();
  };

  return (
    <div
      ref={wrapRef}
      className={layout ? 'min-w-0 flex items-center' : 'flex-1 min-w-[11rem] flex items-center'}
      style={layout ? { flex: `1 0 ${layout.stripWidth}px` } : undefined}
    >
      <div className="flex items-center max-w-full bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50">
        <div
          ref={listRef}
          role="tablist"
          aria-label="Views"
          onKeyDown={onTabListKeyDown}
          className="flex min-w-0 overflow-x-auto scrollbar-none"
        >
          {availableTabs.map((tab, index) => {
            const isDisabled = isTabDisabled(tab.id);
            const isActive = viewMode === tab.id;
            const iconOnly = index >= labelledCount;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={tab.id === rovingId ? 0 : -1}
                data-view-tab
                onClick={() => selectTab(tab.id, isDisabled)}
                disabled={isDisabled}
                title={isDisabled ? COMPARE_DISABLED_TITLE : tab.label}
                className={`
                  shrink-0 flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md motion-safe:transition-all
                  ${index >= visibleCount ? 'hidden' : ''}
                  ${FOCUS_RING_INSET}
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

        {overflowTabs.length > 0 && (
          <div className="relative shrink-0" ref={overflowRef}>
            <button
              ref={overflowTriggerRef}
              type="button"
              onClick={() => setOverflowOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={activeIsHidden ? `More views (current: ${overflowTabs.find((tab) => tab.id === viewMode)?.label})` : 'More views'}
              title="More views"
              className={`
                h-6 w-8 flex items-center justify-center rounded-md text-xs font-semibold motion-safe:transition-colors
                ${FOCUS_RING_INSET}
                ${activeIsHidden
                  ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/30 dark:hover:bg-slate-700/50'}
              `}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01" />
              </svg>
            </button>
            {overflowOpen && (
              <div
                {...menuProps}
                aria-label="More views"
                onKeyDown={(event) => {
                  if (event.key === 'Tab') setOverflowOpen(false);
                  menuProps.onKeyDown(event);
                }}
                className="absolute right-0 top-full mt-1 w-44 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg z-50"
              >
                {overflowTabs.map((tab) => {
                  const isDisabled = isTabDisabled(tab.id);
                  const isActive = viewMode === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      tabIndex={-1}
                      onClick={() => selectTab(tab.id, isDisabled)}
                      disabled={isDisabled}
                      title={isDisabled ? COMPARE_DISABLED_TITLE : tab.label}
                      className={`
                        w-full px-3 py-2 flex items-center gap-2 text-left text-sm motion-safe:transition-colors
                        ${FOCUS_RING_INSET} focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800
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
 * Plan A / Plan B tabs wrapped for the top bar. They keep their natural width
 * (compacting their secondary text when the ribbon needs the room) and only
 * shrink and scroll as a last resort, so no tab is ever clipped mid-word.
 */
export function PlanTabsCluster() {
  const { plans } = usePlan();
  const { planCompact, planSqueezed, planWidth } = useTopBarMode();
  // Mirrors PlanTabs' own bail-out so the bar doesn't carry an empty flex child
  // (and its gap) before a second plan exists.
  const parsedPlanCount = plans.filter((slot) => slot.parsedPlan).length;
  if (parsedPlanCount === 0 && plans.length <= 1) return null;

  // Squeezed (last resort): an explicit width, so the SQL-ID title — not the
  // tabs — gives up the space, and a faded trailing edge instead of a hard cut
  // through a label.
  const squeezed = planSqueezed && planWidth !== null;
  return (
    <div
      data-plan-tabs-cluster
      className={squeezed
        ? 'shrink-0 min-w-0 overflow-x-auto scrollbar-none [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]'
        : 'shrink-0'}
      style={squeezed ? { width: planWidth } : undefined}
    >
      {/* Inner w-max wrapper keeps the tabs at their natural width inside the
          scroller instead of being squeezed by it (and is what gets measured). */}
      <div data-plan-tabs-inner className="flex items-center gap-4 w-max">
        <PlanTabs compact={planCompact} />
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
      aria-pressed={visualizationMaximized}
      className={`shrink-0 h-8 w-8 flex items-center justify-center rounded-md text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800 motion-safe:transition-colors ${FOCUS_RING}`}
      title={visualizationMaximized ? 'Exit fullscreen visualization (F)' : 'Maximize visualization (F)'}
      aria-label="Maximize visualization"
    >
      {visualizationMaximized ? (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 4H4v4m0 8v4h4m8-16h4v4m0 8v4h-4" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
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
