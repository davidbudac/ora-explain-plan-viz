import type { ExperimentalSubView } from '../../../lib/types';
import { usePlan } from '../../../hooks/usePlanContext';
import { ScatterView } from './ScatterView';
import { TimelineView } from './TimelineView';
import { WaterfallView } from './WaterfallView';
import { MorphView } from './MorphView';
import { WaitsView } from './WaitsView';

const SUB_VIEWS: { id: ExperimentalSubView; label: string }[] = [
  { id: 'scatter', label: 'Scatter' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'morph', label: 'Morph' },
  { id: 'waits', label: 'Waits' },
];

function SubViewButton({
  id,
  label,
  current,
  onClick,
}: {
  id: ExperimentalSubView;
  label: string;
  current: ExperimentalSubView;
  onClick: (id: ExperimentalSubView) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`px-2 py-1 text-[10px] rounded transition-all font-semibold uppercase tracking-wider ${
        current === id
          ? 'bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30'
          : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
      }`}
    >
      {label}
    </button>
  );
}

function renderSubView(view: ExperimentalSubView) {
  switch (view) {
    case 'scatter': return <ScatterView />;
    case 'timeline': return <TimelineView />;
    case 'waterfall': return <WaterfallView />;
    case 'morph': return <MorphView />;
    case 'waits': return <WaitsView />;
  }
}

export function ExperimentalView() {
  const { experimentalSubView, setExperimentalSubView, parsedPlan } = usePlan();

  if (!parsedPlan) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-950 text-sm text-slate-500 dark:text-slate-400">
        No execution plan to display. Parse a plan to see the visualization.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/90">
        <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 ring-1 ring-violet-300/50 dark:ring-violet-700/50">
          Experimental
        </span>
        <div className="flex bg-slate-200/50 dark:bg-slate-800/80 rounded-lg p-1 border border-slate-300/40 dark:border-slate-700/50 gap-0.5">
          {SUB_VIEWS.map((sv) => (
            <SubViewButton
              key={sv.id}
              id={sv.id}
              label={sv.label}
              current={experimentalSubView}
              onClick={setExperimentalSubView}
            />
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        {renderSubView(experimentalSubView)}
      </div>
    </div>
  );
}
