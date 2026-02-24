import { usePlan } from '../hooks/usePlanContext';
import { COLOR_SCHEMES } from '../lib/types';

export function Legend() {
  const { legendVisible: isVisible, setLegendVisible: setIsVisible, colorScheme } = usePlan();
  const categoryColors = COLOR_SCHEMES[colorScheme];

  return (
    <div className="absolute bottom-3 left-3 z-10">
      {isVisible ? (
        <div className="bg-[var(--surface)]/95 dark:bg-[var(--surface-dark)]/95 backdrop-blur-sm rounded-lg shadow-lg p-2.5 border border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]">Operation Types</h4>
            <button
              onClick={() => setIsVisible(false)}
              className="p-0.5 hover:bg-[var(--border-color)] dark:hover:bg-[var(--border-color-dark)] rounded transition-colors"
              title="Hide legend"
            >
              <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1">
            {Object.entries(categoryColors).map(([category, colors]) => (
              <div key={category} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded ${colors.bg} ${colors.border} border`} />
                <span className="text-[11px] text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] truncate">{category}</span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 pt-2 border-t border-[var(--border-color)] dark:border-[var(--border-color-dark)]">
            <h4 className="text-[11px] font-semibold text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)] mb-2">Cost Indicator</h4>
            <div className="flex items-center gap-1">
              <div className="flex-1 h-1.5 rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" />
            </div>
            <div className="flex justify-between text-[11px] text-[var(--text-muted)] dark:text-[var(--text-muted-dark)] mt-1">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsVisible(true)}
          className="bg-[var(--surface)]/95 dark:bg-[var(--surface-dark)]/95 backdrop-blur-sm rounded-lg shadow-lg p-1.5 border border-[var(--border-color)] dark:border-[var(--border-color-dark)] hover:bg-[var(--surface-raised)] dark:hover:bg-[var(--surface-raised-dark)] transition-colors"
          title="Show legend"
        >
          <svg className="w-4 h-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary-dark)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  );
}
