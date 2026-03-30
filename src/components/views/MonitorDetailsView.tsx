import { useMemo, useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import type { SqlMonitorMetadata } from '../../lib/types';
import { formatNumberShort, formatBytes, formatTimeDetailed } from '../../lib/format';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';

hljs.registerLanguage('sql', sql);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded border transition-colors
        text-neutral-500 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600
        hover:bg-neutral-100 dark:hover:bg-neutral-800"
    >
      {copied ? (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
          Copied
        </>
      ) : (
        <>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
          Copy
        </>
      )}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/50">
        <h3 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">{title}</h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | number | null }) {
  if (value === undefined || value === null) return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium">{label}</span>
      <span className="text-sm text-neutral-800 dark:text-neutral-200 font-mono">{value}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const upper = status.toUpperCase();
  let color = 'bg-neutral-100 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-300';
  if (upper.includes('DONE')) color = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  else if (upper.includes('EXECUTING')) color = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  else if (upper.includes('ERROR') || upper.includes('FAIL')) color = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${color}`}>{status}</span>
  );
}

/** Stacked horizontal bar showing time breakdown */
function TimeBreakdownBar({ meta }: { meta: SqlMonitorMetadata }) {
  const cpu = meta.cpuTime ?? 0;
  const io = meta.userIoWaitTime ?? 0;
  const plsql = meta.plsqlExecTime ?? 0;
  const other = meta.otherWaitTime ?? 0;
  const total = cpu + io + plsql + other;
  if (total === 0) return null;

  const pct = (v: number) => Math.max((v / total) * 100, 0);
  const fmt = (v: number) => formatTimeDetailed(v / 1000) ?? '0ms'; // us -> ms

  return (
    <div className="space-y-1.5">
      <div className="flex h-5 rounded overflow-hidden bg-neutral-100 dark:bg-neutral-800">
        {cpu > 0 && (
          <div className="bg-emerald-500 dark:bg-emerald-600 transition-all" style={{ width: `${pct(cpu)}%` }}
            title={`CPU: ${fmt(cpu)} (${pct(cpu).toFixed(1)}%)`} />
        )}
        {io > 0 && (
          <div className="bg-sky-500 dark:bg-sky-600 transition-all" style={{ width: `${pct(io)}%` }}
            title={`I/O Wait: ${fmt(io)} (${pct(io).toFixed(1)}%)`} />
        )}
        {plsql > 0 && (
          <div className="bg-violet-500 dark:bg-violet-600 transition-all" style={{ width: `${pct(plsql)}%` }}
            title={`PL/SQL: ${fmt(plsql)} (${pct(plsql).toFixed(1)}%)`} />
        )}
        {other > 0 && (
          <div className="bg-neutral-400 dark:bg-neutral-500 transition-all" style={{ width: `${pct(other)}%` }}
            title={`Other: ${fmt(other)} (${pct(other).toFixed(1)}%)`} />
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {cpu > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 dark:bg-emerald-600" />CPU {fmt(cpu)} ({pct(cpu).toFixed(1)}%)</span>}
        {io > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-sky-500 dark:bg-sky-600" />I/O Wait {fmt(io)} ({pct(io).toFixed(1)}%)</span>}
        {plsql > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-violet-500 dark:bg-violet-600" />PL/SQL {fmt(plsql)} ({pct(plsql).toFixed(1)}%)</span>}
        {other > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral-400 dark:bg-neutral-500" />Other {fmt(other)} ({pct(other).toFixed(1)}%)</span>}
      </div>
    </div>
  );
}

export function MonitorDetailsView() {
  const { parsedPlan } = usePlan();
  const meta = parsedPlan?.monitorMetadata;

  const highlightedSql = useMemo(() => {
    if (!parsedPlan?.sqlText) return '';
    try {
      return hljs.highlight(parsedPlan.sqlText, { language: 'sql' }).value;
    } catch {
      return parsedPlan.sqlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [parsedPlan?.sqlText]);

  // Aggregate peak memory/temp from nodes
  const { peakMemory, peakTemp } = useMemo(() => {
    if (!parsedPlan?.allNodes) return { peakMemory: undefined, peakTemp: undefined };
    let mem = 0, tmp = 0;
    for (const n of parsedPlan.allNodes) {
      if (n.memoryUsed && n.memoryUsed > mem) mem = n.memoryUsed;
      if (n.tempUsed && n.tempUsed > tmp) tmp = n.tempUsed;
    }
    return {
      peakMemory: mem > 0 ? mem : undefined,
      peakTemp: tmp > 0 ? tmp : undefined,
    };
  }, [parsedPlan?.allNodes]);

  if (!parsedPlan || !meta) {
    return (
      <div className="h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No SQL Monitor metadata available for this plan.
        </p>
      </div>
    );
  }

  const binds = parsedPlan.bindVariables;

  return (
    <div className="h-full overflow-auto bg-neutral-50 dark:bg-neutral-950 p-4 space-y-4">
      {/* Execution Summary */}
      <Section title="Execution Summary">
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-3">
            {meta.status && (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 font-medium">Status</span>
                <StatusBadge status={meta.status} />
              </div>
            )}
            <Field label="SQL ID" value={parsedPlan.sqlId} />
            <Field label="Plan Hash" value={parsedPlan.planHashValue} />
            <Field label="Exec Start" value={meta.sqlExecStart} />
            <Field label="Duration" value={meta.duration !== undefined ? formatTimeDetailed(meta.duration * 1000) : undefined} />
            <Field label="Elapsed Time" value={formatTimeDetailed(parsedPlan.totalElapsedTime)} />
            <Field label="SQL Exec ID" value={meta.sqlExecId} />
          </div>
          <TimeBreakdownBar meta={meta} />
        </div>
      </Section>

      {/* Session & Environment */}
      {(meta.sessionId || meta.user || meta.program || meta.dbVersion) && (
        <Section title="Session & Environment">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-3">
            <Field label="Session" value={meta.sessionId !== undefined
              ? `${meta.sessionId}${meta.sessionSerial !== undefined ? `, ${meta.sessionSerial}` : ''}`
              : undefined} />
            <Field label="Instance" value={meta.instanceId} />
            <Field label="User" value={meta.user} />
            <Field label="Program" value={meta.program} />
            <Field label="Module" value={meta.module} />
            <Field label="Service" value={meta.service} />
            <Field label="Database" value={meta.dbUniqueName} />
            <Field label="DB Version" value={meta.dbVersion} />
            <Field label="Platform" value={meta.dbPlatform} />
            <Field label="Host" value={meta.reportHostName} />
            <Field label="CPU Cores" value={meta.cpuCores !== undefined
              ? `${meta.cpuCores}${meta.hyperthread !== undefined ? (meta.hyperthread ? ' (HT)' : ' (no HT)') : ''}`
              : undefined} />
          </div>
        </Section>
      )}

      {/* SQL Text */}
      {parsedPlan.sqlText && (
        <Section title="SQL Text">
          <div className="space-y-2">
            <div className="flex justify-end">
              <CopyButton text={parsedPlan.sqlText} />
            </div>
            <div className="max-h-64 overflow-auto rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 p-3">
              <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words">
                <code className="hljs language-sql" dangerouslySetInnerHTML={{ __html: highlightedSql }} />
              </pre>
            </div>
          </div>
        </Section>
      )}

      {/* Bind Variables */}
      {binds && binds.length > 0 && (
        <Section title="Bind Variables">
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 border-b border-neutral-200 dark:border-neutral-700">
                  <th className="pb-1.5 pr-4 font-medium">#</th>
                  <th className="pb-1.5 pr-4 font-medium">Name</th>
                  <th className="pb-1.5 pr-4 font-medium">Type</th>
                  <th className="pb-1.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {binds.map((b, i) => (
                  <tr key={b.name} className={i % 2 === 0 ? '' : 'bg-neutral-50 dark:bg-neutral-800/30'}>
                    <td className="py-1 pr-4 font-mono text-neutral-400">{b.position ?? i + 1}</td>
                    <td className="py-1 pr-4 font-mono font-medium text-neutral-700 dark:text-neutral-300">{b.name}</td>
                    <td className="py-1 pr-4 text-neutral-500 dark:text-neutral-400">{b.type ?? '—'}</td>
                    <td className="py-1 font-mono text-neutral-800 dark:text-neutral-200">{b.value ?? <span className="text-neutral-400 italic">null</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Resource Consumption */}
      {(meta.bufferGets || meta.readReqs || meta.readBytes || peakMemory || peakTemp) && (
        <Section title="Resource Consumption">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-6 gap-y-3">
            <Field label="Buffer Gets" value={formatNumberShort(meta.bufferGets)} />
            <Field label="Physical Read Reqs" value={formatNumberShort(meta.readReqs)} />
            <Field label="Physical Read Bytes" value={formatBytes(meta.readBytes)} />
            <Field label="User Fetch Count" value={meta.userFetchCount?.toString()} />
            <Field label="Peak Memory" value={formatBytes(peakMemory)} />
            <Field label="Peak Temp Space" value={formatBytes(peakTemp)} />
            <Field label="Total Cost" value={parsedPlan.totalCost > 0 ? formatNumberShort(parsedPlan.totalCost) : undefined} />
            <Field label="Operations" value={parsedPlan.allNodes.length.toString()} />
          </div>
        </Section>
      )}

      {/* Optimizer Environment */}
      {meta.optimizerEnv && Object.keys(meta.optimizerEnv).length > 0 && (
        <Section title="Optimizer Environment">
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-neutral-400 dark:text-neutral-500 border-b border-neutral-200 dark:border-neutral-700">
                  <th className="pb-1.5 pr-4 font-medium">Parameter</th>
                  <th className="pb-1.5 font-medium">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(meta.optimizerEnv).sort(([a], [b]) => a.localeCompare(b)).map(([key, val], i) => (
                  <tr key={key} className={i % 2 === 0 ? '' : 'bg-neutral-50 dark:bg-neutral-800/30'}>
                    <td className="py-1 pr-4 font-mono text-neutral-700 dark:text-neutral-300">{key}</td>
                    <td className="py-1 font-mono text-neutral-800 dark:text-neutral-200">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
