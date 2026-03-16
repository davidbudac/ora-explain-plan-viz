import { useMemo, useState } from 'react';
import { usePlan } from '../../hooks/usePlanContext';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';

hljs.registerLanguage('sql', sql);

export function SqlTextView() {
  const { parsedPlan } = usePlan();
  const [copied, setCopied] = useState(false);

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
      <div className="h-full flex items-center justify-center bg-neutral-50 dark:bg-neutral-950">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">
          No SQL text available for this plan.
        </p>
      </div>
    );
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = sqlText;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="h-full flex flex-col bg-neutral-50 dark:bg-neutral-950">
      <div className="flex justify-end px-4 pt-3 pb-1">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors
            text-neutral-600 dark:text-neutral-400 border-neutral-300 dark:border-neutral-600
            hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
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
