import { useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { SAMPLE_PLAN, COMPLEX_SAMPLE_PLAN } from '../lib/parser';

export function InputPanel() {
  const { rawInput, setInput, parsePlan, clearPlan, error, parsedPlan } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const handleParse = () => {
    parsePlan();
  };

  const handleLoadSample = () => {
    setInput(SAMPLE_PLAN);
  };

  const handleLoadComplexSample = () => {
    setInput(COMPLEX_SAMPLE_PLAN);
  };

  const handleClear = () => {
    clearPlan();
  };

  return (
    <div className="flex flex-col bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      {/* Header - always visible */}
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Oracle Execution Plan Input
          </h2>
          {isCollapsed && parsedPlan && (
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
              ({parsedPlan.allNodes.length} operations, Cost: {parsedPlan.totalCost})
            </span>
          )}
        </div>
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={handleLoadSample}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Load Simple Example
          </button>
          <button
            onClick={handleLoadComplexSample}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            Load Complex Example
          </button>
        </div>
      </div>

      {/* Collapsible content */}
      {!isCollapsed && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <textarea
            value={rawInput}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your DBMS_XPLAN output here..."
            className="w-full h-48 p-3 font-mono text-sm bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
          />

          {error && (
            <div className="p-3 text-sm bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleParse}
              disabled={!rawInput.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
            >
              Parse & Visualize
            </button>
            {parsedPlan && (
              <button
                onClick={handleClear}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
              >
                Clear
              </button>
            )}
            {parsedPlan && (
              <div className="flex items-center ml-auto text-sm text-gray-600 dark:text-gray-400">
                <span className="mr-4">
                  {parsedPlan.allNodes.length} operations
                </span>
                <span className="mr-4">
                  Total Cost: {parsedPlan.totalCost}
                </span>
                {parsedPlan.planHashValue && (
                  <span>
                    Plan Hash: {parsedPlan.planHashValue}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
