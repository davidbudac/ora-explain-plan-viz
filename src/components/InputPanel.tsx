import { useEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getSourceDisplayName } from '../lib/parser';
import { formatNumberShort, formatTimeShort } from '../lib/format';
import { SAMPLE_PLANS_BY_CATEGORY, type SamplePlan } from '../examples';

export function InputPanel() {
  const { rawInput, setInput, parsePlan, loadAndParsePlan, clearPlan, error, parsedPlan, inputPanelCollapsed: isCollapsed, setInputPanelCollapsed: setIsCollapsed, canAddPlan, addPlanSlot, hasMultiplePlans, plans, activePlanIndex } = usePlan();
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
    wasParsingRef.current = true;
    loadAndParsePlan(sample.data);
    setShowSampleMenu(false);
  };

  const handleClear = () => {
    clearPlan();
  };

  return (
    <div className="flex flex-col bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      {/* Header - always visible */}
      <div className="flex items-center justify-between px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors">
        <button
          type="button"
          onClick={() => setIsCollapsed(!isCollapsed)}
          aria-expanded={!isCollapsed}
          aria-controls="input-panel-content"
          className="flex items-center gap-2 text-left min-w-0"
        >
          <svg
            className={`w-4 h-4 text-neutral-500 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {hasMultiplePlans && (
              <span className="text-blue-600 dark:text-blue-400 mr-1.5">{plans[activePlanIndex].label}:</span>
            )}
            {parsedPlan && (parsedPlan.sqlId || parsedPlan.planHashValue)
              ? [
                  parsedPlan.sqlId && <span key="sql">SQL ID: <span className="font-mono">{parsedPlan.sqlId}</span></span>,
                  parsedPlan.sqlId && parsedPlan.planHashValue && <span key="sep" className="text-neutral-400 dark:text-neutral-500 mx-1">|</span>,
                  parsedPlan.planHashValue && <span key="hash">PHV: <span className="font-mono">{parsedPlan.planHashValue}</span></span>,
                ]
              : 'Oracle Execution Plan Input'}
          </h2>
          {isCollapsed && parsedPlan && (
            <div className="hidden lg:flex items-center gap-1.5 ml-2">
              <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                {getSourceDisplayName(parsedPlan.source)}
              </span>
              {parsedPlan.hasActualStats && (
                <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                  Actual Stats
                </span>
              )}
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                ({parsedPlan.allNodes.length} operations, Cost: {parsedPlan.totalCost}{parsedPlan.hasActualStats && parsedPlan.rootNode?.actualRows != null ? `, A-Rows: ${formatNumberShort(parsedPlan.rootNode.actualRows)}` : ''}{parsedPlan.hasActualStats && parsedPlan.totalElapsedTime != null ? `, A-Time: ${formatTimeShort(parsedPlan.totalElapsedTime)}` : ''})
              </span>
            </div>
          )}
        </button>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowSampleMenu(!showSampleMenu)}
            className="h-8 px-3 text-xs border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors flex items-center gap-1 font-semibold"
          >
            Load Example
            <svg className={`w-4 h-4 transition-transform ${showSampleMenu ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showSampleMenu && (
            <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg z-50">
              <div className="py-1">
                <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                  DBMS_XPLAN
                </div>
                {SAMPLE_PLANS_BY_CATEGORY.dbms_xplan.map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => handleLoadSample(sample)}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  >
                    {sample.name}
                  </button>
                ))}
                <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                  SQL Monitor
                </div>
                {SAMPLE_PLANS_BY_CATEGORY.sql_monitor.map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => handleLoadSample(sample)}
                    className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
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
        <div id="input-panel-content" className="flex flex-col gap-2 px-3 pb-3">
          <textarea
            value={rawInput}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste your DBMS_XPLAN output or SQL Monitor report here..."
            className="w-full h-36 p-2.5 font-mono text-xs bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-700 rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/60 text-neutral-900 dark:text-neutral-100 placeholder-neutral-500 dark:placeholder-neutral-400"
          />

          {error && (
            <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleParse}
              disabled={!rawInput.trim()}
              className="h-8 px-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-xs"
            >
              Parse
            </button>
            {parsedPlan && (
              <button
                onClick={handleClear}
                className="h-8 px-3 border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors font-semibold text-xs"
              >
                Clear
              </button>
            )}
            {parsedPlan && (
              <div className="hidden xl:flex items-center ml-auto text-xs text-neutral-600 dark:text-neutral-400 gap-2">
                <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                  {getSourceDisplayName(parsedPlan.source)}
                </span>
                {parsedPlan.hasActualStats && (
                  <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
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
                    PHV: {parsedPlan.planHashValue}
                  </span>
                )}
              </div>
            )}
          </div>

          {parsedPlan && canAddPlan && (
            <button
              onClick={addPlanSlot}
              className="h-8 px-3 border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50 dark:bg-neutral-800/50 text-neutral-600 dark:text-neutral-400 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors font-medium text-xs flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add Plan for Comparison
            </button>
          )}
        </div>
      )}
    </div>
  );
}
