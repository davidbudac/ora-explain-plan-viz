import { useRef } from 'react';
import { usePlan } from '../hooks/usePlanContext';
import { CopyButton, Dialog, DialogBody } from './ui';

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

  const kind = shareNotice?.kind;
  const showDialog = kind === 'manual' || kind === 'warning' || kind === 'error';

  const url = shareNotice && 'url' in shareNotice ? shareNotice.url : '';

  if (!shareNotice || !showDialog) return null;

  const isError = kind === 'error';
  const title = isError
    ? 'Could not share plan'
    : kind === 'manual'
      ? 'Copy your share link'
      : 'Share link copied';

  return (
    // Keyed on the notice so a new notice re-runs the Dialog's initial focus
    // (which lands on the URL field below, pre-selected for a one-keystroke copy).
    <Dialog
      key={url || title}
      open
      onClose={dismissShareNotice}
      title={title}
      size="md"
      initialFocusRef={isError ? undefined : inputRef}
    >
      <DialogBody className="pb-5">
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
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
              {/* Shows "Copied!" only once the copy really worked; a failure raises an error toast and the link stays selected for a manual copy */}
              <CopyButton
                text={url}
                label="Copy"
                copiedLabel="Copied!"
                size="sm"
                className="border border-slate-300 dark:border-slate-600"
              />
            </div>
          </>
        )}
      </DialogBody>
    </Dialog>
  );
}
