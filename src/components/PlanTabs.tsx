import { usePlan } from '../hooks/usePlanContext';

export function PlanTabs() {
  const { plans, activePlanIndex, setActivePlan, removePlanSlot, hasMultiplePlans, viewMode, setViewMode } = usePlan();

  if (!hasMultiplePlans) return null;

  const bothParsed = plans.every(p => p.parsedPlan);

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
      {plans.map((slot, index) => {
        const isActive = index === activePlanIndex && viewMode !== 'compare';
        const phv = slot.parsedPlan?.planHashValue;
        return (
          <div
            key={slot.id}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border cursor-pointer
              ${isActive
                ? 'bg-blue-600 text-white border-blue-600'
                : 'text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }
            `}
          >
            <button
              onClick={() => {
                setActivePlan(index);
                if (viewMode === 'compare') setViewMode('hierarchical');
              }}
              className="flex items-center gap-1.5"
            >
              <span>{slot.label}</span>
              {phv && (
                <span className={`font-mono text-[10px] ${isActive ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'}`}>
                  PHV: {phv}
                </span>
              )}
              {!slot.parsedPlan && (
                <span className={`text-[10px] italic ${isActive ? 'text-blue-200' : 'text-slate-400 dark:text-slate-500'}`}>
                  (empty)
                </span>
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removePlanSlot(index);
              }}
              className={`
                ml-1 p-0.5 rounded transition-colors
                ${isActive
                  ? 'hover:bg-blue-500 text-blue-200'
                  : 'hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 dark:text-slate-500'
                }
              `}
              title={`Remove ${slot.label}`}
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}

      {bothParsed && (
        <>
          <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 mx-1" />
          <button
            onClick={() => setViewMode('compare')}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors border
              ${viewMode === 'compare'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
              }
            `}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Compare
          </button>
        </>
      )}
    </div>
  );
}
