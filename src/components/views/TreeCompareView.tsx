import { usePlan } from '../../hooks/usePlanContext';
import { HierarchicalView } from './HierarchicalView';

function CompareTreePane({
  index,
  accentClassName,
}: {
  index: number;
  accentClassName: string;
}) {
  const {
    plans,
    activePlanIndex,
  } = usePlan();

  const slot = plans[index];
  const parsedPlan = slot?.parsedPlan;

  if (!slot || !parsedPlan) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white/70 dark:bg-neutral-900/60 text-sm text-neutral-500 dark:text-neutral-400">
        Plan not available.
      </div>
    );
  }

  const isActive = activePlanIndex === index;

  return (
    <div className={`flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-white dark:bg-neutral-950 ${isActive ? accentClassName : 'border-neutral-200 dark:border-neutral-800'}`}>
      <div className="flex items-center justify-between gap-3 border-b border-neutral-200 dark:border-neutral-800 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-500 dark:text-neutral-400">
            {slot.customLabel || slot.label}
          </div>
          <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {parsedPlan.planHashValue ? `PHV ${parsedPlan.planHashValue}` : 'No plan hash value'}
          </div>
        </div>
        {parsedPlan.sqlId && (
          <div className="rounded-full border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 text-[11px] font-mono text-neutral-500 dark:text-neutral-400">
            SQL {parsedPlan.sqlId}
          </div>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <HierarchicalView
          planIndex={index}
          registerExport={false}
          showAnnotations={true}
        />
      </div>
    </div>
  );
}

export function TreeCompareView() {
  const { plans, comparePlanIndices } = usePlan();
  const [leftIndex, rightIndex] = comparePlanIndices;

  const comparablePlanCount = plans.filter((slot) => slot.parsedPlan).length;
  if (comparablePlanCount < 2) {
    return (
      <div className="flex-1 flex items-center justify-center text-neutral-500 dark:text-neutral-400 p-8">
        <p>Load at least two plans to compare them side by side.</p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 bg-neutral-100 dark:bg-neutral-950 p-3">
      <div className="grid h-full min-h-0 grid-cols-1 gap-3 xl:grid-cols-2">
        <CompareTreePane index={leftIndex} accentClassName="border-blue-300 dark:border-blue-700" />
        <CompareTreePane index={rightIndex} accentClassName="border-violet-300 dark:border-violet-700" />
      </div>
    </div>
  );
}
