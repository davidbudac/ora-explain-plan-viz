import { useEffect, useMemo, useRef, useState } from 'react';
import { buildBaselineScript, baselineScriptFilename } from '../lib/baselineScript';
import type { BaselineSource, BaselineScriptOptions } from '../lib/baselineScript';

interface BaselineScriptModalProps {
  initialSqlId?: string;
  initialPlanHash?: string;
  onClose: () => void;
}

const SQL_ID_RE = /^[a-z0-9]{1,13}$/i;
const PLAN_HASH_RE = /^\d+$/;

const SOURCE_OPTIONS: { value: BaselineSource; label: string; description: string }[] = [
  {
    value: 'cursor_cache',
    label: 'Cursor cache',
    description: 'Plan still running/recent — loads straight from V$SQL.',
  },
  {
    value: 'awr',
    label: 'AWR (19c+)',
    description: 'Plan aged out — loads from AWR snapshots via DBMS_SPM.LOAD_PLANS_FROM_AWR.',
  },
  {
    value: 'awr_sts',
    label: 'AWR via SQL Tuning Set',
    description: 'Pre-19c compatible — stages the plan through a temporary STS.',
  },
];

export function BaselineScriptModal({ initialSqlId, initialPlanHash, onClose }: BaselineScriptModalProps) {
  const [sqlId, setSqlId] = useState(initialSqlId ?? '');
  const [planHash, setPlanHash] = useState(initialPlanHash ?? '');
  const [source, setSource] = useState<BaselineSource>('cursor_cache');
  const [fixed, setFixed] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [copied, setCopied] = useState(false);
  const sqlIdRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    sqlIdRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sqlIdValid = sqlId !== '' && SQL_ID_RE.test(sqlId);
  const planHashValid = planHash !== '' && PLAN_HASH_RE.test(planHash);

  const options = useMemo<BaselineScriptOptions | null>(() => {
    if (!sqlIdValid || !planHashValid) return null;
    return { sqlId, planHash, source, fixed, enabled };
  }, [sqlIdValid, planHashValid, sqlId, planHash, source, fixed, enabled]);

  const script = useMemo(() => (options ? buildBaselineScript(options) : null), [options]);

  const copyScript = async () => {
    if (!script) return;
    try {
      await navigator.clipboard.writeText(script);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    if (!options || !script) return;
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = baselineScriptFilename(options);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 dark:bg-black/60 overflow-y-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-neutral-900 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-700 w-[640px] max-w-[95vw] my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Create SQL Plan Baseline
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-200 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400 leading-snug">
            This generates a script that captures this exact plan (SQL ID + plan hash value) as a{' '}
            SQL Plan Baseline via <code>DBMS_SPM</code>. The app stays offline — you run the script
            yourself in SQL*Plus / SQLcl on the target database. Requires the{' '}
            <code>ADMINISTER SQL MANAGEMENT OBJECT</code> privilege.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">
                SQL_ID
              </label>
              <input
                ref={sqlIdRef}
                type="text"
                value={sqlId}
                onChange={(e) => setSqlId(e.target.value.trim())}
                placeholder="e.g. an05rsj1up1k5"
                spellCheck={false}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 ${
                  sqlId === '' || sqlIdValid
                    ? 'border border-neutral-200 dark:border-neutral-700 focus:ring-blue-500/60'
                    : 'border border-red-400 dark:border-red-500 focus:ring-red-500/60'
                }`}
              />
              {sqlId !== '' && !sqlIdValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  SQL_ID is up to 13 alphanumeric characters.
                </p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">
                Plan hash
              </label>
              <input
                type="text"
                value={planHash}
                onChange={(e) => setPlanHash(e.target.value.trim())}
                placeholder="e.g. 3001234567"
                spellCheck={false}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 ${
                  planHash === '' || planHashValid
                    ? 'border border-neutral-200 dark:border-neutral-700 focus:ring-blue-500/60'
                    : 'border border-red-400 dark:border-red-500 focus:ring-red-500/60'
                }`}
              />
              {planHash !== '' && !planHashValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  Plan hash is digits only.
                </p>
              )}
            </div>
          </div>

          <div>
            <span className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide mb-1.5">
              Source
            </span>
            <div className="flex flex-col gap-1.5">
              {SOURCE_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-start gap-2 p-2 rounded-md border cursor-pointer transition-colors ${
                    source === opt.value
                      ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                      : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                  }`}
                >
                  <input
                    type="radio"
                    name="baseline-source"
                    value={opt.value}
                    checked={source === opt.value}
                    onChange={() => setSource(opt.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                      {opt.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={fixed}
                onChange={(e) => setFixed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                  Mark as FIXED
                </span>
                <span className="block text-[11px] text-neutral-500 dark:text-neutral-400 leading-snug">
                  Fixed baselines take priority and stop automatic plan evolution for the statement.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="mt-0.5"
              />
              <span className="block text-xs font-semibold text-neutral-800 dark:text-neutral-200">
                ENABLED
              </span>
            </label>
          </div>

          <div>
            <span className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide mb-1.5">
              Get the script
            </span>
            {!options && (
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-1.5">
                Enter a valid SQL_ID and plan hash above to generate the script.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copyScript}
                disabled={!script}
                className="h-8 px-3 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copied ? 'Copied!' : 'Copy script'}
              </button>
              <button
                type="button"
                onClick={download}
                disabled={!script}
                className="h-8 px-3 text-xs font-semibold rounded border border-neutral-300 dark:border-neutral-600 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Download .sql
              </button>
            </div>
            {script && (
              <details className="mt-2">
                <summary className="text-[10px] text-neutral-500 dark:text-neutral-400 cursor-pointer select-none hover:text-neutral-700 dark:hover:text-neutral-300">
                  Preview script ({script.split('\n').length} lines)
                </summary>
                <pre className="mt-1 text-[10px] font-mono p-2 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 whitespace-pre overflow-auto max-h-72">
                  {script}
                </pre>
              </details>
            )}
          </div>
        </div>

        <div className="flex justify-end px-4 py-3 border-t border-neutral-200 dark:border-neutral-800">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
