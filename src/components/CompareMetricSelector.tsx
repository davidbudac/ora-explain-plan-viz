import { usePlan } from '../hooks/usePlanContext';
import { ALL_COMPARE_METRICS, getMetricLabel } from '../lib/compare';
import type { CompareMetric } from '../lib/compare';

export function CompareMetricSelector() {
  const { compareMetrics, setCompareMetrics, plans } = usePlan();

  const bothHaveActualStats = plans.every(p => p.parsedPlan?.hasActualStats);

  const availableMetrics = ALL_COMPARE_METRICS.filter(m => {
    if (['actualRows', 'actualTime', 'starts'].includes(m)) return bothHaveActualStats;
    return true;
  });

  const toggleMetric = (metric: CompareMetric) => {
    if (compareMetrics.includes(metric)) {
      if (compareMetrics.length <= 1) return; // Keep at least one
      setCompareMetrics(compareMetrics.filter(m => m !== metric));
    } else {
      setCompareMetrics([...compareMetrics, metric]);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Metrics:</span>
      <div className="flex flex-wrap gap-1">
        {availableMetrics.map(metric => {
          const isActive = compareMetrics.includes(metric);
          return (
            <button
              key={metric}
              onClick={() => toggleMetric(metric)}
              className={`
                px-2 py-0.5 text-[11px] font-medium rounded-full transition-colors border
                ${isActive
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                  : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                }
              `}
            >
              {getMetricLabel(metric)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
