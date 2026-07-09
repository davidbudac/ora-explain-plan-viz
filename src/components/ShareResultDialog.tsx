import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { copyToClipboard } from '../lib/clipboard';

/**
 * App-level dialog that surfaces the outcome of a "Share via URL" action.
 *
 * Only renders when the user needs to do or verify something:
 * - `manual`  — auto-copy was blocked (insecure origin, no focus, …). Show the
 *   full URL pre-selected so a single Ctrl/Cmd+C copies it reliably, avoiding
 *   the truncation that happens when a long link is hand-selected from the
 *   address bar.
 * - `warning` — copied, but long enough that some clients may truncate it.
 * - `error`   — the link could not be built.
 *
 * The clean `copied` case shows no dialog (the header button flashes a check).
 */
export function ShareResultDialog() {
  const { shareNotice, dismissShareNotice } = usePlan();
  const inputRef = useRef<HTMLInputElement>(null);
  const [justCopied, setJustCopied] = useState(false);

  const kind = shareNotice?.kind;
  const showDialog = kind === 'manual' || kind === 'warning' || kind === 'error';

  // Reset the "copied" flash whenever a new notice comes in. `showDialog` is
  // derived purely from `shareNotice`, so tracking `shareNotice` alone covers
  // every case the previous `[showDialog, shareNotice]` effect dep did.
  const [prevShareNotice, setPrevShareNotice] = useState(shareNotice);
  if (shareNotice !== prevShareNotice) {
    setPrevShareNotice(shareNotice);
    setJustCopied(false);
  }

  // Pre-select the URL so the user can copy the whole thing in one keystroke.
  useEffect(() => {
    if (showDialog && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showDialog, shareNotice]);

  // Dismiss on Escape while the dialog is open.
  useEffect(() => {
    if (!showDialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissShareNotice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDialog, dismissShareNotice]);

  const url = shareNotice && 'url' in shareNotice ? shareNotice.url : '';

  const handleCopy = useCallback(async () => {
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setJustCopied(true);
      setTimeout(() => setJustCopied(false), 2000);
    } else if (inputRef.current) {
      // Still couldn't copy programmatically — re-select for a manual copy.
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [url]);

  if (!shareNotice || !showDialog) return null;

  const isError = kind === 'error';
  const title = isError
    ? 'Could not share plan'
    : kind === 'manual'
      ? 'Copy your share link'
      : 'Share link copied';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 dark:bg-black/50 p-4"
      onClick={dismissShareNotice}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="bg-white dark:bg-slate-900 rounded-lg shadow-xl border border-slate-200 dark:border-slate-700 p-4 w-[32rem] max-w-[92vw]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h2>
          <button
            onClick={dismissShareNotice}
            className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            title="Close"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {shareNotice.kind === 'error' ? (
          <p className="text-xs text-red-600 dark:text-red-400">
            {shareNotice.message}
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              {kind === 'manual'
                ? 'Automatic copy was blocked by the browser. Select the link below and copy it (Ctrl/Cmd+C).'
                : 'Copied to your clipboard. This link is long — paste it somewhere and confirm it wasn’t truncated before sharing.'}
              {shareNotice.warning ? ` ${shareNotice.warning}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-400"
              />
              <button
                onClick={handleCopy}
                className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                  justCopied
                    ? 'border-green-300 dark:border-green-700 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30'
                    : 'border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {justCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
