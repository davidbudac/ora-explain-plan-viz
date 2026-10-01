import { useMemo } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import { CopyButton, FOCUS_RING_INSET } from '../ui';
import { formatHintSummary, outlineHintBlock } from '../../lib/outlineHints';

hljs.registerLanguage('sql', sql);

export function SqlTextView() {
  const { parsedPlan } = usePlan();

  const sqlText = parsedPlan?.sqlText;
  const outlineHints = parsedPlan?.outlineHints;
  const hintSummary = parsedPlan?.hintSummary;

  const highlightedHtml = useMemo(() => {
    if (!sqlText) return '';
    try {
      return hljs.highlight(sqlText, { language: 'sql' }).value;
    } catch {
      return sqlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [sqlText]);

  if (!sqlText && !(outlineHints && outlineHints.length > 0)) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No SQL text available for this plan.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-950">
      {sqlText && (
        <div className="flex justify-end px-4 pt-3 pb-1">
          <CopyButton
            text={sqlText}
            label="Copy SQL"
            copiedLabel="Copied"
            size="sm"
            className="border border-slate-300 dark:border-slate-600"
          />
        </div>
      )}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {sqlText ? (
          <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
            <code
              className="hljs language-sql"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        ) : (
          <p className="pt-3 text-sm text-slate-500 dark:text-slate-400">No SQL text available for this plan.</p>
        )}

        {hintSummary && (
          <p
            className={`mt-4 text-xs ${
              hintSummary.unused + hintSummary.errors > 0
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {formatHintSummary(hintSummary)}
          </p>
        )}

        {outlineHints && outlineHints.length > 0 && (
          <details className="group mt-4 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <summary
              className={`flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none select-none rounded-md ${FOCUS_RING_INSET}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Outline hints <span className="font-mono normal-case tracking-normal">({outlineHints.length})</span>
              </span>
              <svg className="w-4 h-4 text-slate-300 group-open:rotate-180 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-3 pb-3">
              <div className="flex justify-end mb-1.5">
                <CopyButton
                  text={outlineHintBlock(outlineHints)}
                  label="Copy as hint block"
                  copiedLabel="Copied"
                  size="sm"
                  className="border border-slate-300 dark:border-slate-600"
                />
              </div>
              <ul className="max-h-72 overflow-auto rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 space-y-0.5">
                {outlineHints.map((hint, i) => (
                  <li key={i} className="text-xs font-mono text-slate-800 dark:text-slate-200 break-all">{hint}</li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
