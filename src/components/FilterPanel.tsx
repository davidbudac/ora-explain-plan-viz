import { useId, useMemo, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, OPERATION_CATEGORIES, getOperationCategory } from '../lib/types';
import type { PredicateType } from '../lib/types';
import { matchesSearch, hasActiveFilters } from '../lib/filtering';
import { nodeCardinalityRatio } from '../lib/format';
import {
  THRESHOLD_STEPS,
  formatThreshold,
  logHistogram,
  parseThreshold,
  positionToThreshold,
  thresholdToPosition,
  type ThresholdKind,
} from '../lib/filterThresholds';
import { FOCUS_RING, FOCUS_RING_INSET } from './ui';
import { PanelResizeHandle } from './PanelEdgeTab';

const HISTOGRAM_BUCKETS = 32;

// One label style for every section, matching the details panel's section labels.
const SECTION_LABEL = 'text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';
const HINT = 'text-[10.5px] font-normal normal-case tracking-normal text-slate-400 dark:text-slate-500';
const ROW_LABEL = 'text-[11.5px] text-slate-700 dark:text-slate-300';
// Two tiles per row at most, whatever the panel width.
const TILE_GRID = 'grid grid-cols-2 gap-1.5';
// Small ring thumb for the threshold sliders (grey at "any", blue once set).
const THUMB =
  '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white dark:[&::-webkit-slider-thumb]:bg-slate-900 [&::-webkit-slider-thumb]:border-2 ' +
  '[&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:h-2 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white dark:[&::-moz-range-thumb]:bg-slate-900 [&::-moz-range-thumb]:border-2';
const THUMB_IDLE = '[&::-webkit-slider-thumb]:border-slate-400 [&::-moz-range-thumb]:border-slate-400';
const THUMB_ACTIVE = '[&::-webkit-slider-thumb]:border-blue-600 [&::-moz-range-thumb]:border-blue-600';

/** Shorter, sentence-case names for the operation categories (the full name stays in the tooltip). */
const CATEGORY_LABELS: Record<string, string> = {
  'Table Access': 'Table access',
  'Index Operations': 'Index',
  'Join Operations': 'Join',
  'Set Operations': 'Set ops',
  'Sort Operations': 'Sort',
  'Filter/View': 'Filter / view',
  'Parallelism': 'Parallel',
};

const PREDICATE_OPTIONS: { type: PredicateType; label: string; ariaLabel: string; color: string }[] = [
  { type: 'access', label: 'Access', ariaLabel: 'Access predicates', color: '#0ea5e9' },
  { type: 'filter', label: 'Filter', ariaLabel: 'Filter predicates', color: '#a855f7' },
  { type: 'storage', label: 'Storage', ariaLabel: 'Storage predicates', color: '#14b8a6' },
  { type: 'none', label: 'None', ariaLabel: 'Without predicates', color: '#94a3b8' },
];

interface FilterPanelProps {
  panelWidth: number;
  // Method syntax so App's HTMLButtonElement-typed handler still fits the
  // separator element (method parameters are bivariant).
  onResizeStart(event: ReactPointerEvent<HTMLElement>): void;
  /** Keyboard resizing (←/→ on the splitter); the splitter is pointer-only without it. */
  onResizeBy?: (delta: number) => void;
  minWidth?: number;
  maxWidth?: number;
}

const FILTER_PANEL_ID = 'filter-panel';

