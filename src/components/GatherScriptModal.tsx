import { useEffect, useMemo, useRef, useState } from 'react';
import gatherScript from '../../scripts/gather_plan_metadata.sql?raw';

interface GatherScriptModalProps {
  initialSqlId?: string;
  onClose: () => void;
}

const SQL_ID_RE = /^[a-z0-9]{1,13}$/i;

export function GatherScriptModal({ initialSqlId, onClose }: GatherScriptModalProps) {
  const [sqlId, setSqlId] = useState(initialSqlId ?? '');
  const [planHash, setPlanHash] = useState('');
  const [copiedKey, setCopiedKey] = useState<'command' | 'script' | null>(null);
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

  const sqlIdValid = sqlId === '' || SQL_ID_RE.test(sqlId);
  const planHashValid = planHash === '' || /^\d+$/.test(planHash);

  const command = useMemo(() => {
    const args = sqlId
      ? `${sqlId}${planHash ? ` ${planHash}` : ''}`
      : '<SQL_ID> [<PLAN_HASH>]';
    return [
      'SET SERVEROUTPUT ON SIZE UNLIMITED',
      'SPOOL bundle.json',
      `@gather_plan_metadata.sql ${args}`,
      'SPOOL OFF',
    ].join('\n');
  }, [sqlId, planHash]);

  const copy = async (text: string, key: 'command' | 'script') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    const blob = new Blob([gatherScript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gather_plan_metadata.sql';
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
            Generate Metadata Gather Script
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
            Run this PL/SQL script in SQL*Plus or SQLcl against the database that holds your
            plan. The script emits a JSON bundle to <code>DBMS_OUTPUT</code>; capture it with
            <code> SPOOL</code> and drop the file onto the input area of this app.
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
                  sqlIdValid
                    ? 'border border-neutral-200 dark:border-neutral-700 focus:ring-blue-500/60'
                    : 'border border-red-400 dark:border-red-500 focus:ring-red-500/60'
                }`}
              />
              {!sqlIdValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  SQL_ID is up to 13 alphanumeric characters.
                </p>
              )}
            </div>
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">
                Plan hash <span className="font-normal normal-case text-neutral-400">(optional)</span>
              </label>
              <input
                type="text"
                value={planHash}
                onChange={(e) => setPlanHash(e.target.value.trim())}
                placeholder="e.g. 3001234567"
                spellCheck={false}
                className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 ${
                  planHashValid
                    ? 'border border-neutral-200 dark:border-neutral-700 focus:ring-blue-500/60'
                    : 'border border-red-400 dark:border-red-500 focus:ring-red-500/60'
                }`}
              />
              {!planHashValid && (
                <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                  Plan hash is digits only.
                </p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">
                Command to run
              </span>
              <button
                type="button"
                onClick={() => copy(command, 'command')}
                className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                {copiedKey === 'command' ? 'Copied!' : 'Copy command'}
              </button>
            </div>
            <pre className="text-[11px] font-mono p-2 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 whitespace-pre overflow-x-auto">
              {command}
            </pre>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">
                Script ({gatherScript.split('\n').length} lines)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => copy(gatherScript, 'script')}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  {copiedKey === 'script' ? 'Copied!' : 'Copy script'}
                </button>
                <button
                  type="button"
                  onClick={download}
                  className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Download .sql
                </button>
              </div>
            </div>
            <pre className="text-[10px] font-mono p-2 rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 text-neutral-800 dark:text-neutral-200 whitespace-pre overflow-auto max-h-72">
              {gatherScript}
            </pre>
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
