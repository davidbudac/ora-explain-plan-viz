import { useEffect, useMemo, useRef, useState } from 'react';
import gatherScript from '../../scripts/gather_plan_metadata.sql?raw';
import { parseManualObjectList, formatManualListArg } from '../lib/metadata/manualList';
import { usePlan } from '../hooks/usePlanContext';

type Mode = 'sqlid' | 'manual';

interface GatherScriptModalProps {
  initialSqlId?: string;
  initialMode?: Mode;
  onClose: () => void;
}

const SQL_ID_RE = /^[a-z0-9]{1,13}$/i;

export function GatherScriptModal({ initialSqlId, initialMode, onClose }: GatherScriptModalProps) {
  const { loadMetadataBundle, attachMetadataBundleToSlot, activePlanIndex, plans } = usePlan();
  const [mode, setMode] = useState<Mode>(initialMode ?? (initialSqlId ? 'sqlid' : 'manual'));
  const [sqlId, setSqlId] = useState(initialSqlId ?? '');
  const [planHash, setPlanHash] = useState('');
  const [manualText, setManualText] = useState('');
  const [copiedKey, setCopiedKey] = useState<'command' | 'script' | null>(null);
  const [outputText, setOutputText] = useState('');
  const [attachMessage, setAttachMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const sqlIdRef = useRef<HTMLInputElement>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'sqlid') sqlIdRef.current?.focus();
    else manualRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sqlIdValid = sqlId === '' || SQL_ID_RE.test(sqlId);
  const planHashValid = planHash === '' || /^\d+$/.test(planHash);

  const manualParsed = useMemo(() => parseManualObjectList(manualText), [manualText]);

  const command = useMemo(() => {
    if (mode === 'sqlid') {
      const args = sqlId
        ? `${sqlId}${planHash ? ` ${planHash}` : ''}`
        : '<SQL_ID> [<PLAN_HASH>]';
      return `@gather_plan_metadata.sql ${args}`;
    }
    const arg = manualParsed.items.length
      ? formatManualListArg(manualParsed.items)
      : '<OWNER.OBJECT,OWNER.OBJECT>';
    return `@gather_plan_metadata.sql LIST "${arg}"`;
  }, [mode, sqlId, planHash, manualParsed]);

  const attachOutput = (text: string) => {
    if (!text.trim()) {
      setAttachMessage({ tone: 'error', text: 'Nothing to attach — paste the script output first.' });
      return;
    }
    const slotLabel = (index: number) => {
      const slot = plans[index];
      return slot?.customLabel || slot?.label || `slot ${index + 1}`;
    };
    const report = (warning: string | null, index: number) => {
      if (warning) {
        setAttachMessage({ tone: 'warn', text: `Bundle attached to ${slotLabel(index)}, but ${warning}` });
      } else {
        setAttachMessage({ tone: 'ok', text: `Metadata bundle attached to ${slotLabel(index)}.` });
      }
      setOutputText('');
    };
    const result = loadMetadataBundle(text);
    if (result.ok === true) {
      report(result.warning, result.pairedSlotIndex);
    } else if (result.ok === 'needs-choice') {
      // The modal is opened from a specific plan's chip/panel — attach to it.
      const attach = attachMetadataBundleToSlot(result.bundle, activePlanIndex);
      if (attach.ok) {
        report(attach.warning, activePlanIndex);
      } else {
        setAttachMessage({ tone: 'error', text: attach.error });
      }
    } else {
      setAttachMessage({ tone: 'error', text: result.error });
    }
  };

  const handleFilePick = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      attachOutput(text);
    };
    reader.readAsText(file);
  };

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
            Gather Schema Metadata
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
            Run this script in SQL*Plus or SQLcl against the database that holds your plan.
            It collects the schema details relevant to this plan (tables, indexes, column
            stats, histograms) so you can analyze it with more context, and writes them to{' '}
            <code>bundle.json</code> in the current directory. Coverage depends on your
            privileges — the script prefers <code>DBA_*</code> views and falls back to{' '}
            <code>ALL_*</code>; anything it can't read is listed in{' '}
            <code>coverage_warnings</code>. When it's done, paste the file's contents below
            (or drop the file onto the input panel).
          </p>

          <div className="inline-flex rounded-md border border-neutral-200 dark:border-neutral-700 overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setMode('sqlid')}
              className={`px-3 py-1 ${
                mode === 'sqlid'
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200'
                  : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              }`}
            >
              SQL_ID
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-3 py-1 border-l border-neutral-200 dark:border-neutral-700 ${
                mode === 'manual'
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200'
                  : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
              }`}
            >
              Object list
            </button>
          </div>

          {mode === 'sqlid' ? (
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
          ) : (
            <div>
              <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1 uppercase tracking-wide">
                Objects ({manualParsed.items.length})
              </label>
              <textarea
                ref={manualRef}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={'One OWNER.OBJECT per line, e.g.:\nHR.EMPLOYEES\nHR.DEPARTMENTS\nHR.EMP_EMP_ID_PK'}
                spellCheck={false}
                rows={6}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 border border-neutral-200 dark:border-neutral-700"
              />
              {manualParsed.errors.length > 0 && (
                <ul className="mt-1 text-[10px] text-red-600 dark:text-red-400 list-disc list-inside space-y-0.5">
                  {manualParsed.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
                Identifiers are upper-cased unless wrapped in double quotes. Indexes will be
                pulled in automatically for any table you list.
              </p>
            </div>
          )}

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

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400 uppercase tracking-wide">
                Attach the output
              </span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-[10px] px-1.5 py-0.5 rounded border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Load file…
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  handleFilePick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
            <textarea
              value={outputText}
              onChange={(e) => setOutputText(e.target.value)}
              placeholder="Paste the contents of bundle.json here… (SQL*Plus prompt lines are fine — they are stripped automatically)"
              spellCheck={false}
              rows={3}
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 border border-neutral-200 dark:border-neutral-700"
            />
            {attachMessage && (
              <div
                className={`mt-1 p-2 text-[11px] rounded-md border ${
                  attachMessage.tone === 'ok'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                    : attachMessage.tone === 'warn'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
                }`}
              >
                {attachMessage.text}
              </div>
            )}
            <div className="mt-1.5 flex justify-end">
              <button
                type="button"
                onClick={() => attachOutput(outputText)}
                disabled={!outputText.trim()}
                className="h-7 px-3 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Attach bundle
              </button>
            </div>
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
