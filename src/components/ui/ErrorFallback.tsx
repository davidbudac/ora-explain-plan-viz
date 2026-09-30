import { BTN_PRIMARY, BTN_SECONDARY } from './buttonStyles';
import { CopyButton } from './CopyButton';

function buildReport(error: Error, componentStack: string): string {
  const header = `${error.name}: ${error.message}`;
  const stack = error.stack && error.stack.includes(error.message) ? error.stack : `${header}\n${error.stack ?? ''}`;
  return componentStack ? `${stack.trim()}\n\nComponent stack:${componentStack}` : stack.trim();
}

export function ErrorFallback({
  error,
  componentStack,
  variant,
  onReset,
}: {
  error: Error;
  componentStack: string;
  variant: 'page' | 'panel';
  onReset: () => void;
}) {
  const card = (
    <div
      role="alert"
      className="w-full max-w-xl rounded-xl border border-red-200 bg-white p-5 text-[13px] text-slate-800 shadow-lg dark:border-red-900/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">Something went wrong</h2>
      <p className="mt-1 text-slate-600 dark:text-slate-400">
        The app hit an unexpected error. Try again to re-render; reloading the page discards in-memory work such as unsaved annotations.
      </p>
      <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-[12px] text-red-700 dark:border-slate-700 dark:bg-slate-950 dark:text-red-300">
        {error.message || String(error)}
      </pre>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN_PRIMARY} onClick={onReset}>
          Try again
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={() => window.location.reload()}>
          Reload page
        </button>
        <CopyButton
          size="sm"
          label="Copy error details"
          text={() => buildReport(error, componentStack)}
          className="ml-auto"
        />
      </div>
    </div>
  );

  if (variant === 'panel') {
    return <div className="flex h-full w-full items-center justify-center p-4">{card}</div>;
  }
  return <div className="flex min-h-screen w-full items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">{card}</div>;
}