export function FilterPanel({ panelWidth, onResizeStart, onResizeBy, minWidth, maxWidth }: FilterPanelProps) {
  const {
    parsedPlan, filters, filteredNodes,
    filterPanelCollapsed: isCollapsed, setFilterPanelCollapsed: setIsCollapsed,
  } = usePlan();

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan?.allNodes.length || 0;

  if (!parsedPlan) return null;

  if (isCollapsed) {
    const filtersActive = hasActiveFilters(filters) || filteredCount !== totalCount;
    return (
      <button
        type="button"
        onClick={() => setIsCollapsed(false)}
        className={`shrink-0 w-[26px] h-full flex flex-col items-center pt-2.5 gap-2.5 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors ${FOCUS_RING}`}
        title={filtersActive ? `Show filters (active: ${filteredCount} / ${totalCount} ops visible)` : 'Show filters'}
        aria-label="Show filters"
        aria-expanded={false}
      >
        <svg className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className="[writing-mode:vertical-rl] uppercase text-[10px] font-bold tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Filters
        </span>
        {filtersActive && (
          <span className="[writing-mode:vertical-rl] text-[10px] font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-400">
            {filteredCount}/{totalCount}
          </span>
        )}
      </button>
    );
  }

  return (
    <div
      id={FILTER_PANEL_ID}
      className="relative shrink-0 flex flex-col bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto"
      style={{ width: panelWidth }}
    >
      <PanelResizeHandle
        side="left"
        label="Resize filters panel"
        width={panelWidth}
        minWidth={minWidth}
        maxWidth={maxWidth}
        controls={FILTER_PANEL_ID}
        onPointerDown={onResizeStart}
        onResizeBy={onResizeBy}
      />
      <FilterPanelBody />
    </div>
  );
}

