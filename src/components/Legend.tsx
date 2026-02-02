import { usePlan } from '../hooks/usePlanContext';
import { CATEGORY_COLORS } from '../lib/types';

export function Legend() {
  const { legendVisible: isVisible, setLegendVisible: setIsVisible } = usePlan();

  return (
    <div className="absolute bottom-4 left-4 z-10">
      {isVisible ? (
        <div className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg p-3 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300">Operation Types</h4>
            <button
              onClick={() => setIsVisible(false)}
              className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
              title="Hide legend"
            >
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-1">
            {Object.entries(CATEGORY_COLORS).map(([category, colors]) => (
              <div key={category} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded ${colors.bg} ${colors.border} border`} />
                <span className="text-xs text-gray-600 dark:text-gray-400 truncate">{category}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
            <h4 className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Cost Indicator</h4>
            <div className="flex items-center gap-1">
              <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500" />
            </div>
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
              <span>Low</span>
              <span>High</span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setIsVisible(true)}
          className="bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm rounded-lg shadow-lg p-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          title="Show legend"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      )}
    </div>
  );
}
