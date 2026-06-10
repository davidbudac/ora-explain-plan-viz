import { useEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { getSourceDisplayName } from '../lib/parser';
import { formatNumberShort, formatTimeShort } from '../lib/format';
import { SAMPLE_PLANS_BY_CATEGORY, type SamplePlan } from '../examples';
import type { MetadataBundle } from '../lib/metadata/bundle';
import { classifyDroppedFile } from '../lib/metadata/dropClassify';
import { MetadataChip } from './MetadataChip';

export function InputPanel() {
  const { rawInput, setInput, parsePlan, loadAndParsePlan, loadMetadataBundle, attachMetadataBundleToSlot, clearPlan, error, parsedPlan, inputPanelCollapsed: isCollapsed, setInputPanelCollapsed: setIsCollapsed, hasMultiplePlans, plans, activePlanIndex, metadataBundle, metadataBundleWarning, detachMetadataBundle } = usePlan();
  const [showSampleMenu, setShowSampleMenu] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [bundleMessage, setBundleMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [pendingBundleChoice, setPendingBundleChoice] = useState<
    | { bundle: MetadataBundle; reason: string; candidateIndices: number[] }
    | null
  >(null);
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
  }, [error, parsedPlan, setIsCollapsed]);

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

  const handleDragOver = (e: React.DragEvent<HTMLTextAreaElement>) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setIsDraggingFile(true);
    }
  };

  const handleDragLeave = () => setIsDraggingFile(false);

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (!text) return;
      const classification = classifyDroppedFile(file.name, text);
      if (classification.kind === 'error') {
        setBundleMessage({ tone: 'error', text: classification.message });
        return;
      }
      if (classification.kind === 'bundle') {
        const result = loadMetadataBundle(text);
        if (result.ok === true) {
          const slot = plans[result.pairedSlotIndex];
          const label = slot?.customLabel || slot?.label || `slot ${result.pairedSlotIndex + 1}`;
          if (result.warning) {
            setBundleMessage({ tone: 'warn', text: `Bundle attached to ${label}, but ${result.warning}` });
          } else {
            setBundleMessage({ tone: 'ok', text: `Metadata bundle attached to ${label}.` });
          }
        } else if (result.ok === 'needs-choice') {
          setPendingBundleChoice({
            bundle: result.bundle,
            reason: result.reason,
            candidateIndices: result.candidateIndices,
          });
        } else {
          setBundleMessage({ tone: 'error', text: result.error });
        }
        return;
      }
      setBundleMessage(null);
      wasParsingRef.current = true;
      loadAndParsePlan(text);
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
      {/* Header - always visible */}
      <div className="flex items-center justify-between px-3 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60 transition-colors">
        <div className="flex items-center gap-2 min-w-0 flex-1">
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
                <span className="text-blue-600 dark:text-blue-400 mr-1.5">{plans[activePlanIndex].customLabel || plans[activePlanIndex].label}:</span>
              )}
              {parsedPlan && (parsedPlan.sqlId || parsedPlan.planHashValue)
                ? [
                    parsedPlan.sqlId && <span key="sql">SQL ID: <span className="font-mono">{parsedPlan.sqlId}</span></span>,
                    parsedPlan.sqlId && parsedPlan.planHashValue && <span key="sep" className="text-neutral-400 dark:text-neutral-500 mx-1">|</span>,
                    parsedPlan.planHashValue && <span key="hash">PHV: <span className="font-mono">{parsedPlan.planHashValue}</span></span>,
                  ]
                : 'Oracle Execution Plan Input'}
            </h2>
          </button>
          {parsedPlan && (
            <MetadataChip
              bundle={metadataBundle}
              warning={metadataBundleWarning}
              planSqlId={parsedPlan.sqlId}
              onDetach={() => detachMetadataBundle(activePlanIndex)}
            />
          )}
          {isCollapsed && parsedPlan && (
            <div className="hidden lg:flex items-center gap-1.5">
              <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                {getSourceDisplayName(parsedPlan.source)}
              </span>
              {parsedPlan.hasActualStats && (
                <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                  Actual Stats
                </span>
              )}
              {parsedPlan.bindVariables && parsedPlan.bindVariables.length > 0 && (
                <span className="px-2 py-0.5 border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded text-[11px] font-medium">
                  {parsedPlan.bindVariables.length} bind{parsedPlan.bindVariables.length !== 1 ? 's' : ''}
                </span>
              )}
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                ({parsedPlan.allNodes.length} operations{parsedPlan.rootNode?.cost != null ? `, Cost: ${formatNumberShort(parsedPlan.rootNode.cost)}` : ''}{parsedPlan.hasActualStats && parsedPlan.rootNode?.actualRows != null ? `, A-Rows: ${formatNumberShort(parsedPlan.rootNode.actualRows)}` : ''}{parsedPlan.hasActualStats && parsedPlan.rootNode?.actualTime != null ? `, A-Time: ${formatTimeShort(parsedPlan.rootNode.actualTime)}` : ''})
              </span>
            </div>
          )}
        </div>
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
                {SAMPLE_PLANS_BY_CATEGORY.json.length > 0 && (
                  <>
                    <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                      JSON (V$SQL_PLAN)
                    </div>
                    {SAMPLE_PLANS_BY_CATEGORY.json.map((sample) => (
                      <button
                        key={sample.name}
                        onClick={() => handleLoadSample(sample)}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        {sample.name}
                      </button>
                    ))}
                  </>
                )}
                {SAMPLE_PLANS_BY_CATEGORY.xbi.length > 0 && (
                  <>
                    <div className="border-t border-neutral-200 dark:border-neutral-700 my-1" />
                    <div className="px-3 py-1.5 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
                      XBI (Tanel Poder)
                    </div>
                    {SAMPLE_PLANS_BY_CATEGORY.xbi.map((sample) => (
                      <button
                        key={sample.name}
                        onClick={() => handleLoadSample(sample)}
                        className="w-full px-3 py-2 text-left text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        {sample.name}
                      </button>
                    ))}
                  </>
                )}
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
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && rawInput.trim()) {
                e.preventDefault();
                handleParse();
              }
            }}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            placeholder={"Paste an Oracle execution plan here, drop a plan file onto this box, or click Load Example -->\n\nSupported formats:\n  \u2022 DBMS_XPLAN output\n  \u2022 SQL Monitor text report\n  \u2022 SQL Monitor XML report\n  \u2022 V$SQL_PLAN JSON\n\nMultiple plans in one paste are supported and are split into separate tabs."}
            className={`w-full h-36 p-2.5 font-mono text-xs bg-neutral-50 dark:bg-neutral-950 border ${
              isDraggingFile
                ? 'border-blue-500 ring-2 ring-blue-500/60'
                : 'border-neutral-200 dark:border-neutral-700'
            } rounded-md resize-y focus:outline-none focus:ring-2 focus:ring-blue-500/60 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500`}
          />

          {error && (
            <div className="p-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-red-700 dark:text-red-400">
              {error}
            </div>
          )}

          {bundleMessage && (
            <div
              className={`p-2 text-xs rounded-md border ${
                bundleMessage.tone === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                  : bundleMessage.tone === 'warn'
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                    : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              }`}
            >
              {bundleMessage.text}
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleParse}
              disabled={!rawInput.trim()}
              className="h-8 px-3 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-semibold text-xs"
            >
              Parse <kbd className="ml-1 text-[10px] opacity-70 font-normal">{navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}{'\u23CE'}</kbd>
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
                  Cost: {parsedPlan.rootNode?.cost != null ? formatNumberShort(parsedPlan.rootNode.cost) : '—'}
                </span>
                {parsedPlan.planHashValue && (
                  <span>
                    PHV: {parsedPlan.planHashValue}
                  </span>
                )}
              </div>
            )}
          </div>

        </div>
      )}
      {pendingBundleChoice && (
        <BundleAttachChooser
          reason={pendingBundleChoice.reason}
          candidateIndices={pendingBundleChoice.candidateIndices}
          plans={plans}
          onCancel={() => {
            setPendingBundleChoice(null);
            setBundleMessage({ tone: 'error', text: 'Bundle attach cancelled.' });
          }}
          onChoose={(index) => {
            const result = attachMetadataBundleToSlot(pendingBundleChoice.bundle, index);
            setPendingBundleChoice(null);
            if (result.ok) {
              const slot = plans[index];
              const label = slot?.customLabel || slot?.label || `slot ${index + 1}`;
              if (result.warning) {
                setBundleMessage({ tone: 'warn', text: `Bundle attached to ${label}, but ${result.warning}` });
              } else {
                setBundleMessage({ tone: 'ok', text: `Metadata bundle attached to ${label}.` });
              }
            } else {
              setBundleMessage({ tone: 'error', text: result.error });
            }
          }}
        />
      )}
    </div>
  );
}

function BundleAttachChooser({
  reason,
  candidateIndices,
  plans,
  onCancel,
  onChoose,
}: {
  reason: string;
  candidateIndices: number[];
  plans: ReturnType<typeof usePlan>['plans'];
  onCancel: () => void;
  onChoose: (index: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl p-4">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Attach metadata bundle</h3>
        <p className="text-xs text-neutral-600 dark:text-neutral-400 mb-3">{reason}</p>
        <div className="flex flex-col gap-2 mb-4">
          {candidateIndices.map((idx) => {
            const slot = plans[idx];
            const label = slot.customLabel || slot.label;
            const sqlId = slot.parsedPlan?.sqlId;
            return (
              <button
                key={idx}
                onClick={() => onChoose(idx)}
                className="text-left p-2 border border-neutral-200 dark:border-neutral-700 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Attach to {label}</div>
                {sqlId && (
                  <div className="text-[11px] text-neutral-500 dark:text-neutral-400 font-mono">SQL_ID: {sqlId}</div>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end">
          <button
            onClick={onCancel}
            className="h-8 px-3 text-xs border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