/** A titled, collapsible block of filter controls. */
function FilterSection({
  title,
  hint,
  activeCount = 0,
  children,
}: {
  title: string;
  hint?: string;
  activeCount?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const contentId = useId();

  return (
    <section className="border-t border-slate-200 dark:border-slate-800">
      <h4>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={contentId}
          onClick={() => setOpen((value) => !value)}
          className={`w-full flex items-center gap-1.5 px-3.5 pt-2.5 ${open ? 'pb-2' : 'pb-2.5'} text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${FOCUS_RING_INSET}`}
        >
          <span className={SECTION_LABEL}>{title}</span>
          {activeCount > 0 ? (
            <span className="text-[10.5px] font-medium text-blue-600 dark:text-blue-400">{activeCount} selected</span>
          ) : hint ? (
            <span className={HINT}>{hint}</span>
          ) : null}
          <svg
            className={`ml-auto w-3 h-3 text-slate-400 transition-transform ${open ? '' : 'rotate-180'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 15l6-6 6 6" />
          </svg>
        </button>
      </h4>
      <div id={contentId} hidden={!open} className="px-3.5 pb-3">
        {children}
      </div>
    </section>
  );
}

/**
 * One toggle tile: colour cap, big count, small label. Once anything in the
 * group is picked, the tiles that aren't fade back (`dimmed`).
 */
function CountTile({
  label,
  title,
  ariaLabel,
  count,
  pressed,
  dimmed,
  color,
  onToggle,
}: {
  label: string;
  title?: string;
  ariaLabel: string;
  count: number;
  pressed: boolean;
  dimmed: boolean;
  color?: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={`${ariaLabel} (${count})`}
      title={title}
      onClick={onToggle}
      style={{ borderTopColor: color || undefined }}
      className={`min-w-0 text-left rounded-md border border-t-[3px] px-1.5 pt-1 pb-[3px] transition-[background-color,border-color,opacity] ${FOCUS_RING} ${
        pressed
          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-300 dark:border-blue-500/50 ring-1 ring-blue-500'
          : `border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${dimmed ? 'opacity-45 hover:opacity-100' : ''}`
      }`}
    >
      <span
        className={`block text-[15px] leading-tight font-semibold font-mono tabular-nums ${pressed ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-slate-100'}`}
        aria-hidden="true"
      >
        {count}
      </span>
      <span className="block truncate text-[10px] text-slate-500 dark:text-slate-400" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

/**
 * Editable threshold value: shows the formatted value (or "any") and accepts
 * typed text such as `1.5M`, `20k`, `2s`, `10x` — committed on Enter or blur,
 * reverted on Escape.
 */
function ThresholdInput({
  id,
  label,
  kind,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  kind: ThresholdKind;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const active = value > 0;
  const formatted = active ? formatThreshold(value, kind) : '';
  // "≥" only while not editing, so the user types just the number.
  const shown = draft ?? (active ? `≥ ${formatted}` : '');

  const commit = () => {
    if (draft === null) return;
    const parsed = parseThreshold(draft, kind);
    if (parsed !== null) onCommit(parsed);
    setDraft(null);
  };

  const example = kind === 'time' ? 'e.g. 500ms, 2s, 1m' : kind === 'ratio' ? 'e.g. 10 or 10x' : 'e.g. 500, 20K, 1.5M';

  return (
    <span
      className={`flex items-center w-[76px] shrink-0 rounded border text-[11px] font-mono tabular-nums transition-colors focus-within:ring-2 focus-within:ring-blue-500/40 ${
        active
          ? 'border-blue-300 dark:border-blue-500/50 bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300'
          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
      }`}
    >
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={shown}
        placeholder="any"
        aria-label={`${label}, at least`}
        title={`Type a minimum (${example}); empty shows all`}
        onFocus={(event) => {
          setDraft(formatted);
          event.currentTarget.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(null);
            event.currentTarget.blur();
          }
        }}
        className="min-w-0 w-full bg-transparent px-1.5 py-0.5 text-right placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
      />
    </span>
  );
}

/** "At least" row: label + value box, log-scale histogram + slider below. */
function ThresholdRow({
  id,
  label,
  kind,
  value,
  max,
  values,
  onChange,
}: {
  id: string;
  label: string;
  kind: ThresholdKind;
  value: number;
  max: number;
  values: number[];
  onChange: (value: number) => void;
}) {
  const bars = useMemo(() => logHistogram(values, max, HISTOGRAM_BUCKETS), [values, max]);
  const position = thresholdToPosition(value, max);
  const sliderId = `${id}-slider`;

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <label htmlFor={id} className={ROW_LABEL}>{label}</label>
        <ThresholdInput id={id} label={label} kind={kind} value={value} onCommit={onChange} />
      </div>
      {bars.length > 0 && (
        <div className="flex items-end gap-px h-3.5" aria-hidden="true">
          {bars.map((ratio, i) => {
            const included = ((i + 1) / HISTOGRAM_BUCKETS) * THRESHOLD_STEPS > position;
            return (
              <span
                key={i}
                className={`flex-1 rounded-t-[1px] ${
                  ratio === 0
                    ? 'bg-transparent'
                    : included
                      ? 'bg-blue-300 dark:bg-blue-500/60'
                      : 'bg-slate-200 dark:bg-slate-700'
                }`}
                style={{ height: ratio > 0 ? `${Math.max(ratio * 100, 15)}%` : 0 }}
              />
            );
          })}
        </div>
      )}
      <input
        id={sliderId}
        type="range"
        min={0}
        max={THRESHOLD_STEPS}
        value={position}
        aria-label={`${label}, at least (log scale)`}
        aria-valuetext={value > 0 ? `at least ${formatThreshold(value, kind)}` : 'any'}
        onChange={(event) => onChange(positionToThreshold(Number(event.target.value), max))}
        className={`block w-full h-1 mt-0.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer ${THUMB} ${
          value > 0 ? THUMB_ACTIVE : THUMB_IDLE
        } ${FOCUS_RING}`}
      />
    </div>
  );
}

/**
 * The filter controls themselves, with no panel shell around them — shared by
 * the docked filter panel and focus mode's floating filter popover.
 */
export function FilterPanelBody() {
  const { parsedPlan, filters, setFilters, filteredNodes, selectNode, colorScheme } = usePlan();
  // null = no match navigated to yet (first "Next" selects the first match)
  const [activeMatchIndex, setActiveMatchIndex] = useState<number | null>(null);
  const idPrefix = useId();
  const ids = {
    search: `${idPrefix}-search`,
    cost: `${idPrefix}-cost`,
    actualRows: `${idPrefix}-arows`,
    actualTime: `${idPrefix}-atime`,
    mismatch: `${idPrefix}-mismatch`,
  };

  const palette = COLOR_SCHEME_PALETTES[colorScheme];

  const operationStats = useMemo(() => {
    const stats = new Map<string, number>();
    if (!parsedPlan) return stats;
    for (const node of parsedPlan.allNodes) {
      const category = getOperationCategory(node.operation);
      stats.set(category, (stats.get(category) || 0) + 1);
    }
    return stats;
  }, [parsedPlan]);

  const predicateStats = useMemo(() => {
    const stats: Record<PredicateType, number> = { access: 0, filter: 0, storage: 0, none: 0 };
    if (!parsedPlan) return stats;
    for (const node of parsedPlan.allNodes) {
      if (node.accessPredicates) stats.access++;
      if (node.filterPredicates) stats.filter++;
      if (node.storagePredicates) stats.storage++;
      if (!node.accessPredicates && !node.filterPredicates && !node.storagePredicates) stats.none++;
    }
    return stats;
  }, [parsedPlan]);

  // Per-metric values (for the histograms) and their maxima (the slider's right end).
  const metrics = useMemo(() => {
    const nodes = parsedPlan?.allNodes ?? [];
    const withStats = !!parsedPlan?.hasActualStats;
    const cost = nodes.map((n) => n.cost || 0);
    const actualRows = withStats ? nodes.map((n) => n.actualRows || 0) : [];
    const actualTime = withStats ? nodes.map((n) => n.actualTime || 0) : [];
    const mismatch: number[] = [];
    if (withStats) {
      for (const node of nodes) {
        const ratio = nodeCardinalityRatio(node);
        if (ratio !== undefined) mismatch.push(ratio >= 1 ? ratio : 1 / ratio);
      }
    }
    const maxOf = (values: number[]) => values.reduce((max, v) => (v > max ? v : max), 0);
    return {
      cost, actualRows, actualTime, mismatch,
      maxCost: maxOf(cost),
      maxActualRows: maxOf(actualRows),
      maxActualTime: maxOf(actualTime),
      // At least 10× so the slider has room on plans with good estimates.
      maxMismatch: Math.max(10, Math.ceil(maxOf(mismatch))),
    };
  }, [parsedPlan]);

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan?.allNodes.length || 0;
  const filtersActive = hasActiveFilters(filters) || filteredCount !== totalCount;

  const searchMatches = useMemo(() => {
    if (!parsedPlan) return [];
    const query = filters.searchText.trim();
    if (!query) return [];
    return parsedPlan.allNodes.filter((node) => matchesSearch(node, query)).map((node) => node.id);
  }, [parsedPlan, filters.searchText]);

  // Reset the active search match whenever the search text or plan changes.
  const [prevSearchText, setPrevSearchText] = useState(filters.searchText);
  const [prevParsedPlan, setPrevParsedPlan] = useState(parsedPlan);
  if (filters.searchText !== prevSearchText || parsedPlan !== prevParsedPlan) {
    setPrevSearchText(filters.searchText);
    setPrevParsedPlan(parsedPlan);
    setActiveMatchIndex(null);
  }

  const handleMatchNavigate = (direction: 'prev' | 'next') => {
    if (searchMatches.length === 0) return;
    let nextIndex: number;
    if (activeMatchIndex === null) {
      nextIndex = direction === 'next' ? 0 : searchMatches.length - 1;
    } else {
      const delta = direction === 'next' ? 1 : -1;
      nextIndex = (activeMatchIndex + delta + searchMatches.length) % searchMatches.length;
    }
    setActiveMatchIndex(nextIndex);
    selectNode(searchMatches[nextIndex]);
  };

  const handleCategoryToggle = (category: string) => {
    const operations = OPERATION_CATEGORIES[category] || [];
    const currentTypes = new Set(filters.operationTypes);
    // A category counts as on when any of its operations is; toggling clears or adds them all.
    if (operations.some((op) => currentTypes.has(op))) {
      operations.forEach((op) => currentTypes.delete(op));
    } else {
      operations.forEach((op) => currentTypes.add(op));
    }
    setFilters({ operationTypes: Array.from(currentTypes) });
  };

  const isCategoryActive = (category: string) => {
    const operations = OPERATION_CATEGORIES[category] || [];
    return operations.some((op) => filters.operationTypes.includes(op));
  };

  const handlePredicateTypeToggle = (predicateType: PredicateType) => {
    const currentTypes = new Set(filters.predicateTypes);
    if (currentTypes.has(predicateType)) {
      currentTypes.delete(predicateType);
    } else {
      currentTypes.add(predicateType);
    }
    setFilters({ predicateTypes: Array.from(currentTypes) });
  };

  const clearFilters = () => {
    setActiveMatchIndex(null);
    setFilters({
      operationTypes: [],
      minCost: 0,
      maxCost: Infinity,
      searchText: '',
      predicateTypes: [],
      minActualRows: 0,
      maxActualRows: Infinity,
      minActualTime: 0,
      maxActualTime: Infinity,
      minCardinalityMismatch: 0,
    });
  };

  if (!parsedPlan) return null;

  const categories = Object.keys(OPERATION_CATEGORIES).filter((category) => (operationStats.get(category) || 0) > 0);
  const activeCategoryCount = categories.filter(isCategoryActive).length;
  const predicateOptions = PREDICATE_OPTIONS.filter(({ type }) => predicateStats[type] > 0);
  // A group with a single value can't narrow anything — hide it unless it's already in use.
  const showCategories = categories.length > 1 || activeCategoryCount > 0;
  const showPredicates = predicateOptions.length > 1 || filters.predicateTypes.length > 0;

  const hasStats = !!parsedPlan.hasActualStats;
  const activeThresholdCount =
    (filters.minCost > 0 ? 1 : 0) +
    (hasStats && filters.minActualRows > 0 ? 1 : 0) +
    (hasStats && filters.minActualTime > 0 ? 1 : 0) +
    (hasStats && filters.minCardinalityMismatch > 0 ? 1 : 0);

  const hasQuery = filters.searchText.trim() !== '';

  return (
    <div className="flex flex-col min-h-full">
      {/* Title + reset (reset stays in place, greyed when there is nothing to reset) */}
      <div className="flex items-center justify-between px-3.5 pt-3 pb-2.5">
        <h3 className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Filters</h3>
        <button
          type="button"
          onClick={clearFilters}
          disabled={!filtersActive}
          className={`px-1.5 py-0.5 -mr-1.5 rounded text-[11px] font-medium transition-colors ${FOCUS_RING} ${
            filtersActive
              ? 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30'
              : 'text-slate-300 dark:text-slate-600 cursor-default'
          }`}
        >
          Reset
        </button>
      </div>

      {/* Search, with the match stepper inside the field */}
      <div className="px-3.5 pb-3">
        <div className="flex items-center gap-1.5 h-7 px-2 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/30 transition-colors">
          <svg className="w-3.5 h-3.5 shrink-0 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <label htmlFor={ids.search} className="sr-only">Search</label>
          <input
            id={ids.search}
            type="text"
            value={filters.searchText}
            onChange={(e) => setFilters({ searchText: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleMatchNavigate(e.shiftKey ? 'prev' : 'next');
              }
            }}
            placeholder="Search operations…"
            title="Matches operation, object and predicate text"
            className="flex-1 min-w-0 bg-transparent text-[11.5px] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none"
          />
          {hasQuery && (
            <>
              <span className="shrink-0 text-[10.5px] font-mono tabular-nums text-slate-500 dark:text-slate-400" role="status">
                <span className="sr-only">
                  {searchMatches.length === 0 ? 'No matches' : `${searchMatches.length} match${searchMatches.length !== 1 ? 'es' : ''}`}
                </span>
                <span aria-hidden="true">
                  {searchMatches.length === 0
                    ? '0'
                    : activeMatchIndex === null
                      ? searchMatches.length
                      : `${activeMatchIndex + 1}/${searchMatches.length}`}
                </span>
              </span>
              {searchMatches.length > 0 && (
                <span className="flex shrink-0 gap-0.5">
                  {(['prev', 'next'] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      onClick={() => handleMatchNavigate(direction)}
                      className={`grid place-items-center w-4 h-4 rounded text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 ${FOCUS_RING}`}
                      title={direction === 'prev' ? 'Previous match (Shift+Enter)' : 'Next match (Enter)'}
                      aria-label={direction === 'prev' ? 'Previous match' : 'Next match'}
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d={direction === 'prev' ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
                      </svg>
                    </button>
                  ))}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {showCategories && (
        <FilterSection title="Operation" hint="any of" activeCount={activeCategoryCount}>
          <div role="group" aria-label="Operation types" className={TILE_GRID}>
            {categories.map((category) => (
              <CountTile
                key={category}
                label={CATEGORY_LABELS[category] ?? category}
                title={category}
                ariaLabel={category}
                count={operationStats.get(category) || 0}
                pressed={isCategoryActive(category)}
                dimmed={activeCategoryCount > 0}
                color={palette[category]}
                onToggle={() => handleCategoryToggle(category)}
              />
            ))}
          </div>
        </FilterSection>
      )}

      {showPredicates && (
        <FilterSection title="Predicate" hint="any of" activeCount={filters.predicateTypes.length}>
          <div role="group" aria-label="Predicate types" className={TILE_GRID}>
            {predicateOptions.map(({ type, label, ariaLabel, color }) => (
              <CountTile
                key={type}
                label={label}
                ariaLabel={ariaLabel}
                count={predicateStats[type]}
                pressed={filters.predicateTypes.includes(type)}
                dimmed={filters.predicateTypes.length > 0}
                color={color}
                onToggle={() => handlePredicateTypeToggle(type)}
              />
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection title="At least" hint="log scale" activeCount={activeThresholdCount}>
        <div role="group" aria-label="Minimum thresholds" className="space-y-3">
          <ThresholdRow
            id={ids.cost}
            label="Cost"
            kind="count"
            value={filters.minCost}
            max={metrics.maxCost}
            values={metrics.cost}
            onChange={(minCost) => setFilters({ minCost })}
          />
          {hasStats && metrics.maxActualRows > 0 && (
            <ThresholdRow
              id={ids.actualRows}
              label="A-Rows"
              kind="count"
              value={filters.minActualRows === Infinity ? metrics.maxActualRows : filters.minActualRows}
              max={metrics.maxActualRows}
              values={metrics.actualRows}
              onChange={(minActualRows) => setFilters({ minActualRows })}
            />
          )}
          {hasStats && metrics.maxActualTime > 0 && (
            <ThresholdRow
              id={ids.actualTime}
              label="A-Time"
              kind="time"
              value={filters.minActualTime === Infinity ? metrics.maxActualTime : filters.minActualTime}
              max={metrics.maxActualTime}
              values={metrics.actualTime}
              onChange={(minActualTime) => setFilters({ minActualTime })}
            />
          )}
          {hasStats && (
            <ThresholdRow
              id={ids.mismatch}
              label="Estimate off by"
              kind="ratio"
              value={filters.minCardinalityMismatch}
              max={metrics.maxMismatch}
              values={metrics.mismatch}
              onChange={(minCardinalityMismatch) => setFilters({ minCardinalityMismatch })}
            />
          )}
        </div>
      </FilterSection>

      <div className="sticky bottom-0 mt-auto flex items-center justify-between px-3.5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="font-mono tabular-nums">
          {filteredCount === totalCount ? `${totalCount} ops` : `${filteredCount} of ${totalCount} ops`}
        </span>
      </div>
    </div>
  );
}
