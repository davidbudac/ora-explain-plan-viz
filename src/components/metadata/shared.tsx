/* eslint-disable react-refresh/only-export-components */
import { useCallback, useState } from 'react';
import type { ColumnStats } from '../../lib/metadata/bundle';

export { formatBytes } from '../../lib/format';

/** Copy-to-clipboard icon button with a brief "copied" confirmation state. */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors"
      title={label || 'Copy to clipboard'}
    >
      {copied ? (
        <svg className="w-3.5 h-3.5 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

/** Collapsible DDL block with a copy button, matching the detail-panel accordion look. */
export function DdlBlock({ ddl }: { ddl: string }) {
  if (!ddl || !ddl.trim()) return null;
  return (
    <details className="group mt-4 pt-4 border-t border-slate-200 dark:border-slate-800" open={false}>
      <summary className="flex items-center justify-between cursor-pointer list-none select-none mb-2">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
          <h5 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            DDL
          </h5>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          className="inline-flex"
        >
          <CopyButton text={ddl} label="Copy DDL" />
        </span>
      </summary>
      <pre className="text-[10px] leading-relaxed font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-slate-800 dark:text-slate-200 whitespace-pre overflow-auto max-h-72">
        {ddl.trim()}
      </pre>
    </details>
  );
}

export function formatHistogramLabel(type: ColumnStats['histogram']['type'], buckets: number): string {
  if (type === 'NONE') return 'None';
  const pretty: Record<Exclude<ColumnStats['histogram']['type'], 'NONE'>, string> = {
    FREQUENCY: 'Frequency',
    'HEIGHT BALANCED': 'Height balanced',
    HYBRID: 'Hybrid',
    'TOP-FREQUENCY': 'Top frequency',
  };
  return `${pretty[type]} (${buckets})`;
}

export function formatDateShort(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** Titled card shell shared by the overview/table/index detail panes. */
export function Card({ title, children }: { title: string; children: import('react').ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">{title}</h4>
      {children}
    </div>
  );
}

/** Small bold uppercase pill used for constraint/directive kind labels. */
export function Tag({ children, color }: { children: import('react').ReactNode; color?: 'amber' }) {
  return (
    <span
      className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase ${
        color === 'amber'
          ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
          : 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300'
      }`}
    >
      {children}
    </span>
  );
}

/** Single stat cell for the grids inside the detail panes. */
export function StatItem({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="bg-white dark:bg-slate-900 px-2.5 py-2">
      <div className="text-[10px] text-slate-400 dark:text-slate-500 mb-1">{label}</div>
      <div className="text-xs font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
