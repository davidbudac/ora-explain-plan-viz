import { usePlan } from '../hooks/usePlanContext';
import { ALL_COMPARE_METRICS, getMetricLabel } from '../lib/compare';
import type { CompareMetric } from '../lib/compare';
import { FOCUS_RING } from './ui';

export function CompareMetricSelector() {
  const { compareMetrics, setCompareMetrics, plans, comparePlanIndices } = usePlan();

  const selectedPlans = comparePlanIndices
    .map((index) => plans[index]?.parsedPlan)
    .filter((plan) => Boolean(plan));
  const bothHaveActualStats = selectedPlans.length === 2 && selectedPlans.every((plan) => plan?.hasActualStats);

  const availableMetrics = ALL_COMPARE_METRICS.filter(m => {
    if (['actualRows', 'actualTime', 'selfTime', 'starts'].includes(m)) return bothHaveActualStats;
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
      <span id="compare-metrics-label" className="text-xs text-slate-500 dark:text-slate-400 font-medium">Metrics:</span>
      <div className="flex flex-wrap gap-1" role="group" aria-labelledby="compare-metrics-label">
        {availableMetrics.map(metric => {
          const isActive = compareMetrics.includes(metric);
          // The last selected metric can't be switched off; say so instead of ignoring the click.
          const isLastSelected = isActive && compareMetrics.length <= 1;
          return (
            <button
              key={metric}
              type="button"
              aria-pressed={isActive}
              aria-disabled={isLastSelected || undefined}
              onClick={() => toggleMetric(metric)}
              title={isLastSelected ? 'At least one metric must stay selected' : undefined}
              className={`
                px-2 py-0.5 text-[11px] font-medium rounded-full transition-colors border ${FOCUS_RING}
                ${isLastSelected ? 'cursor-not-allowed opacity-70' : ''}
                ${isActive
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300 dark:border-blue-700'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
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
