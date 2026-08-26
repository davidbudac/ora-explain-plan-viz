import { useEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { FilterPanelBody } from './FilterPanel';
import { NodeDetailBody } from './NodeDetailPanel';
import { FindingsList } from './FindingsPanel';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

// One glass recipe for every floating instrument, so the pill, its dropdowns
// and the inspector card read as the same material.
const GLASS =
  'bg-white/85 dark:bg-slate-900/85 backdrop-blur border border-slate-200/70 dark:border-slate-700/60 shadow-lg';

// Quiet slate chip — the pill has no room for a saturated accent, and blue
// stays reserved for the active view tab and the Parse button.
const CHIP_BASE =
  `h-7 px-2.5 flex items-center gap-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap motion-safe:transition-colors ${FOCUS_RING}`;
const CHIP_IDLE =
  'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800';
const CHIP_ACTIVE =
  'bg-slate-200/80 dark:bg-slate-700/70 text-slate-900 dark:text-slate-100';

type PillPanel = 'filters' | 'findings';

/**
 * Floating instruments for focus mode: a top-center command pill (search,
 * filters, findings) plus a top-right inspector card for the current selection.
 * Both hover over the canvas so the plan itself gets the full width.
 */
export function FocusOverlay() {
  const {
    filters, setFilters, filteredNodes, parsedPlan, advisorReport, selectedNodes,
  } = usePlan();
  const [openPanel, setOpenPanel] = useState<PillPanel | null>(null);
  const pillRef = useRef<HTMLDivElement>(null);

  // Close the open dropdown on an outside click or Escape.
  useEffect(() => {
    if (!openPanel) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || !pillRef.current || pillRef.current.contains(target)) return;
      // The filter body's "Customize view" menu portals out of the dropdown —
      // clicking inside it must not read as clicking away from the pill.
      if (target.closest('[role="dialog"]')) return;
      setOpenPanel(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openPanel]);

  if (!parsedPlan) return null;

  const filteredCount = filteredNodes.length;
  const totalCount = parsedPlan.allNodes.length;
  const findingsCount = advisorReport?.findings.length ?? 0;
  const hasSelection = selectedNodes.length > 0;

  const togglePanel = (panel: PillPanel) =>
    setOpenPanel((current) => (current === panel ? null : panel));

  return (
    <>
      <div
        ref={pillRef}
        className="absolute top-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center max-w-[calc(100%-1.5rem)]"
      >
        <div className={`flex items-center gap-1.5 h-10 pl-3 pr-1.5 rounded-full ${GLASS}`}>
          <svg
            className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={filters.searchText}
            onChange={(e) => setFilters({ searchText: e.target.value })}
            placeholder="Search plan…"
            aria-label="Search plan"
            className="w-[150px] sm:w-[200px] bg-transparent border-0 p-0 text-[11px] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-0"
          />
          {filters.searchText && (
            <button
              type="button"
              onClick={() => setFilters({ searchText: '' })}
              aria-label="Clear search"
              title="Clear search"
              className={`h-6 w-6 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 motion-safe:transition-colors ${FOCUS_RING}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <span className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-0.5" aria-hidden="true" />

          <button
            type="button"
            onClick={() => togglePanel('filters')}
            aria-expanded={openPanel === 'filters'}
            title="Filters"
            className={`${CHIP_BASE} ${openPanel === 'filters' ? CHIP_ACTIVE : CHIP_IDLE}`}
          >
            <span>Filters</span>
            <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
              {filteredCount}/{totalCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => togglePanel('findings')}
            aria-expanded={openPanel === 'findings'}
            disabled={findingsCount === 0}
            title={findingsCount === 0 ? 'No advisor findings' : 'Advisor findings'}
            className={`${CHIP_BASE} ${
              openPanel === 'findings'
                ? CHIP_ACTIVE
                : findingsCount > 0
                  ? 'text-red-700 dark:text-red-300 bg-red-500/10 hover:bg-red-500/20'
                  : `${CHIP_IDLE} opacity-50 cursor-not-allowed`
            }`}
          >
            <span>Findings</span>
            <span className="font-mono tabular-nums">{findingsCount}</span>
          </button>
        </div>

        {openPanel && (
          <div
            className={`mt-1.5 w-[300px] max-w-full max-h-[60vh] overflow-y-auto rounded-xl ${GLASS}`}
          >
            {openPanel === 'filters' ? (
              <FilterPanelBody />
            ) : (
              <div className="p-2.5">
                <FindingsList />
              </div>
            )}
          </div>
        )}
      </div>

      {hasSelection && (
        <div
          className={`absolute top-3 right-3 z-40 w-[320px] max-w-[calc(100%-1.5rem)] max-h-[70vh] overflow-y-auto rounded-xl ${GLASS}`}
        >
          <NodeDetailBody />
        </div>
      )}
    </>
  );
}
