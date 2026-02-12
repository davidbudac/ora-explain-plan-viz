import { usePlan } from '../hooks/usePlanContext';
import { COLOR_SCHEMES } from '../lib/types';

export function Legend() {
  const { legendVisible: isVisible, setLegendVisible: setIsVisible, colorScheme } = usePlan();
  const categoryColors = COLOR_SCHEMES[colorScheme];

  return (
    <div className="absolute bottom-3 left-3 z-10">
      {isVisible ? (
        <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-md shadow-lg p-2.5 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">Operation Types</h4>
            <button
              onClick={() => setIsVisible(false)}
              className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
              title="Hide legend"
            >
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1">
            {Object.entries(categoryColors).map(([category, colors]) => (
              <div key={category} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded ${colors.bg} ${colors.border} border`} />
                <span className="text-[11px] text-slate-600 dark:text-slate-400 truncate">{category}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2 border-t border-slate-200 dark:border-slate-700">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300 mb-2">Cost Indicator</h4>
            <div className="flex items-center gap-1">
              <div className="flex-1 h-1.5 rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" />
            </div>
            <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsVisible(true)}
          className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm rounded-md shadow-lg p-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          title="Show legend"
        >
          <svg className="w-4 h-4 text-slate-600 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  );
}
