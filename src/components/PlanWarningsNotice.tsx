import { useId, useState } from 'react';
import type { PlanWarning } from '../lib/types';
import { FOCUS_RING } from './ui';

/** More warnings than this start collapsed behind a "Show details" toggle. */
export const WARNINGS_COLLAPSE_AFTER = 2;

interface PlanWarningsNoticeProps {
  warnings: PlanWarning[];
  onDismiss: () => void;
}

/**
 * Dismissible notice listing what the parser could not read from the loaded plan (dropped
 * columns, unreadable rows, a cut-off paste ...). Amber when anything was lost, a quieter
 * slate when every entry is informational (e.g. SQL*Plus noise around XML was ignored).
 */
export function PlanWarningsNotice({ warnings, onDismiss }: PlanWarningsNoticeProps) {
  const collapsible = warnings.length > WARNINGS_COLLAPSE_AFTER;
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const showList = !collapsible || expanded;
  const allInfo = warnings.every((w) => w.severity === 'info');
  const heading = `${warnings.length} ${allInfo ? 'note' : 'warning'}${warnings.length === 1 ? '' : 's'} about this plan`;

  return (
    <div
      role="status"
      className={`p-2 text-xs rounded-md border flex items-start justify-between gap-2 ${
        allInfo
          ? 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
          : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300'
      }`}
    >
      <div className="min-w-0 flex-1">
        {collapsible && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls={listId}
            className={`font-semibold rounded ${FOCUS_RING}`}
          >
            {heading} — {expanded ? 'hide details' : 'show details'}
          </button>
        )}
        {showList && (
          <ul id={listId} className={`${collapsible ? 'mt-1 ' : ''}space-y-1`}>
            {warnings.map((warning) => (
              <li key={warning.code} data-warning-code={warning.code}>
                <span>{warning.message}</span>
                {warning.detail && (
                  <span className="block whitespace-pre-wrap font-mono text-[11px] opacity-80">{warning.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className={`shrink-0 font-bold opacity-60 hover:opacity-100 leading-none rounded ${FOCUS_RING}`}
      >
        ×
      </button>
    </div>
  );
}
