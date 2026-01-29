import { useState, useEffect, useRef } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import {
  SAMPLE_PLAN,
  COMPLEX_SAMPLE_PLAN,
  SAMPLE_SQL_MONITOR_PLAN,
  COMPLEX_SQL_MONITOR_PLAN,
  SAMPLE_SQL_MONITOR_XML,
  getSourceDisplayName,
} from '../lib/parser';

interface SamplePlan {
  name: string;
  data: string;
  category: 'dbms_xplan' | 'sql_monitor';
}

const SAMPLE_PLANS: SamplePlan[] = [
  { name: 'Simple Plan', data: SAMPLE_PLAN, category: 'dbms_xplan' },
  { name: 'Complex Plan', data: COMPLEX_SAMPLE_PLAN, category: 'dbms_xplan' },
  { name: 'SQL Monitor', data: SAMPLE_SQL_MONITOR_PLAN, category: 'sql_monitor' },
  { name: 'SQL Monitor (Parallel)', data: COMPLEX_SQL_MONITOR_PLAN, category: 'sql_monitor' },
  { name: 'SQL Monitor (XML)', data: SAMPLE_SQL_MONITOR_XML, category: 'sql_monitor' },
];

export function InputPanel() {
  const { rawInput, setInput, parsePlan, clearPlan, error, parsedPlan } = usePlan();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const wasParsingRef = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleParse = () => {
    wasParsingRef.current = true;
    parsePlan();
  };

  // Collapse panel when parsing succeeds
  useEffect(() => {
    if (wasParsingRef.current && parsedPlan && !error) {
      setIsCollapsed(true);
      wasParsingRef.current = false;
    }
  }, [parsedPlan, error]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowSampleMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLoadSample = (sample: SamplePlan) => {
    setInput(sample.data);
    setShowSampleMenu(false);
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
            <div className="flex items-center gap-2 ml-2">
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                {getSourceDisplayName(parsedPlan.source)}
              </span>
              {parsedPlan.hasActualStats && (
                <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                  Actual Stats
                </span>
              )}
              <span className="text-sm text-gray-500 dark:text-gray-400">
                ({parsedPlan.allNodes.length} operations, Cost: {parsedPlan.totalCost})
              </span>
            </div>
          )}
        </div>
        <div className="relative" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowSampleMenu(!showSampleMenu)}
            className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors flex items-center gap-1"
          >
            Load Example
            <svg className={`w-4 h-4 transition-transform ${showSampleMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showSampleMenu && (
            <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50">
              <div className="py-1">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  DBMS_XPLAN
                </div>
                {SAMPLE_PLANS.filter(s => s.category === 'dbms_xplan').map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => handleLoadSample(sample)}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {sample.name}
                  </button>
                ))}
                <div className="border-t border-gray-200 dark:border-gray-700 my-1" />
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  SQL Monitor
                </div>
                {SAMPLE_PLANS.filter(s => s.category === 'sql_monitor').map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => handleLoadSample(sample)}
                    className="w-full px-3 py-2 text-left text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    {sample.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Collapsible content */}
      {!isCollapsed && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <textarea
            value={rawInput}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your DBMS_XPLAN output or SQL Monitor report here..."
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
              <div className="flex items-center ml-auto text-sm text-gray-600 dark:text-gray-400 gap-4">
                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs font-medium">
                  {getSourceDisplayName(parsedPlan.source)}
                </span>
                {parsedPlan.hasActualStats && (
                  <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                    Actual Stats
                  </span>
                )}
                <span>
                  {parsedPlan.allNodes.length} operations
                </span>
                <span>
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
