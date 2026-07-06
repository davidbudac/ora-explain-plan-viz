import { useEffect, useRef, useState } from 'react';
import type { MetadataBundle } from '../lib/metadata/bundle';
import { GatherScriptModal } from './GatherScriptModal';

interface MetadataChipProps {
  bundle: MetadataBundle | null;
  warning: string | null;
  planSqlId?: string;
  onDetach: () => void;
}

export function MetadataChip({ bundle, warning, planSqlId, onDetach }: MetadataChipProps) {
  const [showModal, setShowModal] = useState(false);
  const [showPopover, setShowPopover] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPopover) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowPopover(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowPopover(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showPopover]);

  if (!bundle) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title="Attempt to gather schema metadata (tables, indexes, column stats, histograms) so you can analyze this plan with more context. Coverage depends on your database privileges."
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 bg-indigo-50/60 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add metadata
        </button>
        {showModal && (
          <GatherScriptModal
            initialSqlId={planSqlId}
            initialMode={planSqlId ? 'sqlid' : 'manual'}
            onClose={() => setShowModal(false)}
          />
        )}
      </>
    );
  }

  const objects = Object.values(bundle.objects);
  const tableCount = objects.filter((o) => o.type === 'TABLE').length;
  const indexCount = objects.filter((o) => o.type === 'INDEX').length;
  const warningCount = bundle.coverage_warnings.length + (warning ? 1 : 0);
  const capturedAt = formatCapturedAt(bundle.captured_at);

  return (
    <>
      <div className="relative" ref={popoverRef}>
        <button
          type="button"
          onClick={() => setShowPopover((v) => !v)}
          title="Schema metadata is attached to this plan"
          className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium rounded bg-indigo-600 dark:bg-indigo-500 text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z" />
          </svg>
          Metadata: {tableCount} {tableCount === 1 ? 'table' : 'tables'}, {indexCount} {indexCount === 1 ? 'index' : 'indexes'}
          {warningCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 text-amber-950 text-[10px] font-bold" title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}>
              !
            </span>
          )}
        </button>
        {showPopover && (
          <div className="absolute left-0 top-full mt-1 w-80 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg z-50 p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Metadata bundle</h3>
              <button
                type="button"
                onClick={() => setShowPopover(false)}
                aria-label="Close"
                className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-neutral-700 dark:text-neutral-300">
              <dt className="text-neutral-500 dark:text-neutral-400">Source</dt>
              <dd className="font-mono truncate">{bundle.source.db_name} · {bundle.source.oracle_version} · {bundle.source.container_name}</dd>
              <dt className="text-neutral-500 dark:text-neutral-400">Captured</dt>
              <dd>{capturedAt}</dd>
              <dt className="text-neutral-500 dark:text-neutral-400">Plan ref</dt>
              <dd className="font-mono truncate">
                {bundle.plan_ref.sql_id ?? '—'}
                {bundle.plan_ref.plan_hash_value !== null && <> · PHV {bundle.plan_ref.plan_hash_value}</>}
              </dd>
              <dt className="text-neutral-500 dark:text-neutral-400">Objects</dt>
              <dd>{tableCount} tables, {indexCount} indexes</dd>
              {bundle.system_params && (
                <>
                  <dt className="text-neutral-500 dark:text-neutral-400">System params</dt>
                  <dd className="font-mono truncate" title={`block size ${bundle.system_params.db_block_size}, optimizer_features_enable ${bundle.system_params.optimizer_features_enable}`}>
                    block {bundle.system_params.db_block_size}B · features {bundle.system_params.optimizer_features_enable}
                  </dd>
                </>
              )}
            </dl>
            {warning && (
              <div className="mt-2 p-2 rounded border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300">
                {warning}
              </div>
            )}
            {bundle.coverage_warnings.length > 0 && (
              <details className="mt-2 group">
                <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400 hover:text-neutral-800 dark:hover:text-neutral-200">
                  {bundle.coverage_warnings.length} coverage warning{bundle.coverage_warnings.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-1 pl-4 list-disc space-y-0.5 text-neutral-600 dark:text-neutral-400 max-h-32 overflow-y-auto">
                  {bundle.coverage_warnings.map((w, i) => (
                    <li key={i}><span className="font-mono">{w.object}</span>: {w.reason}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="mt-3 flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowPopover(false);
                  setShowModal(true);
                }}
                className="h-7 px-2 text-xs border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
              >
                Replace…
              </button>
              <button
                type="button"
                onClick={() => {
                  onDetach();
                  setShowPopover(false);
                }}
                className="h-7 px-2 text-xs border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 bg-white dark:bg-neutral-800 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                Detach
              </button>
            </div>
          </div>
        )}
      </div>
      {showModal && (
        <GatherScriptModal
          initialSqlId={planSqlId ?? bundle.plan_ref.sql_id ?? undefined}
          initialMode={planSqlId || bundle.plan_ref.sql_id ? 'sqlid' : 'manual'}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}

function formatCapturedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}
