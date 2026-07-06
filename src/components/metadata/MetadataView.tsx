import { useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import { GatherScriptModal } from '../GatherScriptModal';
import { MetadataExplorer } from './MetadataExplorer';

function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

export function MetadataView() {
  const { metadataBundle, metadataBundleWarning, parsedPlan, metadataPopoutOpen, setMetadataPopoutOpen } = usePlan();
  const [showGatherModal, setShowGatherModal] = useState(false);

  if (!metadataBundle) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8 bg-slate-50 dark:bg-slate-950">
        <svg className="w-12 h-12 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7c0-1.1 3.6-2 8-2s8 .9 8 2-3.6 2-8 2-8-.9-8-2zm0 0v10c0 1.1 3.6 2 8 2s8-.9 8-2V7M4 12c0 1.1 3.6 2 8 2s8-.9 8-2" />
        </svg>
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">No metadata attached to this plan</h3>
        <p className="max-w-md text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Run the gather script to collect schema details — tables, indexes, constraints, column stats and
          histograms — so you can study this plan with more context.
        </p>
        <button
          type="button"
          onClick={() => setShowGatherModal(true)}
          className="mt-1 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors uppercase tracking-wider"
        >
          {parsedPlan?.sqlId ? 'Generate gather script' : 'Manual gather script'}
        </button>
        {showGatherModal && (
          <GatherScriptModal
            initialSqlId={parsedPlan?.sqlId}
            initialMode={parsedPlan?.sqlId ? 'sqlid' : 'manual'}
            onClose={() => setShowGatherModal(false)}
          />
        )}
      </div>
    );
  }

  if (metadataPopoutOpen) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center p-8 bg-slate-50 dark:bg-slate-950">
        <svg className="w-10 h-10 text-slate-300 dark:text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
        <p className="text-sm text-slate-600 dark:text-slate-400">Metadata is open in a separate window.</p>
        <button
          type="button"
          onClick={() => setMetadataPopoutOpen(false)}
          className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors uppercase tracking-wider"
        >
          Bring back
        </button>
      </div>
    );
  }

  const objects = Object.values(metadataBundle.objects);
  const tableCount = objects.filter((o) => o.type === 'TABLE').length;
  const indexCount = objects.filter((o) => o.type === 'INDEX').length;

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <div className="shrink-0 px-4 py-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400 min-w-0 overflow-hidden">
          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200 truncate">
            {metadataBundle.source.db_name} · {metadataBundle.source.oracle_version} · {metadataBundle.source.container_name}
          </span>
          <span className="shrink-0">{tableCount} tables, {indexCount} indexes</span>
          {metadataBundle.plan_ref.sql_id && (
            <span className="font-mono shrink-0">
              {metadataBundle.plan_ref.sql_id}
              {metadataBundle.plan_ref.plan_hash_value !== null && ` · PHV ${metadataBundle.plan_ref.plan_hash_value}`}
            </span>
          )}
          <span className="shrink-0 hidden sm:inline">Captured {formatCapturedAt(metadataBundle.captured_at)}</span>
        </div>
        <button
          type="button"
          onClick={() => setMetadataPopoutOpen(true)}
          className="shrink-0 h-7 px-2.5 text-[11px] font-semibold rounded border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center gap-1.5"
          title="Pop out into a separate window"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
          Pop out
        </button>
      </div>
      {metadataBundleWarning && (
        <div className="shrink-0 mx-4 mt-2 p-2 text-[11px] rounded border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          {metadataBundleWarning}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <MetadataExplorer bundle={metadataBundle} />
      </div>
    </div>
  );
}
