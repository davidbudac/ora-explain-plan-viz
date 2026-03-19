import { usePlan } from '../hooks/usePlanContext';

function formatPlanOptionLabel(label: string, sqlId?: string, planHashValue?: string): string {
  const parts = [label];

  if (planHashValue) {
    parts.push(`PHV ${planHashValue}`);
  }

  if (sqlId) {
    parts.push(`SQL ${sqlId}`);
  }

  return parts.join(' · ');
}

export function ComparePlanPicker() {
  const { plans, comparePlanIndices, setComparePlanIndices, swapComparePlans } = usePlan();

  const comparablePlans = plans
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => Boolean(slot.parsedPlan));

  if (comparablePlans.length < 2) {
    return null;
  }

  const [leftIndex, rightIndex] = comparePlanIndices;

  const updateLeftIndex = (nextLeftIndex: number) => {
    setComparePlanIndices(nextLeftIndex === rightIndex ? [nextLeftIndex, leftIndex] : [nextLeftIndex, rightIndex]);
  };

  const updateRightIndex = (nextRightIndex: number) => {
    setComparePlanIndices(nextRightIndex === leftIndex ? [rightIndex, nextRightIndex] : [leftIndex, nextRightIndex]);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-neutral-600 dark:text-neutral-400">Compare</span>
      <select
        value={leftIndex}
        onChange={(event) => updateLeftIndex(Number(event.target.value))}
        className="h-8 min-w-0 max-w-[220px] px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        aria-label="Left compare plan"
      >
        {comparablePlans.map(({ slot, index }) => (
          <option key={`left-${slot.id}`} value={index}>
            {formatPlanOptionLabel(slot.label, slot.parsedPlan?.sqlId, slot.parsedPlan?.planHashValue)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={swapComparePlans}
        className="h-8 w-8 flex items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
        title="Swap compared plans"
        aria-label="Swap compared plans"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h11m0 0l-3-3m3 3l-3 3M20 17H9m0 0l3-3m-3 3l3 3" />
        </svg>
      </button>
      <select
        value={rightIndex}
        onChange={(event) => updateRightIndex(Number(event.target.value))}
        className="h-8 min-w-0 max-w-[220px] px-2.5 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/60"
        aria-label="Right compare plan"
      >
        {comparablePlans.map(({ slot, index }) => (
          <option key={`right-${slot.id}`} value={index}>
            {formatPlanOptionLabel(slot.label, slot.parsedPlan?.sqlId, slot.parsedPlan?.planHashValue)}
          </option>
        ))}
      </select>
    </div>
  );
}
