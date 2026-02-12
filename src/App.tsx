import { PlanProvider, usePlan } from './hooks/usePlanContext';
import { Header } from './components/Header';
import { InputPanel } from './components/InputPanel';
import { FilterPanel } from './components/FilterPanel';
import { VisualizationTabs } from './components/VisualizationTabs';
import { NodeDetailPanel } from './components/NodeDetailPanel';
import { Legend } from './components/Legend';

function AppContent() {
  const { parsedPlan } = usePlan();

  return (
    <div className="flex flex-col h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <Header />
      <InputPanel />

      {parsedPlan && (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <FilterPanel />
          <div className="flex-1 flex flex-col relative min-w-0 bg-slate-50 dark:bg-slate-900 border-r border-l border-slate-200 dark:border-slate-800">
            <VisualizationTabs />
            <Legend />
          </div>
          <NodeDetailPanel />
        </div>
      )}

      {!parsedPlan && (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 p-8">
          <svg
            className="w-16 h-16 mb-4 text-slate-300 dark:text-slate-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-2">
            No Execution Plan Loaded
          </h2>
          <p className="text-center max-w-md mb-4">
            Paste your Oracle DBMS_XPLAN output in the text area above, or load one of the sample plans to get started.
          </p>
          <div className="text-sm text-slate-400 dark:text-slate-500">
            Supports standard DBMS_XPLAN.DISPLAY output format
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <PlanProvider>
      <AppContent />
    </PlanProvider>
  );
}

export default App;
