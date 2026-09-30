import { useMemo } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import { CopyButton } from '../ui';

hljs.registerLanguage('sql', sql);

export function SqlTextView() {
  const { parsedPlan } = usePlan();

  const sqlText = parsedPlan?.sqlText;

  const highlightedHtml = useMemo(() => {
    if (!sqlText) return '';
    try {
      return hljs.highlight(sqlText, { language: 'sql' }).value;
    } catch {
      return sqlText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
  }, [sqlText]);

  if (!sqlText) {
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
      <div className="flex justify-end px-4 pt-3 pb-1">
        <CopyButton
          text={sqlText}
          label="Copy SQL"
          copiedLabel="Copied"
          size="sm"
          className="border border-slate-300 dark:border-slate-600"
        />
      </div>
      <div className="flex-1 overflow-auto px-4 pb-4">
        <pre className="text-sm font-mono leading-relaxed whitespace-pre-wrap break-words">
          <code
            className="hljs language-sql"
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      </div>
    </div>
  );
}
