import { useMemo } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { COLOR_SCHEME_PALETTES, getOperationCategory } from '../lib/types';

/**
 * Floating legend for the visualization area: operation-category colors for
 * the active color scheme, warning-badge meanings, and edge-width semantics.
 * Visibility is persisted via the existing `legendVisible` setting.
 */
export function Legend() {
  const { legendVisible, setLegendVisible, colorScheme, parsedPlan, filters } = usePlan();

  const palette = COLOR_SCHEME_PALETTES[colorScheme];

  // Only list categories that actually appear in the current plan.
  const categories = useMemo(() => {
    if (!parsedPlan) return [];
    const present = new Set<string>();
    for (const node of parsedPlan.allNodes) {
      present.add(getOperationCategory(node.operation));
    }
    return Object.keys(palette).filter((category) => present.has(category));
  }, [parsedPlan, palette]);

  if (!parsedPlan) return null;

  return (
    <div className="absolute bottom-3 left-14 z-30 flex flex-col items-start gap-2 pointer-events-none">
      {legendVisible && (
        <div className="pointer-events-auto w-56 max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-xl p-3 text-[11px]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-bold text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-widest">Legend</h4>
            <button
              type="button"
              onClick={() => setLegendVisible(false)}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
              title="Hide legend"
              aria-label="Hide legend"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {categories.length > 0 && (
            <div className="mb-3">
              <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
                Operation categories
              </div>
              <div className="space-y-1">
                {categories.map((category) => (
                  <div key={category} className="flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0 border border-black/10 dark:border-white/10"
                      style={{ backgroundColor: palette[category] }}
                    />
                    <span className="text-slate-700 dark:text-slate-300">{category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-1.5">
              Badges
            </div>
            <div className="space-y-1.5 text-slate-700 dark:text-slate-300">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-3 h-3 rounded-full shrink-0 ring-2 ring-red-500 bg-transparent" />
                <span><span className="font-semibold">Hotspot</span> — slowest operation in the plan</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 px-1 rounded shrink-0 text-[8px] font-bold bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300">SPILL</span>
                <span><span className="font-semibold">Spill</span> — operation wrote to temp space</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 px-1 rounded shrink-0 text-[8px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">3x</span>
                <span><span className="font-semibold">Cardinality mismatch</span> — E-Rows vs A-Rows differ ≥3× (amber) / ≥10× (red)</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 px-1 rounded shrink-0 text-[8px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">STALE</span>
                <span><span className="font-semibold">Stats badges</span> — stale or missing optimizer statistics (needs a metadata bundle)</span>
              </div>
            </div>
          </div>

          {filters.scaleEdgeWidth && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 leading-snug">
              Edge thickness scales with the number of rows flowing between operations.
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setLegendVisible(!legendVisible)}
        aria-pressed={legendVisible}
        className={`pointer-events-auto h-7 px-2 flex items-center gap-1.5 rounded-md border text-[10px] font-semibold uppercase tracking-wider shadow-sm transition-colors ${
          legendVisible
            ? 'bg-blue-600 text-white border-blue-600'
            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
        }`}
        title={legendVisible ? 'Hide legend' : 'Show legend (color coding and badge meanings)'}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485" />
        </svg>
        Legend
      </button>
    </div>
  );
}
