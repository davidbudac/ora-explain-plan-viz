import { useEffect, useMemo, useRef, useState } from 'react';
import gatherScriptTemplate from '../../scripts/gather_plan_metadata.sql?raw';
import { parseManualObjectList, formatManualListArg } from '../lib/metadata/manualList';
import { buildGatherScript, downloadFilename, BUNDLE_SPOOL_FILE } from '../lib/metadata/gatherScript';
import type { GatherTarget } from '../lib/metadata/gatherScript';
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
  const [copiedKey, setCopiedKey] = useState<'script' | null>(null);
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

  const target = useMemo<GatherTarget | null>(() => {
    if (mode === 'sqlid') {
      if (!sqlId || !SQL_ID_RE.test(sqlId) || !planHashValid) return null;
      return { mode: 'sqlid', sqlId, planHash: planHash || undefined };
    }
    if (manualParsed.items.length === 0 || manualParsed.errors.length > 0) return null;
    return { mode: 'manual', objectList: formatManualListArg(manualParsed.items) };
  }, [mode, sqlId, planHash, planHashValid, manualParsed]);

  const pasteScript = useMemo(
    () => (target ? buildGatherScript(gatherScriptTemplate, target, 'screen') : null),
    [target],
  );

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

  const copyScript = async () => {
    if (!pasteScript) return;
    try {
      await navigator.clipboard.writeText(pasteScript);
      setCopiedKey('script');
      setTimeout(() => setCopiedKey((k) => (k === 'script' ? null : k)), 1200);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    if (!target) return;
    const script = buildGatherScript(gatherScriptTemplate, target, 'spool');
    const blob = new Blob([script], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadFilename(target);
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
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 w-[640px] max-w-[95vw] my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Gather Schema Metadata
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
            This generates a ready-to-run script that collects the schema details relevant
            to this plan (tables, indexes, column stats, histograms) from the database that
            ran it. Coverage depends on your privileges — the script prefers{' '}
            <code>DBA_*</code> views and falls back to <code>ALL_*</code>; anything it can't
            read is listed in <code>coverage_warnings</code>. It is read-only against the
            data dictionary.
          </p>

          <div className="inline-flex rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden text-[11px]">
            <button
              type="button"
              onClick={() => setMode('sqlid')}
              className={`px-3 py-1 ${
                mode === 'sqlid'
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              SQL_ID
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-3 py-1 border-l border-slate-200 dark:border-slate-700 ${
                mode === 'manual'
                  ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-200'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Object list
            </button>
          </div>

          {mode === 'sqlid' ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                  SQL_ID
                </label>
                <input
                  ref={sqlIdRef}
                  type="text"
                  value={sqlId}
                  onChange={(e) => setSqlId(e.target.value.trim())}
                  placeholder="e.g. an05rsj1up1k5"
                  spellCheck={false}
                  className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 ${
                    sqlIdValid
                      ? 'border border-slate-200 dark:border-slate-700 focus:ring-blue-500/60'
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
                <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                  Plan hash <span className="font-normal normal-case text-slate-400">(optional)</span>
                </label>
                <input
                  type="text"
                  value={planHash}
                  onChange={(e) => setPlanHash(e.target.value.trim())}
                  placeholder="e.g. 3001234567"
                  spellCheck={false}
                  className={`w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 ${
                    planHashValid
                      ? 'border border-slate-200 dark:border-slate-700 focus:ring-blue-500/60'
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
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 uppercase tracking-wide">
                Objects ({manualParsed.items.length})
              </label>
              <textarea
                ref={manualRef}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder={'One OWNER.OBJECT per line, e.g.:\nHR.EMPLOYEES\nHR.DEPARTMENTS\nHR.EMP_EMP_ID_PK'}
                spellCheck={false}
                rows={6}
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 border border-slate-200 dark:border-slate-700"
              />
              {manualParsed.errors.length > 0 && (
                <ul className="mt-1 text-[10px] text-red-600 dark:text-red-400 list-disc list-inside space-y-0.5">
                  {manualParsed.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
                Identifiers are upper-cased unless wrapped in double quotes. Indexes will be
                pulled in automatically for any table you list.
              </p>
            </div>
          )}

          <div>
            <span className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
              Run against the database
            </span>
            {!target && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5">
                {mode === 'sqlid'
                  ? 'Enter a valid SQL_ID above to generate the script.'
                  : 'List at least one OWNER.OBJECT above to generate the script.'}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={copyScript}
                  disabled={!target}
                  className="h-7 px-3 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {copiedKey === 'script' ? 'Copied!' : 'Copy paste-ready script'}
                </button>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Paste the whole script into a SQL*Plus / SQLcl session. It prints the JSON
                  bundle between BEGIN/END markers — copy that back into the box below.
                </p>
              </div>
              <div className="p-2.5 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={download}
                  disabled={!target}
                  className="h-7 px-3 text-xs font-semibold rounded border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Download .sql
                </button>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-snug">
                  Run it with <code>@{target ? downloadFilename(target) : 'gather_plan_metadata.sql'}</code>{' '}
                  — no arguments needed. It writes <code>{BUNDLE_SPOOL_FILE}</code>, which you
                  can drop below or onto the input panel.
                </p>
              </div>
            </div>
            {pasteScript && (
              <details className="mt-2">
                <summary className="text-[10px] text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300">
                  Preview script ({pasteScript.split('\n').length} lines)
                </summary>
                <pre className="mt-1 text-[10px] font-mono p-2 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 whitespace-pre overflow-auto max-h-72">
                  {pasteScript}
                </pre>
              </details>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                Attach the output
              </span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
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
              placeholder="Paste the script's terminal output or the contents of bundle.json here… (SQL*Plus noise lines are fine — they are stripped automatically)"
              spellCheck={false}
              rows={3}
              className="w-full px-2.5 py-1.5 text-xs font-mono rounded-md bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 border border-slate-200 dark:border-slate-700"
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

        <div className="flex justify-end px-4 py-3 border-t border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
