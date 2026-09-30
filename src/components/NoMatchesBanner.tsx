import { usePlan } from '../hooks/usePlanContext';
import { neutralFilterPatch } from '../lib/filtering';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 dark:focus-visible:ring-blue-400/60';

interface NoMatchesBannerProps {
  /**
   * Whether the message is shown. The `role="status"` live region itself stays
   * mounted either way, so screen readers announce the message when it appears.
   */
  visible: boolean;
  /** Distance from the top of the view area in px (clears view toolbars / the focus-mode pill). */
  top?: number;
}

/**
 * Floating top-centre notice for the "active filters match nothing" state,
 * with a reset that clears only the filter fields (search, operation and
 * predicate types, cost / A-Rows / A-Time ranges, cardinality threshold) —
 * never display settings such as density, predicates or edge animation.
 */
export function NoMatchesBanner({ visible, top = 12 }: NoMatchesBannerProps) {
  const { setFilters } = usePlan();

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4"
      style={{ top }}
    >
      {visible && (
        <div className="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-white/95 dark:bg-slate-900/95 backdrop-blur px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 shadow-lg">
          <svg
            className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18l-7 8.5V19l-4 2v-8.5L3 4z" />
          </svg>
          <span className="font-medium">No operations match the current filters</span>
          <button
            type="button"
            onClick={() => setFilters(neutralFilterPatch())}
            className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors ${FOCUS_RING}`}
          >
            Reset filters
          </button>
        </div>
      )}
    </div>
  );
}
